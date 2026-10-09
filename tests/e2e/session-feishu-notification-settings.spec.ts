import { expect, test } from "@playwright/test";
import { installSessionUxFixture } from "./session-ux-fixture";

for (const width of [1440, 375]) {
  test(`session Feishu completion settings share the terminal switch at ${width}px`, async ({
    page,
  }) => {
    await installSessionUxFixture(page, 2);
    await page.setViewportSize({ width, height: 900 });
    let enabled = true;
    const updates: unknown[] = [];
    await page.route("**/api/settings/feishu-notifications", async (route) => {
      if (route.request().method() === "PUT") {
        const body = route.request().postDataJSON();
        updates.push(body);
        enabled = body.enabled;
      }
      await route.fulfill({
        json: {
          configured: true,
          enabled,
          destinationType: "user",
          replyConfigured: true,
          replyEnabled: true,
        },
      });
    });
    await page.goto("/?mode=session");
    if (width < 600) {
      await page.getByRole("button", { name: "更多功能", exact: true }).click();
      await page.getByRole("menuitem", { name: "设置", exact: true }).click();
    } else
      await page.getByRole("button", { name: "设置", exact: true }).click();
    const toggle = page.getByRole("switch", {
      name: "飞书完成通知",
      exact: true,
    });
    await expect(toggle).toBeChecked();
    await toggle.click();
    await expect(toggle).not.toBeChecked();
    expect(updates).toEqual([{ enabled: false }]);
    await toggle.click();
    await expect(toggle).toBeChecked();
    expect(updates).toEqual([{ enabled: false }, { enabled: true }]);
  });
}
