import { expect, test, type Locator } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";

const reference = process.env.CODEX_NATIVE_REFERENCE_URL;

async function measure(menu: Locator, native: boolean, view: string) {
  return menu.evaluate(
    (root, { native, view }) => {
      const origin = root.getBoundingClientRect();
      const rgba = (color: string) => {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 1;
        const context = canvas.getContext("2d")!;
        context.fillStyle = color;
        context.fillRect(0, 0, 1, 1);
        return [...context.getImageData(0, 0, 1, 1).data];
      };
      const props = (element: Element) => {
        const style = getComputedStyle(element),
          rect = element.getBoundingClientRect();
        return {
          width: rect.width,
          height: rect.height,
          x: rect.x - origin.x,
          y: rect.y - origin.y,
          fontSize: style.fontSize,
          lineHeight: style.lineHeight,
          fontWeight: style.fontWeight,
          fontFamily: style.fontFamily,
          fontFlags: {
            weight: style.getPropertyValue("font-synthesis-weight"),
            style: style.getPropertyValue("font-synthesis-style"),
            smallCaps: style.getPropertyValue("font-synthesis-small-caps"),
            webkit: style.getPropertyValue("-webkit-font-smoothing"),
            moz: style.getPropertyValue("-moz-osx-font-smoothing"),
          },
          color: rgba(style.color),
          background: rgba(style.backgroundColor),
          radius: style.borderRadius,
          padding: style.padding,
          borderWidth: style.borderTopWidth,
          borderStyle: style.borderTopStyle,
          borderColor: rgba(style.borderTopColor),
          shadow: style.boxShadow,
          visibleShadow: style.boxShadow
            .replace(/(?:rgba?|color|oklab)\([^)]*\)/g, (value) =>
              rgba(value).join(":"),
            )
            .split(", ")
            .filter((value) => !value.startsWith("0:0:0:0 "))
            .join(", "),
        };
      };
      const query = (original: string, product: string) => {
        const selector = native ? original : product;
        const element = [...root.querySelectorAll(selector)].find(
          (element) => !element.closest("[inert]"),
        );
        if (!element) throw new Error(`Missing visible menu field ${selector}`);
        return props(element);
      };
      return {
        outer: props(root),
        panel: query(
          "[class*='_ViewPanel_']",
          view === "simple"
            ? ".session-native-power-view"
            : ".session-native-model-list",
        ),
        ...(view === "simple"
          ? {
              effort: query(
                "[class*='_ViewToggleEffortLabel_']",
                ".session-native-power-effort",
              ),
              model: query(
                "[class*='_ViewToggleModelLabel_']",
                ".session-native-power-model",
              ),
              chevron: query(
                "[class*='_ViewToggleIcon_']",
                ".session-native-power-chevron",
              ),
              track: query(
                "[class*='_Track_xwb5v_']",
                ".session-native-power-track",
              ),
              thumb: query(
                "[class*='_Thumb_xwb5v_']",
                ".session-native-power-thumb",
              ),
            }
          : {
              heading: query(
                "[class*='_sectionLabel_']",
                ".session-native-model-heading",
              ),
              rows: [...root.querySelectorAll('[role="menuitemradio"]')]
                .filter((element) => !element.closest("[inert]"))
                .map(props),
            }),
      };
    },
    { native, view },
  );
}

