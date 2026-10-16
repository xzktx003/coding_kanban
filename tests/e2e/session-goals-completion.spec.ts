import { expect, test, type Page } from "@playwright/test";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";
import { liveStream } from "./session-sse-fixture";
import { sampleGoal } from "./session-goal-fixture";
import type { ThreadGoal } from "../../apps/web/src/session-mode/bindings/v2";

async function setup(page: Page, baseURL: string, options: { owned?: boolean; toolOnly?: boolean } = {}) {
  const fixture = await installSessionUxFixture(page, 1);
  const goal = sampleGoal({ status: "complete", updatedAt: 100, timeUsedSeconds: 3661 });
  const goals = new Map<string, ThreadGoal>();
  const writes: Array<{ action: string; body: any }> = [];
  let releaseClear!: () => void;
  const clearReceipt = new Promise<void>(resolve => { releaseClear = resolve; });
  const turn = (id: string, startedAt: number, items: any[]) => ({
    id, startedAt, completedAt: startedAt + 1, durationMs: 1000, status: "completed",
    error: null, itemsView: "full", items,
  });
  const answer = (id: string, text: string) => ({ type: "agentMessage", id, text, phase: "final_answer", memoryCitation: null });
  (fixture.threads[0] as any).turns = [
    turn("older", 1, [answer("older-answer", "较早轮次的回复")]),
    turn("achieved", 99, options.toolOnly ? [{
      type: "commandExecution", id: "only-tool", command: "true", cwd: fixture.threads[0].cwd,
      processId: null, status: "completed", commandActions: [{ type: "unknown", command: "true" }],
      aggregatedOutput: null, exitCode: 0, durationMs: 1000,
    }] : [answer("final-answer", "目标轮次的最终回复")]),
  ];
  await page.route("**/api/session/api/codex/thread/access", route => route.fulfill({
    json: { state: options.owned ? "owned" : "readonly", reason: "", generation: 17 },
  }));
  await page.route("**/api/session/api/codex/thread/goal/*", async route => {
    const action = new URL(route.request().url()).pathname.split("/").at(-1)!;
    const body = route.request().postDataJSON();
    if (action === "get") { await route.fulfill({ json: { goal: goals.get(body.threadId) ?? null } }); return; }
    writes.push({ action, body });
    if (action !== "clear-completed") { await route.fulfill({ status: 409, json: { error: "unexpected goal mutation" } }); return; }
    // Mutation happens before the delayed receipt, like a real lost/late ACK.
    if (JSON.stringify(goals.get(body.threadId)) === JSON.stringify(body.expectedGoal)) goals.delete(body.threadId);
    await clearReceipt;
    await route.fulfill({ json: { cleared: true } });
  });
  const stream = await liveStream(page, baseURL);
  await page.goto("/?mode=session");
  await page.locator(".session-agent-view [contenteditable=true]").first().waitFor({ timeout: 30000 });
  await seedSessionUx(page, 1);
  await page.evaluate(async () => {
    const path = "/src/session-mode/stores/useAgentCenterStore.ts";
    const { useAgentCenterStore } = await import(performance.getEntriesByType("resource").findLast(e => new URL(e.name).pathname === path)?.name ?? path);
    useAgentCenterStore.getState().addAgentCard({ kind: "codex", id: "ux-0", cwd: "/fixture/项目/very-long-project-path-for-ui-regression", preview: "完成目标" }, { activate: true });
  });
  // Wait for the actual tab selection path after first-load bootstrap settles.
  await page.getByRole("tab", { name: /^中文会话 0 / }).click();
  await expect(page.getByText("较早轮次的回复", { exact: true })).toBeVisible();
  await expect.poll(() => stream.connections()).toBeGreaterThan(0);
  let seq = 0;
  return { fixture, goal, writes, releaseClear, stream,
    emit(value: ThreadGoal | null) {
      if (value) goals.set("ux-0", value); else goals.delete("ux-0");
      stream.emit(++seq, value ? { method: "thread/goal/updated", params: { threadId: "ux-0", turnId: "achieved", goal: value } }
        : { method: "thread/goal/cleared", params: { threadId: "ux-0" } });
    },
  };
}

async function hostTheme(page: Page) {
  await page.evaluate(() => {
    document.documentElement.style.setProperty("--vscode-font-family", "system-ui");
    document.documentElement.style.setProperty("--vscode-foreground", "#ccc");
    document.documentElement.style.setProperty("--vscode-descriptionForeground", "#858585");
  });
}

