import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import type { Json } from "../../packages/session-runtime/src/core/json";
import { ACCOUNT_RESPONSE, RUNTIME_INSTANCE, createRuntimePreflightFixture } from "./fixtures/session-feedback-preflight-runtime.mts";
import { createFeedbackEventStream } from "./fixtures/session-feedback-event-stream.mts";
const { installSessionUxFixture, seedSessionUx } = createRequire(import.meta.url)("./session-ux-fixture") as typeof import("./session-ux-fixture");

// Candidate only: no component mount, production open-state setter or native/reference import.
const SELF = "tests/e2e/session-codex-feedback-entry.spec.mts";
const CWD = "/fixture/项目/very-long-project-path-for-ui-regression";
const MAIN = ".session-codex-composer";
const OTHER_ID = "r21-other-owner";
const OTHER_TEXT = "R21 另一 owner 的草稿不得变化";
const inputs = [
  "apps/web/src/session-mode/components/codex/composer/Composer.tsx",
  "apps/web/src/session-mode/components/codex/composer/SlashCommandsSelector.tsx",
  "apps/web/src/session-mode/components/codex/composer/slashCommands.ts",
  "apps/web/src/session-mode/components/codex/composer/SlashCommandDialogs.tsx",
  "apps/web/src/session-mode/components/codex/composer/ConversationMenu.tsx",
  "apps/web/src/session-mode/components/codex/composer/ComposerMenu.tsx",
  "apps/web/src/session-mode/components/codex/composer/NativeFeedbackDialog.tsx",
  "apps/web/src/session-mode/components/codex/composer/native-feedback.css",
  "apps/web/src/session-mode/components/common/useComposerPopover.ts",
  "apps/web/src/session-mode/components/ui/dialog.tsx",
  "apps/web/src/session-mode/components/ui/dropdown-menu.tsx",
  "apps/web/src/session-mode/components/codex/stores/useCodexStore.ts",
  "apps/web/src/session-mode/components/codex/stores/index.ts",
  "apps/web/src/session-mode/components/codex/stores/useConfigStore.ts",
  "apps/web/src/session-mode/stores/useSessionDraftStore.ts",
  "apps/web/src/session-mode/stores/useWorkspaceStore.ts",
  "apps/web/src/session-mode/stores/useAgentCenterStore.ts",
  "apps/web/src/session-mode/features/native-feedback/service.ts",
  "apps/web/src/session-mode/features/native-feedback/controller.ts",
  "apps/web/src/session-mode/features/native-feedback/NativeFeedbackUploads.tsx",
  "apps/web/src/session-mode/features/native-feedback/preflight.ts",
  "apps/web/src/session-mode/features/native-feedback/preflightMessages.ts",
  "apps/web/src/session-mode/features/native-feedback/preflightWorkflow.tsx",
  "apps/web/src/session-mode/lib/eventStream.ts",
  "apps/web/src/session-mode/App.tsx",
  "tests/e2e/session-ux-fixture.ts",
  "packages/session-runtime/src/codex/routes.ts",
  "packages/session-runtime/src/codex/client.ts",
  "packages/session-runtime/src/codex/protocol.ts",
  "packages/session-runtime/src/codex/projection.ts",
  "packages/session-runtime/src/codex/ownership.ts",
  "packages/session-runtime/src/core/events.ts",
  "packages/session-runtime/src/core/json.ts",
  "tests/e2e/fixtures/session-feedback-preflight-runtime.mts",
  "tests/e2e/fixtures/session-feedback-event-stream.mts",
  SELF,
];
const optionalInputs = ["packages/session-runtime/src/codex/feedback-preflight.ts"];
const hashes = () => [...inputs, ...optionalInputs].map((path) => ({
  path,
  sha256: existsSync(path) ? createHash("sha256").update(readFileSync(path)).digest("hex") : null,
}));
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
  await seedSessionUx(page, 1);
  return page.evaluate(async ({ otherId, otherText, cwd }) => {
    const load = (path: string) => import(
      performance.getEntriesByType("resource")
        .findLast((entry) => new URL(entry.name).pathname === path)?.name ?? path
    );
    const [{ useSessionDraftStore, sessionDraftKey }, { useAgentCenterStore }, { useLayoutStore }] = await Promise.all([
      load("/src/session-mode/stores/useSessionDraftStore.ts"),
      load("/src/session-mode/stores/useAgentCenterStore.ts"),
      load("/src/session-mode/stores/useLayoutStore.ts"),
    ]);
    // Initial fixture ownership only; no feedback/modal/readiness/cache mutation.
    const otherOwner = sessionDraftKey("codex", otherId);
    useSessionDraftStore.getState().setText(otherOwner, otherText);
    useLayoutStore.setState({ isSidebarOpen: false });
    useAgentCenterStore.getState().addAgentCard({
      kind: "codex", id: "ux-0", cwd, preview: "R21 自然反馈入口",
    }, { activate: true });
    return { otherOwner, owner: sessionDraftKey("codex", "ux-0") };
  }, { otherId: OTHER_ID, otherText: OTHER_TEXT, cwd: CWD });
}

