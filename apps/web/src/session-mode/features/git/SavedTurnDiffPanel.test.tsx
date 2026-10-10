import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { SavedTurnDiffPanel } from "./SavedTurnDiffPanel";
import { useSavedTurnReviewStore } from "@session/stores/useSavedTurnReviewStore";
import { useWorkspaceStore, useEditorStore } from "@session/stores";
import { readDraft, sessionDraftKey, useSessionDraftStore } from "@session/stores/useSessionDraftStore";
const api = vi.hoisted(() => ({ apply: vi.fn(), status: vi.fn() }));
vi.mock("@session/services/savedPatchService", () => ({
  savedPatchApply: api.apply,
  savedPatchStatus: api.status,
}));
const patch =
  "--- a/file.py\n+++ b/file.py\n@@ -80,1 +80,1 @@\n-before\n+after\n";
beforeEach(() => {
  useSavedTurnReviewStore.setState({ feedback: {} });
  useSessionDraftStore.setState({ drafts: {} });
  useWorkspaceStore.setState({ cwd: "/b" });
  useEditorStore.getState().resetFiles();
  useSavedTurnReviewStore
    .getState()
    .open(
      {
        threadId: "a",
        turnId: "history",
        cwd: "/a",
        changes: [
          {
            path: "file.py",
            diff: patch,
            kind: { type: "update", move_path: null },
            addedCount: 1,
            removedCount: 1,
          },
        ],
        batches: [],
      },
      "file.py",
    );
});
it("persists captured line feedback and adds it only to its owner's detached composer draft", async () => {
  render(<SavedTurnDiffPanel />);
  fireEvent.click(screen.getByRole("button", { name: "选择新文件第 80 行" }));
  fireEvent.change(screen.getByRole("textbox", { name: "行评论" }), { target: { value: "Keep the saved contract" } });
  fireEvent.click(screen.getByRole("button", { name: "保存评论" }));
  fireEvent.click(screen.getByRole("button", { name: "加入此会话草稿" }));
  expect(readDraft(sessionDraftKey("codex", "a")).text).toContain("/a/file.py:80-80");
  expect(readDraft(sessionDraftKey("codex", "a")).text).toContain("Keep the saved contract");
  expect(readDraft(sessionDraftKey("codex", "b")).text).toBe("");
  expect(useWorkspaceStore.getState().cwd).toBe("/b");
  expect(api.apply).not.toHaveBeenCalled();
  expect((screen.getByRole("button", { name: "已加入此会话草稿" }) as HTMLButtonElement).disabled).toBe(true);
});
it("reviews the captured saved patch at original coordinates and opens the owner's file, never current Git", async () => {
  render(<SavedTurnDiffPanel />);
  expect(
    screen
      .getByRole("region", { name: "保存的轮次变更" })
      .getAttribute("data-owner-thread"),
  ).toBe("a");
  await waitFor(() =>
    expect(
      document.querySelector('[data-new-line="80"]')?.textContent,
    ).toContain("after"),
  );
  fireEvent.click(screen.getByRole("button", { name: "打开 file.py" }));
  expect(useEditorStore.getState()).toMatchObject({
    activeFile: "/a/file.py",
    roots: { "/a/file.py": "/a" },
    revealLocation: { line: 80 },
  });
  expect(useWorkspaceStore.getState().cwd).toBe("/b");
  expect(api.apply).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "查看当前工作区变更" }));
  expect(useSavedTurnReviewStore.getState().target).toBeNull();
});
