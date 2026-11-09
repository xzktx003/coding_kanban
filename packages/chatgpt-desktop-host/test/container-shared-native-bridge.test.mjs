import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import vm from "node:vm";
import { isContainerRecoveryQuery } from "../src/container-recovery-wire.mjs";

const require = createRequire(import.meta.url);
const {
  isSharedThreadAuthorityFrame,
} = require("../src/shared-thread-authority-wire.cjs");

test("only an enabled native channel accepts a typed shared response chunk", async () => {
  const source = await readFile(
    new URL("../src/container-native.mjs", import.meta.url),
    "utf8",
  );
  const start = source.indexOf("  let ready = false,");
  const end = source.indexOf(
    "  // Deliberately retain the owned native and IPC;",
    start,
  );
  assert.ok(start >= 0 && end > start);
  const program = `(async () => { ${source.slice(start, end)} })()`;
  for (const [enabled, type] of [
    [true, "shared-rpc-chunk"],
    [false, "shared-rpc-chunk"],
    [true, "shared-event-chunk"],
    [false, "shared-event-chunk"],
  ]) {
    const profileId = randomUUID(),
      generation = randomUUID(),
      requestId = randomUUID();
    const chunk = {
      v: 1,
      type,
      profileId,
      generation,
      requestId,
      sequence: 1,
      final: true,
      data: Buffer.from("fixture").toString("base64"),
      ...(type === "shared-event-chunk"
        ? { attemptId: randomUUID(), binding: { threadId: randomUUID() }, eventId: randomUUID(), deliveryCount: 1 }
        : {}),
    };
    let release;
    const input = new Promise((resolve) => {
      release = resolve;
    });
    const sent = [],
      phases = [],
      listeners = new Map();
    const native = {
      pid: 17,
      connected: true,
      on(type, callback) {
        listeners.set(type, callback);
      },
      send(encoded, callback) {
        sent.push(JSON.parse(encoded));
        callback();
      },
    };
    const processStub = {
      pid: 2,
      stdin: { destroy() {} },
      stdout: { on() {}, write() {} },
    };
    const lines = {
      async *[Symbol.asyncIterator]() {
        yield* await input;
      },
    };
    const promise = vm.runInNewContext(program, {
      native,
      process: processStub,
      lines,
      decodeWireValue: JSON.parse,
      writeFirstCause: (phase) => phases.push(phase),
      isSharedThreadAuthorityFrame,
      isContainerRecoveryQuery,
      profileId,
      generation,
      sharedEnabled: enabled,
      UUID: /^[a-f0-9-]{36}$/,
      MAX: 8 * 1024 * 1024,
      Buffer,
    });
    listeners.get("message")(
      JSON.stringify({ v: 1, type: "ready", profileId, generation, pid: 17 }),
    );
    release([JSON.stringify(chunk)]);
    await promise;
    if (enabled) {
      assert.deepEqual(sent, [chunk]);
      assert.deepEqual(phases, []);
    } else {
      assert.deepEqual(sent, []);
      assert.equal(phases[0], "container_input_frame_invalid");
    }
  }
});

test("native bootstrap delivers the typed chunk only to the enabled shared integration", async () => {
  const source = await readFile(
    new URL("../src/native-bootstrap.cjs", import.meta.url),
    "utf8",
  );
  const match = source.match(
    /process\.on\("message", async encoded => \{[\s\S]*?\n    \}\);/,
  );
  assert.ok(match);
  let chunk = { v: 1, type: "shared-rpc-chunk" };
  const received = [],
    errors = [];
  let handler;
  vm.runInNewContext(match[0], {
    process: {
      on(_type, callback) {
        handler = callback;
      },
    },
    wire: { decodeWireValue: () => chunk },
    sharedThread: { receive: (frame) => received.push(frame) },
    writeFirstCause: (phase) => errors.push(phase),
    firstCauseEnabled: true,
    send() {},
    UUID: /^[a-f0-9-]{36}$/,
  });
  await handler("fixture");
  chunk = { v: 1, type: "shared-event-chunk" };
  await handler("fixture");
  assert.deepEqual(
    received.map((frame) => frame.type),
    ["shared-rpc-chunk", "shared-event-chunk"],
  );
  assert.deepEqual(errors, []);
});
