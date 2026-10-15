// Explicit owned fixture only. This profiles startup to a correct interactive
// composer; it is not the plan's native acceptance-receipt performance gate.
import assert from "node:assert/strict";
import { lstat, readFile, realpath, mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { chromium } from "../../node_modules/playwright/index.mjs";
import {
  installRefreshTimingObserver,
  captureRefreshPageTimings,
} from "./codex-refresh-timings.mjs";
import { summarizeRefreshCpu } from "./codex-refresh-cpu.mjs";
import { expectedRefreshHistory } from "./codex-refresh-history.mjs";
import { attachPrivateService } from "../../packages/native-codex-host/refresh-prototype/private-service.mjs";

const file = resolve(process.env.NATIVE_CODEX_REFRESH_BROWSER_MANIFEST || "");
assert.ok(
  process.env.NATIVE_CODEX_REFRESH_BROWSER_MANIFEST &&
    process.env.NATIVE_CODEX_REFRESH_BROWSER_OUTPUT,
);
const stat = await lstat(file);
assert.ok(
  stat.isFile() &&
    stat.uid === process.getuid() &&
    (stat.mode & 0o777) === 0o600 &&
    stat.size < 65536,
);
assert.equal(await realpath(file), file);
const fixture = JSON.parse(await readFile(file, "utf8")),
  profile = fixture.profiles[0];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
assert.ok(uuid.test(profile.id) && uuid.test(fixture.threadId));
assert.ok(
  fixture.root.startsWith("/tmp/ck-") &&
    fixture.project.startsWith(fixture.root + "/"),
);
assert.equal(await realpath(fixture.project), fixture.project);
assert.equal(new URL(fixture.urls[0]).protocol, "https:");
const output = resolve(process.env.NATIVE_CODEX_REFRESH_BROWSER_OUTPUT);
await mkdir(output, { mode: 0o700 });
const result = {
  diagnosticCompleted: false,
  measuresAcceptanceReceipt: false,
  profilingOverheadUncalibrated: true,
  errors: [],
  onboardingClicks: 0,
};
const save = () =>
  writeFile(join(output, "result.json"), JSON.stringify(result, null, 2), {
    mode: 0o600,
  });
const browser = await chromium.launch({
  headless: true,
  args: ["--ignore-certificate-errors-spki-list=" + fixture.spki],
});
const context = await browser.newContext({
  ignoreHTTPSErrors: true,
  viewport: { width: 1440, height: 900 },
});
let cdp,
  profiling = false,
  expectedHistoryToken;
async function composer(page) {
  const end = Date.now() + 90000;
  while (Date.now() < end) {
    for (const frame of page.frames()) {
      try {
        const parent = frame.parentFrame();
        if (!parent) continue;
        const wrapper = await parent.frameElement();
        if (
          (await wrapper.getAttribute("data-kanban-native-hidden")) !== "false"
        )
          continue;
        const next = frame.getByRole("button", { name: "Next", exact: true });
        if ((await next.count()) && (await next.isVisible())) {
          if (result.onboardingClicks >= 12) continue;
          const text = (await frame.locator("#root").innerText())
            .replace(/\b(?:Next|Back)\b/g, "")
            .trim();
          if (text) {
            await next.click({ timeout: 1500 });
            result.onboardingClicks++;
            await page.waitForTimeout(1000);
          }
          continue;
        }
        if (
          (await wrapper.getAttribute("data-kanban-native-interactive")) !==
          "true"
        )
          continue;
        if (
          (await frame
            .locator(
              `[data-above-composer-conversation-id="${fixture.threadId}"]`,
            )
            .count()) &&
          (await frame
            .locator('#root [contenteditable="true"]:visible')
            .count()) &&
          (await frame.getByText(expectedHistoryToken, { exact: true }).count())
        )
          return;
      } catch {
        /* Original frame navigation. */
      }
    }
    await page.waitForTimeout(50);
  }
  throw new Error("Exact interactive native composer did not recover");
}
try {
  const metadata = JSON.parse(
    await readFile(join(fixture.root, "manager/bridge.json"), "utf8"),
  );
  const service = await attachPrivateService({
    metadata,
    domain: fixture.domain,
  });
  const reader = await service.connect({
    name: "refresh_cpu_history_evidence",
  });
  try {
    const { thread } = await reader.request("thread/read", {
      threadId: fixture.threadId,
      includeTurns: true,
    });
    result.historyEvidence = expectedRefreshHistory(thread, {
      threadId: fixture.threadId,
      cwd: fixture.project,
    });
    expectedHistoryToken = result.historyEvidence.token;
  } finally {
    await reader.close();
  }
  await context.addInitScript(installRefreshTimingObserver);
  await context.addInitScript(
    ({ id, threadId, cwd, startupId }) => {
      if (
        window !== window.top ||
        sessionStorage.getItem("startup-profile-seeded")
      )
        return;
      const layout = JSON.stringify({
        version: 2,
        hostKey: startupId,
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
            title: "Private native timing fixture",
          },
        ],
      });
      sessionStorage.setItem(
        "kanban.codex.tab-view.v1:kanban.codex.multiwindow.v2:" + id,
        JSON.stringify(layout),
      );
      sessionStorage.setItem("startup-profile-seeded", "1");
    },
    {
      id: profile.id,
      startupId: profile.startupId,
      threadId: fixture.threadId,
      cwd: fixture.project,
    },
  );
  const page = await context.newPage();
  page.on("pageerror", (error) => {
    if (result.errors.length < 64)
      result.errors.push({
        kind: "pageerror",
        message: error.message.slice(0, 400),
      });
  });
  result.browserVersion = browser.version();
  await page.goto(fixture.urls[0] + "/?mode=codex&nativeClient=" + profile.id);
  await composer(page);
  result.initial = await captureRefreshPageTimings(page);
  await save();
  cdp = await context.newCDPSession(page);
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 1000 });
  await cdp.send("Profiler.start");
  profiling = true;
  await page.reload({ waitUntil: "domcontentloaded" });
  await composer(page);
  result.warmComposerMs = await page.evaluate(() => performance.now());
  const stopped = await cdp.send("Profiler.stop");
  profiling = false;
  result.warm = await captureRefreshPageTimings(page);
  const ids = new Set(stopped.profile.nodes.map((node) => node.id));
  result.cpuShape = {
    nodes: stopped.profile.nodes.length,
    samples: stopped.profile.samples?.length,
    deltas: stopped.profile.timeDeltas?.length,
    missingNodes: stopped.profile.samples?.filter((id) => !ids.has(id)).length,
    negativeDeltas: stopped.profile.timeDeltas?.filter(
      (delta) => Number.isFinite(delta) && delta < 0,
    ).length,
    nonFiniteDeltas: stopped.profile.timeDeltas?.filter(
      (delta) => !Number.isFinite(delta),
    ).length,
  };
  result.cpu = summarizeRefreshCpu(stopped.profile, {
    countsOnly: result.cpuShape.negativeDeltas > 0,
  });
  result.diagnosticCompleted = true;
} catch (error) {
  result.errors.push({
    kind: "diagnostic",
    message: error.message.slice(0, 600),
  });
} finally {
  if (profiling) await cdp?.send("Profiler.stop").catch(() => {});
  await cdp?.detach().catch(() => {});
  await context.close();
  await browser.close();
  await save();
}
console.log(
  JSON.stringify({
    output,
    diagnosticCompleted: result.diagnosticCompleted,
    warmComposerMs: result.warmComposerMs,
    errors: result.errors.length,
  }),
);
if (!result.diagnosticCompleted || result.errors.length) process.exitCode = 1;
