import { expect, test } from "@playwright/test";

test("startup exposes gateway and session health through the frontend and loads both workbench modes", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const endpoint of ["/api/health", "/api/session/health"]) {
    const response = await page.request.get(endpoint);
    expect(response.ok(), endpoint).toBe(true);
    expect((await response.json()).status, endpoint).toBe("ok");
  }
  await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
  expect(await page.evaluate(() => window.isSecureContext)).toBe(true);
  await expect(
    page.getByRole("navigation", { name: "会话工作台导航" }),
  ).toBeVisible();
  await page
    .locator(".session-mode:not([hidden])")
    .getByRole("group", { name: "工作模式", exact: true })
    .getByRole("button", { name: "终端", exact: true })
    .click();
  await expect(page.locator(".workbench-terminal")).toBeVisible();
  await page
    .locator(".workbench-terminal:not([hidden])")
    .getByRole("group", { name: "工作模式", exact: true })
    .getByRole("button", { name: "会话", exact: true })
    .click();
  await expect(
    page.getByRole("navigation", { name: "会话工作台导航" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("navigation", { name: "会话工作台导航" }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page
      .locator(".session-mode:not([hidden])")
      .getByRole("group", { name: "工作模式", exact: true })
      .getByRole("button", { name: "终端", exact: true }),
  ).toBeInViewport();
  expect(errors).toEqual([]);
});
