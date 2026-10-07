import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { FileTree } from "./FileTree";
const state = vi.hoisted(() => ({
  treeContainerRef: { current: null },
  root: null,
  displayRoot: null,
  loading: false,
  error: null as string | null,
  filterText: "",
  setFilterText: vi.fn(),
  setRefreshKey: vi.fn(),
  searching: false,
  searchError: null,
  isSearching: false,
  hasSearchResults: false,
}));
vi.mock("./useFileTree", () => ({ useFileTree: () => state }));
beforeEach(() => {
  state.loading = false;
  state.error = null;
  state.setRefreshKey.mockClear();
});
test("file search has an accessible name independent from placeholder", () => {
  render(<FileTree folder="/fixture" onFileSelect={() => {}} />);
  expect(
    screen.getByRole("textbox", { name: "筛选文件或文件夹" }),
  ).toBeTruthy();
});
test("file tree loading and errors are announced, failure offers retry", () => {
  state.loading = true;
  const view = render(<FileTree folder="/fixture" onFileSelect={() => {}} />);
  expect(screen.getByRole("status").textContent).toContain("正在加载文件");
  state.loading = false;
  state.error = "隔离读取失败";
  view.rerender(<FileTree folder="/fixture" onFileSelect={() => {}} />);
  expect(screen.getByRole("alert").textContent).toContain("隔离读取失败");
  fireEvent.click(screen.getByRole("button", { name: "重新加载文件树" }));
  expect(state.setRefreshKey).toHaveBeenCalled();
});
