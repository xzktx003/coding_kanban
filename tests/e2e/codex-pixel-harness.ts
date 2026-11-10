// Pixel-diff harness for the isolated official Codex webview (26.51021.22027).
//
// Grounds on the pinned read-only reference server (scripts/codex-goal-reference-server.mjs).
// That server never starts Codex, opens CLI IPC, reads login state, or sends a real turn; it
// only serves the unchanged official webview assets as a component oracle. This module wraps
// its lifecycle and provides bounded screenshot / pixel-parity helpers for Playwright.
//
// Evidence tier: O-C (real official webview rendered in a plain browser with a mocked
// acquireVsCodeApi), NOT O-F (a full VS Code/code-server/extensionHost chain). A same-state
// comparison result can only be attributed to the component/props driven, as documented in
// the pixel-diff design doc.

import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Page } from "@playwright/test";

export interface ReferenceServer {
  /** http://127.0.0.1:PORT usable from a browser on this machine. */
  base: string;
  /** Official package version reported by /reference.json and the identity line. */
  version: string;
  /** LAN URLs the server printed (for cross-host / LAN evidence). */
  urls: string[];
  /** Resolves once the child exited. */
  stop: () => Promise<void>;
}

// Keep baselines/artifacts under tests/test-results so the Playwright snapshot template
// (playwright.pixel-diff.config.ts) and the manual artifact writes agree.
export const PIXEL_BASELINE_DIR = resolve(
  "tests/test-results/pixel-diff/baseline",
);
export const PIXEL_ARTIFACT_DIR = resolve(
  "tests/test-results/pixel-diff/artifacts",
);

/**
 * Start the isolated read-only reference server and wait for its identity line.
 * The server requires `--host 0.0.0.0`; LAN URLs are printed to stdout (we keep
 * them in `urls`), while `base` is the loopback origin we actually drive.
 */
export async function startReferenceServer(): Promise<ReferenceServer> {
  const child: ChildProcess = spawn(
    process.execPath,
    [
      "scripts/codex-goal-reference-server.mjs",
      "--host",
      "0.0.0.0",
      "--port",
      "0",
    ],
    { stdio: ["ignore", "pipe", "pipe"], cwd: resolve(process.cwd()) },
  );
  const identity = await new Promise<{
    version: string;
    urls: string[];
  }>((resolveIdentity, reject) => {
    let output = "";
    child.stdout.on("data", (bytes) => {
      output += bytes;
      const end = output.indexOf("\n");
      if (end >= 0) {
        try {
          resolveIdentity(JSON.parse(output.slice(0, end)));
        } catch (error) {
          reject(error);
        }
      }
    });
    child.once("exit", (code) =>
      reject(new Error(`reference server exited ${code}`)),
    );
  });
  const port = new URL(identity.urls[0]).port;
  return {
    base: `http://127.0.0.1:${port}`,
    version: identity.version,
    urls: identity.urls,
    stop: async () => {
      if (child.exitCode == null) child.kill("SIGTERM");
      await once(child, "exit");
    },
  };
}

