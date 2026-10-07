import { expect, test } from "@playwright/test";
import { installSessionUxFixture } from "./session-ux-fixture";

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
  { width: 390, height: 844 },
]) {
  test(`Bot layout and failed actions retain bot identity at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await installSessionUxFixture(page, 0);
    const bots = ["a", "b"].map((id, index) => ({
      id,
      name: index === 0 ? "中文助手长名称".repeat(18) : "第二个助手",
      title: "清晰处理研究与代码任务",
      avatar: "研",
      color: "#657a60",
      agentId: "keke",
      provider: null,
      model: null,
      reasoningEffort: null,
      cwd: "/fixture",
      systemPrompt: null,
      trustLevel: "ask",
      approvedTools: "[]",
      mcpServers: "[]",
      pinned: false,
      archived: false,
      notificationsEnabled: true,
      unreadCount: 0,
      lastViewedAt: null,
      createdAt: "",
      updatedAt: "",
    }));
    let failPrompt = true,
      failCancel = true;
    const actions: unknown[] = [];
    await page.route("**/api/session/api/bots/**", (route) =>
      route.fulfill({
        json: new URL(route.request().url()).pathname.endsWith("/bots/list")
          ? bots
          : [],
      }),
    );
    await page.route("**/api/session/api/acp/agents", (route) =>
      route.fulfill({
        json: [
          {
            id: "keke",
            name: "keke",
            command: "keke",
            args: [],
            env: {},
            local: true,
            available: true,
          },
        ],
      }),
    );
    await page.route("**/api/session/api/acp/prompt", (route) => {
      actions.push(route.request().postDataJSON());
      return route.fulfill(
        failPrompt
          ? { status: 503, json: { error: "isolated send failure" } }
          : { json: { stopReason: "end_turn" } },
      );
    });
    await page.route("**/api/session/api/acp/cancel", (route) => {
      actions.push(route.request().postDataJSON());
      return route.fulfill(
        failCancel
          ? { status: 503, json: { error: "isolated stop failure" } }
          : { json: {} },
      );
    });
    await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
    await page.locator(".session-workbench").waitFor();
    const seed = async (
      selected: string | null,
      entries: unknown[] = [],
      running = false,
    ) =>
      page.evaluate(
        async ({ bots, selected, entries, running }) => {
          const loaded = (fragment: string) =>
            performance
              .getEntriesByType("resource")
              .findLast((item) => item.name.includes(fragment))?.name ??
            fragment;
          const { useBotUiStore } = await import(
            loaded("/src/session-mode/stores/useBotUiStore.ts")
          );
          const { useAcpStore } = await import(
            loaded("/src/session-mode/stores/useAcpStore.ts")
          );
          const { useLayoutStore } = await import(
            loaded("/src/session-mode/stores/useLayoutStore.ts")
          );
          useBotUiStore.setState({
            bots,
            selectedBotId: selected,
            connectionByBot: { a: "fixture-a", b: "fixture-b" },
            sessionByBot: { a: "session-a", b: "session-b" },
            runningByBot: { a: running },
            mcpChangedByBot: {},
            kekeSpawnFailed: false,
          });
          useAcpStore.setState({
            connectionId: selected === "b" ? "fixture-b" : "fixture-a",
            sessionId: selected === "b" ? "session-b" : "session-a",
            entries,
            running,
            connecting: false,
          });
          useLayoutStore.setState({
            view: "bot",
            isSidebarOpen: false,
            isRightPanelOpen: false,
          });
        },
        { bots, selected, entries, running },
      );
    await seed(null);
    await expect(
      page.getByRole("button", { name: `打开助手 ${bots[0].name}` }),
    ).toBeVisible();
    const cards = page.getByRole("button", { name: /打开助手/ });
    for (const card of await cards.all()) {
      const box = await card.boundingBox();
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
    }
    await page.screenshot({
      path: `.dev-runtime/session-ux-bots-review/welcome-fixed-${viewport.width}.png`,
    });
    const path = "/无空格长路径/" + "abcdefghij".repeat(500);
    await seed("a", [{ id: "message", role: "agent", text: path }]);
    const input = page.getByRole("textbox", {
      name: `给${bots[0].name}的消息`,
    });
    await expect(input).toBeVisible();
    expect(
      await page
        .locator(".session-workbench")
        .evaluate((node) => node.scrollWidth <= node.clientWidth),
    ).toBe(true);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await seed(
      "a",
      Array.from({ length: 80 }, (_, index) => ({
        id: `history-${index}`,
        role: "agent",
        text: `历史记录 ${index}\n${"阅读上下文 ".repeat(8)}`,
      })),
    );
    const history = page.locator("[data-bot-history]");
    await expect
      .poll(() =>
        history.evaluate((node) => node.scrollHeight > node.clientHeight),
      )
      .toBe(true);
    await history.evaluate((node) => {
      node.scrollTop = 80;
      node.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    const readingTop = await history.evaluate((node) => node.scrollTop);
    await page.evaluate(async () => {
      const resource =
        performance
          .getEntriesByType("resource")
          .findLast((item) =>
            item.name.includes("/src/session-mode/stores/useAcpStore.ts"),
          )?.name ?? "/src/session-mode/stores/useAcpStore.ts";
      const { useAcpStore } = await import(resource);
      useAcpStore.setState({
        entries: [
          ...useAcpStore.getState().entries,
          {
            id: "new-output",
            role: "agent",
            text: "新的输出不抢走旧记录位置",
          },
        ],
      });
    });
    await expect(page.getByRole("button", { name: "回到最新" })).toBeVisible();
    expect(await history.evaluate((node) => node.scrollTop)).toBe(readingTop);
    await page.getByRole("button", { name: "回到最新" }).click();
    await expect
      .poll(() =>
        history.evaluate(
          (node) => node.scrollHeight - node.clientHeight - node.scrollTop,
        ),
      )
      .toBeLessThan(5);
    await input.fill("保留A草稿");
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "发送失败" }),
    ).toBeVisible();
    await expect(input).toHaveValue("保留A草稿");
    await seed("b");
    const bInput = page.getByRole("textbox", { name: "给第二个助手的消息" });
    await expect(bInput).toHaveValue("");
    await bInput.fill("B草稿");
    await seed("a");
    await expect(input).toHaveValue("保留A草稿");
    await seed("a", [], true);
    await page.getByRole("button", { name: "停止生成", exact: true }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "停止失败" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "停止生成", exact: true }),
    ).toBeVisible();
    failCancel = false;
    await page.getByRole("button", { name: "停止生成", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "发送消息", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: `.dev-runtime/session-ux-bots-review/fixed-${viewport.width}.png`,
    });
    expect(actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          connection_id: "fixture-a",
          session_id: "session-a",
        }),
      ]),
    );
  });
}
