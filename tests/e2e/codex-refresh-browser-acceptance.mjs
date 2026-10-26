// Explicit live fixture only. No API interception, native DOM replacement or production fallback.
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, lstat, realpath } from "node:fs/promises";
import { resolve, join } from "node:path";
import { chromium, webkit } from "../../node_modules/playwright/index.mjs";
import { attachPrivateService } from "../../packages/native-codex-host/refresh-prototype/private-service.mjs";
import { iphone16Context, mobileEnvironment } from "./codex-refresh-mobile.mjs";
import {
  installRefreshTimingObserver,
  captureRefreshPageTimings,
} from "./codex-refresh-timings.mjs";
import { expectedRefreshHistory } from "./codex-refresh-history.mjs";
import { focusInitialOriginalComposer } from "./codex-refresh-initial-prompt.mjs";
import { waitForOriginalComposerSettlement } from "./codex-refresh-ui-settlement.mjs";
import {
  selectRefreshClientProfile,
  verifyRefreshProfileRoot,
} from "./codex-refresh-fixture.mjs";

const pause = (ms) => new Promise((done) => setTimeout(done, ms));
async function privateJson(file) {
  assert.ok(file, "explicit private fixture file required");
  const path = resolve(file),
    info = await lstat(path);
  assert.ok(
    info.isFile() &&
      info.uid === process.getuid() &&
      (info.mode & 0o777) === 0o600 &&
      info.size < 64 * 1024,
  );
  assert.equal(await realpath(path), path);
  return JSON.parse(await readFile(path, "utf8"));
}
const fixture = await privateJson(
  process.env.NATIVE_CODEX_REFRESH_BROWSER_MANIFEST,
);
const mobileEngine = process.env.NATIVE_CODEX_REFRESH_MOBILE_ENGINE || "webkit";
assert.ok(["webkit", "chromium"].includes(mobileEngine));
const endpoint =
  mobileEngine === "webkit"
    ? await privateJson(process.env.NATIVE_CODEX_REFRESH_WEBKIT_ENDPOINT_FILE)
    : null;
const output = resolve(process.env.NATIVE_CODEX_REFRESH_BROWSER_OUTPUT || "");
assert.ok(
  process.env.NATIVE_CODEX_REFRESH_BROWSER_OUTPUT,
  "explicit fresh output directory required",
);
assert.ok(Array.isArray(fixture.urls) && fixture.urls.length === 3);
assert.equal(new Set(fixture.urls.map((url) => new URL(url).origin)).size, 3);
assert.ok(fixture.urls.every((url) => new URL(url).protocol === "https:"));
assert.ok(
  fixture.root.startsWith("/tmp/ck-") &&
    fixture.project.startsWith(fixture.root + "/"),
);
selectRefreshClientProfile(fixture, 0);
for (const profile of fixture.profiles)
  await verifyRefreshProfileRoot(fixture.root, profile.root);
if (endpoint) assert.ok(/^ws:\/\/127\.0\.0\.1:\d+\/.+/.test(endpoint.endpoint));
await mkdir(output, { mode: 0o700 });
const result = {
  physicalDevice: false,
  device: "iPhone 16 size simulation",
  fixtureApiRouting: false,
  independentHostProfiles: fixture.profiles.length === 3,
  url: fixture.url,
  origins: fixture.urls,
  threadId: fixture.threadId,
  steps: [],
  receipts: [],
  uiSettlements: [],
  timings: [],
  historyEvidence: [],
  initializationActions: [],
  errors: [],
  passed: false,
};
const save = () =>
  writeFile(join(output, "result.json"), JSON.stringify(result, null, 2), {
    mode: 0o600,
  });
const events = [],
  browsers = [],
  contexts = [],
  pages = [];
