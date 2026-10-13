import { expect, test } from "@playwright/test";

test("a fresh session starts with full access", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.removeItem("kanban.session.codex-config-storage");
    localStorage.removeItem("kanban.session.codex-thread-models");
  });
  await page.goto("/?mode=session&view=agent", { waitUntil: "domcontentloaded" });
  const permission = page.getByRole("button", { name: "执行权限：完全访问" }).first();
  await expect(permission).toBeVisible();
  await page.screenshot({
    path: `${process.env.CODEX_UI_SHOTS ?? "test-results"}/control-default-permission.png`,
    animations: "disabled",
  });
});
