import { expect, test } from "@playwright/test";

for (const width of [1902, 1440, 1024, 375]) {
  test(`terminal navigation shares the toolbar at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.routeWebSocket("**/*", (socket) => {
      socket.onMessage(() => {});
    });
    await page.route("**/api/**", (route) => {
      const path = new URL(route.request().url()).pathname;
      let json: unknown = {};
      if (path === "/api/agent-sessions") {
        json = { items: [], activeAgentSessionId: null, updatedAt: "fixture" };
      } else if (path.endsWith("/sessions") || path.endsWith("/ssh-hosts")) {
        json = [];
      }
      return route.fulfill({ json });
    });
    await page.goto("/?mode=terminal");
    const toolbar = page.locator(".workbench-terminal .top-bar");
    const navigation = toolbar.locator(".workbench-header");
    await expect(navigation).toBeVisible();
    await expect(toolbar.getByTestId("new-session-toggle")).toBeVisible();
    await expect(
      page.locator(".workbench-shell > .workbench-header"),
    ).toHaveCount(0);
    if (width > 900) {
      const navBounds = (await navigation.boundingBox())!;
      const actionBounds = (await toolbar
        .locator(".top-bar-actions")
        .boundingBox())!;
      expect(
        Math.abs(
          navBounds.y +
            navBounds.height / 2 -
            actionBounds.y -
            actionBounds.height / 2,
        ),
      ).toBeLessThan(2);
      expect((await toolbar.boundingBox())!.height).toBeLessThan(50);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await toolbar.getByTestId("settings-menu-toggle").click();
    await expect(toolbar.getByTestId("settings-menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await toolbar.getByTestId("top-bar-collapse").click();
    await expect(navigation).toBeVisible();
    await expect(
      toolbar.getByRole("button", { name: "会话", exact: true }),
    ).toBeVisible();
    await toolbar.getByTestId("top-bar-expand").click();
    await expect(toolbar.getByTestId("new-session-toggle")).toBeVisible();
  });
}
