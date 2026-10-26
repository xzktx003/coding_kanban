import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import type { Json } from "../../packages/session-runtime/src/core/json";
import { ACCOUNT, createPolicyRuntime, variants, type Variant } from "./fixtures/session-feedback-policy-runtime.mts";
import { makeReader, observe } from "./fixtures/session-feedback-policy-page.mts";
import { createFeedbackEventStream } from "./fixtures/session-feedback-event-stream.mts";
const { installSessionUxFixture, seedSessionUx } = createRequire(import.meta.url)("./session-ux-fixture") as typeof import("./session-ux-fixture");
const BASE = "tests/e2e/fixtures";
const SELF = "tests/e2e/session-codex-feedback-policy.spec.mts";
const MAIN = ".session-codex-composer";
const CWD = "/fixture/项目/very-long-project-path-for-ui-regression";
const B_TEXT = "R21 B草稿不得变化";
const owner = (id: string) => JSON.stringify(["codex", "", "session", id]);
const expectedNotice = { policy: "你的组织已关闭反馈功能", configuration: "反馈功能已在你的配置中关闭", unavailable: "未能验证反馈权限。请重试" };
const sourcePaths = () => {
  const fromEntry = readFileSync("tests/e2e/session-codex-feedback-entry.spec.mts", "utf8").split("const inputs = [")[1].split("];", 1)[0];
  const paths = [...fromEntry.matchAll(/^  "([^"]+)"/gm)].map((match) => match[1]);
  const feature = "apps/web/src/session-mode/features/native-feedback";
  paths.push(...readdirSync(feature).filter((name) => /\.(?:ts|tsx|css)$/.test(name) && !name.includes(".test.")).map((name) => feature + "/" + name));
  paths.push("apps/web/src/session-mode/lib/eventStream.ts", "apps/web/src/session-mode/components/codex/composer/ModelReasonSelector.tsx", "apps/web/src/session-mode/components/codex/composer/v2/ComposerSheet.tsx", "apps/web/src/session-mode/components/codex/composer/v2/useComposerSheetHistory.ts", "apps/web/src/session-mode/components/codex/composer/v2/ComposerCommands.tsx");
  paths.push("packages/session-runtime/src/codex/feedback-preflight.ts", "apps/web/src/session-mode/components/agent/SessionTabs.tsx", "apps/web/src/components/WorkbenchModeSwitch.tsx", "apps/web/src/session-mode/session-dom.ts", "apps/web/src/session-mode/features/native-notifications/NativeNotificationCard.tsx", "apps/web/src/session-mode/features/native-notifications/service.tsx", "tests/e2e/session-codex-feedback-entry.spec.mts", SELF, BASE + "/session-feedback-policy-runtime.mts", BASE + "/session-feedback-policy-page.mts", BASE + "/session-feedback-event-stream.mts");
  return [...new Set(paths)].sort();
};
const hashes = () => sourcePaths().map((path) => ({ path, sha256: existsSync(path) ? createHash("sha256").update(readFileSync(path)).digest("hex") : null }));
const readPosts = new Set([
  "/api/session/api/codex/account/get",
  "/api/session/api/codex/feedback/preflight",
  "/api/session/api/codex/config/read",
  "/api/session/api/codex/thread/list",
  "/api/session/api/codex/thread/read",
  "/api/session/api/codex/thread/metadata",
  "/api/session/api/codex/thread/access",
  "/api/session/api/codex/thread/goal/get",
  "/api/session/api/codex/thread/turns/list",
  "/api/session/api/codex/model/list",
  "/api/session/api/codex/plugin/installed",
  "/api/session/api/codex/skills/list",
  "/api/session/api/bots/list",
  "/api/session/api/git/branch-info",
  "/api/session/api/git/status",
  "/api/session/api/git/diff-stats",
  "/api/session/api/git/file-diff-meta",
  "/api/session/api/filesystem/read-directory",
  "/api/session/subagents/snapshot",
  "/api/session/git/hunks/read",
]);
const bookkeeping = new Set([
  "/api/session/tabs", "/api/session/projects",
  "/api/session/api/telemetry/active",
  "/api/session/api/filesystem/watch", "/api/session/api/filesystem/unwatch",
]);
const mutation = /\/(?:feedback\/upload|turn\/(?:start|steer|interrupt)|thread\/(?:start|resume|fork|delete)|followups\/(?:submit|change|stop)|goal\/(?:set|clear)|config\/(?:write|batch-write))$/;

