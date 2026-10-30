import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";

for (const width of [1440, 393])
  for (const theme of ["dark", "light"]) {
    test(`Markdown code and table menus hand over without locking the document (${width}, ${theme})`, async ({
      page,
    }, info) => {
      await page.setViewportSize({ width, height: 852 });
      const id = "6c3ac938-fdfa-461c-b1fb-df99961cb35e";
      await page.addInitScript(
        ({ id, theme }) =>
          sessionStorage.setItem(
            "kanban.session.plan-window:" + id,
            JSON.stringify({
              version: 1,
              createdAt: Date.now(),
              text: "# Plan\n\n```ts\nconst saved = 42;\n```\n\n| A | B |\n|---|---|\n| 1 | 2 |",
              language: "zh",
              rootClassName: "session-mode " + theme,
              cssVariables: {},
              theme: {
                theme,
                resolvedTheme: theme,
                accent: "default",
                starfield: false,
                backgroundImage: null,
              },
            }),
          ),
        { id, theme },
      );
      try {
        await page.goto(`/?mode=session&planWindow=${id}`);
        const code = page.getByRole("button", {
          name: "代码块更多操作",
          exact: true,
        });
        const table = page.getByRole("button", {
          name: "表格更多操作",
          exact: true,
        });
        for (let i = 0; i < 3; i++) {
          await code.click();
          const download = page.waitForEvent("download");
          await page
            .getByRole("menuitem", { name: "下载代码", exact: true })
            .click();
          expect((await download).suggestedFilename()).toBe("code.ts");
          await page.locator(".codex-native-table").hover();
          await table.click({ timeout: 5000 });
          await expect(
            page.getByRole("menuitem", { name: "复制 · TSV", exact: true }),
          ).toBeVisible();
          await page.keyboard.press("Escape");
          await expect(page.getByRole("menu")).toHaveCount(0);
          await expect
            .poll(() => page.evaluate(() => document.body.style.pointerEvents))
            .not.toBe("none");
        }
      } finally {
        const fences = await page
          .evaluate(() => ({
            bodyPointerEvents: document.body.style.pointerEvents,
            triggers: [
              ...document.querySelectorAll(
                '[data-slot="dropdown-menu-trigger"]',
              ),
            ].map((n) => n.outerHTML),
            layers: [
              ...document.querySelectorAll('[data-slot$="-content"]'),
            ].map((n) => n.outerHTML.slice(0, 600)),
          }))
          .catch((error) => ({ diagnosticError: String(error) }));
        await writeFile(
          info.outputPath("menu-fences.json"),
          JSON.stringify(fences, null, 2),
        );
      }
    });
  }
