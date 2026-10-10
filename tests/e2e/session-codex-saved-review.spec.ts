import { expect, test, type Page } from "@playwright/test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "../../apps/server/node_modules/fastify";
import { CodexSavedPatch } from "../../apps/server/src/services/codex-saved-patch";
import { registerSessionSavedPatchRoutes } from "../../apps/server/src/routes/session-saved-patch";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";
const exec = promisify(execFile);
const patch = "--- a/file.py\n+++ b/file.py\n@@ -80 +80 @@\n-before\n+after\n";
async function populate(page: Page, cwd: string, theme: string) {
  await page.evaluate(async ({ cwd, theme, patch }) => {
    const module = (path: string) => import(performance.getEntriesByType("resource").findLast(e => new URL(e.name).pathname === path)?.name ?? path);
    const { useCodexStore } = await module("/src/session-mode/components/codex/stores/index.ts");
    const { useAgentCenterStore } = await module("/src/session-mode/stores/useAgentCenterStore.ts");
    const { useThemeStore } = await module("/src/session-mode/stores/settings/useThemeStore.ts");
    const { useLayoutStore } = await module("/src/session-mode/stores/useLayoutStore.ts");
    const { useWorkspaceStore } = await module("/src/session-mode/stores/useWorkspaceStore.ts");
    const item = { type: "fileChange", id: "saved-patch", status: "completed", changes: [{ path: cwd + "/file.py", kind: { type: "update", move_path: null }, diff: patch }] };
    const events = [{ method: "item/completed", params: { threadId: "ux-0", turnId: "saved-turn", item } }, { method: "turn/completed", params: { threadId: "ux-0", turn: { id: "saved-turn", status: "completed", items: [item] } } }];
    useThemeStore.getState().setTheme(theme);
    useLayoutStore.setState({ view: "agent", isSidebarOpen: false, isRightPanelOpen: false, diffSplitMode: false });
    useAgentCenterStore.setState({ cards: [{ kind: "codex", id: "ux-0", cwd, preview: "保存的轮次" }], currentAgentCardId: "ux-0", cardsViewMode: "solo" });
    useCodexStore.setState({ threads: useCodexStore.getState().threads.map((t: any) => t.id === "ux-0" ? { ...t, cwd } : t), currentThreadId: "ux-0", currentTurnId: null, turnTimingMap: {}, threadStatusMap: {}, events: { "ux-0": events }, historyLoadedMap: { "ux-0": true } });
    // Deliberately keep a different global project: the transcript owns its review.
    useWorkspaceStore.setState({ cwd: "/fixture/foreign-project" });
  }, { cwd, theme, patch });
}
for (const width of [1440, 390]) test.describe(`${width}px saved turn review`, () => {
  test.use({ hasTouch: width === 390, isMobile: width === 390 });
  for (const theme of ["dark", "light"]) test(`saved review and real isolated Git undo/reapply (${width}, ${theme})`, async ({ page }, info) => {
    test.setTimeout(90000);
    const cwd = await mkdtemp(join(tmpdir(), "kanban-browser-saved-patch-"));
    const app = Fastify();
    const errors: string[] = [], requests: any[] = [];
    page.on("pageerror", e => errors.push(e.message));
    try {
      await exec("git", ["init", "-q"], { cwd });
      const prefix = Array.from({ length: 79 }, (_, i) => `context ${i}\n`).join("");
      await writeFile(join(cwd, "file.py"), prefix + "before\ntail\n");
      await exec("git", ["add", "file.py"], { cwd });
      const index = await readFile(join(cwd, ".git/index"));
      await writeFile(join(cwd, "file.py"), prefix + "after\ntail\nmy later change\n");
      const batch = { id: "saved-patch", changes: [{ path: join(cwd, "file.py"), kind: { type: "update" as const, move_path: null }, diff: patch }] };
      const service = new CodexSavedPatch(async threadId => {
        expect(threadId).toBe("ux-0");
        return { thread: { id: threadId, cwd, status: { type: "idle" }, turns: [{ id: "saved-turn", status: "completed", items: [{ ...batch, type: "fileChange", status: "completed" }] }] } };
      }, join(cwd, "journal.json"));
      registerSessionSavedPatchRoutes(app, { origin: () => null, service });
      await installSessionUxFixture(page);
      // Background read-only reconciliation must see the same native ownership
      // as the operation service, rather than the generic fixture's directory.
      const nativeThread = { id: "ux-0", name: "保存的轮次", preview: "保存的轮次", cwd, createdAt: 1, updatedAt: 2, modelProvider: "openai", status: { type: "idle" }, turns: [{ id: "saved-turn", status: "completed", items: [{ ...batch, type: "fileChange", status: "completed" }] }] };
      await page.route("**/api/session/api/codex/thread/**", async route => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith("/turns/list")) await route.fulfill({ json: { data: nativeThread.turns, nextCursor: null } });
        else if (path.endsWith("/list")) await route.fulfill({ json: { data: [{ ...nativeThread, turns: [] }], nextCursor: null } });
        else if (path.endsWith("/read") || path.endsWith("/metadata")) await route.fulfill({ json: { thread: nativeThread } });
        else await route.fallback();
      });
      await page.route("**/api/session/saved-patches/**", async route => {
        const request = route.request();
        const body = request.method() === "POST" ? request.postDataJSON() : undefined;
        if (body) requests.push(body);
        const result = await app.inject({ method: request.method() as "POST" | "GET", url: new URL(request.url()).pathname + new URL(request.url()).search, payload: body });
        await route.fulfill({ status: result.statusCode, contentType: "application/json", body: result.body });
      });
      await page.setViewportSize({ width, height: 1000 });
      await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
      await page.locator(".session-codex-composer [contenteditable=true]").first().waitFor({ timeout: 60000 });
      await seedSessionUx(page);
      await populate(page, cwd, theme);
      const summary = page.locator(".codex-presentation .session-file-changes").first();
      await expect(summary).toBeVisible();
      await expect(summary.locator(".codex-turn-diff-title-text")).toContainText("file.py");
      await expect(summary.locator(".session-file-change-row")).toHaveCount(0);
      await page.screenshot({ path: info.outputPath(`saved-footer-${width}-${theme}.png`), fullPage: true });
      await summary.getByRole("button", { name: "预览 file.py Diff", exact: true }).click();
      await expect(page.locator('.codex-file-preview[data-slot="hover-card-content"]')).toBeVisible();
      await summary.getByRole("button", { name: "file.py", exact: true }).click();
      const review = page.getByRole("region", { name: "保存的轮次变更", exact: true });
      await expect(review).toBeVisible();
      await expect(review).toHaveAttribute("data-owner-thread", "ux-0");
      await expect(review).toHaveAttribute("data-owner-turn", "saved-turn");
      await expect(review.locator('[data-new-line="80"]')).toContainText("after");
      await review.getByRole("button", { name: "并排视图", exact: true }).click();
      await expect(review.locator('[data-diff-split="true"]')).toBeVisible();
      await expect(review.locator('[data-diff-side="old"] [data-old-line="80"]')).toContainText("before");
      await expect(review.locator('[data-diff-side="new"] [data-new-line="80"]')).toContainText("after");
      await expect(page.locator('.codex-file-preview[data-slot="hover-card-content"]')).toHaveCount(0);
      await page.screenshot({ path: info.outputPath(`saved-review-${width}-${theme}.png`), fullPage: true });
      await review.getByRole("button", { name: "撤销此轮保存的变更", exact: true }).click();
      await expect(page.getByRole("alertdialog")).toContainText(cwd);
      expect(requests).toHaveLength(0);
      await page.getByRole("button", { name: "确认撤销", exact: true }).click();
      await expect(review.getByRole("button", { name: "重新应用此轮保存的变更", exact: true })).toBeVisible();
      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({ threadId: "ux-0", turnId: "saved-turn", action: "undo", expectedChanges: [batch] });
      expect(requests[0]).not.toHaveProperty("cwd");
      expect(await readFile(join(cwd, "file.py"), "utf8")).toBe(prefix + "before\ntail\nmy later change\n");
      expect(await readFile(join(cwd, ".git/index"))).toEqual(index);
      // Saved patch rendering never follows the live worktree after undo.
      await expect(review.locator('[data-diff-side="new"] [data-new-line="80"]')).toContainText("after");
      await review.getByRole("button", { name: "重新应用此轮保存的变更", exact: true }).click();
      await expect(review.getByRole("button", { name: "撤销此轮保存的变更", exact: true })).toBeEnabled();
      expect(await readFile(join(cwd, "file.py"), "utf8")).toBe(prefix + "after\ntail\nmy later change\n");
      await writeFile(join(cwd, "file.py"), prefix + "another later edit\ntail\nmy later change\n");
      await review.getByRole("button", { name: "撤销此轮保存的变更", exact: true }).click();
      await page.getByRole("button", { name: "确认撤销", exact: true }).click();
      await expect(review.getByRole("status")).toContainText("冲突");
      expect(await readFile(join(cwd, "file.py"), "utf8")).toBe(prefix + "another later edit\ntail\nmy later change\n");
      expect(requests).toHaveLength(3);
      expect(errors).toEqual([]);
    } finally { await app.close(); await rm(cwd, { force: true, recursive: true }); }
  });
});
