import { expect, test } from "@playwright/test";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";

test("running ACP tasks require explicit interruption and cancel remains usable on mobile", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await installSessionUxFixture(page, 1);
  const operations: Array<{ path: string; body: unknown }> = [];
  await page.route("**/api/**/acp/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === "POST")
      operations.push({ path, body: request.postDataJSON() });
    const json = path.endsWith("/agents")
      ? [
          {
            id: "fixture-agent",
            name: "测试 Agent",
            command: "fixture",
            args: [],
            env: {},
            available: false,
          },
        ]
      : path.endsWith("/sessions")
        ? []
        : path.endsWith("/new-session")
          ? { sessionId: "new-confirmed-session" }
          : {};
    await route.fulfill({ json });
  });
  await page.goto("/?mode=session");
  await page.locator(".session-mode [contenteditable=true]").first().waitFor();
  await seedSessionUx(page, 1);
  await page.evaluate(async () => {
    const { useAcpStore } = await import(
      performance
        .getEntriesByType("resource")
        .findLast(
          (e) =>
            new URL(e.name).pathname ===
            "/src/session-mode/stores/useAcpStore.ts",
        )?.name ?? "/src/session-mode/stores/useAcpStore.ts"
    );
    useAcpStore.setState({
      active: true,
      agentId: "fixture-agent",
      agentTitle: "测试 Agent",
      connectionId: "owned-connection",
      sessionId: "running-session",
      running: true,
      connecting: false,
    });
  });
  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    if (width < 768) {
      await page.getByRole("button", { name: "更多功能", exact: true }).click();
      await page.getByRole("menuitem", { name: "新聊天", exact: true }).click();
    } else {
      await page.keyboard.press("Control+n");
    }
    const dialog = page.getByRole("dialog", {
      name: "中断当前任务并新建会话？",
    });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "取消", exact: true }),
    ).toBeInViewport();
    await expect(
      dialog.getByRole("button", { name: "中断并新建", exact: true }),
    ).toBeInViewport();
    expect(
      operations.filter((op) => /\/(cancel|new-session|stop)$/.test(op.path)),
    ).toEqual([]);
    await page.screenshot({
      animations: "disabled",
      path: `.dev-runtime/ui-ux-audit-20261007/verified-confirmation-${width}.png`,
    });
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    await expect(dialog).toHaveCount(0);
  }
  await page.getByRole("button", { name: "更多功能", exact: true }).click();
      await page.getByRole("menuitem", { name: "新聊天", exact: true }).click();
  await page.getByRole("button", { name: "中断并新建", exact: true }).click();
  await expect
    .poll(
      () => operations.filter((op) => op.path.endsWith("/new-session")).length,
    )
    .toBe(1);
  expect(operations.filter((op) => op.path.endsWith("/cancel"))).toEqual([
    {
      path: "/api/session/api/acp/cancel",
      body: {
        connection_id: "owned-connection",
        session_id: "running-session",
      },
    },
  ]);
  expect(operations.some((op) => op.path.endsWith("/stop"))).toBe(false);
  expect(errors).toEqual([]);
});

