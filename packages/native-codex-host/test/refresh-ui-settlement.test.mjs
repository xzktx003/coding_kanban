import assert from "node:assert/strict";
import test from "node:test";
import { waitForOriginalComposerSettlement } from "../../../tests/e2e/codex-refresh-ui-settlement.mjs";

const threadId = "019aabcd-1234-7890-abcd-0123456789ab";
const idle = {
  threadId,
  targetCount: 1,
  editorCount: 1,
  editorVisible: true,
  editorEmpty: true,
  busy: false,
  sendCount: 1,
  stopCount: 0,
  queueCount: 0,
  resumeCount: 0,
};

test("only confirmed interruption permits the official empty-composer Resume action", async () => {
  const state = { ...idle, sendCount: 0, resumeCount: 1 };
  const frame = { evaluate: async () => state };
  const result = await waitForOriginalComposerSettlement({
    frame,
    threadId,
    expectedTurnStatus: "interrupted",
    timeoutMs: 50,
    pollMs: 1,
  });
  assert.equal(result.samples, 1);
  assert.equal(result.submitAction, "resume");
  await assert.rejects(
    waitForOriginalComposerSettlement({
      frame,
      threadId,
      timeoutMs: 10,
      pollMs: 1,
    }),
    /did not settle/i,
  );
  await assert.rejects(
    waitForOriginalComposerSettlement({
      frame: { evaluate: async () => idle },
      threadId,
      expectedTurnStatus: "failed",
      timeoutMs: 10,
    }),
    /terminal|status/i,
  );
});

test("interrupted settlement still rejects busy, queued, retained or ambiguous controls", async () => {
  for (const state of [
    { ...idle, sendCount: 0, resumeCount: 1, busy: true },
    { ...idle, sendCount: 0, resumeCount: 1, stopCount: 1 },
    { ...idle, sendCount: 0, resumeCount: 1, queueCount: 1 },
    { ...idle, sendCount: 0, resumeCount: 1, editorEmpty: false },
    { ...idle, resumeCount: 1 },
    { ...idle, sendCount: 0, resumeCount: 0 },
  ])
    await assert.rejects(
      waitForOriginalComposerSettlement({
        frame: { evaluate: async () => state },
        threadId,
        expectedTurnStatus: "interrupted",
        timeoutMs: 10,
        pollMs: 1,
      }),
      /did not settle/i,
    );
});

test("native completion alone does not settle an uncleared or busy official composer", async () => {
  const states = [
    { ...idle, editorEmpty: false, busy: true, queueCount: 1, sendCount: 0 },
    { ...idle, busy: true },
    { ...idle, stopCount: 1 },
    idle,
  ];
  let calls = 0;
  const frame = {
    evaluate: async (_read, input) => {
      assert.equal(input, threadId);
      return states[Math.min(calls++, states.length - 1)];
    },
  };
  const result = await waitForOriginalComposerSettlement({
    frame,
    threadId,
    timeoutMs: 1000,
    pollMs: 1,
  });
  assert.equal(calls, 4);
  assert.equal(result.samples, 4);
  assert.ok(Number.isFinite(result.settledAt));
});

test("clearing the wrong thread or a duplicated native editor never settles", async () => {
  for (const state of [
    { ...idle, threadId: "019aabcd-1234-7890-abcd-0123456789ac" },
    { ...idle, targetCount: 2 },
    { ...idle, editorCount: 2 },
  ]) {
    await assert.rejects(
      waitForOriginalComposerSettlement({
        frame: { evaluate: async () => state },
        threadId,
      }),
      /target|editor/i,
    );
  }
});

test("missing observation fields cannot be interpreted as an idle composer", async () => {
  for (const state of [
    null,
    {},
    { ...idle, busy: undefined },
    { ...idle, editorEmpty: undefined },
    { ...idle, sendCount: undefined },
    { ...idle, resumeCount: undefined },
  ]) {
    await assert.rejects(
      waitForOriginalComposerSettlement({
        frame: { evaluate: async () => state },
        threadId,
      }),
      /observation|state/i,
    );
  }
});

test("a retained draft, hidden editor, queue, or absent Send times out without modifying the native frame", async () => {
  for (const state of [
    { ...idle, editorEmpty: false },
    { ...idle, editorVisible: false },
    { ...idle, queueCount: 1 },
    { ...idle, sendCount: 0 },
  ]) {
    await assert.rejects(
      waitForOriginalComposerSettlement({
        frame: { evaluate: async () => state },
        threadId,
        timeoutMs: 10,
        pollMs: 1,
      }),
      /did not settle/i,
    );
  }
});

test("native frame failure is propagated and no body is retained in settlement evidence", async () => {
  const failure = Error("owned native document navigated");
  await assert.rejects(
    waitForOriginalComposerSettlement({
      frame: {
        evaluate: async () => {
          throw failure;
        },
      },
      threadId,
    }),
    (error) => error === failure,
  );
  const result = await waitForOriginalComposerSettlement({
    frame: {
      evaluate: async () => ({ ...idle, body: "must not be retained" }),
    },
    threadId,
  });
  assert.deepEqual(Object.keys(result).sort(), [
    "elapsedMs",
    "samples",
    "settledAt",
    "submitAction",
  ]);
});

test("settlement requires an exact UUID and bounded timeout/poll configuration", async () => {
  for (const input of [
    { threadId: "../wrong" },
    { threadId: [threadId] },
    { timeoutMs: Infinity },
    { timeoutMs: 60001 },
    { timeoutMs: 0 },
    { pollMs: 0 },
    { pollMs: 1001 },
  ]) {
    await assert.rejects(
      waitForOriginalComposerSettlement({
        frame: { evaluate: async () => idle },
        threadId,
        ...input,
      }),
      /bounded|UUID/i,
    );
  }
});

test("a frozen original frame cannot keep the settlement check pending indefinitely", async () => {
  await assert.rejects(
    waitForOriginalComposerSettlement({
      frame: { evaluate: () => new Promise(() => {}) },
      threadId,
      timeoutMs: 10,
    }),
    /did not settle/i,
  );
});

test("a settlement timeout retains only the last bounded control observation", async () => {
  const state = { ...idle, busy: true, sendCount: 0, stopCount: 1 };
  await assert.rejects(
    waitForOriginalComposerSettlement({
      frame: { evaluate: async () => ({ ...state, body: "private body" }) },
      threadId,
      timeoutMs: 10,
      pollMs: 1,
    }),
    (error) => {
      assert.equal(error.code, "ORIGINAL_COMPOSER_NOT_SETTLED");
      assert.deepEqual(error.observation, state);
      assert.ok(error.samples >= 1);
      assert.ok(error.elapsedMs >= 0);
      assert.equal(JSON.stringify(error).includes("private body"), false);
      return true;
    },
  );
});