test("owned completion clears once through the guarded endpoint and retains the exact assistant achievement", async ({ page, baseURL }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  const f = await setup(page, baseURL!, { owned: true });
  try {
    f.emit(f.goal);
    await expect.poll(() => f.writes.length).toBe(1);
    await expect(page.locator(".session-thread-goal")).toHaveAttribute("data-goal-status", "complete");
    const badge = page.locator("[data-goal-achieved]");
    await expect(badge).toHaveText("已在 1h 1m 1s 内达成目标");
    expect(await badge.locator("xpath=ancestor::*[@data-owner-turn][1]").getAttribute("data-owner-turn")).toBe("achieved");
    expect(f.writes[0]).toEqual({ action: "clear-completed", body: { threadId: "ux-0", expectedGoal: f.goal, expectedAccessGeneration: 17 } });
    f.releaseClear();
    await expect(page.locator(".session-thread-goal")).toHaveCount(0);
    await expect(badge).toHaveCount(1);
    f.emit({ ...f.goal, status: "active", objective: "下一个目标", updatedAt: 102 });
    await expect(badge).toHaveCount(0);
    await expect(page.locator(".session-thread-goal")).toContainText("下一个目标");
    expect(f.writes).toHaveLength(1);
    expect(f.fixture.calls.filter(c => /\/(?:resume|turn\/start|turn\/steer|turn\/interrupt|followups\/submit)$/.test(c.path))).toEqual([]);
    expect(errors).toEqual([]);
  } finally { f.releaseClear(); await f.stream.close(); }
});

test("a delayed completed clear ACK cannot erase a new active goal or restore its previous badge", async ({ page, baseURL }) => {
  const f = await setup(page, baseURL!, { owned: true });
  try {
    f.emit(f.goal);
    await expect.poll(() => f.writes.length).toBe(1);
    f.emit({ ...f.goal, status: "active", objective: "后来的真实目标", createdAt: 102, updatedAt: 102 });
    await expect(page.locator(".session-thread-goal")).toContainText("后来的真实目标");
    f.releaseClear();
    await expect(page.locator("[data-goal-achieved]")).toHaveCount(0);
    await expect(page.locator(".session-thread-goal")).toHaveAttribute("data-goal-status", "active");
    await page.waitForTimeout(100);
    await expect(page.locator(".session-thread-goal")).toContainText("后来的真实目标");
    expect(f.writes).toHaveLength(1);
  } finally { f.releaseClear(); await f.stream.close(); }
});

test("a readonly tool-only completed turn owns one native-format fallback, surviving clear without a writer takeover", async ({ page, context, baseURL }, info) => {
  const f = await setup(page, baseURL!, { toolOnly: true });
  try {
    f.emit(f.goal);
    const fallback = page.locator('[data-goal-completion-fallback="achieved"]');
    await expect(fallback).toHaveCount(1);
    await fallback.hover();
    const badge = fallback.locator("[data-goal-achieved]");
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText("已在 1h 1m 1s 内达成目标");
    expect(await page.locator("[data-owner-turn=older] [data-goal-achieved]").count()).toBe(0);
    f.emit(null);
    await expect(page.locator(".session-thread-goal")).toHaveCount(0);
    await expect(fallback).toHaveCount(1);
    expect(f.writes).toEqual([]);
    expect(f.fixture.calls.filter(c => /\/(?:resume|turn\/start|turn\/steer|turn\/interrupt|followups\/submit)$/.test(c.path))).toEqual([]);
    if (process.env.CODEX_GOAL_REFERENCE_URL) {
      const native = await context.newPage();
      await native.goto(process.env.CODEX_GOAL_REFERENCE_URL);
      await native.waitForFunction(() => (window as any).nativeLoaded);
      await native.evaluate(async () => {
        await import(new URL("./native-goal-completion-reference.js", location.href).href);
        Object.assign(document.getElementById("root")!.style, { height: "auto", display: "flex", alignItems: "center" });
        (window as any).renderNativeGoalCompletion({ timeUsedSeconds: 3661 });
      });
      await hostTheme(page); await hostTheme(native);
      const original = native.locator("#root > span");
      await expect(original).toHaveText("已在 1h 1m 1s 内达成目标");
      const measure = (element: HTMLElement) => {
        const s = getComputedStyle(element), r = element.getBoundingClientRect();
        return { width: r.width, height: r.height, fontSize: s.fontSize, lineHeight: s.lineHeight, gap: s.gap, marginInlineStart: s.marginInlineStart,
          color: s.color, separator: { height: getComputedStyle(element.firstElementChild!).height, border: getComputedStyle(element.firstElementChild!).borderInlineStart },
          paths: Array.from(element.querySelectorAll("svg")).filter(svg => svg.getBoundingClientRect().width).flatMap(svg => Array.from(svg.querySelectorAll("path")).map(path => path.getAttribute("d"))),
        };
      };
      const actual = await badge.evaluate(measure), expected = await original.evaluate(measure);
      await info.attach("completion-original-dom-metrics", { body: JSON.stringify({ actual, expected }, null, 2), contentType: "application/json" });
      expect(actual).toEqual(expected);
      await fallback.hover();
      await badge.screenshot({ path: info.outputPath("session-goal-achieved.png") });
      await original.screenshot({ path: info.outputPath("native-goal-achieved.png") });
      expect(await native.evaluate(() => (window as any).nativeErrors)).toEqual([]);
      await native.close();
    }
  } finally { f.releaseClear(); await f.stream.close(); }
});
