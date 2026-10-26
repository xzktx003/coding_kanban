import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { isDeepStrictEqual } from "node:util";
import { expect, test, type Locator, type Page } from "@playwright/test";
import type { Model, ThreadGoal } from "../../apps/web/src/session-mode/bindings/v2";
import { createFeedbackEventStream } from "./fixtures/session-feedback-event-stream.mts";
import { CWD, SIDE, EDITOR, MAIN, createReader, observe, read, type Initial } from "./fixtures/session-model-command-page.mts";

const { installSessionUxFixture, seedSessionUx } = createRequire(import.meta.url)("./session-ux-fixture") as typeof import("./session-ux-fixture");
const paths = ["/api/codex/model/list", "/api/codex/provider/list", "/api/codex/model/list-other", "/api/codex/provider/presets"];
const reads = new Set([
  "/api/session/api/codex/account/get", "/api/session/api/codex/config/read", "/api/session/api/codex/thread/list",
  "/api/session/api/bots/list", "/api/session/api/codex/plugin/installed", "/api/session/api/codex/skills/list",
  "/api/session/api/codex/thread/goal/get", "/api/session/api/git/branch-info", "/api/session/api/filesystem/read-directory",
  "/api/session/api/git/status", "/api/session/api/git/diff-stats", "/api/session/api/git/file-diff-meta",
  "/api/session/subagents/snapshot", "/api/session/api/codex/thread/turns/list", "/api/session/git/hunks/read",
  "/api/session/api/codex/thread/access", "/api/session/api/codex/thread/read", "/api/session/api/codex/thread/metadata",
]);
const bookkeeping = new Set(["/api/session/tabs", "/api/session/projects", "/api/session/api/telemetry/active", "/api/session/api/filesystem/watch", "/api/session/api/filesystem/unwatch"]);
const TERRA = "gpt-5.6-terra", SOL = "gpt-5.6-sol", TL = "T";
const OWNER_A = JSON.stringify(["codex", "", "session", "ux-0"]);
const OWNER_B = JSON.stringify(["codex", "", "session", "ux-1"]);
const CUSTOM = { "e7-custom-provider": [{ id: "e7-custom-model", name: "E7 保留自定义模型" }] };
type LeaveCase = { id: string; consumer: "model" | "attachments" | "access" | "goal"; width: 390 | 1440; surface: "main" | "expanded"; mode: "model" | "default"; raw: string | null; purpose: string };
const cases: LeaveCase[] = [];
for (const mode of ["model", "default"] as const) for (const width of [1440, 390] as const) for (const surface of ["main", "expanded"] as const)
  cases.push({ id: mode + "-" + width + "-" + surface, consumer: "model", width, surface, mode,
    raw: mode === "default" ? null : "medium", purpose: mode === "default" ? "选择模型" : "选择强度" });
for (const consumer of ["attachments", "access", "goal"] as const) for (const width of [1440, 390] as const)
  cases.push({ id: consumer + "-" + width + "-main", consumer, width, surface: "main", mode: "model", raw: "medium",
    purpose: consumer === "attachments" ? "附加文件@" : consumer === "access" ? "更改权限" : "编辑目标" });
const FIXTURE_GOAL: ThreadGoal = { threadId: "ux-0", objective: "E11 retained ordinary goal", status: "blocked", tokenBudget: 100000,
  tokensUsed: 12500, timeUsedSeconds: 61, createdAt: 1, updatedAt: 2 };
function model(id: string, label: string, efforts: readonly string[], defaultReasoningEffort: string, isDefault: boolean): Model {
  return { id, model: id, displayName: label,
    description: "Synthetic E8 ordinary local Default/pair catalog, not account/native eligibility",
    hidden: false, isDefault, upgrade: null, upgradeInfo: null, availabilityNux: null,
    supportedReasoningEfforts: efforts.map((reasoningEffort) => ({ reasoningEffort, description: reasoningEffort })),
    defaultReasoningEffort, inputModalities: ["text", "image"], supportsPersonality: false,
    additionalSpeedTiers: [], serviceTiers: [], defaultServiceTier: null };
}
const inputs = [
  "apps/web/src/session-mode/components/codex/composer/NativeModelSelector.tsx",
  "apps/web/src/session-mode/components/codex/composer/nativePickerPresentation.ts",
  "apps/web/src/session-mode/components/codex/composer/nativeBuiltinModelPresets.ts",
  "apps/web/src/session-mode/components/codex/composer/NativeModelTrigger.tsx",
  "apps/web/src/session-mode/components/codex/composer/nativeModelIdentity.ts",
  "apps/web/src/session-mode/components/codex/composer/nativePowerWheel.ts",
  "apps/web/src/session-mode/components/codex/composer/nativeReasoningOptions.ts",
  "apps/web/src/session-mode/components/codex/composer/nativeReasoningLabel.ts",
  "apps/web/src/session-mode/components/codex/composer/recentModelConfigs.ts",
  "apps/web/src/session-mode/components/codex/composer/Composer.tsx",
  "apps/web/src/session-mode/components/codex/composer/v2/ComposerSheet.tsx",
  "apps/web/src/session-mode/components/codex/composer/v2/useComposerSheetHistory.ts",
  "apps/web/src/session-mode/components/codex/composer/v2/RichDraftEditor.tsx",
  "apps/web/src/session-mode/components/codex/composer/v2/drafts.ts",
  "apps/web/src/session-mode/components/codex/composer/composer-native.css",
  "apps/web/src/session-mode/components/codex/hooks/useModels.ts",
  "apps/web/src/session-mode/hooks/useThreadModelSettings.ts",
  "apps/web/src/session-mode/stores/useThreadModelStore.ts",
  "apps/web/src/session-mode/stores/useSessionDraftStore.ts",
  "apps/web/src/session-mode/stores/settings/useModelSettingsStore.ts",
  "apps/web/src/session-mode/components/codex/stores/useConfigStore.ts",
  "apps/web/src/session-mode/components/codex/stores/useCodexStore.ts",
  "apps/web/src/session-mode/session-dom.ts",
  "apps/web/src/session-mode/components/ui/dropdown-menu.tsx",
  "apps/web/src/session-mode/components/ui/dialog.tsx",
  "tests/e2e/session-ux-fixture.ts",
  "tests/e2e/fixtures/session-model-command-page.mts",
  "tests/e2e/fixtures/session-feedback-event-stream.mts",
  "tests/e2e/session-model-current-row-null.spec.mts",
  "tests/e2e/session-model-open-trigger.spec.mts",
  "tests/e2e/session-model-default-mode.spec.mts",
  "apps/web/src/session-mode/components/codex/composer/ConversationMenu.tsx",
  "apps/web/src/session-mode/components/codex/composer/ordinaryNativePickerModels.ts",
  "apps/web/src/session-mode/stores/settings/useNativeModelPickerPreferencesStore.ts",
  "apps/web/src/session-mode/services/nativeThreadPermissionMetadata.ts",
  "apps/web/src/session-mode/components/codex/composer/ComposerTooltip.tsx",
  "apps/web/src/session-mode/components/ui/tooltip.tsx",
  "apps/web/src/session-mode/components/codex/composer/NativeModelSelector.tooltip-purpose.test.tsx",
  "tests/e2e/session-model-tooltip-purpose.spec.mts",
  "tests/e2e/session-model-completion-tooltip.spec.mts",
  "apps/web/src/session-mode/components/codex/composer/NativeModelSelector.completion-tooltip.test.tsx",
  "apps/web/src/session-mode/session-composer-v2.css",
  "apps/web/src/session-mode/components/codex/composer/NativeSubmitButton.tsx",
  "apps/web/src/session-mode/utils/codexRuntimeState.ts",
  "apps/web/src/session-mode/stores/useFollowupSettingsStore.ts",
  "apps/web/src/session-mode/components/codex/hooks/useTurnControl.ts",
  "tests/e2e/session-composer-sheet-footer.spec.mts",
  "apps/web/src/session-mode/components/codex/composer/ComposerMenu.tsx",
  "apps/web/src/session-mode/components/codex/composer/AccessModePopover.tsx",
  "apps/web/src/session-mode/features/goals/ThreadGoalCard.tsx",
  "apps/web/src/session-mode/features/goals/goals.css",
  "apps/web/src/session-mode/features/goals/goalMaterialization.ts",
  "apps/web/src/session-mode/components/codex/hooks/useThreadGoal.ts",
  "apps/web/src/session-mode/services/threadGoalState.ts",
  "tests/e2e/session-composer-tooltip-coordination.spec.mts",
  "tests/e2e/session-composer-tooltip-leave.spec.mts",
  "apps/web/src/session-mode/components/codex/composer/ComposerTooltip.leave.native.test.tsx",
];
async function initializeJoint(page: Page, initial: Initial & { serviceTier: string | null }) {
  return page.evaluate(async ({ initial, cwd, side }) => {
    const load = (path: string) => import(
      performance.getEntriesByType("resource")
        .findLast((entry) => new URL(entry.name).pathname === path)?.name ?? path,
    );
    const [config, models, drafts, cards, layout, codex, sideChat, acp] = await Promise.all([
      load("/src/session-mode/components/codex/stores/useConfigStore.ts"),
      load("/src/session-mode/stores/useThreadModelStore.ts"),
      load("/src/session-mode/stores/useSessionDraftStore.ts"),
      load("/src/session-mode/stores/useAgentCenterStore.ts"),
      load("/src/session-mode/stores/useLayoutStore.ts"),
      load("/src/session-mode/components/codex/stores/useCodexStore.ts"),
      load("/src/session-mode/stores/useSideChatStore.ts"),
      load("/src/session-mode/stores/useAcpStore.ts"),
    ]);
    const setting = (model: string, effort: string | null, revision: number) => ({
      model, modelProvider: "openai", reasoningEffort: effort,
      providerModels: { openai: model }, serviceTier: null,
      sandbox: "workspace-write", sandboxPolicy: null,
      approvalPolicy: "on-request", approvalsReviewer: "user",
      autoReviewCapability: null, webSearchRequest: false,
      collaborationMode: "default", personality: null,
      revision, pending: false, pendingFields: [],
    });
    const a = { ...setting(initial.model, initial.effort, 4), serviceTier: initial.serviceTier };
    // Null is confined to an existing thread; global defaults remain valid medium.
    config.useConfigStore.setState({
      ...setting("r22-global-default", "medium", 0), personality: "friendly",
    });
    models.useThreadModelStore.setState({ threads: {
      "ux-0": a,
      "ux-1": setting("r22-other-owner-model", "high", 7),
      ...(initial.side ? { [side]: setting("r22-side-owner-model", "low", 9) } : {}),
    } });
    const owner = drafts.sessionDraftKey("codex", "ux-0");
    const otherOwner = drafts.sessionDraftKey("codex", "ux-1");
    const sideOwner = drafts.sessionDraftKey("codex", side);
    const acpOwner = drafts.sessionDraftKey("acp", "r22-owned-session", cwd, "r22-fixture-acp");
    drafts.useSessionDraftStore.getState().setText(owner, "R22 main initial draft");
    drafts.useSessionDraftStore.getState().setText(otherOwner, "R22 untouched B draft");
    drafts.useSessionDraftStore.getState().setText(sideOwner, "R22 side initial draft");
    drafts.useSessionDraftStore.getState().setText(acpOwner, "R22 ACP initial draft");
    layout.useLayoutStore.setState({ isSidebarOpen: false });
    cards.useAgentCenterStore.getState().addAgentCard(
      { kind: "codex", id: "ux-1", cwd, preview: "R22 other owner" }, { activate: false },
    );
    cards.useAgentCenterStore.getState().addAgentCard(
      { kind: "codex", id: "ux-0", cwd, preview: "R22 command owner A" }, { activate: true },
    );
    if (initial.side) {
      const state = codex.useCodexStore.getState();
      codex.useCodexStore.setState({
        threads: [...state.threads, {
          id: side, name: "R22 existing side", preview: "R22 side",
          cwd, status: { type: "idle" }, turns: [],
        }], events: { ...state.events, [side]: [] },
      });
      sideChat.useSideChatStore.setState({ chat: {
        id: side, parentId: "ux-0", title: "R22 existing side", images: [],
      } });
    } else sideChat.useSideChatStore.setState({ chat: null });
    if (initial.acp) acp.useAcpStore.setState({
      active: true, agentId: "r22-fixture-acp", connectionId: "r22-owned-connection",
      sessionId: "r22-owned-session", sessionCwd: cwd, agentTitle: "R22 isolated ACP",
      connecting: false, sessionTransition: null, sessionTransitionError: null,
      pendingSettingChanges: {}, running: false, entries: [], authMethods: [],
      models: null, modes: null, configOptions: [], reasoningEffort: null,
      permission: null, pendingPermissions: {}, authenticating: null,
    });
    return { owner, otherOwner, sideOwner, acpOwner } as {
      owner: string; otherOwner: string; sideOwner: string; acpOwner: string;
    };
  }, { initial, cwd: CWD, side: SIDE });
}


