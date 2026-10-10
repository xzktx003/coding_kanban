import { render } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { AgentMessageItem } from "./AgentMessageItem";
import { useCodexStore } from "../stores/useCodexStore";
import {
  reviewOwnerKey,
  useSavedTurnReviewStore,
} from "@session/stores/useSavedTurnReviewStore";
vi.mock("../presentation/CodexMarkdown", () => ({ CodexMarkdown: () => null }));
vi.mock("@session/features/git/NativeReviewFindings", () => ({
  NativeReviewFindings: () => null,
}));
vi.mock("../composer/v2/MessageReferenceActions", () => ({
  MessageReferenceActions: () => null,
}));
vi.mock("@session/features/thread-workflows/NativeMessageFork", () => ({
  NativeMessageFork: () => null,
}));
const text =
  'Review\n::code-comment{title="[P1] Owner finding" body="Use captured files" file="src/file.ts" start=3 end=4 priority=1}';
beforeEach(() => {
  useSavedTurnReviewStore.setState({ findingItems: {} });
  useCodexStore.setState({
    threads: [{ id: "review-owner", cwd: "/owner" } as never],
    currentThreadId: "foreign",
  });
});
it("projects only completed findings under the captured owner and retains them across virtual unmounts", () => {
  const view = render(
    <AgentMessageItem
      threadId="review-owner"
      turnId="turn"
      itemId="item"
      text={text}
      streaming
    />,
  );
  expect(useSavedTurnReviewStore.getState().findingItems).toEqual({});
  view.rerender(
    <AgentMessageItem
      threadId="review-owner"
      turnId="turn"
      itemId="item"
      text={text}
    />,
  );
  const key = reviewOwnerKey({
    threadId: "review-owner",
    turnId: "turn",
    cwd: "/owner",
  });
  expect(
    useSavedTurnReviewStore.getState().findingItems[key]?.item,
  ).toMatchObject([{ path: "/owner/src/file.ts", start: 3, end: 4 }]);
  view.unmount();
  expect(
    useSavedTurnReviewStore.getState().findingItems[key]?.item,
  ).toHaveLength(1);
});
