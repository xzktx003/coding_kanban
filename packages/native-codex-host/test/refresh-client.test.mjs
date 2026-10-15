import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { createNativeClient } from "../refresh-prototype/native-client.mjs";

async function fixture(t, handler) {
  const root = await mkdtemp(join(tmpdir(), "ck-client-"));
  const socketPath = join(root, "control.sock");
  const server = createServer(),
    wss = new WebSocketServer({ server });
  const received = [];
  wss.on("connection", (socket) =>
    socket.on("message", (bytes) => {
      const value = JSON.parse(bytes.toString());
      received.push(value);
      if (handler?.(socket, value) === true) return;
      if (value.method === "initialize")
        socket.send(
          JSON.stringify({ id: value.id, result: { userAgent: "test" } }),
        );
      else if (value.id !== undefined && value.method)
        socket.send(JSON.stringify({ id: value.id, result: {} }));
    }),
  );
  await new Promise((resolve) => server.listen(socketPath, resolve));
  t.after(async () => {
    for (const socket of wss.clients) socket.terminate();
    await new Promise((resolve) => wss.close(resolve));
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  });
  return { socketPath, wss, received };
}
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("retains exact native request, opaque turn and item identities while excluding bodies", async (t) => {
  const f = await fixture(t);
  const events = [];
  const client = createNativeClient({
    socketPath: f.socketPath,
    onLifecycle: (event) => events.push(event),
  });
  await client.ready;
  const threadId = "019aabcd-1234-7890-abcd-0123456789ab";
  [...f.wss.clients][0].send(
    JSON.stringify({
      id: 1,
      method: "item/commandExecution/requestApproval",
      params: {
        threadId,
        turnId: "turn-opaque/7",
        itemId: "item-opaque",
        command: "PRIVATE_TOOL_BODY",
      },
    }),
  );
  for (let i = 0; !events.length && i < 100; i++) await delay(5);
  assert.deepEqual(events[0], {
    method: "item/commandExecution/requestApproval",
    requestId: 1,
    threadId,
    turnId: "turn-opaque/7",
    itemId: "item-opaque",
    status: null,
  });
  assert.equal(JSON.stringify(events).includes("PRIVATE_TOOL_BODY"), false);
  client.reply(events[0].requestId, { decision: "accept" });
  await client.close();
  assert.ok(
    f.received.some(
      (message) => message.id === 1 && message.result?.decision === "accept",
    ),
  );
});

test("timeout is uncertain and never replays; close rejects pending work without closing another connection", async (t) => {
  const f = await fixture(
    t,
    (_socket, value) =>
      value.method === "turn/start" || value.method === "thread/read",
  );
  const a = createNativeClient({
    socketPath: f.socketPath,
    timeoutMs: 30,
    maxPending: 1,
  });
  const b = createNativeClient({ socketPath: f.socketPath });
  await Promise.all([a.ready, b.ready]);
  await assert.rejects(a.request("turn/start", {}), {
    code: "NATIVE_RECEIPT_UNKNOWN",
  });
  await delay(50);
  assert.equal(
    f.received.filter((message) => message.method === "turn/start").length,
    1,
  );
  const pending = a.request("thread/read", {});
  const rejected = assert.rejects(pending, { code: "NATIVE_CONNECTION_LOST" });
  await delay(1);
  await assert.rejects(a.request("thread/read", {}), /pending request limit/);
  await a.close();
  await rejected;
  assert.deepEqual(await b.request("thread/loaded/list", {}), {});
  await b.close();
});

test("cleanup after an oversized native notification preserves the failure receipt without throwing or replaying pending work", async (t) => {
  const f = await fixture(t, (_socket, value) => value.method === "turn/start");
  const a = createNativeClient({ socketPath: f.socketPath });
  await a.ready;
  const first = [...f.wss.clients][0];
  const b = createNativeClient({ socketPath: f.socketPath });
  await b.ready;
  t.after(() => b.close());
  const pending = a.request("turn/start", {});
  const rejected = assert.rejects(pending, { code: "NATIVE_CONNECTION_LOST" });
  await delay(5);
  let transportFailure;
  const failed = assert.rejects(a.closed, (error) => {
    transportFailure = error;
    return /payload limit/.test(error.message);
  });
  first.send(
    JSON.stringify({
      method: "app/list/updated",
      params: { data: "x".repeat(2 * 1024 * 1024) },
    }),
  );
  await failed;
  assert.equal(transportFailure.code, "NATIVE_OUTPUT_LIMIT");
  assert.equal(transportFailure.nativeOutputLimit.method, "app/list/updated");
  assert.ok(transportFailure.nativeOutputLimit.declaredBytes > 2 * 1024 * 1024);
  assert.equal(transportFailure.nativeOutputLimit.limitBytes, 2 * 1024 * 1024);
  await rejected;
  await a.close();
  await a.close();
  assert.deepEqual(await b.request("thread/loaded/list", {}), {});
  assert.equal(
    f.received.filter((value) => value.method === "turn/start").length,
    1,
  );
});