const OPTIONAL_HELPER = "apps/web/src/session-mode/components/codex/composer/nativePickerModelPowerChoices.ts";
const hashInputs = () => [...inputs, OPTIONAL_HELPER].map((path) => {
  if (path === OPTIONAL_HELPER && !existsSync(path)) return { path, optional: true, exists: false };
  return { path, exists: true, sha256: createHash("sha256").update(readFileSync(path)).digest("hex") };
});
const settle = (page: Page) => page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
async function recent(page: Page) {
  return page.evaluate(async () => {
    const path = "/src/session-mode/components/codex/composer/recentModelConfigs.ts";
    const url = performance.getEntriesByType("resource").findLast((entry) => new URL(entry.name).pathname === path)?.name;
    if (!url) throw Error("Mounted read-only recent module missing");
    return structuredClone((await import(url)).recentModelConfigs());
  });
}
async function inspectScope(scope: Locator) {
  return scope.evaluate((node) => {
    const editor = node.querySelector('[contenteditable="true"], .session-rich-draft textarea');
    const trigger = node.querySelector(".session-native-model-trigger");
    if (!editor || !trigger) throw Error("Captured scope editor or model trigger missing");
    const COMPOSER_SCOPE = ".session-codex-composer, .session-composer-sheet.is-full";
    const isMain = node.matches(".session-codex-composer"), isExpanded = node.matches(".session-composer-sheet.is-full");
    const sessionRoot = node.closest(".session-mode");
    const visible = (element: Element) => {
      const style = element.ownerDocument.defaultView?.getComputedStyle(element);
      return element.isConnected && !element.closest("[hidden], [inert]") && Boolean(style
        && style.display !== "none" && style.visibility !== "hidden" && style.visibility !== "collapse"
        && element.getClientRects().length > 0);
    };
    if (isMain === isExpanded || !sessionRoot || !sessionRoot.contains(node)
      || !node.contains(editor) || !node.contains(trigger)
      || editor.closest(COMPOSER_SCOPE) !== node || trigger.closest(COMPOSER_SCOPE) !== node
      || editor.closest(".session-mode") !== sessionRoot || trigger.closest(".session-mode") !== sessionRoot
      || !visible(sessionRoot) || !visible(node) || !visible(editor) || !visible(trigger))
      throw Error("Captured main or full Sheet scope topology or physical visibility changed");
    const scopeKind = isExpanded ? "expanded" : "main";
    return { scopeKind, ownerAttribute: node.getAttribute("data-draft-owner"), scopeRootOwnerAttribute: node.getAttribute("data-draft-owner"),
      editorText: editor instanceof HTMLTextAreaElement ? editor.value : editor?.textContent ?? null,
      activeIsEditor: document.activeElement === editor,
      trigger: { rawAria: trigger?.getAttribute("aria-label") ?? null,
        model: trigger?.querySelector(".session-native-model-label")?.textContent ?? null,
        effort: trigger?.querySelector(".session-native-model-effort")?.textContent ?? null } };
  });
}

