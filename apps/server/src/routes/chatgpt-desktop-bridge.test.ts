import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { createConnection, createServer, type Socket } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import WebSocket from "ws";
import {
  encodeWireValue,
  decodeWireValue,
} from "@agent-orchestrator/chatgpt-desktop-host/wire-value";
import { registerChatGptDesktopBridgeRoutes } from "./chatgpt-desktop-bridge.js";
import type { ChatGptDesktopProfile } from "../services/chatgpt-desktop-profile.js";
import type { DesktopControlConnection } from "@agent-orchestrator/chatgpt-desktop-host/control-client";

// Existing native contract tests use an explicitly versioned consuming browser.
// The separate consumption tests deliberately withhold and corrupt these ACKs.
function readWire(value: string): unknown {
  if(value.startsWith('KBC1:')) { const at=value.indexOf('\n'); assert.ok(at>0); value=value.slice(at+1); }
  return decodeWireValue(value);
}
function consumingSocket(socket: WebSocket): WebSocket {
  socket.on('message',data=>{
    const head=/^KBC1:([a-f0-9-]{36}):([0-9]+)\n/.exec(data.toString());
    if(head && socket.readyState===WebSocket.OPEN) socket.send('KBA1:'+head[1]+':'+head[2]);
  });
  return socket;
}

function profile(): ChatGptDesktopProfile {
  return {
    version: 1,
    id: randomUUID(),
    generation: randomUUID(),
    pid: 1234,
    startTicks: "55",
    uid: process.getuid!(),
    macAsarPath: "/private/mac.asar",
    macAsarSha256: "a".repeat(64),
    linuxAsarPath: "/private/linux.asar",
    linuxAsarSha256: "b".repeat(64),
    controlSocketPath: "/private/control.sock",
  };
}
async function fixture(
  t: test.TestContext,
  holdWrites = false,
  requireAuth: boolean | "large" = false,
  guardDelayMs = 0,
  failControlWith?: string,
) {
  const logs: string[] = [];
  const app = Fastify({ logger: { level: "warn", stream: { write: (line: string) => logs.push(line) } } });
  const acceptedSockets = new Set<Socket>();
  app.server.on("connection", (socket) => {
    acceptedSockets.add(socket);
    socket.once("close", () => acceptedSockets.delete(socket));
  });
  if (requireAuth)
    app.addHook("onRequest", async (request, reply) => {
      if (request.headers.origin === "https://external.invalid")
        return reply.code(403).send({ error: "invalid_origin" });
      if (request.headers.cookie !== "session=test") {
        if (requireAuth === "large")
          return reply.code(401).send(Buffer.alloc(8 * 1024 * 1024));
        return reply.code(401).send({ error: "unauthorized" });
      }
    });
  await app.register(websocket);
  const p = profile(),
    sent: string[] = [];
  let valid = true,
    closed = 0,
    opened = 0,
    profileReads = 0;
  let pushFrame: ((x: IteratorResult<string>) => void) | undefined;
  const fixtureFrames: IteratorResult<string>[] = [];
  let finishWrite: (() => void) | undefined;
  const controls: DesktopControlConnection[] = [];
  await app.register(registerChatGptDesktopBridgeRoutes, {
    profileService: {
      readValidated: async () => {
        profileReads++;
        if (guardDelayMs) await delay(guardDelayMs);
        return valid
          ? {
              status: {
                state: "ready",
                profileId: p.id,
                generation: p.generation,
                reasonCode: "identity_ready",
              },
              profile: p,
            }
          : { status: { state: "unavailable", reasonCode: "profile_changed" } };
      },
    },
    controlConnector: async (
      options: Parameters<
        typeof import("@agent-orchestrator/chatgpt-desktop-host/control-client").connectDesktopControl
      >[0],
    ) => {
      opened++;
      assert.equal(await options.verifyProfile(), true);
      const control: DesktopControlConnection = {
        scope: {
          profileId: p.id,
          generation: p.generation,
          viewId: options.viewId,
        },
        bootstrap: { windowType: "electron", getters: {}, sharedObjects: {} },
        sendFrame: async (x) => {
          // Mirror the real control client's mandatory final per-write guard.
          if (!(await options.verifyProfile()))
            throw new Error("identity changed");
          if (failControlWith) throw Object.assign(new Error("private-message-do-not-log"), { code: failControlWith });
          sent.push(x);
          if (holdWrites)
            await new Promise<void>((resolve) => {
              finishWrite = resolve;
            });
        },
        close: () => {
          closed++;
          finishWrite?.();
          pushFrame?.({ done: true, value: undefined });
        },
        frames: {
          [Symbol.asyncIterator]() {
            return {
              next: () => fixtureFrames.length ? Promise.resolve(fixtureFrames.shift()!) :
                new Promise<IteratorResult<string>>((resolve) => {
                  pushFrame = resolve;
                }),
            };
          },
        },
      };
      controls.push(control);
      return control;
    },
  });
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  const sockets: WebSocket[] = [];
  t.after(async () => {
    for (const s of sockets) s.terminate();
    for (const s of acceptedSockets) s.destroy();
    await app.close();
  });
  const uri = `/chatgpt-desktop/${p.id}/${p.generation}`;
  return {
    app,
    p,
    uri,
    address,
    sent,
    logs,
    controls,
    revoke: () => {
      valid = false;
    },
    get closed() {
      return closed;
    },
    get opened() {
      return opened;
    },
    get profileReads() {
      return profileReads;
    },
    connect: (origin = address, path = `${uri}/bridge`) => {
      const s = consumingSocket(new WebSocket(address.replace("http:", "ws:") + path, {
        origin,
      }));
      sockets.push(s);
      return s;
    },
    push: (value: unknown) => {
      const next: IteratorResult<string> = {done:false,value:encodeWireValue(value)};
      if(pushFrame) { const resolve=pushFrame;pushFrame=undefined;resolve(next); }
      else { assert.ok(fixtureFrames.length<8);fixtureFrames.push(next); }
    },
  };
}

