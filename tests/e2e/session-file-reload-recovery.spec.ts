import { expect, test, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import { join } from "node:path";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";

async function activateFixtureEditor(page: Page) {
  await page.evaluate(async () => {
    const mounted = (path: string) =>
      performance
        .getEntriesByType("resource")
        .findLast((entry) => new URL(entry.name).pathname === path)?.name ??
      path;
    const [{ useLayoutStore }, { useEditorStore }, { useWorkspaceStore }] =
      await Promise.all([
        import(mounted("/src/session-mode/stores/useLayoutStore.ts")),
        import(mounted("/src/session-mode/stores/useEditorStore.ts")),
        import(mounted("/src/session-mode/stores/useWorkspaceStore.ts")),
      ]);
    useWorkspaceStore.setState({ projects: ["/fixture"], cwd: "/fixture" });
    useEditorStore.setState({
      openFiles: ["/fixture/a.ts"],
      activeFile: "/fixture/a.ts",
      roots: { "/fixture/a.ts": "/fixture" },
      revealLocation: null,
    });
    useLayoutStore.setState({
      view: "agent",
      isSidebarOpen: false,
      isRightPanelOpen: true,
      isRightPanelFocused: true,
      openRightPanelTabs: ["files"],
      activeRightPanelTab: "files",
    });
  });
}

async function openFixture(
  page: Page,
  width: number,
  stallFirst = false,
  allowSave = false,
) {
  await page.setViewportSize({ width, height: 900 });
  const fixture = await installSessionUxFixture(page, 0);
  const errors: string[] = [];
  const writes: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const disk = { content: "磁盘原文", version: "v1", failNext: false };
  const releaseStalled: Array<() => void> = [];
  const releaseHeld: Array<() => void> = [];
  const releaseHeldSave: Array<(outcome: "success" | "failure") => void> = [];
  const releaseHeldOperation: Array<() => void> = [];
  let stallReads = stallFirst;
  let holdNextRead = false;
  let holdNextSave = false;
  let wrongSaveReceipt = false;
  let expectClosedReceipt = false;
  let holdNextOperation = false;
  let readCount = 0;
  await page.route(
    "**/api/session/api/filesystem/read-directory",
    async (route) => {
      const body = route.request().postDataJSON();
      await route.fulfill({
        json:
          body.path === "/fixture"
            ? [{ name: "a.ts", path: "/fixture/a.ts", is_dir: false }]
            : [],
      });
    },
  );
  await page.route("**/api/session/workspace-files/**", async (route) => {
    const action = new URL(route.request().url()).pathname.split("/").at(-1);
    const body = route.request().postDataJSON();
    expect(body.root).toBe("/fixture");
    expect(body.path).toBe("/fixture/a.ts");
    if (action === "move" && holdNextOperation) {
      holdNextOperation = false;
      writes.push(action);
      await new Promise<void>((resolve) => releaseHeldOperation.push(resolve));
      await route.fulfill({ status: 503, json: { error: "隔离移动未确认" } });
      return;
    }
    if (action === "save" && allowSave) {
      writes.push(action);
      if (holdNextSave) {
        holdNextSave = false;
        const outcome = await new Promise<"success" | "failure">((resolve) =>
          releaseHeldSave.push(resolve),
        );
        if (outcome === "failure") {
          await route.fulfill({
            status: 503,
            json: { error: "隔离保存连接中断" },
          });
          return;
        }
      }
      if (body.version !== disk.version) {
        await route.fulfill({ status: 409, json: { error: "磁盘文件已更新" } });
        return;
      }
      disk.content = body.content;
      disk.version = "saved-v2";
      try {
        await route.fulfill({
          json: {
            path: wrongSaveReceipt ? "/fixture/b.ts" : body.path,
            version: disk.version,
          },
        });
      } catch (error) {
        if (!expectClosedReceipt) throw error;
      }
      return;
    }
    if (action !== "read") {
      writes.push(action ?? "unknown");
      await route.fulfill({
        status: 500,
        json: { error: "不允许写入测试文件" },
      });
      return;
    }
    readCount++;
    if (holdNextRead) {
      holdNextRead = false;
      const snapshot = { ...disk };
      await new Promise<void>((resolve) => releaseHeld.push(resolve));
      try {
        await route.fulfill({
          json: {
            path: body.path,
            content: snapshot.content,
            version: snapshot.version,
            size: Buffer.byteLength(snapshot.content),
          },
        });
      } catch {
        // The browser may have cancelled the superseded read.
      }
      return;
    }
    if (stallReads) {
      await new Promise<void>((resolve) => {
        releaseStalled.push(resolve);
      });
      try {
        await route.fulfill({
          json: {
            path: body.path,
            content: "迟到旧正文",
            version: "old",
            size: 15,
          },
        });
      } catch {
        // The browser may already have cancelled this intentionally stalled read.
      }
      return;
    }
    if (disk.failNext) {
      disk.failNext = false;
      await route.fulfill({ status: 503, json: { error: "隔离磁盘读取失败" } });
      return;
    }
    await route.fulfill({
      json: {
        path: body.path,
        content: disk.content,
        version: disk.version,
        size: Buffer.byteLength(disk.content),
      },
    });
  });
  await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
  await page.locator(".session-mode [contenteditable=true]").first().waitFor();
  await seedSessionUx(page, 0);
  await activateFixtureEditor(page);
  const editor = () => page.locator(".session-mode .ace_editor:visible");
  // A cold development module graph can take longer than Playwright's
  // default assertion timeout. This is fixture readiness, not a save result.
  if (!stallFirst) await expect(editor()).toBeVisible({ timeout: 30_000 });
  const read = () =>
    editor().evaluate(
      (element) => (element as any).env.editor.getValue() as string,
    );
  const edit = (value: string) =>
    editor().evaluate(
      (element, text) => (element as any).env.editor.setValue(text, -1),
      value,
    );
  return {
    fixture,
    errors,
    writes,
    disk,
    editor,
    read,
    edit,
    resume: () => {
      stallReads = false;
    },
    release: () => releaseStalled.forEach((resolve) => resolve()),
    holdNext: () => {
      holdNextRead = true;
    },
    held: () => releaseHeld.length,
    releaseHeld: () => releaseHeld.forEach((resolve) => resolve()),
    holdSave: () => {
      holdNextSave = true;
    },
    returnWrongSaveReceipt: () => {
      wrongSaveReceipt = true;
    },
    expectReceiptAfterNavigation: () => {
      expectClosedReceipt = true;
    },
    heldSaves: () => releaseHeldSave.length,
    releaseSave: (outcome: "success" | "failure") =>
      releaseHeldSave.shift()?.(outcome),
    holdOperation: () => {
      holdNextOperation = true;
    },
    heldOperations: () => releaseHeldOperation.length,
    releaseOperation: () => releaseHeldOperation.shift()?.(),
    reads: () => readCount,
  };
}

test("code files avoid office preview downloads until an office file is opened", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const requested: string[] = [];
  page.on("request", (request) =>
    requested.push(new URL(request.url()).pathname),
  );
  const fixture = await openFixture(page, 1440, false, true);
  await expect(fixture.editor()).toBeVisible();
  expect(
    requested.filter((path) =>
      /\/OfficeView\.tsx$|\/(?:docx-preview|pptx-preview|react-pdf|xlsx)\.js$/.test(
        path,
      ),
    ),
  ).toEqual([]);

  const xlsx = createRequire(join(process.cwd(), "apps/web/package.json"))(
    "xlsx",
  );
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(
    workbook,
    xlsx.utils.aoa_to_sheet([["表格内容"]]),
    "Sheet1",
  );
  const encoded = xlsx.write(workbook, { type: "base64", bookType: "xlsx" });
  await page.route("**/api/session/api/filesystem/read-file", async (route) => {
    expect(route.request().postDataJSON().filePath).toBe(
      "/fixture/report.xlsx",
    );
    await route.fulfill({ json: encoded });
  });
  await page.evaluate(async () => {
    const path = "/src/session-mode/stores/useEditorStore.ts";
    const mounted =
      performance
        .getEntriesByType("resource")
        .findLast((entry) => new URL(entry.name).pathname === path)?.name ??
      path;
    const { useEditorStore } = await import(mounted);
    useEditorStore.setState({
      openFiles: ["/fixture/a.ts", "/fixture/report.xlsx"],
      activeFile: "/fixture/report.xlsx",
      roots: {
        "/fixture/a.ts": "/fixture",
        "/fixture/report.xlsx": "/fixture",
      },
    });
  });
  await expect(page.getByRole("cell", { name: "表格内容" })).toBeVisible({
    timeout: 30_000,
  });
  expect(requested.some((path) => path.endsWith("/OfficeView.tsx"))).toBe(true);
  expect(fixture.errors).toEqual([]);
});