async function initialize(page: Page) {
  await seedSessionUx(page, 2);
  await page.evaluate(async ({ cwd, otherOwner, text }) => {
    const load = (path: string) => import(performance.getEntriesByType("resource").findLast((entry) => new URL(entry.name).pathname === path)?.name ?? path);
    const [{ useSessionDraftStore }, { useAgentCenterStore }, { useLayoutStore }] = await Promise.all([
      load("/src/session-mode/stores/useSessionDraftStore.ts"), load("/src/session-mode/stores/useAgentCenterStore.ts"), load("/src/session-mode/stores/useLayoutStore.ts"),
    ]);
    useSessionDraftStore.getState().setText(otherOwner, text);
    useLayoutStore.setState({ isSidebarOpen: false });
    for (const id of ["ux-1", "ux-0"]) useAgentCenterStore.getState().addAgentCard({ kind: "codex", id, cwd, preview: id === "ux-0" ? "R21 A" : "R21 B" }, { activate: id === "ux-0" });
  }, { cwd: CWD, otherOwner: owner("ux-1"), text: B_TEXT });
}

for (const width of [1440, 390]) test.describe(`${width} real-entry feedback policy`, () => {
  test.use({ viewport: { width, height: width === 1440 ? 900 : 844 }, isMobile: width === 390, hasTouch: width === 390, locale: "zh-CN" });
  for (const variant of variants) test(variant, async ({ page }, info) => {
    const sourceBefore = hashes();
    const entry = ["requirements-deny", "endpoint-503", "malformed", "deferred-aba", "deferred-other-dialog", "submit-logs-on"].includes(variant) ? "conversation-menu" : "slash";
    const prefix = `R21 ${width} ${variant} 未发送正文`;
    const expectedText = prefix + (entry === "slash" || variant === "deferred-other-dialog" ? "  " : "");
    const detail = "  R21 原始反馈\n保留正文  ";
    const upload = { threadId: "ux-0", reason: detail.trim(), classification: "bad-result", includeLogs: variant !== "submit-unknown-logs-off" };
    const api: Array<{ method: string; path: string; body: unknown; decision: string }> = [];
    const responses: Array<{ path: string; status: number; body: unknown }> = [];
    const denied: unknown[] = [], external: unknown[] = [], pageErrors: string[] = [], consoleErrors: Array<{ text: string; url: string }> = [], transportErrors: string[] = [];
    const states: Array<{ phase: string; value: any; runtime: unknown }> = [];
    const screenshots: string[] = [], captureErrors: string[] = [];
    const active = new Set<Promise<void>>();
    const origin = new URL(String(info.project.use.baseURL)).origin;
    let runtime: Awaited<ReturnType<typeof createPolicyRuntime>> | undefined;
    let stream: Awaited<ReturnType<typeof createFeedbackEventStream>> | undefined;
    let streamBeforeCleanup: ReturnType<NonNullable<typeof stream>["snapshot"]> | null = null;
    let streamCleanup: Awaited<ReturnType<NonNullable<typeof stream>["close"]>> | null = null;
    let reader: Awaited<ReturnType<typeof makeReader>> | undefined;
    let observer: Awaited<ReturnType<typeof observe>> | undefined;
    let events: unknown = null, cleanup: Awaited<ReturnType<Awaited<ReturnType<typeof createPolicyRuntime>>["close"]>> | null = null;
    let failure: string | null = null;
    const record = async (phase: string) => { if (reader) states.push({ phase, value: await reader.evaluate((read) => read()), runtime: runtime?.snapshot() }); };
    const screenshot = async (name: string) => { try { const path = info.outputPath(name); await page.screenshot({ path, fullPage: true }); screenshots.push(path); } catch (error) { captureErrors.push(String(error)); } };
    const sample = async (phase: string) => {
      await record(phase + "-immediate");
      await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
      await record(phase + "-2raf"); await page.waitForTimeout(200); await record(phase + "-settled");
    };
    const form = () => page.locator('.codex-native-feedback:not(.codex-feedback-report)[role="dialog"]');
    const switchThread = async (id: string) => {
      await page.locator(`[role="tab"][data-tab-key="codex:${id}"]`).locator(".session-identity-title").click();
      await expect.poll(async () => reader ? (await reader.evaluate((read) => read())).threadId : null).toBe(id);
      await record("actual-tab-" + id);
    };
    page.on("pageerror", (error) => pageErrors.push(String(error)));
    page.on("console", (message) => { if (message.type() === "error") consoleErrors.push({ text: message.text(), url: message.location().url }); });
    page.on("response", (response) => {
      const path = new URL(response.url()).pathname;
      if (!path.endsWith("/account/get")) return;
      const task = (async () => { responses.push({ path, status: response.status(), body: await response.json() }); })().catch((error) => transportErrors.push(String(error))).then(() => {});
      active.add(task); void task.finally(() => active.delete(task));
    });
    await page.route("**/*", async (route) => {
      const request = route.request();
      if (new URL(request.url()).origin !== origin || !["GET", "HEAD"].includes(request.method())) {
        external.push({ method: request.method(), url: request.url() }); await route.abort("blockedbyclient");
      } else await route.continue();
    });
    const fixture = await installSessionUxFixture(page, 2);
    await page.route("**/api/**", async (route) => {
      const work = (async () => {
        const request = route.request(), path = new URL(request.url()).pathname;
        let body: unknown = null; try { body = request.postData() ? request.postDataJSON() : null; } catch { body = request.postData(); }
        const isUpload = path === "/api/session/api/codex/feedback/upload";
        const allowedUpload = isUpload && request.method() === "POST" && Boolean(runtime?.state.armedUpload) && variant.startsWith("submit-") && variant !== "submit-deny";
        const decision = new URL(request.url()).origin !== origin ? "denied-origin" : mutation.test(path) && !allowedUpload ? "denied-write" : allowedUpload ? "explicit-fixture-upload" :
          ["GET", "HEAD"].includes(request.method()) || readPosts.has(path) ? "fixture-read" : bookkeeping.has(path) ? "fixture-bookkeeping" : "denied-unknown-nonread";
        const item = { method: request.method(), path, body, decision }; api.push(item);
        if (decision.startsWith("denied")) { denied.push(item); await route.fulfill({ status: 409, json: { error: "R21 policy refuses unrequested writes" } }); }
        else if (path === "/api/session/api/events" && request.method() === "GET") {
          if (!stream) throw Error("Owned persistent SSE not initialized");
          // Preserve the real EventSource; only this exact read route targets our owned comments-only listener.
          await route.continue({ url: stream.url });
        }
        else if (path === "/api/session/api/codex/account/get") await route.fulfill({ json: ACCOUNT });
        else if (path === "/api/session/api/codex/feedback/preflight" || isUpload) {
          if (!runtime || request.method() !== "POST") throw Error("Runtime POST bridge not initialized");
          const result = await runtime.inject(isUpload ? "/api/codex/feedback/upload" : "/api/codex/feedback/preflight", body as Json);
          await route.fulfill({ status: result.status, contentType: result.contentType, body: result.body });
        } else await route.fallback();
      })().catch((error) => { transportErrors.push(String(error)); });
      active.add(work); try { await work; } finally { active.delete(work); }
    });
    try {
      runtime = await createPolicyRuntime(fixture.threads[0], variant);
      stream = await createFeedbackEventStream(origin);
      await page.goto("/?mode=session&view=agent", { waitUntil: "domcontentloaded" });
      const editor = page.locator(MAIN).locator('[contenteditable="true"]').first(); await editor.waitFor({ state: "visible" });
      await initialize(page);
      reader = await makeReader(page, owner("ux-0"), owner("ux-1"));
      // Observe the real EventSource onopen; never inject a connected/readiness value.
      await expect.poll(async () => (await reader!.evaluate((read) => read())).eventStreamConnected).toBe(true);
      await editor.fill(prefix + (entry === "slash" ? " /feedback" : ""));
      await record("before-entry"); await screenshot("before-entry.png"); observer = await observe(page);
      if (entry === "slash") await page.locator('[data-composer-suggestions="commands"]').getByRole("option", { name: /\/feedback/ }).click();
      else {
        await page.getByRole("button", { name: "附加文件", exact: true }).click();
        await page.getByRole("button", { name: "当前会话的更多操作", exact: true }).click();
        await page.getByRole("menuitem", { name: "反馈", exact: true }).click();
      }
      await sample("entry");
      if (variant.startsWith("deferred-")) {
        await expect.poll(() => runtime!.state.holdSeen).toBe(true); await record("native-read-held");
        if (variant === "deferred-hidden") {
          await page.getByRole("group", { name: "工作模式", exact: true }).getByRole("button", { name: "终端", exact: true }).click();
          await record("mode-hidden");
          await page.getByRole("group", { name: "工作模式", exact: true }).getByRole("button", { name: "会话", exact: true }).click();
          await record("mode-shown");
        } else if (variant === "deferred-other-dialog") {
          // A real /model command supersedes the pending menu feedback request.
          await page.keyboard.press("Escape");
          await expect(page.locator(".session-composer-menu")).not.toBeVisible();
          await editor.click(); await editor.fill(prefix + " /model");
          await page.locator('[data-composer-suggestions="commands"]').getByRole("option", { name: /\/model/ }).click();
          await page.locator('.session-composer-sheet[role="dialog"]').getByRole("heading", { name: "模型与思考强度", exact: true }).waitFor({ state: "visible" });
          await record("other-dialog-open"); await screenshot("other-dialog-open.png");
        } else { await switchThread("ux-1"); if (variant === "deferred-aba") await switchThread("ux-0"); }
        runtime.release();
        await expect.poll(() => runtime!.injections.length).toBe(1);
        await sample("late-allow"); await screenshot("late-allow.png");
        if (variant === "deferred-hidden") {
          // A later, explicit user request must work after the stale hidden request was discarded.
          await editor.fill(prefix + " /feedback");
          await page.locator('[data-composer-suggestions="commands"]').getByRole("option", { name: /\/feedback/ }).click();
          await expect.poll(() => runtime!.injections.length).toBe(2);
          await form().waitFor({ state: "visible" }); await record("fresh-open-after-hide"); await screenshot("fresh-open-after-hide.png");
          await page.keyboard.press("Escape"); await sample("fresh-escape");
        }
      } else {
        await expect.poll(() => runtime!.injections.length).toBe(1);
        if (variant === "submit-deny" || variant.startsWith("submit-logs") || variant === "submit-unknown-logs-off") {
          await form().waitFor({ state: "visible" }); await record("form-open"); await screenshot("form-open.png");
          await form().getByRole("radio", { name: "结果异常", exact: true }).click();
          await form().getByRole("textbox", { name: "填写详情（必填）", exact: true }).fill(detail);
          if (!upload.includeLogs) await form().getByRole("checkbox").click();
          await record("form-consent-and-details");
          runtime.state.phase = 1;
          if (variant === "submit-deny") runtime.state.projectEnabled = false;
          else runtime.armUpload(upload);
          await form().getByRole("button", { name: "提交", exact: true }).click();
          await expect.poll(() => runtime!.injections.filter((x) => x.path.endsWith("/preflight")).length).toBe(2);
          await sample("submit");
          if (variant !== "submit-deny") {
            await expect.poll(() => runtime!.state.uploads.length).toBe(1);
            await page.locator('.codex-feedback-report[role="dialog"]').waitFor({ state: "visible" });
            await sample("report"); await screenshot("report.png");
            if (variant === "submit-unknown-logs-off") {
              await page.waitForTimeout(1000); await record("unknown-no-auto-retry");
              await page.locator('.codex-feedback-report[role="dialog"]').getByRole("button", { name: "关闭", exact: true }).click();
              await page.waitForTimeout(500); await record("unknown-dismissed-no-resend");
            }
          }
        } else { await page.waitForTimeout(200); await record("denial-delivered"); }
      }
    } catch (error) { failure = String(error); }
    finally {
      runtime?.release(); await Promise.allSettled([...active]);
      await record("final-before-assert").catch((error) => captureErrors.push(String(error)));
      await screenshot("final-before-assert.png");
      if (observer) { events = await observer.evaluate((audit) => audit.read()); await observer.evaluate((audit) => audit.dispose()); await observer.dispose(); }
      if (runtime) cleanup = await runtime.close();
      if (stream) {
        streamBeforeCleanup = stream.snapshot();
        // Release this test's document/EventSource before ending its owned listener.
        try { await page.goto("about:blank"); } catch (error) { captureErrors.push("Fixture page cleanup: " + String(error)); }
        streamCleanup = await stream.close();
      }
      const output = info.outputPath("feedback-policy.json");
      writeFileSync(output, JSON.stringify({ schema: "r21-policy-candidate-v2", width, variant, entry, sourceBefore, sourceAfter: hashes(), states, screenshots, captureErrors, api, responses, denied, external, pageErrors, consoleErrors, transportErrors, events, cleanup, streamBeforeCleanup, streamCleanup, upload, expectedText, failure,
        boundary: "Local HTTP fixture/API-key + actual runtime handlers/app.inject. No original/native/SDK/account/network uploads. 503/body truncation are explicit gateway fault injections retaining original handler evidence." }, null, 2) + "\n");
      await info.attach("feedback-policy", { path: output, contentType: "application/json" }); await reader?.dispose();
    }
    expect(failure).toBeNull(); expect(captureErrors).toEqual([]); expect(hashes()).toEqual(sourceBefore);
    expect(pageErrors).toEqual([]); expect(transportErrors).toEqual([]);
    expect(consoleErrors.filter((message) => !(
      (message.url.endsWith("/@vite/client") && message.text.startsWith("[vite] failed to connect to websocket.")) ||
      (variant === "endpoint-503" && message.url.endsWith("/feedback/preflight") && message.text.includes("503")) ||
      (variant === "submit-unknown-logs-off" && message.url.endsWith("/feedback/upload") && message.text.includes("500"))
    ))).toEqual([]);
    expect(denied).toEqual([]); expect(external).toEqual([]);
    expect(streamBeforeCleanup).not.toBeNull(); expect(streamCleanup).not.toBeNull();
    expect(streamBeforeCleanup!.acceptedRequests).toBeGreaterThan(0);
    expect(streamBeforeCleanup!.requestOverflow).toBe(false); expect(streamBeforeCleanup!.serverErrorCount).toBe(0);
    expect(streamBeforeCleanup!.requests.every((request) => request.accepted && request.method === "GET")).toBe(true);
    expect(streamBeforeCleanup!.activeResponses).toBeGreaterThan(0);
    expect(streamCleanup!.errors).toEqual([]); expect(streamCleanup!.closed).toBe(true); expect(streamCleanup!.listening).toBe(false);
    expect(streamCleanup!.activeResponses).toBe(0); expect(streamCleanup!.activeSockets).toBe(0); expect(streamCleanup!.addressCleared).toBe(true);
    expect(streamCleanup!.processIdentity).toEqual(streamBeforeCleanup!.processIdentity);
    expect(streamCleanup!.connections.every((connection) => connection.closedAtMs !== null && connection.writeErrors === 0)).toBe(true);
    expect(cleanup!.closed).toBe(true); expect(cleanup!.listening).toBe(false); expect(cleanup!.errors).toEqual([]); expect(cleanup!.forbidden).toEqual([]); expect(cleanup!.ownershipIds).toEqual([]);
    expect(responses.length).toBeGreaterThan(0); for (const response of responses) { expect(response.status).toBe(200); expect(response.body).toEqual(ACCOUNT); }
    const before = states.find((x) => x.phase === "before-entry")!.value;
    const after = states.at(-1)!.value;
    for (const state of states.filter((x) => x.phase !== "before-entry")) {
      const beforeOtherDialog = variant === "deferred-other-dialog" && (state.phase.startsWith("entry-") || state.phase === "native-read-held");
      expect(state.value.draft.text).toBe(beforeOtherDialog ? prefix : expectedText); expect(state.value.otherDraft).toEqual(before.otherDraft); expect(state.value.defaults).toEqual(before.defaults); expect(state.value.workspaceCwd).toBe(CWD);
    }
    expect(before.otherDraft.text).toBe(B_TEXT); expect(after.forms).toHaveLength(0);
    const expectedId = variant === "deferred-switch" ? "ux-1" : "ux-0"; expect(after.threadId).toBe(expectedId); expect(after.owner).toBe(owner(expectedId));
    expect((events as any).overflow).toBe(false);
    const trusted = (events as any).events.filter((e: any) => e.type === "click" && e.trusted);
    expect(trusted.filter((e: any) => entry === "slash" ? e.role === "option" && e.inCommands && e.text?.includes("/feedback") : e.role === "menuitem" && e.text === "反馈")).toHaveLength(variant === "deferred-hidden" ? 2 : 1);
    const preflights = cleanup!.injections.filter((x) => x.path.endsWith("/preflight"));
    expect(preflights).toHaveLength(variant.startsWith("submit-") || variant === "deferred-hidden" ? 2 : 1);
    for (const read of preflights) expect(read.body).toEqual({ threadId: "ux-0" });
    // Actual runtime rechecks both account and thread metadata after the policy reads.
    for (const method of ["account/read", "thread/read"])
      expect(cleanup!.rawCalls.filter((call) => call.method === method)).toHaveLength(preflights.length * 2);
    for (const method of ["config/read", "configRequirements/read"])
      expect(cleanup!.rawCalls.filter((call) => call.method === method)).toHaveLength(preflights.length);
    expect(cleanup!.rawCalls.filter((x) => x.method === "config/read").every((x) => JSON.stringify(x.params) === JSON.stringify({ cwd: CWD, includeLayers: false }))).toBe(true);
    const infoNotice = variant === "requirements-deny" ? expectedNotice.policy : ["project-deny", "submit-deny"].includes(variant) ? expectedNotice.configuration : ["endpoint-503", "malformed"].includes(variant) ? expectedNotice.unavailable : null;
    if (infoNotice) expect(after.notices).toContainEqual(expect.objectContaining({ text: expect.stringContaining(infoNotice), level: "info" }));
    if (variant.startsWith("deferred-")) {
      expect((preflights[0].response as any).reason).toBeNull();
      expect(after.notices).toEqual([]); expect(after.reports).toEqual([]);
      const late = states.find((x) => x.phase === "late-allow-settled")!.value;
      expect(late.forms).toEqual([]); expect(late.notices).toEqual([]); expect(late.reportMetadata).toEqual([]);
      if (variant === "deferred-hidden") {
        expect(states.find((x) => x.phase === "mode-hidden")!.value.sessionVisible).toBe(false);
        expect(states.find((x) => x.phase === "fresh-open-after-hide")!.value.forms).toHaveLength(1);
        expect((preflights[1].response as any).reason).toBeNull();
      }
      else if (variant === "deferred-other-dialog") {
        expect(states.find((x) => x.phase === "other-dialog-open")!.value.dialogs).toContainEqual(expect.objectContaining({ text: expect.stringContaining("模型与思考强度") }));
        expect(late.dialogs).toContainEqual(expect.objectContaining({ text: expect.stringContaining("模型与思考强度") }));
        expect(after.dialogs).toContainEqual(expect.objectContaining({ text: expect.stringContaining("模型与思考强度") }));
        expect(trusted.filter((e: any) => e.role === "option" && e.inCommands && e.text?.includes("/model"))).toHaveLength(1);
      } else expect(trusted.filter((e: any) => e.role === "tab").length).toBe(variant === "deferred-aba" ? 2 : 1);
    }
    if (variant === "requirements-deny") expect((preflights[0].response as any).reason).toBe("policy");
    if (variant === "project-deny") { expect(cleanup!.state.globalEnabled).toBe(true); expect((preflights[0].response as any).reason).toBe("configuration"); }
    if (variant === "submit-deny") { expect((preflights[0].response as any).reason).toBeNull(); expect((preflights[1].response as any).reason).toBe("configuration"); }
    if (variant === "endpoint-503") { expect(preflights[0].status).toBe(200); expect(preflights[0].wireStatus).toBe(503); }
    if (variant === "malformed") { expect(preflights[0].status).toBe(200); expect(preflights[0].wireBody).toBe("{"); }
    const sent = cleanup!.state.uploads;
    if (["submit-logs-on", "submit-unknown-logs-off"].includes(variant)) {
      expect(sent).toEqual([upload]); expect(api.filter((x) => x.decision === "explicit-fixture-upload")).toHaveLength(1);
      expect(preflights.every((x) => (x.response as any).reason === null)).toBe(true);
      const report = states.find((x) => x.phase === "report-settled")!.value;
      expect(report.reportMetadata).toEqual([{ owner: owner("ux-0"), status: variant === "submit-logs-on" ? "uploaded" : "unconfirmed", open: true, correlationId: variant === "submit-logs-on" ? "r21-policy-feedback-receipt" : "ux-0" }]);
      expect(report.reports).toHaveLength(1); expect(report.reports[0].retry).toBe(false);
      expect(report.reports[0].text).toContain(variant === "submit-logs-on" ? "反馈已提交" : "反馈上传未确认");
      if (variant === "submit-unknown-logs-off") expect(after.reports).toEqual([]);
    } else expect(sent).toEqual([]);
  });
});