test("records only the fixed first close cause and safe control code when a control write fails", async (t) => {
  const f = await fixture(t, false, false, 0, "CONTROL_INVALID_FRAME");
  const socket = f.connect();
  const [first] = await once(socket, "message");
  const bootstrap = readWire(first.toString()) as { scope: unknown };
  const closed = once(socket, "close");
  socket.send(encodeWireValue({ v: 1, scope: bootstrap.scope, seq: 1, type: "call", id: 1, method: "sendMessageFromView", args: [] }));
  const [code] = await closed;
  assert.equal(code, 1011);
  const causes = f.logs.map((line) => JSON.parse(line)).filter((entry) => entry.component === "chatgpt_desktop_bridge");
  assert.equal(causes.length, 1);
  assert.equal(causes[0].desktopCloseCause, "control_send_failed");
  assert.equal(causes[0].desktopControlCode, "CONTROL_INVALID_FRAME");
  assert.equal(f.logs.join("").includes("private-message-do-not-log"), false);
});

test("records the fixed broker error codes without exposing error text", async (t) => {
  for (const code of ["CONTROL_PROTOCOL_ERROR", "CONTROL_UPSTREAM_ERROR", "CONTROL_HANDSHAKE_TIMEOUT"]) {
    const f = await fixture(t, false, false, 0, code);
    const socket = f.connect();
    const [first] = await once(socket, "message");
    const bootstrap = readWire(first.toString()) as { scope: unknown };
    const closed = once(socket, "close");
    socket.send(encodeWireValue({ v: 1, scope: bootstrap.scope, seq: 1, type: "call", id: 1, method: "sendMessageFromView", args: [] }));
    await closed;
    const causes = f.logs.map((line) => JSON.parse(line)).filter((entry) => entry.component === "chatgpt_desktop_bridge");
    assert.equal(causes.length, 1);
    assert.equal(causes[0].desktopControlCode, code);
    assert.equal(f.logs.join("").includes("private-message-do-not-log"), false);
  }
});

test("never records an unknown exception code or logs a normal client close", async (t) => {
  const f = await fixture(t, false, false, 0, "PRIVATE_SECRET_CODE");
  const socket = f.connect();
  const [first] = await once(socket, "message");
  const bootstrap = readWire(first.toString()) as { scope: unknown };
  const closed = once(socket, "close");
  socket.send(encodeWireValue({ v: 1, scope: bootstrap.scope, seq: 1, type: "call", id: 1, method: "sendMessageFromView", args: [] }));
  await closed;
  const causes = f.logs.map((line) => JSON.parse(line)).filter((entry) => entry.component === "chatgpt_desktop_bridge");
  assert.equal(causes.length, 1);
  assert.equal(causes[0].desktopControlCode, "CONTROL_UNKNOWN");
  assert.equal(f.logs.join("").includes("PRIVATE_SECRET_CODE"), false);
  const other = await fixture(t);
  const client = other.connect();
  await once(client, "message");
  const done = once(client, "close");
  client.close();
  await done;
  assert.equal(other.logs.filter((line) => line.includes("chatgpt_desktop_bridge")).length, 0);
});