test("a stalled file read can time out and retry without accepting the late result", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const fixture = await openFixture(page, 1440, true);
  await expect.poll(fixture.reads).toBeGreaterThan(0);
  await expect(page.getByRole("alert")).toContainText("读取文件超时", {
    timeout: 20_000,
  });
  fixture.resume();
  await page.getByRole("button", { name: "重新读取文件" }).click();
  await expect(fixture.editor()).toBeVisible();
  await expect.poll(fixture.read).toBe("磁盘原文");
  fixture.release();
  await page.waitForTimeout(150);
  expect(await fixture.read()).toBe("磁盘原文");
  expect(fixture.writes).toEqual([]);
  expect(fixture.errors).toEqual([]);
});

test("a save finishing after page reload cannot replace the reverted draft", async ({
  page,
}) => {
  const fixture = await openFixture(page, 1440, false, true);
  await expect(fixture.editor()).toBeVisible();
  await fixture.edit("刷新后才落盘的内容");
  fixture.holdSave();
  fixture.expectReceiptAfterNavigation();
  await page.getByRole("button", { name: "保存文件（Ctrl+S）" }).click();
  await expect.poll(fixture.heldSaves).toBe(1);
  await fixture.edit("磁盘原文");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page
    .locator(".session-mode [contenteditable=true]")
    .first()
    .waitFor({ state: "attached" });
  await activateFixtureEditor(page);
  await expect(fixture.editor()).toBeVisible({ timeout: 30_000 });
  await expect.poll(fixture.read).toBe("磁盘原文");
  await expect(page.getByRole("alert")).toContainText("上次保存的结果尚未确认");
  fixture.releaseSave("success");
  await expect.poll(() => fixture.disk.content).toBe("刷新后才落盘的内容");
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("fs_change", {
        detail: { path: "/fixture/a.ts", kind: "modify" },
      }),
    ),
  );
  await expect(
    page.getByRole("status").filter({ hasText: "磁盘文件已更新" }),
  ).toBeVisible();
  expect(await fixture.read()).toBe("磁盘原文");
  expect(fixture.writes).toEqual(["save"]);
  expect(fixture.errors).toEqual([]);
});

