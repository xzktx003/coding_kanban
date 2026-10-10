import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { installSessionUxFixture } from "./session-ux-fixture";
const reference = process.env.CODEX_NATIVE_REFERENCE_URL;
const run = {
  id: "hook",
  eventName: "userPromptSubmit",
  handlerType: "command",
  executionMode: "sync",
  scope: "thread",
  sourcePath: "/fixture/hooks.json",
  source: "project",
  displayOrder: 1,
  status: "blocked",
  statusMessage: "Review requested",
  startedAt: 1,
  completedAt: 2,
  durationMs: 1,
  entries: [{ kind: "feedback", text: "Review completed safely" }],
};
const metrics = (el: Element) => {
  const style = getComputedStyle(el),
    bounds = el.getBoundingClientRect(),
    walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT),
    nodes = [];
  while (walker.nextNode()) {
    const node = walker.currentNode,
      parent = node.parentElement!;
    if (
      !node.textContent?.trim() ||
      parent.closest('[aria-hidden="true"],.sr-only,[hidden]') ||
      (parent.closest("details:not([open])") && !parent.closest("summary"))
    )
      continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    const rect = range.getBoundingClientRect();
    if (rect.width > 0)
      nodes.push({
        text: node.textContent.trim(),
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        font: getComputedStyle(parent).font,
        fontSynthesisWeight: getComputedStyle(parent).fontSynthesisWeight,
        smoothing: getComputedStyle(parent).getPropertyValue(
          "-webkit-font-smoothing",
        ),
        color: getComputedStyle(parent).color,
      });
  }
  return {
    bounds: {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
    },
    padding: style.padding,
    background: style.backgroundColor,
    borderRadius: style.borderRadius,
    nodes,
    buttons: [...el.querySelectorAll("button")].map((button) => ({
      name: button.getAttribute("aria-label") ?? button.textContent?.trim(),
      bounds: {
        x: button.getBoundingClientRect().x,
        y: button.getBoundingClientRect().y,
        width: button.getBoundingClientRect().width,
        height: button.getBoundingClientRect().height,
      },
      svg: [...button.querySelectorAll("svg")].map((svg) => ({
        viewBox: svg.getAttribute("viewBox"),
        width: svg.getBoundingClientRect().width,
        height: svg.getBoundingClientRect().height,
        paths: svg.innerHTML,
        color: getComputedStyle(svg).color,
      })),
    })),
  };
};
for (const width of [1440, 390])
  test.describe(`${width} native hook dialog`, () => {
    test.use({ hasTouch: width === 390, isMobile: width === 390 });
    for (const theme of ["dark", "light"])
      test(`actual native hook dialog geometry and focus (${theme} ${width})`, async ({
        page,
      }, info) => {
        test.skip(!reference, "Requires original read-only VSIX harness");
        test.setTimeout(120000);
        const native = await page.context().newPage(),
          errors: string[] = [];
        for (const p of [page, native]) {
          p.on("pageerror", (error) => errors.push(error.message));
          await p.setViewportSize({ width, height: 844 });
          await p.emulateMedia({ reducedMotion: "reduce" });
        }
        const host =
          theme === "dark"
            ? {
                background: "#20211d",
                secondary: "#282a23",
                foreground: "#ccc",
                description: "#858585",
                warning: "#e25507",
              }
            : {
                background: "#fff",
                secondary: "#f5f5f3",
                foreground: "#3b3b3b",
                description: "#717171",
                warning: "#923b0f",
              };
        await native.route("**/*", (route) =>
          new URL(route.request().url()).origin === new URL(reference!).origin
            ? route.continue()
            : route.abort(),
        );
        await native.goto(reference!);
        await native.waitForFunction(() => (window as any).nativeLoaded);
        await native.evaluate(
          async ({ theme, host, run }) => {
            const source = await import(
              /* @vite-ignore */ "./native/assets/user-message-a9427cd0db0e.js"
            );
            source.o();
            document.documentElement.dataset.theme = theme;
            const viewport = document.createElement("meta");
            viewport.name = "viewport";
            viewport.content = "width=device-width,initial-scale=1";
            document.head.append(viewport);
            document.getElementById("root")!.style.width = "min(616px,100%)";
            document.getElementById("root")!.style.boxSizing = "border-box";
            for (const [key, value] of Object.entries({
              "font-family": "system-ui",
              "editor-background": host.background,
              "sideBar-background": host.secondary,
              foreground: host.foreground,
              descriptionForeground: host.description,
              "editorWarning-foreground": host.warning,
              "dropdown-background": host.secondary,
              "dropdown-foreground": host.foreground,
              "menu-background": host.secondary,
            }))
              document.documentElement.style.setProperty(
                "--vscode-" + key,
                value,
              );
            document.body.style.background = host.background;
            (window as any).renderNativeElement(source.a, {
              stats: { count: 1, blockedCount: 1, errorCount: 0, runs: [run] },
            });
          },
          { theme, host, run },
        );
        await installSessionUxFixture(page);
        await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
        await page
          .locator(".session-mode [contenteditable=true]")
          .first()
          .waitFor({ timeout: 60000 });
        await page.evaluate(
          async ({ theme, host, run }) => {
            const module = (path: string) =>
              import(
                performance
                  .getEntriesByType("resource")
                  .findLast((entry) => new URL(entry.name).pathname === path)
                  ?.name ?? path
              );
            const { useThemeStore } = await module(
              "/src/session-mode/stores/settings/useThemeStore.ts",
            );
            useThemeStore.getState().setTheme(theme);
            const dep = (name: string) =>
              performance
                .getEntriesByType("resource")
                .findLast((entry) =>
                  new URL(entry.name).pathname.endsWith(
                    "/deps/" + name + ".js",
                  ),
                )!.name;
            const React = await import(dep("react")),
              dom = await import(dep("react-dom_client")),
              R = React.default ?? React,
              { createRoot } = dom.default ?? dom,
              { NativeHookStats } = await module(
                "/src/session-mode/components/codex/items/NativeHookStats.tsx",
              );
            const owner = document.querySelector<HTMLElement>(".session-mode")!;
            for (const [key, value] of Object.entries({
              "font-family": "system-ui",
              "editor-background": host.background,
              "sideBar-background": host.secondary,
              foreground: host.foreground,
              descriptionForeground: host.description,
              "editorWarning-foreground": host.warning,
            }))
              owner.style.setProperty("--vscode-" + key, value);
            const container = document.createElement("div");
            container.id = "native-hook-product-trigger";
            container.style.cssText =
              "position:fixed;top:16px;left:16px;z-index:10";
            owner.append(container);
            createRoot(container).render(
              R.createElement(NativeHookStats, { runs: [run] }),
            );
          },
          { theme, host, run },
        );
        const nativeTrigger = native.getByRole("button", {
          name: "钩子统计信息",
        });
        const productTrigger = page
          .locator("#native-hook-product-trigger")
          .getByRole("button", { name: "钩子统计信息" });
        if (width === 390) {
          await nativeTrigger.tap();
          await productTrigger.tap();
        } else {
          await nativeTrigger.click();
          await productTrigger.click();
        }
        const nd = native.getByRole("dialog"),
          pd = page.getByRole("dialog");
        await nd.getByText("运行次数", { exact: true }).waitFor();
        await pd.getByText("运行次数", { exact: true }).waitFor();
        await expect.soft(nd.locator("button")).toBeFocused();
        await expect.soft(pd.locator("button")).toBeFocused();
        for (const expanded of [false, true]) {
          if (expanded) {
            if (width === 390) {
              await nd.locator("summary").tap();
              await pd.locator("summary").tap();
            } else {
              await nd.locator("summary").click();
              await pd.locator("summary").click();
            }
          }
          await native.mouse.move(width - 2, 842);
          await page.mouse.move(width - 2, 842);
          await page.waitForTimeout(250);
          const actual = await pd.evaluate(metrics),
            expected = await nd.evaluate(metrics);
          await writeFile(
            info.outputPath(
              `hook-metrics-${expanded ? "expanded" : "collapsed"}-${theme}-${width}.json`,
            ),
            JSON.stringify({ actual, expected }, null, 2),
          );
          await native.screenshot({
            path: info.outputPath(
              `native-hook-${expanded ? "expanded" : "collapsed"}-${theme}-${width}.png`,
            ),
            fullPage: true,
          });
          await page.screenshot({
            path: info.outputPath(
              `product-hook-${expanded ? "expanded" : "collapsed"}-${theme}-${width}.png`,
            ),
            fullPage: true,
          });
          expect.soft(actual).toEqual(expected);
        }
        if (width === 390) {
          await nd.getByRole("button", { name: "关闭对话框" }).tap();
          await pd.getByRole("button", { name: "关闭对话框" }).tap();
        } else {
          await native.keyboard.press("Escape");
          await page.keyboard.press("Escape");
        }
        await expect(
          native.getByRole("button", { name: "钩子统计信息" }),
        ).toBeFocused();
        await expect(
          page
            .locator("#native-hook-product-trigger")
            .getByRole("button", { name: "钩子统计信息" }),
        ).toBeFocused();
        expect(errors).toEqual([]);
        await native.close();
      });
  });
