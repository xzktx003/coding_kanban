import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { ThreadFileChangesSummary } from "./ThreadFileChangesSummary";
import { CodexContentOwner } from "../presentation/ownerContext";
import { useCodexStore } from "../stores/useCodexStore";
import { useEditorStore, useWorkspaceStore } from "@session/stores";
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

it("does not offer blank review or saved-patch actions for projected metadata", () => {
  const projected = changes.map((change) => ({
    ...change,
    diff: "",
    addedCount: 0,
    removedCount: 0,
    transcriptMetadataOnly: true,
  }));
  render(
    <ThreadFileChangesSummary
      changes={projected}
      threadId="a"
      turnId="old-turn"
      batches={batches}
    />,
  );
  expect(screen.getByText("详情未加载")).toBeTruthy();
  expect(screen.queryByText("+0")).toBeNull();
  expect(screen.queryByText("-0")).toBeNull();
  expect(screen.queryByRole("button", { name: /预览.*Diff/ })).toBeNull();
  expect(
    screen.queryByRole("button", { name: "撤销此轮保存的变更" }),
  ).toBeNull();
  expect(screen.queryByRole("button", { name: "file.py" })).toBeNull();
  expect(api.apply).not.toHaveBeenCalled();
});

it("keeps short projected diffs previewable while long projected diffs stay unloaded", () => {
  const short = changes[0];
  const long = {
    path: "/a/large.py",
    diff: "",
    kind: { type: "update" as const, move_path: null },
    addedCount: 0,
    removedCount: 0,
    transcriptMetadataOnly: true,
  };
  render(
    <ThreadFileChangesSummary
      changes={[short, long]}
      threadId="a"
      turnId="mixed-turn"
    />,
  );
  expect(screen.getByRole("button", { name: "预览 file.py Diff" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "查看文件 large.py" })).toBeTruthy();
  expect(screen.getByText("详情未加载")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "预览 large.py Diff" })).toBeNull();
  expect(screen.queryByText("+0")).toBeNull();
  expect(screen.queryByText("-0")).toBeNull();
  expect(api.apply).not.toHaveBeenCalled();
});

it("projected paths can open the owning file without opening an empty historical diff or changing input target", () => {
  const reveal = vi
    .spyOn(useEditorStore.getState(), "revealFile")
    .mockImplementation(() => {});
  render(
    <ThreadFileChangesSummary
      changes={changes.map((change) => ({
        ...change,
        diff: "",
        transcriptMetadataOnly: true,
      }))}
      threadId="a"
      turnId="old-turn"
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "查看文件 file.py" }));
  expect(reveal).toHaveBeenCalledWith("/a/file.py", "/a");
  expect(useWorkspaceStore.getState().cwd).toBe("/b");
  expect(useCodexStore.getState().currentThreadId).toBe("b");
  expect(useSavedTurnReviewStore.getState().target).toBeNull();
  expect(api.apply).not.toHaveBeenCalled();
  reveal.mockRestore();
});

it("projected deleted files cannot open a nonexistent source, while renames reveal the exact destination", () => {
  const reveal = vi
    .spyOn(useEditorStore.getState(), "revealFile")
    .mockImplementation(() => {});
  const removed = {
    ...changes[0],
    kind: { type: "delete" as const },
    diff: "",
    transcriptMetadataOnly: true,
  };
  const { rerender } = render(
    <ThreadFileChangesSummary
      changes={[removed]}
      threadId="a"
      turnId="old-turn"
    />,
  );
  const button = screen.getByRole("button", { name: "查看文件 file.py" });
  expect((button as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(button);
  expect(reveal).not.toHaveBeenCalled();
  rerender(
    <ThreadFileChangesSummary
      changes={[
        {
          ...changes[0],
          kind: { type: "update", move_path: "/a/new:100%.py" },
          diff: "",
          transcriptMetadataOnly: true,
        },
      ]}
      threadId="a"
      turnId="old-turn"
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "查看文件 file.py" }));
  expect(reveal).toHaveBeenCalledWith("/a/new:100%.py", "/a");
  reveal.mockRestore();
});
