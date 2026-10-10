import { expect, test } from "@playwright/test";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";
const exec = promisify(execFile);
for (const width of [1440, 390]) test.describe(`readonly real review target ${width}px`, () => {
  test.use({ isMobile: width === 390, hasTouch: width === 390 });
  for (const theme of ["dark", "light"]) test(`base/commit Diff findings preserve owner and Git bytes (${theme})`, async ({ page }, info) => {
    test.setTimeout(60000);
    const cwd = await mkdtemp(join(tmpdir(), "kanban-review-target-browser-")), file = "中文 100%:12.ts", git = (...args: string[]) => exec("git", args, { cwd, env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } });
    const responses: unknown[] = [], mutations: string[] = [], errors: string[] = []; page.on("response", async r => { if (r.url().includes("/git/review/read")) responses.push({ url: r.url(), status: r.status(), body: await r.text().catch(() => "unreadable") }); }); page.on("pageerror", e => errors.push(e.message)); page.on("request", r => { if (/\/git\/hunks\/action|\/followups\/review|\/saved-patches\/.*action/.test(r.url())) mutations.push(r.url()); });
    try {
      await git("init", "-q"); await writeFile(join(cwd, file), "const value = 1;\n"); await git("add", "--", file); await git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "base"); await git("branch", "base");
      await writeFile(join(cwd, file), "const value = 2;\n"); await git("add", "--", file); await git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "change"); const sha = (await git("rev-parse", "HEAD")).stdout.trim();
      await writeFile(join(cwd, file), "const value = 3;\n"); await git("add", "--", file); await writeFile(join(cwd, file), "const value = 4;\n");
      const status = (await git("status", "--porcelain=v1")).stdout, index = await readFile(join(cwd, ".git/index"));
      await installSessionUxFixture(page);
      const item = { id: "review-result", type: "agentMessage", phase: null, text: `Review completed.\n\n::code-comment{title="[P1] Preserve owner" body="Keep **ownership** and native coordinates." file=${JSON.stringify(file)} start=1 end=1 priority=1}` };
      const nativeThread = { id: "ux-0", name: "审查结果", preview: "审查结果", cwd, createdAt: 1, updatedAt: 2, modelProvider: "openai", status: { type: "idle" }, turns: [{ id: "review-turn", status: "completed", items: [item] }] };
      await page.route("**/api/session/api/codex/thread/**", async route => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith("/turns/list")) await route.fulfill({ json: { data: nativeThread.turns, nextCursor: null } });
        else if (path.endsWith("/list")) await route.fulfill({ json: { data: [{ ...nativeThread, turns: [] }], nextCursor: null } });
        else if (path.endsWith("/read") || path.endsWith("/metadata")) await route.fulfill({ json: { thread: nativeThread } });
        else await route.fallback();
      });
      await page.route("**/api/session/git/review/**", r => r.continue()); await page.setViewportSize({ width, height: 1000 }); await page.goto("/?mode=session", { waitUntil: "domcontentloaded" }); await page.locator(".session-codex-composer [contenteditable=true]").first().waitFor({ timeout: 60000 }); await seedSessionUx(page);
      await page.evaluate(async ({ cwd, file, theme }) => {
        const module = (path: string) => import(performance.getEntriesByType("resource").findLast(e => new URL(e.name).pathname === path)?.name ?? path);
        const { useThemeStore } = await module("/src/session-mode/stores/settings/useThemeStore.ts"), { useSavedTurnReviewStore } = await module("/src/session-mode/stores/useSavedTurnReviewStore.ts"), { useCodexStore } = await module("/src/session-mode/components/codex/stores/index.ts"), { useWorkspaceStore } = await module("/src/session-mode/stores/useWorkspaceStore.ts"), { useAgentCenterStore } = await module("/src/session-mode/stores/useAgentCenterStore.ts");
        useAgentCenterStore.setState({ cards: [{ kind: "codex", id: "ux-0", cwd, preview: "原生审查结果" }], currentAgentCardId: "ux-0", currentAgentCardKind: "codex", cardsViewMode: "solo" });
        useAgentCenterStore.getState().addAgentCard({ kind: "codex", id: "ux-0", cwd, preview: "原生审查结果" }, true);
        useThemeStore.getState().setTheme(theme); useWorkspaceStore.setState({ cwd: "/fixture/foreign" });
        useCodexStore.setState({ historyLoadedMap: { "ux-0": true }, historyLoadingMap: { "ux-0": false }, historyErrorMap: {}, threads: useCodexStore.getState().threads.map((t: any) => t.id === "ux-0" ? { ...t, cwd } : t), events: { ...useCodexStore.getState().events, "ux-0": [{ method: "item/completed", params: { threadId: "ux-0", turnId: "review-turn", item: { id: "review-result", type: "agentMessage", text: `Review completed.\n\n::code-comment{title="[P1] Preserve owner" body="Keep **ownership** and native coordinates." file=${JSON.stringify(file)} start=1 end=1 priority=1}` } } }] } });
        useSavedTurnReviewStore.getState().captureReviewScope({ requestThreadId: "request", reviewThreadId: "ux-0", turnId: "review-turn", cwd, target: { type: "baseBranch", branch: "base" } });
      }, { cwd, file, theme });
      await page.screenshot({ path: info.outputPath("review-target-before-open.png") });
      await page.getByRole("button", { name: "查看审查 Diff", exact: true }).click({ timeout: 15000 });
      const panel = page.getByRole("region", { name: "Git 审查快照", exact: true }); await expect(panel).toBeVisible(); await expect(panel).toContainText("共同祖先 → HEAD"); await expect(panel.locator('[data-new-line="1"]')).toContainText("value = 2"); await expect(panel.locator("[data-review-model-finding]")).toContainText("Preserve owner");
      await expect(panel.getByRole("button", { name: /暂存|还原|撤销|重新应用/ })).toHaveCount(0);
      await panel.locator("[data-review-model-finding]").getByRole("button", { name: "回复此意见", exact: true }).click();
      const owner = await page.evaluate(async () => {
        const module = (path: string) => import(performance.getEntriesByType("resource").findLast(e => new URL(e.name).pathname === path)?.name ?? path);
        const { readDraft, sessionDraftKey } = await module("/src/session-mode/stores/useSessionDraftStore.ts"), { useWorkspaceStore } = await module("/src/session-mode/stores/useWorkspaceStore.ts"); return { own: readDraft(sessionDraftKey("codex", "ux-0")).text, other: readDraft(sessionDraftKey("codex", "ux-1")).text, cwd: useWorkspaceStore.getState().cwd };
      });
      expect(owner.own).toContain(`${file}:1-1`); expect(owner.other).not.toContain("Preserve owner"); expect(owner.cwd).toBe("/fixture/foreign");
      await page.screenshot({ path: info.outputPath(`readonly-base-review-${width}-${theme}.png`), fullPage: true });
      await panel.getByRole("button", { name: "查看当前工作区变更", exact: true }).click();
      if (width === 390) await page.getByRole("button", { name: "隐藏工具面板", exact: true }).click();
      await page.evaluate(async ({ cwd, sha }) => { const path = "/src/session-mode/stores/useSavedTurnReviewStore.ts"; const { useSavedTurnReviewStore } = await import(performance.getEntriesByType("resource").findLast(e => new URL(e.name).pathname === path)?.name ?? path); useSavedTurnReviewStore.getState().captureReviewScope({ requestThreadId: "request", reviewThreadId: "ux-0", turnId: "review-turn", cwd, target: { type: "commit", sha, title: "change" } }); }, { cwd, sha });
      await expect(page.getByText(`提交：${sha.slice(0, 12)}`, { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "查看审查 Diff", exact: true }).click(); await expect(panel).toContainText("父提交 → 此提交"); await expect(panel.locator('[data-new-line="1"]')).toContainText("value = 2");
      expect(await readFile(join(cwd, ".git/index"))).toEqual(index); expect((await git("status", "--porcelain=v1")).stdout).toBe(status); expect(await readFile(join(cwd, file), "utf8")).toBe("const value = 4;\n"); expect(mutations).toEqual([]); expect(errors).toEqual([]);
      await writeFile(info.outputPath("readonly-review-owner.json"), JSON.stringify({ owner, mutations, sha, status }, null, 2));
    } finally { await writeFile(info.outputPath("readonly-review-responses.json"), JSON.stringify(responses, null, 2)); await rm(cwd, { recursive: true, force: true }); }
  });
});
