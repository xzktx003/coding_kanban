import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";

// Independent original-component acceptance against existing isolated servers.
// This config never starts an application server, listener or build.
const baseURL = process.env.PLAYWRIGHT_BASE_URL;
const referenceURL = process.env.CODEX_GOAL_REFERENCE_URL;
if (referenceURL && !baseURL)
  throw new Error(
    "PLAYWRIGHT_BASE_URL must name an existing isolated LAN fixture",
  );
for (const value of [baseURL, referenceURL]) {
  if (!value) continue;
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error(
      "Goal reference URLs must be explicit HTTP(S) without credentials",
    );
}
const args = JSON.parse(process.env.GOAL_STYLE_CHROMIUM_ARGS_JSON ?? "[]");
if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string"))
  throw new Error("GOAL_STYLE_CHROMIUM_ARGS_JSON must be a JSON string array");
const browserName = process.env.GOAL_CONTROL_STYLE_BROWSER ?? "chromium";
if (!["chromium", "firefox"].includes(browserName))
  throw new Error("GOAL_CONTROL_STYLE_BROWSER must be chromium or firefox");
if (browserName !== "chromium" && args.length)
  throw new Error(
    "Chromium capability flags cannot be applied to another browser",
  );

export default defineConfig({
  testDir: resolve(process.cwd(), "tests/e2e"),
  testMatch: "session-goal-control-styles-reference.spec.ts",
  outputDir: "test-results/goal-controls-reference",
  timeout: 90_000,
  workers: 1,
  use: {
    baseURL,
    browserName: browserName as "chromium" | "firefox",
    headless: true,
    ignoreHTTPSErrors: [baseURL, referenceURL].some(
      (url) => url && new URL(url).protocol === "https:",
    ),
    launchOptions: {
      args,
      ...(browserName === "chromium" &&
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
        ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
        : {}),
    },
  },
});
