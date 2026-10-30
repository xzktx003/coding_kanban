import test from "node:test";
import assert from "node:assert/strict";
import {
  boundedAuxiliaryToolPreview,
  projectAuxiliaryChatEnvelope,
} from "./auxiliary-chat-projection.js";
test("preview budgets count escaped keys and exact primitive wire bytes", () => {
  const value = Object.fromEntries(
    Array.from({ length: 11 }, (_, index) => ["\0".repeat(1000) + index, 0]),
  );
  const preview = boundedAuxiliaryToolPreview(value);
  assert.equal(preview.truncated, true);
  assert.ok(Buffer.byteLength(JSON.stringify(preview.value)) <= 65536);
  const ordinary = {
    text: "readable ".repeat(2000),
    number: 123.5,
    boolean: true,
    nothing: null,
  };
  assert.equal(boundedAuxiliaryToolPreview(ordinary).value, ordinary);
  const small = boundedAuxiliaryToolPreview([true, false, null, 123.5], 26);
  assert.deepEqual(small, {
    value: [true, false, null, 123.5],
    truncated: false,
  });
  for (const input of [
    '\0\n\\"汉🧪\ud800'.repeat(1000),
    {
      ["\0汉🧪".repeat(40)]: [
        true,
        false,
        123456,
        null,
        "\ud800\udfff\n".repeat(1000),
      ],
    },
    Array.from({ length: 600 }, (_, index) => ({ index, text: "汉\t🧪" })),
  ])
    for (const budget of [4, 8, 16, 32, 64, 257, 65536])
      assert.ok(
        Buffer.byteLength(
          JSON.stringify(boundedAuxiliaryToolPreview(input, budget).value),
        ) <= budget,
      );
});
test("ACP live tool bodies are bounded before transport, retaining source identity/status and permissions exactly", () => {
  const large = "secret-output-".repeat(350_000);
  const envelope = {
    seq: 71,
    event: "acp-message",
    payload: {
      kind: "update",
      connectionId: "connection",
      agentId: "agent",
      sessionId: "one",
      historySourceId: 12,
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: "tool-1",
        status: "completed",
        title: "read source",
        rawOutput: large,
        content: [{ type: "content", content: { type: "text", text: large } }],
      },
    },
  };
  const projected = projectAuxiliaryChatEnvelope(envelope) as typeof envelope &
    any;
  assert.equal(projected.seq, 71);
  assert.equal(projected.payload.historySourceId, 12);
  assert.equal(projected.payload.sessionId, "one");
  assert.equal(projected.payload.update.toolCallId, "tool-1");
  assert.equal(projected.payload.update.status, "completed");
  assert.equal(projected.payload.update.truncated, true);
  assert.equal(projected.payload.update.historyDetail.itemId, "tool:tool-1");
  assert.ok(Buffer.byteLength(JSON.stringify(projected)) < 160 * 1024);
  assert.equal(JSON.stringify(projected).includes(large), false);
  const permission = {
    seq: 72,
    event: "acp-message",
    payload: {
      kind: "permission",
      sessionId: "one",
      requestId: "ask",
      options: [{ optionId: "yes", name: "Allow" }],
      toolCall: { rawInput: { command: "pwd" } },
    },
  };
  assert.equal(projectAuxiliaryChatEnvelope(permission), permission);
});
test("CC tool output/input previews are bounded without changing final replies, request messages or unrelated envelopes", () => {
  const large = "tool-".repeat(900_000);
  const envelope = {
    seq: 9,
    event: "cc-message",
    payload: {
      type: "user",
      uuid: "sdk-uuid",
      session_id: "session",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "tool-1",
            is_error: false,
            content: large,
          },
        ],
      },
    },
  };
  const projected = projectAuxiliaryChatEnvelope(envelope) as any;
  assert.equal(projected.seq, 9);
  assert.equal(projected.payload.uuid, "sdk-uuid");
  assert.equal(projected.payload.historyDetail.itemId, "sdk-uuid");
  assert.equal(projected.payload.message.content[0].tool_use_id, "tool-1");
  assert.equal(projected.payload.truncated, true);
  assert.ok(Buffer.byteLength(JSON.stringify(projected)) < 80 * 1024);
  const final = {
    seq: 10,
    event: "cc-message",
    payload: {
      type: "assistant",
      uuid: "final",
      session_id: "session",
      message: { content: [{ type: "text", text: "final answer" }] },
    },
  };
  assert.equal(projectAuxiliaryChatEnvelope(final), final);
  const permission = {
    seq: 11,
    event: "cc-permission-request",
    payload: { requestId: "ask", toolInput: { command: "pwd" } },
  };
  assert.equal(projectAuxiliaryChatEnvelope(permission), permission);
  const ordinary = {
    seq: 12,
    event: "acp-message",
    payload: {
      kind: "update",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "answer" },
      },
    },
  };
  assert.equal(projectAuxiliaryChatEnvelope(ordinary), ordinary);
});
test("multibyte and deeply nested arbitrary tool objects stay bounded and partial JSON is explicitly unloaded", () => {
  let value: any = "汉🧪".repeat(50000);
  for (let n = 0; n < 100; n++) value = { child: value };
  const envelope = {
    seq: 1,
    event: "acp-message",
    payload: {
      kind: "update",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "one",
        rawInput: value,
      },
    },
  };
  assert.ok(
    Buffer.byteLength(JSON.stringify(projectAuxiliaryChatEnvelope(envelope))) <
      80 * 1024,
  );
  const delta = {
    seq: 2,
    event: "cc-message",
    payload: {
      type: "stream_event",
      session_id: "one",
      event: {
        type: "content_block_delta",
        index: 0,
        delta: { type: "input_json_delta", partial_json: "x".repeat(100000) },
      },
    },
  };
  const projected = projectAuxiliaryChatEnvelope(delta) as any;
  assert.equal(projected.payload.event.delta.partial_json, "");
  assert.equal(projected.payload.truncated, true);
});
