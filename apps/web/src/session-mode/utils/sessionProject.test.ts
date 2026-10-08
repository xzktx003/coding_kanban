import { expect, it } from "vitest";
import { sessionProject } from "./sessionProject";
const card = (cwd?: string, worktreePath?: string) => ({
  kind: "codex" as const,
  id: cwd || "unknown",
  cwd,
  worktreePath,
});
it("shows the project even when titles and projects are not duplicated", () => {
  expect(sessionProject(card("/workspace/kanban"), []).label).toBe("kanban");
});
it("uses the shortest distinct suffix for same-name projects", () => {
  const a = card("/home/company/api"),
    b = card("/home/research/api");
  expect(sessionProject(a, [a, b]).label).toBe("company/api");
  expect(sessionProject(b, [a, b]).label).toBe("research/api");
});
it("keeps parent paths distinct from their same-name descendants", () => {
  const a = card("/api"),
    b = card("/home/api");
  expect(sessionProject(a, [a, b]).label).toBe("/api");
  expect(sessionProject(b, [a, b]).label).toBe("home/api");
});
it("shows worktree identity and targets its execution directory", () => {
  const a = card("/workspace/kanban", "/trees/fix-login");
  expect(sessionProject(a, [a])).toEqual({
    label: "kanban · fix-login",
    path: "/trees/fix-login",
    projectPath: "/workspace/kanban",
  });
});
it("never fills missing metadata with another session project", () => {
  expect(sessionProject(card(), [card("/workspace/kanban")])).toEqual({
    label: "项目未知",
    path: null,
    projectPath: null,
  });
});
