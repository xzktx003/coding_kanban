import { expect, test, type Page } from "@playwright/test";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";

async function switchThread(page: Page, id: string) {
  await page.evaluate(async (id) => {
    const path = "/src/session-mode/components/codex/stores/index.ts";
    const { useCodexStore } = await import(
      performance
        .getEntriesByType("resource")
        .findLast((e) => new URL(e.name).pathname === path)?.name ?? path
    );
    useCodexStore.setState({ currentThreadId: id });
  }, id);
}
for (const width of [1440, 390])
  for (const theme of ["dark", "light"]) {
    test(`file drop ${width} ${theme}: stable layout, original owner, retry and persisted complete context`, async ({
      page,
    }, info) => {
      const fixture = await installSessionUxFixture(page, 2);
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await page.addInitScript(
        (theme) => localStorage.setItem("kanban.theme", theme),
        theme,
      );
      let release!: () => void,
        uploadCount = 0;
      const gate = new Promise<void>((r) => {
        release = r;
      });
      await page.route("**/api/session/files/upload", async (route) => {
        uploadCount++;
        if (uploadCount === 1) {
          await gate;
          await route.fulfill({
            status: 500,
            json: { error: "drop upload failed" },
          });
        } else await route.fulfill({ json: { path: "/fixture/drop.png" } });
      });
      await page.goto("/?mode=session");
      await page
        .locator(".session-mode [contenteditable=true]")
        .first()
        .waitFor();
      await seedSessionUx(page, 2);
      await page.evaluate(async (theme) => {
        const path = "/src/session-mode/stores/settings/useThemeStore.ts";
        const { useThemeStore } = await import(
          performance
            .getEntriesByType("resource")
            .findLast((e) => new URL(e.name).pathname === path)?.name ?? path
        );
        useThemeStore.getState().setTheme(theme);
      }, theme);
      const composer = page.locator(".session-codex-composer").first(),
        editor = composer.locator("[contenteditable=true]").first();
      const frame = composer.locator(".session-compact-frame");
      await editor.fill("正文草稿保持原样");
      await editor.evaluate((el) => (el as HTMLElement).blur());
      const before = await frame.boundingBox();
      expect(before).not.toBeNull();
      const canceled = await editor.evaluate((el) => {
        const transfer = new DataTransfer();
        transfer.items.add(
          new File(
            [
              Uint8Array.from(
                atob(
                  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
                ),
                (c) => c.charCodeAt(0),
              ),
            ],
            "drop.png",
            { type: "image/png" },
          ),
        );
        transfer.items.add(
          new File(["# 完整文件\n\nprint('你好')\n"], "drop.md", {
            type: "text/markdown",
          }),
        );
        (window as any).__dropTransfer = transfer;
        return !el.dispatchEvent(
          new DragEvent("dragover", {
            bubbles: true,
            cancelable: true,
            dataTransfer: transfer,
          }),
        );
      });
      expect(canceled).toBe(true);
      await expect(
        composer.getByText("松开以添加附件", { exact: true }),
      ).toBeVisible();
      expect((await frame.boundingBox())!.height).toBe(before!.height);
      await page.screenshot({
        path: info.outputPath(`drop-${width}-${theme}-hover.png`),
        fullPage: true,
      });
      await editor.evaluate((el) =>
        el.dispatchEvent(
          new DragEvent("drop", {
            bubbles: true,
            cancelable: true,
            dataTransfer: (window as any).__dropTransfer,
          }),
        ),
      );
      await expect(
        composer.getByText("松开以添加附件", { exact: true }),
      ).toHaveCount(0);
      await expect(
        composer.getByRole("button", { name: /查看上下文 drop.md/ }),
      ).toBeVisible();
      await expect(composer.locator('[data-state="uploading"]')).toBeVisible();
      await expect(
        composer.locator(".session-context-chip").first(),
      ).toHaveClass(/is-image/);
      await expect(
        composer.getByRole("button", { name: "移除 drop.png", exact: true }),
      ).toBeInViewport();
      if (width === 390) {
        const remove = (await composer
          .getByRole("button", { name: "移除 drop.png", exact: true })
          .boundingBox())!;
        expect(remove.width).toBeGreaterThanOrEqual(44);
        expect(remove.height).toBeGreaterThanOrEqual(44);
      }
      await expect(editor).toHaveText("正文草稿保持原样");
      expect(await editor.evaluate((el) => el === document.activeElement)).toBe(
        false,
      );
      expect(
        fixture.calls.filter((c) => c.path.endsWith("/submit")),
      ).toHaveLength(0);
      if (width === 390)
        expect((await frame.boundingBox())!.height).toBe(before!.height);
      await switchThread(page, "ux-1");
      await expect(composer.locator(".session-context-chip")).toHaveCount(0);
      release();
      await expect.poll(() => uploadCount).toBe(1);
      await switchThread(page, "ux-0");
      await expect(composer.locator('[data-state="error"]')).toBeVisible();
      await page.screenshot({
        path: info.outputPath(`drop-${width}-${theme}-retry-preview.png`),
        fullPage: true,
      });
      const preview = composer.getByRole("button", {
        name: "预览 drop.png，上传失败",
        exact: true,
      });
      expect(
        await preview.evaluate((el) => {
          const box = el.getBoundingClientRect();
          return (
            document
              .elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
              ?.closest("button") === el
          );
        }),
        "the picture center opens its preview rather than deleting the image",
      ).toBe(true);
      await composer
        .getByRole("button", { name: "预览 drop.png，上传失败", exact: true })
        .click();
      await page.getByRole("button", { name: "重试上传", exact: true }).click();
      await page.getByRole("button", { name: "关闭面板", exact: true }).click();
      await expect(composer.locator('[data-state="ready"]')).toBeVisible();
      expect(uploadCount).toBe(2);
      await composer
        .getByRole("button", { name: /查看上下文 drop.md/ })
        .click();
      await expect(page.locator(".session-context-preview")).toHaveText(
        "# 完整文件\n\nprint('你好')",
      );
      await page.getByRole("button", { name: "关闭面板", exact: true }).click();
      await page.reload();
      await page
        .locator(".session-mode [contenteditable=true]")
        .first()
        .waitFor();
      await seedSessionUx(page, 2);
      await expect(editor).toHaveText("正文草稿保持原样");
      await expect(
        composer.getByRole("button", { name: /查看上下文 drop.md/ }),
      ).toBeVisible();
      await expect(
        composer.getByRole("button", { name: "预览 drop.png", exact: true }),
      ).toBeVisible();
      await page.screenshot({
        path: info.outputPath(`drop-${width}-${theme}-restored.png`),
        fullPage: true,
      });
      await composer
        .getByRole("button", { name: "移除 drop.png", exact: true })
        .click();
      await expect(
        composer.getByRole("button", { name: "预览 drop.png", exact: true }),
      ).toHaveCount(0);
      await page.getByRole("button", { name: "撤销", exact: true }).click();
      await expect(
        composer.getByRole("button", { name: "预览 drop.png", exact: true }),
      ).toBeVisible();
      await composer
        .getByRole("button", { name: "发送消息", exact: true })
        .click();
      await expect
        .poll(
          () => fixture.calls.filter((c) => c.path.endsWith("/submit")).length,
        )
        .toBe(1);
      const submitted = fixture.calls.find((c) =>
        c.path.endsWith("/submit"),
      )!.body;
      expect(submitted.threadId).toBe("ux-0");
      expect(submitted.images).toEqual(["/fixture/drop.png"]);
      expect(submitted.contexts).toEqual([
        expect.objectContaining({
          name: "drop.md",
          kind: "file",
          text: "# 完整文件\n\nprint('你好')\n",
        }),
      ]);
    });
  }
