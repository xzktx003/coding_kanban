import { expect, test } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";

for (const width of [1280, 390]) {
  for (const reducedMotion of ["no-preference", "reduce"] as const) {
    test.describe(`model motion ${width} ${reducedMotion}`, () => {
      test.use({
        viewport: { width, height: 1000 },
        hasTouch: width === 390,
        isMobile: width === 390,
      });
      test("uses the native entry motion and system preference without changing its draft", async ({
        page,
      }, info) => {
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        const fixture = await installSessionUxFixture(page, 0);
        try {
          // reducedMotion is a browser context option, not a Playwright Test
          // top-level fixture. Confirm the actual media state before navigating.
          await page.emulateMedia({ reducedMotion });
          const configuredReduced = await page.evaluate(
            () => matchMedia("(prefers-reduced-motion: reduce)").matches,
          );
          writeFileSync(
            info.outputPath("media-precondition.json"),
            JSON.stringify({ reducedMotion, configuredReduced }, null, 2),
          );
          expect(configuredReduced).toBe(reducedMotion === "reduce");
          await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
          const editor = page
            .locator(".session-codex-composer [contenteditable=true]")
            .first();
          await editor.waitFor();
          await seedSessionUx(page, 0);
          await editor.fill("动效切换不能发送或清除草稿");
          await page.locator(".session-native-model-trigger").press("Enter");
          const menu = page.locator(".session-native-model-menu");
          await expect(menu).toBeVisible();
          await menu.evaluate(async (element) => {
            await Promise.all(
              element
                .getAnimations()
                .map((animation) => animation.finished.catch(() => {})),
            );
          });
          const measured = await menu.evaluate((element) => {
            const style = getComputedStyle(element),
              box = element.getBoundingClientRect();
            const animation = element
              .getAnimations()
              .find((a) => a instanceof CSSAnimation) as
              | (CSSAnimation & { effect: KeyframeEffect | null })
              | undefined;
            return {
              width: box.width,
              height: box.height,
              cssWidth: style.width,
              minWidth: style.minWidth,
              maxWidth: style.maxWidth,
              radius: style.borderRadius,
              padding: style.padding,
              animationName: style.animationName,
              duration: style.animationDuration,
              delay: style.animationDelay,
              easing: style.animationTimingFunction,
              fill: style.animationFillMode,
              keyframes:
                animation?.effect?.getKeyframes().map((frame) => ({
                  opacity: frame.opacity,
                  transform: frame.transform,
                })) ?? [],
              activeContainerAnimations: element
                .getAnimations()
                .filter((item) => item.playState === "running" || item.pending)
                .length,
              reduced: matchMedia("(prefers-reduced-motion: reduce)").matches,
              horizontalOverflow:
                document.documentElement.scrollWidth > window.innerWidth,
            };
          });
          await page.screenshot({
            path: info.outputPath("model-menu-motion.png"),
          });
          await page.keyboard.press("Escape");
          await expect(menu).toHaveCount(0);
          await expect(editor).toBeFocused();
          const bodyPointer = await page.evaluate(
            () => getComputedStyle(document.body).pointerEvents,
          );
          const executing = fixture.calls.filter((c) =>
            /\/(?:turn\/(?:start|steer|interrupt)|thread\/(?:start|resume|fork)|followups\/submit|goal\/(?:set|clear))$/.test(
              c.path,
            ),
          );
          writeFileSync(
            info.outputPath("model-menu-motion.json"),
            JSON.stringify(
              {
                width,
                reducedMotion,
                measured,
                bodyPointer,
                errors,
                executing,
              },
              null,
              2,
            ),
          );
          expect(measured.horizontalOverflow).toBe(false);
          expect(bodyPointer).toBe("auto");
          expect(executing).toEqual([]);
          expect(errors).toEqual([]);
          expect(measured.reduced).toBe(reducedMotion === "reduce");
          await expect(editor).toHaveText("动效切换不能发送或清除草稿");
          // Current enhanced lCa/uca width: 63.5 * the shared 4px spacing unit.
          // The 224px legacy trigger branch is not this product's power picker.
          expect.soft(measured.width).toBeCloseTo(254, 2);
          expect.soft(measured.minWidth).toBe("0px");
          expect.soft(measured.radius).toBe("20px");
          expect.soft(measured.padding).toBe("0px");
          if (reducedMotion === "reduce") {
            expect(measured.animationName).toBe("none");
            // The shared accessibility base keeps an inactive 0.01ms duration.
            // Native reduced motion means no animation, regardless of that
            // inert longhand value; verify browser animation objects directly.
            expect(measured.keyframes).toEqual([]);
            expect(measured.activeContainerAnimations).toBe(0);
          } else {
            // Current original ModelPicker CSS: .32s / 30ms / cubic-bezier;
            // its scoped keyframes fade and scale from .98 without a slide.
            expect(measured.duration).toBe("0.32s");
            expect(measured.delay).toBe("0.03s");
            expect(measured.easing).toBe("cubic-bezier(0.23, 1, 0.32, 1)");
            expect(measured.fill).toBe("both");
            expect(measured.keyframes).toEqual([
              { opacity: "0", transform: "scale(0.98)" },
              { opacity: "1", transform: "scale(1)" },
            ]);
          }
        } finally {
          // Retain the isolated API/WS routes until all product consumers stop.
          await page.goto("about:blank");
        }
      });
    });
  }
}
