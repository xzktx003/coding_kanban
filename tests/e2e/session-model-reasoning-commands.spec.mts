import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { isDeepStrictEqual } from "node:util";
import { expect, test, type Page } from "@playwright/test";
import type { Model } from "../../apps/web/src/session-mode/bindings/v2";
import { createFeedbackEventStream } from "./fixtures/session-feedback-event-stream.mts";
import { CWD, EDITOR, MAIN, SELECTED, UNKNOWN, createReader, initialize, observe, read, type Reader } from "./fixtures/session-model-command-page.mts";

// Match the repository's existing ESM/CJS fixture boundary without importing a product module in Node.
const { installSessionUxFixture, seedSessionUx } = createRequire(import.meta.url)(
  "./session-ux-fixture",
) as typeof import("./session-ux-fixture");

type Command = "increase" | "decrease" | "cycle";
type Step = { command: Command; expected: string | null; input: "pointer" | "Enter" | "Space"; changed: boolean };
type Variant = {
  name: string; model: string; effort: string | null; known?: string[];
  nullPower?: { selectedDefault: "low" | "high"; selectedIsDefault: boolean; preferredEffort: "medium" | "high"; expected: "轻度" | "高" };
  behavior?: "pending" | "no-snapshot-error" | "retained-error" | "background" | "inactive" | "acp" | "side";
  steps: Step[];
};
const step = (command: Command, expected: string | null, input: Step["input"], changed = true): Step => ({ command, expected, input, changed });
const cases: Variant[] = [
  { name: "unknown-none-three-commands", model: UNKNOWN, effort: "none", steps: [
    step("increase", "high", "pointer"), step("decrease", "medium", "Enter"), step("cycle", "high", "Space"),
  ] },
  { name: "unknown-null-three-keyboard-commands", model: UNKNOWN, effort: null, steps: [
    step("decrease", "low", "Enter"), step("increase", "medium", "Space"), step("cycle", "high", "Enter"),
  ] },
  { name: "unknown-max-and-minimal-boundaries", model: UNKNOWN, effort: "max", steps: [
    step("increase", "max", "pointer", false), step("cycle", "minimal", "Enter"), step("decrease", "minimal", "Space", false),
  ] },
  { name: "known-empty-no-commands", model: SELECTED, effort: "none", known: [], steps: [
    step("increase", "none", "pointer", false), step("decrease", "none", "Enter", false), step("cycle", "none", "Space", false),
  ] },
  { name: "known-single-medium-null-no-commands", model: SELECTED, effort: null, known: ["medium"], steps: [
    step("increase", null, "Enter", false), step("decrease", null, "Space", false), step("cycle", null, "pointer", false),
  ] },
  { name: "known-single-none-null-explicit-choice", model: SELECTED, effort: null, known: ["none"], steps: [
    step("cycle", "none", "Space"), step("increase", "none", "pointer", false), step("decrease", "none", "Enter", false),
  ] },
  { name: "known-null-default-low-menu-fallback", model: SELECTED, effort: null, known: ["low", "high"],
    nullPower: { selectedDefault: "low", selectedIsDefault: true, preferredEffort: "medium", expected: "轻度" },
    steps: [step("cycle", "low", "pointer")] },
  { name: "known-null-default-high-menu-fallback", model: SELECTED, effort: null, known: ["low", "high"],
    nullPower: { selectedDefault: "high", selectedIsDefault: true, preferredEffort: "medium", expected: "高" },
    steps: [step("cycle", "low", "Enter")] },
  { name: "known-null-other-default-menu-first", model: SELECTED, effort: null, known: ["low", "high"],
    nullPower: { selectedDefault: "high", selectedIsDefault: false, preferredEffort: "medium", expected: "轻度" },
    steps: [step("cycle", "low", "Space")] },
  { name: "known-null-sol-other-default-menu-suffix", model: "gpt-5.6-sol", effort: null, known: ["low", "high"],
    nullPower: { selectedDefault: "low", selectedIsDefault: false, preferredEffort: "high", expected: "高" },
    steps: [step("cycle", "low", "pointer")] },
  { name: "pending-first-model-load", model: UNKNOWN, effort: "none", behavior: "pending", steps: [
    step("increase", "none", "pointer", false), step("decrease", "none", "Enter", false), step("cycle", "none", "Space", false),
  ] },
  { name: "model-error-without-snapshot", model: UNKNOWN, effort: "none", behavior: "no-snapshot-error", steps: [
    step("increase", "high", "Enter"),
  ] },
  { name: "ancillary-error-then-retained-model-error", model: UNKNOWN, effort: "none", behavior: "retained-error", steps: [
    step("increase", "high", "pointer"), step("decrease", "medium", "Space"),
  ] },
  { name: "background-read-with-snapshot", model: UNKNOWN, effort: "none", behavior: "background", steps: [
    step("increase", "high", "Enter"),
  ] },
  { name: "inactive-workbench-and-explicit-return", model: UNKNOWN, effort: "none", behavior: "inactive", steps: [
    step("increase", "high", "pointer"),
  ] },
  { name: "acp-does-not-expose-codex-commands", model: UNKNOWN, effort: "none", behavior: "acp", steps: [] },
  { name: "side-focused-explicit-main-menu-owner", model: UNKNOWN, effort: "none", behavior: "side", steps: [
    step("increase", "high", "pointer"),
  ] },
];
const labels: Record<Command, string> = { increase: "提高推理强度", decrease: "降低推理强度", cycle: "循环切换推理强度" };
const directoryPaths = ["/api/codex/model/list", "/api/codex/provider/list", "/api/codex/model/list-other", "/api/codex/provider/presets"];
const readPosts = new Set([
  "/api/session/api/codex/account/get", "/api/session/api/codex/config/read", "/api/session/api/codex/thread/list",
  "/api/session/api/bots/list", "/api/session/api/codex/plugin/installed", "/api/session/api/codex/skills/list",
  "/api/session/api/codex/thread/goal/get", "/api/session/api/git/branch-info", "/api/session/api/filesystem/read-directory",
  "/api/session/api/git/status", "/api/session/api/git/diff-stats", "/api/session/api/git/file-diff-meta",
  "/api/session/subagents/snapshot", "/api/session/api/codex/thread/turns/list", "/api/session/git/hunks/read",
  "/api/session/api/codex/thread/access", "/api/session/api/codex/thread/read", "/api/session/api/codex/thread/metadata",
]);
const bookkeepingPaths = new Set([
  "/api/session/tabs", "/api/session/projects", "/api/session/api/telemetry/active",
  "/api/session/api/filesystem/watch", "/api/session/api/filesystem/unwatch",
]);
const runRoot = ".dev-runtime/session-polish-round2-20261016/model-commands-r22-root/";
export const inputPaths = [
  "apps/web/src/session-mode/components/codex/composer/ConversationMenu.tsx",
  "apps/web/src/session-mode/components/codex/composer/cycleReasoningEffort.ts",
  "apps/web/src/session-mode/components/codex/composer/nativeReasoningOptions.ts",
  "apps/web/src/session-mode/components/codex/composer/nativeReasoningLabel.ts",
  "apps/web/src/session-mode/components/codex/composer/NativeModelSelector.tsx",
  "apps/web/src/session-mode/components/codex/composer/NativeModelTrigger.tsx",
  "apps/web/src/session-mode/components/codex/composer/ReasoningEffortSelector.tsx",
  "apps/web/src/session-mode/components/codex/composer/ComposerMenu.tsx",
  "apps/web/src/session-mode/components/codex/composer/Composer.tsx",
  "apps/web/src/session-mode/components/codex/composer/SideChatPanel.tsx",
  "apps/web/src/session-mode/components/codex/hooks/useModels.ts",
  "apps/web/src/session-mode/hooks/useThreadModelSettings.ts",
  "apps/web/src/session-mode/stores/useThreadModelStore.ts",
  "apps/web/src/session-mode/stores/useSessionDraftStore.ts",
  "apps/web/src/session-mode/stores/useAgentCenterStore.ts",
  "apps/web/src/session-mode/stores/useInputStore.ts",
  "apps/web/src/session-mode/stores/useAgentSettingsStore.ts",
  "apps/web/src/session-mode/stores/useWorkspaceStore.ts",
  "apps/web/src/session-mode/stores/useLayoutStore.ts",
  "apps/web/src/session-mode/stores/useSideChatStore.ts",
  "apps/web/src/session-mode/stores/useAcpStore.ts",
  "apps/web/src/session-mode/components/agent/AgentComposer.tsx",
  "apps/web/src/session-mode/components/acp/AcpComposer.tsx",
  "apps/web/src/session-mode/components/acp/AcpSession.tsx",
  "apps/web/src/session-mode/components/acp/useAcpAgents.ts",
  "apps/web/src/session-mode/components/codex/stores/useConfigStore.ts",
  "apps/web/src/session-mode/components/codex/stores/useCodexStore.ts",
  "apps/web/src/session-mode/components/ui/dropdown-menu.tsx",
  "apps/web/src/session-mode/components/ui/popover.tsx",
  "apps/web/src/session-mode/session-dom.ts",
  "apps/web/src/session-mode/lib/eventStream.ts",
  "apps/web/src/components/WorkbenchModeSwitch.tsx",
  "apps/web/src/components/WorkbenchShell.tsx",
  "apps/web/src/lib/workbench-mode.ts",
  "apps/web/src/session-mode/services/apiAdapt/codex.ts",
  "apps/web/src/session-mode/services/apiAdapt/shared.ts",
  "apps/web/src/session-mode/services/apiAdapt/acp.ts",
  "tests/e2e/session-ux-fixture.ts",
  "tests/e2e/fixtures/session-feedback-event-stream.mts",
  "tests/e2e/session-model-reasoning-commands.spec.mts", "tests/e2e/fixtures/session-model-command-page.mts",
  runRoot + "playwright.final-v3.config.ts", runRoot + "tsconfig.e2e.json",
];
const hashes = () => inputPaths.map((path) => ({ path, sha256: createHash("sha256").update(readFileSync(path)).digest("hex") }));

