import { render } from "@testing-library/react";
import { beforeEach, expect, it } from "vitest";
import { useCodexStore } from "../stores/useCodexStore";
import { CodexTranscriptPreparing } from "./CodexTranscriptPreparing";

beforeEach(() => {
  useCodexStore.setState({ events: {}, streamingAgentMessages: {} } as never);
});

it("keeps fallback messages readable with emphasis, lists, and display math", () => {
  useCodexStore.setState({
    events: {
      owner: [
        {
          method: "item/completed",
          params: {
            threadId: "owner",
            turnId: "turn",
            item: {
              type: "agentMessage",
              id: "answer",
              text: String.raw`**结论**

- 保留列表
- 保留公式：\[
x^2
\]`,
              phase: "final_answer",
              memoryCitation: null,
            },
          },
        },
      ],
    },
  } as never);

  const { container } = render(
    <CodexTranscriptPreparing threadId="owner" failed />,
  );

  expect(container.querySelector("strong")?.textContent).toBe("结论");
  expect(container.querySelectorAll("li")).toHaveLength(2);
  expect(container.querySelector(".katex-display .katex")).not.toBeNull();
  expect(container.textContent).not.toContain("\\[");
});

it("keeps the recovery actions and diagnostic details available", () => {
  const retry = () => undefined;
  const refresh = () => undefined;
  const { getByRole, getByText } = render(
    <CodexTranscriptPreparing
      threadId="owner"
      failed
      failure="SyntaxError: failed to load transcript"
      onRetry={retry}
      onRefresh={refresh}
    />,
  );

  expect(getByRole("button", { name: "重试完整消息" })).toBeTruthy();
  expect(getByRole("button", { name: "刷新页面" })).toBeTruthy();
  expect(getByText("查看错误详情")).toBeTruthy();
});
