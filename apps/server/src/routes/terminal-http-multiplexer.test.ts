import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { buildServer } from "../app.js";

type ReadyFrame = { type: "ready"; streamId: string };
type OutputFrame = {
  type: "frame";
  subscriptionId: string;
  agentSessionId: string;
  frame: string;
};

async function readNdjsonLine(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  state: { pending: string },
): Promise<unknown> {
  const decoder = new TextDecoder();
  while (true) {
    const newlineIndex = state.pending.indexOf("\n");
    if (newlineIndex >= 0) {
      const line = state.pending.slice(0, newlineIndex);
      state.pending = state.pending.slice(newlineIndex + 1);
      if (!line) continue;
      return JSON.parse(line) as unknown;
    }

    const { done, value } = await reader.read();
    assert.equal(done, false);
    state.pending += decoder.decode(value, { stream: true });
  }
}

test("terminal multiplex stream shares one HTTP connection across subscriptions", async () => {
  const { app, registry } = buildServer();
  const first = registry.register({
    workspaceId: "default",
    sourceType: "local",
    agentKind: "codex",
    displayName: "mux first",
    workingDirectory: process.cwd(),
  });
  const second = registry.register({
    workspaceId: "default",
    sourceType: "local",
    agentKind: "codex",
    displayName: "mux second",
    workingDirectory: process.cwd(),
  });
  registry.appendOutput(first.id, `${"甲".repeat(2_000)}-first-tail`, "stdout");
  registry.appendOutput(second.id, "second-output", "stdout");

  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const controller = new AbortController();

  try {
    const streamResponse = await fetch(`${baseUrl}/api/terminal-stream`, {
      signal: controller.signal,
    });
    assert.equal(streamResponse.status, 200);
    assert.match(
      streamResponse.headers.get("content-type") ?? "",
      /^application\/x-ndjson/,
    );
    assert.ok(streamResponse.body);
    const reader = streamResponse.body.getReader();
    const state = { pending: "" };

    const ready = (await readNdjsonLine(reader, state)) as ReadyFrame;
    assert.equal(ready.type, "ready");
    assert.match(ready.streamId, /.+/);

    const subscriptions = [
      { agentSessionId: first.id, subscriptionId: randomUUID() },
      { agentSessionId: second.id, subscriptionId: randomUUID() },
    ];
    for (const subscription of subscriptions) {
      const subscribeResponse = await fetch(
        `${baseUrl}/api/terminal-stream/${ready.streamId}/subscriptions`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...subscription, replayBytes: 1024 }),
        },
      );
      assert.equal(subscribeResponse.status, 200);
      assert.deepEqual(await subscribeResponse.json(), { ok: true });
    }

    const frames: OutputFrame[] = [];
    while (frames.length < 4) {
      frames.push((await readNdjsonLine(reader, state)) as OutputFrame);
    }

    assert.ok(frames.every((frame) => frame.type === "frame"));
    assert.deepEqual(
      frames.map((frame) => frame.agentSessionId),
      [first.id, first.id, second.id, second.id],
    );
    assert.deepEqual(
      frames.map((frame) => frame.subscriptionId),
      [
        subscriptions[0]!.subscriptionId,
        subscriptions[0]!.subscriptionId,
        subscriptions[1]!.subscriptionId,
        subscriptions[1]!.subscriptionId,
      ],
    );
    const firstReplay = JSON.parse(frames[0]!.frame) as { data?: string };
    assert.match(firstReplay.data ?? "", /-first-tail$/);
    assert.ok(Buffer.byteLength(firstReplay.data ?? "", "utf8") <= 1024);
    assert.equal(JSON.parse(frames[1]!.frame).event, "replay-complete");
    assert.match(JSON.parse(frames[2]!.frame).data ?? "", /second-output/);
    assert.equal(JSON.parse(frames[3]!.frame).event, "replay-complete");
  } finally {
    controller.abort();
    app.server.closeAllConnections();
    await app.close();
  }
});

test("terminal multiplex subscription lifecycle is idempotent and validates missing targets", async () => {
  const { app, registry } = buildServer();
  const session = registry.register({
    workspaceId: "default",
    sourceType: "local",
    agentKind: "codex",
    displayName: "mux lifecycle",
    workingDirectory: process.cwd(),
  });
  const otherSession = registry.register({
    workspaceId: "default",
    sourceType: "local",
    agentKind: "codex",
    displayName: "mux conflict",
    workingDirectory: process.cwd(),
  });

  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const controller = new AbortController();

  try {
    const streamResponse = await fetch(`${baseUrl}/api/terminal-stream`, {
      signal: controller.signal,
    });
    assert.ok(streamResponse.body);
    const reader = streamResponse.body.getReader();
    const ready = (await readNdjsonLine(reader, { pending: "" })) as ReadyFrame;

    const subscribeUrl = `${baseUrl}/api/terminal-stream/${ready.streamId}/subscriptions`;
    const subscriptionId = randomUUID();
    const subscribeBody = JSON.stringify({
      agentSessionId: session.id,
      subscriptionId,
    });
    for (let index = 0; index < 2; index += 1) {
      const response = await fetch(subscribeUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: subscribeBody,
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { ok: true });
    }

    const conflictResponse = await fetch(subscribeUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agentSessionId: otherSession.id,
        subscriptionId,
      }),
    });
    assert.equal(conflictResponse.status, 409);
    assert.deepEqual(await conflictResponse.json(), {
      error: "终端订阅 ID 已绑定其他会话",
    });

    const deleteResponse = await fetch(
      `${baseUrl}/api/terminal-stream/${ready.streamId}/subscriptions/${subscriptionId}`,
      { method: "DELETE" },
    );
    assert.equal(deleteResponse.status, 200);
    assert.deepEqual(await deleteResponse.json(), { ok: true });

    const missingSessionResponse = await fetch(subscribeUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agentSessionId: "missing-session",
        subscriptionId: randomUUID(),
      }),
    });
    assert.equal(missingSessionResponse.status, 404);
    assert.deepEqual(await missingSessionResponse.json(), {
      error: "没有找到 PTY 会话",
      code: "TERMINAL_SESSION_NOT_FOUND",
    });

    const missingStreamResponse = await fetch(
      `${baseUrl}/api/terminal-stream/missing-stream/subscriptions`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: subscribeBody,
      },
    );
    assert.equal(missingStreamResponse.status, 404);
    assert.deepEqual(await missingStreamResponse.json(), {
      error: "终端流已断开",
      code: "TERMINAL_STREAM_NOT_FOUND",
    });

    const invalidReplayResponse = await fetch(subscribeUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agentSessionId: session.id,
        subscriptionId: randomUUID(),
        replayBytes: 0,
      }),
    });
    assert.equal(invalidReplayResponse.status, 400);
    assert.deepEqual(await invalidReplayResponse.json(), {
      error: "终端回放窗口无效",
      code: "TERMINAL_REPLAY_BYTES_INVALID",
    });
  } finally {
    controller.abort();
    app.server.closeAllConnections();
    await app.close();
  }
});
