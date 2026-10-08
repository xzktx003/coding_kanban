import { expect, test } from "@playwright/test";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";
for (const width of [768, 1024, 1440])
  test(`persistent desktop tools preserve existing tabs and editor/terminal instances (${width}px)`, async ({
    page,
    context,
  }) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width, height: 900 });
    const fixture = await installSessionUxFixture(page, 8);
    await page.addInitScript(() => {
      class Stream {
        onopen: (() => void) | null = null;
        onmessage = null;
        onerror = null;
        constructor() {
          setTimeout(() => this.onopen?.(), 30);
        }
        close() {}
      }
      (window as any).EventSource = Stream;
    });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    let starts = 0,
      stops = 0,
      editors = 0;
    await page.route("**/api/session/api/terminal/start", (route) => {
      starts++;
      return route.fulfill({
        json: { session_id: `isolated-terminal-${starts}` },
      });
    });
    await page.route("**/api/session/api/terminal/stop", (route) => {
      stops++;
      return route.fulfill({ body: "" });
    });
    await page.route("**/api/workbench/vscode-web", (route) => {
      editors++;
      return route.fulfill({
        json: {
          url: new URL("/vscode/?folder=fixture", page.url()).href,
          workingDirectory: "/fixture/project",
          workspaceId: "fixture",
          reused: editors > 1,
        },
      });
    });
    await context.route(
      (url) => url.pathname.startsWith("/vscode/"),
      (route) =>
        route.fulfill({
          contentType: "text/html",
          body: '<textarea aria-label="编辑缓冲">保持未保存内容</textarea>',
        }),
    );
    await page.goto("/?mode=session");
    await page
      .locator(".session-mode [contenteditable=true]")
      .first()
      .waitFor();
    await seedSessionUx(page, 8);
    await page.evaluate(async () => {
      const url = (p: string) =>
        performance
          .getEntriesByType("resource")
          .findLast((e) => new URL(e.name).pathname === p)?.name ?? p;
      const { useAgentCenterStore } = await import(
        url("/src/session-mode/stores/useAgentCenterStore.ts")
      );
      const { useSessionSplitStore } = await import(
        url("/src/session-mode/stores/useSessionSplitStore.ts")
      );
      const { useLayoutStore } = await import(
        url("/src/session-mode/stores/useLayoutStore.ts")
      );
      for (let i = 0; i < 8; i++)
        useAgentCenterStore
          .getState()
          .addAgentCard(
            {
              id: `ux-${i}`,
              kind: "codex",
              cwd: "/fixture/project",
              preview: `原有标签长标题 ${i} · 保留项目副标题`,
            },
            { activate: i === 0 },
          );
      useSessionSplitStore
        .getState()
        .place(
          "codex:ux-0",
          useSessionSplitStore.getState().activeGroupId,
          "center",
        );
      useLayoutStore.setState({
        isSidebarOpen: false,
        isRightPanelOpen: false,
        isRightPanelFocused: false,
      });
    });
    const dock = page.getByRole("group", { name: "常驻工作工具" });
    await expect(dock).toBeVisible();
    await expect(dock.getByRole("button")).toHaveCount(5);
    const tabs = page.locator(".session-tabs").first();
    await expect
      .poll(async () => {
        const t = await tabs.boundingBox(),
          d = await dock.boundingBox();
        return Math.abs(t!.y - d!.y);
      })
      .toBeLessThan(3);
    const tab = page.locator('[data-tab-key="codex:ux-0"]');
    await tab.click();
    await expect(tab).toHaveAttribute("aria-selected", "true");
    const original = await tab.evaluate((el) => {
      (window as any).__tabElement = el;
      return {
        html: el.innerHTML,
        height: el.getBoundingClientRect().height,
        font: getComputedStyle(el).fontSize,
      };
    });
    const base = await dock.boundingBox();
    const strip = page.locator(".session-tab-strip").first();
    await strip.evaluate((el) => {
      el.scrollLeft = el.scrollWidth;
    });
    for (const button of await dock.getByRole("button").all())
      await expect(button).toBeInViewport();

    const newButton = tabs.locator(".session-new-tab");
    expect(
      (await newButton.boundingBox())!.x +
        (await newButton.boundingBox())!.width,
    ).toBeLessThanOrEqual(base!.x + 2);
    await expect(
      dock.getByRole("button", { name: "放大工具区" }),
    ).toBeDisabled();
    await dock.getByRole("button", { name: "文件浏览器" }).click();
    await expect(
      dock.getByRole("button", { name: "文件浏览器" }),
    ).toHaveAttribute("aria-pressed", "true");
    await dock.getByRole("button", { name: "文件浏览器" }).click();
    await expect(
      dock.getByRole("button", { name: "收起右侧面板" }),
    ).toBeVisible();
    await dock.getByRole("button", { name: "VS Code", exact: true }).click();
    const frame = page.locator(".session-editor-frame");
    const editor = frame
      .contentFrame()
      .getByRole("textbox", { name: "编辑缓冲" });
    await expect(editor).toBeVisible();
    await editor.fill("未保存内容 · 原样保留");
    await frame.evaluate((el) => {
      (window as any).__editorElement = el;
    });
    await dock.getByRole("button", { name: "终端", exact: true }).click();
    await expect.poll(() => starts - stops).toBe(1);
    await expect(page.getByRole("button", {name: /^切换到终端 /})).toHaveCount(1);
    await expect.poll(() => page.locator(".xterm-screen").count()).toBe(1);
    const terminalStarts = starts,
      terminalStops = stops;
    const panelWidth = (await page
      .locator(".session-dock-panel")
      .boundingBox())!.width;
    await dock.getByRole("button", { name: "放大工具区" }).focus();
    await page.keyboard.press("Enter");
    await expect(
      dock.getByRole("button", { name: "还原工具区" }),
    ).toBeVisible();
    await dock.getByRole("button", { name: "还原工具区" }).click();
    await expect
      .poll(async () =>
        Math.abs(
          (await page.locator(".session-dock-panel").boundingBox())!.width -
            panelWidth,
        ),
      )
      .toBeLessThan(3);
    await dock.getByRole("button", { name: "收起右侧面板" }).click();
    await dock.getByRole("button", { name: "展开右侧面板" }).click();
    expect(starts).toBe(terminalStarts);
    expect(stops).toBe(terminalStops);
    await dock.getByRole("button", { name: "VS Code", exact: true }).click();
    await expect(editor).toHaveValue("未保存内容 · 原样保留");
    expect(
      await frame.evaluate((el) => el === (window as any).__editorElement),
    ).toBe(true);
    expect(
      await tab.evaluate((el) => el === (window as any).__tabElement),
    ).toBe(true);
    expect(
      await tab.evaluate((el) => ({
        html: el.innerHTML,
        height: el.getBoundingClientRect().height,
        font: getComputedStyle(el).fontSize,
      })),
    ).toEqual(original);
    const after = await dock.boundingBox();
    expect(Math.abs(after!.x - base!.x)).toBeLessThan(2);
    expect(Math.abs(after!.y - base!.y)).toBeLessThan(2);
    await expect(tab).toHaveAttribute("aria-selected", "true");
    expect(editors).toBe(1);
    expect(stops).toBe(terminalStops);
    await page.screenshot({ path: `.dev-runtime/tool-dock-${width}-open.png` });
    await dock.getByRole("button", { name: "收起右侧面板" }).click();
    await page.screenshot({
      path: `.dev-runtime/tool-dock-${width}-closed.png`,
    });
    await page.getByRole("button", { name: "更多功能", exact: true }).click();
    await expect(
      page.getByRole("menuitem", { name: "文件浏览器", exact: true }),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");
    // A split has one global dock; its rightmost tab row reserves the same space.
    await page.evaluate(async () => {
      const p = "/src/session-mode/stores/useSessionSplitStore.ts";
      const { useSessionSplitStore } = await import(
        performance
          .getEntriesByType("resource")
          .findLast((e) => new URL(e.name).pathname === p)?.name ?? p
      );
      const s = useSessionSplitStore.getState();
      s.place("codex:ux-1", s.activeGroupId, "right");
    });
    await expect(dock).toHaveCount(1);
    await expect
      .poll(() => page.locator("[data-tool-dock-reserve=true]").count())
      .toBe(1);
    if (width === 1440) {
      for (const mode of ["grid", "list"]) {
        await page.evaluate(async (mode) => {
          const p = "/src/session-mode/stores/useAgentCenterStore.ts";
          const { useAgentCenterStore } = await import(
            performance
              .getEntriesByType("resource")
              .findLast((e) => new URL(e.name).pathname === p)?.name ?? p
          );
          useAgentCenterStore.getState().setCardsViewMode(mode);
        }, mode);
        await expect(page.locator(".session-tool-layout")).toHaveAttribute(
          "data-tool-dock-fallback",
          "true",
        );
        await expect
          .poll(async () =>
            Number.parseFloat(
              await page
                .locator(".session-dock-main")
                .evaluate((el) => getComputedStyle(el).paddingTop),
            ),
          )
          .toBeGreaterThan(40);
        await expect(dock).toBeVisible();
      }
      await page.setViewportSize({ width: 375, height: 900 });
      await expect(dock).toHaveCount(0);
      await expect(page.locator(".session-tool-layout")).not.toHaveAttribute(
        "data-tool-dock",
        "true",
      );
      await page.getByRole("button", { name: "更多功能", exact: true }).click();
      await expect(
        page.getByRole("menuitem", { name: "终端", exact: true }),
      ).toBeVisible();
      await page.keyboard.press("Escape");
      await page.setViewportSize({ width: 1440, height: 900 });
      await expect(dock).toBeVisible();
    }
    expect(
      fixture.calls.filter((c) =>
        /\/turn\/start$|interrupt|\/thread\/start$/.test(c.path),
      ),
    ).toEqual([]);
    expect(errors).toEqual([]);
  });
test("phone keeps tools in the existing menu", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await installSessionUxFixture(page, 1);
  await page.goto("/?mode=session");
  await page.locator(".session-mode [contenteditable=true]").first().waitFor();
  await seedSessionUx(page, 1);
  await expect(page.getByRole("group", { name: "常驻工作工具" })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "更多功能", exact: true }).click();
  for (const name of ["文件浏览器", "VS Code", "终端"])
    await expect(
      page.getByRole("menuitem", { name, exact: true }),
    ).toBeVisible();
});
