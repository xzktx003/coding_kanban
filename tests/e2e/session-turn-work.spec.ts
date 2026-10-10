import { expect, test, type Page } from "@playwright/test";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";

async function seedWork(page: Page, theme: string) {
  await page.evaluate(async (theme) => {
    const module = (path: string) =>
      import(
        performance
          .getEntriesByType("resource")
          .findLast((e) => new URL(e.name).pathname === path)?.name ?? path
      );
    const { useCodexStore } = await module(
      "/src/session-mode/components/codex/stores/index.ts",
    );
    const { useLayoutStore } = await module(
      "/src/session-mode/stores/useLayoutStore.ts",
    );
    const { useAgentCenterStore } = await module(
      "/src/session-mode/stores/useAgentCenterStore.ts",
    );
    const { useThemeStore } = await module(
      "/src/session-mode/stores/settings/useThemeStore.ts",
    );
    useThemeStore.getState().setTheme(theme);
    useLayoutStore.setState({
      view: "agent",
      isSidebarOpen: false,
      isRightPanelOpen: false,
    });
    useAgentCenterStore.getState().addAgentCard(
      {
        kind: "codex",
        id: "ux-0",
        cwd: "/fixture/项目/very-long-project-path-for-ui-regression",
        preview: "工作摘要验收",
      },
      { activate: true },
    );
    useAgentCenterStore.setState({ cardsViewMode: "solo" });
    const startedAt = Date.now() / 1000 - 166;
    const item = (id: string, data: object, method = "item/completed") => ({
      method,
      params: { threadId: "ux-0", turnId: "work-turn", item: { id, ...data } },
    });
    useCodexStore.setState({
      currentThreadId: "ux-0",
      currentTurnId: "work-turn",
      historyLoadedMap: { "ux-0": true },
      historyLoadingMap: {},
      threadStatusMap: { "ux-0": { type: "active", activeFlags: [] } },
      turnTimingMap: {
        "ux-0": {
          turnId: "work-turn",
          status: "inProgress",
          startedAtMs: startedAt * 1000,
          durationMs: null,
        },
      },
      events: {
        "ux-0": [
          {
            method: "turn/started",
            params: {
              threadId: "ux-0",
              turn: {
                id: "work-turn",
                status: "inProgress",
                startedAt,
                items: [],
              },
            },
          },
          item(
            "user",
            {
              type: "userMessage",
              content: [{ type: "text", text: "工作摘要验收任务" }],
            },
            "item/started",
          ),
          item("comment", {
            type: "agentMessage",
            phase: "commentary",
            text: "中间过程验收文本",
          }),
          {
            method: "turn/plan/updated",
            params: {
              threadId: "ux-0",
              turnId: "work-turn",
              explanation: "验收计划",
              plan: [{ step: "工作摘要检查", status: "completed" }],
            },
          },
          {
            method: "item/commandExecution/terminalInteraction",
            params: {
              threadId: "ux-0",
              turnId: "work-turn",
              itemId: "command",
              stdin: "验收终端输入",
            },
          },
          item("hook", {
            type: "hookPrompt",
            fragments: [{ text: "验收 Hook 过程", hookRunId: "hook-run" }],
          }),
          item("legacy-progress", {
            type: "agentMessage",
            text: "可搜索的历史过程",
          }),
          item("reason", {
            type: "reasoning",
            summary: ["公开思考摘要验收"],
            content: [],
          }),
          item("final", {
            type: "agentMessage",
            phase: "final_answer",
            text: "最终报告验收文本",
          }),
        ],
      },
    });
  }, theme);
}

for (const width of [390, 1440])
  for (const theme of ["dark", "light"]) {
    test(`live turn summary freezes and folds completed process (${width}, ${theme})`, async ({
      page,
    }, info) => {
      test.setTimeout(60000);
      await page.setViewportSize({ width, height: 1100 });
      const fixture = await installSessionUxFixture(page, 1);
      await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
      await page
        .locator(".session-codex-composer [contenteditable=true]")
        .first()
        .waitFor();
      await seedSessionUx(page, 1);
      await expect(
        page.getByRole("heading", { name: "开始一个会话", exact: true }),
      ).toBeVisible();
      await seedWork(page, theme);
      const header = page.locator('[data-turn-work="work-turn"]');
      await expect(header).toHaveText(/已处理 2分钟 \d+秒/);
      await expect(
        page.getByText("中间过程验收文本", { exact: true }),
      ).toBeVisible();
      const initial = await header.innerText();
      await expect.poll(() => header.innerText()).not.toBe(initial);
      await page.evaluate(async () => {
        const path = "/src/session-mode/components/codex/stores/index.ts";
        const { useCodexStore } = await import(
          performance
            .getEntriesByType("resource")
            .findLast((e) => new URL(e.name).pathname === path)?.name ?? path
        );
        useCodexStore.getState().addEvent("ux-0", {
          method: "turn/completed",
          params: {
            threadId: "ux-0",
            turn: {
              id: "work-turn",
              status: "completed",
              startedAt: Date.now() / 1000 - 659,
              completedAt: Date.now() / 1000,
              durationMs: 659000,
              items: [],
            },
          },
        });
      });
      await expect(header).toHaveText("用时 10分钟 59秒");
      await expect(header).toHaveAttribute("aria-expanded", "false");
      await expect(
        page.getByText("中间过程验收文本", { exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByText("公开思考摘要验收", { exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByText("最终报告验收文本", { exact: true }),
      ).toBeVisible();
      await expect(page.locator("[data-codex-row]")).toHaveCount(3);
      await page.screenshot({
        path: info.outputPath("completed-work.png"),
        fullPage: true,
      });
      const before = await header.boundingBox();
      await header.click();
      await expect(header).toHaveAttribute("aria-expanded", "true");
      await expect(
        page.getByText("中间过程验收文本", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText("最终报告验收文本", { exact: true }),
      ).toBeVisible();
      await expect
        .poll(async () => Math.abs((await header.boundingBox())!.y - before!.y))
        .toBeLessThan(1);
      await header.click();
      await expect(header).toHaveAttribute("aria-expanded", "false");
      await expect(
        page.getByText("中间过程验收文本", { exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByText("最终报告验收文本", { exact: true }),
      ).toBeVisible();
      await page.route("**/api/codex/thread/search-occurrences", (route) =>
        route.fulfill({
          status: 501,
          json: { error: "fixture native search unsupported" },
        }),
      );
      await page.evaluate(async () => {
        const path = "/src/session-mode/features/thread-workflows/actions.ts";
        const { threadWorkflowActions } = await import(
          performance
            .getEntriesByType("resource")
            .findLast((e) => new URL(e.name).pathname === path)?.name ?? path
        );
        threadWorkflowActions.request("ux-0", "search");
      });
      await page
        .getByRole("textbox", { name: "搜索会话正文", exact: true })
        .fill("可搜索的历史过程");
      await page
        .locator(".codex-thread-search-results [role=listitem]")
        .first()
        .click();
      await expect(header).toHaveAttribute("aria-expanded", "true");
      await expect(
        page
          .locator(".codex-assistant-content")
          .filter({ hasText: "可搜索的历史过程" }),
      ).toBeVisible();
      expect(
        fixture.calls.filter((call) =>
          /\/turn\/(start|interrupt)$/.test(call.path),
        ),
      ).toEqual([]);
    });
  }