let monitor, expectedHistoryToken, monitorFailure;
function error(value) {
  if (result.errors.length < 256) result.errors.push(value);
  else result.errorsTruncated = true;
}
async function wait(check, label, ms = 90000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (monitorFailure) throw monitorFailure;
    const value = await check();
    if (value) return value;
    await pause(50);
  }
  throw Error(label);
}
async function composer(page) {
  return wait(async () => {
    for (const frame of page.frames()) {
      try {
        const target = frame.locator(
          `[data-above-composer-conversation-id="${fixture.threadId}"]`,
        );
        const editor = frame
          .locator('#root [contenteditable="true"]:visible')
          .first();
        if (
          (await target.count()) &&
          (await editor.count()) &&
          (await frame.getByText(expectedHistoryToken, { exact: true }).count())
        )
          return editor;
        const next = frame.getByRole("button", { name: "Next", exact: true });
        if ((await next.count()) && (await next.isVisible()))
          await next.click({ timeout: 1000 });
      } catch {
        /* Native frame navigation is expected during restoration. */
      }
    }
  }, "Correct original native composer and seed history did not recover");
}
function observe(page, index) {
  page.on("crash", () => error({ index, kind: "page-crash" }));
  page.on("close", () => {
    if (!result.teardown) error({ index, kind: "unexpected-page-close" });
  });
  page.on("pageerror", (value) =>
    error({ index, kind: "pageerror", message: value.message.slice(0, 500) }),
  );
  page.on("requestfailed", (request) =>
    error({
      index,
      kind: "requestfailed",
      path: new URL(request.url()).pathname,
      message: request.failure()?.errorText,
    }),
  );
}
const drafts = [
  "电脑 A 独立草稿 alpha",
  "电脑 B 独立草稿 beta",
  "iPhone 16 模拟草稿 gamma",
];
try {
  const metadata = await privateJson(join(fixture.root, "manager/bridge.json"));
  const service = await attachPrivateService({
    metadata,
    domain: fixture.domain,
  });
  monitor = await service.connect({
    name: "refresh_browser_acceptance",
    onLifecycle: (event) => {
      if (
        event.threadId === fixture.threadId &&
        ["turn/started", "turn/completed"].includes(event.method)
      ) {
        if (events.length < 128)
          events.push({ ...event, receivedAt: Date.now() });
        else error({ kind: "receipt-overflow" });
      }
    },
  });
  monitor.closed.then(
    () => {
      if (!result.teardown)
        monitorFailure = Error("Private native receipt monitor closed");
    },
    (failure) => {
      if (!result.teardown) {
        if (failure.code === "NATIVE_OUTPUT_LIMIT")
          result.nativeOutputLimit = failure.nativeOutputLimit ?? {
            limitBytes: 2 * 1024 * 1024,
            method: null,
            declaredBytes: null,
          };
        monitorFailure = Error(
          /payload limit/.test(failure.message)
            ? "Private native receipt monitor exceeded the payload limit"
            : "Private native receipt monitor connection failed",
        );
      }
    },
  );
  await monitor.request("thread/resume", {
    threadId: fixture.threadId,
    excludeTurns: true,
  });
  const readHistoryEvidence = async (turnId) => {
    const { thread } = await monitor.request("thread/read", {
      threadId: fixture.threadId,
      includeTurns: true,
    });
    const evidence = expectedRefreshHistory(thread, {
      threadId: fixture.threadId,
      cwd: fixture.project,
      turnId,
    });
    expectedHistoryToken = evidence.token;
    result.historyEvidence.push(evidence);
  };
  await readHistoryEvidence();
  const desktop = await chromium.launch({
    headless: true,
    args: ["--ignore-certificate-errors-spki-list=" + fixture.spki],
  });
  browsers.push(desktop);
  const mobile =
    mobileEngine === "webkit"
      ? await webkit.connect(endpoint.endpoint)
      : desktop;
  if (mobile !== desktop) browsers.push(mobile);
  result.browsers = {
    desktop: desktop.version(),
    mobileEngine,
    mobile: mobile.version(),
  };
  const desktopContext = await desktop.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 900 },
  });
  const mobileContext = await mobile.newContext({
    ...iphone16Context,
    ignoreHTTPSErrors: true,
  });
  contexts.push(desktopContext, mobileContext);
  for (const context of contexts)
    await context.addInitScript(installRefreshTimingObserver);
  for (let index = 0; index < 3; index++) {
    const profile = selectRefreshClientProfile(fixture, index);
    const page = await (index === 2 ? mobileContext : desktopContext).newPage();
    pages.push(page);
    observe(page, index);
    await page.addInitScript(
      ({ profile, threadId, cwd }) => {
        if (
          window !== window.top ||
          sessionStorage.getItem("private-profile-seeded") === profile.id
        )
          return;
        const data = JSON.stringify({
          version: 2,
          hostKey: profile.startupId,
          activeId: threadId,
          activeGroupId: "saved",
          tree: {
            type: "group",
            id: "saved",
            keys: [threadId],
            selected: threadId,
          },
          windows: [
            {
              id: threadId,
              kind: "thread",
              threadId,
              cwd,
              title: "Private shared native thread",
            },
          ],
        });
        sessionStorage.setItem(
          "kanban.codex.tab-view.v1:kanban.codex.multiwindow.v2:" + profile.id,
          JSON.stringify(data),
        );
        sessionStorage.setItem("private-profile-seeded", profile.id);
      },
      { profile, threadId: fixture.threadId, cwd: fixture.project },
    );
    await page.goto(
      fixture.urls[index] + "/?mode=codex&nativeClient=" + profile.id,
    );
    const editor = await composer(page);
    const handle = await editor.elementHandle();
    assert.ok(handle);
    const nativeFrame = await handle.ownerFrame();
    await handle.dispose();
    assert.ok(nativeFrame);
    const focusInitial = async () => {
      const handled = await focusInitialOriginalComposer({
        editor,
        frame: nativeFrame,
        mobile: index === 2,
      });
      if (handled)
        result.initializationActions.push({
          index,
          action: "keep-current-model",
        });
    };
    result.timings.push({
      index,
      phase: "initial-composer",
      ...(await captureRefreshPageTimings(page)),
    });
    if (index === 2) {
      result.mobileEnvironment = await mobileEnvironment(page);
      assert.deepEqual(result.mobileEnvironment.screen, {
        width: 393,
        height: 852,
      });
      assert.deepEqual(result.mobileEnvironment.viewport, {
        width: 393,
        height: 852,
      });
      assert.equal(result.mobileEnvironment.dpr, 3);
      assert.equal(result.mobileEnvironment.coarsePointer, true);
      await editor.evaluate((el) =>
        el.addEventListener(
          "touchstart",
          () => {
            el.dataset.acceptanceTouched = "true";
          },
          { once: true },
        ),
      );
      await focusInitial();
      await wait(
        () => editor.evaluate((el) => el.dataset.acceptanceTouched === "true"),
        "Native composer did not receive touch",
      );
      result.nativeComposerTouch = true;
    } else await focusInitial();
    await editor.fill(drafts[index]);
    await pause(500);
    const text = await editor.innerText();
    result.steps.push({
      step: "type",
      index,
      pass: text === drafts[index],
      navigationMs: await page.evaluate(() => performance.now()),
    });
    await save();
    assert.equal(text, drafts[index]);
  }
  for (let index = 0; index < 3; index++) {
    const text = await (await composer(pages[index])).innerText();
    result.steps.push({
      step: "concurrent-drafts",
      index,
      pass: text === drafts[index],
    });
    await save();
    assert.equal(text, drafts[index]);
  }
  const mobilePage = pages[2],
    mobileEditor = await composer(mobilePage);
  const outerFrame = await mobilePage
    .locator(".codex-mode-frame")
    .elementHandle();
  assert.ok(outerFrame);
  const parent = await outerFrame.evaluateHandle((el) => el.parentElement);
  result.mobileReflow = [];
  // Playwright changes screen together with viewport on resize. Initial contexts
  // verify fixed physical screen separately; these transitions test live reflow.
  result.viewportResizeAlsoChangesScreen = true;
  for (const height of [659, 430, 852]) {
    await mobilePage.setViewportSize({ width: 393, height });
    await mobileEditor.tap();
    const environment = await mobileEnvironment(mobilePage),
      box = await mobileEditor.boundingBox();
    const text = await mobileEditor.innerText();
    const identityPreserved = await outerFrame.evaluate(
      (el, originalParent) =>
        el.isConnected && el.parentElement === originalParent,
      parent,
    );
    const horizontalOverflow = await mobilePage.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    );
    const pass =
      identityPreserved &&
      text === drafts[2] &&
      !horizontalOverflow &&
      box &&
      box.x >= 0 &&
      box.y >= 0 &&
      box.y + box.height <= height + 1;
    result.mobileReflow.push({
      height,
      environment,
      box,
      identityPreserved,
      horizontalOverflow,
      pass: Boolean(pass),
    });
    await mobilePage.screenshot({
      path: join(output, `mobile-reflow-${height}.png`),
    });
    await save();
    assert.ok(pass, "Mobile composer or draft lost during viewport reflow");
  }
  await parent.dispose();
  await outerFrame.dispose();
  for (let index = 0; index < 3; index++) {
    const page = pages[index];
    await page.reload({ waitUntil: "domcontentloaded" });
    const editor = await composer(page),
      text = await editor.innerText();
    result.steps.push({
      step: "reload-draft",
      index,
      pass: text === drafts[index],
      navigationMs: await page.evaluate(() => performance.now()),
    });
    await save();
    assert.equal(text, drafts[index]);
    const offset = events.length;
    if (index === 2) await editor.tap();
    else await editor.click();
    await editor.fill(
      `Reply exactly REFRESH_IPHONE_ACCEPTED_${index}. Do not call tools, read files, or execute commands.`,
    );
    const send = editor
      .locator('xpath=ancestor::*[@id="root"]')
      .getByRole("button", { name: "Send", exact: true });
    if (index === 2) await send.tap();
    else await send.click();
    const accepted = await wait(
      () =>
        events.slice(offset).find((event) => event.method === "turn/started"),
      "Exact thread native acceptance receipt missing",
      30000,
    );
    const navigationToReceiptMs =
      accepted.receivedAt - (await page.evaluate(() => performance.timeOrigin));
    result.receipts.push({
      index,
      threadId: accepted.threadId,
      turnId: accepted.turnId,
      navigationToReceiptMs,
      withinTwoSeconds: navigationToReceiptMs <= 2000,
    });
    result.timings.push({
      index,
      phase: "native-acceptance",
      ...(await captureRefreshPageTimings(page)),
    });
    await save();
    await wait(
      () =>
        events
          .slice(offset)
          .some(
            (event) =>
              event.method === "turn/completed" &&
              event.turnId === accepted.turnId,
          ),
      "Native accepted turn did not complete",
      60000,
    );
    await readHistoryEvidence(accepted.turnId);
    const editorHandle = await editor.elementHandle();
    assert.ok(
      editorHandle,
      "Original composer element disappeared after completion",
    );
    let nativeFrame;
    try {
      nativeFrame = await editorHandle.ownerFrame();
    } finally {
      await editorHandle.dispose();
    }
    assert.ok(
      nativeFrame,
      "Original composer frame disappeared after completion",
    );
    result.uiSettlements.push({
      index,
      turnId: accepted.turnId,
      ...(await waitForOriginalComposerSettlement({
        frame: nativeFrame,
        threadId: fixture.threadId,
      })),
    });
    await save();
    await page.screenshot({ path: join(output, `accepted-${index}.png`) });
  }
  result.draftsPassed =
    result.steps.length === 9 && result.steps.every((step) => step.pass);
  result.performancePassed =
    result.receipts.length === 3 &&
    result.receipts.every((receipt) => receipt.withinTwoSeconds);
  result.uiSettlementPassed = result.uiSettlements.length === 3;
  result.finalMatrixComplete = false; // This diagnostic run is not the 180-sample, three-state matrix.
  result.passed =
    result.draftsPassed &&
    result.performancePassed &&
    result.uiSettlementPassed &&
    result.errors.length === 0;
} catch (failure) {
  error({
    kind: "assertion",
    message: failure.message.slice(0, 1000),
    ...(failure.code === "ORIGINAL_COMPOSER_NOT_SETTLED"
      ? {
          code: failure.code,
          observation: failure.observation,
          samples: failure.samples,
          elapsedMs: failure.elapsedMs,
        }
      : {}),
  });
  for (let index = 0; index < pages.length; index++)
    result.timings.push({
      index,
      phase: "failure",
      ...(await captureRefreshPageTimings(pages[index])),
    });
  for (let index = 0; index < pages.length; index++)
    await pages[index]
      .screenshot({ path: join(output, `failure-${index}.png`) })
      .catch(() => {});
} finally {
  result.teardown = true;
  for (const context of contexts) await context.close().catch(() => {});
  for (const browser of browsers) await browser.close().catch(() => {});
  await monitor
    ?.close()
    .catch(() => error({ kind: "native-monitor-cleanup-failed" }));
  await save();
}
console.log(
  JSON.stringify({
    output,
    passed: result.passed,
    draftsPassed: result.draftsPassed,
    performancePassed: result.performancePassed,
    uiSettlementPassed: result.uiSettlementPassed,
    errors: result.errors.length,
  }),
);
if (!result.passed) process.exitCode = 1;