for (const scenario of [
  {
    name: "missing cookie",
    status: 401,
    cookie: "",
    origin: "same",
    error: "unauthorized",
  },
  {
    name: "wrong Origin in inherited auth",
    status: 403,
    cookie: "session=test",
    origin: "https://external.invalid",
    error: "invalid_origin",
  },
  {
    name: "wrong Origin in route validation",
    status: 403,
    cookie: "session=test",
    origin: "https://route.invalid",
    error: "invalid_origin",
  },
  {
    name: "malformed runtime and query",
    status: 401,
    cookie: "",
    origin: "same",
    error: "unauthorized",
    path: "/chatgpt-desktop/bad/bad/bridge?probe=1",
  },
] as const) {
  test(`rejected real upgrade with ${scenario.name} closes its TCP socket`, async (t) => {
    const f = await fixture(t, false, true);
    const url = new URL(f.address);
    const socket: Socket = createConnection({
      host: "127.0.0.1",
      port: Number(url.port),
      allowHalfOpen: true,
    });
    socket.on("error", () => {});
    let response = "";
    socket.on("data", (chunk) => {
      response += chunk.toString("utf8");
    });
    const ended = once(socket, "end");
    try {
      await once(socket, "connect");
      socket.write(
        [
          `GET ${"path" in scenario ? scenario.path : `${f.uri}/bridge`} HTTP/1.1`,
          `Host: ${url.host}`,
          "Connection: Upgrade",
          "Upgrade: websocket",
          "Sec-WebSocket-Version: 13",
          "Sec-WebSocket-Key: MTIzNDU2Nzg5MDEyMzQ1Ng==",
          `Origin: ${scenario.origin === "same" ? f.address : scenario.origin}`,
          ...(scenario.cookie ? [`Cookie: ${scenario.cookie}`] : []),
          "",
          "",
        ].join("\r\n"),
      );
      for (let n = 0; n < 100 && !response.includes("\r\n\r\n"); n++)
        await delay(5);
      assert.match(response, new RegExp(`^HTTP/1\\.1 ${scenario.status} `));
      await Promise.race([
        ended,
        delay(750).then(() => {
          throw new Error("rejected upgrade did not close its TCP socket");
        }),
      ]);
      const [header, body] = response.split("\r\n\r\n");
      assert.match(header!, /\r\nconnection: close\r\n/i);
      const length = Number(/\r\ncontent-length: (\d+)/i.exec(header!)?.[1]);
      assert.equal(Buffer.byteLength(body!), length);
      assert.deepEqual(JSON.parse(body!), { error: scenario.error });
      const count = await new Promise<number>((resolve, reject) =>
        f.app.server.getConnections((error, n) =>
          error ? reject(error) : resolve(n),
        ),
      );
      assert.equal(count, 0, "server retains no rejected upgrade sockets");
      assert.equal(f.opened, 0);
      await Promise.race([
        f.app.close(),
        delay(750).then(() => {
          throw new Error("Fastify did not close");
        }),
      ]);
    } finally {
      socket.destroy();
    }
  });
}

test("a rejected upgrade cannot retain a socket when its response cannot drain", async (t) => {
  const f = await fixture(t, false, "large");
  const url = new URL(f.address);
  const socket = createConnection({
    host: "127.0.0.1",
    port: Number(url.port),
    allowHalfOpen: true,
  });
  socket.on("error", () => {});
  try {
    await once(socket, "connect");
    socket.pause();
    socket.write(
      [
        `GET ${f.uri}/bridge HTTP/1.1`,
        `Host: ${url.host}`,
        "Connection: Upgrade",
        "Upgrade: websocket",
        "Sec-WebSocket-Version: 13",
        "Sec-WebSocket-Key: MTIzNDU2Nzg5MDEyMzQ1Ng==",
        `Origin: ${f.address}`,
        "",
        "",
      ].join("\r\n"),
    );
    await delay(100);
    let count = await new Promise<number>((resolve, reject) =>
      f.app.server.getConnections((error, n) =>
        error ? reject(error) : resolve(n),
      ),
    );
    assert.equal(count, 1, "the unread response is still backpressured");
    const deadline = performance.now() + 2600;
    while (count && performance.now() < deadline) {
      count = await new Promise<number>((resolve, reject) =>
        f.app.server.getConnections((error, n) =>
          error ? reject(error) : resolve(n),
        ),
      );
      if (count) await delay(25);
    }
    assert.equal(
      count,
      0,
      "a non-reading client cannot retain a rejected connection",
    );
    assert.equal(f.opened, 0);
  } finally {
    socket.destroy();
  }
});

test("closing Fastify immediately releases a stalled rejected upgrade", async (t) => {
  const f = await fixture(t, false, "large");
  const url = new URL(f.address);
  const socket = createConnection({
    host: "127.0.0.1",
    port: Number(url.port),
    allowHalfOpen: true,
  });
  socket.on("error", () => {});
  try {
    await once(socket, "connect");
    socket.pause();
    socket.write(
      [
        `GET ${f.uri}/bridge HTTP/1.1`,
        `Host: ${url.host}`,
        "Connection: Upgrade",
        "Upgrade: websocket",
        "Sec-WebSocket-Version: 13",
        "Sec-WebSocket-Key: MTIzNDU2Nzg5MDEyMzQ1Ng==",
        `Origin: ${f.address}`,
        "",
        "",
      ].join("\r\n"),
    );
    await delay(100);
    const before = await new Promise<number>((resolve, reject) =>
      f.app.server.getConnections((error, n) =>
        error ? reject(error) : resolve(n),
      ),
    );
    assert.equal(before, 1, "the rejected response remains backpressured");
    await Promise.race([
      f.app.close(),
      delay(750).then(() => {
        throw new Error("Fastify failed to release its own socket");
      }),
    ]);
    const after = await new Promise<number>((resolve, reject) =>
      f.app.server.getConnections((error, n) =>
        error ? reject(error) : resolve(n),
      ),
    );
    assert.equal(after, 0);
  } finally {
    socket.destroy();
  }
});

