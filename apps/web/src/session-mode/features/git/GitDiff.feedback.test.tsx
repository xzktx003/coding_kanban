import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { GitDiffTopBar } from "./GitDiffTopBar";
import { GitDiffFileList } from "./GitDiffFileList";
vi.mock("./GitActions", () => ({ GitActions: () => null }));
vi.mock("./GitStatsIndicator", () => ({ GitStatsIndicator: () => null }));
vi.mock("./GitDiffFileItem", () => ({ GitDiffFileItem: () => null }));
test("diff controls expose localized names and toggle states", () => {
  render(
    <GitDiffTopBar
      cwd="/fixture"
      gitLoading={false}
      diffSource="unstaged"
      onDiffSourceChange={() => {}}
      selectedDiffSection="unstaged"
      onDiffSectionChange={() => {}}
      unstagedCount={0}
      stagedCount={0}
      showFileTree
      onToggleFileTree={() => {}}
      onRefresh={() => {}}
    />,
  );
  expect(screen.getByRole("combobox", { name: "变更来源" })).toBeTruthy();
  expect(
    screen
      .getByRole("button", { name: "隐藏变更文件树" })
      .getAttribute("aria-expanded"),
  ).toBe("true");
  expect(screen.getByRole("button", { name: "变更选项" })).toBeTruthy();
});
test("diff empty states explain the selected source", () => {
  const props = {
    cwd: "/fixture",
    entries: [],
    section: "unstaged" as const,
    diffSource: "unstaged" as const,
    wordWrapEnabled: false,
    selectedDiffPath: null,
    refreshKey: 0,
    expandedDiffs: {},
    onExpandedChange: () => {},
    onSelect: () => {},
    onRefreshStatus: () => {},
  };
  const view = render(<GitDiffFileList {...props} />);
  expect(screen.getByText("暂无未暂存的变更")).toBeTruthy();
  view.rerender(<GitDiffFileList {...props} cwd={null} />);
  expect(screen.getByText("先选择项目以查看变更")).toBeTruthy();
});
