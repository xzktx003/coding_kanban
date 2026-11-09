import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { EventEmitter, once } from "node:events";
import { fork, spawn } from "node:child_process";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createConnection, Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { createDesktopControlService } from "../src/control-service.mjs";
import { connectDesktopControl, readDesktopProjectPersistence } from "../src/control-client.mjs";
import { decodeWireValue, encodeWireValue } from "../src/wire-value.mjs";
import { parseJsonLines } from "../src/json-lines.mjs";
import * as containerService from "../src/container-service.mjs";

const consumeContainerOutput =
  containerService.consumeContainerOutput ??
  (async (source, receive) => {
    for await (const encoded of source) receive(encoded);
  });

const LIMIT = 8 * 1024 * 1024;
function fakeUpstream(profile) {
  const listeners = new Set(),
    sent = [],
    events = new EventEmitter();
  const scope = (viewId) => ({
    profileId: profile.id,
    generation: profile.generation,
    viewId,
  });
  let onSend = async () => {},
    unsubscribes = 0,
    autoCloseAck = true;
  const api = {
    sent,
    async send(encoded, control) {
      assert.equal(typeof encoded, "string");
      if (api.explicitDispatch === true && control) control.onDispatch();
      const message = decodeWireValue(encoded);
      sent.push(message);
      events.emit("sent");
      await onSend(message);
      if (message.type === "createView")
        queueMicrotask(() =>
          api.emit({
            v: 1,
            type: "bootstrap",
            scope: scope(message.viewId),
            bootstrap: {
              windowType: "electron",
              getters: {},
              sharedObjects: {},
            },
          }),
        );
      if (message.type === "destroyView" && autoCloseAck)
        queueMicrotask(() =>
          api.emit({ v: 1, type: "viewClosed", scope: scope(message.viewId) }),
        );
    },
    subscribe(handler) {
      listeners.add(handler);
      return () => {
        if (listeners.delete(handler)) unsubscribes++;
      };
    },
    emit(value) {
      const encoded =
        typeof value === "string" ? value : encodeWireValue(value);
      return Promise.all([...listeners].map((handler) => handler(encoded)));
    },
    setSend(value) {
      onSend = value;
    },
    setCloseAck(value) {
      autoCloseAck = value;
    },
    get listeners() {
      return listeners.size;
    },
    get unsubscribes() {
      return unsubscribes;
    },
    async waitFor(predicate) {
      const timeout = Date.now() + 2000;
      while (!predicate(sent)) {
        if (Date.now() > timeout) throw new Error("upstream event timeout");
        await delay(5);
      }
    },
  };
  return api;
}
function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function waitUntil(predicate) {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("condition timeout");
    await delay(5);
  }
}
async function fixture(t, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), "desktop-broker-"));
  await chmod(dir, 0o700);
  let service;
  t.after(async () => {
    await service?.close().catch((error) => {
      if (
        !["CONTROL_SOCKET_REPLACED", "CONTROL_OUTCOME_UNKNOWN"].includes(
          error.code,
        )
      )
        throw error;
    });
    await rm(dir, { recursive: true, force: true });
  });
  const profile = {
    id: randomUUID(),
    generation: randomUUID(),
    pid: process.pid,
    startTicks: "12345",
    controlSocketPath: join(dir, "control.sock"),
  };
  const upstream = fakeUpstream(profile);
  let valid = true;
  service = await createDesktopControlService({
    socketPath: profile.controlSocketPath,
    profileId: profile.id,
    generation: profile.generation,
    pid: profile.pid,
    startTicks: profile.startTicks,
    upstream,
    verifyIdentity: async () => valid,
    ...options,
  });
  const connect = (viewId = randomUUID()) =>
    connectDesktopControl({
      profile,
      viewId,
      verifyProfile: async () => true,
      timeoutMs: 1500,
    });
  return {
    dir,
    profile,
    upstream,
    service,
    connect,
    setValid: (value) => {
      valid = value;
    },
  };
}

test("hello-only metadata reports only the current bounded project persistence state", async (t) => {
  let state = "waiting";
  const f = await fixture(t, { getProjectPersistenceStatus: () => state });
  const read = () => readDesktopProjectPersistence({ profile: f.profile, verifyProfile: async () => true, timeoutMs: 1500 });
  assert.equal(await read(), "waiting");
  state = "unsupported";
  assert.equal(await read(), "unsupported");
  state = "/private/anything";
  assert.equal(await read(), "unknown");
  assert.equal(f.upstream.sent.length, 0);
});
async function rawConnection(f, viewId = randomUUID()) {
  const socket = createConnection(f.profile.controlSocketPath);
  socket.on("error", () => {});
  await once(socket, "connect");
  const lines = parseJsonLines(socket, { maxLineBytes: LIMIT });
  const read = async () => {
    const value = await lines.next();
    assert.equal(value.done, false);
    return decodeWireValue(value.value);
  };
  const send = (frame) => socket.write(encodeWireValue(frame) + "\n");
  send({
    v: 1,
    type: "hello",
    profileId: f.profile.id,
    generation: f.profile.generation,
  });
  const hello = await read();
  assert.equal(hello.type, "hello");
  send({ v: 1, type: "createView", viewId });
  const bootstrap = await read();
  assert.equal(bootstrap.type, "bootstrap");
  return { socket, send, lines, viewId, scope: bootstrap.scope };
}
function call(scope, extra = {}) {
  return {
    v: 1,
    type: "call",
    scope,
    seq: 1,
    id: 1,
    method: "sendMessageFromView",
    args: [],
    ...extra,
  };
}

test("browser bursts use at most eight immutable frames per fresh identity check and retain order", async (t) => {
  let checks = 0;
  const f = await fixture(t, {
    verifyIdentity: async () => {
      checks++;
      await delay(10);
      return true;
    },
  });
  const a = await rawConnection(f);
  t.after(() => a.socket.destroy());
  const batches = [];
  f.upstream.explicitDispatch = true;
  f.upstream.sendBatch = async (entries) => {
    batches.push(entries.length);
    for (const item of entries) {
      assert.equal(item.signal.aborted, false);
      assert.ok(performance.now() < item.deadline);
      item.onDispatch();
      f.upstream.sent.push(decodeWireValue(item.encoded));
    }
  };
  checks = 0;
  for (let seq = 1; seq <= 17; seq++) a.send(call(a.scope, { seq, id: seq }));
  await waitUntil(
    () =>
      f.upstream.sent.filter((frame) => frame.type === "call").length === 17,
  );
  assert.deepEqual(
    f.upstream.sent
      .filter((frame) => frame.type === "call")
      .map((frame) => frame.seq),
    Array.from({ length: 17 }, (_, i) => i + 1),
  );
  assert.deepEqual(batches, [8, 8, 1]);
  assert.equal(checks, 3);
});

test("disconnect during batch identity verification prevents every late browser frame", async (t) => {
  let enabled = false;
  const gate = deferred(),
    entered = deferred();
  const f = await fixture(t, {
    verifyIdentity: async () => {
      if (enabled) {
        entered.resolve();
        await gate.promise;
      }
      return true;
    },
  });
  const a = await rawConnection(f);
  const dispatched = [];
  f.upstream.explicitDispatch = true;
  f.upstream.sendBatch = async (entries) => {
    for (const item of entries) {
      item.onDispatch();
      dispatched.push(item.encoded);
    }
  };
  enabled = true;
  for (let seq = 1; seq <= 8; seq++) a.send(call(a.scope, { seq, id: seq }));
  await entered.promise;
  const peerClosed = deferred(),
    originalEmit = Socket.prototype.emit;
  Socket.prototype.emit = function (name, ...args) {
    const result = originalEmit.call(this, name, ...args);
    if (name === "close" && this !== a.socket && this.server)
      peerClosed.resolve();
    return result;
  };
  try {
    a.socket.destroy();
    // Observe the owned server-side socket's actual close, not merely the
    // client's local close, before allowing the delayed guard to finish.
    await peerClosed.promise;
    enabled = false;
    gate.resolve();
    await delay(20);
    assert.deepEqual(dispatched, []);
  } finally {
    Socket.prototype.emit = originalEmit;
    enabled = false;
    gate.resolve();
  }
});