test("a valid authenticated upgrade still reaches the native bootstrap", async (t) => {
  const f = await fixture(t, false, true);
  const socket = consumingSocket(new WebSocket(
    f.address.replace("http:", "ws:") + `${f.uri}/bridge`,
    {
      origin: f.address,
      headers: { cookie: "session=test" },
    },
  ));
  try {
    const [first] = await once(socket, "message");
    assert.equal(
      (readWire(first.toString()) as { type: string }).type,
      "bootstrap",
    );
    assert.equal(f.opened, 1);
    socket.close();
    await once(socket, "close");
  } finally {
    socket.terminate();
  }
});

test("rejects cross-origin or wrong-runtime upgrades before opening native control", async (t) => {
  const f = await fixture(t);
  for (const [origin, path] of [
    ["https://external.invalid", `${f.uri}/bridge`],
    [f.address, `/chatgpt-desktop/${f.p.id}/${randomUUID()}/bridge`],
  ]) {
    const socket = f.connect(origin, path);
    socket.on("error", () => {});
    const [, response] = await once(socket, "unexpected-response");
    assert.ok([403, 404].includes(response.statusCode));
    response.resume();
    socket.terminate();
  }
  assert.equal(f.opened, 0);
});
test("hands off one exact bootstrap, preserves frames and closes only its native view", async (t) => {
  const f = await fixture(t),
    socket = f.connect();
  const [first] = await once(socket, "message");
  const bootstrap = readWire(first.toString()) as {
    type: string;
    scope: DesktopControlConnection["scope"];
  };
  assert.equal(bootstrap.type, "bootstrap");
  assert.equal(bootstrap.scope.profileId, f.p.id);
  const request = encodeWireValue({
    v: 1,
    scope: bootstrap.scope,
    seq: 1,
    type: "call",
    id: 1,
    method: "sendMessageFromView",
    args: [],
  });
  socket.send(request);
  for (let n = 0; n < 50 && !f.sent.length; n++)
    await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(f.sent, [request]);
  const message = once(socket, "message");
  f.push({
    v: 1,
    scope: bootstrap.scope,
    seq: 1,
    type: "return",
    id: 1,
    value: new Uint8Array([0, 255]),
  });
  assert.deepEqual(
    (readWire((await message)[0].toString()) as { value: Uint8Array })
      .value,
    new Uint8Array([0, 255]),
  );
  socket.close();
  await once(socket, "close");
  assert.ok(f.closed >= 1);
});
test("revalidates the complete profile before forwarding another browser operation", async (t) => {
  const f = await fixture(t),
    socket = f.connect();
  const [first] = await once(socket, "message");
  const bootstrap = readWire(first.toString()) as { scope: unknown };
  f.revoke();
  socket.send(
    encodeWireValue({
      v: 1,
      scope: bootstrap.scope,
      seq: 1,
      type: "call",
      id: 1,
      method: "sendMessageFromView",
      args: [],
    }),
  );
  await once(socket, "close");
  assert.equal(f.sent.length, 0);
});
test("custom control connectors retain the gateway's independent per-frame profile check", async (t) => {
  const f = await fixture(t, false, false, 4),
    socket = f.connect();
  const [first] = await once(socket, "message");
  const bootstrap = readWire(first.toString()) as { scope: unknown };
  const readsBefore = f.profileReads,
    start = performance.now();
  const frames = Array.from({ length: 32 }, (_, index) =>
    encodeWireValue({
      v: 1,
      scope: bootstrap.scope,
      seq: index + 1,
      type: "portPost",
      id: index + 1,
      portId: "app-host-1",
      data: { fixture: index },
    }),
  );
  for (const frame of frames) socket.send(frame);
  for (let n = 0; n < 500 && f.sent.length < frames.length; n++) await delay(5);
  const durationMs = Math.round(performance.now() - start);
  assert.deepEqual(
    f.sent,
    frames,
    "all 32 frames remain ordered and are written once",
  );
  assert.equal(
    f.profileReads - readsBefore,
    frames.length * 2,
    `the gateway preserves an independent check for an injected connector`,
  );
  f.revoke();
  const closed = once(socket, "close");
  socket.send(
    encodeWireValue({
      v: 1,
      scope: bootstrap.scope,
      seq: 33,
      type: "portPost",
      id: 33,
      portId: "app-host-1",
      data: { fixture: 33 },
    }),
  );
  await closed;
  assert.equal(
    f.sent.length,
    frames.length,
    "revoked identity cannot reach control",
  );
  t.diagnostic(
    `32 ordered writes with two 4ms synthetic fresh guards: ${durationMs} ms`,
  );
});
test(
  "real control client admits bounded ordered batches and rejects a changed profile before writing",
  { timeout: 5000 },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "desktop-gateway-control-"));
    const p = {
      ...profile(),
      pid: process.pid,
      startTicks: "12345",
      controlSocketPath: join(directory, "control.sock"),
    };
    const nativeSockets = new Set<Socket>(),
      received: unknown[] = [];
    const native = createServer((socket) => {
      nativeSockets.add(socket);
      socket.on("error", () => {});
      socket.on("close", () => nativeSockets.delete(socket));
      let buffer = "";
      socket.on("data", (data) => {
        buffer += data.toString("utf8");
        let at: number;
        while ((at = buffer.indexOf("\n")) >= 0) {
          const frame = readWire(buffer.slice(0, at)) as Record<
            string,
            unknown
          >;
          buffer = buffer.slice(at + 1);
          if (frame.type === "hello")
            socket.write(
              encodeWireValue({
                v: 1,
                type: "hello",
                profileId: p.id,
                generation: p.generation,
                pid: p.pid,
                startTicks: p.startTicks,
              }) + "\n",
            );
          else if (frame.type === "createView")
            socket.write(
              encodeWireValue({
                v: 1,
                type: "bootstrap",
                scope: {
                  profileId: p.id,
                  generation: p.generation,
                  viewId: frame.viewId,
                },
                bootstrap: {
                  windowType: "electron",
                  getters: {},
                  sharedObjects: {},
                },
              }) + "\n",
            );
          else received.push(frame);
        }
      });
    });
    native.listen(p.controlSocketPath);
    await once(native, "listening");
    const app = Fastify();
    await app.register(websocket);
    let valid = true,
      reads = 0,
      block = false,
      release: () => void = () => {},
      notifyStarted: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      notifyStarted = resolve;
    });
    await app.register(registerChatGptDesktopBridgeRoutes, {
      profileService: {
        readValidated: async () => {
          reads++;
          await delay(4);
          if (block) {
            block = false;
            notifyStarted();
            await new Promise<void>((resolve) => {
              release = resolve;
            });
          }
          return valid
            ? {
                status: {
                  state: "ready",
                  profileId: p.id,
                  generation: p.generation,
                  reasonCode: "identity_ready",
                },
                profile: p,
              }
            : {
                status: { state: "unavailable", reasonCode: "profile_changed" },
              };
        },
      },
    });
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const socket = consumingSocket(new WebSocket(
      address.replace("http:", "ws:") +
        `/chatgpt-desktop/${p.id}/${p.generation}/bridge`,
      { origin: address },
    ));
    t.after(async () => {
      socket.terminate();
      for (const current of nativeSockets) current.destroy();
      await app.close();
      await new Promise<void>((resolve) => native.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    });
    const [initial] = await once(socket, "message");
    const { scope } = readWire(initial.toString()) as { scope: unknown };
    const make = (seq: number) =>
      encodeWireValue({
        v: 1,
        scope,
        seq,
        type: "call",
        id: seq,
        method: "sendMessageFromView",
        args: [{ fixture: seq }],
      });
    const baseline = reads,
      start = performance.now();
    for (let seq = 1; seq <= 32; seq++) socket.send(make(seq));
    for (let n = 0; n < 400 && received.length < 32; n++) await delay(5);
    const durationMs = Math.round(performance.now() - start);
    assert.equal(received.length, 32);
    assert.deepEqual(
      received.map((item) => (item as { seq: number }).seq),
      Array.from({ length: 32 }, (_, index) => index + 1),
    );
    assert.ok(
      reads - baseline >= 4 && reads - baseline <= 8,
      `fixed batches revalidate identity without serializing all 32 admissions: ${reads - baseline} checks`,
    );
    t.diagnostic(
      `32 ordered private socket writes with one synthetic 4ms fresh guard: ${durationMs} ms`,
    );
    block = true;
    const closed = once(socket, "close");
    socket.send(make(33));
    await started;
    valid = false;
    release();
    await closed;
    assert.equal(
      received.length,
      32,
      "identity revoked during final guard never reaches private socket",
    );
  },
);