test("oversized native diagnostics never attribute a nested payload method or retain its body", async (t) => {
  const f = await fixture(t);
  const client = createNativeClient({ socketPath: f.socketPath });
  await client.ready;
  const failed = assert.rejects(client.closed, (error) => {
    assert.equal(error.code, "NATIVE_OUTPUT_LIMIT");
    assert.equal(error.nativeOutputLimit.method, null);
    assert.equal(JSON.stringify(error).includes("PRIVATE_BODY"), false);
    return true;
  });
  [...f.wss.clients][0].send(
    JSON.stringify({
      params: { method: "PRIVATE_BODY", data: "x".repeat(2 * 1024 * 1024) },
      method: "app/list/updated",
    }),
  );
  await failed;
  await client.close();
});

test("failed initialize closes only its own connection instead of retaining an unusable client", async (t) => {
  const f = await fixture(t, (socket, value) => {
    if (value.method !== "initialize") return false;
    socket.send(
      JSON.stringify({
        id: value.id,
        error: { code: -32600, message: "unsupported" },
      }),
    );
    return true;
  });
  const client = createNativeClient({ socketPath: f.socketPath });
  await assert.rejects(client.ready, { code: -32600 });
  let timer;
  const closed = await Promise.race([
    client.closed.then(() => true),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(false), 100);
    }),
  ]);
  clearTimeout(timer);
  if (!closed) await client.close();
  assert.equal(closed, true);
});

test("resolved server request keeps its exact identity and a changed lifecycle vetoes a queued write", async (t) => {
  const f = await fixture(t),
    events = [];
  const client = createNativeClient({
    socketPath: f.socketPath,
    onLifecycle: (event) => events.push(event),
  });
  await client.ready;
  const before = client.revision;
  [...f.wss.clients][0].send(
    JSON.stringify({
      method: "serverRequest/resolved",
      params: {
        threadId: "019aabcd-1234-7890-abcd-0123456789ab",
        requestId: "native-request/9",
      },
    }),
  );
  for (let i = 0; !events.length && i < 100; i++) await delay(5);
  assert.equal(events[0].requestId, "native-request/9");
  assert.ok(client.revision > before);
  await assert.rejects(
    client.request(
      "thread/unsubscribe",
      {},
      {
        beforeSend() {
          throw Object.assign(Error("Changed lifecycle"), {
            code: "NATIVE_NOT_SENT",
          });
        },
      },
    ),
    { code: "NATIVE_NOT_SENT" },
  );
  assert.equal(
    f.received.some((message) => message.method === "thread/unsubscribe"),
    false,
  );
  await client.close();
});
test("authorization notifications fence queued writes without retaining account payloads or treating rate limits as account changes", async (t) => {
  const f = await fixture(t),
    events = [];
  const client = createNativeClient({
    socketPath: f.socketPath,
    onLifecycle: (event) => events.push(event),
  });
  t.after(() => client.close().catch(() => {}));
  await client.ready;
  const socket = [...f.wss.clients][0];
  let count = 0;
  for (const method of [
    "account/rateLimits/updated",
    "account/updated",
    "account/login/completed",
    "account/gatewayOAuth/changed",
  ]) {
    const revision = client.revision;
    socket.send(
      JSON.stringify({
        method,
        params: {
          account: { email: "PRIVATE_ACCOUNT", accessToken: "PRIVATE_TOKEN" },
        },
      }),
    );
    count++;
    for (let i = 0; events.length < count && i < 100; i++) await delay(5);
    assert.equal(events.length, count);
    assert.equal(
      client.revision,
      revision + Number(method !== "account/rateLimits/updated"),
    );
    if (method !== "account/rateLimits/updated")
      await assert.rejects(
        client.request(
          "thread/unsubscribe",
          {},
          {
            beforeSend() {
              if (client.revision !== revision)
                throw Error("Authorization changed");
            },
          },
        ),
        /Authorization changed/,
      );
  }
  assert.equal(JSON.stringify(events).includes("PRIVATE_ACCOUNT"), false);
  assert.equal(JSON.stringify(events).includes("PRIVATE_TOKEN"), false);
  assert.equal(
    f.received.some((value) => value.method === "thread/unsubscribe"),
    false,
  );
  await client.close();
});
