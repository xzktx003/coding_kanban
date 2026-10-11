import assert from "node:assert/strict";
import {
  mkdtemp,
  writeFile,
  rm,
  chmod,
  symlink,
  mkdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createServer,
  request as httpRequest,
  type RequestListener,
} from "node:http";
import { once } from "node:events";
import test from "node:test";
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import WebSocket, { WebSocketServer } from "ws";
import {
  registerNativeCodexRoutes,
  NATIVE_CODEX_MAX_MESSAGE_BYTES,
  NATIVE_CODEX_MAX_PENDING_BYTES,
  NATIVE_CODEX_MAX_UPSTREAM_MESSAGE_BYTES,
  rewriteNativeCodexLocation,
} from "./native-codex.js";
import {
  NativeCodexGateway,
  validateNativeCodexUpstream,
} from "../services/native-codex-gateway.js";

async function setup(handler: RequestListener = (_req, res) => res.end("ok")) {
  const dir = await mkdtemp(join(tmpdir(), "native-codex-gateway-"));
  const upstream = createServer(handler);
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  const address = upstream.address();
  assert.ok(address && typeof address !== "string");
  const record = join(dir, "record.json");
  await writeFile(
    record,
    JSON.stringify({
      port: address.port,
      protocol: "http",
      projectDir: join(dir, "project"),
      extensionVersion: "26.1.2",
      threads: [{ id: "fixture-a", title: "First fixture" }],
      brokerAuthFile: "/private/auth.json",
      token: "do-not-expose",
    }),
    { mode: 0o600 },
  );
  const gateway = new NativeCodexGateway(() => ({
    upstreamUrl: `http://127.0.0.1:${address.port}`,
    runtimeRecord: record,
  }));
  const app = Fastify();
  await app.register(websocket);
  app.get("/test-global-ws", { websocket: true }, (socket) => {
    socket.on("message", (data, binary) => socket.send(data, { binary }));
  });
  await app.register(registerNativeCodexRoutes, { gateway });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const appAddress = app.server.address();
  assert.ok(appAddress && typeof appAddress !== "string");
  return {
    dir,
    record,
    gateway,
    upstream,
    app,
    origin: `http://127.0.0.1:${appAddress.port}`,
    async close() {
      await app.close();
      upstream.closeAllConnections();
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
      await rm(dir, { recursive: true, force: true });
    },
  };
}

test("explicit upstream accepts loopback HTTP root only", () => {
  for (const url of [
    "http://127.0.0.1:12345",
    "http://localhost:12345/",
    "http://[::1]:12345/",
  ])
    assert.ok(validateNativeCodexUpstream(url));
  for (const url of [
    undefined,
    "http://127.1:12345",
    "http://2130706433:12345",
    "http://127.0.0.2:12345",
    "https://localhost:12345",
    "http://localhost",
    "http://user:secret@localhost:12345",
    "http://localhost:12345/path",
    "http://localhost:12345/?q=1",
    "http://localhost:12345/#secret",
    "http://example.org:12345",
  ])
    assert.equal(validateNativeCodexUpstream(url), null, String(url));
});

test("status uses verified record and returns only public metadata", async () => {
  const fixture = await setup();
  try {
    const response = await fixture.app.inject(
      "/api/native-codex/status?upstream=http://example.org",
    );
    assert.deepEqual(response.json(), {
      available: true,
      iframeUrl: `/native-codex/?folder=${encodeURIComponent(join(fixture.dir, "project"))}`,
      extensionVersion: "26.1.2",
      fixtures: [{ id: "fixture-a", label: "First fixture" }],
    });
    assert.ok(!response.body.includes("do-not-expose"));
  } finally {
    await fixture.close();
  }
});

