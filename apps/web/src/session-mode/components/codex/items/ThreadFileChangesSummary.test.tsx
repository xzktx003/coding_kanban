import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { ThreadFileChangesSummary } from "./ThreadFileChangesSummary";
import type { AggregatedFileChange } from "./fileChangeLogic";
import { useWorkspaceStore } from "@session/stores";
const mock = vi.hoisted(() => ({
  mobile: false,
  undo: vi.fn(),
  review: vi.fn(),
}));
vi.mock("@session/hooks/use-mobile", () => ({
  useIsMobile: () => mock.mobile,
}));
vi.mock("@session/services/savedPatchService", () => ({
  savedPatchApply: mock.undo,
  savedPatchStatus: async () => ({ result: null }),
}));
import { useSavedPatchStore } from "@session/stores/useSavedPatchStore";
import { useCodexStore } from "../stores/useCodexStore";
vi.mock("./fileChangeUtils", () => ({
  toRelativePath: (p: string) => p,
  useOpenReviewTab: () => mock.review,
}));
vi.mock("@session/features/DiffViewer", () => ({ DiffViewer: () => null }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
const changes = (count: number): AggregatedFileChange[] =>
  Array.from({ length: count }, (_, i) => ({
    path: `/project/file-${i}.ts`,
    diff: "",
    kind: { type: "update", move_path: null },
    addedCount: 1,
    removedCount: 0,
  }));
beforeEach(() => {
  mock.mobile = false;
  vi.clearAllMocks();
  mock.undo.mockImplementation(async (request) => ({
    requestId: request.requestId,
    action: request.action,
    status: "success",
    changedFiles: 39,
  }));
  useWorkspaceStore.setState({ cwd: "/project" });
  useSavedPatchStore.setState({ records: {} });
  useCodexStore.setState({
    threads: [{ id: "owner", cwd: "/project" }] as any,
  });
});
it("renders no card for no files", () => {
  const { container } = render(<ThreadFileChangesSummary changes={[]} />);
  expect(container.childElementCount).toBe(0);
});
it.each([false, true])(
  "projected file changes keep the native card and bounded list (mobile=%s)",
  (mobile) => {
    mock.mobile = mobile;
    const projected = changes(16).map((change) => ({
      ...change,
      transcriptMetadataOnly: true,
      addedCount: 0,
      removedCount: 0,
    }));
    const { container } = render(
      <ThreadFileChangesSummary
        changes={projected}
        threadId="owner"
        turnId="turn"
      />,
    );
    const list = screen.getByRole("region", { name: "fileChanges.listLabel" });
    expect(list.getAttribute("data-scrollable")).toBe("true");
    expect(list.querySelectorAll(".session-file-change-row")).toHaveLength(16);
    expect(container.querySelector(".codex-turn-diff-icon")).not.toBeNull();
    expect(screen.getAllByText("详情未加载")).toHaveLength(1);
    expect(screen.queryByText("+0")).toBeNull();
    expect(screen.queryByText("-0")).toBeNull();
    expect(screen.queryByRole("button", { name: /common.review/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /预览.*Diff/ })).toBeNull();
    expect(mock.review).not.toHaveBeenCalled();
  },
);
it.each([1, 6, 39])(
  "loaded diffs keep the file card and a hover preview for %i files",
  (count) => {
    render(
      <ThreadFileChangesSummary
        changes={changes(count)}
        threadId="owner"
        turnId="turn"
      />,
    );
    expect(
      screen.getByText(
        count === 1 ? "已编辑 file-0.ts" : `已编辑 ${count} 个文件`,
      ),
    ).toBeTruthy();
    if (count === 1) {
      expect(screen.queryByRole("region", { name: "fileChanges.listLabel" })).toBeNull();
    } else {
      const list = screen.getByRole("region", { name: "fileChanges.listLabel" });
      expect(list.querySelectorAll(".session-file-change-row")).toHaveLength(count);
      expect(list.textContent).toContain("/project/file-0.ts");
      expect(list.textContent).toContain("+1");
    }
    expect(screen.getAllByRole("button", { name: /预览 .* Diff/ }).length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole("button", { name: "查看变更" })[0]);
    expect(mock.review).toHaveBeenCalledWith(
      count === 1 ? "/project/file-0.ts" : undefined,
    );
  },
);
