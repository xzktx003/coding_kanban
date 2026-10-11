import { expect, test, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { setup } from "./session-composer-v2-fixture";
import { renderNativeMarkdownReference } from "./session-native-markdown-reference";

const reference = process.env.CODEX_NATIVE_REFERENCE_URL;
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="400" height="100" viewBox="0 0 400 100"><defs><rect id="tile" x="0" y="0" width="400" height="100" rx="12" fill="#e7ebf1"/></defs><use xlink:href="#tile"/><circle cx="40" cy="50" r="20" fill="#368ee5"/><text x="80" y="56" font-family="system-ui" font-size="18" fill="#172635">SVG 预览 · 原始代码可复制</text></svg>';
const tallSvg = svg
  .replace('height="100"', 'height="900"')
  .replace('viewBox="0 0 400 100"', 'viewBox="0 0 400 900"');
const inertSvg = svg.replace(
  "</svg>",
  "<script>window.svgExecuted = true</script></svg>",
);
const text =
  "SVG preview.\n\n" +
  ["svg", "xml", "html"]
    .map((language) => `\`\`\`${language}\n${svg}\n\`\`\``)
    .join("\n\n") +
  `\n\n\`\`\`svg\n${tallSvg}\n\`\`\`\n\n\`\`\`svg\n${inertSvg}\n\`\`\``;

async function images(page: Page, original: boolean) {
  return page
    .locator(original ? "#root img" : ".codex-native-code-fence img")
    .evaluateAll((images) =>
      images.map((image) => {
        const img = image as HTMLImageElement,
          rect = img.getBoundingClientRect(),
          s = getComputedStyle(img);
        return {
          alt: img.alt,
          width: rect.width,
          height: rect.height,
          maxHeight: s.maxHeight,
          naturalWidth: img.naturalWidth,
          naturalHeight: img.naturalHeight,
          display: s.display,
          imageRendering: s.imageRendering,
          smoothing: s.getPropertyValue("-webkit-font-smoothing"),
          textRendering: s.textRendering,
          filter: s.filter,
          colorScheme: s.colorScheme,
          fontSize: s.fontSize,
          fontFamily: s.fontFamily.split(",")[0],
          lineHeight: s.lineHeight,
          source: decodeURIComponent(img.src.slice(img.src.indexOf(",") + 1)),
        };
      }),
    );
}

for (const width of [390, 700])
  test.describe(`native SVG ${width}`, () => {
    test.use({
      viewport: { width, height: 1000 },
      isMobile: width === 390,
      hasTouch: width === 390,
    });
    for (const theme of ["dark", "light"])
      test(`SVG XML and HTML preview match original (${theme})`, async ({
        page,
      }, info) => {
        test.skip(!reference, "Set original native webview reference URL");
        test.setTimeout(90000);
        const native = await page.context().newPage(),
          f = await setup(page, false);
        try {
          await renderNativeMarkdownReference(
            native,
            reference!,
            text,
            theme,
            width,
          );
          await expect(native.locator("#root img")).toHaveCount(5);
          await expect
            .poll(() =>
              native
                .locator("#root img")
                .evaluateAll((images) =>
                  images.every(
                    (img) => (img as HTMLImageElement).naturalWidth > 0,
                  ),
                ),
            )
            .toBe(true);
          await native.screenshot({
            path: info.outputPath(`native-${width}-${theme}.png`),
          });
          f.fixture.threads[0].turns = [
            {
              id: "svg-turn",
              status: "completed",
              items: [
                {
                  type: "agentMessage",
                  id: "svg-message",
                  text,
                  phase: "final_answer",
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
          await page.addStyleTag({
            content: `.codex-assistant-content{width:${width === 390 ? 356 : 584}px!important}`,
          });
          await expect(
            page.locator(".codex-native-code-fence img"),
          ).toHaveCount(5);
          await expect
            .poll(() =>
              page
                .locator(".codex-native-code-fence img")
                .evaluateAll((images) =>
                  images.every(
                    (img) => (img as HTMLImageElement).naturalWidth > 0,
                  ),
                ),
            )
            .toBe(true);
          await page.screenshot({
            path: info.outputPath(`product-${width}-${theme}.png`),
          });
          const original = await images(native, true),
            product = await images(page, false);
          await writeFile(
            info.outputPath("svg-metrics.json"),
            JSON.stringify({ original, product }, null, 2),
          );
          const raster: string[] = [];
          for (const [target, selector, prefix] of [
            [page, ".codex-native-code-fence img", "product"],
            [native, "#root img", "native"],
          ] as const) {
            const encoded = await target
              .locator(selector)
              .first()
              .evaluate((image) => {
                const canvas = document.createElement("canvas");
                canvas.width = 400;
                canvas.height = 100;
                canvas
                  .getContext("2d")!
                  .drawImage(image as HTMLImageElement, 0, 0, 400, 100);
                return canvas.toDataURL().split(",")[1];
              });
            await writeFile(
              info.outputPath(`${prefix}-svg-canvas-${width}-${theme}.png`),
              Buffer.from(encoded, "base64"),
            );
            raster.push(encoded);
          }
          expect(raster[0]).toBe(raster[1]);
          expect(product).toEqual(original);
          expect(product[3].height).toBe(384);
          expect(
            await page.evaluate(() => (window as any).svgExecuted),
          ).toBeUndefined();
          expect(
            await native.evaluate(() => (window as any).svgExecuted),
          ).toBeUndefined();
          expect(
            await page.locator(".codex-native-code-fence script").count(),
          ).toBe(0);
          await page.mouse.move(200, 200);
          await page.mouse.wheel(0, -2000);
          await page
            .locator(".codex-native-code-fence")
            .first()
            .screenshot({
              path: info.outputPath(`product-svg-fence-${width}-${theme}.png`),
            });
          await native
            .locator("[class*=CodeBlock]")
            .first()
            .screenshot({
              path: info.outputPath(`native-svg-fence-${width}-${theme}.png`),
            });
          await page
            .locator(".codex-native-code-fence img")
            .first()
            .screenshot({
              path: info.outputPath(`product-svg-image-${width}-${theme}.png`),
            });
          await native
            .locator("#root img")
            .first()
            .screenshot({
              path: info.outputPath(`native-svg-image-${width}-${theme}.png`),
            });
          // Freeze both image origins on CSS pixels for a second comparison.
          // Keep the unnormalized screenshots above; workbench and host shells
          // can position identical image geometry on different subpixel origins.
          for (const [target, selector, prefix] of [
            [page, ".codex-native-code-fence img", "product"],
            [native, "#root img", "native"],
          ] as const) {
            const image = target.locator(selector).first();
            await image.evaluate((image) => {
              const rect = image.getBoundingClientRect();
              (image as HTMLElement).style.transform =
                `translate(${Math.round(rect.x) - rect.x}px, ${Math.round(rect.y) - rect.y}px)`;
            });
            await image.screenshot({
              path: info.outputPath(
                `${prefix}-svg-aligned-${width}-${theme}.png`,
              ),
            });
            await image.evaluate((image) => {
              (image as HTMLElement).style.transform = "";
            });
          }
          await page
            .locator(".codex-native-code-fence")
            .nth(3)
            .screenshot({
              path: info.outputPath(`product-tall-${width}-${theme}.png`),
            });
          await native
            .locator("[class*=CodeBlock]")
            .nth(3)
            .screenshot({
              path: info.outputPath(`native-tall-${width}-${theme}.png`),
            });
          await expect(
            page.getByRole("button", { name: /自动换行/ }),
          ).toHaveCount(0);
          const clipboardApi = await page.evaluate(
            () => typeof navigator.clipboard?.readText === "function",
          );
          if (clipboardApi)
            await page
              .context()
              .grantPermissions(["clipboard-read", "clipboard-write"]);
          else
            await page.evaluate(() => {
              (window as any).httpSvgCopy = null;
              window.addEventListener(
                "copy",
                (event) => {
                  if (event.defaultPrevented)
                    (window as any).httpSvgCopy =
                      event.clipboardData?.getData("text/plain");
                },
                { once: true },
              );
            });
          await page
            .locator(".codex-native-code-fence")
            .first()
            .getByRole("button", { name: "复制", exact: true })
            .click();
          await expect(
            page
              .locator(".codex-native-code-fence")
              .first()
              .getByRole("button", { name: "已复制", exact: true }),
          ).toBeVisible();
          expect(
            await page.evaluate(
              (api) =>
                api
                  ? navigator.clipboard.readText()
                  : (window as any).httpSvgCopy,
              clipboardApi,
            ),
          ).toBe(svg);
          expect(f.errors).toEqual([]);
          expect(f.calls).toEqual([]);
        } finally {
          await native.close();
          await f.close();
        }
      });
  });
