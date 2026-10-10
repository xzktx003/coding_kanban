import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { FollowupSubmit } from "@agent-orchestrator/shared";

import { CodexFollowups, type FollowupRuntime } from "./codex-followups.js";
import { SessionCodexFeishuReplyService } from "./session-codex-feishu-reply-service.js";

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

function thread(overrides: Record<string, unknown> = {}) {
  return { thread: { id: "thread-one", ...overrides } };
}

test("queues a verified native thread reply with a stable Feishu request id", async () => {
  const submitted: FollowupSubmit[] = [];
  const service = new SessionCodexFeishuReplyService({
    readThread: async () => thread(),
    submit: async (input) => {
      submitted.push(input);
    },
  });

  await service.send({
    messageId: "om_reply_one",
    threadId: "thread-one",
    text: "继续处理",
  });

  assert.deepEqual(submitted, [
    {
      id: "feishu:om_reply_one",
      threadId: "thread-one",
      text: "继续处理",
      images: [],
      parameters: {},
      mode: "queue",
    },
  ]);
});

test("rejects identity mismatches before a task can be started", async () => {
  const submitted: FollowupSubmit[] = [];
  const service = new SessionCodexFeishuReplyService({
    readThread: async () => thread({ id: "other-thread" }),
    submit: async (input) => {
      submitted.push(input);
    },
  });

  await assert.rejects(
    service.send({
      messageId: "om_reply_one",
      threadId: "thread-one",
      text: "继续处理",
    }),
    /目标会话不可用/,
  );
  assert.deepEqual(submitted, []);
});

test("keeps active native tasks queued and duplicate message ids do not duplicate runtime sends", async () => {
  const states: Record<string, string> = { "thread-one": "active" };
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const runtime: FollowupRuntime = {
    statuses: async (ids) =>
      Object.fromEntries(ids.map((id) => [id, states[id] ?? "idle"])),
    call: async (method, params) => {
      calls.push({ method, params });
      return { turn: { id: `turn-${params.clientUserMessageId}` } };
    },
  };
  const queue = new CodexFollowups(runtime);
  const service = new SessionCodexFeishuReplyService({
    readThread: async () => thread(),
    submit: (input) => queue.submit(input),
  });

  await service.send({
    messageId: "om_reply_one",
    threadId: "thread-one",
    text: "继续处理",
  });
  await queue.tick();
  assert.equal(calls.length, 0);

  states["thread-one"] = "idle";
  await queue.tick();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "turn/start");
  assert.equal(calls[0].params.threadId, "thread-one");
  assert.equal(calls[0].params.clientUserMessageId, "feishu:om_reply_one");

  await service.send({
    messageId: "om_reply_one",
    threadId: "thread-one",
    text: "继续处理",
  });
  await queue.tick();
  assert.equal(calls.length, 1);
});

test("does not resume a paused native queue when a Feishu reply arrives", async () => {
  const states: Record<string, string> = { "thread-one": "idle" };
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const queue = new CodexFollowups({
    statuses: async (ids) =>
      Object.fromEntries(ids.map((id) => [id, states[id] ?? "idle"])),
    call: async (method, params) => {
      calls.push({ method, params });
      return { turn: { id: `turn-${params.clientUserMessageId}` } };
    },
  });
  await queue.submit({
    id: "old",
    threadId: "thread-one",
    text: "old",
    images: [],
    parameters: {},
    mode: "queue",
  });
  let snapshot = await queue.get("thread-one");
  snapshot = await queue.change("thread-one", snapshot.revision, {
    type: "pause",
  });
  assert.ok(snapshot.paused);

  const service = new SessionCodexFeishuReplyService({
    readThread: async () => thread(),
    submit: (input) => queue.submit(input),
  });

  await service.send({
    messageId: "om_reply_two",
    threadId: "thread-one",
    text: "new",
  });
  await queue.tick();

  assert.equal(calls.length, 0);
  assert.equal((await queue.get("thread-one")).items.length, 2);
});

test("saves Feishu images as private session attachments before queueing", async () => {
  const root = await mkdtemp(join(tmpdir(), "session-feishu-reply-"));
  try {
    const submitted: FollowupSubmit[] = [];
    const service = new SessionCodexFeishuReplyService({
      attachmentRoot: root,
      readThread: async () => thread(),
      submit: async (input) => {
        submitted.push(input);
      },
    });

    await service.send({
      messageId: "om_reply_one",
      threadId: "thread-one",
      text: "看图继续",
      image: { image: png, imageExtension: "png" },
    });

    assert.equal(submitted.length, 1);
    assert.equal(submitted[0].images.length, 1);
    assert.ok(submitted[0].images[0].startsWith(root + "/"));
    assert.deepEqual(await readFile(submitted[0].images[0]), png);
    assert.equal((await stat(submitted[0].images[0])).mode & 0o777, 0o600);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("propagates queue submission failures to the caller", async () => {
  const service = new SessionCodexFeishuReplyService({
    readThread: async () => thread(),
    submit: async () => {
      throw new Error("queue offline");
    },
  });

  await assert.rejects(
    service.send({
      messageId: "om_reply_one",
      threadId: "thread-one",
      text: "继续处理",
    }),
    /queue offline/,
  );
});
