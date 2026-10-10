import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { GitDiffFileItem } from "./GitDiffFileItem";
import { useAgentCenterStore } from "@session/stores/useAgentCenterStore";
const reverse = vi.hoisted(() => vi.fn());
vi.mock("@session/services/apiAdapt", () => ({
  gitFileDiffMeta: async () => {
    throw new Error("隔离差异读取失败");
  },
  gitFileDiff: vi.fn(),
  gitStageFiles: vi.fn(),
  gitUnstageFiles: vi.fn(),
  gitRevertFile: vi.fn(),
  gitReverseFiles: reverse,
}));
vi.mock("@session/contexts/ThemeContext", () => ({
  useThemeContext: () => ({ resolvedTheme: "dark" }),
}));
vi.mock("@git-diff-view/react", () => ({
  DiffView: () => null,
  DiffModeEnum: { Split: 1, Unified: 2 },
}));
test("failed diff read is announced instead of silently rendering blank", async () => {
  render(
    <GitDiffFileItem
      cwd="/fixture"
      entry={{ path: "中文.ts", index_status: " ", worktree_status: "M" }}
      section="unstaged"
      diffSource="unstaged"
      wordWrapEnabled={false}
      expanded
      isSelected={false}
      refreshKey={0}
      onExpandedChange={() => {}}
      onSelect={() => {}}
      onRefreshStatus={() => {}}
    />,
  );
  expect((await screen.findByRole("alert")).textContent).toContain(
    "隔离差异读取失败",
  );
  expect(
    screen.getByRole("button", { name: "重新加载此文件变更" }),
  ).toBeTruthy();
});
test("native full-file revert confirmation is bound to the original project and closes on scope change", () => {
  useAgentCenterStore.setState({ cards: [{ kind: "codex", id: "a", cwd: "/a" }], currentAgentCardId: "a" });
  const props = { cwd: "/a", entry: { path: "same.ts", index_status: " ", worktree_status: "M" }, section: "unstaged" as const, diffSource: "unstaged" as const, wordWrapEnabled: false, expanded: false, isSelected: false, refreshKey: 0, onExpandedChange: vi.fn(), onSelect: vi.fn(), onRefreshStatus: vi.fn() };
  const view = render(<GitDiffFileItem {...props}/>);
  fireEvent.click(screen.getByRole("button", { name: "还原文件变更 same.ts（丢弃所选变更）" }));
  expect(screen.getByText(/确认丢弃/).textContent).toContain("/a/same.ts");
  view.rerender(<GitDiffFileItem {...props} cwd="/b"/>);
  expect(screen.queryByRole("button", { name: "确认还原" })).toBeNull();
  expect(reverse).not.toHaveBeenCalled();
});
