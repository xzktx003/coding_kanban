import { expect, test } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

/**
 * Phase 2 calibration: drives the UNMODIFIED official Claude Code VS Code
 * extension 2.1.311 inside an isolated code-server host and captures its real
 * rendering, so our aligned renderer can be compared against observed output
 * rather than static inference alone.
 *
 * The host is launched separately (see the acceptance doc) and is expected at
 * CLAUDE_OFFICIAL_HOST. The extension is byte-identical to the installed one:
 * extension.js sha256 77fa2ea0eec77d1cda9b93099dcfeb179dc4ec6a92b321f050e89a9f9fe89c7e.
 *
 * This file is skipped unless CLAUDE_OFFICIAL_HOST is set, so the normal e2e
 * run is unaffected.
 */

const host = process.env.CLAUDE_OFFICIAL_HOST;
const output = resolve(".dev-runtime/claude-official-host-20261027/evidence");

test.skip(!host, "set CLAUDE_OFFICIAL_HOST to run official-host calibration");

test.use({ ignoreHTTPSErrors: true });

test.beforeAll(async () => {
  await mkdir(output, { recursive: true });
});

test("official extension loads and exposes its chat surface", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));

  await page.goto(`${host}/`, { waitUntil: "domcontentloaded" });

  // The workbench takes a while on first load; wait for it rather than a
  // fixed delay.
  await page.waitForSelector(".monaco-workbench", { timeout: 120_000 });
  await page.screenshot({
    path: resolve(output, "01-workbench.png"),
    fullPage: false,
  });

  // Open the Claude panel through the official command, not a DOM guess.
  await page.keyboard.press("Control+Shift+P");
  const palette = page.locator(".quick-input-widget");
  await expect(palette).toBeVisible({ timeout: 30_000 });
  await page.keyboard.type("Claude Code: Open in New Tab");
  await page.screenshot({ path: resolve(output, "02-command-palette.png") });
  await page.keyboard.press("Enter");

  // The webview is cross-origin; its iframe presence is what we can assert
  // from the host page.
  const webview = page.locator("iframe.webview, iframe[name^='webview']");
  await expect(webview.first()).toBeAttached({ timeout: 60_000 });
  await page.screenshot({
    path: resolve(output, "03-claude-panel.png"),
    fullPage: false,
  });

  await writeFile(
    resolve(output, "observations.md"),
    [
      "# Official host observations",
      "",
      `- host: ${host}`,
      `- extension: anthropic.claude-code 2.1.311 (unmodified)`,
      `- page errors: ${errors.length === 0 ? "none" : errors.join("; ")}`,
      "",
      "Screenshots in this directory are of the official extension, captured",
      "for visual comparison against our aligned renderer.",
      "",
    ].join("\n"),
    "utf8",
  );
});

test("the official webview's own DOM is reachable for comparison", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.goto(`${host}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".monaco-workbench", { timeout: 120_000 });

  await page.keyboard.press("Control+Shift+P");
  await expect(page.locator(".quick-input-widget")).toBeVisible({
    timeout: 30_000,
  });
  await page.keyboard.type("Claude Code: Open in New Tab");
  await page.keyboard.press("Enter");

  // VS Code nests the extension webview two frames deep. Walk the tree and
  // report which classes the official renderer actually puts in the DOM; this
  // is the ground truth our class names are aligned against.
  const found: Record<string, number> = {};
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      try {
        const counts = await frame.evaluate(() => {
          const names = [
            "messageInput",
            "messagesContainer",
            "toolBodyRow",
            "toolNameText",
            "thinkingSummary",
            "permissionRequestContainer",
            "diffEditorContainer",
          ];
          const out: Record<string, number> = {};
          for (const name of names)
            out[name] = document.querySelectorAll(`[class*="${name}"]`).length;
          return out;
        });
        for (const [name, count] of Object.entries(counts))
          if (count > 0) found[name] = Math.max(found[name] ?? 0, count);
      } catch {
        // Cross-origin or detached frame; skip it.
      }
    }
    if (Object.keys(found).length > 0) break;
    await page.waitForTimeout(2000);
  }

  await writeFile(
    resolve(output, "official-dom-classes.json"),
    `${JSON.stringify({ found, frames: page.frames().length }, null, 2)}\n`,
    "utf8",
  );
  await page.screenshot({
    path: resolve(output, "04-webview-dom.png"),
    fullPage: false,
  });

  // Record what was observed. An empty result means the webview stayed
  // cross-origin, which is a limitation to report rather than a failure to
  // paper over.
  test.info().annotations.push({
    type: "observed-classes",
    description: JSON.stringify(found),
  });
});
