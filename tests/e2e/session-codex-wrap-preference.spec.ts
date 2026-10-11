import { expect, test } from "@playwright/test";
import { setup } from "./session-composer-v2-fixture";

for (const width of [390, 1440]) {
  test.describe(`native wrap preference ${width}`, () => {
    test.use({
      viewport: { width, height: 900 },
      hasTouch: width === 390,
      isMobile: width === 390,
    });
    for (const theme of ["dark", "light"]) {
      test(`shares wrapping across sessions and refresh (${theme})`, async ({
        page,
      }, info) => {
        const f = await setup(page, false);
        try {
          for (const [index, thread] of f.fixture.threads.entries()) {
            thread.turns = [
              {
                id: `wrap-turn-${index}`,
                status: "completed",
                items: [
                  {
                    type: "agentMessage",
                    id: `wrap-message-${index}`,
                    phase: "final_answer",
                    text:
                      '代码换行偏好。\n\n```typescript\nconst sample = "' +
                      "long content ".repeat(18) +
                      "\";\n```\n\n```python\nprint('second block')\n```",
                  },
                ],
              },
            ] as never;
          }
          await page.evaluate((theme) => {
            localStorage.setItem(
              "kanban.session.theme-storage",
              JSON.stringify({
                version: 1,
                state: { theme, accent: "default" },
              }),
            );
          }, theme);
          await page.reload({ waitUntil: "domcontentloaded" });
          const fences = page.locator(".codex-native-code-fence");
          await expect(fences).toHaveCount(2);
          await fences
            .first()
            .getByRole("button", { name: "启用自动换行" })
            .click();
          await expect(
            page.getByRole("button", { name: "禁用自动换行" }),
          ).toHaveCount(2);
          await expect(fences.first().locator("code")).toHaveCSS(
            "white-space",
            "pre-wrap",
          );
          await page.screenshot({
            path: info.outputPath(`wrapped-${width}-${theme}.png`),
          });
          await page
            .getByRole("tab", { name: /中文会话 1/ })
            .locator(".session-identity-title")
            .click();
          await expect(
            page.getByRole("button", { name: "禁用自动换行" }),
          ).toHaveCount(2);
          await page.reload({ waitUntil: "domcontentloaded" });
          await expect(
            page.getByRole("button", { name: "禁用自动换行" }),
          ).toHaveCount(2);
          await page.screenshot({
            path: info.outputPath(`restored-${width}-${theme}.png`),
          });
          await fences
            .nth(1)
            .getByRole("button", { name: "禁用自动换行" })
            .click();
          await expect(
            page.getByRole("button", { name: "启用自动换行" }),
          ).toHaveCount(2);
          expect(f.errors).toEqual([]);
          expect(f.calls).toEqual([]);
        } finally {
          await f.close();
        }
      });
    }
  });
}