test("an incorrect save receipt keeps the draft even if the disk already changed", async ({
  page,
}) => {
  const fixture = await openFixture(page, 1440, false, true);
  await expect(fixture.editor()).toBeVisible();
  await fixture.edit("磁盘可能已经收到的草稿");
  fixture.returnWrongSaveReceipt();
  await page.getByRole("button", { name: "保存文件（Ctrl+S）" }).click();
  await expect(page.getByRole("alert")).toContainText("保存结果无法确认");
  expect(fixture.disk.content).toBe("磁盘可能已经收到的草稿");
  expect(await fixture.read()).toBe("磁盘可能已经收到的草稿");
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("kanban.session.file-drafts")),
    )
    .toContain("磁盘可能已经收到的草稿");
  expect(fixture.writes).toEqual(["save"]);
  expect(fixture.errors).toEqual([]);
});

for (const width of [1440, 393]) {
  test.describe(`${width}px unconfirmed save recovery`, () => {
    test.use({ hasTouch: width === 393, isMobile: width === 393 });
    test("restores an edit back to the old baseline after an uncertain write and page reload", async ({
      page,
    }) => {
      const fixture = await openFixture(page, width, false, true);
      await expect(fixture.editor()).toBeVisible();
      await fixture.edit("较早提交给磁盘的内容");
      fixture.holdSave();
      fixture.returnWrongSaveReceipt();
      await page.getByRole("button", { name: "保存文件（Ctrl+S）" }).click();
      await expect.poll(fixture.heldSaves).toBe(1);
      await fixture.edit("磁盘原文");
      await expect
        .poll(() =>
          page.evaluate(() =>
            localStorage.getItem("kanban.session.file-drafts"),
          ),
        )
        .toContain('"saveUnconfirmed":true');
      fixture.releaseSave("success");
      await expect(page.getByRole("alert")).toContainText("保存结果无法确认");
      expect(fixture.disk.content).toBe("较早提交给磁盘的内容");
      await page.reload({ waitUntil: "domcontentloaded" });
      await page
        .locator(".session-mode [contenteditable=true]")
        .first()
        .waitFor({ state: "attached" });
      await activateFixtureEditor(page);
      await expect(fixture.editor()).toBeVisible({ timeout: 30_000 });
      await expect.poll(fixture.read).toBe("磁盘原文");
      await expect(page.getByRole("alert")).toContainText(
        "上次保存的结果尚未确认",
      );
      await expect(
        page.getByText("保存结果未确认", { exact: false }),
      ).toBeVisible();
      await page.getByRole("button", { name: "关闭文件 a.ts" }).click();
      const close = page.getByRole("dialog", { name: "文件尚未保存" });
      await expect(close).toContainText("上次保存结果尚未确认");
      await close.getByRole("button", { name: "取消" }).click();
      await page.getByRole("button", { name: "比较磁盘内容" }).click();
      const comparison = page.getByRole("dialog", {
        name: "文件已在磁盘上更新",
      });
      await expect(comparison).toContainText("当前草稿：磁盘原文");
      await expect(comparison).toContainText("磁盘内容：较早提交给磁盘的内容");
      await expect(comparison).toContainText("可能仍在进行");
      await comparison.getByRole("button", { name: "保留草稿" }).click();
      expect(await fixture.read()).toBe("磁盘原文");
      expect(fixture.writes).toEqual(["save"]);
      expect(fixture.errors).toEqual([]);
    });
  });
}