async function nativeOutputFixture(t: test.TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "desktop-gateway-output-"));
  const p = { ...profile(), pid: process.pid, startTicks: "12345", controlSocketPath: join(directory, "control.sock") };
  const nativeSockets = new Set<Socket>();
  let nativeSocket: Socket | undefined, scope: unknown;
  const native = createServer((peer) => {
    nativeSockets.add(peer); nativeSocket = peer;
    peer.on("error", () => {}); peer.on("close", () => nativeSockets.delete(peer));
    let buffer = "";
    peer.on("data", (data) => {
      buffer += data.toString("utf8");
      let at: number;
      while ((at = buffer.indexOf("\n")) >= 0) {
        const frame = readWire(buffer.slice(0, at)) as Record<string, unknown>;
        buffer = buffer.slice(at + 1);
        if (frame.type === "hello") peer.write(encodeWireValue({ v: 1, type: "hello", profileId: p.id, generation: p.generation, pid: p.pid, startTicks: p.startTicks }) + "\n");
        else if (frame.type === "createView") {
          scope = { profileId: p.id, generation: p.generation, viewId: frame.viewId };
          peer.write(encodeWireValue({ v: 1, type: "bootstrap", scope, bootstrap: { windowType: "electron", getters: {}, sharedObjects: {} } }) + "\n");
        }
      }
    });
  });
  native.listen(p.controlSocketPath);
  await once(native, "listening");
  const app = Fastify();
  await app.register(websocket);
  let valid = true, reads = 0, nextGuard: (() => Promise<void>) | undefined;
  await app.register(registerChatGptDesktopBridgeRoutes, {
    profileService: { readValidated: async () => {
      reads++;
      const guard = nextGuard; nextGuard = undefined;
      if (guard) await guard();
      await delay(3);
      return valid ? { status: { state: "ready", profileId: p.id, generation: p.generation, reasonCode: "identity_ready" }, profile: p } : { status: { state: "unavailable", reasonCode: "profile_changed" } };
    } },
  });
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  const socket = consumingSocket(new WebSocket(address.replace("http:", "ws:") + `/chatgpt-desktop/${p.id}/${p.generation}/bridge`, { origin: address }));
  t.after(async () => {
    socket.terminate();
    for (const peer of nativeSockets) peer.destroy();
    await app.close(); await new Promise<void>((resolve) => native.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  });
  await once(socket, "message");
  return {
    socket,
    get reads() { return reads; },
    revoke() { valid = false; },
    holdNextGuard(guard: () => Promise<void>) { nextGuard = guard; },
    emit(start: number, count: number) {
      assert.ok(nativeSocket && scope);
      const frames = Array.from({ length: count }, (_, index) => encodeWireValue({ v: 1, type: "theme", scope, seq: start + index, value: "light" }));
      nativeSocket.write(frames.join("\n") + "\n");
    },
  };
}

