import { expect, test, type Locator } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { setup } from "./session-composer-v2-fixture";
import { renderNativeMarkdownReference } from "./session-native-markdown-reference";
const reference = process.env.CODEX_NATIVE_REFERENCE_URL;
const href = "https://example.com/path?q=one";
const longHref = "https://example.com/" + "x".repeat(220);
const text = `[Open](${href})\n\n[Long](${longHref})`;
async function metrics(tooltip: Locator, link: Locator) {
  const target = (await link.boundingBox())!;
  return tooltip.evaluate((e, target) => {
    const s = getComputedStyle(e),
      r = e.getBoundingClientRect();
    const leaf =
      document.createTreeWalker(e, NodeFilter.SHOW_TEXT).nextNode()
        ?.parentElement ?? e;
    const leafStyle = getComputedStyle(leaf);
    return {
      text: [...e.childNodes]
        .filter(
          (n) =>
            !(n instanceof Element && n.getAttribute("role") === "tooltip"),
        )
        .map((n) => n.textContent)
        .join(""),
      side: e.getAttribute("data-side"),
      gap:
        e.getAttribute("data-side") === "top"
          ? target.y - r.bottom
          : r.top - target.y - target.height,
      width: r.width,
      height: r.height,
      left: r.left,
      padding: s.padding,
      radius: s.borderRadius,
      borderColor: s.borderColor,
      // Tailwind expands four invisible, zero-size shadow slots before the
      // actual native shadow. Compare only the painted result.
      shadow: s.boxShadow.replace(/rgba\(0, 0, 0, 0\) 0px 0px 0px 0px, ?/g, ""),
      background: s.backgroundColor,
      color: s.color,
      textColor: leafStyle.color,
      textFill: leafStyle.getPropertyValue("-webkit-text-fill-color"),
      smoothing: leafStyle.getPropertyValue("-webkit-font-smoothing"),
      textShadow: leafStyle.textShadow,
      textStroke: leafStyle.getPropertyValue("-webkit-text-stroke"),
      textRendering: leafStyle.textRendering,
      letterSpacing: leafStyle.letterSpacing,
      font: s.fontSize,
      weight: s.fontWeight,
      line: s.lineHeight,
      paintedArrows: [...e.querySelectorAll("svg")].filter(
        (svg) => svg.getBoundingClientRect().width > 0,
      ).length,
    };
  }, target);
}
for (const width of [390, 700])
  test.describe(`native link ${width}`, () => {
    test.use({
      viewport: { width, height: 900 },
      hasTouch: width === 390,
      isMobile: width === 390,
    });
    for (const theme of ["dark", "light"])
      test(`URL tooltip hover focus and dismissal (${theme})`, async ({
        page,
      }, info) => {
        test.skip(!reference, "Set original native reference URL");
        test.setTimeout(90000);
        const f = await setup(page, false),
          native = await page.context().newPage();
        try {
          f.fixture.threads[0].turns = [
            {
              id: "link",
              status: "completed",
              items: [
                {
                  type: "agentMessage",
                  id: "link-msg",
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
          await renderNativeMarkdownReference(
            native,
            reference!,
            text,
            theme,
            width,
          );
          const link = page
              .locator(".codex-markdown")
              .getByRole("link", { name: "Open" }),
            nativeLink = native.getByRole("link", { name: "Open" });
          const productBox = (await link.boundingBox())!,
            nativeBox = (await nativeLink.boundingBox())!;
          await native.locator("#root").evaluate(
            (e, offset) => {
              (e as HTMLElement).style.transform =
                `translate(${offset.x}px, ${offset.y}px)`;
            },
            { x: productBox.x - nativeBox.x, y: productBox.y - nativeBox.y },
          );
          await nativeLink.hover();
          await native.getByRole("tooltip").waitFor();
          await link.hover();
          await page.getByRole("tooltip").waitFor({ timeout: 3000 });
          const original = await metrics(
              native.getByRole("tooltip"),
              nativeLink,
            ),
            product = await metrics(
              page.locator("[data-slot=tooltip-content]"),
              link,
            );
          await writeFile(
            info.outputPath("url-tooltip.json"),
            JSON.stringify({ original, product }, null, 2),
          );
          await native.screenshot({
            path: info.outputPath(`native-hover-${width}-${theme}.png`),
          });
          await page.screenshot({
            path: info.outputPath(`product-hover-${width}-${theme}.png`),
          });
          expect(product).toEqual(original);
          expect(await link.getAttribute("href")).toBe(
            await nativeLink.getAttribute("href"),
          );
          expect(await link.getAttribute("title")).toBeNull();
          const focusStyles = [];
          for (const [target, anchor] of [
            [page, link],
            [native, nativeLink],
          ] as const) {
            await target.keyboard.press("Escape");
            await expect(target.getByRole("tooltip")).not.toBeVisible();
            await target.mouse.move(0, 0);
            await anchor.focus();
            await expect(target.getByRole("tooltip")).toBeVisible();
            const focus = await anchor.evaluate((e) => {
              const child = e.firstElementChild!,
                s = getComputedStyle(e),
                c = getComputedStyle(child);
              return {
                focused: e.matches(":focus-visible"),
                outline: s.outlineWidth === "0px" ? "none" : s.outline,
                childShadow: c.boxShadow,
                childRadius: c.borderRadius,
                childColor: c.color,
              };
            });
            focusStyles.push(focus);
            await writeFile(
              info.outputPath(
                `${target === page ? "product" : "native"}-focus-style.json`,
              ),
              JSON.stringify(focus, null, 2),
            );
            await target.screenshot({
              path: info.outputPath(
                `${target === page ? "product" : "native"}-focus-${width}-${theme}.png`,
              ),
            });
            await anchor.evaluate((e) => (e as HTMLElement).blur());
            await expect(target.getByRole("tooltip")).not.toBeVisible();
          }
          expect(focusStyles[0]).toEqual(focusStyles[1]);
          const customRings = [];
          for (const [target, anchor] of [
            [page, link],
            [native, nativeLink],
          ] as const) {
            await target.evaluate(() =>
              document.documentElement.style.setProperty(
                "--vscode-focusBorder",
                "#ab1a5f",
              ),
            );
            await anchor.focus();
            customRings.push(
              await anchor
                .locator("xpath=./span")
                .evaluate((e) => getComputedStyle(e).boxShadow),
            );
          }
          expect(customRings[0]).toEqual(customRings[1]);
          expect(customRings[0]).toBe("rgb(171, 26, 95) 0px 0px 0px 2px");
          for (const target of [page, native]) {
            await target.evaluate(() =>
              window.dispatchEvent(new Event("blur")),
            );
            await expect(target.getByRole("tooltip")).not.toBeVisible();
          }
          const longLink = page
              .locator(".codex-markdown")
              .getByRole("link", { name: "Long", exact: true }),
            nativeLong = native.getByRole("link", {
              name: "Long",
              exact: true,
            });
          const longBox = (await longLink.boundingBox())!,
            nativeLongBox = (await nativeLong.boundingBox())!;
          await native.locator("#root").evaluate(
            (e, offset) => {
              (e as HTMLElement).style.transform =
                `translate(${offset.x}px, ${offset.y}px)`;
            },
            {
              x: productBox.x - nativeBox.x + longBox.x - nativeLongBox.x,
              y: productBox.y - nativeBox.y + longBox.y - nativeLongBox.y,
            },
          );
          await nativeLong.hover();
          await native.getByRole("tooltip").waitFor();
          await longLink.hover();
          await page.getByRole("tooltip").waitFor();
          const longOriginal = await metrics(
              native.getByRole("tooltip"),
              nativeLong,
            ),
            longProduct = await metrics(
              page.locator("[data-slot=tooltip-content]"),
              longLink,
            );
          await writeFile(
            info.outputPath("long-url-tooltip.json"),
            JSON.stringify({ longOriginal, longProduct }, null, 2),
          );
          await native.screenshot({
            path: info.outputPath(`native-long-${width}-${theme}.png`),
          });
          await page.screenshot({
            path: info.outputPath(`product-long-${width}-${theme}.png`),
          });
          expect(longProduct).toEqual(longOriginal);
          expect(f.errors).toEqual([]);
          expect(f.calls).toEqual([]);
        } finally {
          await native.close();
          await f.close();
        }
      });
  });