/** Drive the unchanged official index to its logged-out home composer. */
export async function openOfficialHomeComposer(
  page: Page,
  base: string,
): Promise<void> {
  await page.addInitScript(() => {
    const resultFor = (method: string) => {
      if (method === "config/read") return { config: {}, layers: [] };
      if (method === "remoteControl/status/read") return { enabled: false };
      if (method === "getAuthStatus")
        return { authMethod: null, requiresAuth: false };
      if (method === "account/read")
        return { account: null, requiresOpenaiAuth: false };
      if (
        [
          "experimentalFeature/list",
          "thread/list",
          "model/list",
          "collaborationMode/list",
          "mcpServerStatus/list",
          "permissionProfile/list",
        ].includes(method)
      )
        return { data: [], nextCursor: null };
      if (method === "configRequirements/read") return { requirements: null };
      if (method === "plugin/installed") return { marketplaces: [] };
      if (method === "experimentalFeature/enablement/set") return {};
      return {};
    };
    const queued: any[] = [];
    const methods = new Map<string, { count: number; params: unknown }>();
    (window as any).__queuedRpc = queued;
    (window as any).__officialRpcMethods = () =>
      [...methods.entries()].map(([method, value]) => ({ method, count: value.count, params: value.params }));
    (window as any).acquireVsCodeApi = () => ({
      postMessage(message: any) {
        queued.push(message);
        (window as any).__rpcMessage?.(message);
        if (message?.type === "persisted-atom-sync-request") {
          window.postMessage(
            {
              type: "persisted-atom-sync",
              state: {},
              canWritePrimaryWindowTabPersistence: false,
            },
            location.origin,
          );
        }
        if (message?.type === "mcp-request") {
          const method = String(message.request?.method ?? "unknown");
          const current = methods.get(method);
          methods.set(method, { count: (current?.count ?? 0) + 1, params: message.request?.params ?? null });
          window.postMessage(
            {
              type: "mcp-response",
              hostId: message.hostId,
              message: {
                id: message.request.id,
                result: resultFor(message.request.method),
              },
            },
            location.origin,
          );
        }
      },
      getState: () => ({}),
      setState: (value: unknown) => value,
    });
  });
  await page.goto(`${base}/index.html`, { waitUntil: "commit" });
  await page.evaluate(async () => {
    const rpc = await import("/assets/dist-e1cc91af12d6.js");
    const incoming: any[] = [];
    const waiters: ((message: any) => void)[] = [];
    const target = window as any;
    const services = {
      appInfo: {
        async get() {
          return {
            version: "26.51021.22027",
            buildFlavor: "prod",
            platform: "linux",
            systemVersion: "6.8",
          };
        },
        async getSystemInfo() {
          return { platform: "linux", osVersion: "6.8" };
        },
      },
      ideOnboarding: {
        async getState() {
          return { completed: true };
        },
        subscribe() {
          return Promise.resolve({ [Symbol.dispose]() {} });
        },
      },
    };
    target.__rpcMessage = (event: any) => {
      if (event?.type === "vscode-capn-rpc-connect" && !target.__rpcServer) {
        target.__rpcServer = new rpc.t(
          {
            encodingLevel: "jsonCompatibleWithBytes",
            send(message: any) {
              window.postMessage(
                {
                  type: "vscode-capn-rpc-message",
                  sessionId: event.sessionId,
                  message,
                },
                location.origin,
              );
            },
            receive: () =>
              incoming.length
                ? Promise.resolve(incoming.shift())
                : new Promise((resolve) => waiters.push(resolve)),
            abort() {},
          },
          { services },
        );
      } else if (event?.type === "vscode-capn-rpc-message") {
        const waiter = waiters.shift();
        if (waiter) waiter(event.message);
        else incoming.push(event.message);
      }
    };
    for (const event of target.__queuedRpc.splice(0)) target.__rpcMessage(event);
  });
  await page.getByText("Ask for approval").waitFor({ timeout: 150_000 });
  await page.waitForFunction(
    () => {
      const methods = new Map(
        ((window as any).__officialRpcMethods?.() ?? []).map(
          (entry: { method: string; count: number }) => [entry.method, entry.count],
        ),
      );
      return [
        "thread/list",
        "model/list",
        "collaborationMode/list",
        "permissionProfile/list",
      ].every((method) => (methods.get(method) ?? 0) > 0);
    },
    undefined,
    { timeout: 30_000 },
  );
}

/** Boot the unchanged official webview through native-app.html and settle the loader. */
export async function openOfficialWebview(
  page: Page,
  base: string,
): Promise<void> {
  await page.goto(`${base}/native-app.html`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => (window as any).nativeAppBooted === true);
  // The official boot loader runs a finite fade-in plus an infinite shimmer. Screenshots
  // must freeze both; `animations:"disabled"` in the assertion handles the CSS side.
  await page.waitForTimeout(700);
}

/** Assert the current live rendering matches the stored official baseline (pixel diff). */
export async function assertPixelParity(
  page: Page,
  selector: string,
  baselineName: string,
  options: { maxDiffPixels?: number; threshold?: number } = {},
): Promise<void> {
  const locator = page.locator(selector);
  await locator.screenshot({
    path: resolve(PIXEL_ARTIFACT_DIR, `live-${baselineName}`),
  });
  await expectPageScreenshot(locator, baselineName, options);
}

/** Thin wrapper so the pixel-parity assertion is one call; see agent-teams contract. */
async function expectPageScreenshot(
  locator: any,
  baselineName: string,
  options: { maxDiffPixels?: number; threshold?: number },
) {
  const { expect } = await import("@playwright/test");
  await expect(locator).toHaveScreenshot(baselineName, {
    maxDiffPixels: options.maxDiffPixels ?? 16,
    threshold: options.threshold ?? 0.2,
    animations: "disabled",
    caret: "hide",
    scale: "css",
  });
}

/** Record a named runtime observation (state data) as JSON evidence. */
export async function saveEvidence(
  name: string,
  value: unknown,
): Promise<string> {
  const dir = resolve(PIXEL_ARTIFACT_DIR, "evidence");
  await mkdir(dir, { recursive: true });
  const path = resolve(dir, `${name}.json`);
  await writeFile(path, JSON.stringify(value, null, 2));
  return path;
}
