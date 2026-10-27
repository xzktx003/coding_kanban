import { expect, test } from "@playwright/test";
import { installSessionUxFixture } from "./session-ux-fixture";

test("an explicit recent-model operation shows the local warning while ordinary settings writes stay silent", async ({ page }) => {
  const fixture = await installSessionUxFixture(page, 1);
  const cards = fixture.threads.map(t => ({ kind: "codex", id: t.id, cwd: t.cwd, preview: t.name }));
  await page.route("**/api/session/tabs", route => route.fulfill({ json: { cards, initialized: true, revision: 1, sequence: 0 } }));
  await page.addInitScript(cards => localStorage.setItem("kanban.session.agent-center-store", JSON.stringify({ version: 5, state: { cards, currentAgentCardId: "ux-0", currentAgentCardKind: "codex", cardsViewMode: "solo", sharedTabsInitialized: true } })), cards);
  await page.goto("/?mode=session&view=agent", { waitUntil: "domcontentloaded" });
  await page.getByRole("tablist", { name: "关注会话" }).waitFor();
  await page.screenshot({
    path: `${process.env.CODEX_UI_SHOTS ?? "test-results"}/control-model-switch-page.png`,
    animations: "disabled",
  });
  await page.evaluate(async () => {
    const path = "/src/session-mode/stores/useThreadModelStore.ts";
    const module = await import(
      performance
        .getEntriesByType("resource")
        .findLast((entry) => new URL(entry.name).pathname === path)?.name ?? path
    );
    module.hydrateThreadModel("ux-0", { model: "fixture-model", reasoningEffort: "medium" });
    const noticePath = "/src/session-mode/components/codex/composer/ModelChangeNotice.tsx";
    const noticeModule = await import(performance.getEntriesByType("resource").findLast(entry => new URL(entry.name).pathname === noticePath)?.name ?? noticePath);
    const codexPath = "/src/session-mode/components/codex/stores/useCodexStore.ts";
    const { useCodexStore } = await import(performance.getEntriesByType("resource").findLast(entry => new URL(entry.name).pathname === codexPath)?.name ?? codexPath);
    useCodexStore.setState({events:{...useCodexStore.getState().events,"ux-0":[{method:"turn/completed",params:{threadId:"ux-0",turn:{id:"fixture-turn",items:[],itemsView:"full",status:"completed",error:null,startedAt:1,completedAt:2,durationMs:1000}}}]}});
    noticeModule.commitModelSelectionWithNotice("ux-0", "recent", () => module.changeThreadModel("ux-0", { model: "fixture-next" }));
  });
  const notice = page.locator(".codex-native-alert").filter({ hasText: "在对话中途更改模型" });
  await expect(notice).not.toContainText("模型已从");
  await expect(page.locator(".session-composer-rail .session-model-change-notice")).toHaveCount(0);
  await expect(notice).toContainText("在对话中途更改模型会降低性能。为获得最佳体验，请开始新会话，或切换回 fixture-model。");
  expect((await notice.innerText()).match(/降低性能/g)).toHaveLength(1);
  await expect(notice).not.toContainText("背景信息可能会自动压缩。");
  await expect(notice).not.toContainText("当前模型是");
  await page.screenshot({
    path: `${process.env.CODEX_UI_SHOTS ?? "test-results"}/control-model-switch-notice.png`,
    animations: "disabled",
  });
});
