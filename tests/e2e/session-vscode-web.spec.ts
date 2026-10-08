import { expect, test, type Page } from "@playwright/test";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";

async function cwd(page: Page, path: string) {
  await page.evaluate(async (path) => {
    const { useWorkspaceStore } = await import(
      performance
        .getEntriesByType("resource")
        .findLast((e) =>
          e.name.includes("/src/session-mode/stores/useWorkspaceStore.ts"),
        )?.name ?? "/src/session-mode/stores/useWorkspaceStore.ts"
    );
    // Explicit project selection starts a new draft; an existing conversation owns its cwd.
    const module = async (name: string) => import(performance.getEntriesByType('resource').findLast(e=>new URL(e.name).pathname===name)?.name ?? name);
    const {useAgentCenterStore}=await module('/src/session-mode/stores/useAgentCenterStore.ts');
    const {useCodexStore}=await module('/src/session-mode/components/codex/stores/index.ts');
    useAgentCenterStore.setState({currentAgentCardId:null,currentAgentCardKind:null,detachedCard:null});
    const {codexService}=await module('/src/session-mode/services/codexService.ts');
    await codexService.setCurrentThread(null);
    useWorkspaceStore.getState().setCwd(path);
  }, path);
}
async function openEditor(page: Page) {
  const dock = page.getByRole("group", { name: "常驻工作工具" }).getByRole("button", { name: "VS Code", exact: true });
  if (await dock.isVisible()) { await dock.click(); return; }
  if (!(await page.getByRole("button", { name: "打开 VS Code", exact: true }).isVisible())) {
    await page.getByRole("button", { name: "更多功能", exact: true }).click();
    await page.getByRole("menuitem", { name: "VS Code", exact: true }).click();
  } else
    await page
      .getByRole("button", { name: "打开 VS Code", exact: true })
      .click({ timeout: 15000 });
}
for (const width of [375, 1440])
  test(`embedded project editor preserves buffers, follows or pins projects and reuses aliases (${width}px)`, async ({
    page,
    context,
  }) => {
    test.setTimeout(90_000);
    const calls: string[] = [];
    let failB = true;
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.setViewportSize({ width, height: 900 });
    await installSessionUxFixture(page, 1);
    await page.route("**/api/session/api/automation/list", route => route.fulfill({ json: [] }));
    await context.route(
      (url) => url.pathname.startsWith("/vscode/"),
      (route) =>
        route.fulfill({
          contentType: "text/html",
          body: `<!doctype html><html><head><title>Editor fixture</title><style>body{margin:0;background:#181f26;color:#ddd;font:14px system-ui}header{padding:16px;border-bottom:1px solid #40464c}textarea{box-sizing:border-box;background:#181f26;color:#ddd;border:0;resize:none;width:100%;height:75vh;padding:24px;font:14px monospace}textarea:focus{outline:none}</style></head><body><main class="monaco-workbench"><header>EXPLORER　　App.tsx　　README.md</header><textarea aria-label="编辑内容">export function App() {\n  return &lt;Workbench /&gt;;\n}</textarea></main><script>window.frameIdentity=crypto.randomUUID()</script></body></html>`,
        }),
    );
    await page.route("**/api/workbench/vscode-web", (route) => {
      const path = route.request().postDataJSON().path;
      calls.push(path);
      if (path === "/fixture/project-b" && failB) {
        failB = false;
        return route.fulfill({
          status: 503,
          json: { error: "VS Code 测试连接失败" },
        });
      }
      const canonical =
        path === "/fixture/alias-a" ? "/fixture/project-a" : path;
      return route.fulfill({
        json: {
          url: `${new URL(page.url()).origin}/vscode/?folder=${encodeURIComponent(canonical)}`,
          workingDirectory: canonical,
          provider: "code-server",
          reused: true,
        },
      });
    });
    await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
    await page
      .locator(".session-mode [contenteditable=true]")
      .first()
      .waitFor({ timeout: 15000 });
    await seedSessionUx(page, 1);
    await cwd(page, "/fixture/project-a");
    await openEditor(page);
    const frame = page.locator('iframe[title="VS Code · /fixture/project-a"]');
    const editor = page
      .frameLocator('iframe[title="VS Code · /fixture/project-a"]')
      .getByRole("textbox", { name: "编辑内容" });
    await expect(editor).toBeVisible();
    await editor.fill("未保存内容保持在项目 A");
    const identity = await frame.evaluate(
      (el: HTMLIFrameElement) => (el.contentWindow as any).frameIdentity,
    );
    expect(context.pages()).toHaveLength(1);
    // Secondary pages hide the original tool tree; the iframe must never reload.
    const nav = page.getByRole("navigation", { name: "会话工作台导航" });
    for (const name of ["定时任务", "工具与技能", "用量", "设置"]) {
      const direct = nav.getByRole("button", { name, exact: true });
      if (await direct.isVisible()) await direct.click();
      else {
        await nav.getByRole("button", { name: "更多功能", exact: true }).click();
        await page.getByRole("menuitem", { name, exact: true }).click();
      }
      await expect(frame).toBeHidden();
      await page.getByRole("button", { name: "返回会话", exact: true }).click();
      await expect(editor).toHaveValue("未保存内容保持在项目 A");
      expect(await frame.evaluate((el: HTMLIFrameElement) => (el.contentWindow as any).frameIdentity)).toBe(identity);
    }

    if (width === 1440) {
      await openEditor(page);
      expect(calls).toEqual(["/fixture/project-a"]);
      await expect
        .poll(() => frame.evaluate((el) => document.activeElement === el))
        .toBe(true);
    }
    await page.getByRole("button", { name: "固定当前编辑项目" }).click();
    await cwd(page, "/fixture/project-b");
    await expect(editor).toBeVisible();
    expect(calls).toEqual(["/fixture/project-a"]);
    await page
      .getByRole("button", { name: "取消固定项目，跟随当前项目" })
      .click();
    await expect(page.locator('.session-editor-project')).toContainText('project-b');
    await expect(page.locator('.session-editor-panel').getByRole("alert")).toContainText("VS Code 测试连接失败");
    await page.getByRole("button", { name: "重新连接" }).click();
    await expect(
      page.locator('iframe[title="VS Code · /fixture/project-b"]'),
    ).toBeVisible();
    await cwd(page, "/fixture/alias-a");
    await expect(editor).toBeVisible();
    await expect(editor).toHaveValue("未保存内容保持在项目 A");
    expect(
      await frame.evaluate(
        (el: HTMLIFrameElement) => (el.contentWindow as any).frameIdentity,
      ),
    ).toBe(identity);
    await expect(page.locator(".session-editor-frame")).toHaveCount(2);
    // Change only tool selection; no real terminal/PTY is launched by this fixture.
    await page.evaluate(async () => {
      const { useLayoutStore } = await import(
        performance
          .getEntriesByType("resource")
          .findLast((e) =>
            e.name.includes("/src/session-mode/stores/useLayoutStore.ts"),
          )?.name ?? "/src/session-mode/stores/useLayoutStore.ts"
      );
      useLayoutStore.getState().setActiveRightPanelTab("terminal");
    });
    await expect(frame).toBeHidden();
    await page.locator('[data-tool-tab="vscode"]').click();
    await expect(editor).toHaveValue("未保存内容保持在项目 A");
    if (width === 375) {
      const bounds = (await frame.boundingBox())!;
      expect(bounds.width).toBeGreaterThan(365);
      await page.getByRole("button", { name: "返回会话", exact: true }).click();
    } else {
      await page
        .getByRole("button", { name: "收起右侧面板", exact: true })
        .last()
        .click();
    }
    await expect(frame).toBeHidden();
    await openEditor(page);
    await expect(editor).toHaveValue("未保存内容保持在项目 A");
    await page.locator('[data-tool-tab="vscode"]').hover();
    await page
      .getByRole("button", { name: "关闭VS Code面板", exact: true })
      .click();
    await expect(frame).toBeHidden();
    await openEditor(page);
    await expect(editor).toHaveValue("未保存内容保持在项目 A");
    await page.getByRole("button", { name: "固定当前编辑项目" }).click();
    await page.screenshot({
      path: `.dev-runtime/vscode-panel-${width}.png`,
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const widthBeforeReload = (await frame.boundingBox())!.width;
    await page.reload({ waitUntil: "domcontentloaded" });
    await page
      .locator(".session-mode [contenteditable=true]")
      .first()
      .waitFor({ state: "attached" });

    await openEditor(page);
    await expect(
      page.getByRole("button", { name: "取消固定项目，跟随当前项目" }),
    ).toBeVisible();
    await expect(
      page.locator('iframe[title="VS Code · /fixture/project-a"]'),
    ).toBeVisible();
    expect(
      Math.abs((await frame.boundingBox())!.width - widthBeforeReload),
    ).toBeLessThan(4);
    if (width === 1440) {
      await page.setViewportSize({ width: 900, height: 900 });
      await openEditor(page);
      const direct = page.getByRole("button", { name: "打开 VS Code", exact: true });
      const icon = await direct.isVisible() ? direct : page.getByRole("button", { name: "更多功能", exact: true });
      await expect(icon).toBeVisible();
      const iconBox = (await icon.boundingBox())!;
      expect(iconBox.x + iconBox.width).toBeLessThanOrEqual(900);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(900);
      await page.screenshot({ path: ".dev-runtime/vscode-panel-900.png" });
    }
    expect(context.pages()).toHaveLength(1);

    expect(errors).toEqual([]);
  });
