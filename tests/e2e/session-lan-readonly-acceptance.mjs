// Explicit existing LAN services only. No service launcher, API interception,
// task gesture, target URL, copied browser state, screenshot or response body log.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import { dirname, isAbsolute, join, resolve } from "node:path";
import {
  classifyLiveRequest,
  classifyControlledNetworkFailure,
  createOwnedBrowserShutdown,
  snapshotOwnedSceneDOM,
  projectAlreadyReadProof,
  projectLiveTarget,
  validateLiveUrl,
} from "./session-lan-readonly-policy.mjs";

const argv = process.argv.slice(2);
const flags = new Set(["--run", "--accept-untrusted-tls"]);
const values = new Set([
  "--frontend",
  "--backend",
  "--output",
  "--target-file",
]);
const options = {};
for (let index = 0; index < argv.length; index++) {
  const name = argv[index];
  assert.ok(!Object.hasOwn(options, name), "duplicate acceptance option");
  if (flags.has(name)) options[name] = true;
  else {
    assert.ok(
      values.has(name) && argv[index + 1] && !argv[index + 1].startsWith("--"),
      "unknown or incomplete acceptance option",
    );
    options[name] = argv[++index];
  }
}
assert.ok(
  options["--frontend"] && options["--backend"] && options["--output"],
  "explicit frontend, backend and fresh output required",
);
const frontend = validateLiveUrl(options["--frontend"]);
const backend = validateLiveUrl(options["--backend"]);
const output = resolve(options["--output"]);
assert.ok(isAbsolute(options["--output"]), "output must be absolute");
const parent = await lstat(dirname(output));
assert.ok(
  parent.isDirectory() &&
    parent.uid === process.getuid() &&
    !(parent.mode & 0o002),
  "output parent must be owned and not world writable",
);
assert.equal(
  await realpath(dirname(output)),
  dirname(output),
  "output parent must be canonical",
);
await mkdir(output, { mode: 0o700 }); // A previous run may never be overwritten.
const digest = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const result = {
  version: 1,
  at: new Date().toISOString(),
  frontend,
  backend,
  mode: options["--run"] ? "live-readonly-browser" : "metadata-preflight-only",
  apiRouting: false,
  directServiceControlInvoked: false,
  screenshots: false,
  responseBodiesSaved: false,
  taskGestures: false,
  passed: false,
  checks: [],
  pages: [],
  requests: {},
  errors: [],
  injectedFaultErrors: [],
};
const save = () =>
  writeFile(join(output, "result.json"), JSON.stringify(result, null, 2), {
    mode: 0o600,
  });
