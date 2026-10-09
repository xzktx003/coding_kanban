import { expect, test } from "@playwright/test";

test("isolated tools expose keyboard controls and preserve terminal identity across tool and viewport changes", async ({
  page,
}) => {
  test.setTimeout(90000);
  const starts: string[] = [];
  const stops: string[] = [];
  const writes: string[] = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.stack ?? error.message));
  await page.route("**/api/session/api/terminal/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/start")) {
      const id = `ux-tool-${starts.length}`;
      starts.push(id);
      await route.fulfill({ json: { session_id: id } });
    } else {
      if (path.endsWith("/stop"))
        stops.push(route.request().postDataJSON().session_id);
      await route.fulfill({ status: 200, body: "" });
    }
  });
  await page.route("**/api/session/api/filesystem/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/write-file")) writes.push(path);
    if (path.endsWith("/read-text-file"))
      await route.fulfill({ json: "隔离文件内容\n无需真实文件读写" });
    else if (path.endsWith("/read-directory") || path.includes("/search-files"))
      await route.fulfill({ json: [] });
    else if (path.endsWith("/canonicalize-path"))
      await route.fulfill({ json: route.request().postDataJSON().path });
    else await route.fulfill({ json: "" });
  });
  await page.route("**/api/session/api/git/**", (route) =>
    route.fulfill({
      json: {
        entries: [],
        branch: "fixture",
        current_branch: "fixture",
        is_repo: true,
      },
    }),
  );
  await page.route("**/api/session/api/settings", (route) =>
    route.fulfill({ json: {} }),
  );
  await page.route("**/api/session/api/codex/thread/list", (route) =>
    route.fulfill({ json: { data: [], nextCursor: null } }),
  );
  await page.route("**/api/session/workspace-files/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const body = route.request().postDataJSON();
    if (path.endsWith("/save")) writes.push(path);
    await route.fulfill({
      json: {
        path: body.path,
        content: "隔离文件内容\n无需真实文件读写",
        version: "fixture-version",
        size: 60,
      },
    });
  });
  await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
  await page.locator(".session-mode").waitFor();
  await page.evaluate(async () => {
    const { useLayoutStore } =
      await import("/src/session-mode/stores/useLayoutStore.ts");
    const { useWorkspaceStore } =
      await import("/src/session-mode/stores/useWorkspaceStore.ts");
    const { useEditorStore } =
      await import("/src/session-mode/stores/useEditorStore.ts");
    useWorkspaceStore.setState({ cwd: "/fixture" });
    useEditorStore.setState({
      openFiles: [
        "/fixture/中文文件.ts",
        "/fixture/很长的文件名称测试长路径.ts",
      ],
      activeFile: "/fixture/中文文件.ts",
    });
    useLayoutStore.setState({
      view: "agent",
      isRightPanelOpen: true,
      activeRightPanelTab: "terminal",
      openRightPanelTabs: ["diff", "files", "terminal"],
      terminals: [
        { id: "ux-pane-a", label: "隔离中文终端" },
        { id: "ux-pane-b", label: "隔离长名称终端" },
      ],
      activeTerminalId: "ux-pane-a",
    });
  });
  await expect(
    page.getByRole("button", { name: "切换到终端 隔离中文终端", exact: true }),
  ).toBeVisible();
  await expect.poll(() => starts.length).toBe(1);
  await page
    .getByRole("button", { name: "切换到终端 隔离长名称终端", exact: true })
    .click();
  await expect.poll(() => starts.length).toBe(2);
  const switchTool = async (tab: string) =>
    page.evaluate(async (tab) => {
      const { useLayoutStore } =
        await import("/src/session-mode/stores/useLayoutStore.ts");
      useLayoutStore.getState().setActiveRightPanelTab(tab);
    }, tab);
  await switchTool("files");
  await page.getByRole("button", { name: "保存文件（Ctrl+S）" }).waitFor();
  await page.evaluate(async () => {
    const { useLayoutStore } =
      await import("/src/session-mode/stores/useLayoutStore.ts");
    useLayoutStore.setState({ view: "settings" });
  });
  await page.keyboard.press("Control+s");
  await page.waitForTimeout(200);
  expect(writes).toEqual([]);
  await page.evaluate(async () => {
    const { useLayoutStore } =
      await import("/src/session-mode/stores/useLayoutStore.ts");
    useLayoutStore.setState({ view: "agent" });
  });
  const close = page.getByRole("button", {
    name: "关闭文件 中文文件.ts",
    exact: true,
  });
  await expect(close).toBeVisible();
  await close.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("button", {
      name: "查看文件 很长的文件名称测试长路径.ts",
      exact: true,
    }),
  ).toBeFocused();
  await switchTool("diff");
  await expect(page.getByRole("combobox", { name: "变更来源" })).toBeVisible();
  await switchTool("terminal");
  expect(starts).toHaveLength(2);
  expect(stops).toEqual([]);
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 900, height: 720 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.evaluate(async () => {
      const { useLayoutStore } =
        await import("/src/session-mode/stores/useLayoutStore.ts");
      useLayoutStore.setState({ isRightPanelOpen: true });
    });
    const selector = page.getByRole("button", {
      name: "切换到终端 隔离长名称终端",
      exact: true,
    });
    await expect(selector).toBeVisible();
    await expect(selector).toHaveAttribute("aria-pressed", "true");
    const bounds = await selector.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
    await page.screenshot({
      path: `.dev-runtime/session-uiux/tools-${viewport.width}.png`,
    });
    expect(starts).toHaveLength(2);
    expect(stops).toEqual([]);
  }
  for (const view of ["plugins", "insights", "settings", "agent"]) {
    await page.evaluate(async (view) => {
      const { useLayoutStore } =
        await import("/src/session-mode/stores/useLayoutStore.ts");
      useLayoutStore.setState({ view });
    }, view);
    await page.waitForTimeout(150);
    expect(starts).toHaveLength(2);
    expect(stops).toEqual([]);
  }
  await page.evaluate(async () => {
    const { useLayoutStore } =
      await import("/src/session-mode/stores/useLayoutStore.ts");
    useLayoutStore.setState({ isRightPanelOpen: false });
  });
  expect(stops).toEqual([]);
  expect(errors).toEqual([]);
});

