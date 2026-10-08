import { expect, test } from "@playwright/test";
import { installSessionUxFixture } from "./session-ux-fixture";

for (const width of [375, 1440]) {
  test(`project links and functional tool tabs at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await installSessionUxFixture(page, 0);
    await page.route("**/api/skills/groups/read", route => route.fulfill({ json: { groups: [] } }));
    await page.route("**/api/skills/list-central", route => route.fulfill({ json: [] }));
    await page.route("**/api/skillssh/leaderboard", route => route.fulfill({ json: [] }));
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    const promotionalRequests: string[] = [];
    page.on("request", request => {
      if (/milisp\.dev|raw\.githubusercontent\.com\/milisp\/codexia/.test(request.url())) promotionalRequests.push(request.url());
    });
    await page.goto("/?mode=session&view=settings", { waitUntil: "domcontentloaded" });
    const link = page.getByRole("link", { name: "GitHub 项目", exact: true });
    await expect(link).toHaveAttribute("href", "https://github.com/BrotherHappy/coding-kanban");
    await link.scrollIntoViewIfNeeded();
    await expect(link).toBeVisible();
    const bounds = await link.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    await expect.soft(page.getByRole("link", { name: /上游|Discord|lisp_mi/i })).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath(`project-settings-${width}.png`) });
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(link).toHaveAttribute("href", "https://github.com/BrotherHappy/coding-kanban");
    await page.goto("/?mode=session&view=plugins", { waitUntil: "domcontentloaded" });
    for (const name of ["Plugins", "Skills", "Connectors"]) {
      await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
    }
    await expect(page.getByRole("button", { name: "Tools", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Skills", exact: true }).click();
    await page.getByRole("button", { name: "Connectors", exact: true }).click();
    await expect(page.getByRole("button", { name: "返回会话", exact: true })).toBeVisible();
    expect(promotionalRequests).toEqual([]);
    expect(errors).toEqual([]);
    await page.screenshot({ path: test.info().outputPath(`project-tools-${width}.png`) });
  });
}
