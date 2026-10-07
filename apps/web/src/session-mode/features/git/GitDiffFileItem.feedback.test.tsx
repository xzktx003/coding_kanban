import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { GitDiffFileItem } from "./GitDiffFileItem";
vi.mock("@session/services/apiAdapt", () => ({
  gitFileDiffMeta: async () => {
    throw new Error("隔离差异读取失败");
  },
  gitFileDiff: vi.fn(),
  gitStageFiles: vi.fn(),
  gitUnstageFiles: vi.fn(),
  gitRevertFile: vi.fn(),
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