test("real Unix native output of 32 ordered frames uses bounded fresh checks", { timeout: 5000 }, async (t) => {
  const f = await nativeOutputFixture(t), received: number[] = [];
  f.socket.on("message", (data) => received.push((readWire(data.toString()) as {seq:number}).seq));
  const baseline = f.reads;
  f.emit(1, 32);
  for (let n = 0; n < 400 && received.length < 32; n++) await delay(5);
  assert.deepEqual(received, Array.from({ length: 32 }, (_, i) => i + 1));
  assert.ok(f.reads - baseline >= 4 && f.reads - baseline <= 8, `four to eight fixed fresh guards, got ${f.reads - baseline}`);
});

test("native output held at its fresh guard is dropped if profile is revoked", { timeout: 5000 }, async (t) => {
  const f = await nativeOutputFixture(t), received: number[] = [];
  f.socket.on("message", (data) => received.push((readWire(data.toString()) as {seq:number}).seq));
  let release: () => void = () => {}, entered: () => void = () => {};
  const started = new Promise<void>((resolve) => { entered = resolve; });
  f.holdNextGuard(async () => { entered(); await new Promise<void>((resolve) => { release = resolve; }); });
  const closed = once(f.socket, "close");
  f.emit(1, 8);
  await started;
  f.revoke(); release();
  await closed;
  assert.deepEqual(received, []);
});

test("native output reuses a completed socket slot without waiting for an older slow callback", { timeout: 5000 }, async (t) => {
  const f = await nativeOutputFixture(t), attempts: number[] = [], received: number[] = [];
  f.socket.on("message", (data) => received.push((readWire(data.toString()) as {seq:number}).seq));
  const original = WebSocket.prototype.send, inFlight = new Set<number>();
  let releaseFirst: (() => void) | undefined, firstReturned: (() => void) | undefined, maxInFlight = 0;
  const firstIsHeld = new Promise<void>((resolve) => { firstReturned = resolve; });
  WebSocket.prototype.send = function (this: WebSocket, data: unknown, ...args: unknown[]) {
    if (this !== f.socket) {
      const frame = readWire(String(data)) as {type?:string;seq?:number};
      if (frame.type === "theme") {
        const seq = frame.seq!, callback = args[args.length - 1] as (error?: Error) => void;
        attempts.push(seq); inFlight.add(seq); maxInFlight = Math.max(maxInFlight, inFlight.size);
        args[args.length - 1] = (error?: Error) => {
          const complete = () => { inFlight.delete(seq); callback(error); };
          if (seq === 1) { releaseFirst = complete; firstReturned?.(); }
          else complete();
        };
      }
    }
    return Reflect.apply(original, this, [data, ...args]);
  } as typeof WebSocket.prototype.send;
  try {
    f.emit(1, 16);
    await firstIsHeld;
    for (let n = 0; n < 100 && !attempts.includes(9); n++) await delay(5);
    assert.ok(attempts.includes(9), "a later completed write must release capacity while the first callback remains pending");
    assert.ok(maxInFlight <= 8, `at most eight native outputs may remain unfinished, got ${maxInFlight}`);
    releaseFirst?.(); releaseFirst = undefined;
    for (let n = 0; n < 400 && received.length < 16; n++) await delay(5);
    assert.deepEqual(received, Array.from({ length: 16 }, (_, i) => i + 1));
  } finally {
    releaseFirst?.();
    WebSocket.prototype.send = original;
  }
});

