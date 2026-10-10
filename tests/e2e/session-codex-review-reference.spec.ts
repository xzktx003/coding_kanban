import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { installSessionUxFixture } from "./session-ux-fixture";
const reference = process.env.CODEX_NATIVE_REFERENCE_URL;
const patch = "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -80 +90 @@\n-before = 1;\n+after = 2;\n";
for (const theme of ["dark", "light"]) for (const mode of ["full", "inline", "hover"]) test(`actual original ${mode} Diff geometry and separate theme evidence (${theme})`, async ({ page }, info) => {
  test.skip(!reference, "CODEX_NATIVE_REFERENCE_URL must point to the read-only original webview");
  test.setTimeout(90000);
  const native = await page.context().newPage(), errors: string[] = [];
  native.on("pageerror", error => errors.push(error.message));page.on("pageerror", error => errors.push(error.message));
  const host = theme === "dark" ? { background: "#20211d", secondary: "#282a23", foreground: "#ccc", muted: "#858585", added: "#81b88b", removed: "#c74e39" } : { background: "#fff", secondary: "#f5f5f3", foreground: "#3b3b3b", muted: "#717171", added: "#587c0c", removed: "#ad0707" };
  await native.route("**/*", route => new URL(route.request().url()).origin === new URL(reference!).origin ? route.continue() : route.abort());
  await native.setViewportSize({ width: 700, height: 400 });await native.emulateMedia({ reducedMotion: "reduce" });await native.goto(reference!);await native.waitForFunction(() => (window as any).nativeLoaded);
  await native.evaluate(async ({ theme, host, mode, patch }) => {
    for (const [key, value] of Object.entries({ "font-family": "system-ui", "editor-font-family": "ui-monospace", "editor-background": host.background, "sideBar-background": host.secondary, foreground: host.foreground, descriptionForeground: host.muted, "gitDecoration-addedResourceForeground": host.added, "gitDecoration-deletedResourceForeground": host.removed })) document.documentElement.style.setProperty(`--vscode-${key}`, value);
    document.documentElement.setAttribute("data-theme", theme);document.body.style.background = host.background;document.body.style.color = host.foreground;
    const { installNativeReviewFixture } = await import(/* @vite-ignore */ "./native-review-reference.js");await installNativeReviewFixture();(window as any).renderReviewFixture(mode, { patch, props: { showFileActions: false, showHunkActions: false } });
  }, { theme, host, mode, patch });
  await installSessionUxFixture(page);await page.setViewportSize({ width: 700, height: 400 });await page.emulateMedia({ reducedMotion: "reduce" });await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });await page.locator(".session-codex-composer [contenteditable=true]").first().waitFor({ timeout: 60000 });
  await page.evaluate(async ({ theme, host, mode, patch }) => {
    const react = await import((window as any).__sessionFixtureDependency("react.js")), dom = await import((window as any).__sessionFixtureDependency("react-dom_client.js")), { DiffViewer } = await import("/src/session-mode/features/DiffViewer.tsx");const R = react.default ?? react, { createRoot } = dom.default ?? dom;
    document.getElementById("root")!.style.display = "none";document.body.style.margin = "0";document.body.style.background = host.background;document.body.style.color = host.foreground;
    const fixture = document.createElement("div");fixture.id = "review-product-reference";fixture.className = `session-mode ${theme === "dark" ? "dark" : ""}`;fixture.style.cssText = "width:616px;padding:16px;box-sizing:border-box;min-height:400px";fixture.style.background = host.background;
    for (const [key, value] of Object.entries({ "font-family": "system-ui", "editor-font-family": "ui-monospace", "editor-background": host.background, "sideBar-background": host.secondary, foreground: host.foreground, descriptionForeground: host.muted, "gitDecoration-addedResourceForeground": host.added, "gitDecoration-deletedResourceForeground": host.removed })) fixture.style.setProperty(`--vscode-${key}`, value);
    document.body.append(fixture);
    const content = R.createElement(DiffViewer, { native: true, unifiedDiff: patch, displayPath: "a.ts", isCollapsed: false, presentation: mode === "full" ? "review" : mode === "inline" ? "inline" : "preview" });
    createRoot(fixture).render(R.createElement("div", { className: mode === "hover" ? "codex-presentation codex-file-preview" : "codex-presentation", style: mode === "hover" ? { border: "1px solid color-mix(in oklab,var(--codex-text) 8%,transparent)", borderRadius: "12.5px", overflow: "hidden" } : {} }, content));
  }, { theme, host, mode, patch });
  await expect(native.locator('diffs-container [data-line="80"]').first()).toContainText("before = 1;");await expect(page.locator('[data-old-line="80"] .codex-diff-source').first()).toContainText("before = 1;");
  const original = await native.evaluate(() => {
    const root = document.querySelector("diffs-container")!.shadowRoot!, code = root.querySelector<HTMLElement>('[data-line="80"]')!, gutter = root.querySelector<HTMLElement>('[data-column-number="80"]')!, origin = document.getElementById("root")!.getBoundingClientRect();
    const metric = (element: HTMLElement) => { const style = getComputedStyle(element), rect = element.getBoundingClientRect();return { font: style.fontFamily, size: style.fontSize, line: style.lineHeight, color: style.color, background: style.backgroundColor, padding: style.padding, width: rect.width, height: rect.height, x: rect.x - origin.x, y: rect.y - origin.y }; };
    const header = document.querySelector<HTMLElement>('[class*="group/diff-header"]');
    const vars = ["--codex-diffs-surface", "--codex-diffs-surface-override", "--color-codex-diff-surface", "--color-surface", "--color-surface-secondary", "--diffs-dark-bg", "--diffs-light-bg", "--diffs-deletion-base", "--diffs-bg-deletion-emphasis"];
    return { source: metric(code), gutter: metric(gutter), header: header ? metric(header) : null, headerParent: header?.parentElement ? metric(header.parentElement) : null, themeVariables: Object.fromEntries(vars.map(name => [name, getComputedStyle(code).getPropertyValue(name).trim()])), messages: (window as any).nativeMessages, resolvedSettings: (window as any).nativeReviewResolvedSettings, suppliedSettings: (window as any).nativeReviewSettings, caller: (window as any).nativeReviewCaller, variant: (window as any).reviewFixtureMode };
  });
  const product = await page.evaluate(() => {
    const row = document.querySelector<HTMLElement>('#review-product-reference [data-old-line="80"]')!, code = row.querySelector<HTMLElement>(".codex-diff-source")!, gutter = row.querySelector<HTMLElement>(".codex-diff-number")!, origin = document.getElementById("review-product-reference")!.getBoundingClientRect();
    const metric = (element: HTMLElement) => { const style = getComputedStyle(element), rect = element.getBoundingClientRect();return { font: style.fontFamily, size: style.fontSize, line: style.lineHeight, color: style.color, background: style.backgroundColor, padding: style.padding, width: rect.width, height: rect.height, x: rect.x - origin.x, y: rect.y - origin.y }; };
    return { source: metric(code), gutter: metric(gutter), rowBackground: getComputedStyle(row).backgroundColor };
  });
  await writeFile(info.outputPath(`${mode}-${theme}-diff-metrics.json`), JSON.stringify({ mode, theme, original, product, note: "Theme color differences retained: original default Codex code theme and approved screenshot host aliases are separate evidence." }, null, 2));
  expect(product.source.size).toBe(original.source.size);expect(product.source.line).toBe(original.source.line);expect(product.source.font).toBe(original.source.font);
  expect(Math.abs(product.gutter.width - original.gutter.width)).toBeLessThanOrEqual(1);expect(Math.abs(product.source.height - original.source.height)).toBeLessThanOrEqual(1);expect(Math.abs(product.source.y - original.source.y)).toBeLessThanOrEqual(1);
  await native.screenshot({ path: info.outputPath(`reference-${mode}-${theme}.png`) });await page.screenshot({ path: info.outputPath(`product-${mode}-${theme}.png`) });expect(errors).toEqual([]);
  await native.close();
});
