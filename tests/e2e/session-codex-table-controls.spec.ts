import { expect, test, type Locator, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { setup } from "./session-composer-v2-fixture";
import { renderNativeMarkdownReference } from "./session-native-markdown-reference";

const reference = process.env.CODEX_NATIVE_REFERENCE_URL;
const tableText =
  "| Name | Value | Link | MoreOne | MoreTwo | MoreThree |\n|---|---|---|---|---|---|\n| **one** | `code` | [Open](https://example.com) | long_unbroken_cell_value_one | long_unbroken_cell_value_two | long_unbroken_cell_value_three |\n| second | 123456 | plain | another_long_unbroken_value | more_long_unbroken_value | final_long_unbroken_value |";
const text = `Table controls.\n\n${tableText}\n\nAfter table.`;

async function clipboardProbe(page: Page) {
  await page.evaluate(() => {
    const w = window as any;
    w.tableCopies = [];
    w.ClipboardItem = class {
      constructor(public data: Record<string, Blob>) {}
    };
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        write: (items: any[]) => {
          w.tableCopies.push(items);
          return new Promise<void>((resolve) => {
            w.finishTableCopy = resolve;
          });
        },
        writeText: (text: string) => {
          w.tableCopies.push(text);
          return new Promise<void>((resolve) => {
            w.finishTableCopy = resolve;
          });
        },
      },
    });
  });
}
async function clipboardContents(page: Page) {
  return page.evaluate(async () => {
    const data = (window as any).tableCopies[0][0].data;
    return Object.fromEntries(
      await Promise.all(
        Object.entries(data).map(async ([key, value]) => [
          key,
          await (value as Blob).text(),
        ]),
      ),
    );
  });
}
async function tooltip(element: Locator) {
  return element.evaluate((e) => {
    const s = getComputedStyle(e),
      r = e.getBoundingClientRect();
    return {
      text: [...e.childNodes]
        .filter(
          (n) =>
            !(n instanceof Element && n.getAttribute("role") === "tooltip"),
        )
        .map((n) => n.textContent)
        .join(""),
      width: r.width,
      height: r.height,
      padding: s.padding,
      radius: s.borderRadius,
      color: s.color,
      background: s.backgroundColor,
      side: e.getAttribute("data-side"),
      paintedArrows: [...e.querySelectorAll("svg")].filter(
        (svg) => svg.getBoundingClientRect().width > 0,
      ).length,
    };
  });
}
async function fades(scroller: Locator, original: boolean) {
  return scroller.evaluate((e, original) => {
    const s = getComputedStyle(e);
    return {
      left: s
        .getPropertyValue(original ? "--left-fade" : "--codex-table-left-fade")
        .trim(),
      right: s
        .getPropertyValue(
          original ? "--right-fade" : "--codex-table-right-fade",
        )
        .trim(),
      timeline: s.animationTimeline,
    };
  }, original);
}
async function glyph(button: Locator) {
  return button
    .locator("svg")
    .evaluateAll((svg) =>
      svg
        .filter((e) => e.getBoundingClientRect().width > 0)
        .flatMap((e) =>
          [...e.querySelectorAll("path")].map((p) => p.getAttribute("d")),
        ),
    );
}