test("profile revocation during a refilled output guard prevents the next batch", { timeout: 5000 }, async (t) => {
  const f = await nativeOutputFixture(t), attempts: number[] = [];
  const original = WebSocket.prototype.send;
  let releaseGuard: (() => void) | undefined, enteredGuard: (() => void) | undefined;
  const guardStarted = new Promise<void>((resolve) => { enteredGuard = resolve; });
  WebSocket.prototype.send = function (this: WebSocket, data: unknown, ...args: unknown[]) {
    if (this !== f.socket) {
      const frame = readWire(String(data)) as {type?:string;seq?:number};
      if (frame.type === "theme") {
        attempts.push(frame.seq!);
        if (frame.seq === 1) f.holdNextGuard(async () => {
          enteredGuard?.();
          await new Promise<void>((resolve) => { releaseGuard = resolve; });
        });
      }
    }
    return Reflect.apply(original, this, [data, ...args]);
  } as typeof WebSocket.prototype.send;
  try {
    const closed = once(f.socket, "close");
    f.emit(1, 16);
    await guardStarted;
    const sentBeforeRevocation = [...attempts];
    assert.ok(sentBeforeRevocation.length > 0 && sentBeforeRevocation.length <= 8);
    f.revoke(); releaseGuard?.(); releaseGuard = undefined;
    await closed;
    assert.deepEqual(attempts, sentBeforeRevocation, "a revoked profile cannot dispatch a later batch");
  } finally {
    releaseGuard?.();
    WebSocket.prototype.send = original;
  }
});

test("an asynchronous browser socket failure closes the output without replay", { timeout: 5000 }, async (t) => {
  const f = await nativeOutputFixture(t), attempts: number[] = [];
  const original = WebSocket.prototype.send;
  let failFirst: (() => void) | undefined, firstReturned: (() => void) | undefined;
  const firstIsHeld = new Promise<void>((resolve) => { firstReturned = resolve; });
  WebSocket.prototype.send = function (this: WebSocket, data: unknown, ...args: unknown[]) {
    if (this !== f.socket) {
      const frame = readWire(String(data)) as {type?:string;seq?:number};
      if (frame.type === "theme") {
        attempts.push(frame.seq!);
        if (frame.seq === 1) {
          const callback = args[args.length - 1] as (error?: Error) => void;
          args[args.length - 1] = (error?: Error) => {
            failFirst = () => callback(error ?? new Error("fixture asynchronous send failure"));
            firstReturned?.();
          };
        }
      }
    }
    return Reflect.apply(original, this, [data, ...args]);
  } as typeof WebSocket.prototype.send;
  try {
    const closed = once(f.socket, "close");
    f.emit(1, 32);
    await firstIsHeld;
    for (let n = 0; n < 100 && !attempts.includes(9); n++) await delay(5);
    assert.ok(attempts.includes(9));
    const sentBeforeFailure = [...attempts];
    failFirst?.(); failFirst = undefined;
    await closed;
    assert.deepEqual(attempts, sentBeforeFailure, "no later output is dispatched after failure");
    assert.deepEqual(attempts, Array.from({ length: attempts.length }, (_, i) => i + 1), "no native frame is replayed");
  } finally {
    failFirst?.();
    WebSocket.prototype.send = original;
  }
});

