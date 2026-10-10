import { expect, test } from "@playwright/test";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";
for (const width of [1440, 390])
  test.describe(`${width} native tool targets`, () => {
    test.use({ hasTouch: width === 390, isMobile: width === 390 });
    for (const theme of ["dark", "light"])
      test(`verified readonly native tool targets (${theme})`, async ({
        page,
      }, info) => {
        test.setTimeout(90000);
        const fixture = await installSessionUxFixture(page, 2),
          errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        fixture.threads[1].turns = [
          {
            id: "target-turn",
            status: "completed",
            items: [
              {
                id: "target-user",
                type: "userMessage",
                content: [
                  { type: "text", text: "目标会话公开历史", text_elements: [] },
                ],
                clientId: null,
              },
            ],
            error: null,
          },
        ] as never;
        await page.setViewportSize({ width, height: 844 });
        await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
        await page
          .locator(".session-mode [contenteditable=true]")
          .first()
          .waitFor({ timeout: 60000 });
        await seedSessionUx(page);
        await page.evaluate(async (theme) => {
          const load = (path: string) =>
            import(
              performance
                .getEntriesByType("resource")
                .findLast((entry) => new URL(entry.name).pathname === path)
                ?.name ?? path
            );
          const [
            { useThemeStore },
            { useLayoutStore },
            { useCodexStore },
            { useAgentCenterStore },
          ] = await Promise.all([
            load("/src/session-mode/stores/settings/useThemeStore.ts"),
            load("/src/session-mode/stores/useLayoutStore.ts"),
            load("/src/session-mode/components/codex/stores/index.ts"),
            load("/src/session-mode/stores/useAgentCenterStore.ts"),
          ]);
          useAgentCenterStore.getState().addAgentCard({
            kind: "codex",
            id: "ux-0",
            cwd: "/fixture/项目/very-long-project-path-for-ui-regression",
            preview: "原生目标导航",
          });
          useAgentCenterStore.getState().setCardsViewMode("solo");
          useThemeStore.getState().setTheme(theme);
          useLayoutStore.setState({
            view: "agent",
            isSidebarOpen: false,
            isRightPanelOpen: false,
          });
          const notify = (item: object) => ({
            method: "item/completed",
            params: { threadId: "ux-0", turnId: "tools-turn", item },
          });
          useCodexStore.setState({
            events: {
              "ux-0": [
                notify({
                  id: "source-user",
                  type: "userMessage",
                  content: [
                    { type: "text", text: "原生目标导航", text_elements: [] },
                  ],
                  clientId: null,
                }),
                notify({
                  id: "read",
                  type: "dynamicToolCall",
                  namespace: "codex_app",
                  tool: "read_thread",
                  arguments: { threadId: "ux-1" },
                  status: "completed",
                  success: true,
                  contentItems: null,
                }),
                notify({
                  id: "create",
                  type: "dynamicToolCall",
                  namespace: "codex_app",
                  tool: "create_thread",
                  arguments: {},
                  status: "completed",
                  success: true,
                  contentItems: [
                    {
                      type: "inputText",
                      text: '{"kind":"chatgpt","threadId":"native-remote-target"}',
                    },
                  ],
                }),
                {
                  method: "turn/completed",
                  params: {
                    threadId: "ux-0",
                    turn: {
                      id: "tools-turn",
                      status: "completed",
                      items: [],
                      error: null,
                    },
                  },
                },
              ],
            },
            currentThreadId: "ux-0",
            historyLoadedMap: { "ux-0": true },
          });
        }, theme);
        const surface = page.locator(".codex-presentation").first();
        await expect(
          surface.getByText("原生目标导航", { exact: true }),
        ).toBeVisible();
        await surface
          .locator(".codex-native-activity-disclosure")
          .first()
          .click();
        const unavailable = surface.getByRole("button", {
          name: "已创建聊天",
          exact: true,
        });
        await expect(unavailable).toHaveAttribute("aria-disabled", "true");
        const point = await unavailable.boundingBox();
        if (width === 390)
          await page.touchscreen.tap(
            point!.x + point!.width / 2,
            point!.y + point!.height / 2,
          );
        else {
          await unavailable.focus();
          await page.keyboard.press("Enter");
        }
        await expect(
          page.getByText("当前未提供打开此 ChatGPT 聊天的原生主机能力。", {
            exact: true,
          }),
        ).toBeVisible();
        await expect
          .poll(() =>
            page
              .locator(".codex-native-target-info")
              .evaluate((element) => getComputedStyle(element).opacity),
          )
          .toBe("1");
        await page.screenshot({
          path: info.outputPath(
            `native-target-unavailable-${theme}-${width}.png`,
          ),
          fullPage: true,
        });
        await page.keyboard.press("Escape");
        const before = fixture.calls.length;
        await surface
          .getByRole("button", { name: "已读取聊天", exact: true })
          .click();
        await expect(
          page.getByText("目标会话公开历史", { exact: true }),
        ).toBeVisible();
        const calls = fixture.calls.slice(before);
        expect(
          calls.some(
            (call) =>
              call.path.endsWith("/thread/read") &&
              call.body.threadId === "ux-1",
          ),
        ).toBe(true);
        expect(
          calls.filter(
            (call) =>
              /\/(resume|start|stop|interrupt|approve|respond)$/.test(
                call.path,
              ) ||
              (call.path.endsWith("/thread/access") &&
                call.body.release === true),
          ),
        ).toEqual([]);
        await page.screenshot({
          path: info.outputPath(`native-target-readonly-${theme}-${width}.png`),
          fullPage: true,
        });
        expect(errors).toEqual([]);
      });
  });
