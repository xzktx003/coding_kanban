import { expect, test } from "@playwright/test";
import { setup } from "./session-composer-v2-fixture";
import { observeNativeCapture, released } from "./session-dictation-fixture";

// Full headless Chromium honors native permission denial. The default
// headless shell returns NotSupportedError without fake UI, whose override
// would bypass denial entirely. Do not substitute either for this gate.
test.use({
  channel: "chromium",
  launchOptions: { args: ["--use-fake-device-for-media-stream"] },
  permissions: [],
});

test("a denied native microphone leaves the original composer editable", async ({
  page,
  context,
}) => {
  await observeNativeCapture(page);
  const f = await setup(page, false);
  try {
    const cdp = await context.newCDPSession(page);
    const { targetInfo } = await cdp.send("Target.getTargetInfo");
    await cdp.send("Browser.setPermission", {
      browserContextId: targetInfo.browserContextId,
      permission: { name: "microphone" },
      setting: "denied",
      origin: new URL(page.url()).origin,
    });
    await expect
      .poll(() =>
        page.evaluate(
          async () =>
            (
              await navigator.permissions.query({
                name: "microphone" as PermissionName,
              })
            ).state,
        ),
      )
      .toBe("denied");
    const editor = page
      .locator('.session-codex-composer [contenteditable="true"]')
      .first();
    await editor.fill("权限拒绝前的草稿");
    await page.getByRole("button", { name: "听写", exact: true }).click();
    await expect(
      page.locator(".session-dictation-failure[role=alert]"),
    ).toContainText("请启用麦克风访问权限以使用听写功能");
    const failure = await page.evaluate(
      () => (window as any).__dictationCapture.failure,
    );
    expect(failure.name).toBe("NotAllowedError");
    expect(failure.ctor).toBe("DOMException");
    await released(page);
    await editor.fill("拒绝权限后仍可输入");
    await expect(editor).toHaveText("拒绝权限后仍可输入");
    expect(f.calls).toEqual([]);
    expect(f.errors).toEqual([]);
  } catch (error) {
    console.info(
      "dictation-failure",
      JSON.stringify(
        await page.evaluate(() => ({
          text: document.body.innerText,
          failure: (window as any).__dictationCapture?.failure,
        })),
      ),
    );
    throw error;
  } finally {
    await f.close();
  }
});
