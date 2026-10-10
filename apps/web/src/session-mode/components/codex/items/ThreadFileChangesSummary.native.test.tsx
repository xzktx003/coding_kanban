import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { ThreadFileChangesSummary } from "./ThreadFileChangesSummary";
import { CodexContentOwner } from "../presentation/ownerContext";
import { useCodexStore } from "../stores/useCodexStore";
import { useWorkspaceStore } from "@session/stores";
import { useSavedTurnReviewStore } from "@session/stores/useSavedTurnReviewStore";
import { useSavedPatchStore } from "@session/stores/useSavedPatchStore";
const api = vi.hoisted(() => ({
  apply: vi.fn(),
  status: vi.fn(),
  reverse: vi.fn(),
  previewOpen: false,
}));
vi.mock("@session/components/ui/hover-card", () => ({
  HoverCard: ({ open, children }: any) => {
    api.previewOpen = open;
    return children;
  },
  HoverCardTrigger: ({ children }: any) => children,
  HoverCardContent: () => null,
}));
vi.mock("@session/services/savedPatchService", () => ({
  savedPatchApply: api.apply,
  savedPatchStatus: api.status,
}));
vi.mock("@session/services/apiAdapt", () => ({ gitReverseFiles: api.reverse }));
vi.mock("@session/features/DiffViewer", () => ({ DiffViewer: () => null }));
const changes = [
  {
    path: "/a/file.py",
    diff: "@@ -80 +80 @@\n-old\n+saved\n",
    kind: { type: "update" as const, move_path: null },
    addedCount: 1,
    removedCount: 1,
  },
];
const batches = [
  {
    id: "patch",
    changes: changes.map(({ path, diff, kind }) => ({ path, diff, kind })),
  },
];
beforeEach(() => {
  vi.clearAllMocks();
  useWorkspaceStore.setState({ cwd: "/b" });
  useCodexStore.setState({
    threads: [{ id: "a", cwd: "/a" }] as any,
    currentThreadId: "b",
  });
  useSavedPatchStore.setState({ records: {} });
  useSavedTurnReviewStore.getState().close();
});
it("clicking a historical row captures its exact turn and owner without switching the global project", () => {
  render(
    <CodexContentOwner.Provider value="a">
      <ThreadFileChangesSummary
        changes={changes}
        threadId="a"
        turnId="old-turn"
        batches={batches}
      />
    </CodexContentOwner.Provider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "file.py" }));
  expect(useSavedTurnReviewStore.getState().target).toMatchObject({
    threadId: "a",
    turnId: "old-turn",
    cwd: "/a",
    changes,
    batches,
    selectedPath: "/a/file.py",
  });
  expect(useWorkspaceStore.getState().cwd).toBe("/b");
  expect(useCodexStore.getState().currentThreadId).toBe("b");
});
it("saved undo confirms its actual scope and reapply appears only after a matching receipt", async () => {
  api.apply.mockImplementation(async (request) => ({
    requestId: request.requestId,
    action: request.action,
    status: "success",
    changedFiles: 1,
  }));
  render(
    <CodexContentOwner.Provider value="a">
      <ThreadFileChangesSummary
        changes={changes}
        threadId="a"
        turnId="old-turn"
        batches={batches}
      />
    </CodexContentOwner.Provider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "撤销此轮保存的变更" }));
  expect(api.apply).not.toHaveBeenCalled();
  expect(screen.getByRole("alertdialog").textContent).toContain("/a");
  fireEvent.click(screen.getByRole("button", { name: "确认撤销" }));
  await waitFor(() => expect(api.apply).toHaveBeenCalledOnce());
  expect(api.apply.mock.calls[0][0]).toMatchObject({
    threadId: "a",
    turnId: "old-turn",
    action: "undo",
    expectedChanges: batches,
  });
  expect(api.apply.mock.calls[0][0]).not.toHaveProperty("cwd");
  expect(api.reverse).not.toHaveBeenCalled();
  await screen.findByRole("button", { name: "重新应用此轮保存的变更" });
  fireEvent.click(
    screen.getByRole("button", { name: "重新应用此轮保存的变更" }),
  );
  await waitFor(() => expect(api.apply).toHaveBeenCalledTimes(2));
  expect(api.apply.mock.calls[1][0].action).toBe("reapply");
});
it("opening full review dismisses a manually opened file preview", () => {
  render(
    <CodexContentOwner.Provider value="a">
      <ThreadFileChangesSummary
        changes={changes}
        threadId="a"
        turnId="old-turn"
        batches={batches}
      />
    </CodexContentOwner.Provider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "预览 file.py Diff" }));
  expect(api.previewOpen).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "file.py" }));
  expect(api.previewOpen).toBe(false);
});
