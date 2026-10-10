import { act, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { NativeMessageFork } from "./NativeMessageFork";
import { useThreadWorkflowStore } from "./delivery";
const mocks = vi.hoisted(() => ({ fork: vi.fn() }));
vi.mock("./service", () => ({ forkAtTurn: mocks.fork }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: "zh-CN" } }),
}));
vi.mock("@session/session-dom", () => ({
  isAgentInteractionVisible: () => true,
}));
vi.mock("@session/components/codex/thread/inspection", () => ({
  useTranscriptInspection: () => false,
}));
beforeEach(() => {
  mocks.fork.mockReset().mockResolvedValue("new-thread");
  useThreadWorkflowStore.setState({ inlineEdits: {}, mutations: {} });
  document.getSelection()?.removeAllRanges();
});
function show() {
  const ref = createRef<HTMLDivElement>();
  render(
    <>
      <div ref={ref}>Old quote and latest quote</div>
      <div data-testid="other">Another owner's text</div>
      <NativeMessageFork
        threadId="owner"
        turnId="turn"
        itemId="item"
        contentRef={ref}
      />
    </>,
  );
  const select = (node: Node, start: number, end: number, notify = true) => {
    act(() => {
      const selection = document.getSelection()!,
        range = document.createRange();
      selection.removeAllRanges();
      range.setStart(node.firstChild!, start);
      range.setEnd(node.firstChild!, end);
      selection.addRange(range);
      if (notify) fireEvent(document, new Event("selectionchange"));
    });
  };
  return { ref, select };
}
it("clears the native quote action when a deliberate null selection arrives", async () => {
  const { ref, select } = show();
  select(ref.current!, 0, 9);
  expect(screen.getByRole("button").getAttribute("aria-label")).toContain(
    "引用选区",
  );
  act(() => {
    document.getSelection()!.removeAllRanges();
    fireEvent(document, new Event("selectionchange"));
  });
  expect(screen.getByRole("button").getAttribute("aria-label")).toBe(
    "从此轮创建分支",
  );
  fireEvent.click(screen.getByRole("button"));
  expect(mocks.fork).toHaveBeenCalledWith(
    expect.objectContaining({
      threadId: "owner",
      turnId: "turn",
      itemId: "item",
    }),
    "",
  );
});
it("recaptures the actual source-bounded selection at the click even before a selectionchange state update", () => {
  const { ref, select } = show();
  select(ref.current!, 0, 9);
  select(screen.getByTestId("other"), 0, 7, false);
  fireEvent.click(screen.getByRole("button"));
  expect(mocks.fork).toHaveBeenCalledWith(
    expect.objectContaining({ threadId: "owner" }),
    "",
  );
});
it("captures the latest source selection rather than a previously cached fragment", () => {
  const { ref, select } = show();
  select(ref.current!, 0, 9);
  select(ref.current!, 14, 26, false);
  fireEvent.click(screen.getByRole("button"));
  expect(mocks.fork).toHaveBeenCalledWith(
    expect.objectContaining({ threadId: "owner" }),
    "latest quote",
  );
});