async function makeReader(page: Page, owner: string, otherOwner: string) {
  return page.evaluateHandle(async ({ owner, otherOwner }) => {
    const paths = [
      "/src/session-mode/components/codex/stores/useCodexStore.ts",
      "/src/session-mode/components/codex/stores/useConfigStore.ts",
      "/src/session-mode/stores/useSessionDraftStore.ts",
      "/src/session-mode/stores/useWorkspaceStore.ts",
      "/src/session-mode/lib/eventStream.ts",
    ];
    // Reuse mounted resource identities. This getter never calls a setter or read API.
    const urls = paths.map((path) => {
      const found = performance.getEntriesByType("resource")
        .findLast((entry) => new URL(entry.name).pathname === path)?.name;
      if (!found) throw new Error("Mounted store unavailable: " + path);
      return found;
    });
    const [{ useCodexStore }, { useConfigStore }, { useSessionDraftStore }, { useWorkspaceStore }, { isEventStreamConnected }] =
      await Promise.all(urls.map((url) => import(url)));
    const describe = (node: Element | null) => node ? {
      tag: node.tagName, role: node.getAttribute("role"),
      label: node.getAttribute("aria-label"), text: node.textContent?.slice(0, 200),
      className: node.getAttribute("class"),
    } : null;
    const visible = (node: Element) => {
      const rect = node.getBoundingClientRect(), css = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && css.display !== "none" &&
        css.visibility !== "hidden" && !node.closest('[inert], [aria-hidden="true"]');
    };
    return () => {
      const codex = useCodexStore.getState(), config = useConfigStore.getState();
      const thread = codex.threads.find((item: { id: string }) => item.id === codex.currentThreadId);
      const composer = document.querySelector(".session-codex-composer");
      const editor = composer?.querySelector('[contenteditable="true"]');
      const forms = [...document.querySelectorAll('.codex-native-feedback[role="dialog"]')].filter(visible);
      const rect = (node: Element) => {
        const r = node.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      };
      return JSON.parse(JSON.stringify({
        moduleURLs: urls, time: performance.now(),
        threadId: codex.currentThreadId,
        thread: thread ? { id: thread.id, cwd: thread.cwd, status: thread.status } : null,
        workspaceCwd: useWorkspaceStore.getState().cwd,
        owner: composer?.getAttribute("data-draft-owner"),
        draft: useSessionDraftStore.getState().drafts[owner] ?? { text: "", revision: 0 },
        otherDraft: useSessionDraftStore.getState().drafts[otherOwner] ?? null,
        editorText: editor?.textContent ?? null,
        defaults: {
          model: config.model, modelProvider: config.modelProvider,
          reasoningEffort: config.reasoningEffort, sandbox: config.sandbox,
          approvalPolicy: config.approvalPolicy, serviceTier: config.serviceTier,
        },
        forms: forms.map((node) => ({
          ...describe(node), rect: rect(node),
          title: node.querySelector('h1,h2,h3,[data-slot="dialog-title"]')?.textContent ?? null,
          details: [...node.querySelectorAll("textarea")].map((n) => ({ label: n.getAttribute("aria-label"), value: n.value })),
          radios: [...node.querySelectorAll('[role="radio"]')].map(describe),
        })),
        dialogs: [...document.querySelectorAll('[role="dialog"],[role="alertdialog"]')].filter(visible).map(describe),
        commandOptions: [...document.querySelectorAll('[data-composer-suggestions="commands"] [role="option"]')].map(describe),
        menuItems: [...document.querySelectorAll('[role="menuitem"]')].filter(visible).map(describe),
        active: describe(document.activeElement),
        viewport: { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth },
        html: { pointerEvents: getComputedStyle(document.documentElement).pointerEvents },
        body: { pointerEvents: getComputedStyle(document.body).pointerEvents },
        language: document.documentElement.lang,
        eventStreamConnected: isEventStreamConnected(),
      }));
    };
  }, { owner, otherOwner });
}