test("an invalid later sequence prevents an undispatched batch from reaching native", async (t) => {
  const f = await fixture(t),
    a = await rawConnection(f);
  t.after(() => a.socket.destroy());
  const dispatched = [];
  f.upstream.explicitDispatch = true;
  f.upstream.sendBatch = async (entries) => {
    for (const item of entries) {
      item.onDispatch();
      dispatched.push(item.encoded);
    }
  };
  const failed = a.lines.next();
  a.socket.write(
    [
      encodeWireValue(call(a.scope, { seq: 1, id: 1 })),
      encodeWireValue(call(a.scope, { seq: 3, id: 2 })),
    ].join("\n") + "\n",
  );
  assert.equal(decodeWireValue((await failed).value).type, "error");
  assert.deepEqual(dispatched, []);
  assert.equal(
    f.upstream.sent.filter((frame) => frame.type === "call").length,
    0,
  );
});

test("browser frames arriving during verification receive a new batch and a fresh guard", async (t) => {
  let enabled = false,
    checks = 0;
  const gate = deferred(),
    entered = deferred();
  const f = await fixture(t, {
    verifyIdentity: async () => {
      if (enabled && ++checks === 1) {
        entered.resolve();
        await gate.promise;
      }
      return true;
    },
  });
  const a = await rawConnection(f);
  t.after(() => a.socket.destroy());
  const batches = [];
  f.upstream.explicitDispatch = true;
  f.upstream.sendBatch = async (entries) => {
    batches.push(entries.map((entry) => decodeWireValue(entry.encoded).seq));
    for (const entry of entries) entry.onDispatch();
  };
  enabled = true;
  a.send(call(a.scope, { seq: 1, id: 1 }));
  a.send(call(a.scope, { seq: 2, id: 2 }));
  await entered.promise;
  a.send(call(a.scope, { seq: 3, id: 3 }));
  a.send(call(a.scope, { seq: 4, id: 4 }));
  // Ensure the second socket burst is delivered while the guard is held.
  await delay(20);
  gate.resolve();
  await waitUntil(() => batches.length === 2);
  assert.deepEqual(batches, [
    [1, 2],
    [3, 4],
  ]);
  assert.equal(checks, 2);
});

test("an unknown partial batch dispatch revokes the channel and is never replayed", async (t) => {
  const f = await fixture(t),
    a = await rawConnection(f);
  t.after(() => a.socket.destroy());
  const dispatched = [];
  f.upstream.explicitDispatch = true;
  f.upstream.sendBatch = async (entries) => {
    entries[0].onDispatch();
    dispatched.push(decodeWireValue(entries[0].encoded).seq);
    throw new Error("unknown transport outcome");
  };
  for (let seq = 1; seq <= 4; seq++) a.send(call(a.scope, { seq, id: seq }));
  await waitUntil(() => f.upstream.listeners === 0);
  await delay(20);
  assert.deepEqual(dispatched, [1]);
  assert.equal(
    f.upstream.sent.filter((frame) => frame.type === "destroyView").length,
    0,
  );
});

test("a legal 160-frame native chunk propagates real Unix write backpressure in fixed windows of eight", async (t) => {
  let checks = 0;
  const f = await fixture(t, {
    verifyIdentity: async () => {
      checks++;
      await delay(5);
      return true;
    },
  });
  const a = await rawConnection(f);
  t.after(() => a.socket.destroy());
  checks = 0;
  const frames = Array.from({ length: 160 }, (_, index) => ({
      v: 1,
      type: "theme",
      scope: a.scope,
      seq: index + 1,
      value: index % 2 ? "light" : "dark",
    })),
    chunk = Buffer.from(
      frames.map((frame) => encodeWireValue(frame) + "\n").join(""),
    );
  assert.ok(chunk.byteLength < 64 * 1024);
  let active = 0,
    maximum = 0,
    delivered = 0;
  const producer = consumeContainerOutput(
    parseJsonLines([chunk], { maxLineBytes: LIMIT, maxChunkBytes: 64 * 1024 }),
    (encoded) => {
      maximum = Math.max(maximum, ++active);
      return f.upstream.emit(encoded).finally(() => {
        active--;
        delivered++;
      });
    },
  );
  for (let seq = 1; seq <= frames.length; seq++) {
    const next = await a.lines.next();
    assert.equal(next.done, false);
    const frame = decodeWireValue(next.value);
    assert.equal(frame.type, "theme");
    assert.equal(frame.seq, seq);
  }
  await producer;
  assert.equal(delivered, 160);
  assert.equal(
    maximum,
    8,
    "native consumption admits eight output completions at most",
  );
  assert.equal(active, 0);
  assert.equal(checks, 20, "each fixed window retains a fresh complete guard");
  assert.equal(a.socket.destroyed, false);
});

test("closing a real Unix client releases native output backpressure while its identity check is still pending", async (t) => {
  let enabled = false,
    pulled = 0;
  const gate = deferred(),
    entered = deferred();
  const f = await fixture(t, {
    verifyIdentity: async () => {
      if (enabled) {
        entered.resolve();
        await gate.promise;
      }
      return true;
    },
  });
  const a = await rawConnection(f);
  t.after(() => a.socket.destroy());
  enabled = true;
  async function* source() {
    for (let seq = 1; seq <= 16; seq++) {
      pulled++;
      yield encodeWireValue({
        v: 1,
        type: "theme",
        scope: a.scope,
        seq,
        value: "dark",
      });
    }
  }
  const producer = consumeContainerOutput(source(), (encoded) =>
    f.upstream.emit(encoded),
  );
  try {
    await entered.promise;
    assert.equal(pulled, 8, "an unresolved output window stops native reads");
    a.socket.destroy();
    const finished = await Promise.race([
      producer.then(() => true),
      delay(200).then(() => false),
    ]);
    assert.equal(
      finished,
      true,
      "closing the owned client must release its output receipts",
    );
    assert.equal(pulled, 16);
  } finally {
    gate.resolve();
    await producer;
  }
});

test("native response bursts use at most eight frames per fresh identity check and preserve every sequence", async (t) => {
  let checks = 0;
  const f = await fixture(t, {
    verifyIdentity: async () => {
      checks++;
      await delay(10);
      return true;
    },
  });
  const a = await rawConnection(f);
  t.after(() => a.socket.destroy());
  checks = 0;
  for (let seq = 1; seq <= 17; seq++)
    f.upstream.emit({
      v: 1,
      type: "theme",
      scope: a.scope,
      seq,
      value: seq % 2 ? "dark" : "light",
    });
  for (let seq = 1; seq <= 17; seq++) {
    const next = await a.lines.next();
    assert.equal(next.done, false);
    const frame = decodeWireValue(next.value);
    assert.equal(frame.seq, seq);
    assert.equal(frame.type, "theme");
  }
  assert.equal(
    checks,
    3,
    "17 frames require three separately authorized batches, never one reused grant",
  );
});

