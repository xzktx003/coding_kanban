import { expect, test } from "@playwright/test";
import { installSessionUxFixture } from "./session-ux-fixture";

test("equivalent native child statuses settle across background wake without crashing the workbench", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await installSessionUxFixture(page, 1);
  await page.goto("/?mode=session");
  await expect(page.locator(".session-agent-view")).toBeVisible();
  for (const variant of ["reordered", "extended", "bounded", "approval", "completed"]) {
    await page.evaluate(async variant => {
      const load = async (path: string) => {
        const url = performance.getEntriesByType("resource")
          .findLast(entry => new URL(entry.name).pathname === path)?.name;
        if (!url) throw new Error(`Mounted module missing: ${path}`);
        return import(/* @vite-ignore */ url);
      };
      const { useCodexStore: codex } = await load("/src/session-mode/components/codex/stores/useCodexStore.ts");
      const { useSubagentStore: sub } = await load("/src/session-mode/features/subagents/store.ts");
      const { useAgentCenterStore: tabs } = await load("/src/session-mode/stores/useAgentCenterStore.ts");
      tabs.setState({ cards: [{ kind: "codex", id: "ux-0" }] });
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
      const child = "00000000-0000-4000-8000-000000000001";
      const flags = variant === "bounded" ? Array(24).fill("waitingOnApproval") : variant === "approval" ? ["waitingOnApproval"] : [];
      const status = variant === "completed" ? { type: "idle" } : variant === "extended" ? { type: "active", activeFlags: flags, detail: "native-extension" } : { activeFlags: flags, type: "active" };
      codex.setState((s: any) => ({ threadStatusMap: { ...s.threadStatusMap, [child]: status } }));
      sub.setState((s: any) => ({ nodes: { ...s.nodes, [child]: s.nodes[child] ?? { thread: { id: child, parentThreadId: "ux-0" }, parentId: "ux-0", verified: true, revision: 1 } } }));
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));
    }, variant);
    await expect(page.locator(".session-agent-view")).toBeVisible();
    await expect(page.locator(".workbench-state[role=alert]")).toHaveCount(0);
    await expect.poll(() => page.evaluate(async () => {
      const path = "/src/session-mode/features/subagents/store.ts";
      const url = performance.getEntriesByType("resource").findLast(entry => new URL(entry.name).pathname === path)!.name;
      const { useSubagentStore } = await import(/* @vite-ignore */ url);
      return useSubagentStore.getState().nodes["00000000-0000-4000-8000-000000000001"]?.thread.status?.type;
    })).toBe(variant === "completed" ? "idle" : "active");
  }
  expect(await page.evaluate(() => sessionStorage.getItem("kanban:workbench:last-error"))).toBeNull();
  expect(errors).toEqual([]);
});

// Exercises browser lifecycle and genuine grace-period reclamation separately.
// No model sends or access to real native session data.
test("a reclaimed session survives background idle and frozen offline wake without document reload", async ({ page, context }, info) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  let navigations = 0;
  page.on("pageerror", error => errors.push(error.message));
  page.on("crash", () => errors.push("renderer crashed"));
  page.on("request", request => { if (request.isNavigationRequest() && request.frame() === page.mainFrame()) navigations++; });
  const fixture = await installSessionUxFixture(page, 1);
  fixture.threads[0].turns = [{ id: "completed-turn", status: "completed", startedAt: 1, items: [{ type: "agentMessage", id: "answer", text: "Wake regression answer" }] }] as any;
  await page.addInitScript(() => {
    const card = { kind: "codex", id: "ux-0", cwd: "/fixture/项目/very-long-project-path-for-ui-regression", preview: "Wake regression" };
    localStorage.setItem("kanban.session.settings-storage", JSON.stringify({ version: 13, state: { warmFollowedSessions: false } }));
    localStorage.setItem("kanban.session.agent-center-store", JSON.stringify({ version: 5, state: { cards: [card], currentAgentCardId: card.id, currentAgentCardKind: "codex", cardsViewMode: "solo", sharedTabsInitialized: true } }));
  });
  await page.route("**/api/session/tabs", route => route.fulfill({ json: { cards: [{ kind: "codex", id: "ux-0", cwd: fixture.threads[0].cwd, preview: "Wake regression" }], initialized: true, revision: 1, sequence: 0 } }));
  await page.goto("/?mode=session");
  await expect(page.locator('[data-codex-transcript-shell="ux-0"]')).toBeVisible();
  await expect(page.locator('[data-message-author="assistant"]')).toContainText("Wake regression answer");
  await page.evaluate(() => {
    localStorage.setItem("wake-draft-sentinel", "unsent draft");
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.locator("[data-transcript-sleeping]")).toHaveCount(1, { timeout: 80_000 });
  const cdp = await context.newCDPSession(page);
  await cdp.send("Page.setWebLifecycleState", { state: "frozen" });
  await new Promise(resolve => setTimeout(resolve, 2000));
  await context.setOffline(true);
  await cdp.send("Page.setWebLifecycleState", { state: "active" });
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
  });
  await context.setOffline(false);
  await expect(page.locator("[data-transcript-sleeping]")).toHaveCount(0);
  await expect(page.locator('[data-message-author="assistant"]')).toContainText("Wake regression answer", { timeout: 30_000 });
  expect(await page.evaluate(() => localStorage.getItem("wake-draft-sentinel"))).toBe("unsent draft");
  expect(await page.locator(".workbench-state[role=alert]").count()).toBe(0);
  expect(errors).toEqual([]);
  expect(navigations).toBe(1);
  await info.attach("wake-result", { body: JSON.stringify({ errors, navigations, reclaimed: true, restored: true }), contentType: "application/json" });
});
