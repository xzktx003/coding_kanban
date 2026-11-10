import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it } from "vitest";
import { readDraft, sessionDraftKey, useSessionDraftStore } from "@session/stores/useSessionDraftStore";
import { MultiAgentComposerBanner } from "./MultiAgentComposerBanner";

const SEEN = "kanban.session.has-seen-multi-agent-composer-banner";
const owner = sessionDraftKey("codex", null, "/fixture/new");

beforeEach(() => {
  localStorage.clear();
  useSessionDraftStore.setState({ drafts: {} });
});

it("shows the official new-thread prompt and remembers either action", () => {
  const first = render(<MultiAgentComposerBanner owner={owner} threadId={null} />);
  expect(screen.getByRole("heading", { name: "Codex 子代理" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "立即试用" }));
  expect(readDraft(owner).text).toBe("");
  expect(screen.queryByRole("button", { name: "立即试用" })).toBeNull();
  first.unmount();

  localStorage.removeItem(SEEN);
  useSessionDraftStore.getState().setText(owner, "保留已有草稿");
  render(<MultiAgentComposerBanner owner={owner} threadId={null} />);
  fireEvent.click(screen.getByRole("button", { name: "关闭子代理提示" }));
  expect(readDraft(owner).text).toBe("保留已有草稿");
  expect(localStorage.getItem(SEEN)).toBe("1");
  expect(screen.queryByRole("heading", { name: "Codex 子代理" })).toBeNull();
});

it("stays hidden for an existing thread and after the banner was seen", () => {
  localStorage.setItem(SEEN, "1");
  const { rerender } = render(<MultiAgentComposerBanner owner={owner} threadId={null} />);
  expect(screen.queryByRole("heading", { name: "Codex 子代理" })).toBeNull();
  localStorage.clear();
  rerender(<MultiAgentComposerBanner owner={owner} threadId="thread-1" />);
  expect(screen.queryByRole("button", { name: "立即试用" })).toBeNull();
});