test("revocation between response batches drops the next batch and never reuses the prior identity result", async (t) => {
  let enabled = false,
    checks = 0;
  const f = await fixture(t, {
    verifyIdentity: async () => !enabled || ++checks === 1,
  });
  const a = await rawConnection(f);
  t.after(() => a.socket.destroy());
  enabled = true;
  for (let seq = 1; seq <= 9; seq++)
    f.upstream.emit({
      v: 1,
      type: "theme",
      scope: a.scope,
      seq,
      value: "dark",
    });
  const received = [];
  for await (const encoded of a.lines)
    received.push(decodeWireValue(encoded).seq);
  assert.deepEqual(received, [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(checks, 2);
  assert.equal(
    f.upstream.sent.filter((frame) => frame.type === "call").length,
    0,
  );
});

test("identity revocation while a response batch is waiting prevents every late socket write", async (t) => {
  let enabled = false,
    valid = true;
  const gate = deferred(),
    entered = deferred();
  const f = await fixture(t, {
    verifyIdentity: async () => {
      if (enabled) {
        entered.resolve();
        await gate.promise;
      }
      return valid;
    },
  });
  const a = await rawConnection(f);
  t.after(() => a.socket.destroy());
  enabled = true;
  for (let seq = 1; seq <= 8; seq++)
    f.upstream.emit({
      v: 1,
      type: "theme",
      scope: a.scope,
      seq,
      value: "dark",
    });
  await entered.promise;
  valid = false;
  gate.resolve();
  assert.equal((await a.lines.next()).done, true);
});

test("frames arriving during verification form a new response batch with a fresh check", async (t) => {
  let enabled = false,
    checks = 0;
  const gate = deferred(),
    entered = deferred();
  const f = await fixture(t, {
    verifyIdentity: async () => {
      if (enabled && ++checks === 1) {
        entered.resolve();
        await gate.promise;
      }
      return true;
    },
  });
  const a = await rawConnection(f);
  t.after(() => a.socket.destroy());
  enabled = true;
  const emit = (seq) =>
    f.upstream.emit({
      v: 1,
      type: "theme",
      scope: a.scope,
      seq,
      value: "dark",
    });
  emit(1);
  emit(2);
  await entered.promise;
  emit(3);
  emit(4);
  gate.resolve();
  for (let seq = 1; seq <= 4; seq++)
    assert.equal(decodeWireValue((await a.lines.next()).value).seq, seq);
  assert.equal(
    checks,
    2,
    "late messages must not extend the membership of the verified batch",
  );
});

test("a synchronous response write failure never retries its prefix or unwritten suffix and releases the original budgets", async (t) => {
  const f = await fixture(t, {
    maxFrameBytes: 4000,
    maxClientBytes: 4000,
    maxTotalBytes: 4000,
  });
  const a = await rawConnection(f),
    originalWrite = Socket.prototype.write,
    attempts = [];
  t.after(() => a.socket.destroy());
  Socket.prototype.write = function (data, ...args) {
    if (typeof data === "string" && data.includes(a.viewId)) {
      let frame;
      try {
        frame = decodeWireValue(data.trimEnd());
      } catch {}
      if (frame?.type === "theme") {
        attempts.push(frame.seq);
        if (frame.seq === 3) throw Error("fixture write failure");
      }
    }
    return originalWrite.call(this, data, ...args);
  };
  try {
    for (let seq = 1; seq <= 10; seq++)
      f.upstream.emit({
        v: 1,
        type: "theme",
        scope: a.scope,
        seq,
        value: "dark",
      });
    const received = [];
    for await (const encoded of a.lines)
      received.push(decodeWireValue(encoded).seq);
    await delay(20);
    assert.deepEqual(attempts, [1, 2, 3]);
    assert.ok(received.every((seq) => seq === 1 || seq === 2));
    const b = await rawConnection(f);
    for (let seq = 1; seq <= 10; seq++)
      f.upstream.emit({
        v: 1,
        type: "theme",
        scope: b.scope,
        seq,
        value: "dark",
      });
    for (let seq = 1; seq <= 10; seq++)
      assert.equal(decodeWireValue((await b.lines.next()).value).seq, seq);
    b.socket.destroy();
  } finally {
    Socket.prototype.write = originalWrite;
  }
});

test("real control client performs identity handshake and isolated view round trip", async (t) => {
  const f = await fixture(t),
    viewId = randomUUID(),
    connection = await f.connect(viewId);
  t.after(() => connection.close());
  const info = await lstat(f.profile.controlSocketPath);
  assert.equal(info.isSocket(), true);
  assert.equal(info.uid, process.getuid());
  assert.equal(info.mode & 0o7777, 0o600);
  assert.deepEqual(connection.scope, {
    profileId: f.profile.id,
    generation: f.profile.generation,
    viewId,
  });
  const frame = call(connection.scope);
  await connection.sendFrame(encodeWireValue(frame));
  await f.upstream.waitFor((sent) => sent.some((x) => x.type === "call"));
  assert.deepEqual(
    f.upstream.sent.find((x) => x.type === "call"),
    frame,
  );
  f.upstream.emit({
    v: 1,
    type: "return",
    scope: connection.scope,
    seq: 1,
    id: 1,
    value: "only-this-view",
  });
  const item = await connection.frames[Symbol.asyncIterator]().next();
  assert.equal(decodeWireValue(item.value).value, "only-this-view");
});

test("a cancelled undispatched create cannot write late or consume its view ID", async (t) => {
  const f = await fixture(t, { writeTimeoutMs: 1000 });
  const gate = deferred(),
    entered = deferred();
  const originalSend = f.upstream.send.bind(f.upstream);
  let context,
    held = true;
  f.upstream.explicitDispatch = true;
  f.upstream.send = async (encoded, control) => {
    const frame = decodeWireValue(encoded);
    if (frame.type === "createView" && held) {
      held = false;
      context = control;
      entered.resolve();
      await gate.promise;
    }
    if (control.signal.aborted || performance.now() >= control.deadline)
      throw new Error("cancelled before write");
    control.onDispatch();
    return originalSend(encoded);
  };
  const viewId = randomUUID();
  const socket = createConnection(f.profile.controlSocketPath);
  socket.on("error", () => {});
  try {
    await once(socket, "connect");
    const lines = parseJsonLines(socket, { maxLineBytes: LIMIT });
    socket.write(
      encodeWireValue({
        v: 1,
        type: "hello",
        profileId: f.profile.id,
        generation: f.profile.generation,
      }) + "\n",
    );
    assert.equal(decodeWireValue((await lines.next()).value).type, "hello");
    socket.write(encodeWireValue({ v: 1, type: "createView", viewId }) + "\n");
    await entered.promise;
    assert.ok(context?.signal instanceof AbortSignal);
    socket.destroy();
    await waitUntil(() => context.signal.aborted);
    gate.resolve();
    const connection = await f.connect(viewId);
    assert.equal(
      f.upstream.sent.filter((item) => item.type === "createView").length,
      1,
    );
    assert.equal(
      f.upstream.sent.filter((item) => item.type === "destroyView").length,
      0,
    );
    connection.close();
  } finally {
    socket.destroy();
    gate.resolve();
  }
});

test("the broker deadline cancels an undispatched write without a late replay", async (t) => {
  const f = await fixture(t, { writeTimeoutMs: 100 });
  const gate = deferred(),
    entered = deferred();
  const originalSend = f.upstream.send.bind(f.upstream);
  let context,
    held = true;
  f.upstream.explicitDispatch = true;
  f.upstream.send = async (encoded, control) => {
    const frame = decodeWireValue(encoded);
    if (frame.type === "createView" && held) {
      held = false;
      context = control;
      entered.resolve();
      await gate.promise;
    }
    if (control.signal.aborted || performance.now() >= control.deadline)
      throw new Error("cancelled before write");
    control.onDispatch();
    return originalSend(encoded);
  };
  const viewId = randomUUID();
  const pending = f.connect(viewId);
  void pending.catch(() => {});
  try {
    await entered.promise;
    assert.ok(context?.signal instanceof AbortSignal);
    await waitUntil(() => context.signal.aborted);
    await assert.rejects(pending);
    gate.resolve();
    const connection = await f.connect(viewId);
    assert.equal(
      f.upstream.sent.filter((item) => item.type === "createView").length,
      1,
    );
    assert.equal(
      f.upstream.sent.filter((item) => item.type === "destroyView").length,
      0,
    );
    connection.close();
  } finally {
    gate.resolve();
  }
});

test("broker close aborts a pre-dispatch publication wait without destroying a nonexistent view", async (t) => {
  const f = await fixture(t, { writeTimeoutMs: 1000 });
  const gate = deferred(),
    entered = deferred();
  let context;
  f.upstream.explicitDispatch = true;
  f.upstream.send = async (encoded, control) => {
    context = control;
    entered.resolve();
    await gate.promise;
    if (control.signal.aborted || performance.now() >= control.deadline) return;
    control.onDispatch();
    throw new Error("late write must never occur");
  };
  const pending = f.connect();
  void pending.catch(() => {});
  try {
    await entered.promise;
    await f.service.close();
    assert.equal(context.signal.aborted, true);
    await assert.rejects(pending);
    gate.resolve();
    await delay(20);
    assert.deepEqual(f.upstream.sent, []);
    assert.equal(f.upstream.listeners, 0);
  } finally {
    gate.resolve();
  }
});

test("bootstrap before actual create dispatch cannot satisfy a client", async (t) => {
  const f = await fixture(t, { writeTimeoutMs: 1000 });
  const gate = deferred(),
    entered = deferred();
  const originalSend = f.upstream.send.bind(f.upstream);
  let context,
    held = true;
  f.upstream.explicitDispatch = true;
  f.upstream.send = async (encoded, control) => {
    if (decodeWireValue(encoded).type === "createView" && held) {
      held = false;
      context = control;
      entered.resolve();
      await gate.promise;
    }
    if (control.signal.aborted || performance.now() >= control.deadline)
      throw new Error("cancelled before write");
    control.onDispatch();
    return originalSend(encoded);
  };
  const viewId = randomUUID(),
    pending = f.connect(viewId);
  void pending.catch(() => {});
  try {
    await entered.promise;
    f.upstream.emit({
      v: 1,
      type: "bootstrap",
      scope: {
        profileId: f.profile.id,
        generation: f.profile.generation,
        viewId,
      },
      bootstrap: { windowType: "electron", getters: {}, sharedObjects: {} },
    });
    await assert.rejects(pending);
    await waitUntil(() => context.signal.aborted);
    gate.resolve();
    const connection = await f.connect(viewId);
    assert.equal(
      f.upstream.sent.filter((item) => item.type === "createView").length,
      1,
    );
    connection.close();
  } finally {
    gate.resolve();
  }
});

test("identity revocation cancels a pre-dispatch wait and never forwards it later", async (t) => {
  const f = await fixture(t, { writeTimeoutMs: 1000 });
  const gate = deferred(),
    entered = deferred();
  let context;
  f.upstream.explicitDispatch = true;
  f.upstream.send = async (encoded, control) => {
    context = control;
    entered.resolve();
    await gate.promise;
    if (control.signal.aborted || performance.now() >= control.deadline) return;
    control.onDispatch();
    throw new Error("late write must never occur");
  };
  const pending = f.connect();
  void pending.catch(() => {});
  try {
    await entered.promise;
    f.setValid(false);
    await assert.rejects(f.connect());
    await assert.rejects(pending);
    assert.equal(context.signal.aborted, true);
    gate.resolve();
    await waitUntil(() => f.upstream.listeners === 0);
    assert.deepEqual(f.upstream.sent, []);
  } finally {
    gate.resolve();
  }
});

test("transferred listener outlives a cleanly removed hidden bind path", async (t) => {
  const f = await fixture(t);
  const hiddenDir = (await readdir(f.dir)).find((name) =>
    name.startsWith(".desktop-control-"),
  );
  assert.ok(hiddenDir);
  await assert.rejects(lstat(join(f.dir, hiddenDir, "s")), { code: "ENOENT" });
  const connection = await f.connect();
  t.after(() => connection.close());
  assert.equal(connection.bootstrap.windowType, "electron");
});

test("rejects an existing public path without changing it", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "desktop-broker-existing-"));
  await chmod(dir, 0o700);
  t.after(() => rm(dir, { recursive: true, force: true }));
  const socketPath = join(dir, "control.sock");
  await writeFile(socketPath, "foreign", { mode: 0o600 });
  const profile = { id: randomUUID(), generation: randomUUID() },
    upstream = fakeUpstream(profile);
  await assert.rejects(
    createDesktopControlService({
      socketPath,
      profileId: profile.id,
      generation: profile.generation,
      pid: process.pid,
      startTicks: "1",
      upstream,
      verifyIdentity: async () => true,
    }),
    { code: "CONTROL_SOCKET_EXISTS" },
  );
  assert.equal(await readFile(socketPath, "utf8"), "foreign");
});