test("moving or deleting a file waits for its in-flight save", async ({
  page,
}) => {
  const fixture = await openFixture(page, 1440, false, true);
  await expect(fixture.editor()).toBeVisible();
  await fixture.edit("等待保存的草稿");
  fixture.holdSave();
  await page.getByRole("button", { name: "保存文件（Ctrl+S）" }).click();
  await expect.poll(fixture.heldSaves).toBe(1);
  await page
    .getByRole("button", { name: "文件 a.ts", exact: true })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "移入回收站" }).click();
  const dialog = page.getByRole("dialog", { name: "移入回收站" });
  await expect(dialog.getByRole("status")).toContainText("正在保存");
  await expect(dialog.getByRole("button", { name: "确认" })).toBeDisabled();
  fixture.releaseSave("success");
  await expect(dialog.getByRole("button", { name: "确认" })).toBeEnabled();
  await dialog.getByRole("button", { name: "取消" }).click();
  expect(fixture.disk.content).toBe("等待保存的草稿");
  expect(fixture.writes).toEqual(["save"]);
  expect(fixture.errors).toEqual([]);
});

test("an unresolved file move blocks saving and its failure restores editing", async ({
  page,
}) => {
  const fixture = await openFixture(page, 1440, false, true);
  await expect(fixture.editor()).toBeVisible();
  await fixture.edit("移动期间保留的草稿");
  fixture.holdOperation();
  await page
    .getByRole("button", { name: "文件 a.ts", exact: true })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "重命名" }).click();
  const dialog = page.getByRole("dialog", { name: "重命名" });
  await dialog.getByRole("textbox", { name: "文件或文件夹名称" }).fill("b.ts");
  await dialog.getByRole("button", { name: "确认" }).click();
  await expect.poll(fixture.heldOperations).toBe(1);
  await expect(
    page.locator('[aria-label="保存文件（Ctrl+S）"]'),
  ).toBeDisabled();
  await expect(page.locator(".session-mode")).toContainText(
    "操作完成前不能保存",
  );
  fixture.releaseOperation();
  await expect(dialog.getByRole("alert")).toContainText("隔离移动未确认");
  await dialog.getByRole("button", { name: "取消" }).click();
  await expect(
    page.getByRole("button", { name: "保存文件（Ctrl+S）" }),
  ).toBeEnabled();
  expect(await fixture.read()).toBe("移动期间保留的草稿");
  expect(fixture.writes).toEqual(["move"]);
  expect(fixture.errors).toEqual([]);
});

