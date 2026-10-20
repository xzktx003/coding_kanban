import { expect, test, type Page } from "@playwright/test";
import { installSessionUxFixture } from "./session-ux-fixture";

async function openFiles(page: Page) {
  await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
  await page
    .locator(".session-mode [contenteditable=true]")
    .first()
    .waitFor({ state: "attached" });
  await page.evaluate(async () => {
    const module = (path: string) =>
      import(
        performance
          .getEntriesByType("resource")
          .findLast((e) => new URL(e.name).pathname === path)?.name ?? path
      );
    const [{ useWorkspaceStore }, { useLayoutStore }] = await Promise.all([
      module("/src/session-mode/stores/useWorkspaceStore.ts"),
      module("/src/session-mode/stores/useLayoutStore.ts"),
    ]);
    useWorkspaceStore.setState({ cwd: "/fixture", projects: ["/fixture"] });
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

for (const width of [1440, 390]) {
  test(`file tree divider supports resizing without losing content (${width}px)`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 900 });
    const fixture = await installSessionUxFixture(page, 0);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/api/session/api/filesystem/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      const body =
        route.request().method() === "POST"
          ? route.request().postDataJSON()
          : {};
      await route.fulfill({
        json: path.endsWith("/canonicalize-path")
          ? body.path
          : path.endsWith("/read-directory")
            ? [{ name: "src", path: "/fixture/src", is_dir: true }]
            : "",
      });
    });
    await openFiles(page);
    const panel = page.getByRole("region", { name: "会话文件管理" });
    const divider = panel.getByRole("separator", {
      name: "调整文件树与预览宽度",
    });
    if (width < 768) {
      await expect(divider).toHaveCount(0);
      await panel
        .getByRole("button", { name: "显示文件树", exact: true })
        .click();
      await expect(
        panel.getByRole("button", { name: "展开文件夹 src", exact: true }),
      ).toBeVisible();
      await expect(divider).toHaveCount(0);
      await page.screenshot({ path: info.outputPath("mobile.png") });
    } else {
      await expect(
        panel.getByRole("button", { name: "展开文件夹 src", exact: true }),
      ).toBeVisible();
      await page.screenshot({ path: info.outputPath("before.png") });
      await expect(divider).toBeVisible();
      const initial = Number(await divider.getAttribute("aria-valuenow"));
      const handle = (await divider.boundingBox())!;
      await page.mouse.move(
        handle.x + handle.width / 2,
        handle.y + handle.height / 2,
      );
      await page.mouse.down();
      await page.mouse.move(handle.x - 140, handle.y + handle.height / 2, {
        steps: 12,
      });
      await page.mouse.up();
      await expect
        .poll(async () => Number(await divider.getAttribute("aria-valuenow")))
        .toBeLessThan(initial - 5);
      const resized = Number(await divider.getAttribute("aria-valuenow"));
      await divider.focus();
      await page.keyboard.press("ArrowRight");
      await expect
        .poll(async () => Number(await divider.getAttribute("aria-valuenow")))
        .toBeGreaterThan(resized);
      const saved = Number(await divider.getAttribute("aria-valuenow"));
      await panel
        .getByRole("button", { name: "隐藏文件树", exact: true })
        .click();
      await expect(divider).toHaveCount(0);
      await expect(
        panel.getByText("选择文件以查看内容", { exact: true }),
      ).toBeVisible();
      await panel
        .getByRole("button", { name: "显示文件树", exact: true })
        .click();
      await expect
        .poll(async () => Number(await divider.getAttribute("aria-valuenow")))
        .toBe(saved);
      await expect
        .poll(() =>
          page.evaluate(() =>
            Object.keys(localStorage).some((k) =>
              k.includes("kanban.session.files-tree-size"),
            ),
          ),
        )
        .toBe(true);
      await openFiles(page);
      await expect
        .poll(async () => Number(await divider.getAttribute("aria-valuenow")))
        .toBe(saved);
      await divider.focus();
      await page.keyboard.press("Home");
      await expect
        .poll(async () => Number(await divider.getAttribute("aria-valuenow")))
        .toBe(35);
      await page.keyboard.press("End");
      await expect
        .poll(async () => Number(await divider.getAttribute("aria-valuenow")))
        .toBe(80);
      await expect(
        panel.getByRole("button", { name: "展开文件夹 src", exact: true }),
      ).toBeVisible();
      await page.screenshot({ path: info.outputPath("resized.png") });
    }
    expect(errors).toEqual([]);
    expect(
      fixture.calls.filter((c) =>
        /\/turn\/(start|interrupt)$|\/thread\/resume$/.test(c.path),
      ),
    ).toEqual([]);
  });
}
