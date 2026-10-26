import test from "node:test";
import assert from "node:assert/strict";
import { PassThrough, Writable } from "node:stream";
import { mkdtemp, rm, mkdir, symlink, chmod } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import {
  validateLaunchArguments,
  validateBridgeMetadata,
  verifyControlSocket,
  connectStdio,
} from "../refresh-prototype/cli-bridge.mjs";

test("only the captured official CLI launch forms and version query are accepted", () => {
  assert.equal(validateLaunchArguments(["--version"]), "version");
  assert.equal(
    validateLaunchArguments(["app-server", "--analytics-default-enabled"]),
    "connect",
  );
  assert.equal(
    validateLaunchArguments([
      "-c",
      "features.code_mode_host=true",
      "app-server",
      "--analytics-default-enabled",
    ]),
    "connect",
  );
  for (const args of [
    [],
    ["resume", "thread"],
    ["app-server", "--listen", "ws://other"],
    ["-c", 'model="other"', "app-server"],
    ["app-server", "--sock", "/tmp/other"],
    ["app-server", "--analytics-default-enabled", "--enable", "other"],
  ])
    assert.throws(() => validateLaunchArguments(args), /launch/);
});

test("metadata requires the exact official/CLI pair, hashes and a private scoped control socket", () => {
  const metadata = {
    runtimeRoot: "/tmp/refresh-test",
    socketPath: "/tmp/refresh-test/control.sock",
    cliPath: "/tmp/refresh-test/codex",
    officialVsix: "/tmp/refresh-test/original.vsix",
    officialVersion: "26.51007.21434",
    cliVersion: "0.162.0-alpha.17.2",
    cliSha256:
      "73b73b048546993298234a295de01ef2424e7a8b29def9d0ecb1ca7cb77500d4",
    officialVsixSha256:
      "75cee7497cf38c721cfeaa7383b579537b4e4439086f996258705de5da03ad56",
  };
  assert.deepEqual(validateBridgeMetadata(metadata), metadata);
  for (const change of [
    { cliVersion: "0.162.1" },
    { officialVersion: "other" },
    { cliSha256: "0".repeat(64) },
    { socketPath: "/tmp/default.sock" },
    { socketPath: "/tmp/refresh-test/../default.sock" },
    { runtimeRoot: "/tmp/refresh-test\n" },
    { extra: "ignored?" },
  ])
    assert.throws(
      () => validateBridgeMetadata({ ...metadata, ...change }),
      /metadata/,
    );
});

test("native rendezvous is accepted only for the private requested-path hash and 0600 socket", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "refresh-rendezvous-"));
  const requested = join(directory, "control.sock");
  const physicalDirectory = join(directory, "native");
  await mkdir(physicalDirectory, { mode: 0o700 });
  const physical = join(
    physicalDirectory,
    createHash("sha256").update(requested).digest("hex"),
  );
  const server = createServer();
  await new Promise((resolve) => server.listen(physical, resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  await chmod(physical, 0o600);
  await symlink(physical, requested);
  assert.equal(await verifyControlSocket(requested), physical);
  const other = join(directory, "other.sock");
  await symlink(physical, other);
  await assert.rejects(verifyControlSocket(other), /rendezvous/);
  await chmod(physical, 0o666);
  await assert.rejects(verifyControlSocket(requested), /private/);
});

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "refresh-bridge-"));
  const socketPath = join(directory, "control.sock");
  const server = createServer();
  const wss = new WebSocketServer({ server });
  const messages = [];
  wss.on("connection", (ws) =>
    ws.on("message", (bytes) => {
      const value = JSON.parse(bytes.toString());
      messages.push(value);
      ws.send(
        JSON.stringify({
          id: value.id,
          result: { received: value.params, owner: messages.length },
        }),
      );
    }),
  );
  await new Promise((resolve) => server.listen(socketPath, resolve));
  t.after(async () => {
    for (const ws of wss.clients) ws.terminate();
    await new Promise((resolve) => wss.close(resolve));
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  const client = (options = {}) => {
    const input = new PassThrough();
    const output = new PassThrough();
    const lines = [];
    let pending = "";
    output.on("data", (bytes) => {
      pending += bytes.toString();
      const split = pending.split("\n");
      pending = split.pop();
      for (const line of split) lines.push(JSON.parse(line));
    });
    const connection = connectStdio({
      socketPath,
      input,
      output,
      connectTimeoutMs: 1000,
      ...options,
    });
    return { input, output, lines, connection };
  };
  return { server, wss, messages, client, socketPath };
}
async function until(predicate) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail("protocol observation timed out");
}

