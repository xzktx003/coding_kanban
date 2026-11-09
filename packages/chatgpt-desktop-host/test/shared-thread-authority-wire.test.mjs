import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { createSharedDaemonRpcGate } from "../src/shared-daemon-rpc-gate.mjs";
const require = createRequire(import.meta.url);
const {
  createSharedThreadAuthorityWire,
  isSharedThreadAuthorityFrame,
} = require("../src/shared-thread-authority-wire.cjs");
const {
  createSharedThreadAuthorityClient,
  createSharedThreadAuthorityServer,
} = require("../src/shared-thread-authority-channel.cjs");

test("typed wire multiplexing preserves authorize, cancel and dispatch ordering", async (t) => {
  const profileId = randomUUID(),
    generation = randomUUID(),
    viewId = randomUUID(),
    threadId = randomUUID(),
    daemonGeneration = randomUUID(),
    clientId = randomUUID(),
    writes = [],
    types = [];
  let native, host;
  native = createSharedThreadAuthorityWire({
    side: "native",
    sendFrame: (frame) => {
      types.push(frame.type);
      host.receive(frame);
    },
  });
  host = createSharedThreadAuthorityWire({
    side: "host",
    sendFrame: (frame) => native.receive(frame),
  });
  const gate = createSharedDaemonRpcGate({
    verifyReadSync: () => true,
    verifyBindingSync: () => true,
    verifyHistorySync: () => true,
    write: (text) => writes.push(JSON.parse(text)),
  });
  const authority = createSharedThreadAuthorityServer({
    socket: host.stream,
    profileId,
    generation,
    resolveBinding: async ({ hostId, threadId, viewId }) => ({
      hostId,
      threadId,
      viewId,
      runtimeGeneration: generation,
      daemonGeneration,
      clientId,
      projectId: "test",
      accountRevision: 1,
    }),
    verifyBindingSync: () => true,
    verifyViewSync: () => true,
    gate,
  });
  const client = createSharedThreadAuthorityClient({
    socket: native.stream,
    profileId,
    generation,
  });
  t.after(() => {
    client.close();
    authority.close();
    native.close();
    host.close();
  });
  const binding = await client.resolveBinding({
      viewId,
      hostId: "local",
      threadId,
    }),
    controller = new AbortController(),
    attemptId = randomUUID();
  const frame = {
    id: `thread/resume:${randomUUID()}`,
    method: "thread/resume",
    params: { threadId, excludeTurns: true },
  };
  assert.equal(
    await client.authorizeRequest(binding, frame, {
      attemptId,
      signal: controller.signal,
      deadline: performance.now() + 5000,
    }),
    true,
  );
  controller.abort();
  assert.equal(await client.dispatchRequest(frame), false);
  assert.deepEqual(types, [
    "shared-authorize",
    "shared-authorize",
    "shared-cancel",
    "shared-dispatch",
  ]);
  assert.equal(writes.length, 0);
});

test("the wire admits only fixed authority types in the correct direction", async () => {
  let calls = 0;
  const wire = createSharedThreadAuthorityWire({
    side: "native",
    sendFrame: () => {
      calls++;
    },
  });
  assert.throws(() => wire.receive({ v: 1, type: "shared-dispatch" }), {
    code: "SHARED_AUTHORITY_WIRE_INVALID",
  });
  await new Promise((resolve) =>
    wire.stream.write(
      Buffer.from('{"v":1,"type":"run-command"}\n'),
      (error) => {
        assert.ok(error);
        resolve();
      },
    ),
  );
  assert.equal(calls, 0);
  wire.close();
});

test("shared event copies carry an exact bounded daemon-event identity", () => {
  const profileId = randomUUID(), generation = randomUUID();
  const event = { v: 1, type: "shared-event-chunk", profileId, generation,
    requestId: randomUUID(), sequence: 1, final: true, data: "YQ==",
    attemptId: randomUUID(), binding: {}, eventId: randomUUID(), deliveryCount: 2 };
  const scope = { side: "host", profileId, generation };
  assert.equal(isSharedThreadAuthorityFrame(event, scope), true);
  for (const bad of [
    { ...event, eventId: "" }, { ...event, deliveryCount: 0 },
    { ...event, deliveryCount: 33 }, { ...event, deliveryCount: 1.5 },
    { ...event, eventId: randomUUID(), extra: true },
  ]) assert.equal(isSharedThreadAuthorityFrame(bad, scope), false);
});