test("requires canonical owned private parents, bounded limits and current identity", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "desktop-broker-invalid-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const parent = join(root, "real");
  await mkdir(parent, { mode: 0o700 });
  const alias = join(root, "alias");
  await symlink(parent, alias);
  const profileId = randomUUID(),
    generation = randomUUID(),
    upstream = fakeUpstream({ id: profileId, generation });
  const base = {
    profileId,
    generation,
    pid: process.pid,
    startTicks: "1",
    upstream,
    verifyIdentity: async () => true,
  };
  await assert.rejects(
    createDesktopControlService({ ...base, socketPath: join(alias, "s") }),
    { code: "CONTROL_UNSAFE_DIRECTORY" },
  );
  await chmod(parent, 0o750);
  await assert.rejects(
    createDesktopControlService({ ...base, socketPath: join(parent, "s") }),
    { code: "CONTROL_UNSAFE_DIRECTORY" },
  );
  await chmod(parent, 0o700);
  for (const bad of [
    { maxClients: 17 },
    { maxFrameBytes: LIMIT + 1 },
    { maxClientBytes: LIMIT + 1 },
    { maxTotalBytes: 32 * 1024 * 1024 + 1 },
  ])
    await assert.rejects(
      createDesktopControlService({
        ...base,
        socketPath: join(parent, "s"),
        ...bad,
      }),
      { code: "CONTROL_INVALID_CONFIG" },
    );
  await assert.rejects(
    createDesktopControlService({
      ...base,
      socketPath: join(parent, "s"),
      verifyIdentity: async () => false,
    }),
    { code: "CONTROL_IDENTITY_CHANGED" },
  );
  await assert.rejects(lstat(join(parent, "s")), { code: "ENOENT" });
  assert.equal(upstream.listeners, 0);
});

test("a synchronous invalid upstream identity retires startup and releases its subscription", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "desktop-broker-invalid-ready-"));
  await chmod(dir, 0o700);
  t.after(() => rm(dir, { recursive: true, force: true }));
  const profileId = randomUUID(),
    generation = randomUUID();
  let unsubscribes = 0;
  const upstream = {
    send: async () => {},
    subscribe(handler) {
      handler(
        encodeWireValue({
          v: 1,
          type: "ready",
          profileId,
          generation,
          pid: process.pid + 1,
        }),
      );
      return () => {
        unsubscribes++;
      };
    },
  };
  await assert.rejects(
    createDesktopControlService({
      socketPath: join(dir, "control.sock"),
      profileId,
      generation,
      pid: process.pid,
      startTicks: "1",
      upstream,
      verifyIdentity: async () => true,
    }),
    { code: "CONTROL_IDENTITY_CHANGED" },
  );
  assert.equal(unsubscribes, 1);
});

test("two views route only to their owner and preserve distinct sequences", async (t) => {
  const f = await fixture(t),
    a = await f.connect(),
    b = await f.connect();
  t.after(() => {
    a.close();
    b.close();
  });
  await a.sendFrame(encodeWireValue(call(a.scope)));
  await b.sendFrame(encodeWireValue(call(b.scope)));
  await f.upstream.waitFor(
    (sent) => sent.filter((x) => x.type === "call").length === 2,
  );
  const ai = a.frames[Symbol.asyncIterator](),
    bi = b.frames[Symbol.asyncIterator]();
  f.upstream.emit({
    v: 1,
    type: "return",
    scope: b.scope,
    seq: 1,
    id: 1,
    value: "B",
  });
  f.upstream.emit({
    v: 1,
    type: "return",
    scope: a.scope,
    seq: 1,
    id: 1,
    value: "A",
  });
  assert.equal(decodeWireValue((await ai.next()).value).value, "A");
  assert.equal(decodeWireValue((await bi.next()).value).value, "B");
});