test("unsafe, oversized, mismatched and symlink records fail closed", async () => {
  const fixture = await setup();
  try {
    await chmod(fixture.record, 0o644);
    assert.equal((await fixture.gateway.status()).available, false);
    await chmod(fixture.record, 0o600);
    await writeFile(fixture.record, " ".repeat(128 * 1024));
    assert.equal((await fixture.gateway.status()).available, false);
    await writeFile(
      fixture.record,
      JSON.stringify({
        port: 1,
        protocol: "http",
        projectDir: fixture.dir,
        threads: [],
      }),
    );
    assert.equal((await fixture.gateway.status()).available, false);
    const safe = join(fixture.dir, "safe.json");
    await writeFile(safe, JSON.stringify({ port: 12345 }), { mode: 0o600 });
    await rm(fixture.record);
    await symlink(safe, fixture.record);
    assert.equal((await fixture.gateway.status()).available, false);
    assert.equal(
      (await fixture.app.inject("/native-codex/test")).statusCode,
      503,
    );
  } finally {
    await fixture.close();
  }
});

test("missing version is verified from installed manifest, never inferred from folder", async () => {
  const fixture = await setup();
  try {
    const extensionsDir = join(fixture.dir, "extensions");
    await mkdir(join(extensionsDir, "openai.chatgpt-invented"), {
      recursive: true,
    });
    await writeFile(
      join(extensionsDir, "openai.chatgpt-invented", "package.json"),
      JSON.stringify({
        publisher: "openai",
        name: "chatgpt",
        version: "26.5.9",
      }),
    );
    const port = (fixture.upstream.address() as { port: number }).port;
    await writeFile(
      fixture.record,
      JSON.stringify({
        port,
        protocol: "http",
        projectDir: fixture.dir,
        extensionsDir,
        threads: ["fixture-b"],
      }),
    );
    assert.equal((await fixture.gateway.status()).extensionVersion, "26.5.9");
  } finally {
    await fixture.close();
  }
});

test("HTTP prefix forwards origin headers, streams body and rewrites redirects/cookies", async () => {
  let received = { url: "", prefix: "", origin: "", host: "", body: "" };
  const fixture = await setup((req, res) => {
    if (req.url === "/healthz") return void res.end("ok");
    received = {
      url: req.url!,
      prefix: String(req.headers["x-forwarded-prefix"]),
      origin: String(req.headers.origin),
      host: String(req.headers.host),
      body: "",
    };
    req.on("data", (chunk) => (received.body += chunk));
    req.on("end", () => {
      res.statusCode = 302;
      res.setHeader("location", "/login?to=%2F");
      res.setHeader("set-cookie", [
        "session=opaque; Path=/; HttpOnly",
        "nested=yes; Path=/webview; SameSite=Lax",
      ]);
      res.end("official-body");
    });
  });
  try {
    const response = await fetch(
      `${fixture.origin}/native-codex/api/test?x=1`,
      {
        method: "POST",
        headers: {
          origin: fixture.origin,
          "content-type": "application/octet-stream",
        },
        body: "binary-test",
        redirect: "manual",
      },
    );
    assert.equal(response.status, 302);
    assert.equal(
      response.headers.get("location"),
      "/native-codex/login?to=%2F",
    );
    assert.deepEqual(response.headers.getSetCookie(), [
      "session=opaque; Path=/native-codex/; HttpOnly",
      "nested=yes; Path=/native-codex/webview; SameSite=Lax",
    ]);
    assert.equal(await response.text(), "official-body");
    assert.deepEqual(received, {
      url: "/api/test?x=1",
      prefix: "/native-codex",
      origin: fixture.origin,
      host: new URL(fixture.origin).host,
      body: "binary-test",
    });
    const root = await fetch(`${fixture.origin}/native-codex`, {
      redirect: "manual",
    });
    assert.equal(root.headers.get("location"), "/native-codex/");
  } finally {
    await fixture.close();
  }
});

