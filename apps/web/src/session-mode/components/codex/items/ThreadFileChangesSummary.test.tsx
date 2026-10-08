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
import { useEditorStore, useWorkspaceStore } from "@session/stores";
const mock = vi.hoisted(() => ({
  mobile: false,
  undo: vi.fn(),
  review: vi.fn(),
}));
vi.mock("@session/hooks/use-mobile", () => ({
  useIsMobile: () => mock.mobile,
}));
vi.mock("@session/services/apiAdapt", () => ({ gitReverseFiles: mock.undo }));
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
  mock.undo.mockResolvedValue(undefined);
  useWorkspaceStore.setState({ cwd: "/project" });
  useEditorStore.setState({ hasConfirmedGitRevert: false });
});
it("renders no card for no files", () => {
  const { container } = render(<ThreadFileChangesSummary changes={[]} />);
  expect(container.childElementCount).toBe(0);
});
it.each([1, 6, 7, 39])(
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
it.each([4, 5])("mobile scroll threshold is four records: %i", (count) => {
  mock.mobile = true;
  render(<ThreadFileChangesSummary changes={changes(count)} />);
  expect(screen.getByRole("region").getAttribute("data-scrollable")).toBe(
    String(count > 4),
  );
});
it("last record remains operable and undo all includes offscreen files with confirmation", async () => {
  const rows = changes(39);
  render(<ThreadFileChangesSummary changes={rows} />);
  fireEvent.click(screen.getByRole("button", { name: "/project/file-38.ts" }));
  expect(mock.review).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByTitle("fileChanges.undoAllTitle"));
  expect(mock.undo).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "common.undo" }));
  await waitFor(() =>
    expect(mock.undo).toHaveBeenCalledWith(
      "/project",
      rows.map((r) => r.path),
      false,
    ),
  );
});

it("undoing the last offscreen record targets only that file after confirmation", async () => {
  render(<ThreadFileChangesSummary changes={changes(39)} />);
  fireEvent.click(screen.getAllByTitle("fileChanges.undoFileTitle").at(-1)!);
  expect(mock.undo).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "common.undo" }));
  await waitFor(() =>
    expect(mock.undo).toHaveBeenCalledWith(
      "/project",
      ["/project/file-38.ts"],
      false,
    ),
  );
});