function modelsFor(variant: Variant): Model[] {
  return ["r22-catalog-first", variant.known ? variant.model : SELECTED, "r22-catalog-third"].map((id, index) => ({
    id, model: id, displayName: ["R22 首项", "R22 选中第二项", "R22 第三项"][index],
    description: "Complete isolated R22 model directory", upgrade: null, upgradeInfo: null, availabilityNux: null,
    hidden: false, isDefault: index === (variant.nullPower?.selectedIsDefault ? 1 : 0),
    supportedReasoningEfforts: (index === 1 && variant.known ? variant.known : ["low", "medium", "high"])
      .map((reasoningEffort) => ({ reasoningEffort, description: reasoningEffort })),
    defaultReasoningEffort: variant.nullPower
      ? index === 1 ? variant.nullPower.selectedDefault : index === 0 ? variant.nullPower.preferredEffort : "medium"
      : "medium", inputModalities: ["text", "image"], supportsPersonality: false,
    additionalSpeedTiers: [], serviceTiers: [], defaultServiceTier: null,
  }));
}
const deferred = () => {
  let done!: () => void;
  const promise = new Promise<void>((resolve) => { done = resolve; });
  return { promise, resolve: done };
};
const frames = (page: Page) => page.evaluate(() => new Promise<void>((resolve) =>
  requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
));