test("failed terminal start exposes a guarded retry without recreating the pane or sending commands", async ({
  page,
}) => {
  let starts = 0;
  const writes: unknown[] = [];
  let release!: () => void;
  await page.route("**/api/session/api/settings", (r) =>
    r.fulfill({ json: {} }),
  );
  await page.route("**/api/session/api/codex/thread/list", (r) =>
    r.fulfill({ json: { data: [], nextCursor: null } }),
  );
  await page.route("**/api/session/api/terminal/**", async (r) => {
    const path = new URL(r.request().url()).pathname;
    if (path.endsWith("/start")) {
      starts++;
      if (starts === 1) {
        await r.fulfill({ status: 500, json: { error: "隔离启动失败" } });
        return;
      }
      await new Promise<void>((done) => {
        release = done;
      });
      await r.fulfill({ json: { session_id: "isolated-retry" } });
    } else {
      if (path.endsWith("/write")) writes.push(r.request().postDataJSON());
      await r.fulfill({ status: 200, body: "" });
    }
  });
  await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
  await page.locator(".session-mode [contenteditable=true]").first().waitFor();
  await page.evaluate(async () => {
    const { useLayoutStore } =
      await import("/src/session-mode/stores/useLayoutStore.ts");
    useLayoutStore.setState({
      view: "agent",
      isRightPanelOpen: true,
      openRightPanelTabs: ["terminal"],
      activeRightPanelTab: "terminal",
      terminals: [{ id: "isolated-retry-pane", label: "隔离重试终端" }],
      activeTerminalId: "isolated-retry-pane",
    });
  });
  const retry = page.getByRole("button", { name: "重试启动终端" });
  await expect(retry).toBeVisible();
  const node = page.locator(".session-mode .xterm");
  await expect(node).toBeVisible();
  await node.evaluate((el) => el.setAttribute("data-same-retry-pane", "yes"));
  await retry.click();
  await expect.poll(() => starts).toBe(2);
  await expect(retry).toHaveCount(0);
  expect(writes).toEqual([]);
  release();
  await expect(
    page.locator(".session-mode .xterm[data-same-retry-pane=yes]"),
  ).toBeVisible();
  expect(starts).toBe(2);
  expect(writes).toEqual([]);
});