test("WebSocket preserves immediate handshake, binary frames and forwarding headers", async () => {
  const fixture = await setup();
  const wss = new WebSocketServer({ noServer: true });
  let headers: import("node:http").IncomingHttpHeaders = {};
  let url = "";
  fixture.upstream.on("upgrade", (req, socket, head) => {
    headers = req.headers;
    url = req.url!;
    setTimeout(() => {
      if (!socket.destroyed)
        wss.handleUpgrade(req, socket, head, (ws) => {
          ws.on("message", (data, binary) => ws.send(data, { binary }));
        });
    }, 60);
  });
  const client = new WebSocket(
    `${fixture.origin.replace("http:", "ws:")}/native-codex/ws?reconnect=1`,
    { origin: fixture.origin },
  );
  try {
    await once(client, "open");
    client.send("immediate");
    let [data, binary] = await once(client, "message");
    assert.equal(data.toString(), "immediate");
    assert.equal(binary, false);
    client.send(Buffer.from([0, 1, 255]));
    [data, binary] = await once(client, "message");
    assert.deepEqual(data, Buffer.from([0, 1, 255]));
    assert.equal(binary, true);
    assert.equal(url, "/ws?reconnect=1");
    assert.equal(headers["x-forwarded-prefix"], "/native-codex");
    assert.equal(headers.origin, fixture.origin);
    assert.equal(headers.host, new URL(fixture.origin).host);
    client.close();
    await once(client, "close");
  } finally {
    client.terminate();
    wss.clients.forEach((ws) => ws.terminate());
    wss.close();
    await fixture.close();
  }
});

test("WebSocket queue is bounded and cancelled handshake closes upstream", async () => {
  const fixture = await setup();
  const sockets = new Set<import("node:stream").Duplex>();
  const upgraded = once(fixture.upstream, "upgrade");
  fixture.upstream.on("upgrade", (_req, socket) => {
    sockets.add(socket);
    socket.resume();
    // Raw HTTP upgrade sockets are half-open; acknowledge the proxy's FIN as a real WS server does.
    socket.once("end", () => socket.destroy());
    socket.on("close", () => sockets.delete(socket));
  });
  const client = new WebSocket(
    `${fixture.origin.replace("http:", "ws:")}/native-codex/ws`,
  );
  try {
    await once(client, "open");
    await upgraded;
    assert.equal(sockets.size, 1);
    const closed = once(client, "close");
    client.send(Buffer.alloc(NATIVE_CODEX_MAX_PENDING_BYTES / 2));
    client.send(Buffer.alloc(NATIVE_CODEX_MAX_PENDING_BYTES / 2));
    client.send(Buffer.alloc(1));
    const [code, reason] = await closed;
    assert.equal(code, 1009);
    assert.match(reason.toString(), /handshake queue exceeded/);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(sockets.size, 0);
  } finally {
    client.terminate();
    sockets.forEach((socket) => socket.destroy());
    await fixture.close();
  }
});

test("unconfigured and stopped host status stays unavailable without exposing configuration", async () => {
  const disabled = new NativeCodexGateway(() => ({}));
  assert.deepEqual(await disabled.status(), {
    available: false,
    reason: "Codex 宿主暂未配置。",
  });
  const fixture = await setup();
  try {
    fixture.upstream.closeAllConnections();
    await new Promise<void>((resolve) =>
      fixture.upstream.close(() => resolve()),
    );
    assert.deepEqual(await fixture.gateway.status(), {
      available: false,
      reason: "Codex 宿主暂不可用。",
    });
    const response = await fixture.app.inject("/native-codex/file");
    assert.equal(response.statusCode, 502);
    assert.equal(
      response.body,
      JSON.stringify({ error: "Native Codex host proxy failed." }),
    );
  } finally {
    await fixture.close();
  }
});

test("absolute upstream redirect is scoped while external and relative redirects are preserved", () => {
  const upstream = new URL("http://127.0.0.1:12345");
  assert.equal(
    rewriteNativeCodexLocation("http://127.0.0.1:12345/login?a=1#x", upstream),
    "/native-codex/login?a=1#x",
  );
  assert.equal(
    rewriteNativeCodexLocation("/native-codex/already", upstream),
    "/native-codex/already",
  );
  assert.equal(
    rewriteNativeCodexLocation("//127.0.0.1:12345/login", upstream),
    "/native-codex/login",
  );
  assert.equal(rewriteNativeCodexLocation("./login", upstream), "./login");
  assert.equal(
    rewriteNativeCodexLocation("https://example.org/oauth", upstream),
    "https://example.org/oauth",
  );
});