for (const width of [1440, 390]) test.describe("R22 source-derived model commands " + width, () => {
  test.use({ viewport: { width, height: width === 390 ? 844 : 900 }, hasTouch: width === 390, isMobile: width === 390 });
  for (const sourceVariant of cases) {
    // The mobile side pane covers the main attach button. An explicit main
    // command remains reachable through ordinary keyboard focus navigation.
    const variant = width === 390 && sourceVariant.behavior === "side"
      ? { ...sourceVariant, steps: [step("increase", "high", "Enter")] }
      : sourceVariant;
    test(variant.name, async ({ page }, info) => {
    test.setTimeout(60_000);
    const origin = new URL(String(info.project.use.baseURL)).origin;
    const sourceBefore = hashes(), catalog = modelsFor(variant);
    const firstGate = deferred(), secondGate = deferred();
    const draft = `R22 unchanged A draft ${width} ${variant.name}`;
    const sideDraft = `R22 unchanged side draft ${width}`;
    const acpDraft = `R22 unchanged ACP draft ${width}`;
    const api: Array<{ method: string; path: string; body: unknown }> = [], writes: typeof api = [], bookkeeping: typeof api = [];
    const acpSessionReads: typeof api = [];
    const directory: Array<{ method: string; path: string; body: unknown; index: number; ordinal: number; status: number | null; json: unknown; held: boolean; error?: string }> = [];
    const counts = [0, 0, 0, 0], external: Array<{ method: string; url: string }> = [];
    const pageErrors: string[] = [], consoleErrors: Array<{ text: string; url: string }> = [], captureErrors: string[] = [];
    const states: Array<{ phase: string; value: any }> = [], screenshots: string[] = [];
    const checks: Array<{ name: string; pass: boolean; actual: unknown; expected: unknown }> = [];
    const actions: Array<Record<string, unknown>> = [];
    const diagnosticReads: Array<Record<string, unknown>> = [];
    const diagnosticHandles: Array<Awaited<ReturnType<Page["evaluateHandle"]>>> = [];
    let failure: string | null = null, reader: Reader | null = null;
    let observer: Awaited<ReturnType<typeof observe>> | null = null;
    let inputEvents: { events: Array<Record<string, unknown>>; overflow: boolean } | null = null;
    let baseline: any = null, streamBefore: unknown = null, streamAfter: unknown = null;
    const inFlight = new Set<Promise<void>>();
    const check = (name: string, actual: unknown, expected: unknown) => checks.push({ name, pass: isDeepStrictEqual(actual, expected), actual: structuredClone(actual), expected: structuredClone(expected) });
    const stream = await createFeedbackEventStream(origin); // Factory invoked only inside an explicitly executed test.
    let fixture!: Awaited<ReturnType<typeof installSessionUxFixture>>;
    try {
    page.on("pageerror", (error) => pageErrors.push(String(error)));
    page.on("console", (message) => { if (message.type() === "error") consoleErrors.push({ text: message.text(), url: message.location().url }); });
    await page.route("**/*", async (route) => {
      const request = route.request();
      if (new URL(request.url()).origin !== origin || !["GET", "HEAD"].includes(request.method())) {
        external.push({ method: request.method(), url: request.url() });
        await route.abort("blockedbyclient");
      } else await route.continue();
    });
    fixture = await installSessionUxFixture(page, 2);
    if (variant.behavior === "side") fixture.threads.push({ ...fixture.threads[0], id: "ux-side", name: "R22 existing side", preview: "R22 side" });
    await page.route("**/api/**", async (route) => {
      const work = (async () => {
        const request = route.request(), path = new URL(request.url()).pathname;
        const entry = { method: request.method(), path, body: request.method() === "POST" ? request.postDataJSON() : null };
        api.push(entry);
        if (path === "/api/session/api/events" && entry.method === "GET") {
          await route.continue({ url: stream.url }); return;
        }
        const index = directoryPaths.findIndex((suffix) => path.endsWith(suffix));
        if (index >= 0) {
          const ordinal = ++counts[index];
          const held = index === 0 && (ordinal === 1 || (variant.behavior === "background" && ordinal === 2));
          const record = { ...entry, index, ordinal, status: null as number | null, json: null as unknown, held };
          directory.push(record);
          try {
            if (index === 0 && ordinal === 1) await firstGate.promise;
            if (index === 0 && ordinal === 2 && variant.behavior === "background") await secondGate.promise;
            const fail = (index === 0 && variant.behavior === "no-snapshot-error") ||
              (index === 1 && ordinal === 1 && ["retained-error", "background"].includes(variant.behavior ?? "")) ||
              (index === 0 && ordinal === 2 && variant.behavior === "retained-error");
            record.status = fail ? 503 : 200;
            record.json = fail ? { error: `R22 injected directory read failure index=${index} ordinal=${ordinal}` } :
              index === 0 ? { data: catalog, nextCursor: null } : [];
            await route.fulfill({ status: record.status, json: record.json });
          } catch (error) { (record as typeof record & { error?: string }).error = String(error); }
        } else if (variant.behavior === "acp" && entry.method === "POST" &&
          path === "/api/session/api/acp/sessions" &&
          isDeepStrictEqual(entry.body, { cwd: CWD, limit: null })) {
          // acpListSessions is a history read, despite its POST transport.
          // Only this exact synthetic cwd/body is fulfilled locally; no ACP is started.
          acpSessionReads.push(entry);
          await route.fulfill({ json: [] });
        } else if (!["GET", "HEAD"].includes(entry.method) && !readPosts.has(path) && !bookkeepingPaths.has(path)) {
          writes.push(entry);
          await route.fulfill({ status: 409, json: { error: "R22 permits isolated reads and explicit fixture bookkeeping only" } });
        } else {
          if (bookkeepingPaths.has(path) && !["GET", "HEAD"].includes(entry.method)) bookkeeping.push(entry);
          await route.fallback();
        }
      })();
      inFlight.add(work); try { await work; } finally { inFlight.delete(work); }
    });
    } catch (error) {
      firstGate.resolve(); secondGate.resolve();
      const cleanup = await stream.close();
      const path = info.outputPath("model-commands.json");
      writeFileSync(path, JSON.stringify({ kind: "R22-setup-failure", variant, width, failure: String(error), sourceBefore, sourceAfter: hashes(), cleanup }, null, 2) + "\n");
      await info.attach("model-commands", { path, contentType: "application/json" });
      throw error;
    }
    const record = async (phase: string) => {
      if (!reader) throw Error("Mounted reader unavailable");
      const value = await read(page, reader); states.push({ phase, value }); return value;
    };
    const shot = async (name: string) => {
      try { const path = info.outputPath(name + ".png"); await page.screenshot({ path, fullPage: true }); screenshots.push(path); }
      catch (error) { captureErrors.push(name + ": " + String(error)); }
    };
    const sample = async (phase: string) => {
      await record(phase + "-immediate"); await frames(page); await record(phase + "-2raf");
      await page.waitForTimeout(200); await record(phase + "-settled");
    };
    const closeLayers = async () => {
      for (let count = 0; count < 4; count++) {
        const menus = page.locator('.session-composer-menu[role="menu"], .session-native-model-menu, [data-slot="popover-content"]');
        if (!(await menus.filter({ visible: true }).count())) break;
        await page.keyboard.press("Escape"); await page.waitForTimeout(100);
      }
      // Allow the real exit/view-reset lifecycle to settle before a separate ordinary open.
      await page.waitForTimeout(350);
    };
    const tabTo = async (label: string, limit: number, key: "Tab" | "Shift+Tab" = "Tab") => {
      for (let i = 0; i <= limit; i++) {
        const active = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
        if (active === label) return;
        if (i === limit) throw Error("Ordinary Tab could not reach " + label);
        await page.keyboard.press(key); actions.push({ type: key, target: label, ordinal: i + 1 });
      }
    };
    const openCommands = async (input: Step["input"]) => {
      await closeLayers();
      if (input === "pointer") {
        await page.locator(MAIN).getByRole("button", { name: "附加文件", exact: true }).click();
        await page.getByRole("button", { name: "当前会话的更多操作", exact: true }).filter({ visible: true }).click();
      } else {
        if (variant.behavior === "side") await tabTo("附加文件", 60, "Shift+Tab");
        else {
          await page.locator(MAIN).locator(EDITOR).first().click();
          await tabTo("附加文件", 20);
        }
        await page.keyboard.press("Enter");
        await tabTo("当前会话的更多操作", 30); await page.keyboard.press("Enter");
      }
      await page.locator('.session-composer-menu[role="menu"]').filter({ visible: true }).waitFor();
    };
    const invoke = async (action: Step, ordinal: number) => {
      await openCommands(action.input); await sample(`command-${ordinal}-open`);
      const before = await record(`command-${ordinal}-before`);
      const row = page.getByRole("menuitem", { name: labels[action.command], exact: true }).filter({ visible: true });
      await row.waitFor();
      const disabled = await row.getAttribute("aria-disabled") === "true" || await row.getAttribute("data-disabled") !== null;
      actions.push({ type: "command", ordinal, command: action.command, input: action.input, disabled });
      if (!disabled) {
        if (action.input === "pointer") await row.click();
        else {
          await page.keyboard.press("Home");
          let reached = false;
          for (let i = 0; i < 80; i++) {
            const active = await page.evaluate(() => ({ text: document.activeElement?.textContent?.trim(), role: document.activeElement?.getAttribute("role") }));
            if (active.role === "menuitem" && active.text === labels[action.command]) { reached = true; break; }
            await page.keyboard.press("ArrowDown");
          }
          if (!reached) throw Error("Ordinary menu ArrowDown could not reach command: " + labels[action.command]);
          await page.keyboard.press(action.input);
        }
      }
      await sample(`command-${ordinal}-result`); await shot(`command-${ordinal}`);
      const after = await record(`command-${ordinal}-after`);
      check(`command-${ordinal} raw effort`, after.settings.reasoningEffort, action.expected);
      check(`command-${ordinal} revision`, after.entry.revision, before.entry.revision + (action.changed ? 1 : 0));
      if (action.changed) check(`command-${ordinal} real command enabled`, disabled, false);
      else check(`command-${ordinal} no-op entry`, after.entry, before.entry);
      await closeLayers(); await record(`command-${ordinal}-escape`);
    };
    const openModel = async (phase: string) => {
      await closeLayers();
      const trigger = page.locator(MAIN).locator(".session-native-model-trigger");
      if (!(await trigger.count())) {
        actions.push({ type: "model-trigger-not-mounted", phase });
        await sample(phase); await shot(phase); return;
      }
      if (await trigger.isDisabled()) {
        actions.push({ type: "model-open-unavailable", phase, disabled: true });
        await sample(phase); await shot(phase); return;
      }
      await trigger.click(); await sample(phase); await shot(phase);
    };
    const modelState = (phase: string) => states.findLast((s) => s.phase === phase + "-settled")?.value;
    const modelContract = (phase: string, kind: "pending" | "no-data" | "snapshot" | "fetching") => {
      const state = modelState(phase);
      check(phase + " captured", Boolean(state), true);
      if (!state) return;
      if (kind === "pending") {
        // Original hCa's early Loading return replaces the selector, rather than rendering menu content.
        check(phase + " actual loading replacement", state.loadingControls.length, 1);
        check(phase + " original Loading default label", state.loadingControls[0]?.text, "Loading model…");
        check(phase + " original Loading accessible name", state.loadingControls[0]?.label, "Loading model…");
        check(phase + " original Loading busy state", state.loadingControls[0]?.ariaBusy, "true");
        check(phase + " Loading control disabled", state.loadingControls[0]?.disabled, true);
        check(phase + " no speculative menu body", state.modelMenu, null);
      } else {
        check(phase + " view", state.modelMenu?.view, kind === "no-data" ? "advanced" : "simple");
        check(phase + " slider count", state.modelMenu?.sliderCount, kind === "no-data" ? 0 : 1);
        check(phase + " dots", state.modelMenu?.dots, kind === "no-data" ? 0 : 6);
        if (kind === "no-data") check(phase + " no reasoning rows", state.modelMenu?.strengthRows.length, 0);
        if (kind === "no-data" || phase === "retained-error-model") {
          check(phase + " no native inline Retry", state.modelMenu?.retryButtons, 0);
          check(phase + " no raw inline error bar", state.modelMenu?.alertCount, 0);
          check(phase + " raw read failure not rendered in native menu", state.modelMenu?.text.includes("R22 injected directory read failure"), false);
        }
        if (kind === "snapshot") {
          check(phase + " power enabled", state.modelMenu?.sliderDisabled !== "true", true);
          // Catalog model rows can be inspected after a real caption click below.
        }
      }
    };
    const beginDiagnosticModelRead = async (phase: string) => {
      await closeLayers();
      const before = await record(phase + "-before-diagnostic-read");
      check(phase + " public load precondition", { loaded: before.cache.loaded, loading: before.cache.loading }, { loaded: false, loading: false });
      const handle = await page.evaluateHandle(async () => {
        const path = "/src/session-mode/components/codex/hooks/useModels.ts";
        const moduleURL = performance.getEntriesByType("resource")
          .findLast((entry) => new URL(entry.name).pathname === path)?.name;
        if (!moduleURL) throw Error("Mounted public read module unavailable");
        const { useModelCacheStore } = await import(moduleURL);
        const before = useModelCacheStore.getState();
        if (before.loaded || before.loading) throw Error("Diagnostic public load requires existing loaded=false/loading=false");
        const record = { operation: "useModelCacheStore.getState().load", moduleURL,
          boundary: "Explicit test-side diagnostic read, not a native/user Retry action",
          started: performance.now(), finished: null as number | null, error: null as string | null,
          before: { loaded: before.loaded, loading: before.loading, error: before.error } };
        const done = useModelCacheStore.getState().load().then(
          () => { record.finished = performance.now(); },
          (error: unknown) => { record.finished = performance.now(); record.error = String(error); },
        );
        return { read: () => ({ ...record }), done };
      });
      diagnosticHandles.push(handle);
      actions.push({ type: "diagnostic-public-directory-read", phase });
      await expect.poll(() => counts).toEqual([2, 2, 2, 2]);
      if (variant.behavior === "background") await expect.poll(async () => (await record(phase + "-poll")).cache.loading).toBe(true);
      else {
        await handle.evaluate(async (value: any) => value.done);
        await expect.poll(async () => (await record(phase + "-poll")).cache.loading).toBe(false);
      }
      await sample(phase); await shot(phase);
    };
    try {
      // Initial fixture membership keeps the known-single-none command oracle.
      // No post-action setting or preference hydration is used.
      await page.addInitScript(({ origin }) => {
        if (window !== window.top || location.origin !== origin) return;
        localStorage.setItem("kanban.session.native-model-picker-preferences", JSON.stringify({
          state: { selectionMode: null, enabledReasoningEfforts: ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra", "persistent"] }, version: 1,
        }));
      }, { origin });
      await page.goto("/?mode=session&view=agent", { waitUntil: "domcontentloaded" });
      await page.locator(MAIN).locator(EDITOR).first().waitFor();
      await seedSessionUx(page, 2);
      const owners = await initialize(page, { model: variant.model, effort: variant.effort, side: variant.behavior === "side", acp: variant.behavior === "acp" });
      reader = await createReader(page, owners); observer = await observe(page);
      if (variant.behavior === "acp") await page.getByRole("textbox", { name: "ACP 消息输入", exact: true }).fill(acpDraft);
      else await page.locator(MAIN).locator(EDITOR).first().fill(draft);
      if (variant.behavior === "side") await page.getByRole("textbox", { name: "侧边聊天输入", exact: true }).fill(sideDraft);
      await expect.poll(() => counts).toEqual([1, 1, 1, 1]);
      if (variant.behavior !== "pending") firstGate.resolve();
      await expect.poll(async () => (await record("sse-readiness")).eventStreamConnected).toBe(true);
      await expect.poll(async () => (await record("model-readiness")).cache.loading).toBe(variant.behavior === "pending");
      baseline = await record("before-actions"); await shot("before-actions");
      if (variant.behavior === "side") check("side editor naturally focused before main command", baseline.activeInSide, true);
      check("actual four-read flow", counts, [1, 1, 1, 1]);
      check("complete raw directory or pending/no-snapshot", baseline.cache.models,
        ["pending", "no-snapshot-error"].includes(variant.behavior ?? "") ? [] : catalog);
      check("independent actual model read status", baseline.cache.modelStatus,
        variant.behavior === "pending" ? "pending" : variant.behavior === "no-snapshot-error" ? "error" : "success");
      check("actual snapshot provenance", baseline.cache.hasModelSnapshot,
        !["pending", "no-snapshot-error"].includes(variant.behavior ?? ""));
      check("raw effort not repaired by hydration/readiness", baseline.settings.reasoningEffort, variant.effort);
      if (variant.nullPower) {
        check("known null closed trigger derives Medium", baseline.nativeTrigger.effort, "中");
        await openModel("known-null-power-menu");
        const knownMenu = modelState("known-null-power-menu");
        check("known null menu is simple", knownMenu.modelMenu?.view, "simple");
        check("known null menu keeps exactly two advertised efforts", knownMenu.modelMenu?.dots, 2);
        check("known null menu has one visible slider", knownMenu.modelMenu?.sliderCount, 1);
        const caption = await page.locator(".session-native-model-menu .session-native-power-effort").innerText();
        check("known null menu uses exact TX fallback caption", caption, variant.nullPower.expected);
        const status = await page.locator(".session-native-model-menu [role=status]").innerText();
        check("known null menu status follows the fallback position", status.includes(`第 ${variant.nullPower.expected === "轻度" ? 1 : 2} 项，共 2 项`), true);
        check("known null menu opening does not repair raw settings", knownMenu.entry, baseline.entry);
        await closeLayers();
        check("known null model menu Escape returns to its main editor", (await record("known-null-menu-escape")).activeIsEditor, true);
      }
      if (variant.behavior === "pending") {
        await openModel("first-pending-model"); modelContract("first-pending-model", "pending"); await closeLayers();
      } else if (variant.behavior === "no-snapshot-error") {
        await openModel("no-snapshot-error-model"); modelContract("no-snapshot-error-model", "no-data"); await closeLayers();
      } else if (["retained-error", "background"].includes(variant.behavior ?? "")) {
        await openModel("ancillary-error-model"); modelContract("ancillary-error-model", "snapshot"); await closeLayers();
        if (variant.behavior === "background") {
          await beginDiagnosticModelRead("background-diagnostic-read");
          await openModel("background-model"); modelContract("background-model", "fetching"); await closeLayers();
        }
      } else if (variant.behavior === "inactive") {
        await page.getByRole("group", { name: "工作模式", exact: true }).getByRole("button", { name: "终端", exact: true }).click();
        await sample("hidden-session"); await shot("hidden-session");
        const hidden = modelState("hidden-session");
        check("session hidden by real workbench UI", hidden.sessionVisible, false);
        check("hidden mode has no visible command entrance", hidden.visibleCommandEntrances, 0);
        await page.keyboard.press("Escape"); await page.keyboard.press("Tab");
        check("safe keys while hidden do not mutate thread", (await record("hidden-keys")).entry, baseline.entry);
        await page.getByRole("group", { name: "工作模式", exact: true }).getByRole("button", { name: "会话", exact: true }).click();
        await page.locator(MAIN).locator(EDITOR).first().waitFor(); await record("explicit-return");
      } else if (variant.behavior === "acp") {
        const textbox = page.getByRole("textbox", { name: "ACP 消息输入", exact: true });
        await textbox.click(); await page.keyboard.press("ArrowLeft"); await page.keyboard.press("Escape");
        await sample("acp-isolation"); await shot("acp-isolation");
        const isolated = modelState("acp-isolation");
        check("ACP active", isolated.acp.active, true);
        check("actual ACP composer visible", isolated.acpComposerVisible, true);
        check("Codex composer hidden in ACP mode", isolated.codexComposerVisible, false);
        check("ACP exposes no Codex command entrance", isolated.visibleCommandEntrances, 0);
        check("ACP safe keys preserve Codex entry", isolated.entry, baseline.entry);
      }
      for (let i = 0; i < variant.steps.length; i++) {
        if (variant.behavior === "retained-error" && i === 1) {
          await beginDiagnosticModelRead("retained-error-diagnostic-read");
          await openModel("retained-error-model"); modelContract("retained-error-model", "snapshot");
          const caption = page.locator(".session-native-model-menu .session-native-power-caption");
          if (await caption.isVisible()) await caption.click();
          await sample("retained-error-advanced"); await shot("retained-error-advanced");
          const advanced = modelState("retained-error-advanced");
          const catalogRows = advanced.modelMenu?.modelRows.filter((row: any) => !row.text?.includes(UNKNOWN));
          check("retained model error has three unavailable catalog rows", catalogRows?.length, 3);
          check("retained model error disables catalog selection", catalogRows?.every((row: any) => row.disabled), true);
          check("retained model error disables every rendered model row", advanced.modelMenu?.modelRows.every((row: any) => row.disabled), true);
          check("retained advanced has no native inline Retry", advanced.modelMenu?.retryButtons, 0);
          check("retained advanced has no raw inline error bar", advanced.modelMenu?.alertCount, 0);
          check("retained advanced omits raw read failure text", advanced.modelMenu?.text.includes("R22 injected directory read failure"), false);
          await closeLayers();
        }
        await invoke(variant.steps[i], i + 1);
      }
      await closeLayers(); await sample("final"); await shot("final");
      const final = modelState("final");
      const stablePair = (entry: any) => {
        const { reasoningEffort: _effort, revision: _revision, pending: _pending, pendingFields: _fields, ...rest } = entry;
        return rest;
      };
      for (const { phase, value } of states.filter((s) => !/readiness|poll/.test(s.phase))) {
        check(phase + " captured owner/current thread", { owner: value.owner, thread: value.currentThreadId }, { owner: baseline.owner, thread: "ux-0" });
        check(phase + " model/provider/permissions/tier unchanged", stablePair(value.entry), stablePair(baseline.entry));
        check(phase + " defaults unchanged", value.defaults, baseline.defaults);
        check(phase + " other owners settings unchanged", Object.fromEntries(Object.entries(value.allThreads).filter(([id]) => id !== "ux-0")),
          Object.fromEntries(Object.entries(baseline.allThreads).filter(([id]) => id !== "ux-0")));
        check(phase + " all captured drafts unchanged", value.drafts, baseline.drafts);
        check(phase + " side identity unchanged", value.sideChat, baseline.sideChat);
        check(phase + " raw directory retained", value.cache.models, baseline.cache.models);
        if (baseline.cache.models.length) {
          check(phase + " raw array identity", value.cacheIdentity.array, true);
          check(phase + " raw model identities", value.cacheIdentity.models, true);
          check(phase + " raw effort array identities", value.cacheIdentity.efforts, true);
        }
        check(phase + " viewport", { width: value.viewport.width, height: value.viewport.height }, { width, height: width === 390 ? 844 : 900 });
        check(phase + " no page horizontal overflow", value.viewport.horizontalOverflow <= 1, true);
      }
      if (variant.behavior !== "acp") check("main editor retains full draft", final.editorText, draft);
      if (variant.behavior !== "acp") check("ordinary Escape settles on the captured main attachment trigger", final.active?.label, "附加文件");
      check("final HTML remains interactive", final.pointerEvents.html !== "none", true);
      check("final body remains interactive", final.pointerEvents.body !== "none", true);
      if (variant.behavior === "side") check("side editor retains full draft", final.sideEditorText, sideDraft);
      if (variant.behavior === "acp") check("ACP editor retains full draft", final.acpEditorText, acpDraft);
      check("first four directory methods/bodies", directory.filter((d) => d.ordinal === 1).map((d) => ({ index: d.index, method: d.method, body: d.body })).sort((a, b) => a.index - b.index),
        [0, 1, 2, 3].map((index) => ({ index, method: index === 0 ? "POST" : "GET", body: index === 0 ? { cursor: null, limit: 100 } : null })));
      check("exact scheduled read counts", counts, ["background", "retained-error"].includes(variant.behavior ?? "") ? [2, 2, 2, 2] : [1, 1, 1, 1]);
      check("ACP history read bodies remain scoped to the synthetic project", acpSessionReads.every((entry) =>
        entry.method === "POST" && entry.path === "/api/session/api/acp/sessions" &&
        isDeepStrictEqual(entry.body, { cwd: CWD, limit: null })), true);
      if (variant.behavior !== "acp") check("no ACP history reads in Codex scenarios", acpSessionReads, []);
    } catch (error) { failure = String(error instanceof Error ? error.stack ?? error.message : error); }
    finally {
      if (reader) try { await record("terminal-before-cleanup"); } catch (error) { captureErrors.push("terminal: " + String(error)); }
      await shot("terminal");
      if (observer) try {
        inputEvents = await observer.evaluate((observer) => observer.read());
        await observer.evaluate((observer) => observer.dispose());
      } catch (error) { captureErrors.push("input observer: " + String(error)); }
      firstGate.resolve(); secondGate.resolve();
      try { await Promise.all([...inFlight]); } catch (error) { captureErrors.push("route drain: " + String(error)); }
      for (const handle of diagnosticHandles) {
        try {
          await handle.evaluate(async (value: any) => value.done);
          diagnosticReads.push(await handle.evaluate((value: any) => value.read()));
        } catch (error) { captureErrors.push("diagnostic read receipt: " + String(error)); }
        await handle.dispose();
      }
      streamBefore = stream.snapshot();
      try { await page.goto("about:blank", { waitUntil: "commit" }); } catch (error) { captureErrors.push("page release: " + String(error)); }
      streamAfter = await stream.close();
      if (reader) await reader.dispose(); if (observer) await observer.dispose();
      const sourceAfter = hashes();
      const eventList = (inputEvents as any)?.events ?? [];
      check("source inputs stable during case", sourceAfter, sourceBefore);
      check("no business/API writes", writes, []); check("no external/static non-GET traffic", external, []);
      check("no pageerrors", pageErrors, []); check("evidence captures succeeded", captureErrors, []);
      check("directory route fulfillment did not fail", directory.filter((d) => d.error), []);
      check("passive input observer bounded", (inputEvents as any)?.overflow, false);
      check("no native submit event", eventList.filter((e: any) => e.type === "submit"), []);
      for (const action of actions.filter((a) => a.type === "command" && a.disabled === false)) {
        const command = action.command as Command;
        check(`trusted activation ${action.ordinal}`, eventList.some((e: any) =>
          e.trusted === true && e.inCommandMenu && e.text === labels[command] &&
          (action.input === "pointer" ? e.type === "click" : e.type === "keydown" && e.key === (action.input === "Space" ? " " : "Enter"))), true);
      }
      const after = streamAfter as Awaited<ReturnType<typeof stream.close>>;
      check("owned live SSE accepted a real connection", after.acceptedRequests > 0, true);
      check("owned SSE cleanup complete", { errors: after.errors, closed: after.closed, listening: after.listening, addressCleared: after.addressCleared,
        activeResponses: after.activeResponses, activeSockets: after.activeSockets, serverErrors: after.serverErrorCount, requestOverflow: after.requestOverflow },
        { errors: [], closed: true, listening: false, addressCleared: true, activeResponses: 0, activeSockets: 0, serverErrors: 0, requestOverflow: false });
      check("all owned SSE connections closed", after.connections.every((c) => c.closedAtMs !== null), true);
      const allowedConsole = consoleErrors.filter(({ text, url }) =>
        /vite|websocket/i.test(text) || /\/(@vite\/client|node_modules\/\.vite\/)/.test(url) ||
        /503/.test(text) && directory.some((d) => d.status === 503 && url.includes(d.path)));
      check("only explicit injected-read/Vite console diagnostics", consoleErrors.filter((entry) => !allowedConsole.includes(entry)), []);
      const result = {
        kind: "R22-model-command-candidate", oracle: "source-derived original Main.hCa command semantics; no original GUI command execution",
        variant, width, expectedHeight: width === 390 ? 844 : 900,
        scopeBoundary: variant.behavior === "acp" ? "Local ACP isolation only; no same-name native ACP gate" :
          variant.behavior === "side" ? "Explicit local main-menu owner while independent side editor focused; no native standalone-side-sheet oracle" :
          variant.behavior === "inactive" ? "Actual mode navigation and natural entrance reachability, not a forged global command dispatch" : "Actual ConversationMenu entry and ordinary keys",
        sourceBefore, sourceAfter, api, directory, counts, writes, bookkeeping, acpSessionReads, fixtureCalls: fixture.calls, diagnosticReads,
        external, pageErrors, consoleErrors, allowedConsole, states, actions, inputEvents, screenshots, captureErrors,
        stream: { beforeCleanup: streamBefore, afterCleanup: streamAfter }, checks, failure,
        summary: { checks: checks.length, failedChecks: checks.filter((c) => !c.pass).length },
      };
      const path = info.outputPath("model-commands.json");
      writeFileSync(path, JSON.stringify(result, null, 2) + "\n");
      await info.attach("model-commands", { path, contentType: "application/json" });
    }
    expect(failure, "Natural UI/setup failure is retained in JSON before assertions").toBeNull();
    expect(checks.filter((c) => !c.pass), "All source-derived behavior and isolation evidence is saved before unified assertion").toEqual([]);
    });
  }
});