for (const theme of ["dark", "light"])
  for (const caseView of ["simple", "advanced", "native-states"])
    test(`enabled model menu same-host source geometry (${theme}, ${caseView})`, async ({
      page,
    }, info) => {
      const stateGate = caseView === "native-states";
      const view = stateGate ? "simple" : caseView;
      test.skip(!reference, "Set enabled original webview reference URL");
      test.setTimeout(60000);
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const native = await page.context().newPage();
      native.on("pageerror", (error) => errors.push(error.message));
      const host =
        theme === "dark"
          ? {
              foreground: "#ccc",
              background: "#20211d",
              secondary: "#282a23",
              description: "#858585",
            }
          : {
              foreground: "#3b3b3b",
              background: "#fff",
              secondary: "#f5f5f3",
              description: "#717171",
            };
      const chartHost = stateGate
        ? {
            "charts-blue": theme === "dark" ? "#569cd6" : "#007acc",
            "charts-purple": theme === "dark" ? "#c586c0" : "#af00db",
          }
        : {};
      const fixture = await installSessionUxFixture(page, 1);
      await page.route(/\/api\/(?:session\/)?codex\/model\/list$/, (route) =>
        route.fulfill({
          json: {
            data: ["fixture-model", "fixture-second"].map((id, index) => ({
              id,
              model: id,
              displayName: index ? "测试模型二" : "测试模型",
              description: "隔离原生菜单模型",
              isDefault: !index,
              hidden: false,
              supportedReasoningEfforts: (index
                ? ["medium", "high"]
                : stateGate
                  ? ["low", "medium", "high", "xhigh", "ultra"]
                  : ["low", "medium", "high"]
              ).map((reasoningEffort) => ({
                reasoningEffort,
                description: reasoningEffort,
              })),
              defaultReasoningEffort: "medium",
              inputModalities: ["text", "image"],
              supportsPersonality: false,
              additionalSpeedTiers: [],
              serviceTiers: index
                ? []
                : [{ id: "fast", name: "快速", description: "使用更多额度" }],
              defaultServiceTier: null,
            })),
            nextCursor: null,
          },
        }),
      );
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
      await page
        .locator(".session-codex-composer [contenteditable=true]")
        .first()
        .waitFor();
      await seedSessionUx(page, 1);
      await page.evaluate(
        async ({ theme, host, chartHost }) => {
          const module = (path: string) =>
            import(
              performance
                .getEntriesByType("resource")
                .findLast((entry) => new URL(entry.name).pathname === path)
                ?.name ?? path
            );
          const { useThreadModelStore, getThreadModelSettings } = await module(
            "/src/session-mode/stores/useThreadModelStore.ts",
          );
          const settings = getThreadModelSettings("ux-0");
          useThreadModelStore.setState((state: any) => ({
            threads: {
              ...state.threads,
              "ux-0": {
                ...settings,
                model: "fixture-model",
                modelProvider: "openai",
                providerModels: {
                  ...settings.providerModels,
                  openai: "fixture-model",
                },
                reasoningEffort: "high",
              },
            },
          }));
          const { useThemeStore } = await module(
            "/src/session-mode/stores/settings/useThemeStore.ts",
          );
          useThemeStore.getState().setTheme(theme);
          for (const [name, value] of Object.entries({
            foreground: host.foreground,
            "editor-background": host.background,
            "sideBar-background": host.secondary,
            "dropdown-background": host.secondary,
            "menu-background": host.secondary,
            descriptionForeground: host.description,
            "font-family": "system-ui",
            ...chartHost,
          }))
            document.documentElement.style.setProperty(
              `--vscode-${name}`,
              value,
            );
        },
        { theme, host, chartHost },
      );
      await native.setViewportSize({ width: 1440, height: 1000 });
      await native.goto(reference!);
      await native.waitForFunction(() => (window as any).nativeLoaded);
      await native.evaluate(
        async ({ theme, host, chartHost, view, stateGate }) => {
          document.documentElement.setAttribute("data-theme", theme);
          for (const [name, value] of Object.entries({
            foreground: host.foreground,
            "editor-background": host.background,
            "sideBar-background": host.secondary,
            "dropdown-background": host.secondary,
            "menu-background": host.secondary,
            descriptionForeground: host.description,
            "font-family": "system-ui",
            ...chartHost,
          }))
            document.documentElement.style.setProperty(
              `--vscode-${name}`,
              value,
            );
          document.body.style.background = host.background;
          if (stateGate) {
            await import(
              /* @vite-ignore */ "./native-model-menu-state-reference.js"
            );
            (window as any).renderNativeModelState({ effort: "high" });
          } else {
            await import(/* @vite-ignore */ "./native-model-menu-reference.js");
            (window as any).renderNativeModelMenu({ view });
          }
        },
        { theme, host, chartHost, view, stateGate },
      );
      const original = native
        .locator('[role="menu"]')
        .filter({ has: native.locator("[data-model-picker-view]") });
      await expect(
        original.locator(`[data-model-picker-view='${view}']`).first(),
      ).toBeVisible();
      if (view === "simple")
        await expect(
          original.locator("[class*='_Track_xwb5v_']"),
        ).toBeVisible();
      else await expect(original.getByRole("menuitemradio")).toHaveCount(2);
      await page.getByRole("button", { name: /^Agent 与模型：/ }).click();
      const product = page.locator(".session-native-model-menu");
      await expect(
        product.getByRole("slider", { name: "推理强度" }),
      ).toBeVisible();
      if (view === "advanced")
        await product
          .getByRole("menuitem", { name: "选择模型", exact: true })
          .click();
      await expect(
        product.locator(`[data-model-picker-view='${view}']`),
      ).toBeVisible();
      await expect
        .poll(() =>
          product.evaluate((element) =>
            element
              .getAnimations({ subtree: true })
              .every(
                (animation) =>
                  animation.playState !== "running" && !animation.pending,
              ),
          ),
        )
        .toBe(true);
      await expect
        .poll(() =>
          product.evaluate((element) => element.getBoundingClientRect().width),
        )
        .toBe(224);
      if (stateGate) {
        const records = [];
        for (const effort of ["high", "xhigh", "ultra"]) {
          await native.evaluate(
            (effort) => (window as any).renderNativeModelState({ effort }),
            effort,
          );
          await page.evaluate(async (effort) => {
            const path = "/src/session-mode/stores/useThreadModelStore.ts";
            const { useThreadModelStore } = await import(
              performance
                .getEntriesByType("resource")
                .findLast((entry) => new URL(entry.name).pathname === path)
                ?.name ?? path
            );
            useThreadModelStore.setState((state: any) => ({
              threads: {
                ...state.threads,
                "ux-0": { ...state.threads["ux-0"], reasoningEffort: effort },
              },
            }));
          }, effort);
          await expect(
            product.getByRole("slider", { name: "推理强度" }),
          ).toHaveAttribute("aria-valuetext", effort);
          const nativeEffort = original.locator(
            "[class*='_ViewToggleEffortLabel_']",
          );
          await expect(nativeEffort).toHaveAttribute("data-accent", "true");
          await expect(nativeEffort).toHaveAttribute(
            "data-maximum",
            String(effort === "ultra"),
          );
          const nativeSource = await native.evaluate(
            () => (window as any).nativeModelStateSource,
          );
          expect(nativeSource.validated).toBe(true);
          expect(
            nativeSource.powerSelections.every(
              (selection: any) => !Object.hasOwn(selection, "isMaximum"),
            ),
          ).toBe(true);
          const a = await measure(original, true, "simple"),
            b = await measure(product, false, "simple");
          records.push({ effort, nativeSource, native: a, product: b });
          expect
            .soft(b.effort!.color, `${effort} original accent/maximum color`)
            .toEqual(a.effort!.color);
          expect
            .soft(
              await product
                .locator(".session-native-power-effort")
                .getAttribute("data-accent"),
            )
            .toBe("true");
          expect
            .soft(
              await product
                .locator(".session-native-power-effort")
                .getAttribute("data-maximum"),
            )
            .toBe(String(effort === "ultra"));
          expect
            .soft(b.outer.fontFlags, "own model portal font flags")
            .toEqual(a.outer.fontFlags);
          expect
            .soft(b.model!.fontFlags, "model label inherited flags")
            .toEqual(a.model!.fontFlags);
          await original.screenshot({
            path: info.outputPath(`native-model-${theme}-${effort}.png`),
          });
          await product.screenshot({
            path: info.outputPath(`product-model-${theme}-${effort}.png`),
          });
        }
        writeFileSync(
          info.outputPath("model-menu-native-state-metrics.json"),
          JSON.stringify({ theme, host, chartHost, records, errors }, null, 2),
        );
        expect(errors).toEqual([]);
        expect(
          fixture.calls.filter((call) =>
            /\/(?:resume|turn\/start|turn\/steer|rollback|fork)$/.test(
              call.path,
            ),
          ),
        ).toEqual([]);
        await native.close();
        return;
      }
      await expect
        .poll(async () => (await measure(original, true, view)).outer.height)
        .toBe(view === "simple" ? 95 : 83);
      const referenceMetrics = await measure(original, true, view);
      const productMetrics = await measure(product, false, view);
      writeFileSync(
        info.outputPath("model-menu-source-metrics.json"),
        JSON.stringify(
          {
            theme,
            view,
            host,
            native: referenceMetrics,
            product: productMetrics,
            errors,
          },
          null,
          2,
        ),
      );
      await original.screenshot({
        path: info.outputPath(`native-model-${theme}-${view}.png`),
      });
      await product.screenshot({
        path: info.outputPath(`product-model-${theme}-${view}.png`),
      });
      for (const key of [
        "width",
        "radius",
        "padding",
        "background",
        "visibleShadow",
        "fontFlags",
      ])
        expect
          .soft((productMetrics.outer as any)[key], `outer ${key}`)
          .toEqual((referenceMetrics.outer as any)[key]);
      expect
        .soft(productMetrics.panel.height, "actual natural panel height")
        .toBeCloseTo(referenceMetrics.panel.height, 2);
      // Original s9i sizes its outer motion wrapper with integer offsetHeight;
      // compare real fractional content rather than clipping the product to its PNG crop.
      expect
        .soft(
          Math.round(productMetrics.outer.height),
          "native offsetHeight wrapper",
        )
        .toBe(referenceMetrics.outer.height);
      const fields =
        view === "simple"
          ? ["effort", "model", "chevron", "track", "thumb"]
          : ["heading"];
      for (const field of fields) {
        const a = (referenceMetrics as any)[field],
          b = (productMetrics as any)[field];
        for (const key of ["width", "height", "x", "y"])
          expect.soft(b[key], `${field} ${key}`).toBeCloseTo(a[key], 2);
        for (const key of [
          "fontSize",
          "lineHeight",
          "fontWeight",
          "color",
          "background",
          "padding",
        ])
          expect.soft(b[key], `${field} ${key}`).toEqual(a[key]);
      }
      if (view === "simple") {
        for (const key of [
          "borderWidth",
          "borderStyle",
          "borderColor",
          "shadow",
        ])
          expect
            .soft(productMetrics.thumb![key], `thumb ${key}`)
            .toEqual(referenceMetrics.thumb![key]);
        const geometry = (shadow: string) =>
          shadow.replace(/(?:rgba?|color|oklab)\([^)]*\)/g, "COLOR");
        expect
          .soft(geometry(productMetrics.track!.shadow), "track inset ring")
          .toBe(geometry(referenceMetrics.track!.shadow));
      } else {
        expect
          .soft(productMetrics.rows!.length)
          .toBe(referenceMetrics.rows!.length);
        productMetrics.rows!.forEach((row, index) => {
          const originalRow = referenceMetrics.rows![index];
          for (const key of ["width", "height", "x", "y"])
            expect
              .soft(row[key], `row ${index} ${key}`)
              .toBeCloseTo(originalRow[key], 2);
          for (const key of [
            "fontSize",
            "lineHeight",
            "fontWeight",
            "color",
            "padding",
          ])
            expect
              .soft(row[key], `row ${index} ${key}`)
              .toEqual(originalRow[key]);
        });
      }
      expect(errors).toEqual([]);
      expect(
        fixture.calls.filter((call) =>
          /\/(?:resume|turn\/start|turn\/steer|rollback|fork)$/.test(call.path),
        ),
      ).toEqual([]);
      await native.close();
    });
