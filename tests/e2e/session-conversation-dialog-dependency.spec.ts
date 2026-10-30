import { expect, test } from "@playwright/test";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";

test("closed conversation forms do not block input while their keyboard listener remains live", async ({
  page,
}) => {
  await installSessionUxFixture(page, 1);
  const requested: string[] = [];
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    /\/src\/session-mode\/components\/codex\/composer\/(?:ConversationOwnerForms|SearchChatsSheet|KeyboardShortcutsSheet)\.tsx/,
    async (route) => {
      requested.push(new URL(route.request().url()).pathname);
      await held;
      await route.continue();
    },
  );
  try {
    await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
    const editor = page
      .locator(".session-codex-composer [contenteditable=true]")
      .first();
    await expect(editor).toBeVisible({ timeout: 5000 });
    await seedSessionUx(page, 1);
    await editor.fill("Keep the main draft while a dialog loads");
    expect(requested).toEqual([]);
    // The visible secondary header owns this shortcut. The closed composer
    // menu deliberately does not acquire shortcut ownership.
    await page.getByRole("button", { name: "设置", exact: true }).click();
    await page.getByRole("button", { name: "返回会话", exact: true }).focus();
    await page.keyboard.press("Control+/");
    await expect
      .poll(() =>
        requested.some((path) => path.endsWith("/KeyboardShortcutsSheet.tsx")),
      )
      .toBe(true);
    await expect(editor).toHaveText("Keep the main draft while a dialog loads");
    release();
    await expect(
      page.getByRole("dialog", { name: "键盘快捷方式", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "返回会话", exact: true }).click();
    await expect(editor).toHaveText("Keep the main draft while a dialog loads");
  } finally {
    release();
  }
});
