import { expect, test } from "@playwright/test";
import { installSessionUxFixture } from "./session-ux-fixture";

test("three peer mode buttons preserve focus and drafts on desktop and phones", async ({
  page,
}) => {
  test.setTimeout(90000);
  await installSessionUxFixture(page, 0);
  await page.route("**/api/native-codex/status", (route) =>
    route.fulfill({ json: { available: false, reason: "隔离模式测试" } }),
  );
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/?mode=session");
  const editor = page.locator(".session-mode [contenteditable=true]").first();
  await expect(editor).toBeVisible();
  await editor.fill("三个按钮切换后保留的草稿");

  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const group = page.getByRole("group", { name: "工作模式", exact: true });
    await expect(group.getByRole("button")).toHaveText([
      "会话",
      "终端",
      "Codex",
    ]);
    await expect(group.getByRole("switch")).toHaveCount(0);
    const geometry = await group.getByRole("button").evaluateAll((buttons) =>
      buttons.map((button) => {
        const rect = button.getBoundingClientRect();
        return { y: rect.y, width: rect.width, height: rect.height };
      }),
    );
    for (const button of geometry) {
      expect(Math.abs(button.y - geometry[0].y)).toBeLessThanOrEqual(1);
      expect(Math.abs(button.width - geometry[0].width)).toBeLessThanOrEqual(1);
      expect(button.height).toBe(geometry[0].height);
    }
    await expect(group).toBeInViewport();
    await group.screenshot({
      path: `.dev-runtime/mode-buttons/session-${width}.png`,
    });

    await group.getByRole("button", { name: "终端", exact: true }).click();
    const terminal = group.getByRole("button", { name: "终端", exact: true });
    await expect(terminal).toHaveAttribute("aria-pressed", "true");
    await expect(terminal).toBeFocused();
    await group.screenshot({
      path: `.dev-runtime/mode-buttons/terminal-${width}.png`,
    });
    await terminal.press("End");
    const codex = group.getByRole("button", { name: "Codex", exact: true });
    await expect(codex).toHaveAttribute("aria-pressed", "true");
    await expect(codex).toBeFocused();
    await expect(group.getByRole("switch")).toHaveCount(0);
    await group.screenshot({
      path: `.dev-runtime/mode-buttons/codex-${width}.png`,
    });
    await codex.press("Home");
    await expect(
      group.getByRole("button", { name: "会话", exact: true }),
    ).toBeFocused();
    await expect(editor).toContainText("三个按钮切换后保留的草稿");
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
  }
  expect(errors).toEqual([]);
});