test("native client lifetime authority guards the actual transport including initialized and subsequent writes", async (t) => {
  const { createNativeClient } =
    await import("../refresh-prototype/native-client.mjs");
  const f = await fixture(t);
  let checks = 0,
    valid = true;
  const client = createNativeClient({
    socketPath: f.socketPath,
    timeoutMs: 1000,
    beforeSend() {
      checks++;
      if (!valid)
        throw Object.assign(Error("authority revoked"), {
          code: "NATIVE_NOT_SENT",
        });
    },
  });
  t.after(() => client.close());
  await client.ready;
  await until(() => f.messages.some((m) => m.method === "initialized"));
  valid = false;
  await assert.rejects(
    client.request("turn/start", { input: "never forwarded" }),
    { code: "NATIVE_CONNECTION_LOST" },
  );
  assert.equal(checks, 3);
  assert.deepEqual(
    f.messages.map((m) => m.method),
    ["initialize", "initialized"],
  );
});
test("a per-request eviction guard rechecks after the transport's lifetime guard at the actual write", async (t) => {
  const { createNativeClient } =
      await import("../refresh-prototype/native-client.mjs"),
    f = await fixture(t);
  let armed = false,
    visible = false;
  const client = createNativeClient({
    socketPath: f.socketPath,
    beforeSend() {
      if (armed) visible = true;
    },
  });
  t.after(() => client.close());
  await client.ready;
  await until(() => f.messages.some((m) => m.method === "initialized"));
  armed = true;
  await assert.rejects(
    client.request(
      "thread/unsubscribe",
      { threadId: "not-forwarded" },
      {
        beforeSend() {
          if (visible) throw Error("consumer became visible");
        },
      },
    ),
  );
  assert.equal(
    f.messages.some((m) => m.method === "thread/unsubscribe"),
    false,
  );
  armed = false;
  assert.equal(
    (await client.request("account/read", { refreshToken: false })).received
      .refreshToken,
    false,
  );
});

test("fragmented UTF8 JSONL and reused IDs on separate connections retain their exact owner", async (t) => {
  const { client, messages } = await fixture(t);
  const a = client();
  const b = client();
  await Promise.all([a.connection.ready, b.connection.ready]);
  const bytes = Buffer.from(
    JSON.stringify({
      id: 1,
      method: "initialize",
      params: { text: "中文\n独立客户端" },
    }) + "\n",
  );
  const split = bytes.indexOf(Buffer.from("中文")) + 1;
  a.input.write(bytes.subarray(0, split));
  a.input.write(bytes.subarray(split));
  b.input.write(
    JSON.stringify({ id: 1, method: "initialize", params: { text: "B" } }) +
      "\n",
  );
  await until(() => a.lines.length === 1 && b.lines.length === 1);
  assert.equal(a.lines[0].id, 1);
  assert.equal(a.lines[0].result.received.text, "中文\n独立客户端");
  assert.equal(b.lines[0].id, 1);
  assert.equal(b.lines[0].result.received.text, "B");
  assert.equal(messages.length, 2);
  a.input.end();
  b.input.end();
  await Promise.all([a.connection.done, b.connection.done]);
});

