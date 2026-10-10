import assert from "node:assert/strict";
import { test } from "node:test";
import { projectCodexPriorConversation } from "./codex-cloud-history.js";
test("prior conversation uses native message order, only completed assistant text, and last retained turn diff", () => {
  const thread = {
    turns: [
      {
        status: "completed",
        diff: "--- a/a\n+++ b/a\n@@ -1 +1 @@\n-old\n+new",
        items: [
          {
            type: "userMessage",
            content: [
              { type: "text", text: "question" },
              { type: "image", url: "not a text message" },
            ],
          },
          {
            type: "reasoning",
            summary: ["public"],
            content: ["raw secret reasoning"],
          },
          { type: "commandExecution", output: "private tool output" },
          {
            type: "agentMessage",
            phase: "commentary",
            text: "completed progress",
          },
          {
            type: "agentMessage",
            phase: "final_answer",
            text: "completed answer",
          },
        ],
      },
      {
        status: "inProgress",
        items: [
          {
            type: "userMessage",
            content: [{ type: "text", text: "follow up" }],
          },
          { type: "agentMessage", text: "streaming partial" },
        ],
      },
    ],
  };
  const projected = projectCodexPriorConversation(thread);
  assert.deepEqual(
    projected.conversation.map((m) => [m.role, m.content[0].text]),
    [
      ["user", "question"],
      ["assistant", "completed progress"],
      ["assistant", "completed answer"],
      ["user", "follow up"],
    ],
  );
  assert.deepEqual(projected.diff, {
    type: "output_diff",
    diff: thread.turns[0]!.diff,
  });
  assert.equal(JSON.stringify(projected).includes("raw secret"), false);
  assert.equal(
    JSON.stringify(projected).includes("private tool output"),
    false,
  );
});
test("missing native diff is represented as null instead of reading global Git", () => {
  assert.deepEqual(
    projectCodexPriorConversation({
      turns: [
        {
          status: "completed",
          items: [{ type: "agentMessage", text: "done" }],
        },
      ],
    }).diff,
    null,
  );
  assert.throws(() => projectCodexPriorConversation({ turns: null }), /原生/);
});
