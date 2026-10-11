import { expect, it } from "vitest";
import { lastAssistantCodeBlock } from "./lastCodeBlock";

it("keeps the last fenced block from the latest assistant message", () => {
  expect(
    lastAssistantCodeBlock([
      { params: { item: { type: "agentMessage", text: "```ts\nfirst\n```" } } },
      { params: { item: { type: "userMessage", text: "```\nignore\n```" } } },
      {
        params: {
          item: {
            type: "agentMessage",
            text: "说明\n```js\nconst answer = 1;\n```\n```\nsecond\n```",
          },
        },
      },
    ]),
  ).toBe("second");
  expect(lastAssistantCodeBlock([])).toBeNull();
});