const fail = (code) => {
  throw Object.assign(new Error(code), { acceptanceCode: code });
};
function readEndpoint(origin, pathname, payload) {
  const url = new URL(pathname, origin);
  return new Promise((done, reject) => {
    const transport = url.protocol === "https:" ? https : http;
    const request = transport.request(
      url,
      {
        method: payload ? "POST" : "GET",
        rejectUnauthorized: !options["--accept-untrusted-tls"],
        headers: payload ? { "content-type": "application/json" } : {},
        timeout: 10000,
      },
      (response) => {
        const chunks = [];
        let bytes = 0;
        response.on("data", (chunk) => {
          bytes += chunk.length;
          if (bytes > 2 * 1024 * 1024)
            request.destroy(
              Object.assign(new Error(), {
                acceptanceCode: "READ_BUDGET_EXCEEDED",
              }),
            );
          else chunks.push(chunk);
        });
        response.on("end", () =>
          done({
            status: response.statusCode,
            contentType: String(response.headers["content-type"] ?? "").slice(
              0,
              100,
            ),
            bytes,
            data: Buffer.concat(chunks).toString("utf8"),
          }),
        );
        response.on("error", reject);
      },
    );
    request.on("timeout", () =>
      request.destroy(
        Object.assign(new Error(), { acceptanceCode: "READ_TIMEOUT" }),
      ),
    );
    request.on("error", reject);
    if (payload) request.write(JSON.stringify(payload));
    request.end();
  });
}
async function jsonEndpoint(origin, pathname, payload) {
  const response = await readEndpoint(origin, pathname, payload);
  if (response.status !== 200) fail(`READ_HTTP_${response.status}`);
  try {
    return JSON.parse(response.data);
  } catch {
    fail("READ_JSON_INVALID");
  }
}
const healthProjection = (health) => ({
  status: health.status,
  instance: typeof health.instance === "string" ? health.instance : null,
  codexBackend:
    typeof health.codexBackend === "string" ? health.codexBackend : null,
});
const tabsProjection = (tabs) => {
  if (tabs.initialized !== true || !Array.isArray(tabs.cards))
    fail("SHARED_TABS_NOT_INITIALIZED");
  return tabs.cards.map((card) => ({
    kind: card.kind,
    id: card.id,
    cwd: card.cwd ?? null,
    worktreePath: card.worktreePath ?? null,
  }));
};
let browser;
let stopping = false;
let unsafeRequest;
const shutdownBrowser = createOwnedBrowserShutdown(
  async () => {
    await browser?.close();
  },
  (error) => {
    result.errors.push({
      kind: "owned-browser-cleanup-failed",
      digest: digest(String(error?.name ?? "Error")),
    });
  },
);
try {
  const [document, health, frontendHealth, tabs] = await Promise.all([
    readEndpoint(frontend, "/"),
    jsonEndpoint(backend, "/api/session/health"),
    jsonEndpoint(frontend, "/api/session/health"),
    jsonEndpoint(backend, "/api/session/tabs"),
  ]);
  result.preflight = {
    document: {
      status: document.status,
      contentType: document.contentType,
      bytes: document.bytes,
    },
    health: healthProjection(health),
    frontendHealth: healthProjection(frontendHealth),
    tabs: tabsProjection(tabs),
  };
  if (
    document.status !== 200 ||
    health.status !== "ok" ||
    !health.instance ||
    frontendHealth.status !== "ok" ||
    frontendHealth.instance !== health.instance
  )
    fail("EXISTING_SERVICE_OR_FRONTEND_PROXY_NOT_READY");
  if (!options["--run"]) {
    result.passed = true;
    result.boundary =
      "Metadata preflight only. No browser, native context, task, history or operability acceptance.";
  } else {
    if (!options["--target-file"]) fail("EXPLICIT_PRIVATE_TARGET_REQUIRED");
    const targetPath = resolve(options["--target-file"]);
    const info = await lstat(targetPath);
    if (
      !info.isFile() ||
      info.uid !== process.getuid() ||
      (info.mode & 0o777) !== 0o600 ||
      info.size > 8192 ||
      (await realpath(targetPath)) !== targetPath
    )
      fail("PRIVATE_TARGET_FILE_INVALID");
    const target = projectLiveTarget(
      JSON.parse(await readFile(targetPath, "utf8")),
    );
    result.target = target;
    if (
      health.instance !== target.runtimeInstance ||
      health.codexBackend !== "shared-daemon"
    )
      fail("EXPECTED_SHARED_RUNTIME_NOT_ACTIVE");
    if (
      !result.preflight.tabs.some(
        (card) =>
          card.kind === target.kind &&
          card.id === target.threadId &&
          card.cwd === target.cwd,
      )
    )
      fail("TARGET_NOT_ALREADY_FOLLOWED");
    const contextProjection = (context) => ({
      namespace: context.namespace,
      daemonIdentity: context.daemonIdentity,
    });
    const readProof = async (origin) => {
      const before = await jsonEndpoint(
        origin,
        "/api/session/lifecycle/context",
      );
      const metadata = await jsonEndpoint(
        origin,
        "/api/session/api/codex/thread/metadata?view=chat",
        { threadId: target.threadId },
      );
      const [after, currentHealth] = await Promise.all([
        jsonEndpoint(origin, "/api/session/lifecycle/context"),
        jsonEndpoint(origin, "/api/session/health"),
      ]);
      if (
        before.namespace !== target.namespace ||
        before.daemonIdentity !== target.daemonIdentity ||
        typeof before.scopeToken !== "string" ||
        !before.scopeToken ||
        before.scopeToken !== after.scopeToken ||
        before.namespace !== after.namespace ||
        before.daemonIdentity !== after.daemonIdentity ||
        currentHealth.instance !== target.runtimeInstance ||
        currentHealth.codexBackend !== "shared-daemon" ||
        metadata.thread?.id !== target.threadId ||
        metadata.thread?.cwd !== target.cwd
      )
        fail("SOURCE_OR_EXACT_TARGET_CHANGED");
      return {
        health: healthProjection(currentHealth),
        context: contextProjection(after),
        exactThread: { id: metadata.thread.id, cwd: metadata.thread.cwd },
      };
    };
    result.sourceBefore = {
      backend: await readProof(backend),
      frontend: await readProof(frontend),
    };
    const readMetadata = () =>
      jsonEndpoint(
        frontend,
        "/api/session/api/codex/thread/metadata?view=chat",
        { threadId: target.threadId },
      );
    const metadataBeforeReadProof = await readMetadata();
    const [recent, management] = await Promise.all([
      jsonEndpoint(
        frontend,
        "/api/session/api/codex/thread/turns/list?view=chat",
        {
          threadId: target.threadId,
          limit: 1,
          sortDirection: "desc",
          itemsView: "notLoaded",
        },
      ),
      jsonEndpoint(frontend, "/api/session/management"),
    ]);
    result.alreadyReadBefore = projectAlreadyReadProof(
      metadataBeforeReadProof,
      recent,
      management,
      target,
    );
    const readContextBefore = await jsonEndpoint(
      frontend,
      "/api/session/lifecycle/context",
    );
    const query = new URLSearchParams({
      threadId: target.threadId,
      replyId: result.alreadyReadBefore.latestTurnId,
      namespace: management.namespaces.codex,
    });
    const linkedReadProof = await jsonEndpoint(
      frontend,
      "/api/session/management/read-context?" + query,
    );
    const [metadataAfterReadProof, readContextAfter] = await Promise.all([
      readMetadata(),
      jsonEndpoint(frontend, "/api/session/lifecycle/context"),
    ]);
    projectAlreadyReadProof(metadataAfterReadProof, recent, management, target);
    if (
      metadataAfterReadProof.readState.revision !==
        metadataBeforeReadProof.readState.revision ||
      linkedReadProof.revision !== metadataBeforeReadProof.readState.revision ||
      linkedReadProof.replyId !== result.alreadyReadBefore.latestTurnId ||
      typeof linkedReadProof.scope !== "string" ||
      !linkedReadProof.scope ||
      linkedReadProof.scope !== readContextBefore.scopeToken ||
      readContextBefore.scopeToken !== readContextAfter.scopeToken ||
      readContextBefore.namespace !== target.namespace ||
      readContextAfter.namespace !== target.namespace ||
      readContextBefore.daemonIdentity !== target.daemonIdentity ||
      readContextAfter.daemonIdentity !== target.daemonIdentity
    )
      fail("READ_STATE_OR_NATIVE_SCOPE_CHANGED_BEFORE_BROWSER_ENTRY");
    result.alreadyReadBefore.managementNamespaceBoundByReadonlyContext = true;
    const { chromium } =
      await import("../../node_modules/playwright/index.mjs");
    browser = await chromium.launch({ headless: true });
    const contexts = [];
    const observe = (page, record) => {
      const inFlight = new Set();
      const refreshRequests = new WeakSet();
      const offlineRequests = new WeakSet();
      const offlinePaths = new Set();
      const refreshPaths = new Set();
      let offlineConsoleUntil = 0;
      let refreshConsoleUntil = 0;
      const sanitizedError = (kind, raw) => {
        result.errors.push({
          page: record.label,
          phase: record.phase,
          kind,
          digest: digest(String(raw)),
        });
      };
      page.on("pageerror", (error) =>
        sanitizedError("pageerror", error.message),
      );
      page.on("crash", () => sanitizedError("page-crash", "crash"));
      page.on("console", (message) => {
        if (message.type() !== "error") return;
        const text = message.text();
        let path;
        try {
          path = new URL(message.location().url).pathname;
        } catch {
          /* An app console error has no proven affected request. */
        }
        const expected = classifyControlledNetworkFailure({
          kind: "console",
          message: text,
          affectedOffline: offlinePaths.has(path),
          affectedRefresh: refreshPaths.has(path),
          withinOfflineWindow: Date.now() <= offlineConsoleUntil,
          withinRefreshWindow: Date.now() <= refreshConsoleUntil,
        });
        if (expected)
          result.injectedFaultErrors.push({
            page: record.label,
            kind:
              expected === "offline"
                ? "offline-console-network-error"
                : "refresh-console-abort",
            digest: digest(text),
          });
        else sanitizedError("console-error", text);
      });
      page.on("requestfailed", (request) => {
        inFlight.delete(request);
        const failure = request.failure()?.errorText;
        if (stopping) return;
        const expected = classifyControlledNetworkFailure({
          kind: "request",
          message: failure,
          affectedOffline: offlineRequests.has(request),
          affectedRefresh: refreshRequests.has(request),
        });
        if (expected) {
          result.injectedFaultErrors.push({
            page: record.label,
            kind:
              expected === "offline"
                ? "offline-request-failed"
                : "refresh-request-abort",
            digest: digest(new URL(request.url()).pathname + failure),
          });
          return;
        }
        sanitizedError(
          "request-failed",
          new URL(request.url()).pathname + request.failure()?.errorText,
        );
      });
      page.on("requestfinished", (request) => inFlight.delete(request));
      page.on("response", (response) => {
        if (
          response.status() === 200 &&
          response.headers()["content-type"]?.includes("text/event-stream")
        )
          record.sseConnections++;
      });
      page.on("request", (request) => {
        const url = new URL(request.url());
        inFlight.add(request);
        if (record.phase === "offline") {
          offlineRequests.add(request);
          offlinePaths.add(url.pathname);
        }
        if (url.origin !== frontend || !url.pathname.startsWith("/api/"))
          return;
        let body;
        try {
          const raw = request.postData();
          if (raw && raw.length <= 65536) body = JSON.parse(raw);
        } catch {
          /* Unrecognized writes remain rejected. */
        }
        const classification = classifyLiveRequest(
          request.method(),
          url.pathname,
          body,
        );
        result.requests[classification] =
          (result.requests[classification] ?? 0) + 1;
        if (
          ["task-write", "management-write", "unknown-write"].includes(
            classification,
          )
        ) {
          unsafeRequest = {
            page: record.label,
            phase: record.phase,
            method: request.method(),
            pathname: url.pathname,
            classification,
          };
          // Observation only: no request interception, synthetic response or replay.
          void shutdownBrowser();
        }
      });
      return {
        beforeReload() {
          record.phase = "refresh";
          refreshPaths.clear();
          refreshConsoleUntil = Date.now() + 5000;
          for (const request of inFlight) {
            refreshRequests.add(request);
            refreshPaths.add(new URL(request.url()).pathname);
          }
        },
        afterReload() {
          refreshPaths.clear();
          refreshConsoleUntil = 0;
        },
        beforeOffline() {
          record.phase = "offline";
          offlinePaths.clear();
          offlineConsoleUntil = Infinity;
          for (const request of inFlight) {
            offlineRequests.add(request);
            offlinePaths.add(new URL(request.url()).pathname);
          }
        },
        afterOnline() {
          record.phase = "reconnecting";
          offlineConsoleUntil = Date.now() + 3000;
        },
        afterReconnect() {
          offlinePaths.clear();
          offlineConsoleUntil = 0;
        },
      };
    };
    const observePage = async (page, record, phase) => {
      record.phase = phase;
      await page.waitForSelector(
        '[aria-label="会话工作台导航"][data-navigation-ready="true"]',
        { timeout: 30000 },
      );
      const owner = page.locator(
        `.session-codex-composer[data-owner-thread=${JSON.stringify(target.threadId)}]:visible`,
      );
      await owner.waitFor({ state: "visible", timeout: 30000 });
      if ((await owner.count()) !== 1) fail("EXPECTED_COMPOSER_NOT_UNIQUE");
      const editor = owner.locator('[contenteditable="true"]');
      if ((await editor.count()) !== 1 || !(await editor.isEditable()))
        fail("EXPECTED_INPUT_NOT_EDITABLE");
      await page.waitForFunction(
        (id) => {
          const card = [
            ...document.querySelectorAll("[data-session-card]"),
          ].find(
            (element) =>
              element.getAttribute("data-session-card") === id &&
              element.getBoundingClientRect().width > 0,
          );
          return !!card?.querySelector(
            "[data-codex-row],[data-codex-live-message]",
          );
        },
        target.threadId,
        { timeout: 30000 },
      );
      const dom = await page.evaluate(snapshotOwnedSceneDOM, {
        threadId: target.threadId,
      });
      const state = await page.evaluate(async (id) => {
        const resource = performance
          .getEntriesByType("resource")
          .findLast((entry) =>
            new URL(entry.name).pathname.endsWith(
              "/components/codex/stores/useCodexStore.ts",
            ),
          );
        if (!resource) return null; // Do not instantiate an unseen module to manufacture evidence.
        const { useCodexStore } = await import(resource.name);
        const value = useCodexStore.getState();
        const timing = value.turnTimingMap[id];
        return {
          currentThreadId: value.currentThreadId,
          currentTurnId: value.currentTurnId,
          historyLoaded: value.historyLoadedMap[id] === true,
          threadStatus: value.threadStatusMap[id]?.type ?? null,
          timing: timing
            ? { turnId: timing.turnId, status: timing.status }
            : null,
          eventCount: value.events[id]?.length ?? 0,
        };
      }, target.threadId);
      const activity = await jsonEndpoint(
        backend,
        `/api/session/codex/activity?threadId=${encodeURIComponent(target.threadId)}`,
      );
      const native = {
        threadId: activity.threadId,
        status: activity.status?.type ?? null,
        turn: activity.turn
          ? { id: activity.turn.id, status: activity.turn.status }
          : null,
      };
      const falseInterruption =
        !!state?.timing &&
        state.timing.status === "interrupted" &&
        native.turn?.id === state.timing.turnId &&
        ["inProgress", "completed"].includes(native.turn.status);
      record.lastMetadata = { phase, dom, state, native, falseInterruption };
      if (
        dom.visibleOwnerCount !== 1 ||
        !state ||
        state.currentThreadId !== target.threadId ||
        !state.historyLoaded ||
        !dom.historyRows ||
        falseInterruption ||
        dom.interruptionSamplesTruncated ||
        (target.expectNoInterruptedHistory &&
          dom.interruptionSamples?.some((sample) => sample.count > 0))
      )
        fail("HISTORY_TARGET_OR_EXECUTION_NOT_VERIFIED");
      await editor.focus();
      const keyEvidence = await page.evaluate((id) => {
        const input = document.activeElement;
        const beforeLength = input?.textContent?.length;
        return new Promise((done) => {
          const timeout = setTimeout(() => {
            document.removeEventListener("keydown", listener, true);
            done({ timedOut: true });
          }, 3000);
          const listener = (event) => {
            if (event.key !== "ArrowLeft") return;
            document.removeEventListener("keydown", listener, true);
            const start = performance.now();
            requestAnimationFrame(() =>
              requestAnimationFrame(() => {
                clearTimeout(timeout);
                done({
                  owner: event.target
                    ?.closest?.("[data-owner-thread]")
                    ?.getAttribute("data-owner-thread"),
                  correctOwner:
                    event.target
                      ?.closest?.("[data-owner-thread]")
                      ?.getAttribute("data-owner-thread") === id,
                  textLengthUnchanged:
                    beforeLength === input?.textContent?.length,
                  twoFramesMs: performance.now() - start,
                });
              }),
            );
          };
          document.addEventListener("keydown", listener, true);
          // Expose only this pending metadata promise, never content or a sender.
          window.__liveReadonlyKeyReady = true;
        });
      }, target.threadId);
      return { phase, dom, state, native, falseInterruption, keyEvidence };
    };
    // Each context is a fresh device site. No user's storageState, tabs, drafts,
    // selection or pending outbox is imported or rewritten.
    for (const [index, viewport] of [
      { width: 1440, height: 1000 },
      { width: 1440, height: 1000 },
      { width: 393, height: 852 },
    ].entries()) {
      const context = await browser.newContext({
        viewport,
        screen: viewport,
        isMobile: index === 2,
        hasTouch: index === 2,
        deviceScaleFactor: index === 2 ? 3 : 1,
        ignoreHTTPSErrors: !!options["--accept-untrusted-tls"],
      });
      contexts.push(context);
      const page = await context.newPage();
      const record = {
        label:
          index === 2 ? "iPhone16-size-simulation" : `desktop-${index + 1}`,
        viewport,
        phase: "initial",
        observations: [],
        sseConnections: 0,
      };
      result.pages.push(record);
      const observer = observe(page, record);
      await page.addInitScript((id) => {
        window.__liveReadonlyInterruptionSamples = [];
        let scheduled = false;
        let previous;
        const observer = new MutationObserver(() => {
          if (scheduled) return;
          scheduled = true;
          requestAnimationFrame(() => {
            scheduled = false;
            const card = [
              ...document.querySelectorAll("[data-session-card]"),
            ].find(
              (element) =>
                element.getAttribute("data-session-card") === id &&
                element.getBoundingClientRect().width > 0,
            );
            const count = [
              ...(card?.querySelectorAll("span,[aria-label='该轮已中断']") ??
                []),
            ].filter(
              (element) =>
                element.childElementCount === 0 &&
                /^(?:该轮)?已中断$/.test(element.textContent?.trim() ?? "") &&
                element.getBoundingClientRect().width > 0,
            ).length;
            if (previous === count) return;
            previous = count;
            if (window.__liveReadonlyInterruptionSamples.length >= 128)
              window.__liveReadonlyInterruptionTruncated = true;
            else
              window.__liveReadonlyInterruptionSamples.push({
                atMs: performance.now(),
                count,
              });
          });
        });
        observer.observe(document, {
          subtree: true,
          childList: true,
          characterData: true,
        });
      }, target.threadId);
      await page.goto(frontend + "/?mode=session", {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      // Install a real non-mutating key gesture without awaiting its listener
      // promise before dispatch. Enter, text input and send are never used.
      const capture = async (phase) => {
        let pendingError;
        const pending = observePage(page, record, phase).catch((error) => {
          pendingError = error;
          return null;
        });
        await Promise.race([
          page.waitForFunction(
            () => window.__liveReadonlyKeyReady === true,
            null,
            { timeout: 60000 },
          ),
          pending.then((value) => {
            if (!value) throw pendingError;
            fail("INPUT_LISTENER_DID_NOT_WAIT_FOR_GESTURE");
          }),
        ]);
        await page.keyboard.press("ArrowLeft");
        const observation = await pending;
        if (!observation) throw pendingError;
        await page.evaluate(() => {
          delete window.__liveReadonlyKeyReady;
        });
        if (
          !observation.keyEvidence.correctOwner ||
          !observation.keyEvidence.textLengthUnchanged
        )
          fail("NON_MUTATING_INPUT_GESTURE_FAILED");
        record.observations.push(observation);
      };
      await capture("initial");
      observer.beforeReload();
      await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
      await capture("after-refresh");
      observer.afterReload();
      observer.beforeOffline();
      const connectionsBeforeOffline = record.sseConnections;
      await context.setOffline(true);
      await new Promise((done) => setTimeout(done, 1500));
      await context.setOffline(false);
      observer.afterOnline();
      const reconnectDeadline = Date.now() + 20000;
      while (
        record.sseConnections <= connectionsBeforeOffline &&
        Date.now() < reconnectDeadline
      )
        await new Promise((done) => setTimeout(done, 250));
      if (record.sseConnections <= connectionsBeforeOffline)
        fail("ACTUAL_EVENT_STREAM_RECONNECT_NOT_OBSERVED");
      observer.afterReconnect();
      await capture("after-reconnect");
    }
    result.sourceAfter = {
      backend: await readProof(backend),
      frontend: await readProof(frontend),
    };
    const afterTabs = tabsProjection(
      await jsonEndpoint(backend, "/api/session/tabs"),
    );
    result.sharedTabsUnchanged =
      digest(result.preflight.tabs) === digest(afterTabs);
    if (!result.sharedTabsUnchanged)
      fail("SHARED_TABS_CHANGED_NO_ROLLBACK_ATTEMPTED");
    if (unsafeRequest) fail("UNEXPECTED_WRITE_OBSERVED");
    if (result.errors.length) fail("BROWSER_ERROR_OBSERVED");
    result.passed = true;
    result.boundary =
      "Three fresh contexts (two desktop, one iPhone 16 size simulation), existing naturally selected exact followed target, actual history, refresh and browser-only offline recovery. No model task, physical phone or 30-sample performance claim.";
  }
} catch (error) {
  result.failure = unsafeRequest ?? {
    code: error.acceptanceCode ?? error.code ?? "ACCEPTANCE_CHECK_FAILED",
  };
} finally {
  stopping = true;
  try {
    if (!(await shutdownBrowser())) {
      result.passed = false;
      result.failure ??= { code: "OWNED_BROWSER_CLEANUP_FAILED" };
    }
  } finally {
    await save();
  }
}
console.log(
  JSON.stringify({
    passed: result.passed,
    mode: result.mode,
    pages: result.pages.length,
    taskWrites: result.requests["task-write"] ?? 0,
    errors: result.errors.length,
    output,
  }),
);
if (!result.passed) process.exitCode = 1;