test("workbench controls remain coherent, readable and usable through responsive and mode changes", async ({
  page,
}) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const fixture = await installSessionUxFixture(page, 6);
  fixture.threads.forEach((thread, index) =>
    Object.assign(thread, {
      createdAt: Math.floor(Date.now() / 1000) - 600,
      updatedAt: Math.floor(Date.now() / 1000) - index * 60,
    }),
  );
  // Return transcript content through the native history fixture so later
  // hydration cannot replace synthetic store-only events with an empty history.
  fixture.threads.forEach((thread, index) => Object.assign(thread, {
    status: index === 1 ? {type:'active',activeFlags:['waitingOnApproval']} : {type:'idle'},
    turns:[{id:`turn-${thread.id}`,status:index===1?'inProgress':'completed',startedAt:1,durationMs:index===1?null:1,error:null,items:[{id:`message-${thread.id}`,type:'agentMessage',text:"## 项目进展\n\n统一项目、会话与工具的入口，保持明确的发送目标。\n\n- 长中文名称保持可读\n- 项目列表和标签使用一致的样式\n- 窄分屏也能阅读和操作\n\n```typescript\nconst result = \"long_value_long_value_long_value_long_value_long_value_long_value_long_value_long_value_long_value_long_value_long_value_long_value_long_value_long_value_long_value_long_value_long_value_long_value_long_value_long_value_long_value_long_value_long_value_long_value_long_value_\";\n```"}]}],
  }));
  await page.route("**/api/session/api/automation/list", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.goto("/?mode=session");
  await page.locator(".session-mode [contenteditable=true]").first().waitFor();
  await seedSessionUx(page, 6);
  for (const index of [0, 1, 2, 3, 4, 5, 0])
    await page
      .locator(".session-nav-row[role=button]")
      .filter({ hasText: `中文会话 ${index} ` })
      .first()
      .click();
  const nav = page.getByRole("navigation", { name: "会话工作台导航" });
  const editor = page
    .locator(".session-agent-view [contenteditable=true]")
    .first();
  await editor.fill("切换模式后保留的草稿");
  await expect(
    page.getByText("项目进展", { exact: true }).first(),
  ).toBeVisible();
  for (const width of [1440, 900, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(
      page.getByText("项目进展", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      nav.getByRole("switch", { name: "工作模式" }),
    ).toBeInViewport();
    const geometry = await nav.evaluate((el) => {
      const brand = el
          .querySelector(".session-brand-mark")!
          .getBoundingClientRect(),
        logo = el.querySelector("img")!.getBoundingClientRect(),
        mode = el
          .querySelector(".workbench-mode-switch")!
          .getBoundingClientRect();
      return {
        brandLeft: brand.left,
        brandRight: brand.right,
        logoLeft: logo.left,
        logoRight: logo.right,
        modeLeft: mode.left,
        height: el.getBoundingClientRect().height,
        scroll: document.documentElement.scrollWidth,
      };
    });
    expect(geometry.logoLeft).toBeGreaterThanOrEqual(geometry.brandLeft);
    expect(geometry.logoRight).toBeLessThanOrEqual(geometry.brandRight + 0.5);
    expect(geometry.modeLeft).toBeGreaterThan(geometry.logoRight);
    expect(geometry.height).toBeLessThanOrEqual(48);
    expect(geometry.scroll).toBeLessThanOrEqual(width);
    await expect(
      page.getByRole("button", { name: "发送消息", exact: true }),
    ).toBeInViewport();
    await page.screenshot({
      animations: "disabled",
      path: `.dev-runtime/ui-ux-audit-20261007/verified-session-${width}.png`,
    });
  }
  await page.getByRole("button", { name: "展开项目列表", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "项目与会话列表" });
  await expect(drawer).toBeVisible();
  await expect
    .poll(async () => Math.round((await drawer.boundingBox())!.x))
    .toBe(0);
  await expect(
    drawer.getByRole("button", { name: "搜索和管理会话" }),
  ).toBeVisible();
  await drawer.screenshot({
    animations: "disabled",
    path: ".dev-runtime/ui-ux-audit-20261007/verified-project-drawer.png",
  });
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "展开项目列表", exact: true }),
  ).toBeFocused();
  await nav.getByRole("button", { name: "更多功能", exact: true }).click();
  await page.getByRole("menuitem", { name: "定时任务", exact: true }).click();
  await expect(
    page.getByRole("tab", { name: "模板", exact: true }),
  ).toBeVisible();
  await nav.getByRole("button", { name: "会话", exact: true }).click();
  await expect(editor).toContainText("切换模式后保留的草稿");
  await page.setViewportSize({ width: 1440, height: 1000 });
  const rail = nav.getByRole("switch", { name: "工作模式" });
  const box = (await rail.boundingBox())!;
  await page.mouse.move(box.x + 10, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 6, box.y + box.height / 2, {
    steps: 8,
  });
  await page.mouse.up();
  await expect(page.locator(".workbench-terminal")).toBeVisible();
  const terminalRail = page.getByRole("switch", { name: "工作模式" });
  await expect(terminalRail).toHaveAttribute("aria-checked", "true");
  await expect(terminalRail).toBeFocused();
  await page.screenshot({
    animations: "disabled",
    path: ".dev-runtime/ui-ux-audit-20261007/verified-terminal.png",
  });
  await terminalRail.press("ArrowLeft");
  await expect(nav).toBeVisible();
  await expect(rail).toBeFocused();
  await expect(editor).toContainText("切换模式后保留的草稿");
  await page.getByRole("button", { name: "多会话网格", exact: true }).click();
  await expect(page.locator("[data-session-card]")).toHaveCount(6);
  await page.evaluate(async () => {
    const { useAgentCenterStore } = await import(
      performance
        .getEntriesByType("resource")
        .findLast(
          (e) =>
            new URL(e.name).pathname ===
            "/src/session-mode/stores/useAgentCenterStore.ts",
        )?.name ?? "/src/session-mode/stores/useAgentCenterStore.ts"
    );
    useAgentCenterStore
      .getState()
      .setCardSize("ux-0", { width: 900, height: 320 });
  });
  await page.setViewportSize({ width: 390, height: 1000 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(390);
  await page.screenshot({
    animations: "disabled",
    path: ".dev-runtime/ui-ux-audit-20261007/verified-mobile-grid.png",
  });
  expect(
    (await page.locator('[data-session-card="ux-0"]').boundingBox())!.width,
  ).toBeLessThanOrEqual(390);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(async () => {
    const { useThemeStore } = await import(
      performance
        .getEntriesByType("resource")
        .findLast(
          (e) =>
            new URL(e.name).pathname ===
            "/src/session-mode/stores/settings/useThemeStore.ts",
        )?.name ?? "/src/session-mode/stores/settings/useThemeStore.ts"
    );
    useThemeStore.getState().setTheme("light");
  });
  await expect(page.locator(".session-mode")).toHaveClass(/light/);
  // The shell must inherit the active theme's foreground, including composer text.
  await expect
    .poll(() =>
      page.locator(".session-mode").evaluate((root) => {
        const probe = document.createElement("span");
        probe.style.color = "var(--foreground)";
        root.append(probe);
        const expected = getComputedStyle(probe).color;
        probe.remove();
        return getComputedStyle(root).color === expected;
      }),
    )
    .toBe(true);
  await expect
    .poll(() =>
      nav
        .locator(".session-brand-mark img")
        .evaluate((element) => getComputedStyle(element).filter),
    )
    .toBe("brightness(0)");
  await page.screenshot({
    animations: "disabled",
    path: ".dev-runtime/ui-ux-audit-20261007/verified-light.png",
  });
  expect(
    fixture.calls.filter((call) =>
      /\/(turn\/start|turn\/interrupt|thread\/start|thread\/revert|bots\/create)$/.test(
        call.path,
      ),
    ),
  ).toEqual([]);
  expect(errors).toEqual([]);
});

test("a refreshed sidebar module can read an already mounted provider", async ({
  page,
}) => {
  await installSessionUxFixture(page, 0);
  await page.goto("/?mode=session");
  await page.locator(".session-mode [contenteditable=true]").first().waitFor();
  await page.evaluate(async () => {
    const resources = performance.getEntriesByType("resource");
    const originalPath =
      resources.findLast(
        (e) =>
          new URL(e.name).pathname ===
          "/src/session-mode/components/ui/sidebar.tsx",
      )?.name ?? "/src/session-mode/components/ui/sidebar.tsx";
    const original = await import(originalPath);
    const updatedUrl = new URL(originalPath, location.origin);
    updatedUrl.searchParams.set("t", String(Date.now()));
    const updated = await import(updatedUrl.href);
    const reactPath =
      resources.find((e) =>
        new URL(e.name).pathname.endsWith("/.vite/deps/react.js"),
      )?.name ?? "/node_modules/.vite/deps/react.js";
    const domPath =
      resources.find((e) =>
        new URL(e.name).pathname.endsWith("/.vite/deps/react-dom_client.js"),
      )?.name ?? "/node_modules/.vite/deps/react-dom_client.js";
    const reactModule = await import(reactPath),
      domModule = await import(domPath);
    const React = reactModule.default ?? reactModule,
      dom = domModule.default ?? domModule;
    const host = document.createElement("div");
    host.id = "sidebar-hmr-probe";
    host.style.cssText = "position:absolute;left:-10000px";
    document.querySelector(".session-mode")!.append(host);
    const root = dom.createRoot(host);
    const Consumer = () =>
      React.createElement(
        "span",
        { "data-refreshed-sidebar": true },
        updated.useSidebar().state,
      );
    root.render(
      React.createElement(
        original.SidebarProvider,
        null,
        React.createElement(Consumer),
      ),
    );
    (window as any).__cleanupSidebarProbe = () => {
      root.unmount();
      host.remove();
    };
  });
  await expect(page.locator("[data-refreshed-sidebar]")).toHaveText("expanded");
  await page.evaluate(() => {
    (window as any).__cleanupSidebarProbe();
    delete (window as any).__cleanupSidebarProbe;
  });
  await expect(
    page.locator(".session-mode [contenteditable=true]").first(),
  ).toBeVisible();
});