for (const width of [390, 700])
  test.describe(`native table controls ${width}`, () => {
    test.use({
      viewport: { width, height: 1000 },
      isMobile: width === 390,
      hasTouch: width === 390,
    });
    for (const theme of ["dark", "light"])
      test(`scroll copy tooltip and rich clipboard match original (${theme})`, async ({
        page,
      }, info) => {
        test.skip(!reference, "Set original native webview reference URL");
        test.setTimeout(90000);
        const f = await setup(page, false),
          native = await page.context().newPage();
        let finishFavicon!: () => void;
        const faviconReady = new Promise<void>((resolve) => {
          finishFavicon = resolve;
        });
        await page
          .context()
          .route("https://t0.gstatic.com/faviconV2*", async (route) => {
            await faviconReady;
            await route.fulfill({
              contentType: "image/svg+xml",
              body: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" rx="2" fill="#7c4dff"/></svg>',
            });
          });
        try {
          f.fixture.threads[0].turns = [
            {
              id: "table",
              status: "completed",
              items: [
                {
                  type: "agentMessage",
                  id: "table-message",
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
          await page.locator(".codex-native-table").waitFor();
          await page.locator(".codex-markdown").evaluate((e, width) => {
            (e as HTMLElement).style.width = `${width === 390 ? 356 : 584}px`;
          }, width);
          await renderNativeMarkdownReference(
            native,
            reference!,
            text,
            theme,
            width,
          );
          const productTable = page.locator(".codex-native-table"),
            nativeTable = native.locator("[data-markdown-table]");
          const productScroller = page.locator(".codex-native-table-scroller"),
            nativeScroller = nativeTable.locator('[role="region"]');
          const copy = productTable.getByRole("button", {
              name: "复制表格",
              exact: true,
            }),
            nativeCopy = nativeTable.getByRole("button", {
              name: "复制表格",
              exact: true,
            });
          const tableStyles = await Promise.all(
            [productTable, nativeTable].map((t) =>
              t.locator("table,th,td").evaluateAll((es) =>
                es.map((e) => {
                  const style = getComputedStyle(e);
                  return {
                    tag: e.tagName,
                    text: e.textContent,
                    width: e.getBoundingClientRect().width,
                    height: e.getBoundingClientRect().height,
                    wrap: style.overflowWrap,
                    wordBreak: style.wordBreak,
                    whiteSpace: style.whiteSpace,
                    display: style.display,
                    verticalAlign: style.verticalAlign,
                    maxWidth: style.maxWidth,
                    minWidth: style.minWidth,
                    colSize: e.getAttribute("data-col-size"),
                    direction: e.getAttribute("dir"),
                  };
                }),
              ),
            ),
          );
          await writeFile(
            info.outputPath("table-style.json"),
            JSON.stringify(tableStyles, null, 2),
          );
          await writeFile(
            info.outputPath("inline-style.json"),
            JSON.stringify(
              await Promise.all(
                [productTable, nativeTable].map((t) =>
                  t
                    .locator(
                      "td a, td code, td [data-md-copy=inline-code], td [class*=InlineCode], td [class*=IconContainer], td .codex-native-link-icon, td [class*=Favicon], td .codex-native-favicon",
                    )
                    .evaluateAll((es) =>
                      es.map((e) => {
                        const s = getComputedStyle(e);
                        return {
                          html: e.outerHTML,
                          width: e.getBoundingClientRect().width,
                          height: e.getBoundingClientRect().height,
                          font: s.font,
                          spacing: s.letterSpacing,
                          weight: s.fontWeight,
                          fontSize: s.fontSize,
                          family: s.fontFamily,
                          color: s.color,
                          padding: s.padding,
                          line: s.lineHeight,
                          verticalAlign: s.verticalAlign,
                          border: s.border,
                          margin: s.margin,
                          display: s.display,
                        };
                      }),
                    ),
                ),
              ),
              null,
              2,
            ),
          );
          const fontProbes = [];
          for (const [target, selector] of [
            [page, "td code"],
            [native, "[data-markdown-copy=inline-code]"],
          ] as const) {
            const cdp = await target.context().newCDPSession(target);
            await cdp.send("DOM.enable");
            await cdp.send("CSS.enable");
            const { root } = await cdp.send("DOM.getDocument");
            const { nodeId } = await cdp.send("DOM.querySelector", {
              nodeId: root.nodeId,
              selector,
            });
            fontProbes.push(
              await cdp.send("CSS.getPlatformFontsForNode", { nodeId }),
            );
            await cdp.detach();
          }
          await writeFile(
            info.outputPath("platform-fonts.json"),
            JSON.stringify(fontProbes, null, 2),
          );
          expect(tableStyles[0]).toEqual(tableStyles[1]);
          const linkIcons = await Promise.all(
            [productTable, nativeTable].map((t) =>
              t.locator("td a svg").evaluate((e) => {
                const r = e.getBoundingClientRect(),
                  cell = e.closest("td")!.getBoundingClientRect();
                return {
                  x: r.x - cell.x,
                  y: r.y - cell.y,
                  width: r.width,
                  height: r.height,
                  paths: [...e.querySelectorAll("path")].map((p) =>
                    p.getAttribute("d"),
                  ),
                };
              }),
            ),
          );
          await writeFile(
            info.outputPath("link-icons.json"),
            JSON.stringify(linkIcons, null, 2),
          );
          expect(linkIcons[0]).toEqual(linkIcons[1]);
          const linkColors = await Promise.all(
            [productTable, nativeTable].map((t) =>
              t.locator("td a > span").evaluate((e) => ({
                color: getComputedStyle(e).color,
                weight: getComputedStyle(e).fontWeight,
              })),
            ),
          );
          await writeFile(
            info.outputPath("link-colors.json"),
            JSON.stringify(linkColors, null, 2),
          );
          expect(linkColors[0]).toEqual(linkColors[1]);
          for (const scroller of [productScroller, nativeScroller]) {
            expect(
              await scroller.evaluate((e) => {
                const event = new KeyboardEvent("keydown", {
                  key: "ArrowRight",
                  bubbles: true,
                  cancelable: true,
                });
                e.dispatchEvent(event);
                return event.defaultPrevented;
              }),
            ).toBe(false);
          }
          await nativeTable.hover();
          await productTable.hover();
          await nativeCopy.hover();
          await native.getByRole("tooltip").waitFor();
          await copy.hover();
          await page.getByRole("tooltip").waitFor();
          const originalTooltip = await tooltip(native.getByRole("tooltip")),
            productTooltip = await tooltip(
              page.locator("[data-slot=tooltip-content]"),
            );
          await writeFile(
            info.outputPath("tooltip.json"),
            JSON.stringify({ originalTooltip, productTooltip }, null, 2),
          );
          await native.screenshot({
            path: info.outputPath(`native-tooltip-${width}-${theme}.png`),
          });
          await page.screenshot({
            path: info.outputPath(`product-tooltip-${width}-${theme}.png`),
          });
          expect(productTooltip).toEqual(originalTooltip);
          if (width === 700) {
            for (const target of [page, native])
              await target.evaluate(() =>
                document.documentElement.style.setProperty(
                  "--vscode-list-hoverBackground",
                  "#4e5135",
                ),
              );
            const customHover = await Promise.all(
              [copy, nativeCopy].map((button) =>
                button.evaluate((e) => getComputedStyle(e).backgroundColor),
              ),
            );
            await writeFile(
              info.outputPath("custom-hover.json"),
              JSON.stringify(customHover),
            );
            await page.screenshot({
              path: info.outputPath(`product-custom-hover-${theme}.png`),
            });
            await native.screenshot({
              path: info.outputPath(`native-custom-hover-${theme}.png`),
            });
            expect(customHover[0]).toBe(customHover[1]);
            expect(customHover[0]).toBe("rgb(78, 81, 53)");
            for (const target of [page, native])
              await target.evaluate(() =>
                document.documentElement.style.removeProperty(
                  "--vscode-list-hoverBackground",
                ),
              );
          }
          expect(await glyph(copy)).toEqual(await glyph(nativeCopy));
          expect(await copy.getAttribute("title")).toBeNull();
          const fadeSamples = [];
          for (const position of ["start", "middle", "end"] as const) {
            for (const scroller of [productScroller, nativeScroller])
              await scroller.evaluate((e, position) => {
                e.scrollLeft =
                  position === "start"
                    ? 0
                    : position === "end"
                      ? e.scrollWidth
                      : (e.scrollWidth - e.clientWidth) / 2;
              }, position);
            await page.waitForTimeout(100);
            const product = await fades(productScroller, false),
              original = await fades(nativeScroller, true);
            fadeSamples.push({ position, product, original });
            await writeFile(
              info.outputPath("fades.json"),
              JSON.stringify(fadeSamples, null, 2),
            );
            await writeFile(
              info.outputPath("scroll-style.json"),
              JSON.stringify(
                await Promise.all(
                  [productScroller, nativeScroller].map((s) =>
                    s.evaluate((e) => {
                      const s = getComputedStyle(e);
                      return {
                        width: e.clientWidth,
                        scrollWidth: e.scrollWidth,
                        duration: s.animationDuration,
                        animation: s.animation,
                        animations: e.getAnimations().map((a) => ({
                          state: a.playState,
                          time: String(a.currentTime),
                          timing: a.effect?.getComputedTiming(),
                        })),
                      };
                    }),
                  ),
                ),
                null,
                2,
              ),
            );
            expect(product).toEqual(original);
            await nativeTable.screenshot({
              path: info.outputPath(
                `native-scroll-${position}-${width}-${theme}.png`,
              ),
            });
            await productTable.screenshot({
              path: info.outputPath(
                `product-scroll-${position}-${width}-${theme}.png`,
              ),
            });
          }
          await writeFile(
            info.outputPath("fades.json"),
            JSON.stringify(fadeSamples, null, 2),
          );
          for (const [scroller, button] of [
            [productScroller, copy],
            [nativeScroller, nativeCopy],
          ]) {
            await scroller.evaluate((e) => {
              e.scrollLeft = 0;
            });
            await button.focus();
            await button.press("ArrowRight");
            await expect
              .poll(() => scroller.evaluate((e) => e.scrollLeft))
              .toBe(40);
            await button.evaluate((e) => {
              Object.defineProperty(navigator, "platform", {
                configurable: true,
                value: "Linux x86_64",
              });
              e.dispatchEvent(
                new KeyboardEvent("keydown", {
                  key: "ArrowRight",
                  altKey: true,
                  bubbles: true,
                  cancelable: true,
                }),
              );
            });
            expect(await scroller.evaluate((e) => e.scrollLeft)).toBe(40);
            const clientWidth = await scroller.evaluate((e) => e.clientWidth);
            await button.evaluate((e) => {
              Object.defineProperty(navigator, "platform", {
                configurable: true,
                value: "MacIntel",
              });
              e.dispatchEvent(
                new KeyboardEvent("keydown", {
                  key: "ArrowRight",
                  altKey: true,
                  bubbles: true,
                  cancelable: true,
                }),
              );
            });
            const maximum = await scroller.evaluate(
              (e) => e.scrollWidth - e.clientWidth,
            );
            await expect
              .poll(() => scroller.evaluate((e) => e.scrollLeft))
              .toBe(Math.min(40 + clientWidth, maximum));
          }
          await clipboardProbe(page);
          await clipboardProbe(native);
          await nativeCopy.click();
          await copy.click();
          for (const [target, button] of [
            [page, copy],
            [native, nativeCopy],
          ] as const) {
            await expect(button).toHaveAttribute("aria-busy", "true");
            await expect(button).toHaveAttribute("aria-disabled", "true");
            await button.dispatchEvent("click");
            expect(
              await target.evaluate(() => (window as any).tableCopies.length),
            ).toBe(1);
          }
          await native.screenshot({
            path: info.outputPath(`native-pending-${width}-${theme}.png`),
          });
          await page.screenshot({
            path: info.outputPath(`product-pending-${width}-${theme}.png`),
          });
          // Icon decoding changes UI DOM while the captured table content stays the same.
          finishFavicon();
          for (const table of [productTable, nativeTable])
            await expect(table.locator('td a img[alt=""]')).toHaveCSS(
              "opacity",
              "1",
            );
          const originalClipboard = await clipboardContents(native),
            productClipboard = await clipboardContents(page);
          await writeFile(
            info.outputPath("clipboard.json"),
            JSON.stringify({ originalClipboard, productClipboard }, null, 2),
          );
          expect(productClipboard).toEqual(originalClipboard);
          expect(productClipboard["text/plain"]).toBe(tableText);
          for (const target of [page, native])
            await target.evaluate(() => (window as any).finishTableCopy());
          const copied = productTable.getByRole("button", {
              name: "已复制",
              exact: true,
            }),
            nativeCopied = nativeTable.getByRole("button", {
              name: "已复制",
              exact: true,
            });
          await expect(copied).toBeVisible();
          await expect(nativeCopied).toBeVisible();
          expect(await glyph(copied)).toEqual(await glyph(nativeCopied));
          await copied.click();
          await nativeCopied.click();
          const copiedStyles = await Promise.all(
            [copied, nativeCopied].map((b) =>
              b.evaluate((e) => {
                const s = getComputedStyle(e);
                return {
                  focusVisible: e.matches(":focus-visible"),
                  hovered: e.matches(":hover"),
                  color: s.color,
                  background: s.backgroundColor,
                  outline: s.outlineWidth === "0px" ? "none" : s.outline,
                  shadow: s.boxShadow
                    .replace(
                      /(?:rgba?|color)\([^)]*\) 0px 0px 0px 0px,? ?/g,
                      "",
                    )
                    .replace(/, $/, ""),
                };
              }),
            ),
          );
          await writeFile(
            info.outputPath("copied-style.json"),
            JSON.stringify(copiedStyles, null, 2),
          );
          expect(copiedStyles[0]).toEqual(copiedStyles[1]);
          for (const target of [page, native])
            expect(
              await target.evaluate(() => (window as any).tableCopies.length),
            ).toBe(1);
          await native.screenshot({
            path: info.outputPath(`native-copied-${width}-${theme}.png`),
          });
          await page.screenshot({
            path: info.outputPath(`product-copied-${width}-${theme}.png`),
          });
          await productTable
            .getByRole("button", { name: "表格更多操作" })
            .click();
          await expect(
            page.getByRole("menuitem", { name: "下载 · CSV" }),
          ).toBeVisible();
          await expect(
            page.getByRole("menuitem", { name: "复制 · TSV" }),
          ).toBeVisible();
          await page.screenshot({
            path: info.outputPath(`product-exports-${width}-${theme}.png`),
          });
          await page.keyboard.press("Escape");
          finishFavicon();
          for (const [table, scroller] of [
            [productTable, productScroller],
            [nativeTable, nativeScroller],
          ]) {
            await scroller.evaluate((e) => {
              e.scrollLeft = 0;
            });
            await expect(table.locator('td a img[alt=""]')).toHaveCSS(
              "opacity",
              "1",
            );
          }
          await nativeTable.screenshot({
            path: info.outputPath(
              `native-favicon-loaded-${width}-${theme}.png`,
            ),
          });
          await productTable.screenshot({
            path: info.outputPath(
              `product-favicon-loaded-${width}-${theme}.png`,
            ),
          });
          expect(f.errors).toEqual([]);
          expect(f.calls).toEqual([]);
        } finally {
          finishFavicon();
          await native.close();
          await f.close();
        }
      });
  });