test("native authority is rechecked after transport open before any pending initialize is forwarded", async (t) => {
  const { client, messages } = await fixture(t);
  let release,
    entered = false;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  const a = client({
    beforeReady: async () => {
      entered = true;
      await held;
    },
  });
  try {
    a.input.write('{"id":1,"method":"initialize","params":{"owner":"A"}}\n');
    await until(() => entered || messages.length > 0);
    assert.equal(entered, true);
    assert.equal(messages.length, 0);
    release();
    await a.connection.ready;
    await until(() => a.lines.length === 1);
    assert.equal(a.lines[0].result.received.owner, "A");
  } finally {
    release();
    a.connection.close();
    await a.connection.done.catch(() => {});
  }
});
test("authority is rechecked at every actual wire send including multiple JSONL messages in one chunk", async (t) => {
  const { client, messages } = await fixture(t);
  let valid = true,
    checks = 0;
  const a = client({
    beforeSend() {
      checks++;
      if (!valid) throw Error("authorization revoked");
    },
    onProtocol(event) {
      if (event.direction === "request" && event.method === "turn/start")
        valid = false;
    },
  });
  await a.connection.ready;
  a.input.write(
    '{"id":1,"method":"initialize"}\n{"id":2,"method":"turn/start","params":{"input":"never sent"}}\n',
  );
  await assert.rejects(a.connection.done, /authorization revoked/);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(checks, 2);
  assert.deepEqual(
    messages.map((value) => value.method),
    ["initialize"],
  );
});
test("a pending asynchronous send guard cannot authorize a native write", async (t) => {
  const { client, messages } = await fixture(t);
  const a = client({ beforeSend: () => Promise.resolve() });
  let result;
  a.connection.done.then(
    () => (result = "closed"),
    () => (result = "failed"),
  );
  try {
    await a.connection.ready;
    a.input.write('{"id":1,"method":"initialize"}\n');
    await until(() => result || messages.length > 0);
    assert.equal(result, "failed");
    assert.equal(messages.length, 0);
  } finally {
    a.connection.close();
    await a.connection.done.catch(() => {});
  }
});

test("a changed native authority rejects only that client before initialize or replay", async (t) => {
  const { client, messages } = await fixture(t);
  const a = client({
    beforeReady: async () => {
      throw Error("native generation changed");
    },
  });
  const b = client();
  try {
    a.input.write('{"id":1,"method":"initialize","params":{"owner":"A"}}\n');
    await assert.rejects(a.connection.ready, /generation changed/);
    await assert.rejects(a.connection.done, /generation changed/);
    await b.connection.ready;
    b.input.write('{"id":1,"method":"initialize","params":{"owner":"B"}}\n');
    await until(() => b.lines.length === 1);
    assert.deepEqual(
      messages.map((value) => value.params.owner),
      ["B"],
    );
  } finally {
    a.connection.close();
    b.connection.close();
    await Promise.allSettled([a.connection.done, b.connection.done]);
  }
});

test("an unresponsive admission check has a bounded deadline and cannot later forward queued input", async (t) => {
  const { client, messages } = await fixture(t);
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  const a = client({ connectTimeoutMs: 100, beforeReady: () => held });
  try {
    a.input.write('{"id":1,"method":"initialize"}\n');
    await assert.rejects(a.connection.ready, /admission.*timed out/);
    await assert.rejects(a.connection.done, /admission.*timed out/);
    release();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(messages.length, 0);
  } finally {
    release();
    a.connection.close();
    await a.connection.done.catch(() => {});
  }
});

test("aborting while native admission is pending settles ready and ignores its late completion", async (t) => {
  const { client, messages } = await fixture(t);
  let release,
    entered = false;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  const controller = new AbortController();
  const a = client({
    signal: controller.signal,
    beforeReady: async () => {
      entered = true;
      await held;
    },
  });
  let timer;
  try {
    a.input.write('{"id":1,"method":"initialize"}\n');
    await until(() => entered);
    const ready = a.connection.ready.then(
      () => "ready",
      () => "rejected",
    );
    controller.abort();
    await a.connection.done;
    const result = await Promise.race([
      ready,
      new Promise((resolve) => {
        timer = setTimeout(() => resolve("pending"), 200);
      }),
    ]);
    release();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(result, "rejected");
    assert.equal(messages.length, 0);
  } finally {
    clearTimeout(timer);
    release();
    a.connection.close();
    await a.connection.done.catch(() => {});
  }
});

