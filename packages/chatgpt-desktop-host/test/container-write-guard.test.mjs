import test from "node:test";
import assert from "node:assert/strict";
import {
  createInitialGrantAttempt,
  runAuthorizedContainerWrite,
} from "../src/container-write-guard.mjs";

test("abort during asynchronous identity verification cannot result in a late write", async () => {
  const controller = new AbortController();
  let reached,
    release,
    writes = 0;
  const entered = new Promise((done) => {
      reached = done;
    }),
    gate = new Promise((done) => {
      release = done;
    });
  const result = runAuthorizedContainerWrite(
    {
      signal: controller.signal,
      deadline: performance.now() + 1000,
      onDispatch: () => {},
    },
    async () => {
      reached();
      await gate;
      return true;
    },
    () => {
      writes++;
    },
  );
  const rejected = assert.rejects(result, { code: "CONTAINER_WRITE_ABORTED" });
  await entered;
  controller.abort();
  release();
  await rejected;
  assert.equal(writes, 0);
});

test("an expired deadline or denied identity never reaches the write operation", async () => {
  const controller = new AbortController();
  let checks = 0,
    writes = 0;
  await assert.rejects(
    runAuthorizedContainerWrite(
      {
        signal: controller.signal,
        deadline: performance.now() - 1,
        onDispatch: () => {},
      },
      async () => {
        checks++;
        return true;
      },
      () => {
        writes++;
      },
    ),
    { code: "CONTAINER_WRITE_ABORTED" },
  );
  await assert.rejects(
    runAuthorizedContainerWrite(
      {
        signal: controller.signal,
        deadline: performance.now() + 1000,
        onDispatch: () => {},
      },
      async () => false,
      () => {
        writes++;
      },
    ),
    { code: "CONTAINER_IDENTITY_CHANGED" },
  );
  assert.equal(checks, 0);
  assert.equal(writes, 0);
});

test("dispatch marker immediately precedes the actual write", async () => {
  const controller = new AbortController(),
    events = [];
  await runAuthorizedContainerWrite(
    {
      signal: controller.signal,
      deadline: performance.now() + 1000,
      onDispatch: () => events.push("dispatch"),
    },
    async () => {
      events.push("verified");
      return true;
    },
    () => {
      events.push("prepared");
      return () => events.push("write");
    },
  );
  assert.deepEqual(events, ["verified", "prepared", "dispatch", "write"]);
});

test("cancellation while synchronously preparing a frame occurs before dispatch", async () => {
  const controller = new AbortController(),
    events = [];
  await assert.rejects(
    runAuthorizedContainerWrite(
      {
        signal: controller.signal,
        deadline: performance.now() + 1000,
        onDispatch: () => events.push("dispatch"),
      },
      async () => true,
      () => {
        controller.abort();
        return () => events.push("write");
      },
    ),
    { code: "CONTAINER_WRITE_ABORTED" },
  );
  assert.deepEqual(events, []);
});

test("transport or queue preflight errors cannot be mistaken for dispatch", async () => {
  const controller = new AbortController(),
    events = [];
  await assert.rejects(
    runAuthorizedContainerWrite(
      {
        signal: controller.signal,
        deadline: performance.now() + 1000,
        onDispatch: () => events.push("dispatch"),
      },
      async () => true,
      () => {
        throw Object.assign(Error("full"), { code: "CONTAINER_QUEUE_FULL" });
      },
    ),
    { code: "CONTAINER_QUEUE_FULL" },
  );
  assert.deepEqual(events, []);
});

test("an unknown initial grant outcome retains possible native ownership and cannot be retried", async () => {
  const grant = createInitialGrantAttempt();
  let writes = 0;
  await assert.rejects(
    grant.send(async () => {
      writes++;
      throw new Error(
        "grant bytes may have arrived before the transport failed",
      );
    }),
  );
  assert.equal(grant.outcome, "unknown");
  await assert.rejects(
    grant.send(async () => {
      writes++;
    }),
    { code: "CONTAINER_GRANT_ALREADY_ATTEMPTED" },
  );
  assert.equal(writes, 1);
});

test("a confirmed initial grant remains recorded and cannot be resent as a new generation", async () => {
  const grant = createInitialGrantAttempt();
  assert.equal(grant.outcome, "not_attempted");
  await grant.send(async () => {});
  assert.equal(grant.outcome, "written");
  await assert.rejects(
    grant.send(async () => {}),
    { code: "CONTAINER_GRANT_ALREADY_ATTEMPTED" },
  );
});