test("HTTP client abort releases the independent upstream stream", async () => {
  let upstreamClosed: (() => void) | undefined;
  const closed = new Promise<void>((resolve) => {
    upstreamClosed = resolve;
  });
  const fixture = await setup((_req, res) => {
    res.writeHead(200, { "content-type": "application/octet-stream" });
    res.write("started");
    res.once("close", () => upstreamClosed?.());
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const client = httpRequest(
        `${fixture.origin}/native-codex/stream`,
        (response) => {
          response.once("data", () => {
            response.destroy();
            client.destroy();
            resolve();
          });
        },
      );
      client.on("error", reject);
      client.end();
    });
    await Promise.race([
      closed,
      new Promise<never>((_resolve, reject) =>
        setTimeout(
          () => reject(new Error("upstream stream was not released")),
          1000,
        ).unref(),
      ),
    ]);
  } finally {
    await fixture.close();
  }
});

test("HTTPS frontend forwarding stays same-origin through the HTTP development gateway", async () => {
  let observed: import("node:http").IncomingHttpHeaders = {};
  const fixture = await setup((req, res) => {
    observed = req.headers;
    res.end("ok");
  });
  try {
    const response = await fixture.app.inject({
      url: "/native-codex/static/asset.js",
      headers: {
        host: "frontend.example:3100",
        origin: "https://frontend.example:3100",
        referer: "https://frontend.example:3100/?mode=codex",
        "x-forwarded-prefix": "/attacker",
        "x-forwarded-host": "attacker.invalid",
        "x-forwarded-proto": "https",
      },
    });
    assert.equal(response.statusCode, 200);
    assert.equal(observed.host, "frontend.example:3100");
    assert.equal(observed["x-forwarded-host"], "frontend.example:3100");
    assert.equal(observed["x-forwarded-proto"], "https");
    assert.equal(observed["x-forwarded-prefix"], "/native-codex");
  } finally {
    await fixture.close();
  }
});

test("native HTTP and WS reject foreign Origin before contacting upstream", async () => {
  let upstreamRequests = 0;
  const fixture = await setup((_req, res) => {
    upstreamRequests++;
    res.end("reached");
  });
  fixture.upstream.on("upgrade", (_req, socket) => {
    upstreamRequests++;
    socket.destroy();
  });
  try {
    const response = await fetch(`${fixture.origin}/native-codex/`, {
      headers: { origin: "https://attacker.invalid" },
    });
    assert.equal(response.status, 403);
    const client = new WebSocket(
      `${fixture.origin.replace("http:", "ws:")}/native-codex/ws`,
      { origin: "https://attacker.invalid" },
    );
    client.on("error", () => {});
    const status = await new Promise<number>((resolve) =>
      client.once("unexpected-response", (_request, response) => {
        resolve(response.statusCode!);
        response.resume();
        client.terminate();
      }),
    );
    assert.equal(status, 403);
    assert.equal(upstreamRequests, 0);
  } finally {
    await fixture.close();
  }
});

test(
  "native WS rejects subprotocol offers instead of negotiating inconsistent protocols",
  { timeout: 1000 },
  async () => {
    const fixture = await setup();
    let upgrades = 0;
    fixture.upstream.on("upgrade", (_req, socket) => {
      upgrades++;
      socket.destroy();
    });
    try {
      const client = new WebSocket(
        `${fixture.origin.replace("http:", "ws:")}/native-codex/ws`,
        ["first", "second"],
      );
      client.on("error", () => {});
      const status = await new Promise<number>((resolve) =>
        client.once("unexpected-response", (_request, response) => {
          resolve(response.statusCode!);
          response.resume();
          client.terminate();
        }),
      );
      assert.equal(status, 400);
      assert.equal(upgrades, 0);
    } finally {
      await fixture.close();
    }
  },
);

