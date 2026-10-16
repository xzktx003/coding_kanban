import type { Page } from "@playwright/test";
import type { ThreadGoal } from "../../apps/web/src/session-mode/bindings/v2";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";

export function sampleGoal(changes: Partial<ThreadGoal> = {}): ThreadGoal {
  return {
    threadId: "ux-0",
    objective: "修复目标状态恢复，所有验收通过",
    status: "blocked",
    tokenBudget: 100000,
    tokensUsed: 12500,
    timeUsedSeconds: 61,
    createdAt: 1,
    updatedAt: Math.floor(Date.now() / 1000),
    ...changes,
  };
}

export async function fixtureGoal(
  page: Page,
  options: { count?: number; goal?: ThreadGoal | null } = {},
) {
  const count = options.count ?? 2;
  const fixture = await installSessionUxFixture(page, count);
  const writes: Array<{ action: string; body: any }> = [];
  const initial = options.goal === undefined ? sampleGoal() : options.goal;
  const goals = new Map<string, ThreadGoal>(
    initial ? [[initial.threadId, initial]] : [],
  );
  let failure: { action: string; status: number; message: string } | null =
    null;
  let hold: {
    action: string;
    release: Promise<void>;
    resolve: () => void;
  } | null = null;
  await page.route("**/api/session/api/codex/thread/goal/*", async (route) => {
    const body = route.request().postDataJSON(),
      action = new URL(route.request().url()).pathname.split("/").at(-1)!;
    if (action !== "get") writes.push({ action, body });
    const waiting = hold?.action === action ? hold : null;
    if (waiting) {
      hold = null;
      await waiting.release;
    }
    if (failure?.action === action) {
      const failed = failure;
      failure = null;
      await route.fulfill({
        status: failed.status,
        json: { error: failed.message, deliveryStage: "not-admitted" },
      });
      return;
    }
    if (action === "set")
      goals.set(body.threadId, {
        ...sampleGoal({
          threadId: body.threadId,
          status: "active",
          tokenBudget: null,
          tokensUsed: 0,
          timeUsedSeconds: 0,
        }),
        ...goals.get(body.threadId),
        ...body,
        updatedAt: Math.floor(Date.now() / 1000),
      });
    const cleared = action === "clear" ? goals.delete(body.threadId) : false;
    await route.fulfill({
      json:
        action === "clear"
          ? { cleared }
          : { goal: goals.get(body.threadId) ?? null },
    });
  });
  await page.goto("/?mode=session");
  await page
    .locator(".session-agent-view [contenteditable=true]")
    .first()
    .waitFor({ timeout: 30000 });
  await seedSessionUx(page, count);
  if (count)
    await page.evaluate(async () => {
      const path = "/src/session-mode/stores/useAgentCenterStore.ts";
      const { useAgentCenterStore } = await import(
        performance
          .getEntriesByType("resource")
          .findLast((entry) => new URL(entry.name).pathname === path)?.name ??
          path
      );
      useAgentCenterStore
        .getState()
        .addAgentCard(
          {
            kind: "codex",
            id: "ux-0",
            cwd: "/fixture/项目/very-long-project-path-for-ui-regression",
            preview: "目标验收",
          },
          { activate: true },
        );
    });
  return {
    fixture,
    writes,
    goals,
    failNext(
      action: string,
      status = 409,
      message = "isolated goal rejection",
    ) {
      failure = { action, status, message };
    },
    holdNext(action: string) {
      let resolve!: () => void;
      const release = new Promise<void>((done) => {
        resolve = done;
      });
      hold = { action, release, resolve };
      return resolve;
    },
    async emit(goal: ThreadGoal | null, threadId = goal?.threadId ?? "ux-0") {
      if (goal) goals.set(threadId, goal);
      else goals.delete(threadId);
      await page.evaluate(
        async ({ goal, threadId }) => {
          const path = "/src/session-mode/components/codex/stores/index.ts";
          const { useCodexStore } = await import(
            performance
              .getEntriesByType("resource")
              .findLast((entry) => new URL(entry.name).pathname === path)
              ?.name ?? path
          );
          useCodexStore
            .getState()
            .addEvent(
              threadId,
              goal
                ? { method: "thread/goal/updated", params: { threadId, goal } }
                : { method: "thread/goal/cleared", params: { threadId } },
            );
        },
        { goal, threadId },
      );
    },
  };
}