test("cross-view, repeated sequence, arbitrary methods and unknown host replies fail closed", async (t) => {
  for (const variation of [
    (scope) => call({ ...scope, viewId: randomUUID() }),
    (scope) => call(scope, { seq: 2 }),
    (scope) => call(scope, { method: "executeJavaScript", args: ["alert(1)"] }),
  ]) {
    const f = await fixture(t),
      connection = await rawConnection(f);
    const closed = once(connection.socket, "close"),
      error = connection.lines.next();
    connection.send(variation(connection.scope));
    assert.equal(
      decodeWireValue((await error).value).code,
      "CONTROL_PROTOCOL_ERROR",
    );
    await closed;
    await f.upstream.waitFor((sent) =>
      sent.some((x) => x.type === "destroyView"),
    );
    assert.equal(
      f.upstream.sent.some((x) => x.type === "call"),
      false,
    );
  }
  const f = await fixture(t),
    connection = await rawConnection(f);
  const closed = once(connection.socket, "close");
  f.upstream.emit({
    v: 1,
    type: "return",
    scope: connection.scope,
    seq: 1,
    id: 999,
    value: "private",
  });
  await closed;
});

test("same view UUID cannot be claimed twice, even after its owner disconnects", async (t) => {
  const f = await fixture(t),
    viewId = randomUUID(),
    a = await f.connect(viewId);
  await assert.rejects(f.connect(viewId));
  a.close();
  await f.upstream.waitFor((sent) =>
    sent.some((x) => x.type === "destroyView"),
  );
  await assert.rejects(f.connect(viewId));
  assert.equal(
    f.upstream.sent.filter((x) => x.type === "createView").length,
    1,
  );
});

test("the configured client cap refuses new clients without disrupting the owner", async (t) => {
  const f = await fixture(t, { maxClients: 1 }),
    a = await f.connect();
  t.after(() => a.close());
  await assert.rejects(f.connect());
  await a.sendFrame(encodeWireValue(call(a.scope)));
  await f.upstream.waitFor((sent) => sent.some((x) => x.type === "call"));
  assert.equal(
    f.upstream.sent.filter((x) => x.type === "createView").length,
    1,
  );
});

test("incomplete handshakes time out without creating a view", async (t) => {
  const f = await fixture(t, { handshakeTimeoutMs: 30 });
  const socket = createConnection(f.profile.controlSocketPath);
  socket.on("error", () => {});
  await once(socket, "connect");
  const lines = parseJsonLines(socket),
    closed = once(socket, "close");
  const message = decodeWireValue((await lines.next()).value);
  assert.equal(message.code, "CONTROL_HANDSHAKE_TIMEOUT");
  await closed;
  assert.equal(
    f.upstream.sent.some((x) => x.type === "createView"),
    false,
  );
});

test("a view awaiting its destroy receipt retains a bounded native view slot", async (t) => {
  const f = await fixture(t, { maxClients: 1, writeTimeoutMs: 1000 }),
    a = await f.connect();
  f.upstream.setCloseAck(false);
  a.close();
  await f.upstream.waitFor((sent) =>
    sent.some((x) => x.type === "destroyView"),
  );
  await assert.rejects(f.connect());
  assert.equal(
    f.upstream.sent.filter((x) => x.type === "createView").length,
    1,
  );
  f.upstream.emit({ v: 1, type: "viewClosed", scope: a.scope });
  f.upstream.setCloseAck(true);
  const b = await f.connect();
  t.after(() => b.close());
  assert.equal(
    f.upstream.sent.filter((x) => x.type === "createView").length,
    2,
  );
});

test("request IDs cannot be reused after an earlier response", async (t) => {
  const f = await fixture(t),
    a = await rawConnection(f);
  a.send(call(a.scope));
  await f.upstream.waitFor((sent) => sent.some((x) => x.type === "call"));
  f.upstream.emit({
    v: 1,
    type: "return",
    scope: a.scope,
    seq: 1,
    id: 1,
    value: "done",
  });
  await a.lines.next();
  const closed = once(a.socket, "close");
  const next = a.lines.next();
  a.send(call(a.scope, { seq: 2 }));
  assert.equal(
    decodeWireValue((await next).value).code,
    "CONTROL_PROTOCOL_ERROR",
  );
  await closed;
  assert.equal(f.upstream.sent.filter((x) => x.type === "call").length, 1);
});

test("rejects unknown port use and allows only the owned open/post/close lifecycle", async (t) => {
  const f = await fixture(t),
    a = await rawConnection(f);
  a.send({
    v: 1,
    type: "openPort",
    scope: a.scope,
    seq: 1,
    id: 1,
    portId: "app-host-1",
    name: "app-host",
  });
  await f.upstream.waitFor((sent) => sent.some((x) => x.type === "openPort"));
  f.upstream.emit({
    v: 1,
    type: "return",
    scope: a.scope,
    seq: 1,
    id: 1,
    value: undefined,
  });
  assert.equal(decodeWireValue((await a.lines.next()).value).type, "return");
  a.send({
    v: 1,
    type: "portPost",
    scope: a.scope,
    seq: 2,
    id: 2,
    portId: "app-host-1",
    data: "hello",
  });
  await f.upstream.waitFor((sent) => sent.some((x) => x.type === "portPost"));
  f.upstream.emit({
    v: 1,
    type: "return",
    scope: a.scope,
    seq: 2,
    id: 2,
    value: undefined,
  });
  await a.lines.next();
  a.send({
    v: 1,
    type: "closePort",
    scope: a.scope,
    seq: 3,
    id: 3,
    portId: "app-host-1",
  });
  await f.upstream.waitFor((sent) => sent.some((x) => x.type === "closePort"));
  f.upstream.emit({
    v: 1,
    type: "return",
    scope: a.scope,
    seq: 3,
    id: 3,
    value: undefined,
  });
  await a.lines.next();
  const closed = once(a.socket, "close"),
    error = a.lines.next();
  a.send({
    v: 1,
    type: "portPost",
    scope: a.scope,
    seq: 4,
    id: 4,
    portId: "app-host-1",
    data: "late",
  });
  assert.equal(
    decodeWireValue((await error).value).code,
    "CONTROL_PROTOCOL_ERROR",
  );
  await closed;
  assert.equal(f.upstream.sent.filter((x) => x.type === "portPost").length, 1);
});

test("oversized inbound messages close only the offending connection", async (t) => {
  const f = await fixture(t, {
    maxFrameBytes: 1024,
    maxClientBytes: 1024,
    maxTotalBytes: 2048,
  });
  const a = await rawConnection(f),
    b = await f.connect();
  t.after(() => b.close());
  const closed = once(a.socket, "close");
  a.send(call(a.scope, { args: ["x".repeat(1800)] }));
  await closed;
  await b.sendFrame(encodeWireValue(call(b.scope)));
  await f.upstream.waitFor((sent) => sent.some((x) => x.type === "call"));
  assert.equal(f.upstream.sent.filter((x) => x.type === "call").length, 1);
});

test("global byte budget rejects a second producer without forwarding its frame", async (t) => {
  const f = await fixture(t, {
    maxFrameBytes: 1200,
    maxClientBytes: 1200,
    maxTotalBytes: 1500,
    writeTimeoutMs: 2000,
  });
  const a = await rawConnection(f),
    b = await rawConnection(f),
    gate = deferred();
  f.upstream.setSend((message) =>
    message.type === "call" ? gate.promise : Promise.resolve(),
  );
  try {
    a.send(call(a.scope, { args: ["x".repeat(600)] }));
    await f.upstream.waitFor(
      (sent) => sent.filter((x) => x.type === "call").length === 1,
    );
    const closed = once(b.socket, "close");
    b.send(call(b.scope, { args: ["y".repeat(600)] }));
    await closed;
    assert.equal(f.upstream.sent.filter((x) => x.type === "call").length, 1);
  } finally {
    gate.resolve();
    a.socket.destroy();
  }
});

