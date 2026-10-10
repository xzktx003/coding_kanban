import { render } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { AgentMessageItem } from "./AgentMessageItem";
import { STREAMING_TEXT_PREVIEW_MARKER } from "@session/services/codexTranscriptMemoryBudget";

vi.mock("../presentation/CodexMarkdown", () => ({
  CodexMarkdown: ({ value }: { value: string }) => (
    <div data-testid="markdown-renderer">{value}</div>
  ),
}));
vi.mock("@session/hooks/useWindowFocus", () => ({
  useWindowFocus: () => true,
}));
vi.mock("../composer/v2/MessageReferenceActions", () => ({
  MessageReferenceActions: () => null,
}));

it("keeps active assistant output out of the Markdown parser until completion", () => {
  const text = "**still streaming**\n\n```ts\nconst answer = 42;\n```";
  const { container, rerender } = render(
    <AgentMessageItem
      text={text}
      threadId="thread"
      itemId="message"
      streaming
    />,
  );

  expect(
    container.querySelector("[data-codex-streaming-text]")?.textContent,
  ).toBe(text);
  expect(container.querySelector("[data-testid=markdown-renderer]")).toBeNull();

  rerender(<AgentMessageItem text={text} threadId="thread" itemId="message" />);

  expect(container.querySelector("[data-codex-streaming-text]")).toBeNull();
  expect(
    container.querySelector("[data-testid=markdown-renderer]")?.textContent,
  ).toBe(text);
});

it("renders a truncated live response from bounded head and tail segments", () => {
  const { container } = render(
    <AgentMessageItem
      text=""
      threadId="thread"
      itemId="message"
      streaming
      streamingPreview={{
        head: ["beginning"],
        tail: ["latest output"],
        tailCurrent: "",
      }}
    />,
  );
  const liveText = container.querySelector("[data-codex-streaming-text]");

  expect(liveText?.textContent).toBe(
    `beginning${STREAMING_TEXT_PREVIEW_MARKER}latest output`,
  );
  expect(container.querySelector("[data-testid=markdown-renderer]")).toBeNull();
});
