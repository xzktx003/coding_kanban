import { expect, test } from "@playwright/test";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";

for (const failure of ["oversize", "upload"] as const) {
  test(`file picker ${failure} failure is visible and leaves the draft untouched`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const fixture = await installSessionUxFixture(page, 1);
    let uploads = 0;
    await page.route("**/api/session/files/upload", (route) => {
      uploads++;
      return route.fulfill({
        status: 503,
        json: { error: "isolated upload unavailable" },
      });
    });
    await page.goto("/?mode=session");
    const editor = page
      .locator(".session-codex-composer [contenteditable=true]")
      .first();
    await editor.waitFor();
    await seedSessionUx(page, 1);
    await editor.fill("保留未提交的草稿");
    await page.getByRole("button", { name: "附加文件", exact: true }).click();
    const chooserPromise = page.waitForEvent("filechooser");
    await page
      .getByRole("button", { name: "文件和文件夹", exact: true })
      .click();
    const chooser = await chooserPromise;
    await chooser.setFiles({
      name: "fixture.txt",
      mimeType: "text/plain",
      buffer:
        failure === "oversize"
          ? Buffer.alloc(11 * 1024 * 1024, 97)
          : Buffer.from("fixture contents"),
    });
    const notice = page.locator('.codex-native-alert[data-level="danger"]');
    await expect(notice).toContainText("无法打开文件选择器");
    await expect(editor).toHaveText("保留未提交的草稿");
    expect(uploads).toBe(failure === "oversize" ? 0 : 1);
    await expect(page.locator("[data-file-picker=browser]")).toHaveCount(0);
    expect(
      fixture.calls.filter((call) =>
        /\/(?:turn\/start|followups\/submit)$/.test(call.path),
      ),
    ).toEqual([]);
    await page.screenshot({ path: info.outputPath("file-picker-error.png") });
    expect(errors).toEqual([]);
  });
}
