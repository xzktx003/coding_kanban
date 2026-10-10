import { expect, test, type Page } from "@playwright/test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";
const exec = promisify(execFile);
async function repository() {
  const cwd = await mkdtemp(join(tmpdir(), "kanban-native-review-browser-")), filePath = "中文 100%:12.ts";
  await exec("git", ["init", "-q"], { cwd });
  const base = Array.from({ length: 130 }, (_, index) => `const value${index + 1} = ${index + 1};`).join("\n") + "\n";
  await writeFile(join(cwd, filePath), base);
  await exec("git", ["add", "--", filePath], { cwd });
  await exec("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "fixture"], { cwd });
  const modified = base.replace("value80 = 80;", "value80 = 800;").replace("value120 = 120;", "value120 = 1200;");
  await writeFile(join(cwd, filePath), modified);
  return { cwd, filePath, base, modified };
}
async function prepare(page: Page, width: number, theme: string) {
  await installSessionUxFixture(page);
  // These are the actual LAN gateway and native Git/read-only filesystem APIs.
  // Only temporary test repository paths are sent, never real Agent paths.
  await page.route("**/api/session/git/hunks/**", route => route.continue());
  await page.route("**/api/session/api/git/**", route => route.continue());
  await page.setViewportSize({ width, height: 1000 });
  await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
  await page.locator(".session-codex-composer [contenteditable=true]").first().waitFor({ timeout: 60000 });
  await seedSessionUx(page);
  await page.evaluate(async theme => {
    const module = (path: string) => import(performance.getEntriesByType("resource").findLast(e => new URL(e.name).pathname === path)?.name ?? path);
    const { useThemeStore } = await module("/src/session-mode/stores/settings/useThemeStore.ts");
    useThemeStore.getState().setTheme(theme);
  }, theme);
}
for (const width of [1440, 390]) test.describe(`${width}px native full review`, () => {
  test.use({ hasTouch: width === 390, isMobile: width === 390 });
  for (const theme of ["dark", "light"]) test(`captured comments and actual LAN per-hunk Git (${theme})`, async ({ page }, info) => {
    test.setTimeout(120000);
    const repo = await repository(), requests: unknown[] = [], errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => { if (request.url().includes("/git/hunks/action")) requests.push(request.postDataJSON()); });
    try {
      await prepare(page, width, theme);
      const response = await page.request.post("/api/session/git/hunks/read", { data: { cwd: repo.cwd, filePath: repo.filePath, staged: false } });
      expect(response.ok(), await response.text()).toBe(true);
      const snapshot = await response.json();
      expect(snapshot.hunks).toHaveLength(2);
      await page.evaluate(async ({ repo, patch }) => {
        const module = (path: string) => import(performance.getEntriesByType("resource").findLast(e => new URL(e.name).pathname === path)?.name ?? path);
        const { useCodexStore } = await module("/src/session-mode/components/codex/stores/index.ts"), { useAgentCenterStore } = await module("/src/session-mode/stores/useAgentCenterStore.ts"), { useLayoutStore } = await module("/src/session-mode/stores/useLayoutStore.ts"), { useWorkspaceStore } = await module("/src/session-mode/stores/useWorkspaceStore.ts"), { useSavedTurnReviewStore } = await module("/src/session-mode/stores/useSavedTurnReviewStore.ts");
        useAgentCenterStore.setState({ cards: [{ kind: "codex", id: "ux-0", cwd: repo.cwd, preview: "原生审查" }], currentAgentCardId: "ux-0", currentAgentCardKind: "codex", cardsViewMode: "solo" });
        useCodexStore.setState({ threads: useCodexStore.getState().threads.map((thread: any) => thread.id === "ux-0" ? { ...thread, cwd: repo.cwd } : thread) });
        useWorkspaceStore.setState({ cwd: "/fixture/foreign-project" });
        useSavedTurnReviewStore.getState().open({ threadId: "ux-0", turnId: "captured-review", cwd: repo.cwd, batches: [], changes: [{ path: repo.filePath, kind: { type: "update", move_path: null }, diff: patch, addedCount: 2, removedCount: 2 }] });
        useLayoutStore.getState().setActiveRightPanelTab("diff");useLayoutStore.getState().setRightPanelOpen(true);
      }, { repo, patch: snapshot.unifiedDiff });
      const saved = page.getByRole("region", { name: "保存的轮次变更", exact: true });
      await expect(saved).toBeVisible();
      await saved.getByRole("button", { name: "文件操作", exact: true }).click(); await page.getByRole("menuitem", { name: "自动换行", exact: true }).click();
      await expect(saved.locator("[data-diff-wrap]")).toHaveCount(1);
      await saved.getByRole("button", { name: "文件操作", exact: true }).click(); await page.getByRole("menuitem", { name: "关闭自动换行", exact: true }).click();
      await expect(saved.locator("[data-diff-wrap]")).toHaveCount(0);
      await saved.getByRole("button", { name: "选择新文件第 80 行", exact: true }).click();
      await saved.getByRole("textbox", { name: "行评论", exact: true }).fill("保留本轮契约和输入草稿。");
      await saved.getByRole("button", { name: "保存评论", exact: true }).click();
      await saved.getByRole("button", { name: "加入此会话草稿", exact: true }).click();
      const state = await page.evaluate(async () => {
        const module = (path: string) => import(performance.getEntriesByType("resource").findLast(e => new URL(e.name).pathname === path)?.name ?? path);
        const { readDraft, sessionDraftKey } = await module("/src/session-mode/stores/useSessionDraftStore.ts"), { useWorkspaceStore } = await module("/src/session-mode/stores/useWorkspaceStore.ts");
        return { draft: readDraft(sessionDraftKey("codex", "ux-0")).text, other: readDraft(sessionDraftKey("codex", "ux-1")).text, cwd: useWorkspaceStore.getState().cwd, focused: document.activeElement?.tagName };
      });
      expect(state.draft).toContain(`${repo.filePath}:80-80`);expect(state.draft).toContain("保留本轮契约");expect(state.other).not.toContain("保留本轮契约");expect(state.cwd).toBe("/fixture/foreign-project");
      await saved.getByRole("button", { name: "并排视图", exact: true }).click();
      await expect(saved.locator('[data-diff-side="old"] [data-old-line="80"]')).toContainText("value80 = 80");
      await expect(saved.locator('[data-diff-side="new"] [data-new-line="80"]')).toContainText("value80 = 800");
      await page.screenshot({ path: info.outputPath(`saved-native-review-${width}-${theme}.png`), fullPage: true });
      // Reopen restores durable local comments, including the captured old owner.
      await page.evaluate(async () => {
        const module = (path: string) => import(performance.getEntriesByType("resource").findLast(e => new URL(e.name).pathname === path)?.name ?? path);
        const { useSavedTurnReviewStore } = await module("/src/session-mode/stores/useSavedTurnReviewStore.ts");
        const target = useSavedTurnReviewStore.getState().target;useSavedTurnReviewStore.getState().close();useSavedTurnReviewStore.getState().open(target);
      });
      await expect(saved.locator("[data-review-comment]")).toContainText("保留本轮契约");
      // Switch explicitly to the test workspace. All Git mutations below target it.
      await page.evaluate(async cwd => {
        const module = (path: string) => import(performance.getEntriesByType("resource").findLast(e => new URL(e.name).pathname === path)?.name ?? path);
        const { useWorkspaceStore } = await module("/src/session-mode/stores/useWorkspaceStore.ts"), { useSavedTurnReviewStore } = await module("/src/session-mode/stores/useSavedTurnReviewStore.ts"), { useGitDiffStore } = await module("/src/session-mode/stores/useGitDiffStore.ts");
        useWorkspaceStore.setState({ cwd });useSavedTurnReviewStore.getState().close();useGitDiffStore.getState().setDiffSource("unstaged");
      }, repo.cwd);
      const working = page.locator(".codex-workspace-hunk-review").first();
      await expect(working).toBeVisible({ timeout: 30000 });
      if (width === 1440) await working.hover();
      await working.getByRole("button", { name: "暂存变更块 1", exact: true }).click();
      await expect.poll(async () => (await exec("git", ["show", `:${repo.filePath}`], { cwd: repo.cwd })).stdout).toBe(repo.base.replace("value80 = 80;", "value80 = 800;"));
      expect(await readFile(join(repo.cwd, repo.filePath), "utf8")).toBe(repo.modified);
      await page.getByRole("combobox", { name: "变更来源", exact: true }).click();await page.getByRole("option", { name: /^已暂存/ }).click();
      if (width === 1440) await working.hover();
      await working.getByRole("button", { name: "取消暂存变更块 1", exact: true }).click();
      await expect.poll(async () => (await exec("git", ["show", `:${repo.filePath}`], { cwd: repo.cwd })).stdout).toBe(repo.base);
      await page.getByRole("combobox", { name: "变更来源", exact: true }).click();await page.getByRole("option", { name: /^未暂存/ }).click();
      if (width === 1440) await working.hover();
      await working.getByRole("button", { name: "还原变更块 2", exact: true }).click();
      const confirm = page.getByRole("alertdialog", { name: "确认丢弃变更块" });
      await expect(confirm).toContainText(join(repo.cwd, repo.filePath));
      expect(await readFile(join(repo.cwd, repo.filePath), "utf8")).toBe(repo.modified);
      await confirm.getByRole("button", { name: "确认丢弃此块", exact: true }).click();
      await expect.poll(async () => readFile(join(repo.cwd, repo.filePath), "utf8")).toBe(repo.modified.replace("value120 = 1200;", "value120 = 120;"));
      await expect(working.getByRole("button", { name: "暂存变更块 2", exact: true })).toHaveCount(0);
      await expect(working.getByRole("button", { name: "暂存变更块 1", exact: true })).toBeEnabled();
      await expect(working.locator('[data-new-line="80"]')).toContainText("value80 = 800");
      await page.screenshot({ path: info.outputPath(`workspace-native-review-${width}-${theme}.png`), fullPage: true });
      expect(requests).toHaveLength(3);expect(errors).toEqual([]);
      await info.attach("review-mutation-scopes.json", { body: Buffer.from(JSON.stringify(requests, null, 2)), contentType: "application/json" });
      await writeFile(info.outputPath("review-mutation-scopes.json"), JSON.stringify(requests, null, 2));
    } finally { await rm(repo.cwd, { force: true, recursive: true }); }
  });
});
test("50,000-line native patch mounts a bounded virtual viewport and reveals its tail", async ({ page }, info) => {
  test.setTimeout(90000);await prepare(page, 1440, "dark");
  const metrics = await page.evaluate(async () => {
    const react = await import((window as any).__sessionFixtureDependency("react.js")), dom = await import((window as any).__sessionFixtureDependency("react-dom_client.js")), { NativeDiffContent } = await import("/src/session-mode/features/NativeDiffContent.tsx"), { nativeDiffLines } = await import("/src/session-mode/features/nativeDiffLines.ts");
    const R = react.default ?? react, { createRoot } = dom.default ?? dom;
    document.getElementById("root")!.style.display = "none";
    const fixture = document.createElement("div");fixture.className = "session-mode dark codex-presentation";fixture.id = "review-large-patch";fixture.style.cssText = "width:700px;padding:16px;box-sizing:border-box";document.body.append(fixture);
    const source = "@@ -0,0 +1,50000 @@\n" + Array.from({ length: 50000 }, (_, index) => `+const value${index + 1} = ${index + 1};`).join("\n") + "\n";
    const started = performance.now();createRoot(fixture).render(R.createElement(NativeDiffContent, { lines: nativeDiffLines("", "", source), path: "huge.ts" }));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return { elapsedMs: performance.now() - started, rows: fixture.querySelectorAll(".codex-diff-line").length, elements: fixture.querySelectorAll("*").length };
  });
  expect(metrics.rows).toBeGreaterThan(0);expect(metrics.rows).toBeLessThan(100);expect(metrics.elements).toBeLessThan(700);expect(metrics.elapsedMs).toBeLessThan(2500);
  await page.locator("#review-large-patch .codex-diff-virtual").evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect(page.locator('#review-large-patch [data-new-line="50000"]')).toContainText("value50000 = 50000");
  await page.screenshot({ path: info.outputPath("native-review-large-patch.png") });
  await info.attach("large-patch-metrics.json", { body: Buffer.from(JSON.stringify(metrics, null, 2)), contentType: "application/json" });
  await writeFile(info.outputPath("large-patch-metrics.json"), JSON.stringify(metrics, null, 2));
});