test("a synchronous browser socket failure in a native batch never dispatches the suffix", { timeout: 5000 }, async (t) => {
  const f = await nativeOutputFixture(t), attempts: number[] = [], received: number[] = [];
  f.socket.on("message", (data) => received.push((readWire(data.toString()) as {seq:number}).seq));
  const original = WebSocket.prototype.send;
  WebSocket.prototype.send = function (this: WebSocket, data: unknown, ...args: unknown[]) {
    if (this !== f.socket) {
      const frame = readWire(String(data)) as {type?:string;seq?:number};
      if (frame.type === "theme") { attempts.push(frame.seq!); if (attempts.length === 3) throw new Error("fixture send failure"); }
    }
    return Reflect.apply(original, this, [data, ...args]);
  } as typeof WebSocket.prototype.send;
  try {
    const closed = once(f.socket, "close");
    f.emit(1, 8);
    await closed;
    assert.deepEqual(attempts, [1, 2, 3]);
    assert.deepEqual(received, [1, 2]);
  } finally { WebSocket.prototype.send = original; }
});
test("serves only explicitly selected bridge modules under the same runtime binding", async (t) => {
  const f = await fixture(t);
  const response = await f.app.inject(
    `${f.uri}/webview/__host/browser-bridge.mjs`,
  );
  assert.equal(response.statusCode, 200);
  assert.match(response.headers["content-type"]!, /javascript/);
  assert.ok(response.body.includes("installDesktopBridge"));
  const sidecars = [
    ["surface-host-bridge.mjs", "connectDesktopSurfaceHost"],
    ["surface-activation.mjs", "createDesktopSurfaceActivation"],
    ["browser-surface-controller.mjs", "createBrowserSurfaceController"],
    ["browser-image-file-picker.mjs", "installBrowserImageFilePicker"],
    ["browser-project-folder-picker.mjs", "createBrowserProjectFolderPicker"],
    [
      "browser-isolated-pane-navigation.mjs",
      "createBrowserIsolatedPaneNavigation",
    ],
    [
      "browser-shared-thread-navigation.mjs",
      "createBrowserSharedThreadNavigation",
    ],
    ["browser-shared-catalog.mjs", "createBrowserSharedCatalog"],
    ["browser-shared-thread-directory.mjs", "createBrowserSharedThreadDirectory"],
    [
      "browser-sidebar-navigation-probe.mjs",
      "createBrowserSidebarNavigationProbe",
    ],
    ["browser-react-root-probe.mjs", "createRootWithDelegateProbe"],
    ["browser-context-menu.mjs", "createBrowserContextMenus"],
    ["browser-rich-editor.mjs", "createBrowserRichEditor"],
    ["browser-composer-capability.mjs", "createBrowserComposerCapability"],
    ["browser-composer-capability-entry.mjs", "initializeComposerCapability"],
    ["desktop-layout-browser.mjs", "DesktopLayoutBoundary"],
    ["desktop-layout-core.mjs", "createDesktopLayoutRuntime"],
    ["desktop-pane-layout.mjs", "createDesktopPaneLayout"],
    ["desktop-selected-pane-core.mjs", "createDesktopSelectedPaneRuntime"],
    ["desktop-selected-pane-browser.mjs", "DesktopSelectedPaneBoundary"],
    ["desktop-split-pane-core.mjs", "createDesktopSplitPaneRuntime"],
    ["desktop-split-pane-browser.mjs", "DesktopSplitPaneBoundary"],
  ] as const;
  for (const [name, symbol] of sidecars) {
    const sidecar = await f.app.inject(`${f.uri}/webview/__host/${name}`);
    assert.equal(sidecar.statusCode, 200, `fixed sidecar ${name} must resolve through its package export`);
    assert.match(sidecar.headers["content-type"] ?? "", /javascript/);
    assert.ok(sidecar.body.includes(symbol));
  }
  assert.equal(
    (await f.app.inject(`${f.uri}/webview/__host/control-client.mjs`))
      .statusCode,
    404,
  );
  f.revoke();
  assert.equal(
    (await f.app.inject(`${f.uri}/webview/__host/wire-value.mjs`)).statusCode,
    503,
  );
  for (const [name] of sidecars) {
    assert.equal(
      (await f.app.inject(`${f.uri}/webview/__host/${name}`)).statusCode,
      503,
    );
  }
});
test("rejects binary messages and oversized text at the dedicated WebSocket receiver", async (t) => {
  for (const oversized of [false, true]) {
    const f = await fixture(t),
      socket = f.connect();
    await once(socket, "message");
    const closed = once(socket, "close");
    socket.send(
      oversized ? "x".repeat(8 * 1024 * 1024 + 1) : Buffer.from("binary"),
      { binary: !oversized },
    );
    const [code] = await closed;
    assert.equal(code, oversized ? 1009 : 1008);
    assert.equal(f.sent.length, 0);
  }
});
test(
  "bounds the number of queued tiny frames as well as their bytes",
  { timeout: 2000 },
  async (t) => {
    const f = await fixture(t, true),
      socket = f.connect();
    const [initial] = await once(socket, "message");
    const bootstrap = readWire(initial.toString()) as { scope: unknown };
    const closed = once(socket, "close");
    for (let seq = 1; seq <= 65; seq++)
      socket.send(
        encodeWireValue({
          v: 1,
          scope: bootstrap.scope,
          seq,
          type: "call",
          id: seq,
          method: "sendMessageFromView",
          args: [],
        }),
      );
    const [code] = await closed;
    assert.equal(code, 1009);
    assert.ok(f.sent.length <= 1);
  },
);

test('optional private SSH endpoint changes invalidate an existing bridge before its next write',{timeout:3000},async t=>{
  const f=await fixture(t),socket=f.connect();const [first]=await once(socket,'message');const bootstrap=readWire(first.toString()) as {scope:unknown};
  f.p.serverSshSocketPath='/private/new-bridge/server-ssh.sock';
  socket.send(encodeWireValue({v:1,scope:bootstrap.scope,seq:1,type:'call',id:1,method:'sendMessageFromView',args:[]}));
  await once(socket,'close');assert.equal(f.sent.length,0);
});
