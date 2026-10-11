import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { setup } from "./session-composer-v2-fixture";
import { renderNativeMarkdownReference } from "./session-native-markdown-reference";

const reference = process.env.CODEX_NATIVE_REFERENCE_URL;
const text = [
  "[Website](https://example.com/contact?x=1&oai_link_source=model_response_hotline#help)",
  "[Call](tel:+12025550123?oai_link_source=model_response_hotline)",
  "[Text](sms:+12025550123?body=hello%20world&oai_link_source=model_response_hotline)",
  "[Unmarked](https://example.com?x=oai_link_source=model_response_hotline)",
].join("\n\n");
for (const width of [390, 700])
  test.describe(`native hotline ${width}`, () => {
    test.use({
      viewport: { width, height: 900 },
      isMobile: width === 390,
      hasTouch: width === 390,
    });
    for (const theme of ["dark", "light"])
      test(`actual website call and SMS link targets (${theme})`, async ({
        page,
      }, info) => {
        test.skip(!reference, "Set original native component reference URL");
        test.setTimeout(90000);
        const f = await setup(page, false),
          native = await page.context().newPage();
        try {
          f.fixture.threads[0].turns = [
            {
              id: "hotline",
              status: "completed",
              items: [
                {
                  type: "agentMessage",
                  id: "hotline-msg",
                  phase: "final_answer",
                  text,
                },
              ],
            },
          ] as never;
          await page.evaluate(
            (theme) =>
              localStorage.setItem(
                "kanban.session.theme-storage",
                JSON.stringify({
                  version: 1,
                  state: { theme, accent: "default" },
                }),
              ),
            theme,
          );
          await page.reload({ waitUntil: "domcontentloaded" });
          await renderNativeMarkdownReference(
            native,
            reference!,
            text,
            theme,
            width,
          );
          const snapshots = [];
          for (const name of ["Website", "Call", "Text", "Unmarked"]) {
            const product = page
              .locator(".codex-markdown")
              .getByRole("link", { name, exact: true });
            const original = native.getByRole("link", { name, exact: true });
            const ph = await product.getAttribute("href"),
              nh = await original.getAttribute("href");
            snapshots.push({ name, product: ph, original: nh });
            expect(ph).toBe(nh);
            const glyphs = await Promise.all(
              [product, original].map((link) =>
                link
                  .locator("svg")
                  .evaluateAll((es) =>
                    es.flatMap((e) =>
                      [...e.querySelectorAll("path")].map((p) =>
                        p.getAttribute("d"),
                      ),
                    ),
                  ),
              ),
            );
            expect(glyphs[0]).toEqual(glyphs[1]);
          }
          await writeFile(
            info.outputPath("native-targets.json"),
            JSON.stringify(snapshots, null, 2),
          );
          await page.screenshot({
            path: info.outputPath(`product-links-${width}-${theme}.png`),
          });
          await native.screenshot({
            path: info.outputPath(`native-links-${width}-${theme}.png`),
          });
          for (const name of ["Call", "Text"]) {
            const product = page
              .locator(".codex-markdown")
              .getByRole("link", { name, exact: true });
            const original = native.getByRole("link", { name, exact: true });
            await original.hover();
            await native.getByRole("tooltip").waitFor();
            await product.hover();
            await page.getByRole("tooltip").waitFor();
            expect(await page.getByRole("tooltip").innerText()).toContain(
              await native.getByRole("tooltip").innerText(),
            );
            await page.screenshot({
              path: info.outputPath(`product-${name}-${width}-${theme}.png`),
            });
            await native.screenshot({
              path: info.outputPath(`native-${name}-${width}-${theme}.png`),
            });
            await page.keyboard.press("Escape");
            await native.keyboard.press("Escape");
          }
          expect(f.errors).toEqual([]);
          expect(f.calls).toEqual([]);
        } finally {
          await native.close();
          await f.close();
        }
      });
  });