test("slow client output is bounded and does not close another view", async (t) => {
  const f = await fixture(t, {
    maxFrameBytes: 1200,
    maxClientBytes: 1200,
    maxTotalBytes: 4096,
  });
  const a = await rawConnection(f),
    b = await f.connect();
  t.after(() => b.close());
  const closed = once(a.socket, "close");
  const response = a.lines.next();
  for (let seq = 1; seq <= 10; seq++)
    f.upstream.emit({
      v: 1,
      type: "viewMessage",
      scope: a.scope,
      seq,
      data: "x".repeat(500),
    });
  assert.equal(
    decodeWireValue((await response).value).code,
    "CONTROL_QUEUE_FULL",
  );
  await closed;
  await b.sendFrame(encodeWireValue(call(b.scope)));
  await f.upstream.waitFor((sent) => sent.some((x) => x.type === "call"));
  assert.equal(f.upstream.sent.filter((x) => x.type === "call").length, 1);
});

test("a stale host sequence closes its owner without affecting another view", async (t) => {
  const f = await fixture(t),
    a = await rawConnection(f),
    b = await f.connect();
  t.after(() => b.close());
  const closed = once(a.socket, "close");
  f.upstream.emit({
    v: 1,
    type: "viewMessage",
    scope: a.scope,
    seq: 2,
    data: "out-of-order",
  });
  await closed;
  await b.sendFrame(encodeWireValue(call(b.scope)));
  await f.upstream.waitFor((sent) => sent.some((x) => x.type === "call"));
});

test("a host reply cannot satisfy a request before its upstream write is dispatched", async (t) => {
  const f = await fixture(t, { writeTimeoutMs: 1000 }),
    a = await rawConnection(f),
    b = await rawConnection(f),
    gate = deferred();
  f.upstream.setSend((message) =>
    message.type === "call" ? gate.promise : Promise.resolve(),
  );
  try {
    a.send(call(a.scope));
    await f.upstream.waitFor((sent) => sent.some((x) => x.type === "call"));
    b.send(call(b.scope));
    await delay(20);
    const closed = once(b.socket, "close");
    f.upstream.emit({
      v: 1,
      type: "return",
      scope: b.scope,
      seq: 1,
      id: 1,
      value: "stale",
    });
    await closed;
    gate.resolve();
    await delay(20);
    assert.equal(f.upstream.sent.filter((x) => x.type === "call").length, 1);
  } finally {
    gate.resolve();
    a.socket.destroy();
    b.socket.destroy();
  }
});

test("native failures use a fixed public error code and close only that view", async (t) => {
  const f = await fixture(t),
    a = await rawConnection(f),
    b = await f.connect();
  t.after(() => b.close());
  const closed = once(a.socket, "close");
  f.upstream.emit({
    v: 1,
    type: "error",
    viewId: a.viewId,
    code: "PRIVATE_CONTROL_ERROR",
    message: "/private/sensitive",
  });
  const response = await a.lines.next();
  assert.deepEqual(decodeWireValue(response.value), {
    v: 1,
    type: "error",
    code: "CONTROL_UPSTREAM_ERROR",
  });
  await closed;
  await b.sendFrame(encodeWireValue(call(b.scope)));
  await f.upstream.waitFor((sent) => sent.some((x) => x.type === "call"));
});

test("identity revocation closes channels and never forwards or retries a write", async (t) => {
  const f = await fixture(t),
    c = await f.connect();
  const before = f.upstream.sent.length;
  f.setValid(false);
  await c.sendFrame(encodeWireValue(call(c.scope))).catch(() => {});
  await waitUntil(() => f.upstream.listeners === 0);
  assert.equal(
    f.upstream.sent.slice(before).some((x) => x.type === "call"),
    false,
  );
  assert.equal(
    f.upstream.sent.slice(before).some((x) => x.type === "destroyView"),
    false,
  );
  assert.equal(f.upstream.listeners, 0);
});

test("identity is rechecked when a queued write actually reaches upstream", async (t) => {
  const f = await fixture(t),
    a = await rawConnection(f),
    b = await rawConnection(f),
    gate = deferred();
  f.upstream.setSend((message) =>
    message.type === "call" ? gate.promise : Promise.resolve(),
  );
  try {
    a.send(call(a.scope));
    await f.upstream.waitFor((sent) => sent.some((x) => x.type === "call"));
    const closed = once(b.socket, "close");
    b.send(call(b.scope));
    await delay(30);
    f.setValid(false);
    gate.resolve();
    await closed;
    assert.equal(f.upstream.sent.filter((x) => x.type === "call").length, 1);
    await waitUntil(() => f.upstream.listeners === 0);
    assert.equal(f.upstream.listeners, 0);
  } finally {
    gate.resolve();
    a.socket.destroy();
    b.socket.destroy();
  }
});

test("disconnect during create still queues destruction of only its own view", async (t) => {
  const f = await fixture(t),
    viewId = randomUUID(),
    gate = deferred();
  f.upstream.setSend((message) =>
    message.type === "createView" ? gate.promise : Promise.resolve(),
  );
  const socket = createConnection(f.profile.controlSocketPath);
  socket.on("error", () => {});
  await once(socket, "connect");
  const lines = parseJsonLines(socket);
  socket.write(
    encodeWireValue({
      v: 1,
      type: "hello",
      profileId: f.profile.id,
      generation: f.profile.generation,
    }) + "\n",
  );
  assert.equal(decodeWireValue((await lines.next()).value).type, "hello");
  socket.write(encodeWireValue({ v: 1, type: "createView", viewId }) + "\n");
  await f.upstream.waitFor((sent) => sent.some((x) => x.type === "createView"));
  socket.destroy();
  gate.resolve();
  await f.upstream.waitFor((sent) =>
    sent.some((x) => x.type === "destroyView"),
  );
  assert.deepEqual(
    f.upstream.sent
      .filter((x) => x.type === "destroyView")
      .map((x) => x.viewId),
    [viewId],
  );
});

test("close destroys owned views and releases subscription without stopping the native host", async (t) => {
  const f = await fixture(t),
    a = await f.connect(),
    b = await f.connect();
  await f.service.close();
  assert.deepEqual(
    new Set(
      f.upstream.sent
        .filter((x) => x.type === "destroyView")
        .map((x) => x.viewId),
    ),
    new Set([a.scope.viewId, b.scope.viewId]),
  );
  assert.equal(f.upstream.unsubscribes, 1);
  assert.equal((await lstat(f.profile.controlSocketPath)).isSocket(), true);
});

test("unconfirmed destroy outcome is surfaced and never retried", async (t) => {
  const f = await fixture(t),
    a = await f.connect();
  f.upstream.setSend((message) =>
    message.type === "destroyView"
      ? Promise.reject(new Error("/private/native-error"))
      : Promise.resolve(),
  );
  await assert.rejects(f.service.close(), { code: "CONTROL_OUTCOME_UNKNOWN" });
  assert.equal(
    f.upstream.sent.filter((x) => x.type === "destroyView").length,
    1,
  );
  assert.equal(f.upstream.listeners, 0);
  a.close();
});

test("destroy write without matching viewClosed is unknown and never retried", async (t) => {
  const f = await fixture(t, { writeTimeoutMs: 50 }),
    a = await f.connect();
  f.upstream.setCloseAck(false);
  await assert.rejects(f.service.close(), { code: "CONTROL_OUTCOME_UNKNOWN" });
  assert.equal(
    f.upstream.sent.filter((x) => x.type === "destroyView").length,
    1,
  );
  assert.equal(f.upstream.listeners, 0);
  a.close();
});