for (const width of [1440, 393]) {
  test.describe(`${width}px pending file save`, () => {
    test.use({ hasTouch: width === 393, isMobile: width === 393 });
    test("keeps later edits while a save is in flight and prevents closing or resending", async ({
      page,
    }) => {
      const fixture = await openFixture(page, width, false, true);
      await expect(fixture.editor()).toBeVisible();
      await fixture.edit("准备保存的快照");
      fixture.holdSave();
      await page.getByRole("button", { name: "保存文件（Ctrl+S）" }).click();
      await expect.poll(fixture.heldSaves).toBe(1);
      await page.getByRole("button", { name: "关闭文件 a.ts" }).click();
      const dialog = page.getByRole("dialog", { name: "文件尚未保存" });
      await expect(dialog.getByRole("status")).toContainText("正在保存");
      await expect(
        dialog.getByRole("button", { name: "放弃修改" }),
      ).toBeDisabled();
      await expect(
        dialog.getByRole("button", { name: "保存并关闭" }),
      ).toBeDisabled();
      await dialog.getByRole("button", { name: "取消" }).click();
      await fixture.edit("保存过程中继续编辑的草稿");
      fixture.releaseSave("success");
      await expect.poll(() => fixture.disk.content).toBe("准备保存的快照");
      await expect(
        page.getByRole("button", { name: "保存文件（Ctrl+S）" }),
      ).toBeEnabled();
      expect(await fixture.read()).toBe("保存过程中继续编辑的草稿");
      expect(fixture.writes).toEqual(["save"]);
      expect(fixture.errors).toEqual([]);
    });
  });
}

test("leaving save-and-close preserves the draft and reports a later save failure", async ({
  page,
}) => {
  const fixture = await openFixture(page, 1440, false, true);
  await expect(fixture.editor()).toBeVisible();
  await fixture.edit("关闭前草稿");
  fixture.holdSave();
  await page.getByRole("button", { name: "关闭文件 a.ts" }).click();
  const dialog = page.getByRole("dialog", { name: "文件尚未保存" });
  await dialog.getByRole("button", { name: "保存并关闭" }).click();
  await expect.poll(fixture.heldSaves).toBe(1);
  await dialog.getByRole("button", { name: "继续编辑" }).click();
  await fixture.edit("保存中继续输入的内容");
  fixture.releaseSave("failure");
  await expect(page.getByRole("alert")).toContainText("隔离保存连接中断");
  expect(await fixture.read()).toBe("保存中继续输入的内容");
  expect(fixture.disk.content).toBe("磁盘原文");
  expect(fixture.writes).toEqual(["save"]);
  expect(fixture.errors).toEqual([]);
});