test("native WS bounds fragmented messages before assembly without lowering the global receiver limit", async () => {
  const fixture = await setup();
  const wss = new WebSocketServer({ noServer: true });
  let receivedMessages = 0;
  fixture.upstream.on("upgrade", (req, socket, head) =>
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.on("message", () => receivedMessages++);
    }),
  );
  const client = new WebSocket(
    `${fixture.origin.replace("http:", "ws:")}/native-codex/ws`,
  );
  const globalClient = new WebSocket(
    `${fixture.origin.replace("http:", "ws:")}/test-global-ws`,
  );
  try {
    await once(client, "open");
    const closed = once(client, "close");
    client.send(Buffer.alloc(NATIVE_CODEX_MAX_MESSAGE_BYTES + 1), {
      binary: true,
      fin: false,
    });
    const [code] = await Promise.race([
      closed,
      new Promise<never>((_resolve, reject) =>
        setTimeout(
          () =>
            reject(
              new Error("fragment retained without early receiver rejection"),
            ),
          300,
        ).unref(),
      ),
    ]);
    assert.equal(code, 1009);
    assert.equal(receivedMessages, 0);
    assert.equal(
      fixture.app.websocketServer.options.maxPayload,
      100 * 1024 * 1024,
    );
    if (globalClient.readyState !== WebSocket.OPEN)
      await once(globalClient, "open");
    globalClient.send(Buffer.alloc(NATIVE_CODEX_MAX_MESSAGE_BYTES + 1), {
      binary: true,
      fin: false,
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(globalClient.readyState, WebSocket.OPEN);
    const echoed = once(globalClient, "message");
    globalClient.send(Buffer.alloc(0), { binary: true, fin: true });
    const [data] = await echoed;
    assert.equal(data.byteLength, NATIVE_CODEX_MAX_MESSAGE_BYTES + 1);
  } finally {
    client.terminate();
    globalClient.terminate();
    wss.clients.forEach((ws) => ws.terminate());
    wss.close();
    await fixture.close();
  }
});

test("Vite WS ws/wss forwarded schemes normalize for strict same-origin validation", async () => {
  const fixture = await setup();
  const wss = new WebSocketServer({ noServer: true });
  const upstreamHeaders: import("node:http").IncomingHttpHeaders[] = [];
  fixture.upstream.on("upgrade", (req, socket, head) => {
    upstreamHeaders.push(req.headers);
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.on("message", (data, binary) => ws.send(data, { binary }));
    });
  });
  const clients: WebSocket[] = [];
  function connect(
    forwarded: string,
    origin: string,
  ): Promise<{ client: WebSocket; status: number }> {
    const client = new WebSocket(
      `${fixture.origin.replace("http:", "ws:")}/native-codex/ws`,
      {
        origin,
        headers: {
          host: "frontend.example:3100",
          "x-forwarded-proto": forwarded,
        },
      },
    );
    clients.push(client);
    return new Promise((resolve, reject) => {
      client.once("open", () => resolve({ client, status: 101 }));
      client.once("unexpected-response", (_request, response) => {
        response.resume();
        resolve({ client, status: response.statusCode! });
        client.terminate();
      });
      client.on("error", reject);
    });
  }
  try {
    for (const [forwarded, origin, expected] of [
      ["wss", "https://frontend.example:3100", "https"],
      ["ws", "http://frontend.example:3100", "http"],
    ]) {
      const { client, status } = await connect(forwarded!, origin!);
      assert.equal(status, 101);
      const echoed = once(client, "message");
      client.send("same-origin-vite-ws");
      const [data] = await echoed;
      assert.equal(data.toString(), "same-origin-vite-ws");
      assert.equal(upstreamHeaders.at(-1)?.host, "frontend.example:3100");
      assert.equal(upstreamHeaders.at(-1)?.["x-forwarded-proto"], expected);
      client.close();
      await once(client, "close");
    }
    assert.equal(
      (await connect("wss", "https://attacker.invalid")).status,
      403,
    );
    assert.equal(
      (await connect("wss", "http://frontend.example:3100")).status,
      403,
    );
    assert.equal(upstreamHeaders.length, 2);
  } finally {
    clients.forEach((client) => client.terminate());
    wss.clients.forEach((ws) => ws.terminate());
    wss.close();
    await fixture.close();
  }
});