test("a viewClosed arriving before its destroy is dispatched cannot satisfy the receipt", async (t) => {
  const f = await fixture(t, { writeTimeoutMs: 100 }),
    a = await rawConnection(f),
    b = await rawConnection(f),
    gate = deferred();
  f.upstream.setCloseAck(false);
  f.upstream.setSend((message) =>
    message.type === "call" ? gate.promise : Promise.resolve(),
  );
  try {
    a.send(call(a.scope));
    await f.upstream.waitFor((sent) => sent.some((x) => x.type === "call"));
    b.socket.destroy();
    await delay(15);
    f.upstream.emit({ v: 1, type: "viewClosed", scope: b.scope });
    gate.resolve();
    await f.upstream.waitFor((sent) =>
      sent.some((x) => x.type === "destroyView" && x.viewId === b.viewId),
    );
    await delay(150);
    assert.equal(f.upstream.listeners, 0);
  } finally {
    gate.resolve();
    a.socket.destroy();
    b.socket.destroy();
  }
});

test("a replaced published socket is not deleted when the hidden listener closes", async (t) => {
  const f = await fixture(t),
    a = await f.connect();
  const saved = join(f.dir, "old-public");
  await rename(f.profile.controlSocketPath, saved);
  await writeFile(f.profile.controlSocketPath, "foreign");
  await f.service.close();
  assert.equal(await readFile(f.profile.controlSocketPath, "utf8"), "foreign");
  a.close();
});

test("a competing socket path created before publication is preserved", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "desktop-broker-race-"));
  await chmod(dir, 0o700);
  t.after(() => rm(dir, { recursive: true, force: true }));
  const socketPath = join(dir, "control.sock");
  const profile = { id: randomUUID(), generation: randomUUID() },
    upstream = fakeUpstream(profile);
  let checks = 0;
  await assert.rejects(
    createDesktopControlService({
      socketPath,
      profileId: profile.id,
      generation: profile.generation,
      pid: process.pid,
      startTicks: "1",
      upstream,
      verifyIdentity: async () => {
        if (++checks === 2)
          await writeFile(socketPath, "foreign", { flag: "wx" });
        return true;
      },
    }),
    { code: "CONTROL_SOCKET_EXISTS" },
  );
  assert.equal(await readFile(socketPath, "utf8"), "foreign");
  assert.deepEqual((await readdir(dir)).sort(), ["control.sock"]);
});

test("cancelled and timed-out handoffs clean up their own helper and hidden socket", async (t) => {
  for (const kind of ["cancel", "timeout"]) {
    const dir = await mkdtemp(join(tmpdir(), "desktop-broker-cancel-"));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const profile = { id: randomUUID(), generation: randomUUID() };
    const upstream = fakeUpstream(profile),
      reached = deferred(),
      gate = deferred();
    const controller = new AbortController();
    let checks = 0;
    const result = createDesktopControlService({
      socketPath: join(dir, "control.sock"),
      profileId: profile.id,
      generation: profile.generation,
      pid: process.pid,
      startTicks: "1",
      upstream,
      signal: controller.signal,
      handoffTimeoutMs: 1500,
      verifyIdentity: async () => {
        if (++checks === 2) {
          reached.resolve();
          await gate.promise;
        }
        return true;
      },
    });
    await reached.promise;
    if (kind === "cancel") controller.abort();
    try {
      await assert.rejects(result, {
        code:
          kind === "cancel" ? "CONTROL_START_ABORTED" : "CONTROL_START_TIMEOUT",
      });
      assert.deepEqual(await readdir(dir), []);
      assert.equal(upstream.listeners, 0);
    } finally {
      gate.resolve();
    }
  }
});

test("handoff helper preserves a replaced bind path and terminates only itself", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "desktop-broker-helper-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const binding = join(dir, "s");
  const helper = fork(
    fileURLToPath(new URL("../src/control-bind-helper.cjs", import.meta.url)),
    [],
    {
      execArgv: [],
      env: {},
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    },
  );
  let handle;
  t.after(() => {
    if (helper.exitCode === null && helper.signalCode === null)
      helper.kill("SIGTERM");
    if (handle?.listening) handle.close();
  });
  const bound = once(helper, "message");
  helper.send(encodeWireValue({ v: 1, type: "bind", path: binding }));
  const [boundFrame, received] = await bound;
  handle = received;
  assert.equal(decodeWireValue(boundFrame).type, "bound");
  assert.equal(handle.listening, true);
  await rename(binding, join(dir, "old-binding"));
  await writeFile(binding, "foreign", { flag: "wx" });
  const response = once(helper, "message"),
    exited = once(helper, "exit");
  helper.send(encodeWireValue({ v: 1, type: "release" }));
  assert.deepEqual(decodeWireValue((await response)[0]), {
    v: 1,
    type: "error",
    code: "CONTROL_SOCKET_REPLACED",
  });
  assert.deepEqual(await exited, [null, "SIGTERM"]);
  await new Promise((resolve) => handle.close(resolve));
  assert.equal(await readFile(binding, "utf8"), "foreign");
});

test("an unresponsive owned helper is signalled precisely and leaves its private socket for generation cleanup", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "desktop-broker-stalled-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const childList = async () =>
    (await readFile(`/proc/self/task/${process.pid}/children`, "utf8"))
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map(Number);
  const before = new Set(await childList());
  const profile = { id: randomUUID(), generation: randomUUID() };
  const reached = deferred(),
    gate = deferred(),
    controller = new AbortController();
  let checks = 0,
    stopped = false,
    helperPid,
    helperTicks;
  const result = createDesktopControlService({
    socketPath: join(dir, "control.sock"),
    profileId: profile.id,
    generation: profile.generation,
    pid: process.pid,
    startTicks: "1",
    upstream: fakeUpstream(profile),
    signal: controller.signal,
    handoffTimeoutMs: 5000,
    writeTimeoutMs: 100,
    verifyIdentity: async () => {
      if (++checks === 2) {
        reached.resolve();
        await gate.promise;
      }
      return true;
    },
  });
  const rejected = assert.rejects(result, { code: "CONTROL_START_ABORTED" });
  async function ownedIdentity(pid) {
    const [info, command, stat] = await Promise.all([
      lstat(`/proc/${pid}`),
      readFile(`/proc/${pid}/cmdline`, "utf8"),
      readFile(`/proc/${pid}/stat`, "utf8"),
    ]);
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    assert.equal(info.uid, process.getuid());
    assert.equal(Number(fields[1]), process.pid);
    assert.equal(
      command.split("\0")[1],
      fileURLToPath(new URL("../src/control-bind-helper.cjs", import.meta.url)),
    );
    return fields[19];
  }
  try {
    await reached.promise;
    const children = (await childList()).filter((pid) => !before.has(pid));
    assert.equal(children.length, 1);
    helperPid = children[0];
    helperTicks = await ownedIdentity(helperPid);
    process.kill(helperPid, "SIGSTOP");
    stopped = true;
    controller.abort();
    await delay(350);
    assert.equal(await ownedIdentity(helperPid), helperTicks);
    process.kill(helperPid, "SIGCONT");
    stopped = false;
    await rejected;
    await assert.rejects(lstat(`/proc/${helperPid}`), { code: "ENOENT" });
    const hiddenDir = (await readdir(dir)).find((name) =>
      name.startsWith(".desktop-control-"),
    );
    assert.ok(hiddenDir);
    assert.equal((await lstat(join(dir, hiddenDir, "s"))).isSocket(), true);
    await assert.rejects(lstat(join(dir, "control.sock")), { code: "ENOENT" });
  } finally {
    gate.resolve();
    controller.abort();
    if (stopped) {
      try {
        if ((await ownedIdentity(helperPid)) === helperTicks)
          process.kill(helperPid, "SIGCONT");
      } catch {}
    }
    await rejected.catch(() => {});
  }
});