/** Read-only, six already-mounted modules, <=64 reads, no subscription/store setter. */
async function createProtectionReader(page: Page) {
  return page.evaluateHandle(async ({ ownerA, ownerB }) => {
    const paths = [
      "/src/session-mode/stores/useThreadModelStore.ts",
      "/src/session-mode/components/codex/stores/useConfigStore.ts",
      "/src/session-mode/stores/useSessionDraftStore.ts",
      "/src/session-mode/stores/settings/useModelSettingsStore.ts",
      "/src/session-mode/components/codex/composer/v2/drafts.ts",
      "/src/session-mode/components/codex/hooks/useModels.ts",
    ];
    const urls = paths.map((path) => {
      const url = performance.getEntriesByType("resource").findLast((entry) => new URL(entry.name).pathname === path)?.name;
      if (!url) throw Error("Mounted protection module missing: " + path);
      return url;
    });
    const [models, config, drafts, custom, rich, cache] = await Promise.all(urls.map((url) => import(url)));
    const clone = (value: unknown) => JSON.parse(JSON.stringify(value));
    const thread = () => models.useThreadModelStore.getState();
    const richState = () => rich.useComposerDraftStore.getState();
    let fixed = {
      a: thread().threads["ux-0"], aValue: clone(thread().threads["ux-0"]),
      b: thread().threads["ux-1"], bValue: clone(thread().threads["ux-1"]),
      defaults: config.useConfigStore.getState(), custom: custom.useModelSettingsStore.getState(),
      text: drafts.useSessionDraftStore.getState(), richA: richState().drafts[ownerA],
      richB: richState().drafts[ownerB], cache: cache.useModelCacheStore.getState(),
    } as any;
    let count = 0;
    return {
      read: () => {
        if (!fixed || ++count > 64) throw Error("Protection reader disposed or bounded read limit exceeded");
        const current = thread(), richNow = richState(), aRich = richNow.drafts[ownerA];
        return clone({ reads: count, moduleURLs: urls,
          a: current.threads["ux-0"], oldAUnchanged: JSON.stringify(fixed.a) === JSON.stringify(fixed.aValue),
          same: { a: current.threads["ux-0"] === fixed.a, b: current.threads["ux-1"] === fixed.b,
            defaults: config.useConfigStore.getState() === fixed.defaults,
            custom: custom.useModelSettingsStore.getState() === fixed.custom,
            text: drafts.useSessionDraftStore.getState() === fixed.text,
            cache: cache.useModelCacheStore.getState() === fixed.cache,
            richB: richNow.drafts[ownerB] === fixed.richB,
            richContexts: aRich?.contexts === fixed.richA?.contexts,
            richDrawings: aRich?.drawings === fixed.richA?.drawings },
          b: current.threads["ux-1"], defaults: config.useConfigStore.getState(),
          custom: custom.useModelSettingsStore.getState().models,
          text: drafts.useSessionDraftStore.getState().drafts,
          rich: { a: aRich, b: richNow.drafts[ownerB], error: richNow.error,
            others: Object.fromEntries(Object.entries(richNow.drafts).filter(([owner]) => owner !== ownerA)) } });
      },
      dispose: () => { fixed = null; },
    };
  }, { ownerA: OWNER_A, ownerB: OWNER_B });
}
/** Passive actual subscriptions only. No store setters, chooser or readiness result is exposed. */
async function createDefaultObserver(page: Page) {
  return page.evaluateHandle(async () => {
    const paths = ["/src/session-mode/stores/useThreadModelStore.ts", "/src/session-mode/stores/settings/useNativeModelPickerPreferencesStore.ts"];
    const urls = paths.map((path) => {
      const url = performance.getEntriesByType("resource").findLast((entry) => new URL(entry.name).pathname === path)?.name;
      if (!url) throw Error("Mounted Default observation module missing: " + path); return url;
    });
    const [models, prefs] = await Promise.all(urls.map((url) => import(url)));
    const initial = prefs.useNativeModelPickerPreferencesStore.getState(), initialEnabled = initial.enabledReasoningEfforts;
    let disposed = false, reads = 0, overflow = false;
    const events: Array<Record<string, unknown>> = [];
    const append = (value: Record<string, unknown>) => { if (events.length >= 16) overflow = true; else events.push(value); };
    const offA = models.useThreadModelStore.subscribe((state: any, previous: any) => {
      if (disposed || state.threads["ux-0"] === previous.threads["ux-0"]) return;
      const a = state.threads["ux-0"];
      append(a ? { kind: "intent", model: a.model, reasoningEffort: a.reasoningEffort, serviceTier: a.serviceTier ?? null, revision: a.revision, mode: prefs.useNativeModelPickerPreferencesStore.getState().selectionMode } : { kind: "missing" });
    });
    const offFI = prefs.useNativeModelPickerPreferencesStore.subscribe((state: any, previous: any) => {
      if (!disposed && state.selectionMode !== previous.selectionMode) append({ kind: "mode", mode: state.selectionMode });
    });
    return {
      read: () => {
        if (disposed || ++reads > 64) throw Error("Default observer disposed or bounded read limit exceeded");
        const current = prefs.useNativeModelPickerPreferencesStore.getState();
        return { reads, overflow, initialMode: initial.selectionMode, mode: current.selectionMode, sameEnabled: current.enabledReasoningEfforts === initialEnabled,
          enabled: [...current.enabledReasoningEfforts], moduleURLs: urls, events: events.map((event) => ({ ...event })) };
      },
      dispose: () => {
        if (disposed) return { disposed: true, subscribed: false };
        disposed = true; offA(); offFI(); const receipt = { disposed: true, subscribed: false, eventCount: events.length, overflow };
        events.length = 0; return receipt;
      },
    };
  });
}
/** Existing running/preference state is captured once after initialization, never written by this reader. */
async function createRuntimeReader(page: Page) {
  return page.evaluateHandle(async () => {
    const paths = ["/src/session-mode/components/codex/stores/useCodexStore.ts", "/src/session-mode/stores/useFollowupSettingsStore.ts"];
    const urls = paths.map((path) => {
      const url = performance.getEntriesByType("resource").findLast((entry) => new URL(entry.name).pathname === path)?.name;
      if (!url) throw Error("Mounted runtime/followup module missing: " + path); return url;
    });
    const [runtime, followup] = await Promise.all(urls.map((url) => import(url)));
    const value = () => {
      const state = runtime.useCodexStore.getState(), thread = state.threads.find((entry: { id: string }) => entry.id === "ux-0");
      return { currentThreadId: state.currentThreadId, currentTurnId: state.currentTurnId,
        threadStatus: thread?.status, turns: thread?.turns, status: state.threadStatusMap["ux-0"], timing: state.turnTimingMap["ux-0"],
        goals: state.goalMap, followup: { mode: followup.useFollowupSettingsStore.getState().mode,
          enterBehavior: followup.useFollowupSettingsStore.getState().enterBehavior, reviewDelivery: followup.useFollowupSettingsStore.getState().reviewDelivery } };
    };
    let fixed: { turns: unknown; status: unknown; timing: unknown; followup: unknown; goals: unknown } | null = (() => {
      const state = runtime.useCodexStore.getState();
      return { turns: state.threads.find((entry: { id: string }) => entry.id === "ux-0")?.turns,
        status: state.threadStatusMap["ux-0"], timing: state.turnTimingMap["ux-0"], followup: followup.useFollowupSettingsStore.getState(), goals: state.goalMap };
    })();
    let reads = 0;
    return { read: () => {
      if (!fixed || ++reads > 64) throw Error("Runtime protection reader disposed or overflowed");
      const state = runtime.useCodexStore.getState();
      return { reads, urls, value: JSON.parse(JSON.stringify(value())), same: {
        turns: state.threads.find((entry: { id: string }) => entry.id === "ux-0")?.turns === fixed.turns,
        status: state.threadStatusMap["ux-0"] === fixed.status, timing: state.turnTimingMap["ux-0"] === fixed.timing,
        followup: followup.useFollowupSettingsStore.getState() === fixed.followup, goals: state.goalMap === fixed.goals } };
    }, dispose: () => { fixed = null; return { disposed: true, retained: false }; } };
  });
}

type SurfaceHandles = {
  scope: NonNullable<Awaited<ReturnType<Locator["elementHandle"]>>>;
  editor: NonNullable<Awaited<ReturnType<Locator["elementHandle"]>>>;
  trigger: NonNullable<Awaited<ReturnType<Locator["elementHandle"]>>>;
  sessionRoot: NonNullable<Awaited<ReturnType<Locator["elementHandle"]>>>;
};
async function captureSurface(scope: Locator): Promise<SurfaceHandles> {
  const scopeNode = await scope.elementHandle(), editor = await scope.locator(EDITOR).first().elementHandle();
  const trigger = await scope.locator(".session-native-model-trigger").elementHandle();
  const sessionRoot = await scope.locator("xpath=ancestor::*[contains(concat(' ',normalize-space(@class),' '),' session-mode ')][1]").elementHandle();
  if (!scopeNode || !editor || !trigger || !sessionRoot) throw Error("Actual scope/editor/model/sessionRoot identity capture failed");
  return { scope: scopeNode, editor, trigger, sessionRoot };
}
async function surfaceIdentity(scope: Locator, held: SurfaceHandles) {
  return scope.evaluate((node, held) => ({ scope: node === held.scope,
    editor: node.querySelector('[contenteditable="true"],.session-rich-draft textarea') === held.editor,
    trigger: node.querySelector('.session-native-model-trigger') === held.trigger,
    sessionRoot: node.closest('.session-mode') === held.sessionRoot,
    connected: held.scope.isConnected && held.editor.isConnected && held.trigger.isConnected && held.sessionRoot.isConnected }), held);
}