test("EOF disconnects just one client, with no backend shutdown or request replay", async (t) => {
  const { client, wss } = await fixture(t);
  const a = client();
  const b = client();
  await Promise.all([a.connection.ready, b.connection.ready]);
  a.input.end();
  await a.connection.done;
  assert.equal(wss.clients.size, 1);
  b.input.write('{"id":1,"method":"thread/read","params":{"threadId":"B"}}\n');
  await until(() => b.lines.length === 1);
  assert.equal(b.lines[0].result.received.threadId, "B");
  b.input.end();
  await b.connection.done;
});

for (const mode of ["EOF", "abort"])
  test(`${mode} closes a backpressured private connection without waiting for stdout drain`, async (t) => {
    const { client, wss } = await fixture(t);
    const output = new Writable({ highWaterMark: 1, write() {} });
    const a = client({ output });
    await a.connection.ready;
    [...wss.clients][0].send('{"method":"notification"}');
    await until(() => output.writableLength > 0);
    if (mode === "EOF") a.input.end();
    else a.connection.close();
    let timer;
    const closed = await Promise.race([
      a.connection.done.then(() => true),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(false), 400);
      }),
    ]);
    clearTimeout(timer);
    // Release the paused reader on the unfixed implementation so the failure
    // cannot leave this test waiting for the ws library's 30-second timeout.
    if (!closed) output.emit("drain");
    await a.connection.done;
    output.destroy();
    assert.equal(closed, true);
  });

test("oversized, malformed and incomplete input closes the private client without sending it", async (t) => {
  const { client, messages } = await fixture(t);
  for (const text of ["x".repeat(8 * 1024 * 1024 + 1), "{bad}\n", '{"id":1']) {
    const a = client();
    await a.connection.ready;
    a.input.end(text);
    await assert.rejects(a.connection.done, /JSONL|limit/);
  }
  assert.equal(messages.length, 0);
});

test("oversized upstream frames fail instead of raising the existing 2 MiB budget", async (t) => {
  const { client, wss } = await fixture(t);
  const a = client();
  await a.connection.ready;
  [...wss.clients][0].send(
    JSON.stringify({
      method: "large",
      params: { text: "x".repeat(2 * 1024 * 1024) },
    }),
  );
  await assert.rejects(a.connection.done, /limit|payload/i);
  assert.equal(a.lines.length, 0);
});

test("protocol measurements contain bounded identifiers and counts without retaining message bodies", async (t) => {
  const { client } = await fixture(t);
  const measurements = [];
  const a = client({ onProtocol: (entry) => measurements.push(entry) });
  await a.connection.ready;
  const id = "client-" + "x".repeat(400);
  a.input.write(
    JSON.stringify({
      id,
      method: "initialize",
      params: { text: "PRIVATE_BODY" },
    }) + "\n",
  );
  await until(() => a.lines.length === 1);
  assert.equal(a.lines[0].id, id); // Diagnostic truncation cannot alter protocol IDs.
  assert.equal(a.lines[0].result.received.text, "PRIVATE_BODY");
  assert.equal(measurements.length, 2);
  assert.ok(
    measurements.every(
      (entry) =>
        typeof entry.id === "string" &&
        entry.id.length <= 128 &&
        entry.bytes > 0,
    ),
  );
  assert.equal(JSON.stringify(measurements).includes("PRIVATE_BODY"), false);
  a.input.end();
  await a.connection.done;
});

