import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const directory = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(directory, "codex-mode.css"), "utf8");
const navigation = readFileSync(
  resolve(directory, "CodexProjectNavigation.tsx"),
  "utf8",
);
const workbench = readFileSync(resolve(directory, "CodexWorkbench.tsx"), "utf8");
const shell = readFileSync(
  resolve(directory, "../components/WorkbenchShell.tsx"),
  "utf8",
);

it("paints the Codex shell from the same light and dark session palette", () => {
  expect(css).toContain(".codex-mode.dark");
  expect(css).toContain(".codex-mode.light");
  expect(css).toContain("var(--background)");
  expect(css).toContain("var(--sidebar)");
  expect(css).toContain("var(--foreground)");
  expect(css).not.toMatch(/background:\s*#181a1d/);
  expect(css).not.toMatch(/background:\s*#1c1e22/);
  expect(shell).toContain('className="codex-mode dark"');
  expect(workbench).toContain("applyWorkbenchTheme");
  expect(workbench).toContain("SessionThemeToggle");
});

it("renders Codex projects as an independent session-shaped tree", () => {
  expect(navigation).toContain('aria-label="项目列表"');
  expect(navigation).toContain("session-project-group");
  expect(navigation).toContain("session-nav-row");
  expect(navigation).toContain("搜索会话");
  expect(navigation).not.toContain("AppSideBar");
  expect(navigation).not.toContain("SideBarProjectList");
  expect(navigation).not.toContain("ThreadList");
  expect(navigation).not.toContain("useWorkspaceStore");
  expect(navigation).not.toContain("useAgentCenterStore");
  expect(navigation).not.toContain("removeProject");
  expect(navigation).not.toContain("archiveThread");
});