test("container relay admits only exact generation-bound authority envelopes", () => {
  const profileId = randomUUID(),
    generation = randomUUID(),
    requestId = randomUUID(),
    attemptId = randomUUID(),
    viewId = randomUUID(),
    threadId = randomUUID();
  const binding = {
    v: 1,
    type: "shared-authorize",
    profileId,
    generation,
    requestId,
    operation: "bind",
    viewId,
    threadId,
    hostId: "local",
  };
  const cancel = {
    v: 1,
    type: "shared-cancel",
    profileId,
    generation,
    attemptId,
  };
  const reply = {
    v: 1,
    type: "shared-reply",
    profileId,
    generation,
    requestId,
    ok: false,
    code: "denied",
  };
  assert.equal(
    isSharedThreadAuthorityFrame(binding, {
      side: "native",
      profileId,
      generation,
    }),
    true,
  );
  assert.equal(
    isSharedThreadAuthorityFrame(cancel, {
      side: "native",
      profileId,
      generation,
    }),
    true,
  );
  assert.equal(
    isSharedThreadAuthorityFrame(reply, {
      side: "host",
      profileId,
      generation,
    }),
    true,
  );
  for (const bad of [
    { ...binding, generation: randomUUID() },
    { ...cancel, command: "ignored" },
    { ...reply, type: "shared-dispatch" },
    { ...binding, operation: "run-command" },
    { ...reply, code: "unknown", command: "oops" },
  ])
    assert.equal(
      isSharedThreadAuthorityFrame(bad, {
        side: bad.type === "shared-reply" ? "host" : "native",
        profileId,
        generation,
      }),
      false,
    );
  assert.equal(
    isSharedThreadAuthorityFrame(reply, {
      side: "native",
      profileId,
      generation,
    }),
    false,
  );
});

test("exchange and response chunks use only bounded typed envelopes on their respective side", () => {
  const profileId = randomUUID(),
    generation = randomUUID(),
    requestId = randomUUID();
  const exchange = {
    v: 1,
    type: "shared-exchange",
    profileId,
    generation,
    requestId,
    frame: {
      id: "read:1",
      method: "thread/read",
      params: { threadId: randomUUID(), includeTurns: false },
    },
  };
  const chunk = {
    v: 1,
    type: "shared-rpc-chunk",
    profileId,
    generation,
    requestId,
    sequence: 1,
    final: true,
    data: Buffer.from("private fixture").toString("base64"),
  };
  const ack = {
    v: 1,
    type: "shared-rpc-ack",
    profileId,
    generation,
    requestId,
    sequence: 1,
  };
  const valid = (value, side) =>
    isSharedThreadAuthorityFrame(value, { side, profileId, generation });
  assert.equal(valid(exchange, "native"), true);
  assert.equal(valid(chunk, "host"), true);
  assert.equal(valid(ack, "native"), true);
  for (const [value, side] of [
    [exchange, "host"],
    [chunk, "native"],
    [ack, "host"],
    [{ ...chunk, sequence: 0 }, "host"],
    [{ ...chunk, generation: randomUUID() }, "host"],
    [{ ...chunk, data: "A".repeat(43693) }, "host"],
    [{ ...chunk, command: "unexpected" }, "host"],
    [{ ...ack, sequence: 0 }, "native"],
    [{ ...exchange, socketPath: "/tmp/ignored" }, "native"],
  ])
    assert.equal(valid(value, side), false);
});

test("approval frames permit only the fixed scoped native-to-host envelope", () => {
  const profileId = randomUUID(),
    generation = randomUUID();
  const frame = {
    v: 1,
    type: "shared-approval",
    profileId,
    generation,
    requestId: randomUUID(),
    binding: {
      hostId: "local",
      runtimeGeneration: generation,
      daemonGeneration: randomUUID(),
      accountRevision: 1,
      projectId: "fixture",
      threadId: randomUUID(),
      viewId: randomUUID(),
      clientId: randomUUID(),
    },
    attemptId: randomUUID(),
    actionId: randomUUID(),
    approvalRequestId: 1,
    turnId: randomUUID(),
    itemId: "item",
    method: "item/commandExecution/requestApproval",
    decision: "decline",
    deadlineMono: 1000,
  };
  const valid = (value, side = "native") =>
    isSharedThreadAuthorityFrame(value, { side, profileId, generation });
  assert.equal(valid(frame), true);
  assert.equal(
    valid({ ...frame, method: "item/fileChange/requestApproval" }),
    true,
  );
  for (const value of [
    { ...frame, method: "turn/start" },
    { ...frame, method: "item/tool/requestUserInput" },
    { ...frame, attemptId: randomUUID().toUpperCase() },
    { ...frame, generation: randomUUID() },
    { ...frame, approvalRequestId: -1 },
    { ...frame, turnId: "" },
    { ...frame, itemId: "" },
    { ...frame, deadlineMono: 1.5 },
    { ...frame, socketPath: "/tmp/other" },
    { ...frame, command: "other" },
  ])
    assert.equal(valid(value), false);
  assert.equal(valid(frame, "host"), false);
});