test("a replaced hidden bind path is never deleted, and the closed listener rejects new clients", async (t) => {
  const f = await fixture(t),
    a = await f.connect();
  const hiddenDir = (await readdir(f.dir)).find((name) =>
    name.startsWith(".desktop-control-"),
  );
  assert.ok(hiddenDir);
  const binding = join(f.dir, hiddenDir, "s");
  await writeFile(binding, "foreign", { flag: "wx" });
  await assert.rejects(f.service.close(), { code: "CONTROL_SOCKET_REPLACED" });
  assert.equal(await readFile(binding, "utf8"), "foreign");
  assert.equal(f.upstream.listeners, 0);
  const before = f.upstream.sent.length;
  const socket = createConnection(f.profile.controlSocketPath);
  socket.on("error", () => {});
  const closed = new Promise((resolve) => socket.once("close", resolve));
  await closed;
  assert.equal(
    f.upstream.sent.slice(before).some((x) => x.type === "createView"),
    false,
  );
  a.close();
});

test("normal broker process exit preserves foreign hidden and published paths", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "desktop-broker-exit-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const moduleUrl = new URL("../src/control-service.mjs", import.meta.url).href;
  const script = `
    import { randomUUID } from "node:crypto";
    import { createDesktopControlService } from ${JSON.stringify(moduleUrl)};
    const service = await createDesktopControlService({
      socketPath: process.argv[1], profileId: randomUUID(), generation: randomUUID(),
      pid: process.pid, startTicks: "1", verifyIdentity: async () => true,
      upstream: { send: async () => {}, subscribe: () => () => {} },
    });
    process.on("message", async () => { await service.close().catch(() => {}); process.disconnect(); });
    process.send("ready");
  `;
  const socketPath = join(dir, "control.sock");
  const child = spawn(
    process.execPath,
    ["--input-type=module", "-e", script, socketPath],
    {
      env: {},
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    },
  );
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGTERM");
  });
  assert.equal((await once(child, "message"))[0], "ready");
  const hiddenDir = (await readdir(dir)).find((name) =>
    name.startsWith(".desktop-control-"),
  );
  const binding = join(dir, hiddenDir, "s");
  await writeFile(binding, "foreign hidden", { flag: "wx" });
  await rename(socketPath, join(dir, "old-public"));
  await writeFile(socketPath, "foreign public", { flag: "wx" });
  const exited = once(child, "exit");
  child.send("close");
  assert.deepEqual(await exited, [0, null]);
  assert.equal(await readFile(binding, "utf8"), "foreign hidden");
  assert.equal(await readFile(socketPath, "utf8"), "foreign public");
});

test('completed broker writes individually free the existing eight native output slots', async t => {
  const f = await fixture(t), a = await rawConnection(f), originalWrite = Socket.prototype.write;
  t.after(() => a.socket.destroy());
  const gate = deferred(); let held = false, pulled = 0, active = 0, peak = 0, completedPrefix = 0;
  Socket.prototype.write = function(data, ...args) {
    if(typeof data === 'string' && data.includes(a.viewId)) {
      let frame; try { frame=decodeWireValue(data.trimEnd()); } catch {}
      if(frame?.type === 'theme' && frame.seq <= 8) {
        const idx=args.length-1, callback=args[idx];
        if(frame.seq === 8) args[idx]=error=>{ held=true; void gate.promise.then(()=>callback(error)); };
        else args[idx]=error=>{ completedPrefix++;callback(error); };
      }
    }
    return originalWrite.call(this,data,...args);
  };
  async function* source() {
    for(let seq=1;seq<=16;seq++) {pulled++;yield encodeWireValue({v:1,type:'theme',scope:a.scope,seq,value:'dark'});}
  }
  const run=consumeContainerOutput(source(),encoded=>{
    active++;peak=Math.max(peak,active);
    return f.upstream.emit(encoded).finally(()=>{active--;});
  });
  try {
    await waitUntil(()=>held && completedPrefix===7);
    await delay(40);
    assert.ok(pulled>=15,`only ${pulled} frames pulled while seven writes had actually completed`);
    assert.ok(peak<=8,`native output active ${peak} exceeds original eight`);
    for(let seq=1;seq<=15;seq++) {
      const next=await Promise.race([a.lines.next(),delay(100).then(()=>({done:true}))]);
      assert.equal(next.done,false,'a later ordered frame must reach the real Unix client before the held callback');
      assert.equal(decodeWireValue(next.value).seq,seq);
    }
  } finally {
    gate.resolve(); await run; Socket.prototype.write=originalWrite;
  }
  assert.equal(decodeWireValue((await a.lines.next()).value).seq,16);
  assert.equal(active,0);
});

test('a later broker write error closes its own view even while an earlier callback is pending', async t => {
  const f=await fixture(t), a=await rawConnection(f), originalWrite=Socket.prototype.write, gate=deferred(), failed=deferred();
  t.after(()=>a.socket.destroy());
  let attempts=[], afterFailure=0, injected=false;
  Socket.prototype.write=function(data,...args) {
    if(typeof data==='string'&&data.includes(a.viewId)) {
      let frame;try{frame=decodeWireValue(data.trimEnd());}catch{}
      if(frame?.type==='theme') {
        attempts.push(frame.seq);if(injected)afterFailure++;
        const idx=args.length-1,callback=args[idx];
        if(frame.seq===8) args[idx]=error=>void gate.promise.then(()=>callback(error));
        if(frame.seq===9) args[idx]=()=>{injected=true;callback(new Error('synthetic write error'));failed.resolve();};
      }
    }
    return originalWrite.call(this,data,...args);
  };
  async function* source(){for(let seq=1;seq<=20;seq++)yield encodeWireValue({v:1,type:'theme',scope:a.scope,seq,value:'dark'});}
  const producer=consumeContainerOutput(source(),encoded=>f.upstream.emit(encoded));
  try {
    const occurred=await Promise.race([failed.promise.then(()=>true),delay(500).then(()=>false)]);
    assert.equal(occurred,true,'later callback failure must not wait for the held earlier callback');
    const retired=await Promise.race([f.upstream.waitFor(frames=>frames.some(frame=>frame.type==='destroyView'&&frame.viewId===a.viewId)).then(()=>true),delay(500).then(()=>false)]);
    assert.equal(retired,true,'failure must retire its exact view promptly');
    await delay(10);assert.equal(afterFailure,0);assert.equal(new Set(attempts).size,attempts.length,'no frame is replayed');
  } finally {gate.resolve();await producer;Socket.prototype.write=originalWrite;}
  const b=await rawConnection(f);
  try {
    f.upstream.emit({v:1,type:'theme',scope:b.scope,seq:1,value:'dark'});
    assert.equal(decodeWireValue((await b.lines.next()).value).seq,1);
  } finally {b.socket.destroy();}
});

test('a delayed older broker write error is not lost after newer writes complete',async t=>{
 const f=await fixture(t),a=await rawConnection(f),originalWrite=Socket.prototype.write,gate=deferred();t.after(()=>a.socket.destroy());
 let held=false,attempts=[],pulled=0;
 Socket.prototype.write=function(data,...args){
   if(typeof data==='string'&&data.includes(a.viewId)) {
     let frame;try{frame=decodeWireValue(data.trimEnd());}catch{}
     if(frame?.type==='theme') {
       attempts.push(frame.seq);
       if(frame.seq===8){const i=args.length-1,callback=args[i];args[i]=()=>{held=true;void gate.promise.then(()=>callback(new Error('delayed tail error')));};}
     }
   }
   return originalWrite.call(this,data,...args);
 };
 async function* source(){for(let seq=1;seq<=20;seq++){pulled++;yield encodeWireValue({v:1,type:'theme',scope:a.scope,seq,value:'dark'});}}
 const producer=consumeContainerOutput(source(),encoded=>f.upstream.emit(encoded));
 try {
   await waitUntil(()=>held&&pulled>=15);assert.ok(attempts.includes(9));gate.resolve();
   await f.upstream.waitFor(frames=>frames.some(frame=>frame.type==='destroyView'&&frame.viewId===a.viewId));
   await producer;assert.equal(new Set(attempts).size,attempts.length,'no frame is replayed');
 } finally {gate.resolve();await producer;Socket.prototype.write=originalWrite;}
});
