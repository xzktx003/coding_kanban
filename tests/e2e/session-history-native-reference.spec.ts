import { expect, test, type Locator } from "@playwright/test";
import { installSessionUxFixture } from "./session-ux-fixture";
import { writeFile } from "node:fs/promises";

async function geometry(locator: Locator) {
  return locator.evaluate(el => {
    const style = getComputedStyle(el), rect = el.getBoundingClientRect();
    return { width: rect.width, height: rect.height, fontSize: style.fontSize, lineHeight: style.lineHeight, borderRadius: style.borderRadius, padding: style.padding, gap: style.gap, borderWidth: style.borderWidth, background: style.backgroundColor, color: style.color };
  });
}

for (const theme of ["dark", "light"]) {
  test(`history retry matches unchanged VSIX warningCallout (${theme})`, async ({ page }, info) => {
    const reference = process.env.CODEX_NATIVE_REFERENCE_URL;
    test.skip(!reference, "Requires original VSIX webview harness");
    test.setTimeout(90000);
    const native = await page.context().newPage();
    const errors: string[] = [];
    for (const p of [native, page]) p.on("pageerror", e => errors.push(e.message));
    await native.route("**/*", r => new URL(r.request().url()).origin === new URL(reference!).origin ? r.continue() : r.abort());
    await native.goto(reference!);
    await native.waitForFunction(() => (window as any).nativeLoaded);
    await native.evaluate(async theme => {
      const N = await import(/* @vite-ignore */ "./native/assets/app-initial-3192ac99b6cd.js");
      N.cX();
      const w = window as any, R = w.nativeModules.React;
      document.documentElement.dataset.theme = theme;
      document.documentElement.style.setProperty("--vscode-editor-background", theme === "dark" ? "#20211d" : "#fff");
      document.documentElement.style.setProperty("--vscode-foreground", theme === "dark" ? "#ccc" : "#3b3b3b");
      w.historyRetries = 0;
      w.renderNativeElement(N.sX, { content: R.createElement("span", { className: "select-none" }, "无法加载消息"), density: "compact", layout: "warningCallout", primaryCtaColor: "ghostActive", primaryCtaText: "重试", role: "alert", stackOnNarrow: true, onPrimaryCtaClick: () => w.historyRetries++ });
    }, theme);
    await expect(native.getByRole("alert")).toBeVisible();
    await installSessionUxFixture(page, 1);
    await page.goto("/?mode=session");
    await page.locator(".session-mode [contenteditable=true]").first().waitFor({ timeout: 60000 });
    await page.evaluate(async theme => {
      const dependency = (window as any).__sessionFixtureDependency;
      const R = (await import(dependency("react.js"))).default;
      const dom = await import(dependency("react-dom_client.js"));
      const { createRoot } = dom.default ?? dom;
      const { CodexHistoryNotice } = await import("/src/session-mode/components/codex/thread/CodexHistoryNotice.tsx");
      document.getElementById("root")!.style.display = "none";
      const host = document.createElement("div");
      host.id = "history-reference-product";
      host.className = `session-mode ${theme}`;
      host.style.cssText = `padding:16px;box-sizing:border-box;--vscode-font-family:system-ui;--vscode-editor-background:${theme === "dark" ? "#20211d" : "#fff"};--vscode-foreground:${theme === "dark" ? "#ccc" : "#3b3b3b"}`;
      document.body.style.margin = "0";
      document.body.append(host);
      (window as any).historyRetries = 0;
      createRoot(host).render(R.createElement(CodexHistoryNotice, { loaded: true, error: "read timed out", onRetry: () => (window as any).historyRetries++ }));
    }, theme);
    for (const width of [616, 390]) {
      await native.evaluate(width => document.getElementById("root")!.style.cssText = `padding:16px;width:${width}px;box-sizing:border-box`, width);
      await page.evaluate(width => document.getElementById("history-reference-product")!.style.width = `${width}px`, width);
      const original = native.getByRole("alert"), product = page.locator("#history-reference-product [role=alert]");
      const measurements = { original: await geometry(original), product: await geometry(product), originalButton: await geometry(original.getByRole("button")), productButton: await geometry(product.getByRole("button")) };
      await info.attach(`geometry-${width}.json`, { body: JSON.stringify(measurements, null, 2), contentType: "application/json" });
      await writeFile(info.outputPath(`geometry-${width}.json`), JSON.stringify(measurements, null, 2));
      expect(measurements.product).toEqual(measurements.original);
      expect(measurements.productButton).toEqual(measurements.originalButton);
    }
    await native.getByRole("button", { name: "重试" }).click();
    await page.locator("#history-reference-product").getByRole("button", { name: "重试" }).click();
    expect(await native.evaluate(() => (window as any).historyRetries)).toBe(1);
    expect(await page.evaluate(() => (window as any).historyRetries)).toBe(1);
    expect(errors).toEqual([]);
    await native.close();
  });
}