async function observe(page: Page) {
  return page.evaluateHandle(() => {
    const events: Array<Record<string, unknown>> = [];
    let overflow = false;
    const push = (value: Record<string, unknown>) => {
      if (events.length >= 256) { overflow = true; return; }
      events.push(value);
    };
    const input = (event: Event) => {
      const node = event.target instanceof Element ? event.target : null;
      const action = node?.closest('button,[role="option"],[role="menuitem"]');
      push({ type: event.type, trusted: event.isTrusted, time: performance.now(),
        key: event instanceof KeyboardEvent ? event.key : null,
        role: action?.getAttribute("role"), label: action?.getAttribute("aria-label"),
        text: action?.textContent?.trim().slice(0, 200) ?? null,
        inComposer: Boolean(node?.closest(".session-codex-composer")),
        inCommands: Boolean(node?.closest('[data-composer-suggestions="commands"]')),
      });
    };
    const notification = (event: Event) => push({
      type: event.type, trusted: event.isTrusted, time: performance.now(),
      hasDetail: "detail" in event,
    });
    const types = ["pointerdown", "click", "keydown", "focusin"];
    types.forEach((type) => document.addEventListener(type, input, true));
    // Passive audit only: no listener opens/mounts a form or changes application state.
    window.addEventListener("codex-open-feedback", notification);
    return {
      read: () => ({ events: [...events], overflow }),
      dispose: () => {
        types.forEach((type) => document.removeEventListener(type, input, true));
        window.removeEventListener("codex-open-feedback", notification);
      },
    };
  });
}

