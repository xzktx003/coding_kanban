import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { setup } from "./session-composer-v2-fixture";
import { liveStream } from "./session-sse-fixture";

for (const width of [1440, 393]) {
  for (const revoke of ["resync", "account"] as const) {
    test(`pending feedback ${revoke} clears only its UI and ignores late receipt at ${width}px`, async ({
      page,
      baseURL,
    }, info) => {
      await page.setViewportSize({ width, height: 852 });
      const stream = await liveStream(page, baseURL!);
      const fixture = await setup(page, false);
      let release: (() => void) | undefined;
      let uploads = 0,
        uploadFinished = false;
      await page.route("**/api/session/api/codex/feedback/preflight", (route) =>
        route.fulfill({
          json: {
            reason: null,
            runtimeInstance: "feedback-scope-fixture",
            provenance: {
              config: "fresh",
              requirements: "fresh",
              account: "native",
              workspace: "fresh",
            },
          },
        }),
      );
      await page.route(
        "**/api/session/api/codex/feedback/upload",
        async (route) => {
          uploads++;
          await new Promise<void>((resolve) => {
            release = resolve;
          });
          await route.fulfill({
            json: { threadId: "late-scope-feedback-receipt" },
          });
          uploadFinished = true;
        },
      );
      try {
        const editor = page
          .locator(".session-codex-composer [contenteditable=true]")
          .first();
        await editor.fill("/feedback");
        await page
          .locator('[data-composer-suggestions="commands"]')
          .getByRole("option", { name: /\/feedback/ })
          .click();
        await page.getByRole("radio", { name: "错误", exact: true }).click();
        await page
          .getByRole("textbox", { name: "填写详情（必填）" })
          .fill("Captured diagnostics");
        await page.getByRole("button", { name: "提交", exact: true }).click();
        await expect(
          page.getByRole("dialog", { name: "正在上传反馈" }),
        ).toBeVisible();
        await expect.poll(() => Boolean(release)).toBe(true);
        // Real EventSource delivery; a sequence gap invokes the shared resync path.
        if (revoke === "resync") {
          stream.envelope(1, "fixture:heartbeat", {});
          stream.envelope(3, "fixture:heartbeat", {});
        } else
          stream.emit(1, {
            method: "account/updated",
            params: { authMode: "apiKey", planType: null },
          });
        await expect(
          page.getByRole("dialog", { name: "正在上传反馈" }),
        ).toHaveCount(0);
        release!();
        await expect.poll(() => uploadFinished).toBe(true);
        await expect(
          page.getByRole("dialog", { name: "反馈已提交" }),
        ).toHaveCount(0);
        await expect(
          page.getByRole("button", { name: "查看上传内容", exact: true }),
        ).toHaveCount(0);
        await editor.fill("当前会话的新草稿");
        await expect(editor).toHaveText("当前会话的新草稿");
        expect(uploads).toBe(1);
        await writeFile(
          info.outputPath("feedback-scope.json"),
          JSON.stringify(
            {
              width,
              revoke,
              uploads,
              uploadFinished,
              lateReceiptRevivedUI: false,
              boundary:
                "Actual slash form, preflight/upload HTTP and persistent native EventSource against isolated fixtures. Scope revocation releases only client UI; issued upload finishes exactly once.",
            },
            null,
            2,
          ),
        );
      } finally {
        release?.();
        await fixture.close();
        await stream.close();
      }
    });
  }
}
