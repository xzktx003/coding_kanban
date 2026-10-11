import { expect, test, type Locator } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { setup } from "./session-composer-v2-fixture";
import { renderNativeMarkdownReference } from "./session-native-markdown-reference";

const reference = process.env.CODEX_NATIVE_REFERENCE_URL;
const text = "Code controls.\n\n```typescript\nconst example = 42;\n```";
async function tooltipMetrics(element: Locator, trigger: Locator) {
  const target = (await trigger.boundingBox())!;
  return element.evaluate((e, target) => {
    const s = getComputedStyle(e),
      r = e.getBoundingClientRect();
    return {
      text: [...e.childNodes]
        .filter(
          (node) =>
            !(
              node instanceof Element && node.getAttribute("role") === "tooltip"
            ),
        )
        .map((node) => node.textContent)
        .join(""),
      side: e.getAttribute("data-side"),
      gap:
        e.getAttribute("data-side") === "top"
          ? target.y - r.bottom
          : r.top - target.y - target.height,
      width: r.width,
      height: r.height,
      padding: s.padding,
      radius: s.borderRadius,
      border: s.border,
      background: s.backgroundColor,
      color: s.color,
      font: s.fontSize,
      line: s.lineHeight,
      family: s.fontFamily.split(",")[0],
      weight: s.fontWeight,
      letterSpacing: s.letterSpacing,
      shadow: s.boxShadow.replace(
        /rgba\(0, 0, 0, 0\) 0px 0px 0px 0px,? ?/g,
        "",
      ),
      animation: s.animationName,
      paintedArrows: [...e.querySelectorAll("svg")].filter((svg) => {
        const box = svg.getBoundingClientRect();
        return box.width > 0 && box.height > 0;
      }).length,
    };
  }, target);
}
async function focusMetrics(button: Locator) {
  return button.evaluate((e) => {
    const s = getComputedStyle(e);
    return {
      focused: e.matches(":focus-visible"),
      color: s.color,
      outline: s.outlineWidth === "0px" ? "none" : s.outline,
      shadow: s.boxShadow
        .replace(/(?:rgba?|color)\([^)]*\) 0px 0px 0px 0px,? ?/g, "")
        .replace(/, $/, ""),
    };
  });
}

for (const width of [390, 700])
  test.describe(`native code controls ${width}`, () => {
    test.use({
      viewport: { width, height: 900 },
      hasTouch: width === 390,
      isMobile: width === 390,
    });
    for (const theme of ["dark", "light"])
      test(`copy feedback and tooltip match original (${theme})`, async ({
        page,
      }, info) => {
        test.skip(!reference, "Set original native webview reference URL");
        test.setTimeout(90000);
        const f = await setup(page, false),
          native = await page.context().newPage();
        try {
          f.fixture.threads[0].turns = [
            {
              id: "controls",
              status: "completed",
              items: [
                {
                  type: "agentMessage",
                  id: "controls-message",
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
          const copy = page
            .locator(".codex-native-code-fence")
            .getByRole("button", { name: "复制", exact: true });
          await copy.waitFor();
          await renderNativeMarkdownReference(
            native,
            reference!,
            text,
            theme,
            width,
          );
          const nativeCopy = native.getByRole("button", {
            name: "复制",
            exact: true,
          });
          await nativeCopy.waitFor();
          await nativeCopy.focus();
          await copy.focus();
          const nativeFocus = await focusMetrics(nativeCopy),
            productFocus = await focusMetrics(copy);
          await writeFile(
            info.outputPath("keyboard-focus.json"),
            JSON.stringify({ nativeFocus, productFocus }, null, 2),
          );
          await native.screenshot({
            path: info.outputPath(`native-focus-${width}-${theme}.png`),
          });
          await page.screenshot({
            path: info.outputPath(`product-focus-${width}-${theme}.png`),
          });
          expect(productFocus).toEqual(nativeFocus);
          await nativeCopy.hover();
          await native.getByRole("tooltip").waitFor();
          await copy.hover();
          await page.getByRole("tooltip").waitFor();
          const hoverButtons = await Promise.all(
            [nativeCopy, copy].map((b) =>
              b.evaluate((e) => {
                const s = getComputedStyle(e);
                return {
                  color: s.color,
                  background: s.backgroundColor,
                  radius: s.borderRadius,
                  opacity: s.opacity,
                };
              }),
            ),
          );
          await writeFile(
            info.outputPath("hover-buttons.json"),
            JSON.stringify(hoverButtons, null, 2),
          );
          expect(hoverButtons[1]).toEqual(hoverButtons[0]);
          const original = await tooltipMetrics(
              native.getByRole("tooltip"),
              nativeCopy,
            ),
            product = await tooltipMetrics(
              page.locator("[data-slot=tooltip-content]"),
              copy,
            );
          await native.screenshot({
            path: info.outputPath(`native-tooltip-${width}-${theme}.png`),
          });
          await page.screenshot({
            path: info.outputPath(`product-tooltip-${width}-${theme}.png`),
          });
          await writeFile(
            info.outputPath("tooltip-metrics.json"),
            JSON.stringify({ original, product }, null, 2),
          );
          expect(product).toEqual(original);
          expect(await copy.getAttribute("title")).toBeNull();
          await nativeCopy.click();
          const nativeCopied = native.getByRole("button", {
            name: "已复制",
            exact: true,
          });
          await expect(nativeCopied).toBeVisible();
          const copiedGlyph = await nativeCopied
            .locator("svg path")
            .evaluateAll((paths) =>
              paths.map((path) => path.getAttribute("d")),
            );
          await native.screenshot({
            path: info.outputPath(`native-copied-${width}-${theme}.png`),
          });
          await page.evaluate(() => {
            const w = window as any;
            w.copyCalls = [];
            Object.defineProperty(navigator, "clipboard", {
              configurable: true,
              value: {
                writeText: (text: string) => {
                  w.copyCalls.push(text);
                  return new Promise<void>((resolve) => {
                    w.finishCopy = resolve;
                  });
                },
              },
            });
          });
          await copy.click();
          await expect(copy).toHaveAttribute("aria-busy", "true");
          await expect(copy).toHaveAttribute("aria-disabled", "true");
          // Browser clicks honor aria-disabled. Dispatch a second handler event to check the independent protocol guard.
          await copy.dispatchEvent("click");
          expect(await page.evaluate(() => (window as any).copyCalls)).toEqual([
            "const example = 42;",
          ]);
          await page.screenshot({
            path: info.outputPath(`copy-pending-${width}-${theme}.png`),
          });
          await page.evaluate(() => (window as any).finishCopy());
          const copied = page
            .locator(".codex-native-code-fence")
            .getByRole("button", { name: "已复制", exact: true });
          await expect(copied).toBeVisible();
          expect(
            await copied
              .locator("svg path")
              .evaluateAll((paths) =>
                paths.map((path) => path.getAttribute("d")),
              ),
          ).toEqual(copiedGlyph);
          await expect(copied).not.toHaveAttribute("aria-busy", "true");
          await copied.click();
          expect(
            await page.evaluate(() => (window as any).copyCalls),
          ).toHaveLength(1);
          await page.screenshot({
            path: info.outputPath(`copied-${width}-${theme}.png`),
          });
          await expect(copy).toBeVisible();
          await copy.click();
          expect(
            await page.evaluate(() => (window as any).copyCalls),
          ).toHaveLength(2);
          await page.evaluate(() => (window as any).finishCopy());
          expect(f.errors).toEqual([]);
          expect(f.calls).toEqual([]);
        } finally {
          await native.close();
          await f.close();
        }
      });
  });
