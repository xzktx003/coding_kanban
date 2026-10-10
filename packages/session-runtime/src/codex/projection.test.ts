import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sanitizeCodexNotification,
  sanitizeCodexHistory,
  projectCodexChatEvent,
  projectCodexHistoryPage,
} from "./projection.js";
import type { JsonObject } from "../core/json.js";
import type { SeqEvent } from "../core/events.js";

const body = "PRIVATE_TOOL_BODY".repeat(200_000);
const notification = (method: string, params: JsonObject): JsonObject => ({
  method,
  params,
});
test("internal notifications keep native tool bodies and public reasoning summaries", () => {
  const tool = notification("item/completed", {
    threadId: "t",
    turnId: "u",
    item: { id: "i", type: "commandExecution", aggregatedOutput: body },
  });
  assert.equal(sanitizeCodexNotification(tool), tool);
  const summary = notification("item/reasoning/summaryTextDelta", {
    threadId: "t",
    turnId: "u",
    itemId: "i",
    delta: "Public summary",
  });
  assert.equal(sanitizeCodexNotification(summary), summary);
  assert.equal(
    sanitizeCodexNotification(
      notification("item/reasoning/textDelta", { delta: "private" }),
    ),
    null,
  );
  assert.equal(
    sanitizeCodexNotification(
      notification("rawResponseItem/completed", {
        item: { type: "reasoning", content: ["private"] },
      }),
    ),
    null,
  );
});
test("nested history strips raw reasoning without mutating native objects or losing turn identity", () => {
  const history: JsonObject = {
    thread: {
      id: "t",
      status: { type: "idle" },
      turns: [
        {
          id: "u",
          status: "completed",
          items: [
            {
              id: "r",
              type: "reasoning",
              summary: ["Public"],
              content: ["raw private"],
              encryptedContent: "encrypted",
            },
            { id: "a", type: "agentMessage", text: "final answer" },
            { id: "i", type: "commandExecution", aggregatedOutput: body },
          ],
        },
      ],
    },
  };
  const result = sanitizeCodexHistory(history) as any;
  assert.deepEqual(result.thread.turns[0].items[0], {
    id: "r",
    type: "reasoning",
    summary: ["Public"],
    content: [],
  });
  assert.equal(result.thread.turns[0].items[1].text, "final answer");
  assert.equal(result.thread.turns[0].items[2].aggregatedOutput, body);
  assert.equal(
    (history.thread as any).turns[0].items[0].content[0],
    "raw private",
  );
  assert.equal(result.thread.id, "t");
  assert.equal(result.thread.turns[0].id, "u");
  assert.equal(sanitizeCodexHistory(result), result);
});
test("chat projection retains every event sequence, lifecycle and real approval payload", () => {
  const events: SeqEvent[] = [
    {
      seq: 1,
      event: "codex:notification",
      payload: notification("item/commandExecution/outputDelta", {
        threadId: "t",
        turnId: "u",
        itemId: "i",
        delta: body,
      }),
    },
    {
      seq: 2,
      event: "codex/approval-request",
      payload: {
        threadId: "t",
        turnId: "u",
        itemId: "i",
        requestId: 4,
        requestToken: "instance:nonce",
        type: "commandExecution",
        command: "rm thing",
        reason: "explain",
        availableDecisions: ["accept", "decline"],
      },
    },
    {
      seq: 3,
      event: "codex:notification",
      payload: notification("turn/completed", {
        threadId: "t",
        turn: {
          id: "u",
          status: "completed",
          items: [{ id: "a", type: "agentMessage", text: "final answer" }],
        },
      }),
    },
  ];
  const projected = events.map(projectCodexChatEvent);
  assert.deepEqual(
    projected.map((e) => e.seq),
    [1, 2, 3],
  );
  assert.equal(projected[1], events[1]);
  assert.ok(JSON.stringify(projected).length < 2000);
  assert.match(JSON.stringify(projected), /final answer/);
  assert.doesNotMatch(JSON.stringify(projected), /PRIVATE_TOOL_BODY/);
  assert.equal((events[0].payload.params as any).delta, body);
});
test("chat history page keeps cursors and subagent targets while tool metadata is bounded", () => {
  const page: JsonObject = {
    data: [
      {
        id: "u",
        status: "completed",
        items: [
          {
            id: "tool",
            type: "dynamicToolCall",
            namespace: "codex_app",
            tool: "create_thread",
            status: "completed",
            success: true,
            arguments: { prompt: body },
            contentItems: [
              {
                type: "inputText",
                text: JSON.stringify({
                  threadId: "child",
                  kind: "codex",
                  hostId: "host",
                }),
              },
            ],
          },
          {
            id: "spawn",
            type: "collabAgentToolCall",
            senderThreadId: "parent",
            receiverThreadIds: ["child"],
            prompt: body,
            agentsStates: { child: { status: "running", message: body } },
          },
          {
            id: "output",
            type: "commandExecution",
            command: body,
            aggregatedOutput: body,
          },
        ],
      },
    ],
    nextCursor: "cursor",
    hasMore: true,
  };
  const projected = projectCodexHistoryPage(page, "chat") as any;
  assert.equal(projected.nextCursor, "cursor");
  assert.equal(projected.hasMore, true);
  assert.deepEqual(projected.data[0].items[0].nativeTarget, {
    kind: "codex",
    threadId: "child",
    hostId: "host",
  });
  assert.ok(JSON.stringify(projected).length < 7000);
  assert.equal(projected.data[0].items[1].prompt.length, 1024);
  assert.equal(projected.data[0].items[2].transcriptMetadataOnly, true);
  assert.equal(projected.data[0].items[2].aggregatedOutput, null);
  assert.equal(projectCodexHistoryPage(projected, "chat"), projected);
});
test("full history projection preserves existing body detail access and does not trigger native RPC", () => {
  const page: JsonObject = {
    data: [
      {
        id: "item",
        type: "mcpToolCall",
        arguments: { q: "query" },
        result: { content: body },
      },
    ],
    nextCursor: null,
  };
  assert.equal(projectCodexHistoryPage(page, "full"), page);
});