/** Passive original-node/ID observer. No handlers, focus, DOM or store mutation. */
async function observeLeave(target: Locator) {
  return target.evaluateHandle((node) => {
    if (!(node instanceof HTMLButtonElement)) throw Error("Actual ordinary Button required");
    const doc = node.ownerDocument;
    let held: HTMLButtonElement | null = node, nativeId: string | null = null, active = true, overflow = false, reads = 0, serial = 0;
    const ids = new WeakMap<Element, number>();
    const uid = (element: Element | null) => {
      if (!element) return null; let value = ids.get(element);
      if (!value) { if (++serial > 1024) { overflow = true; return null; } value = serial; ids.set(element, value); }
      return value;
    };
    const rect = (element: Element) => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, top: r.top, left: r.left, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
    const describe = (element: Element | null) => element ? { uid: uid(element), tag: element.tagName, role: element.getAttribute("role"),
      id: element.id || null, classes: element.getAttribute("class"), label: element.getAttribute("aria-label"), connected: element.isConnected } : null;
    const visibilityAncestry = (element: Element) => {
      const ancestryLimit = 96;
      const ancestry: Array<{ uid: number | null; tag: string; id: string | null; opacity: string; opacityNumber: number;
        display: string; visibility: string; pointerEvents: string; hidden: boolean; inert: boolean; isBody: boolean; isDocumentElement: boolean }> = [];
      let reachedBody = false, reachedDocumentElement = false;
      for (let parent: Element | null = element; parent; parent = parent.parentElement) {
        if (ancestry.length >= ancestryLimit) { overflow = true; throw Error("Tooltip visibility ancestry overflow (limit96)"); }
        const css = getComputedStyle(parent), opacity = Number.parseFloat(css.opacity);
        if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) throw Error("Unknown tooltip computed opacity: " + css.opacity);
        const isBody = parent === doc.body, isDocumentElement = parent === doc.documentElement;
        reachedBody ||= isBody; reachedDocumentElement ||= isDocumentElement;
        ancestry.push({ uid: uid(parent), tag: parent.tagName, id: parent.id || null, opacity: css.opacity, opacityNumber: opacity,
          display: css.display, visibility: css.visibility, pointerEvents: css.pointerEvents,
          hidden: parent.hasAttribute("hidden"), inert: parent.hasAttribute("inert"), isBody, isDocumentElement });
      }
      const endedAtDocumentElement = ancestry[ancestry.length - 1]?.isDocumentElement === true;
      if (!reachedDocumentElement || !endedAtDocumentElement) throw Error("Tooltip visibility ancestry did not reach actual documentElement");
      return { ancestry, ancestryDepth: ancestry.length, ancestryLimit, reachedBody, reachedDocumentElement, endedAtDocumentElement };
    };
    const physical = (element: Element | null) => {
      if (!element || !element.isConnected || element.closest("[hidden],[inert]")) return false;
      const r = element.getBoundingClientRect(); if (r.width <= 0 || r.height <= 0 || element.getClientRects().length === 0) return false;
      const path = visibilityAncestry(element);
      return !path.ancestry.some((parent) => parent.hidden || parent.inert || parent.display === "none"
        || parent.visibility === "hidden" || parent.visibility === "collapse" || parent.opacityNumber === 0);
    };
    const getOwned = () => {
      if (!held || !held.isConnected || held.ownerDocument !== doc) throw Error("Original ordinary Button identity/document lost");
      const describedby = held.getAttribute("aria-describedby"), tokens = (describedby ?? "").split(/\s+/).filter(Boolean);
      if (tokens.length > 1 || (nativeId && tokens.some((id) => id !== nativeId))) throw Error("Ambiguous or changed native Tooltip description");
      const id = nativeId ?? tokens[0] ?? null;
      const matches = id ? [...doc.querySelectorAll<HTMLElement>('[role="tooltip"]')].filter((element) => element.id === id) : [];
      if (matches.length > 1) throw Error("Duplicate native description ID");
      const content = matches[0]?.closest<HTMLElement>('[data-slot="tooltip-content"]') ?? null;
      if (matches.length && !content) throw Error("Description no longer belongs to actual Content");
      return { id, describedby, matches, content };
    };
    const eventRows: Array<{ type: string; trusted: boolean; now: number; target: ReturnType<typeof describe>; related: ReturnType<typeof describe>;
      key: string | null; x: number | null; y: number | null; pointerType: string | null; isTrigger: boolean; insideTrigger: boolean; insideTooltip: boolean;
      active: ReturnType<typeof describe>; focused: boolean }> = [];
    const listener = (event: Event) => {
      if (!active || !held) return;
      if (eventRows.length >= 1024) { overflow = true; return; }
      const target = event.target instanceof Element ? event.target : null;
      const related = event instanceof FocusEvent || event instanceof MouseEvent ? event.relatedTarget : null;
      eventRows.push({ type: event.type, trusted: event.isTrusted, now: performance.now(), target: describe(target),
        related: describe(related instanceof Element ? related : null), key: event instanceof KeyboardEvent ? event.key : null,
        x: event instanceof MouseEvent ? event.clientX : null, y: event instanceof MouseEvent ? event.clientY : null,
        pointerType: event instanceof PointerEvent ? event.pointerType : null,
        isTrigger: target === held, insideTrigger: Boolean(target && held.contains(target)),
        insideTooltip: Boolean(target?.closest('[data-slot="tooltip-content"]')), active: describe(doc.activeElement), focused: doc.hasFocus() });
    };
    const types = ["keydown", "focusin", "focusout", "blur", "pointerover", "pointerout", "pointerleave", "pointermove", "pointerdown", "click", "submit"];
    types.forEach((type) => doc.addEventListener(type, listener, true));
    const contentValue = (content: HTMLElement) => {
      const direct = content.querySelector<HTMLElement>(":scope > .session-native-composer-tooltip-label");
      const css = getComputedStyle(content), own = content.getAnimations({ subtree: false });
      if (own.length > 8) overflow = true;
      const descriptions = [...content.querySelectorAll<HTMLElement>('[role="tooltip"]')]; if (descriptions.length > 8) overflow = true;
      const arrows = [...content.querySelectorAll<SVGElement>("svg")].filter((element) => !element.closest('[role="tooltip"]'));
      if (arrows.length > 8) overflow = true;
      const ancestry = visibilityAncestry(content);
      return { uid: uid(content), connected: content.isConnected, state: content.dataset.state ?? null, side: content.dataset.side ?? null,
        rect: rect(content), physical: physical(content), opacity: css.opacity, pointerEvents: css.pointerEvents,
        label: direct?.textContent ?? null, labelPhysical: physical(direct), labelRect: direct ? rect(direct) : null,
        descriptions: descriptions.slice(0, 8).map((element) => ({ id: element.id, role: element.getAttribute("role"), text: element.textContent, rect: rect(element) })),
        arrows: arrows.slice(0, 8).map((element) => ({ uid: uid(element), rect: rect(element), parentRect: element.parentElement ? rect(element.parentElement) : null, physical: physical(element) })),
        animations: own.slice(0, 8).map((animation) => ({ playState: animation.playState, pending: animation.pending,
          currentTime: typeof animation.currentTime === "number" ? animation.currentTime : null })), ...ancestry };
    };
    return {
      capture: () => {
        const owned = getOwned();
        if (!owned.id || owned.matches.length !== 1 || !owned.content || !physical(owned.content)
          || !physical(owned.content.querySelector(":scope > .session-native-composer-tooltip-label"))) throw Error("Positive actual hint required before native identity capture");
        if (nativeId && nativeId !== owned.id) throw Error("Captured native ID changed"); nativeId = owned.id;
        return nativeId;
      },
      read: (point: { x: number; y: number } | null = null) => {
        if (!active || !held || ++reads > 96) throw Error("Leave observer disposed or read budget exceeded");
        const owned = getOwned(), all = [...doc.querySelectorAll<HTMLElement>('[data-slot="tooltip-content"]')];
        if (all.length > 16) overflow = true;
        const content = owned.content ? contentValue(owned.content) : null;
        const hit = point ? doc.elementFromPoint(point.x, point.y) : null;
        return { now: performance.now(), subscribed: active, overflow, reads, nativeId,
          trigger: { uid: uid(held), rect: rect(held), connected: held.isConnected, rawAria: held.getAttribute("aria-label"),
            labelledby: held.getAttribute("aria-labelledby"), title: held.getAttribute("title"), text: held.textContent,
            describedby: owned.describedby, disabled: held.disabled, physical: physical(held), focused: doc.activeElement === held,
            focusVisible: held.matches(":focus-visible"), hovered: held.matches(":hover"), ...visibilityAncestry(held) },
          model: { id: owned.id, nativeIdCount: owned.matches.length, contentCount: owned.content ? 1 : 0,
            visibleLabels: content?.physical && content.labelPhysical ? [content.label] : [], content },
          globals: all.slice(0, 16).map(contentValue), active: describe(doc.activeElement), focused: doc.hasFocus(),
          point: point ? { ...point, hit: describe(hit), insideTrigger: Boolean(hit && held.contains(hit)),
            insideTooltip: Boolean(hit?.closest('[data-slot="tooltip-content"]')) } : null,
          viewport: { width: innerWidth, height: innerHeight, overflow: doc.documentElement.scrollWidth - innerWidth }, events: eventRows.map((row) => ({ ...row })) };
      },
      dispose: () => { types.forEach((type) => doc.removeEventListener(type, listener, true)); active = false;
        const receipt = { disposed: true, subscribed: active, retainedNodes: false, events: eventRows.length, ids: serial, overflow };
        eventRows.length = 0; held = null; nativeId = null; return receipt; },
    };
  });
}
type LeaveProbe = Awaited<ReturnType<typeof observeLeave>>;
const readLeave = (probe: LeaveProbe, point: { x: number; y: number } | null = null) => probe.evaluate((value, point) => value.read(point), point);
type HintSnapshot = Awaited<ReturnType<typeof readLeave>>;
function positiveHint(value: HintSnapshot, purpose: string) {
  expect(value.overflow).toBe(false); expect(value.focused).toBe(true); expect(value.trigger.physical).toBe(true);
  expect(value.model.nativeIdCount).toBe(1); expect(value.model.contentCount).toBe(1); expect(value.model.visibleLabels).toEqual([purpose]);
  const content = value.model.content; if (!content || !value.model.id) throw Error("Genuine positive own hint/ID not reached");
  return content;
}
/** Choose once from the actual open geometry, never from a hidden-result poll. */
function gapPoint(value: HintSnapshot) {
  const content = value.model.content;
  if (!content || !content.physical || !content.labelPhysical) throw Error("Driver requires actual shown ordinary Content");
  const a = value.trigger.rect, b = content.rect, side = content.side;
  const horizontal = side === "top" || side === "bottom";
  if (!horizontal && side !== "left" && side !== "right") throw Error("Unknown actual Tooltip placement; gap driver not qualified");
  const low = horizontal ? Math.max(a.left, b.left) : Math.max(a.top, b.top);
  const high = horizontal ? Math.min(a.right, b.right) : Math.min(a.bottom, b.bottom);
  const separation = side === "top" ? a.top - b.bottom : side === "bottom" ? b.top - a.bottom : side === "left" ? a.left - b.right : b.left - a.right;
  if (high - low <= 2 || separation <= 0) throw Error("No actual visible hint/trigger gap; driver cannot qualify");
  const inset = Math.min(1, separation / 2);
  const normal = side === "top" ? a.top - inset : side === "bottom" ? a.bottom + inset : side === "left" ? a.left - inset : a.right + inset;
  const inside = (p: { x: number; y: number }, r: typeof a) => p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom;
  for (const fraction of [0.25, 0.75, 0.125, 0.875, 0.5]) {
    const tangent = low + (high - low) * fraction, point = horizontal ? { x: tangent, y: normal } : { x: normal, y: tangent };
    if (point.x <= 0 || point.y <= 0 || point.x >= value.viewport.width || point.y >= value.viewport.height || inside(point, a) || inside(point, b)) continue;
    if (content.arrows.some((arrow) => arrow.physical && (inside(point, arrow.rect) || (arrow.parentRect && inside(point, arrow.parentRect))))) continue;
    return { ...point, side, separation, tangentOverlap: { low, high }, trigger: a, content: b, arrows: content.arrows };
  }
  throw Error("No actual gap point outside Content/arrow within shared projection; no fallback trajectory");
}
function unexpectedConsoleErrors(records: ReadonlyArray<{ text: string; url: string }>, origin: string) {
  return records.filter((entry) => !(entry.url === new URL("/@vite/client", origin).href && entry.text.startsWith("[vite] failed to connect to websocket.\n")));
}
async function keyboardTo(page: Page, target: Locator, phase: string, receipts: Array<{ phase: string; tabs: number }>) {
  let tabs = 0;
  while (!(await target.evaluate((node) => node === document.activeElement)) && tabs < 64) { await page.keyboard.press("Tab"); tabs++; }
  expect(tabs, phase).toBeGreaterThan(0); expect(tabs, phase).toBeLessThanOrEqual(64);
  expect(await target.evaluate((node) => node === document.activeElement && node.matches(":focus-visible")), phase).toBe(true); receipts.push({ phase, tabs });
}
async function hoverActual(page: Page, target: Locator) {
  const value = await target.evaluate((node) => { const r = node.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
    return { x, y, width: r.width, height: r.height, viewport: { width: innerWidth, height: innerHeight }, hit: node.contains(document.elementFromPoint(x, y)) }; });
  expect(value.width).toBeGreaterThan(0); expect(value.height).toBeGreaterThan(0); expect(value.hit).toBe(true);
  expect(value.x).toBeGreaterThan(0); expect(value.y).toBeGreaterThan(0); expect(value.x).toBeLessThan(value.viewport.width); expect(value.y).toBeLessThan(value.viewport.height);
  await page.mouse.move(value.x, value.y); return value;
}
type TargetCheck = { phase: string; target: string; actual: unknown; expected: unknown; pass: boolean };
function closedChecks(phase: string, value: HintSnapshot): TargetCheck[] {
  return [
    { phase, target: "own visible label released", actual: value.model.visibleLabels, expected: [], pass: value.model.visibleLabels.length === 0 },
    { phase, target: "actual owned Content unmounted, including exit DOM", actual: value.model.contentCount, expected: 0, pass: value.model.contentCount === 0 },
    { phase, target: "native descriptive node released", actual: value.model.nativeIdCount, expected: 0, pass: value.model.nativeIdCount === 0 },
    { phase, target: "own description association released", actual: value.trigger.describedby, expected: null, pass: value.trigger.describedby === null },
  ];
}

