import test from "node:test";
import assert from "node:assert/strict";
import { ThreadRealtime } from "./realtime.js";
import type { Json } from "../core/json.js";
function fixture(version: string | undefined = "0.165.0") {
  const calls: string[] = [];
  let accountRevision = 1;
  let manager: ThreadRealtime;
  manager = new ThreadRealtime({
    snapshot: () => ({
      connected: true,
      scope: "native",
      generation: 1,
      accountRevision,
      nativeVersion: version,
    }),
    raw: async (method, _params, options): Promise<Json> => {
      options?.beforeSend?.();
      calls.push(method);
      if (method === "account/read")
        return { account: null, requiresOpenaiAuth: false };
      if (method === "thread/loaded/list") return { data: ["thread"] };
      if (method === "thread/read")
        return { thread: { id: "thread", cwd: "/project" } };
      if (method === "thread/realtime/start") {
        manager.observe("thread/realtime/started", {
          threadId: "thread",
          realtimeSessionId: "call-one",
        });
        manager.observe("thread/realtime/sdp", {
          threadId: "thread",
          sdp: "v=0\r\nanswer",
        });
      }
      return {};
    },
  });
  return { manager, calls, changeAccount: () => accountRevision++ };
}
test("concurrent preflights cannot exceed the fixed voice context budget", async () => {
  const f = fixture();
  const results = await Promise.allSettled(
    Array.from({ length: 40 }, () =>
      f.manager.preflight({ threadId: "thread" }),
    ),
  );
  assert.equal(
    results.filter((value) => value.status === "fulfilled").length,
    32,
  );
  assert.equal(
    results.filter((value) => value.status === "rejected").length,
    8,
  );
  assert.ok(
    !f.calls.some((method) =>
      /realtime\/(start|stop)|resume|turn\/start/.test(method),
    ),
  );
  f.manager.invalidate();
});
test("realtime uses fixed WebRTC protocol, explicit replace confirmation and exact owned stop", async () => {
  const f = fixture(),
    context = await f.manager.preflight({ threadId: "thread" });
  await assert.rejects(
    f.manager.start({
      contextToken: context.contextToken,
      threadId: "thread",
      sdp: "v=0\r\noffer",
      replaceExisting: false,
    }),
    /confirm/,
  );
  const result = await f.manager.start({
    contextToken: context.contextToken,
    threadId: "thread",
    sdp: "v=0\r\noffer",
    replaceExisting: true,
  });
  assert.equal(result.sdp, "v=0\r\nanswer");
  await f.manager.stop({
    contextToken: context.contextToken,
    threadId: "thread",
  });
  assert.equal(
    f.calls.filter((method) => method === "thread/realtime/start").length,
    1,
  );
  assert.equal(
    f.calls.filter((method) => method === "thread/realtime/stop").length,
    1,
  );
  assert.ok(!f.calls.some((method) => /resume|turn\/start/.test(method)));
});
test("same-value account revisions and a foreign restarted voice revoke the original stop authority", async () => {
  const f = fixture(),
    context = await f.manager.preflight({ threadId: "thread" });
  await f.manager.start({
    contextToken: context.contextToken,
    threadId: "thread",
    sdp: "v=0\r\noffer",
    replaceExisting: true,
  });
  f.manager.observe("thread/realtime/started", {
    threadId: "thread",
    realtimeSessionId: "other-call",
  });
  await assert.rejects(
    f.manager.stop({ contextToken: context.contextToken, threadId: "thread" }),
    /changed|revoked/,
  );
  assert.ok(!f.calls.includes("thread/realtime/stop"));
  const other = fixture(),
    next = await other.manager.preflight({ threadId: "thread" });
  other.changeAccount();
  await assert.rejects(
    other.manager.start({
      contextToken: next.contextToken,
      threadId: "thread",
      sdp: "v=0\r\noffer",
      replaceExisting: true,
    }),
    /changed|revoked/,
  );
});
test("typed realtime text remains bound to the captured thread and submitted intent", async () => {
  const f = fixture(),
    context = await f.manager.preflight({ threadId: "thread" });
  await f.manager.start({
    contextToken: context.contextToken,
    threadId: "thread",
    sdp: "v=0\r\noffer",
    replaceExisting: true,
  });
  const input = {
    contextToken: context.contextToken,
    threadId: "thread",
    text: "typed voice message",
    intentId: "text-intent",
  };
  await assert.rejects(
    f.manager.appendText({ ...input, threadId: "another-thread" }),
  );
  await f.manager.appendText(input);
  await assert.rejects(f.manager.appendText(input), /already submitted/);
  assert.equal(
    f.calls.filter((method) => method === "thread/realtime/appendText").length,
    1,
  );
});
test("completed and cancelled voice contexts do not exhaust the bounded preflight budget", async () => {
  const f = fixture();
  for (let index = 0; index < 40; index++) {
    const context = await f.manager.preflight({ threadId: "thread" });
    if (index % 2 === 0)
      await f.manager.start({
        contextToken: context.contextToken,
        threadId: "thread",
        sdp: "v=0\r\noffer",
        replaceExisting: true,
      });
    await f.manager.stop({
      contextToken: context.contextToken,
      threadId: "thread",
    });
  }
  assert.equal(
    f.calls.filter((method) => method === "thread/realtime/start").length,
    20,
  );
  assert.equal(
    f.calls.filter((method) => method === "thread/realtime/stop").length,
    20,
  );
});

test("verified 0.163 realtime uses the same exact scoped native protocol", async () => {
  const f = fixture("0.163.0");
  const context = await f.manager.preflight({ threadId: "thread" });
  await f.manager.start({
    contextToken: context.contextToken,
    threadId: "thread",
    sdp: "v=0\r\noffer",
    replaceExisting: true,
  });
  await f.manager.stop({
    contextToken: context.contextToken,
    threadId: "thread",
  });
  assert.equal(
    f.calls.filter((method) => method === "thread/realtime/start").length,
    1,
  );
  assert.equal(
    f.calls.filter((method) => method === "thread/realtime/stop").length,
    1,
  );
});

test("unverified adjacent and prerelease native versions stay blocked without realtime writes", async () => {
  for (const version of ["0.164.0", "0.166.0", "0.163.0-alpha.1", "unknown"]) {
    const f = fixture(version);
    await assert.rejects(
      f.manager.preflight({ threadId: "thread" }),
      /not been verified/,
    );
    assert.ok(!f.calls.some((method) => method.startsWith("thread/realtime/")));
  }
});