test("protocol diagnostics correlate exact turn identities without exposing payloads or changing the wire", async (t) => {
  const { client, wss } = await fixture(t);
  const observations = [];
  const a = client({ onProtocol: (e) => observations.push(e) });
  await a.connection.ready;
  const threadId = "019aabcd-1234-7890-abcd-0123456789ab";
  const turnId = "019aabcd-1234-7890-abcd-0123456789ac";
  const request = {
    id: 1,
    method: "turn/start",
    params: { threadId, input: [{ text: "PRIVATE_INPUT" }] },
  };
  a.input.write(JSON.stringify(request) + "\n");
  await until(() => a.lines.length === 1);
  const reply = {
    id: 2,
    result: {
      turn: {
        id: turnId,
        status: "inProgress",
        items: [{ text: "PRIVATE_OUTPUT" }],
      },
    },
  };
  const completed = {
    method: "turn/completed",
    params: {
      threadId,
      turn: {
        id: turnId,
        status: "completed",
        items: [{ text: "PRIVATE_OUTPUT" }],
      },
    },
  };
  [...wss.clients][0].send(JSON.stringify(reply));
  [...wss.clients][0].send(JSON.stringify(completed));
  await until(() => a.lines.length === 3);
  assert.deepEqual(a.lines[1], reply);
  assert.deepEqual(a.lines[2], completed);
  assert.equal(observations[0].threadId, threadId);
  assert.equal(observations[2].turnId, turnId);
  assert.equal(observations[3].turnId, turnId);
  assert.equal(observations[3].threadId, threadId);
  assert.equal(observations[2].turnStatus, "inProgress");
  assert.equal(observations[3].turnStatus, "completed");
  assert.doesNotMatch(
    JSON.stringify(observations),
    /PRIVATE_INPUT|PRIVATE_OUTPUT|items|params|result/,
  );
  a.input.end();
  await a.connection.done;
});

test("diagnostic turn identities reject coercion, oversized strings and unknown status values", async (t) => {
  const { client, wss } = await fixture(t);
  const observations = [];
  const a = client({ onProtocol: (e) => observations.push(e) });
  await a.connection.ready;
  for (const [turnId, status] of [
    [["019aabcd-1234-7890-abcd-0123456789ac"], "completed"],
    ["x".repeat(100000), "PRIVATE_STATUS"],
    [42, "completed"],
  ])
    [...wss.clients][0].send(
      JSON.stringify({
        method: "turn/completed",
        params: {
          threadId: ["019aabcd-1234-7890-abcd-0123456789ab"],
          turn: { id: turnId, status },
        },
      }),
    );
  await until(() => a.lines.length === 3);
  for (const event of observations) {
    assert.equal(event.threadId, undefined);
    assert.equal(event.turnId, undefined);
  }
  assert.equal(observations[1].turnStatus, undefined);
  assert.ok(JSON.stringify(observations).length < 2048);
  a.input.end();
  await a.connection.done;
});

test("artifact validation runs before native execution and does not require an already listening service", async (t) => {
  const { verifyNativeArtifacts } =
    await import("../refresh-prototype/cli-bridge.mjs");
  const { writeFile, access } = await import("node:fs/promises");
  const root = await mkdtemp(join(tmpdir(), "refresh-artifacts-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const proof = join(root, "must-not-execute");
  const cliPath = join(root, "codex");
  await writeFile(cliPath, "#!/bin/sh\ntouch " + proof + "\n", { mode: 0o700 });
  const officialVsix = join(root, "official.vsix");
  await writeFile(officialVsix, "invalid archive");
  await assert.rejects(
    verifyNativeArtifacts({
      runtimeRoot: root,
      socketPath: join(root, "not-yet-listening.sock"),
      cliPath,
      officialVsix,
      officialVersion: "26.51007.21434",
      cliVersion: "0.162.0-alpha.17.2",
      cliSha256:
        "73b73b048546993298234a295de01ef2424e7a8b29def9d0ecb1ca7cb77500d4",
      officialVsixSha256:
        "75cee7497cf38c721cfeaa7383b579537b4e4439086f996258705de5da03ad56",
    }),
    /hash mismatch/,
  );
  await assert.rejects(access(proof));
});
