import { expect, test } from "@playwright/test";
import { installSessionUxFixture } from "./session-ux-fixture";

for (const width of [1366, 390]) {
  test(`folder arrows expand nested directories independently from path insertion (${width}px)`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: 900 });
    await installSessionUxFixture(page, 0);
    const reads: string[] = [];
    await page.route("**/api/session/api/filesystem/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      const body =
        route.request().method() === "POST"
          ? route.request().postDataJSON()
          : {};
      if (path.endsWith("/canonicalize-path")) {
        await route.fulfill({ json: body.path });
      } else if (path.endsWith("/read-directory")) {
        reads.push(body.path);
        const name =
          body.path === "/fixture"
            ? "src"
            : body.path === "/fixture/src"
              ? "lib"
              : "index.ts";
        await route.fulfill({
          json: [
            { name, path: `${body.path}/${name}`, is_dir: name !== "index.ts" },
          ],
        });
      } else await route.fulfill({ json: "" });
    });
    await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
    await page
      .locator(".session-mode [contenteditable=true]")
      .first()
      .waitFor();
    await page.evaluate(async () => {
      const moduleUrl = (path: string) =>
        performance
          .getEntriesByType("resource")
          .findLast((entry) => new URL(entry.name).pathname === path)?.name ??
        path;
      const { useWorkspaceStore } = await import(
        moduleUrl("/src/session-mode/stores/useWorkspaceStore.ts")
      );
      const { useLayoutStore } = await import(
        moduleUrl("/src/session-mode/stores/useLayoutStore.ts")
      );
      useWorkspaceStore.setState({ cwd: "/fixture" });
      useLayoutStore.setState({
        view: "agent",
        isRightPanelOpen: true,
        isRightPanelFocused: true,
        openRightPanelTabs: ["files"],
        activeRightPanelTab: "files",
      });
    });
    const show = page.getByRole("button", { name: "显示文件树", exact: true });
    if (width < 768) await show.click();
    const src = page.getByRole("button", {
      name: "展开文件夹 src",
      exact: true,
    });
    await src.click();
    const lib = page.getByRole("button", {
      name: "展开文件夹 lib",
      exact: true,
    });
    await lib.click();
    await expect(
      page.getByRole("button", { name: "文件 index.ts", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "插入路径 src", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "文件 index.ts", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "收起文件夹 src", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "文件 index.ts", exact: true }),
    ).toHaveCount(0);
    await src.click();
    await expect(
      page.getByRole("button", { name: "文件 index.ts", exact: true }),
    ).toBeVisible();
    expect(reads.filter((path) => path === "/fixture/src")).toHaveLength(1);
    expect(reads.filter((path) => path === "/fixture/src/lib")).toHaveLength(1);
    await page.evaluate(() => {
      window.dispatchEvent(
        new CustomEvent("fs_change", {
          detail: { path: "/fixture/src/lib/new.ts", kind: "create" },
        }),
      );
    });
    await expect
      .poll(() => reads.filter((path) => path === "/fixture/src/lib").length)
      .toBe(2);
    await expect(
      page.getByRole("button", { name: "文件 index.ts", exact: true }),
    ).toBeVisible();
  });
}
