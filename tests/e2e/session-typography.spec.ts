import { expect, test } from "@playwright/test";
import { installSessionUxFixture } from "./session-ux-fixture";
for (const width of [1440, 393])
  test(`device typography settings affect real text and code, survive refresh and preserve drafts at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 852 });
    const fixture = await installSessionUxFixture(page, 1);
    (fixture.threads[0] as any).turns = [
      {
        id: "typography-turn",
        status: "completed",
        startedAt: 1,
        durationMs: 1,
        items: [
          {
            id: "typography-reply",
            type: "agentMessage",
            text: "Readable chat text\n\n```js\nconst sample = 1;\n```",
          },
        ],
      },
    ];
    const card = {
      kind: "codex",
      id: "ux-0",
      cwd: fixture.threads[0].cwd,
      preview: "Typography fixture",
    };
    await page.route("**/api/session/tabs", (route) =>
      route.fulfill({
        json: { cards: [card], initialized: true, revision: 1, sequence: 0 },
      }),
    );
    await page.addInitScript((card) => {
      localStorage.setItem(
        "kanban.session.agent-center-store",
        JSON.stringify({
          version: 5,
          state: {
            cards: [card],
            currentAgentCardId: card.id,
            currentAgentCardKind: card.kind,
            cardsViewMode: "solo",
            sharedTabsInitialized: true,
          },
        }),
      );
      localStorage.setItem(
        "kanban.session.layout-storage",
        JSON.stringify({
          version: 0,
          state: {
            view: "agent",
            isSidebarOpen: false,
            isRightPanelOpen: false,
          },
        }),
      );
    }, card);
    await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
    const editor = page
      .locator(".session-codex-composer [contenteditable=true]")
      .first();
    await expect(editor).toBeVisible();
    await editor.fill("Typography must preserve this draft");
    await page.getByRole("button", { name: "更多功能", exact: true }).click();
    await page.getByRole("menuitem", { name: "设置", exact: true }).click();
    const section = page.getByRole("region", { name: "字体与字号" });
    await expect(section).toBeVisible();
    await section
      .getByRole("combobox", { name: "聊天字体", exact: true })
      .selectOption("serif");
    await section
      .getByRole("combobox", { name: "正文字号", exact: true })
      .selectOption("18");
    await section
      .getByRole("combobox", { name: "代码字体", exact: true })
      .selectOption("consolas");
    await section
      .getByRole("combobox", { name: "代码字号", exact: true })
      .selectOption("20");
    await expect
      .poll(() =>
        page.evaluate(() =>
          document.documentElement.style.getPropertyValue(
            "--codex-chat-code-font-size",
          ),
        ),
      )
      .toBe("");
    await page.getByRole("button", { name: "返回会话", exact: true }).click();
    await expect(editor).toHaveText("Typography must preserve this draft");
    const text = page
      .locator(".codex-markdown p")
      .filter({ hasText: "Readable chat text" })
      .first();
    const code = page
      .locator(".codex-markdown .codex-native-code-fence pre code")
      .first();
    await expect(text).toBeVisible();
    await expect(text).toHaveCSS("font-size", "18px");
    await expect(text).toHaveCSS("font-family", /Georgia/);
    await expect(code).toHaveCSS("font-size", "20px");
    await expect(code).toHaveCSS("font-family", /Consolas/);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(editor).toBeVisible();
    await expect
      .poll(() =>
        page
          .locator(".session-mode")
          .evaluate((node) =>
            (node as HTMLElement).style.getPropertyValue(
              "--codex-chat-code-font-size",
            ),
          ),
      )
      .toBe("20px");
    await page.getByRole("button", { name: "更多功能", exact: true }).click();
    await page.getByRole("menuitem", { name: "设置", exact: true }).click();
    await expect(
      section.getByRole("combobox", { name: "聊天字体", exact: true }),
    ).toHaveValue("serif");
    await section
      .getByRole("button", { name: "恢复默认字体", exact: true })
      .click();
    await expect
      .poll(() =>
        page
          .locator(".session-mode")
          .evaluate((node) =>
            (node as HTMLElement).style.getPropertyValue(
              "--codex-chat-code-font-size",
            ),
          ),
      )
      .toBe("");
    expect(
      fixture.calls.filter((call) =>
        /\/(turn\/start|followups\/submit|stop|interrupt)$/.test(call.path),
      ),
    ).toEqual([]);
  });