test("native WS preserves the measured 1257004-byte initialization message within its bounded budget", async () => {
  const fixture = await setup();
  const wss = new WebSocketServer({ noServer: true });
  fixture.upstream.on("upgrade", (req, socket, head) =>
    wss.handleUpgrade(req, socket, head, (ws) =>
      ws.on("message", (data, binary) => ws.send(data, { binary })),
    ),
  );
  const client = new WebSocket(
    `${fixture.origin.replace("http:", "ws:")}/native-codex/ws`,
  );
  client.on("error", () => {});
  try {
    await once(client, "open");
    const echoed = new Promise<Buffer>((resolve, reject) => {
      client.once("message", (data) => {
        assert.ok(Buffer.isBuffer(data));
        resolve(data);
      });
      client.once("close", (code) =>
        reject(new Error(`initialization closed with ${code}`)),
      );
    });
    client.send(Buffer.alloc(1257004, 0x5a));
    assert.deepEqual(await echoed, Buffer.alloc(1257004, 0x5a));
  } finally {
    client.terminate();
    wss.clients.forEach((ws) => ws.terminate());
    wss.close();
    await fixture.close();
  }
});

test("native WS preserves measured 6541283-byte browser transfer with compressed 256KiB upstream chunks", async () => {
  const fixture = await setup();
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: true });
  fixture.upstream.on("upgrade", (req, socket, head) =>
    wss.handleUpgrade(req, socket, head, (ws) =>
      ws.on("message", (data) => {
        assert.equal(ws.extensions, "permessage-deflate");
        assert.ok(Buffer.isBuffer(data));
        for (let offset = 0; offset < data.byteLength; offset += 256 * 1024)
          ws.send(data.subarray(offset, offset + 256 * 1024));
      }),
    ),
  );
  const client = new WebSocket(
    `${fixture.origin.replace("http:", "ws:")}/native-codex/ws`,
  );
  client.on("error", () => {});
  try {
    await once(client, "open");
    assert.equal(client.extensions, "");
    const source = Buffer.alloc(6541283, 0x6b);
    const echoed = new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      let total = 0;
      client.on("message", (data) => {
        assert.ok(Buffer.isBuffer(data));
        chunks.push(data);
        total += data.length;
        if (total === source.length) resolve(Buffer.concat(chunks));
      });
      client.once("close", (code) =>
        reject(new Error(`file transfer closed with ${code}`)),
      );
    });
    client.send(source);
    assert.deepEqual(await echoed, source);
  } finally {
    client.terminate();
    wss.clients.forEach((ws) => ws.terminate());
    wss.close();
    await fixture.close();
  }
});

test("native upstream independently rejects an over-limit fragmented message with 1009", async () => {
  const fixture = await setup();
  const wss = new WebSocketServer({ noServer: true });
  fixture.upstream.on("upgrade", (req, socket, head) =>
    wss.handleUpgrade(req, socket, head, (ws) =>
      ws.send(Buffer.alloc(NATIVE_CODEX_MAX_UPSTREAM_MESSAGE_BYTES + 1), {
        binary: true,
        fin: false,
      }),
    ),
  );
  const client = new WebSocket(
    `${fixture.origin.replace("http:", "ws:")}/native-codex/ws`,
  );
  client.on("error", () => {});
  try {
    await once(client, "open");
    const [code] = await once(client, "close");
    assert.equal(code, 1009);
  } finally {
    client.terminate();
    wss.clients.forEach((ws) => ws.terminate());
    wss.close();
    await fixture.close();
  }
});

test("native upstream decompression is bounded by its independent message limit", async () => {
  const fixture = await setup();
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: true });
  fixture.upstream.on("upgrade", (req, socket, head) =>
    wss.handleUpgrade(req, socket, head, (ws) => {
      assert.equal(ws.extensions, "permessage-deflate");
      ws.send(Buffer.alloc(NATIVE_CODEX_MAX_UPSTREAM_MESSAGE_BYTES + 1), {
        binary: true,
        fin: false,
        compress: true,
      });
    }),
  );
  const client = new WebSocket(
    `${fixture.origin.replace("http:", "ws:")}/native-codex/ws`,
  );
  client.on("error", () => {});
  try {
    await once(client, "open");
    const [code] = await once(client, "close");
    assert.equal(code, 1009);
  } finally {
    client.terminate();
    wss.clients.forEach((ws) => ws.terminate());
    wss.close();
    await fixture.close();
  }
});
