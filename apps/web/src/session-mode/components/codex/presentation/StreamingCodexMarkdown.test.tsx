import { render } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { StreamingCodexMarkdown } from "./StreamingCodexMarkdown";
const calls = vi.hoisted(() => vi.fn());
vi.mock("./CodexMarkdown", () => ({
  CodexMarkdown: ({
    value,
    streaming,
  }: {
    value: string;
    streaming: boolean;
  }) => {
    calls(value);
    return <div data-markdown-live={streaming}>{value}</div>;
  },
}));
it("renders Markdown while streaming and does not reparse stable blocks for every tail change", () => {
  const first = "**first paragraph**\n\n",
    second = "second paragraph\n\n";
  const view = render(
    <StreamingCodexMarkdown
      segments={[first, second]}
      current="latest"
      threadId="thread"
    />,
  );
  expect(view.container.querySelector("[data-markdown-live]")).not.toBeNull();
  calls.mockClear();
  view.rerender(
    <StreamingCodexMarkdown
      segments={[first, second]}
      current="latest update"
      threadId="thread"
    />,
  );
  expect(calls.mock.calls.some(([value]) => value === first)).toBe(false);
  expect(view.container.textContent).toBe(first + second + "latest update");
});
it("keeps a long unclosed block out of the parser and preserves its text", () => {
  const text = "```ts\n" + "x".repeat(40_000);
  calls.mockClear();
  const view = render(
    <StreamingCodexMarkdown
      segments={[
        text.slice(0, 8192),
        text.slice(8192, 16384),
        text.slice(16384, 24576),
        text.slice(24576, 32768),
      ]}
      current={text.slice(32768)}
    />,
  );
  expect(view.container.textContent).toBe(text);
  expect(calls.mock.calls.every(([value]) => value.length <= 16384)).toBe(true);
});
it("resets progressive state when its immutable segment prefix is replaced", () => {
  const view = render(
    <StreamingCodexMarkdown
      segments={["old\n\n", "later\n\n"]}
      current="tail"
    />,
  );
  view.rerender(
    <StreamingCodexMarkdown segments={["new\n\n"]} current="fresh" />,
  );
  expect(view.container.textContent).toBe("new\n\nfresh");
});
