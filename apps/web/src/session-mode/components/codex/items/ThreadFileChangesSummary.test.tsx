import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
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
it.each([6, 7, 39])(
  "desktop keeps all %i records and scrolls only above six",
  (count) => {
    render(<ThreadFileChangesSummary changes={changes(count)} />);
    const list = screen.getByRole("region", { name: "fileChanges.listLabel" });
    expect(list.getAttribute("data-scrollable")).toBe(String(count > 6));
    expect(list.tabIndex).toBe(count > 6 ? 0 : -1);
    expect(list.querySelectorAll(".session-file-change-row")).toHaveLength(
      count,
    );
    expect(screen.queryByText("fileChanges.scrollMore") !== null).toBe(
      count > 6,
    );
    expect(within(list).queryByText("fileChanges.undoAll")).toBeNull();
  },
);
it("single-file footer keeps one header with review and preview, without a duplicate lower row", () => {
  const { container } = render(
    <ThreadFileChangesSummary
      changes={changes(1)}
      threadId="owner"
      turnId="turn"
    />,
  );
  expect(container.querySelectorAll(".session-file-change-row")).toHaveLength(
    0,
  );
  expect(container.querySelectorAll(".codex-turn-diff-title")).toHaveLength(1);
  expect(
    screen.getByRole("button", { name: "/project/file-0.ts" }),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "/project/file-0.ts" }));
  expect(mock.review).toHaveBeenCalledWith("/project/file-0.ts");
  expect(
    screen.getByRole("button", { name: "预览 /project/file-0.ts Diff" }),
  ).toBeTruthy();
  expect(screen.getByRole("button", { name: /common.review/ })).toBeTruthy();
});
it.each([4, 5])("mobile scroll threshold is four records: %i", (count) => {
  mock.mobile = true;
  render(<ThreadFileChangesSummary changes={changes(count)} />);
  expect(screen.getByRole("region").getAttribute("data-scrollable")).toBe(
    String(count > 4),
  );
});
it("last record remains operable and undo all includes offscreen files with confirmation", async () => {
  const rows = changes(39);
  render(
    <ThreadFileChangesSummary
      changes={rows}
      threadId="owner"
      turnId="turn"
      batches={[{ id: "saved", changes: rows }]}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "/project/file-38.ts" }));
  expect(mock.review).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "撤销此轮保存的变更" }));
  expect(mock.undo).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "确认撤销" }));
  await waitFor(() =>
    expect(mock.undo.mock.calls[0][0]).toMatchObject({
      threadId: "owner",
      turnId: "turn",
      expectedChanges: [{ id: "saved", changes: rows }],
      action: "undo",
    }),
  );
});

it("undoing the last offscreen record targets only that file after confirmation", async () => {
  const rows = changes(39);
  render(
    <ThreadFileChangesSummary
      changes={rows}
      threadId="owner"
      turnId="turn"
      batches={[{ id: "saved", changes: rows }]}
    />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "撤销file-38.ts保存的变更" }),
  );
  expect(mock.undo).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "确认撤销" }));
  await waitFor(() =>
    expect(mock.undo.mock.calls[0][0]).toMatchObject({
      threadId: "owner",
      turnId: "turn",
      filePath: "/project/file-38.ts",
      action: "undo",
    }),
  );
});
