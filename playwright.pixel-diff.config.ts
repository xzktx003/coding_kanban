import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";

// Isolated official-webview pixel coverage against the pinned 26.51021.22027 reference.
//
// This config never starts an application server or build; it drives the read-only
// reference server (started/stopped inside the spec, no login, no IPC) and, when
// PLAYWRIGHT_BASE_URL points at a running isolated session-mode frontend, the local
// session shell for the same logical states. Baseline/Snapshot screenshots live under
// test-results/pixel-diff/baseline so CI can diff any change (red when misaligned).
const baseURL = process.env.PLAYWRIGHT_BASE_URL;
// The reference server is always (re)started by the spec so a stale/old official build
// (e.g. 26.1021.22027 or 26.51007.21434) is rejected at startup instead of silently
// becoming the "oracle". The official baseline capture can run with only the reference
// server; local-pair tests skip when no PLAYWRIGHT_BASE_URL is set.

export default defineConfig({
  testDir: resolve(process.cwd(), "tests/e2e"),
  testMatch: /session-codex-pixel-diff\.spec\.ts/,
  outputDir: "test-results/pixel-diff/output",
  timeout: 120_000,
  workers: 1,
  snapshotPathTemplate:
    "{testDir}/../test-results/pixel-diff/baseline/{arg}{ext}",
  use: {
    baseURL,
    headless: true,
    ignoreHTTPSErrors: Boolean(baseURL && baseURL.startsWith("https")),
    viewport: { width: 1440, height: 900 },
  },
});
