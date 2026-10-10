import { expect, test } from "@playwright/test";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";
const reference = process.env.CODEX_NATIVE_REFERENCE_URL;
for (const theme of ["dark", "light"])
  test(`actual enabled user/final action SVG and inline edit geometry (${theme})`, async ({
    page,
  }, info) => {
    test.skip(!reference, "Set actual original webview reference URL");
    test.setTimeout(90000);
    const native = await page.context().newPage();
    await native.goto(reference!);
    await native.waitForFunction(() => (window as any).nativeLoaded);
    const host =
      theme === "dark"
        ? {
            background: "#20211d",
            foreground: "#ccc",
            secondary: "#282a23",
            description: "#858585",
          }
        : {
            background: "#fff",
            foreground: "#3b3b3b",
            secondary: "#f5f5f3",
            description: "#717171",
          };
    await native.evaluate(
      async ({ theme, host }) => {
        const win = window as any;
        for (const [key, value] of Object.entries({
          "editor-background": host.background,
          foreground: host.foreground,
          descriptionForeground: host.description,
          "sideBar-background": host.secondary,
        }))
          document.documentElement.style.setProperty(`--vscode-${key}`, value);
        document.documentElement.setAttribute("data-theme", theme);
        document.body.style.background = host.background;
        document.body.style.color = host.foreground;
        const module = await import(
          /* @vite-ignore */ "./native-message-reference.js?v=2"
        );
        module.initNativeMessages();
        win.renderNativeElement(module.NativeMessageReference, {
          kind: "user",
          props: {
            message: "Native final user message",
            threadId: "fixture",
            turnId: "turn",
            isAeonFormatted: false,
            onEditMessage: async () => {},
          },
        });
      },
      { theme, host },
    );
    await expect(
      native.getByRole("button", { name: "编辑消息" }),
    ).toBeVisible();
    const original = await native
      .locator("#root button")
      .evaluateAll((elements) =>
        elements.map((element) => ({
          label: element.getAttribute("aria-label"),
          width: element.getBoundingClientRect().width,
          height: element.getBoundingClientRect().height,
          svg: element.querySelector("path")?.getAttribute("d"),
        })),
      );
    await native.screenshot({
      path: info.outputPath(`native-user-${theme}.png`),
    });
    await native.getByRole("button", { name: "编辑消息" }).click();
    await expect(
      native.getByRole("textbox", { name: "编辑消息" }),
    ).toBeVisible();
    const editor = await native
      .locator("#root [role=textbox]")
      .evaluate((element) => ({
        font: getComputedStyle(element).fontSize,
        line: getComputedStyle(element).lineHeight,
        height: element.getBoundingClientRect().height,
        radius: getComputedStyle(element.closest("form")!).borderRadius,
      }));
    expect(editor).toMatchObject({
      font: "13px",
      line: "17.55px",
      height: 40,
      radius: "25px",
    });
    await native.screenshot({
      path: info.outputPath(`native-inline-edit-${theme}.png`),
    });
    await native.evaluate(async () => {
      const module = await import(
        /* @vite-ignore */ "./native-message-reference.js?v=2"
      );
      (window as any).renderNativeElement(module.NativeMessageReference, {
        kind: "plan",
        props: {
          conversationId: "fixture",
          turnId: "turn",
          item: { content: "# Native captured plan", completed: true },
          defaultCollapsed: true,
        },
      });
    });
    await native.getByRole("button", { name: "打开", exact: true }).click();
    const nativeOpen = await native.evaluate(() =>
      (window as any).nativeMessages.findLast(
        (message: any) => message.type === "show-plan-summary",
      ),
    );
    expect(nativeOpen).toEqual({
      type: "show-plan-summary",
      planContent: "# Native captured plan",
      conversationId: "fixture",
      hostId: "local",
    });
    await native.screenshot({
      path: info.outputPath(`native-plan-${theme}.png`),
    });
    await info.attach("native-plan-open", {
      body: JSON.stringify(nativeOpen),
      contentType: "application/json",
    });
    const fixture = await installSessionUxFixture(page, 1);
    const turn = {
      id: "turn",
      status: "completed",
      items: [
        {
          type: "userMessage",
          id: "user",
          clientId: null,
          content: [
            {
              type: "text",
              text: "Native final user message",
              text_elements: [],
            },
          ],
        },
        {
          type: "agentMessage",
          id: "assistant",
          text: "Native final answer",
          phase: "final_answer",
          memoryCitation: null,
        },
      ],
      startedAt: 1,
      durationMs: 1000,
      error: null,
    };
    fixture.threads[0].turns = [turn];
    await page.goto("/?mode=session");
    await page
      .locator(".session-codex-composer [contenteditable=true]")
      .first()
      .waitFor({ timeout: 60000 });
    await seedSessionUx(page, 1);
    await page.evaluate(
      async ({ turn, theme }) => {
        const module = (path: string) =>
          import(
            performance
              .getEntriesByType("resource")
              .findLast((e) => new URL(e.name).pathname === path)?.name ?? path
          );
        const [
          { useCodexStore },
          { useAgentCenterStore },
          { useThemeStore },
          { useLayoutStore },
        ] = await Promise.all([
          module("/src/session-mode/components/codex/stores/index.ts"),
          module("/src/session-mode/stores/useAgentCenterStore.ts"),
          module("/src/session-mode/stores/settings/useThemeStore.ts"),
          module("/src/session-mode/stores/useLayoutStore.ts"),
        ]);
        useThemeStore.getState().setTheme(theme);
        useLayoutStore.setState({
          view: "agent",
          isSidebarOpen: false,
          isRightPanelOpen: false,
        });
        useCodexStore.setState({
          events: {
            "ux-0": [
              ...turn.items.map((item: any) => ({
                method:
                  item.type === "userMessage"
                    ? "item/started"
                    : "item/completed",
                params: { threadId: "ux-0", turnId: "turn", item },
              })),
              { method: "turn/completed", params: { threadId: "ux-0", turn } },
            ],
          },
          historyLoadedMap: { "ux-0": true },
          historyLoadingMap: {},
          currentThreadId: "ux-0",
          currentTurnId: null,
          threadStatusMap: {},
          turnTimingMap: {},
        });
        useAgentCenterStore.getState().addAgentCard(
          {
            kind: "codex",
            id: "ux-0",
            cwd: "/fixture/项目/very-long-project-path-for-ui-regression",
            preview: "Native reference",
          },
          { activate: true },
        );
        useAgentCenterStore.setState({ cardsViewMode: "solo" });
      },
      { turn, theme },
    );
    const user = page.locator('.codex-native-user[data-owner-turn="turn"]');
    await user.hover();
    const copy = user.getByRole("button", { name: "复制消息" });
    const edit = user.getByRole("button", { name: "编辑消息" });
    expect(await copy.locator("svg path").getAttribute("d")).toBe(
      original.find((button) => button.label === "复制消息")!.svg,
    );
    expect(await edit.locator("svg path").getAttribute("d")).toBe(
      original.find((button) => button.label === "编辑消息")!.svg,
    );
    await edit.click();
    const product = page.getByRole("textbox", { name: "编辑上一条用户消息" });
    await expect(product).toBeVisible();
    const measured = await product.evaluate((element) => ({
      font: getComputedStyle(element).fontSize,
      line: getComputedStyle(element).lineHeight,
      height: element.getBoundingClientRect().height,
      radius: getComputedStyle(element.closest(".codex-native-inline-editor")!)
        .borderRadius,
    }));
    expect(measured).toEqual(editor);
    await page.screenshot({
      path: info.outputPath(`product-inline-edit-${theme}.png`),
      fullPage: true,
    });
    await info.attach("reference-metrics", {
      body: JSON.stringify(
        { theme, host, original, editor, measured },
        null,
        2,
      ),
      contentType: "application/json",
    });
  });