for (const width of [1440, 390]) {
  test.describe(`${width} natural feedback entry`, () => {
    test.use({ viewport: { width, height: width === 1440 ? 900 : 844 },
      isMobile: width === 390, hasTouch: width === 390, locale: "zh-CN" });
    for (const entry of ["slash", "conversation-menu"] as const) {
      test(entry, async ({ page }, info) => {
        const sourceBefore = hashes();
        const api: Array<{ method: string; path: string; body: unknown; decision: string }> = [];
        const responses: Array<{ method: string; path: string; status: number; json?: unknown; error?: string }> = [];
        const responseTasks: Promise<void>[] = [];
        const denied: Array<Record<string, unknown>> = [], external: Array<Record<string, unknown>> = [];
        const pageErrors: string[] = [], consoleErrors: Array<{ text: string; url: string }> = [];
        const captures: Array<{ phase: string; value: any }> = [];
        const screenshots: string[] = [], captureErrors: string[] = [];
        const draftPrefix = `R21 正文保留 ${width} ${entry}`;
        const initialText = entry === "slash" ? draftPrefix + " /feedback" : draftPrefix;
        // SlashCommandsSelector consumes just the trailing command via replaceAtTrigger.
        const expectedText = entry === "slash" ? draftPrefix + "  " : draftPrefix;
        const origin = new URL(String(info.project.use.baseURL)).origin;
        let reader: Awaited<ReturnType<typeof makeReader>> | undefined;
        let observer: Awaited<ReturnType<typeof observe>> | undefined;
        let events: { events: Array<Record<string, unknown>>; overflow: boolean } | null = null;
        let failure: string | null = null;
        let runtime: Awaited<ReturnType<typeof createRuntimePreflightFixture>> | undefined;
        let runtimeCleanup: Awaited<ReturnType<Awaited<ReturnType<typeof createRuntimePreflightFixture>>["close"]>> | null = null;
        let stream: Awaited<ReturnType<typeof createFeedbackEventStream>> | undefined;
        let streamBeforeCleanup: ReturnType<NonNullable<typeof stream>["snapshot"]> | null = null;
        let streamCleanup: Awaited<ReturnType<NonNullable<typeof stream>["close"]>> | null = null;
        const screenshot = async (name: string) => {
          const path = info.outputPath(name);
          try { await page.screenshot({ path, fullPage: true }); screenshots.push(path); }
          catch (error) { captureErrors.push(`${name}: ${String(error)}`); }
        };
        const record = async (phase: string) => {
          if (!reader) throw new Error("Readonly reader not initialized");
          captures.push({ phase, value: await reader.evaluate((read) => read()) });
        };
        page.on("pageerror", (error) => pageErrors.push(String(error)));
        page.on("console", (message) => {
          if (message.type() === "error") consoleErrors.push({ text: message.text(), url: message.location().url });
        });
        page.on("response", (response) => {
          const request = response.request(), path = new URL(response.url()).pathname;
          if (!path.includes("/api/")) return;
          const task = (async () => {
            const result: (typeof responses)[number] = { method: request.method(), path, status: response.status() };
            // Keep fixture read responses, without streaming EventSource bodies.
            if (response.headers()["content-type"]?.includes("application/json")) {
              try { result.json = await response.json(); } catch (error) { result.error = String(error); }
            }
            responses.push(result);
          })();
          responseTasks.push(task);
        });
        // Static resources are GET-only to the declared isolated LAN frontend.
        await page.route("**/*", async (route) => {
          const request = route.request();
          if (new URL(request.url()).origin !== origin || !["GET", "HEAD"].includes(request.method())) {
            external.push({ method: request.method(), url: request.url() });
            await route.abort("blockedbyclient");
          } else await route.continue();
        });
        const fixture = await installSessionUxFixture(page, 1);
        await page.route("**/api/**", async (route) => {
          const request = route.request(), path = new URL(request.url()).pathname;
          let body: unknown = null;
          try { body = request.postData() ? request.postDataJSON() : null; }
          catch { body = request.postData(); }
          const sameOrigin = new URL(request.url()).origin === origin;
          const decision = !sameOrigin ? "denied-origin" : mutation.test(path) ? "denied-mutation" :
            ["GET", "HEAD"].includes(request.method()) || readPosts.has(path) ? "fixture-read" :
            bookkeeping.has(path) ? "fixture-bookkeeping" : "denied-unknown-nonread";
          const record = { method: request.method(), path, body, decision };
          api.push(record);
          if (decision.startsWith("denied")) {
            denied.push(record);
            await route.fulfill({ status: 409, json: { error: "R21 candidate denies uploads, mutations and unknown non-reads" } });
          } else if (path === "/api/session/api/events" && request.method() === "GET") {
            if (!stream) throw new Error("Owned persistent SSE not initialized");
            await route.continue({ url: stream.url });
          } else if (path === "/api/session/api/codex/account/get") {
            if (!runtime) throw new Error("R21 runtime identity not initialized");
            await route.fulfill({ json: runtime.accountResponse });
          } else if (path === "/api/session/api/codex/feedback/preflight") {
            if (!runtime || request.method() !== "POST") throw new Error("R21 preflight expects initialized POST-only runtime fixture");
            const response = await runtime.inject(body as Json);
            await route.fulfill({ status: response.status, contentType: response.contentType, body: response.body });
          } else await route.fallback();
        });
        try {
          runtime = await createRuntimePreflightFixture(fixture.threads[0]);
          stream = await createFeedbackEventStream(origin);
          await page.goto("/?mode=session&view=agent", { waitUntil: "domcontentloaded" });
          const editor = page.locator(MAIN).locator('[contenteditable="true"]').first();
          await editor.waitFor({ state: "visible" });
          const owners = await initialize(page);
          reader = await makeReader(page, owners.owner, owners.otherOwner);
          await expect.poll(async () => (await reader!.evaluate((read) => read())).eventStreamConnected).toBe(true);
          await editor.fill(initialText);
          await record("before-entry");
          await screenshot("before-entry.png");
          observer = await observe(page);
          if (entry === "slash") {
            const option = page.locator('[data-composer-suggestions="commands"]').getByRole("option", { name: /\/feedback/ });
            await option.click();
          } else {
            // This is the actual composer attachment/actions popover, then its nested menu.
            await page.getByRole("button", { name: "附加文件", exact: true }).click();
            await page.getByRole("button", { name: "当前会话的更多操作", exact: true }).click();
            await record("conversation-menu-open");
            await page.getByRole("menuitem", { name: "反馈", exact: true }).click();
          }
          await record("entry-immediate");
          await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
          await record("entry-2raf");
          await page.waitForTimeout(200);
          await record("entry-settled");
          await screenshot("entry-settled.png");
          // Do not wait for a missing dialog and lose the baseline evidence to a locator timeout.
        } catch (error) { failure = String(error); }
        finally {
          if (reader) await record("final-before-assert").catch((error) => captureErrors.push(String(error)));
          await screenshot("final-before-assert.png");
          if (observer) {
            events = await observer.evaluate((audit) => audit.read()).catch((error) => { captureErrors.push(String(error)); return null; });
            await observer.evaluate((audit) => audit.dispose()).catch((error) => captureErrors.push(String(error)));
            await observer.dispose();
          }
          await Promise.allSettled(responseTasks);
          if (runtime) runtimeCleanup = await runtime.close();
          const actualURL = page.url();
          if (stream) {
            streamBeforeCleanup = stream.snapshot();
            try { await page.goto("about:blank"); }
            catch (error) { captureErrors.push("Fixture page cleanup: " + String(error)); }
            streamCleanup = await stream.close();
          }
          const state = {
            schema: "r21-feedback-entry-candidate-v2", entry, width,
            baseURL: String(info.project.use.baseURL), actualURL,
            executionBoundary: "Local product + isolated API/WS fixture; no original/native/account/SDK/feedback submission.",
            authorizationBoundary: "Public account/get and raw account/read share the same complete synthetic apiKey snapshot. Preflight responses are produced only by actual runtime registerCodexRoutes via app.inject, with exact four-method read-only RPC fixtures; no hand-written reason/provenance result.",
            runtime: runtime?.snapshot() ?? null, runtimeCleanup, streamBeforeCleanup, streamCleanup,
            sourceBefore, sourceAfter: hashes(), captures, screenshots, captureErrors,
            events, api, responses, denied, external, pageErrors, consoleErrors,
            fixtureCalls: fixture.calls, expectedText, failure,
          };
          const output = info.outputPath("feedback-entry.json");
          writeFileSync(output, JSON.stringify(state, null, 2) + "\n");
          await info.attach("feedback-entry", { path: output, contentType: "application/json" });
          await reader?.dispose();
        }
        // All evidence is written before any product assertion below, including on harness failure.
        expect(failure, "Natural entry input/fixture must complete before judging a product result").toBeNull();
        expect(captureErrors).toEqual([]);
        expect(hashes()).toEqual(sourceBefore);
        expect(pageErrors).toEqual([]);
        expect(external).toEqual([]);
        expect(denied).toEqual([]);
        expect(api.filter((request) => request.path.endsWith("/feedback/upload"))).toEqual([]);
        expect(events?.overflow).toBe(false);
        expect(runtimeCleanup, "In-process runtime cleanup must be recorded").not.toBeNull();
        expect(runtimeCleanup!.errors).toEqual([]);
        expect(runtimeCleanup!.closed).toBe(true);
        expect(runtimeCleanup!.listening).toBe(false);
        expect(runtimeCleanup!.forbidden).toEqual([]);
        expect(runtimeCleanup!.ownershipIds).toEqual([]);
        expect(streamBeforeCleanup).not.toBeNull(); expect(streamCleanup).not.toBeNull();
        expect(streamBeforeCleanup!.acceptedRequests).toBeGreaterThan(0);
        expect(streamBeforeCleanup!.activeResponses).toBeGreaterThan(0);
        expect(streamBeforeCleanup!.requestOverflow).toBe(false);
        expect(streamBeforeCleanup!.serverErrorCount).toBe(0);
        expect(streamBeforeCleanup!.requests.every((request) => request.accepted && request.method === "GET")).toBe(true);
        expect(streamCleanup!.errors).toEqual([]); expect(streamCleanup!.closed).toBe(true);
        expect(streamCleanup!.listening).toBe(false); expect(streamCleanup!.addressCleared).toBe(true);
        expect(streamCleanup!.activeResponses).toBe(0); expect(streamCleanup!.activeSockets).toBe(0);
        expect(streamCleanup!.processIdentity).toEqual(streamBeforeCleanup!.processIdentity);
        expect(streamCleanup!.connections.every((connection) => connection.closedAtMs !== null && connection.writeErrors === 0)).toBe(true);
        const publicAccountReads = responses.filter((response) => response.path === "/api/session/api/codex/account/get");
        expect(publicAccountReads.length, "Frontend account identity must actually be read").toBeGreaterThan(0);
        for (const response of publicAccountReads) {
          expect(response.status).toBe(200);
          expect(response.json).toEqual(ACCOUNT_RESPONSE);
        }
        const before = captures.find((capture) => capture.phase === "before-entry")!.value;
        const after = captures.find((capture) => capture.phase === "entry-settled")!.value;
        expect(before.threadId).toBe("ux-0");
        expect(before.thread.cwd).toBe(CWD);
        expect(after.threadId).toBe(before.threadId);
        expect(after.thread).toEqual(before.thread);
        expect(after.workspaceCwd).toBe(before.workspaceCwd);
        expect(after.owner).toBe(before.owner);
        expect(after.defaults).toEqual(before.defaults);
        expect(after.otherDraft).toEqual(before.otherDraft);
        expect(after.otherDraft.text).toBe(OTHER_TEXT);
        expect(after.draft.text).toBe(expectedText);
        const trustedClicks = events!.events.filter((event) => event.type === "click" && event.trusted === true);
        expect(trustedClicks.filter((event) => entry === "slash" ? event.role === "option" && event.inCommands && String(event.text).includes("/feedback") : event.role === "menuitem" && event.text === "反馈")).toHaveLength(1);
        if (entry === "conversation-menu")
          expect(events!.events.filter((event) => event.type === "codex-open-feedback")).toHaveLength(1);
        // Intended natural-entry RED on the current unwired baseline; not executed in preparation.
        expect(after.forms, "The real feedback entry must mount its production form").toHaveLength(1);
        expect(after.forms[0].title).toBe("提交反馈");
        expect(after.forms[0].details).toEqual([{ label: "填写详情（必填）", value: "" }]);
        expect(after.forms[0].radios).toHaveLength(6);
        // This is an assertion about the real handler's output, never a response stub.
        expect(runtimeCleanup!.injections).toHaveLength(1);
        const preflight = runtimeCleanup!.injections[0];
        expect(preflight.status).toBe(200);
        expect(preflight.body).toEqual(expect.objectContaining({ threadId: "ux-0" }));
        expect(Object.keys(preflight.body as Record<string, unknown>).every((key) => ["threadId", "cwd"].includes(key))).toBe(true);
        if (preflight.body && typeof preflight.body === "object" && !Array.isArray(preflight.body) && "cwd" in preflight.body)
          expect(preflight.body.cwd).toBe(CWD);
        expect(preflight.response).toEqual({
          reason: null, runtimeInstance: RUNTIME_INSTANCE,
          provenance: { config: "fresh", requirements: "fresh", account: "native", workspace: "not-required" },
        });
        expect(runtimeCleanup!.rawCalls.filter((call) => call.method === "account/read")).toHaveLength(2);
        expect(runtimeCleanup!.rawCalls.filter((call) => call.method === "thread/read")).toHaveLength(2);
        for (const method of ["config/read", "configRequirements/read"])
          expect(runtimeCleanup!.rawCalls.filter((call) => call.method === method)).toHaveLength(1);
      });
    }
  });
}
