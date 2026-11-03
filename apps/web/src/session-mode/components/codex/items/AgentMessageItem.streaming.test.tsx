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

it("renders bounded live Markdown and switches to the final document without assistant actions while streaming", () => {
  const text = "**still streaming**\n\n```ts\nconst answer = 42;\n```";
  const { container, rerender } = render(
    <AgentMessageItem
      text={text}
      threadId="thread"
      itemId="message"
      streaming
    />,
  );

  const liveText = container.querySelector("[data-codex-streaming-text]");
  expect(liveText?.querySelector("strong")?.textContent).toBe("still streaming");
  expect(liveText?.querySelector("code")?.textContent).toContain("const answer = 42;");
  expect(container.querySelector("[data-testid=markdown-renderer]")).toBeNull();
  expect(container.querySelector(".codex-message-native-actions")).toBeNull();

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