for (const scenario of cases) test.describe("E11 ordinary leave " + scenario.id, () => {
  test.use({ viewport: { width: scenario.width, height: scenario.width === 390 ? 844 : 900 }, hasTouch: scenario.width === 390, isMobile: scenario.width === 390 });
  test("one genuine gap leave releases the hint while raw state and real actions stay protected", async ({ page }, info) => {
    const theme = scenario.width === 1440 ? "dark" : "light", draft = "E11 retained draft " + scenario.id;
    const catalog = [model(TERRA, TL, ["low"], "low", true), model(SOL, "S", ["low", "medium", "high"], "medium", false)];
    const counts = [0, 0, 0, 0], directory: unknown[] = [], writes: unknown[] = [], api: unknown[] = [], external: unknown[] = [];
    const errors: string[] = [], consoleErrors: Array<{ text: string; url: string }> = [], cleanupErrors: string[] = [], screenshots: string[] = [];
    const targetChecks: TargetCheck[] = [], tabs: Array<{ phase: string; tabs: number }> = [], trajectories: Array<Record<string, unknown>> = [];
    let phase = "setup", origin = "", failure: string | null = null, hardControlsCompleted = false;
    let reader: Awaited<ReturnType<typeof createReader>> | null = null, protection: Awaited<ReturnType<typeof createProtectionReader>> | null = null;
    let defaults: Awaited<ReturnType<typeof createDefaultObserver>> | null = null, runtime: Awaited<ReturnType<typeof createRuntimeReader>> | null = null;
    let inputObserver: Awaited<ReturnType<typeof observe>> | null = null, probe: LeaveProbe | null = null;
    let stream: Awaited<ReturnType<typeof createFeedbackEventStream>> | null = null;
    let streamCleanup: Awaited<ReturnType<Awaited<ReturnType<typeof createFeedbackEventStream>>["close"]>> | null = null;
    let probeCleanup: unknown = null, finalProbe: HintSnapshot | null = null, inputEvents: unknown = null, defaultReceipt: unknown = null;
    let defaultCleanup: unknown = null, runtimeCleanup: unknown = null;
    let sourceBefore: ReturnType<typeof hashInputs> | null = null, sourceAfter: ReturnType<typeof hashInputs> | null = null;
    let mainHandles: SurfaceHandles | null = null, activeHandles: SurfaceHandles | null = null;
    const capturedHandles: SurfaceHandles[] = [];
    let targetHandle: Awaited<ReturnType<Locator["elementHandle"]>> | null = null;
    const main = page.locator(MAIN); let scope = main;
    type State = {
      phase: string; value: Awaited<ReturnType<typeof read>>; identity: Awaited<ReturnType<typeof read>>;
      scope: Awaited<ReturnType<typeof inspectScope>>; dom: Awaited<ReturnType<typeof surfaceIdentity>>;
      publication: { reads: number; overflow: boolean; initialMode: unknown; mode: unknown; sameEnabled: boolean; enabled: unknown[]; moduleURLs: string[]; events: Record<string, unknown>[] };
      runtime: { reads: number; urls: string[]; value: unknown; same: { turns: boolean; status: boolean; timing: boolean; followup: boolean; goals: boolean } };
      tooltip: HintSnapshot | null;
    };
    const states: State[] = [];
    const record = async (name: string, snapshot?: HintSnapshot) => {
      if (!reader || !protection || !defaults || !runtime || !activeHandles || states.length >= 40) throw Error("Readonly probes missing or phase bound exceeded");
      phase = name;
      // Exit snapshots are captured first, in their own next-frame evaluate;
      // later protection reads cannot silently replace them with a settled node.
      const tooltip = snapshot ?? (probe ? await readLeave(probe) : null);
      const row: State = { phase: name, tooltip, value: await read(page, reader), identity: await protection.evaluate((value) => value.read()),
        scope: await inspectScope(scope), dom: await surfaceIdentity(scope, activeHandles),
        publication: await defaults.evaluate((value) => value.read()), runtime: await runtime.evaluate((value) => value.read()) };
      states.push(row); return row;
    };
    const shot = async (name: string) => { const path = info.outputPath(name + ".png"); await page.screenshot({ path, fullPage: true }); screenshots.push(path); };
    page.on("pageerror", (error) => errors.push(error.stack ?? String(error)));
    page.on("console", (message) => { if (message.type() === "error") consoleErrors.push({ text: message.text(), url: message.location().url }); });
    try {
      sourceBefore = hashInputs(); origin = new URL(String(info.project.use.baseURL)).origin;
      if (["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname)) throw Error("Owned LAN frontend required");
      stream = await createFeedbackEventStream(origin);
      await page.addInitScript(({ origin, theme, mode, custom, ownerA, ownerB }) => {
        if (window !== window.top || location.origin !== origin) return;
        localStorage.setItem("kanban.session.native-model-picker-preferences", JSON.stringify({ state: { selectionMode: mode,
          enabledReasoningEfforts: ["low", "medium", "high", "xhigh", "ultra", "persistent"] }, version: 1 }));
        localStorage.setItem("kanban.session.theme-storage", JSON.stringify({ state: { theme }, version: 0 }));
        localStorage.setItem("kanban.session.model-settings", JSON.stringify({ state: { models: custom }, version: 2 }));
        localStorage.setItem("kanban.session.composer-v2", JSON.stringify({ [ownerA]: { contexts: [], drawings: {}, expanded: false, plain: true },
          [ownerB]: { contexts: [], drawings: {}, expanded: false, plain: false } }));
      }, { origin, theme, mode: scenario.mode, custom: CUSTOM, ownerA: OWNER_A, ownerB: OWNER_B });
      await page.route("**/*", async (route) => {
        const request = route.request();
        if (new URL(request.url()).origin !== origin || !["GET", "HEAD"].includes(request.method())) {
          external.push({ method: request.method(), url: request.url() }); await route.abort("blockedbyclient");
        } else await route.continue();
      });
      await installSessionUxFixture(page, 2);
      await page.route("**/api/**", async (route) => {
        const request = route.request(), url = new URL(request.url()), path = url.pathname;
        const entry = { method: request.method(), path, body: request.method() === "POST" ? request.postDataJSON() : null }; api.push(entry);
        if (url.origin !== origin) { external.push({ method: entry.method, url: request.url() }); await route.abort("blockedbyclient"); return; }
        if (path === "/api/session/api/events" && entry.method === "GET") {
          if (!stream) throw Error("Owned SSE missing"); await route.continue({ url: stream.url }); return;
        }
        const index = paths.findIndex((suffix) => path.endsWith(suffix));
        if (index >= 0) {
          directory.push(entry); const valid = path === "/api/session" + paths[index] && entry.method === (index === 0 ? "POST" : "GET")
            && (index === 0 ? isDeepStrictEqual(entry.body, { cursor: null, limit: 100 }) : entry.body === null);
          if (!valid) { writes.push(entry); await route.fulfill({ status: 409, json: { error: "E11 catalog read contract mismatch" } }); return; }
          counts[index]++; await route.fulfill({ json: index === 0 ? { data: catalog, nextCursor: null } : [] }); return;
        }
        if (path === "/api/session/api/codex/thread/goal/get") {
          const body = entry.body as { threadId?: unknown } | null;
          if (entry.method !== "POST" || !body || typeof body.threadId !== "string") { writes.push(entry); await route.fulfill({ status: 409, json: { error: "Goal readonly request mismatch" } }); return; }
          await route.fulfill({ json: { goal: scenario.consumer === "goal" && body.threadId === "ux-0" ? FIXTURE_GOAL : null } }); return;
        }
        if (!["GET", "HEAD"].includes(entry.method) && !reads.has(path) && !bookkeeping.has(path)) {
          writes.push(entry); await route.fulfill({ status: 409, json: { error: "E11 forbidden mutation rejected" } }); return;
        }
        await route.fallback();
      });
      await page.goto("/?mode=session&view=agent", { waitUntil: "domcontentloaded" }); await main.locator(EDITOR).first().waitFor();
      // Only initial fixture hydration. No setters or synthetic events after baseline.
      await seedSessionUx(page, 2); const owners = await initializeJoint(page, { model: SOL, effort: scenario.raw, serviceTier: "fast" });
      expect(owners.owner).toBe(OWNER_A); expect(owners.otherOwner).toBe(OWNER_B);
      reader = await createReader(page, owners); inputObserver = await observe(page);
      await expect.poll(async () => { if (!reader) throw Error("Reader missing"); const value = await read(page, reader); return { owner: value.owner, thread: value.currentThreadId }; },
        { timeout: 5000, intervals: [25, 50, 100] }).toEqual({ owner: OWNER_A, thread: "ux-0" });
      await main.locator(EDITOR).first().fill(draft); await expect.poll(() => counts).toEqual([1, 1, 1, 1]);
      await expect.poll(async () => { if (!reader) throw Error("Reader missing"); return (await read(page, reader)).cache.loaded; }).toBe(true);
      await expect.poll(async () => { if (!reader) throw Error("Reader missing"); return (await read(page, reader)).eventStreamConnected; }).toBe(true);
      if (scenario.consumer === "goal") await expect(main.locator('.session-thread-goal[data-goal-thread="ux-0"]')).toBeVisible();
      await settle(page);
      mainHandles = await captureSurface(main); activeHandles = mainHandles; capturedHandles.push(mainHandles);
      protection = await createProtectionReader(page); defaults = await createDefaultObserver(page); runtime = await createRuntimeReader(page);
      const baseline = await record("baseline-main"), initialRecent = await recent(page);
      const protect = async (row: State, expanded: boolean) => {
        const value = row.value, first = baseline.value, identity = row.identity, firstIdentity = baseline.identity;
        expect(value.currentThreadId, row.phase).toBe("ux-0"); expect(value.owner, row.phase).toBe(OWNER_A); expect(value.eventStreamConnected, row.phase).toBe(true);
        expect(value.entry, row.phase).toEqual(first.entry); expect(value.allThreads, row.phase).toEqual(first.allThreads); expect(value.settings, row.phase).toEqual(first.settings);
        expect(value.defaults, row.phase).toEqual(first.defaults); expect(value.drafts, row.phase).toEqual(first.drafts); expect(value.editorText, row.phase).toBe(draft);
        expect(value.cache, row.phase).toEqual(first.cache); expect(value.cache, row.phase).toMatchObject({ loaded: true, loading: false, error: null, modelStatus: "success", hasModelSnapshot: true });
        expect(value.cache.models, row.phase).toEqual(catalog); expect(value.cacheIdentity, row.phase).toEqual({ captured: true, array: true, models: true, efforts: true });
        expect(value.acp, row.phase).toEqual(first.acp); expect(value.sideChat, row.phase).toEqual(first.sideChat);
        expect(identity.oldAUnchanged, row.phase).toBe(true); expect(identity.same, row.phase).toEqual({ a: true, b: true, defaults: true, custom: true, text: true, cache: true, richB: true, richContexts: true, richDrawings: true });
        expect(identity.a, row.phase).toEqual(firstIdentity.a); expect(identity.b, row.phase).toEqual(firstIdentity.b);
        expect(identity.defaults, row.phase).toEqual(firstIdentity.defaults); expect(identity.custom, row.phase).toEqual(CUSTOM); expect(identity.text, row.phase).toEqual(firstIdentity.text);
        expect(identity.rich.a, row.phase).toEqual({ ...firstIdentity.rich.a, expanded }); expect(identity.rich.b, row.phase).toEqual(firstIdentity.rich.b);
        expect(identity.rich.others, row.phase).toEqual(firstIdentity.rich.others); expect(identity.rich.error, row.phase).toBeNull();
        expect(row.scope.scopeKind, row.phase).toBe(expanded ? "expanded" : "main"); expect(row.scope.ownerAttribute, row.phase).toBe(expanded ? null : OWNER_A); expect(row.scope.editorText, row.phase).toBe(draft);
        expect(row.dom, row.phase).toEqual({ scope: true, editor: true, trigger: true, sessionRoot: true, connected: true });
        expect(row.publication.mode, row.phase).toBe(scenario.mode); expect(row.publication.events, row.phase).toEqual([]);
        expect(row.publication.sameEnabled, row.phase).toBe(true); expect(row.publication.overflow, row.phase).toBe(false);
        expect(row.publication.enabled, row.phase).toEqual(["low", "medium", "high", "xhigh", "ultra", "persistent"]);
        expect(row.runtime.value, row.phase).toEqual(baseline.runtime.value); expect(row.runtime.same, row.phase).toEqual({ turns: true, status: true, timing: true, followup: true, goals: true });
        expect(await recent(page), row.phase).toEqual(initialRecent); expect(counts, row.phase).toEqual([1, 1, 1, 1]);
        expect(writes, row.phase).toEqual([]); expect(external, row.phase).toEqual([]); expect(errors, row.phase).toEqual([]); expect(unexpectedConsoleErrors(consoleErrors, origin), row.phase).toEqual([]);
        if (row.tooltip) { expect(row.tooltip.overflow, row.phase).toBe(false); expect(row.tooltip.focused, row.phase).toBe(true); expect(row.tooltip.viewport.overflow, row.phase).toBeLessThanOrEqual(1); }
      };
      await protect(baseline, false);
      expect(baseline.value.entry).toMatchObject({ model: SOL, modelProvider: "openai", reasoningEffort: scenario.raw, serviceTier: "fast", revision: 4, pending: false, pendingFields: [], providerModels: { openai: SOL } });
      if (scenario.consumer === "goal") expect(baseline.runtime.value).toMatchObject({ goals: { "ux-0": FIXTURE_GOAL } });
      if (scenario.surface === "expanded") {
        await main.getByRole("button", { name: "附加文件", exact: true }).click(); await page.getByRole("button", { name: "展开编辑", exact: true }).click();
        scope = page.locator(".session-mode .session-composer-sheet.is-full"); await expect(scope).toHaveCount(1); await expect(scope).toBeVisible();
        await expect.poll(() => scope.locator(EDITOR).first().evaluate((node) => node instanceof HTMLTextAreaElement ? node.value : node.textContent)).toBe(draft);
        activeHandles = await captureSurface(scope); capturedHandles.push(activeHandles);
      }
      const target = scenario.consumer === "model" ? scope.locator(".session-native-model-trigger")
        : scenario.consumer === "attachments" ? scope.getByRole("button", { name: "附加文件", exact: true })
        : scenario.consumer === "access" ? scope.getByRole("button", { name: "执行权限：请求批准", exact: true })
        : scope.locator('.session-thread-goal[data-goal-thread="ux-0"]').getByRole("button", { name: "编辑目标", exact: true });
      await expect(target).toHaveCount(1); await expect(target).toBeVisible(); await expect(target).toBeEnabled();
      targetHandle = await target.elementHandle(); if (!targetHandle) throw Error("Original actual consumer Button missing");
      await scope.locator(EDITOR).first().click(); await expect(scope.locator(EDITOR).first()).toBeFocused();
      probe = await observeLeave(target);
      const initial = await record("closed-before"); await protect(initial, scenario.surface === "expanded");
      if (!initial.tooltip) throw Error("Initial target snapshot missing");
      const rawButton = { uid: initial.tooltip.trigger.uid, rawAria: initial.tooltip.trigger.rawAria, labelledby: initial.tooltip.trigger.labelledby,
        title: initial.tooltip.trigger.title, text: initial.tooltip.trigger.text };
      if (!rawButton.rawAria) throw Error("Closed consumer must retain its original explicit raw Button name");
      await expect(target).toHaveAccessibleName(rawButton.rawAria);
      const assertButton = async (value: HintSnapshot) => {
        expect({ uid: value.trigger.uid, rawAria: value.trigger.rawAria, labelledby: value.trigger.labelledby, title: value.trigger.title, text: value.trigger.text }).toEqual(rawButton);
        if (!targetHandle) throw Error("Original target handle missing");
        expect(await target.evaluate((node, held) => node === held && held.isConnected, targetHandle)).toBe(true);
        expect(value.trigger.disabled).toBe(false); expect(value.trigger.physical).toBe(true);
      };
      const positive = async (name: string) => {
        if (!probe) throw Error("Leave observer missing");
        await expect.poll(async () => (await readLeave(probe!)).model.visibleLabels, { timeout: 5000, intervals: [25, 50, 100] }).toEqual([scenario.purpose]);
        await probe.evaluate((value) => value.capture());
        const snapshot = await readLeave(probe); positiveHint(snapshot, scenario.purpose); await assertButton(snapshot);
        const row = await record(name, snapshot); await protect(row, scenario.surface === "expanded"); return snapshot;
      };
      const exitOnce = async (cycle: "mouse" | "keyboard", start: HintSnapshot) => {
        if (!probe) throw Error("Leave observer missing");
        positiveHint(start, scenario.purpose); const point = gapPoint(start);
        const before = await readLeave(probe, point);
        expect(before.point).toMatchObject({ insideTrigger: false, insideTooltip: false });
        const beforeEvents = before.events.length, oldActive = before.active?.uid;
        expect(before.trigger.hovered, cycle + " actual initial hover").toBe(true);
        expect(before.trigger.focused, cycle + " initial focus").toBe(cycle === "keyboard");
        await page.mouse.move(point.x, point.y, { steps: 1 });
        await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
        const next = await readLeave(probe, point), row = await record(cycle + "-next-frame", next); await protect(row, scenario.surface === "expanded");
        await assertButton(next); expect(next.trigger.focused).toBe(cycle === "keyboard"); expect(next.active?.uid).toBe(oldActive);
        targetChecks.push(...closedChecks(row.phase, next));
        // Intentionally stationary: no parking move, click, blur or key input.
        await page.waitForTimeout(360);
        const retained = await readLeave(probe, point), later = await record(cycle + "-stationary-after350", retained); await protect(later, scenario.surface === "expanded");
        expect(retained.now - next.now).toBeGreaterThan(350); await assertButton(retained);
        expect(retained.trigger.focused).toBe(cycle === "keyboard"); expect(retained.active?.uid).toBe(oldActive);
        const delivered = retained.events.slice(beforeEvents), moves = delivered.filter((event) => event.type === "pointermove");
        expect(moves).toHaveLength(1); expect(moves[0]).toMatchObject({ trusted: true, pointerType: "mouse", insideTrigger: false, insideTooltip: false });
        expect(Math.abs((moves[0]?.x ?? Infinity) - point.x)).toBeLessThanOrEqual(1); expect(Math.abs((moves[0]?.y ?? Infinity) - point.y)).toBeLessThanOrEqual(1);
        expect(delivered.filter((event) => event.type === "pointerleave" && event.isTrigger)).toHaveLength(1);
        expect(delivered.some((event) => event.type === "pointerout" && event.insideTrigger && event.trusted)).toBe(true);
        expect(delivered.filter((event) => ["focusin", "focusout", "blur", "keydown", "pointerdown", "click", "submit"].includes(event.type))).toEqual([]);
        expect(delivered.every((event) => event.trusted)).toBe(true);
        targetChecks.push(...closedChecks(later.phase, retained)); trajectories.push({ cycle, point, before, next, retained, delivered }); await shot(cycle + "-stationary");
      };
      await hoverActual(page, target); const mousePositive = await positive("mouse-positive"); await exitOnce("mouse", mousePositive);
      // Reset only after both stationary observations have been saved. Actual
      // editor click supplies a new input, never a rescue of a failed focus.
      await scope.locator(EDITOR).first().click(); await expect(scope.locator(EDITOR).first()).toBeFocused();
      const id = mousePositive.model.id; if (!id) throw Error("Initial target ID missing");
      await page.locator('[role="tooltip"][id=' + JSON.stringify(id) + ']').waitFor({ state: "detached" });
      await keyboardTo(page, target, "real keyboard -> same consumer", tabs); const keyboardPositive = await positive("keyboard-positive");
      expect(keyboardPositive.trigger.focusVisible).toBe(true); await hoverActual(page, target);
      const keyboardHover = await readLeave(probe); positiveHint(keyboardHover, scenario.purpose); await exitOnce("keyboard", keyboardHover);
      // Public action regressions only: no row/permission/goal mutation.
      await target.click();
      if (scenario.consumer === "model") {
        const menu = page.locator(".session-native-model-menu").filter({ visible: true }); await expect(menu).toHaveCount(1); await settle(page);
        const opened = await record("model-menu-open"); await protect(opened, scenario.surface === "expanded");
        targetChecks.push(...closedChecks(opened.phase, await readLeave(probe)));
        await page.keyboard.press("Escape"); await menu.waitFor({ state: "detached" });
      } else if (scenario.consumer === "attachments") {
        const menu = page.locator(".session-composer-menu").filter({ visible: true }); await expect(menu).toHaveCount(1); await settle(page);
        const opened = await record("attachment-menu-open"); await protect(opened, false); targetChecks.push(...closedChecks(opened.phase, await readLeave(probe)));
        await page.keyboard.press("Escape"); await menu.waitFor({ state: "detached" });
      } else if (scenario.consumer === "access") {
        const menu = page.locator(".session-native-permission-menu").filter({ visible: true }); await expect(menu).toHaveCount(1); await settle(page);
        const opened = await record("permission-menu-open"); await protect(opened, false); targetChecks.push(...closedChecks(opened.phase, await readLeave(probe)));
        await page.keyboard.press("Escape"); await menu.waitFor({ state: "detached" });
      } else {
        const dialog = page.getByRole("dialog", { name: "编辑目标", exact: true }); await expect(dialog).toBeVisible();
        await expect(dialog.getByRole("textbox", { name: "目标", exact: true })).toHaveValue(FIXTURE_GOAL.objective);
        const opened = await record("goal-editor-open-readonly"); await protect(opened, false); targetChecks.push(...closedChecks(opened.phase, await readLeave(probe)));
        await dialog.getByRole("button", { name: "取消", exact: true }).click(); await dialog.waitFor({ state: "detached" });
      }
      await scope.locator(EDITOR).first().click(); await expect(scope.locator(EDITOR).first()).toBeFocused();
      await keyboardTo(page, target, "popup release -> fresh real focus", tabs); const restored = await positive("fresh-hint-after-readonly-action"); await assertButton(restored);
      await expect(target).toHaveAccessibleName(rawButton.rawAria);
      const finalScope = await record("final-active-scope"); await protect(finalScope, scenario.surface === "expanded");
      if (!probe) throw Error("Own leave observer missing at cleanup boundary"); finalProbe = await readLeave(probe);
      expect(finalProbe.events.every((event) => event.trusted)).toBe(true); expect(finalProbe.overflow).toBe(false);
      expect(trajectories).toHaveLength(2); expect(targetChecks).toHaveLength(20);
      probeCleanup = await probe.evaluate((value) => value.dispose()); await probe.dispose(); probe = null;
      expect(probeCleanup).toMatchObject({ disposed: true, subscribed: false, retainedNodes: false, overflow: false });
      if (scenario.surface === "expanded") {
        await page.getByRole("button", { name: "返回并保留草稿", exact: true }).click(); await scope.waitFor({ state: "detached" });
        if (!mainHandles) throw Error("Original main identities missing"); scope = main; activeHandles = mainHandles;
        await expect(main.locator(EDITOR).first()).toBeFocused(); await settle(page);
      }
      const final = await record("final-main"); await protect(final, false); await shot("final-main");
      if (!inputObserver) throw Error("Input observer missing"); const input = await inputObserver.evaluate((value) => value.read());
      expect(input.overflow).toBe(false); expect(input.events.filter((event) => event.type === "submit")).toEqual([]);
      expect(input.events.filter((event) => event.type === "click" || event.type === "keydown").every((event) => event.trusted)).toBe(true);
      expect(input.events.filter((event) => event.type === "click" && (event.role === "menuitemradio" || /停止生成|发送消息|加入队列|引导当前任务|完全访问权限|清除目标|恢复目标|暂停目标|保存/.test(String(event.label ?? ""))))).toEqual([]);
      expect(directory).toHaveLength(4); hardControlsCompleted = true;
    } catch (error) { failure = String(error); throw error; }
    finally {
      if (reader && protection && defaults && runtime && activeHandles && !page.isClosed()) { try { await record("finally"); } catch (error) { cleanupErrors.push(String(error)); } }
      if (probe) { try { finalProbe = await readLeave(probe); probeCleanup = await probe.evaluate((value) => value.dispose()); await probe.dispose();
        const receipt = probeCleanup as { disposed: boolean; subscribed: boolean; retainedNodes: boolean; overflow: boolean };
        if (!receipt.disposed || receipt.subscribed || receipt.retainedNodes || receipt.overflow) cleanupErrors.push("Own leave observer incomplete dispose");
      } catch (error) { cleanupErrors.push(String(error)); } }
      if (inputObserver) { try { const value = await inputObserver.evaluate((probe) => probe.read()); inputEvents = value;
        if (value.overflow || value.events.some((event) => event.type === "submit" || ((event.type === "click" || event.type === "keydown") && !event.trusted))) cleanupErrors.push("Late untrusted/submit/overflow input");
        await inputObserver.evaluate((probe) => probe.dispose()); await inputObserver.dispose();
      } catch (error) { cleanupErrors.push(String(error)); } }
      if (defaults) { try { const value = await defaults.evaluate((probe) => probe.read()); defaultReceipt = value;
        if (value.overflow || value.events.length || !value.sameEnabled || value.mode !== scenario.mode || !isDeepStrictEqual(value.enabled, ["low", "medium", "high", "xhigh", "ultra", "persistent"])) cleanupErrors.push("Late Default/publication protection failed");
        defaultCleanup = await defaults.evaluate((probe) => probe.dispose()); await defaults.dispose();
        if (!(defaultCleanup as { disposed: boolean }).disposed || (defaultCleanup as { subscribed: boolean }).subscribed) cleanupErrors.push("Default subscription retained");
      } catch (error) { cleanupErrors.push(String(error)); } }
      if (runtime) { try { runtimeCleanup = await runtime.evaluate((probe) => probe.dispose()); await runtime.dispose();
        if (!(runtimeCleanup as { disposed: boolean }).disposed || (runtimeCleanup as { retained: boolean }).retained) cleanupErrors.push("Runtime reader retained");
      } catch (error) { cleanupErrors.push(String(error)); } }
      if (protection) { try { await protection.evaluate((probe) => probe.dispose()); await protection.dispose(); } catch (error) { cleanupErrors.push(String(error)); } }
      if (reader) { try { await reader.dispose(); } catch (error) { cleanupErrors.push(String(error)); } }
      if (targetHandle) { try { await targetHandle.dispose(); } catch (error) { cleanupErrors.push(String(error)); } }
      for (const handles of capturedHandles) for (const handle of Object.values(handles)) { try { await handle.dispose(); } catch (error) { cleanupErrors.push(String(error)); } }
      capturedHandles.length = 0; mainHandles = null; activeHandles = null;
      try { sourceAfter = hashInputs(); if (!isDeepStrictEqual(sourceAfter, sourceBefore)) cleanupErrors.push("E11 source inputs changed"); } catch (error) { cleanupErrors.push(String(error)); }
      if (stream) { try { const closed = await stream.close(); streamCleanup = closed;
        if (!closed.closed || closed.listening || !closed.addressCleared || closed.activeResponses || closed.activeSockets || closed.serverErrorCount || closed.requestOverflow || closed.errors.length
          || closed.acceptedRequests !== 1 || closed.responseFinishCount !== 1 || closed.responseCloseCount !== 1 || closed.ownerEofCount !== 1
          || closed.connections.length !== 1 || closed.connections.some((connection) => connection.closedAtMs === null || connection.finishedAtMs === null || connection.ownerEndedAtMs === null || connection.writeErrors !== 0))
          cleanupErrors.push("Owned SSE accepted/owner-ended/finish/close/EOF incomplete");
      } catch (error) { cleanupErrors.push(String(error)); } }
      try { await page.close(); } catch (error) { cleanupErrors.push(String(error)); }
      const assertionErrors = info.errors.map((error) => error.message ?? String(error.value ?? "Unknown test error"));
      if (!failure && assertionErrors.length) failure = assertionErrors[0];
      const cleanupOnlyFailure = cleanupErrors.length > 0 && !failure;
      if (cleanupOnlyFailure) failure = "Cleanup failure: " + cleanupErrors.join("; ");
      if (!failure && hardControlsCompleted && targetChecks.some((check) => !check.pass)) failure = "Late ordinary leave Content/ARIA target mismatch after hard guards and cleanup";
      const path = info.outputPath("composer-tooltip-leave.json");
      writeFileSync(path, JSON.stringify({ caseId: scenario.id, scenario, phase, failure, assertionErrors, hardControlsCompleted,
        states, targetChecks, trajectories, tabs, finalProbe, probeCleanup, inputEvents, defaultReceipt, defaultCleanup, runtimeCleanup,
        counts, directory, api, writes, external, errors, consoleErrors, unexpectedConsoleErrors: origin ? unexpectedConsoleErrors(consoleErrors, origin) : consoleErrors,
        screenshots, cleanupErrors, streamCleanup, sourceBefore, sourceAfter,
        boundary: "Fourteen designed owned cases: model/Default main/fullSheet at1440/390 plus attachments/Access/Goal ordinary main hints atbothwidths. Each has a positive mouse and genuinely keyboard-focused hint, one actual gap leave followed by stationary next-frame and350ms observations; there is no hidden-result wait, double parking, fake event/style/focus, native timer-wallclock or physical-device claim. Target identity is the original native description ID; all raw/global/neighbour/opacity/animation/hit data remain. Goal is local edit/cancel only and no per-action native caller equivalence is claimed. Final complete raw/runtime/DOM protections are final-main; finally adds a diagnostic record, late input/Default/source hard checks and disposal/SSE accepted+owner-ended+finish+close+EOF guards. Content-owned resource release follows actual Content removal, not all mounted-controller listeners/timers zero, GC, native GUI or longRSS proof. All20 target comparisons occur after hard business/ref/FI/cache/draft/NoIO/trust/source and owned cleanup." }, null, 2) + "\n");
      await info.attach("composer-tooltip-leave", { path, contentType: "application/json" });
      if (cleanupOnlyFailure) throw Error("Owned cleanup failed: " + cleanupErrors.join("; "));
    }
    expect(hardControlsCompleted).toBe(true); expect(cleanupErrors).toEqual([]); expect(sourceAfter).toEqual(sourceBefore);
    expect(counts).toEqual([1, 1, 1, 1]); expect(directory).toHaveLength(4); expect(writes).toEqual([]); expect(external).toEqual([]); expect(errors).toEqual([]);
    expect(unexpectedConsoleErrors(consoleErrors, origin)).toEqual([]); expect(targetChecks).toHaveLength(20);
    expect(defaultCleanup).toMatchObject({ disposed: true, subscribed: false, eventCount: 0, overflow: false });
    for (const check of targetChecks) { expect.soft(check.actual, check.phase + ": " + check.target).toEqual(check.expected); expect.soft(check.pass, check.phase + ": " + check.target).toBe(true); }
  });
});

