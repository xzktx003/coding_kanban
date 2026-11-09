import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import * as writes from "../src/container-write-guard.mjs";
import * as service from "../src/container-service.mjs";
import { encodeWireValue } from "../src/wire-value.mjs";

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const runBatch =
  writes.runAuthorizedContainerBatch ??
  (async (entries, verify, prepare) => {
    for (const entry of entries)
      await writes.runAuthorizedContainerWrite(
        entry,
        verify,
        () => prepare([entry])[0],
      );
  });
function entries(count = 8, events = []) {
  return Array.from({ length: count }, (_, index) => ({
    encoded: "fixed-frame-" + index,
    signal: new AbortController().signal,
    deadline: performance.now() + 1000,
    onDispatch: () => events.push("dispatch-" + index),
  }));
}

test("eight immutable writes share one fresh verification and no await separates their actual writes", async () => {
  const events = [];
  let checks = 0,
    interleaved = false;
  await runBatch(
    entries(8, events),
    async () => {
      checks++;
      return true;
    },
    (batch) =>
      batch.map((entry, index) => () => {
        assert.equal(interleaved, false);
        events.push("write-" + index);
        if (index === 0)
          queueMicrotask(() => {
            interleaved = true;
          });
        return Promise.resolve();
      }),
  );
  assert.equal(checks, 1);
  assert.deepEqual(
    events,
    Array.from({ length: 8 }, (_, index) => [
      "dispatch-" + index,
      "write-" + index,
    ]).flat(),
  );
});

test("caller mutation during verification cannot replace batch payloads or dispatch callbacks", async () => {
  const source = entries(2),
    gate = deferred(),
    entered = deferred(),
    actual = [];
  const operation = runBatch(
    source,
    async () => {
      entered.resolve();
      await gate.promise;
      return true;
    },
    (batch) =>
      batch.map((entry) => () => {
        actual.push(entry.encoded);
        return Promise.resolve();
      }),
  );
  await entered.promise;
  source[1].encoded = "changed";
  source[1].onDispatch = () => {
    throw Error("changed callback");
  };
  gate.resolve();
  await operation;
  assert.deepEqual(actual, ["fixed-frame-0", "fixed-frame-1"]);
});

test("abort or expiry during full verification prevents every write", async () => {
  for (const expiry of [false, true]) {
    const source = entries(2),
      controller = new AbortController(),
      gate = deferred(),
      entered = deferred();
    source[1].signal = controller.signal;
    if (expiry) source[1].deadline = performance.now() + 15;
    let actual = 0;
    const operation = runBatch(
      source,
      async () => {
        entered.resolve();
        await gate.promise;
        return true;
      },
      (batch) => batch.map(() => () => actual++),
    );
    const rejected = assert.rejects(operation, {
      code: "CONTAINER_WRITE_ABORTED",
    });
    await entered.promise;
    if (expiry) await new Promise((resolve) => setTimeout(resolve, 25));
    else controller.abort();
    gate.resolve();
    await rejected;
    assert.equal(actual, 0);
  }
});

test("abort from the dispatch callback is rechecked without requiring project mounts", async () => {
  const source = entries(2),
    controller = new AbortController();
  source[0].signal = controller.signal;
  source[0].onDispatch = () => controller.abort();
  let actual = 0;
  await assert.rejects(
    runBatch(
      source,
      async () => true,
      (batch) => batch.map(() => () => actual++),
    ),
    { code: "CONTAINER_WRITE_ABORTED" },
  );
  assert.equal(actual, 0);
});

test("a failing prefix never writes the remaining suffix or retries an earlier write", async () => {
  const source = entries(8),
    actual = [];
  await assert.rejects(
    runBatch(
      source,
      async () => true,
      (batch) =>
        batch.map((entry, index) => () => {
          actual.push(index);
          if (index === 2) throw Error("unknown prefix");
          return Promise.resolve();
        }),
    ),
    /unknown prefix/,
  );
  assert.deepEqual(actual, [0, 1, 2]);
});

test("batch admission rejects unsupported sizes and accessors before identity work", async () => {
  assert.equal(typeof writes.runAuthorizedContainerBatch, "function");
  for (const batch of [[], entries(9), null]) {
    let checks = 0;
    await assert.rejects(
      writes.runAuthorizedContainerBatch(
        batch,
        async () => {
          checks++;
          return true;
        },
        () => [],
      ),
    );
    assert.equal(checks, 0);
  }
  const source = entries(1);
  let called = false;
  Object.defineProperty(source[0], "encoded", {
    get() {
      called = true;
      return "x";
    },
  });
  await assert.rejects(
    writes.runAuthorizedContainerBatch(
      source,
      async () => true,
      () => [],
    ),
  );
  assert.equal(called, false);
});

test("ordinary batch protocol refuses old sequences, foreign scopes, cross-view batches and lifecycle messages", () => {
  assert.equal(typeof service.inspectContainerOrdinaryBatch, "function");
  const profileId = randomUUID(),
    generation = randomUUID(),
    viewId = randomUUID();
  const state = {
    profileId,
    generation,
    views: new Set([viewId]),
    closingViews: new Set(),
    sequences: new Map([[viewId, 3]]),
  };
  const frame = (seq) => ({
    v: 1,
    type: "portPost",
    scope: { profileId, generation, viewId },
    seq,
    id: seq,
    portId: "app-host-1",
    data: { request: seq },
  });
  const batch = [4, 5].map((seq) => ({ encoded: encodeWireValue(frame(seq)) }));
  assert.equal(service.inspectContainerOrdinaryBatch(batch, state).length, 2);
  for (const frames of [
    [frame(3)],
    [frame(4), frame(6)],
    [{ ...frame(4), scope: { profileId, generation: randomUUID(), viewId } }],
    [{ ...frame(4), type: "destroyView", viewId }],
    [
      frame(4),
      { ...frame(5), scope: { profileId, generation, viewId: randomUUID() } },
    ],
  ])
    assert.throws(
      () =>
        service.inspectContainerOrdinaryBatch(
          frames.map((value) => ({ encoded: encodeWireValue(value) })),
          state,
        ),
      { code: "CONTAINER_PROTOCOL_ERROR" },
    );
  state.closingViews.add(viewId);
  assert.throws(() => service.inspectContainerOrdinaryBatch(batch, state), {
    code: "CONTAINER_PROTOCOL_ERROR",
  });
});