test("a delayed file-watch read cannot roll back an acknowledged save", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const fixture = await openFixture(page, 1440, false, true);
  await expect(fixture.editor()).toBeVisible();
  await fixture.edit("已保存的新内容");
  fixture.holdNext();
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("fs_change", {
        detail: { path: "/fixture/a.ts", kind: "modify" },
      }),
    ),
  );
  await expect.poll(fixture.held).toBe(1);
  await page.getByRole("button", { name: "保存文件（Ctrl+S）" }).click();
  await expect.poll(() => fixture.disk.content).toBe("已保存的新内容");
  await expect.poll(fixture.read).toBe("已保存的新内容");
  fixture.releaseHeld();
  await page.waitForTimeout(150);
  expect(await fixture.read()).toBe("已保存的新内容");
  expect(fixture.disk.content).toBe("已保存的新内容");
  expect(fixture.writes).toEqual(["save"]);
  expect(fixture.errors).toEqual([]);
});

for (const width of [1440, 393]) {
  test.describe(`${width}px file conflict`, () => {
    test.use({ hasTouch: width === 393, isMobile: width === 393 });
    test("keeps the draft on read failure and asks again when the disk changes", async ({
      page,
    }) => {
      test.setTimeout(90_000);
      const fixture = await openFixture(page, width);
      await expect(fixture.editor()).toBeVisible();
      await fixture.edit("浏览器中的未保存草稿");
      fixture.disk.content = "磁盘新版本";
      fixture.disk.version = "v2";
      await page.evaluate(() =>
        window.dispatchEvent(
          new CustomEvent("fs_change", {
            detail: { path: "/fixture/a.ts", kind: "modify" },
          }),
        ),
      );
      await expect(
        page.getByRole("status").filter({ hasText: "磁盘文件已更新" }),
      ).toBeVisible();
      await page.getByRole("button", { name: "比较并重新读取" }).click();
      const dialog = page.getByRole("dialog", { name: "文件已在磁盘上更新" });
      await expect(dialog).toContainText("磁盘内容：磁盘新版本");
      fixture.disk.failNext = true;
      await dialog.getByRole("button", { name: "放弃草稿并重新读取" }).click();
      await expect(dialog.getByRole("alert")).toContainText("隔离磁盘读取失败");
      expect(await fixture.read()).toBe("浏览器中的未保存草稿");
      await expect
        .poll(() =>
          page.evaluate(() =>
            localStorage.getItem("kanban.session.file-drafts"),
          ),
        )
        .toContain("浏览器中的未保存草稿");
      fixture.disk.content = "磁盘再次更新";
      fixture.disk.version = "v3";
      await dialog.getByRole("button", { name: "放弃草稿并重新读取" }).click();
      await expect(dialog.getByRole("alert")).toContainText("磁盘内容再次变化");
      await expect(dialog).toContainText("磁盘内容：磁盘再次更新");
      expect(await fixture.read()).toBe("浏览器中的未保存草稿");
      await dialog.getByRole("button", { name: "放弃草稿并重新读取" }).click();
      await expect(dialog).toHaveCount(0);
      await expect.poll(fixture.read).toBe("磁盘再次更新");
      expect(
        await page.evaluate(() =>
          localStorage.getItem("kanban.session.file-drafts"),
        ),
      ).not.toContain("浏览器中的未保存草稿");
      expect(fixture.writes).toEqual([]);
      expect(
        fixture.fixture.calls.filter((call) =>
          /\/(?:turn\/start|thread\/resume|followups\/submit)$/.test(call.path),
        ),
      ).toEqual([]);
      expect(fixture.errors).toEqual([]);
    });
  });
}
