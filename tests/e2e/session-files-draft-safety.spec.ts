import { expect, test } from "@playwright/test";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";

test("real file editor preserves full documents and unsaved per-file drafts across tools with guarded hidden input", async ({
  page,
}) => {
  test.setTimeout(90000);
  const complete = Array.from(
    { length: 503 },
    (_, i) => `完整文档行 ${i}`,
  ).join("\n");
  const disk = new Map([
    ["/fixture/a.ts", complete],
    ["/fixture/b.ts", "原始B"],
  ]);
  const writes: { path: string; content: string }[] = [];
  const fileRequests: { action: string; root: string; path: string }[] = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let failWrite = false;
  let holdWrite = false;
  let releaseWrite: (() => void) | null = null;
  const fixture = await installSessionUxFixture(page, 0);
  await page.route("**/api/session/workspace-files/**", async (route) => {
    const action = new URL(route.request().url()).pathname.split("/").at(-1)!;
    const body = route.request().postDataJSON();
    fileRequests.push({ action, root: body.root, path: body.path });
    expect(body.root).toBe("/fixture");
    expect(disk.has(body.path)).toBe(true);
    if (action === "read") {
      const content = disk.get(body.path)!;
      await route.fulfill({
        json: {
          path: body.path,
          content,
          version: `fixture-${writes.length}`,
          size: Buffer.byteLength(content),
        },
      });
    } else if (action === "save") {
      if (failWrite) {
        await route.fulfill({ status: 500, json: { error: "隔离写入失败" } });
        return;
      }
      if (holdWrite)
        await new Promise<void>((done) => {
          releaseWrite = done;
        });
      writes.push({ path: body.path, content: body.content });
      disk.set(body.path, body.content);
      await route.fulfill({
        json: { path: body.path, version: `fixture-${writes.length}` },
      });
    } else throw new Error(`Unexpected workspace file action: ${action}`);
  });
  await page.route("**/api/session/api/settings", (r) =>
    r.fulfill({ json: {} }),
  );
  await page.route("**/api/session/api/codex/thread/list", (r) =>
    r.fulfill({ json: { data: [], nextCursor: null } }),
  );
  await page.route("**/api/session/api/git/**", (r) =>
    r.fulfill({
      json: {
        entries: [],
        branch: "fixture",
        current_branch: "fixture",
        is_repo: true,
      },
    }),
  );
  await page.route("**/api/session/api/terminal/**", (r) =>
    r.fulfill({ json: { session_id: "isolated-draft-terminal" } }),
  );
  await page.route("**/api/session/api/filesystem/**", async (r) => {
    const path = new URL(r.request().url()).pathname;
    const payload =
      r.request().method() === "POST" ? r.request().postDataJSON() : {};
    if (path.endsWith("/canonicalize-path"))
      await r.fulfill({ json: payload.path });
    else if (path.endsWith("/read-directory") || path.includes("/search-files"))
      await r.fulfill({ json: [] });
    else await r.fulfill({ json: "" });
  });
  await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
  await page.locator(".session-mode [contenteditable=true]").first().waitFor();
  await seedSessionUx(page, 0);
  await page.evaluate(async () => {
    const mountedModule = (path: string) =>
      performance
        .getEntriesByType("resource")
        .findLast((entry) => new URL(entry.name).pathname === path)?.name ??
      path;
    const { useLayoutStore } = await import(
      mountedModule("/src/session-mode/stores/useLayoutStore.ts")
    );
    const { useEditorStore } = await import(
      mountedModule("/src/session-mode/stores/useEditorStore.ts")
    );
    const { useWorkspaceStore } = await import(
      mountedModule("/src/session-mode/stores/useWorkspaceStore.ts")
    );
    useWorkspaceStore.setState({ projects: ["/fixture"], cwd: "/fixture" });
    useEditorStore.setState({
      openFiles: ["/fixture/a.ts"],
      activeFile: "/fixture/a.ts",
      roots: { "/fixture/a.ts": "/fixture", "/fixture/b.ts": "/fixture" },
      revealLocation: null,
    });
    useLayoutStore.setState({
      view: "agent",
      isSidebarOpen: false,
      isRightPanelOpen: true,
      isRightPanelFocused: true,
      openRightPanelTabs: ["files", "diff", "terminal"],
      activeRightPanelTab: "files",
      terminals: [],
    });
  });
  const editor = () => page.locator(".session-mode .ace_editor:visible");
  const read = async () =>
    editor().evaluate((el) => (el as any).env.editor.getValue());
  const edit = async (value: string) =>
    editor().evaluate(
      (el, value) => (el as any).env.editor.setValue(value, -1),
      value,
    );
  await expect(
    page.getByRole("button", { name: "加载全文以编辑" }),
  ).toBeVisible();
  expect(
    await editor().evaluate((el) => (el as any).env.editor.getReadOnly()),
  ).toBe(true);
  await expect(
    page.getByRole("button", { name: "保存文件（Ctrl+S）" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "加载全文以编辑" }).click();
  expect(await read()).toContain("完整文档行 502");
  await page.evaluate(async () => {
    const dependency = (window as any).__sessionFixtureDependency;
    const ReactModule = await import(dependency("react.js"));
    const React = ReactModule.default ?? ReactModule;
    const ReactDOM = await import(dependency("react-dom_client.js"));
    const { createRoot } = ReactDOM.default ?? ReactDOM;
    const dialogPath = "/src/session-mode/components/ui/dialog.tsx";
    const mountedDialog = performance
      .getEntriesByType("resource")
      .findLast((entry) => new URL(entry.name).pathname === dialogPath)?.name;
    const { Dialog, DialogContent, DialogTitle, DialogDescription } =
      await import(mountedDialog ?? dialogPath);
    const host = document.createElement("div");
    document.querySelector(".session-mode")!.append(host);
    const root = createRoot(host);
    root.render(
      React.createElement(
        Dialog,
        {
          open: true,
          onOpenChange: (open: boolean) => {
            if (!open) {
              root.unmount();
              host.remove();
            }
          },
        },
        React.createElement(
          DialogContent,
          null,
          React.createElement(DialogTitle, null, "隔离模态表单"),
          React.createElement(DialogDescription, null, "验证模态快捷键隔离"),
          React.createElement("input", { "aria-label": "隔离模态输入" }),
        ),
      ),
    );
  });
  const modalInput = page.getByRole("textbox", { name: "隔离模态输入" });
  await modalInput.fill("只编辑弹窗");
  await page.keyboard.press("Control+s");
  await page.waitForTimeout(150);
  expect(writes).toHaveLength(0);
  await page.keyboard.press("Control+,");
  expect(
    await page.evaluate(async () => {
      const { useLayoutStore } = await import(
        performance
          .getEntriesByType("resource")
          .findLast(
            (entry) =>
              new URL(entry.name).pathname ===
              "/src/session-mode/stores/useLayoutStore.ts",
          )?.name ?? "/src/session-mode/stores/useLayoutStore.ts"
      );
      return useLayoutStore.getState().view;
    }),
  ).toBe("agent");
  await page.keyboard.press("Escape");
  await expect(modalInput).toHaveCount(0);

  await edit(complete.replace("完整文档行 0", "修改第一行"));
  holdWrite = true;
  await page.getByRole("button", { name: "保存文件（Ctrl+S）" }).click();
  await expect.poll(() => Boolean(releaseWrite)).toBe(true);
  await edit("保存途中输入的新草稿\n" + complete);
  holdWrite = false;
  releaseWrite!();
  await expect.poll(() => writes.length).toBe(1);
  await expect(
    page.getByRole("button", { name: "保存文件（Ctrl+S）" }),
  ).toBeEnabled();
  expect(await read()).toContain("保存途中输入的新草稿");
  expect(writes[0].content).toContain("完整文档行 502");
  await edit("A保留草稿\n" + complete);
  const switchTool = async (tab: string) =>
    page.evaluate(async (tab) => {
      const { useLayoutStore } = await import(
        performance
          .getEntriesByType("resource")
          .findLast(
            (entry) =>
              new URL(entry.name).pathname ===
              "/src/session-mode/stores/useLayoutStore.ts",
          )?.name ?? "/src/session-mode/stores/useLayoutStore.ts"
      );
      useLayoutStore.getState().setActiveRightPanelTab(tab);
    }, tab);
  await switchTool("diff");
  await page.keyboard.press("Control+s");
  await page.waitForTimeout(150);
  expect(writes).toHaveLength(1);
  await switchTool("terminal");
  await switchTool("files");
  expect(await read()).toContain("A保留草稿");
  await page.evaluate(async () => {
    const { useEditorStore } = await import(
      performance
        .getEntriesByType("resource")
        .findLast(
          (entry) =>
            new URL(entry.name).pathname ===
            "/src/session-mode/stores/useEditorStore.ts",
        )?.name ?? "/src/session-mode/stores/useEditorStore.ts"
    );
    useEditorStore.getState().openFile("/fixture/b.ts", "/fixture");
  });
  await editor().waitFor();
  await expect.poll(read).toBe("原始B");
  await edit("B保留草稿");
  await page
    .getByRole("button", { name: "查看文件 a.ts", exact: true })
    .click();
  expect(await read()).toContain("A保留草稿");
  await page
    .getByRole("button", { name: "查看文件 b.ts", exact: true })
    .click();
  expect(await read()).toBe("B保留草稿");
  failWrite = true;
  await page.getByRole("button", { name: "保存文件（Ctrl+S）" }).click();
  await expect(page.getByRole("alert")).toContainText("草稿已保留");
  expect(await read()).toBe("B保留草稿");
  await expect(
    page.locator(".session-mode [contenteditable=true]").first(),
  ).toBeHidden();
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press("Tab");
    expect(
      await page.evaluate(() =>
        Boolean(document.activeElement?.closest("[hidden],[inert]")),
      ),
    ).toBe(false);
  }
  await page.screenshot({
    path: ".dev-runtime/session-uiux/files-draft-safety.png",
  });
  expect(
    fileRequests
      .filter((request) => request.action === "read")
      .map((request) => request.path),
  ).toEqual(expect.arrayContaining(["/fixture/a.ts", "/fixture/b.ts"]));
  expect(
    fixture.calls.filter((call) =>
      /\/thread\/(resume|start)$|\/turn\/(start|steer|interrupt)$|\/followups\/(submit|stop)$/.test(
        call.path,
      ),
    ),
  ).toEqual([]);
  expect(errors).toEqual([]);
});
