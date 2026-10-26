import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { isDeepStrictEqual } from "node:util";
import { expect, test, type Locator, type Page } from "@playwright/test";
import type { Model } from "../../apps/web/src/session-mode/bindings/v2";
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
const scenarios = [
  { id: "known-model-1440-main", width: 1440, expanded: false, mode: "model", raw: "medium", purpose: "选择强度" },
  { id: "known-model-1440-expanded", width: 1440, expanded: true, mode: "model", raw: "medium", purpose: "选择强度" },
] as const;
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
  "tests/e2e/session-model-pointer-reachability.spec.mts",
  "tests/e2e/session-model-nonmodal-pointer.spec.mts",
  "apps/web/src/session-mode/components/codex/composer/NativeModelSelector.nonmodal.native.test.tsx",
  "apps/web/src/session-mode/components/layout/SessionTopNavigation.tsx",
  "node_modules/.pnpm/@radix-ui+react-dropdown-menu@2.1.16_@types+react-dom@19.2.3_@types+react@19.2.14__@typ_73af8346b6b2e99f5d79f55f5dac0b34/node_modules/@radix-ui/react-dropdown-menu/dist/index.mjs",
  "node_modules/.pnpm/@radix-ui+react-menu@2.1.16_@types+react-dom@19.2.3_@types+react@19.2.14__@types+react@_73ff7391b7be14d4dbff03af4dbac090/node_modules/@radix-ui/react-menu/dist/index.mjs",
  "node_modules/.pnpm/@radix-ui+react-dismissable-layer@1.1.11_@types+react-dom@19.2.3_@types+react@19.2.14___3d3960154a4c07d09bb90cb341135fc5/node_modules/@radix-ui/react-dismissable-layer/dist/index.mjs",
  "node_modules/.pnpm/@radix-ui+react-focus-scope@1.1.7_@types+react-dom@19.2.3_@types+react@19.2.14__@types+_f62f3af4ca2ba305a7aecf04c8534604/node_modules/@radix-ui/react-focus-scope/dist/index.mjs",
  "node_modules/.pnpm/aria-hidden@1.2.6/node_modules/aria-hidden/dist/es2015/index.js",
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


function unexpectedConsoleErrors(records: ReadonlyArray<{ text: string; url: string }>, origin: string) {
  return records.filter((entry) => !(entry.url === new URL("/@vite/client", origin).href && entry.text.startsWith("[vite] failed to connect to websocket.\n")));
}
async function keyboardTo(page: Page, target: Locator, phase: string, receipts: Array<{ phase: string; tabs: number }>) {
  let tabs = 0;
  while (!(await target.evaluate((node) => node === document.activeElement)) && tabs < 64) { await page.keyboard.press("Tab"); tabs++; }
  expect(tabs, phase).toBeGreaterThan(0); expect(tabs, phase).toBeLessThanOrEqual(64);
  expect(await target.evaluate((node) => node === document.activeElement && node.matches(":focus-visible")), phase).toBe(true); receipts.push({ phase, tabs });
}

/** Passive capture only. No DOM/style/focus/store/handler mutation. */
async function createReachabilityObserver(surface: SurfaceHandles) {
  return surface.trigger.evaluateHandle((node, captured) => {
    if (!(node instanceof HTMLButtonElement) || !(captured.editor instanceof HTMLElement)
      || !(captured.scope instanceof HTMLElement) || !(captured.sessionRoot instanceof HTMLElement)) throw Error("Actual captured main nodes required");
    const actualBackground = node.closest(".session-mode")?.querySelector<HTMLElement>(".session-top-nav");
    if (!actualBackground) throw Error("Actual workbench background navigation missing");
    let owned: { trigger: HTMLButtonElement; editor: HTMLElement; scope: HTMLElement; root: HTMLElement; background: HTMLElement; doc: Document; menu: HTMLElement | null } | null = {
      trigger: node, editor: captured.editor, scope: captured.scope, root: captured.sessionRoot, background: actualBackground, doc: node.ownerDocument, menu: null };
    const ids = new WeakMap<Element, number>(); let serial = 0, overflow = false, reads = 0, attempt: "A" | "B" | null = null;
    const faults: string[] = [];
    const current = () => { if (!owned) throw Error("Reachability observer disposed"); return owned; };
    const uid = (element: Element | null) => {
      if (!element) return null; let value = ids.get(element);
      if (!value) { if (++serial > 2048) { overflow = true; throw Error("Reachability identity budget exceeded"); } value = serial; ids.set(element, value); }
      return value;
    };
    const rect = (element: Element) => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, top: r.top, left: r.left,
      right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
    const describe = (element: Element | null) => element ? { uid: uid(element), tag: element.tagName, id: element.id || null,
      role: element.getAttribute("role"), aria: element.getAttribute("aria-label"), classes: element.getAttribute("class"), connected: element.isConnected } : null;
    const ancestry = (element: Element) => {
      const rows: Array<{ uid: number | null; tag: string; id: string | null; pointerEvents: string; display: string; visibility: string;
        opacity: string; opacityNumber: number; hidden: boolean; inert: boolean; ariaHidden: string | null; isBody: boolean; isDocumentElement: boolean }> = [];
      const doc = current().doc;
      for (let parent: Element | null = element; parent; parent = parent.parentElement) {
        if (rows.length >= 96) { overflow = true; throw Error("Reachability ancestry budget exceeded96"); }
        const css = getComputedStyle(parent), opacity = Number.parseFloat(css.opacity);
        if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) throw Error("Unknown actual opacity " + css.opacity);
        rows.push({ uid: uid(parent), tag: parent.tagName, id: parent.id || null, pointerEvents: css.pointerEvents,
          display: css.display, visibility: css.visibility, opacity: css.opacity, opacityNumber: opacity,
          hidden: parent.hasAttribute("hidden"), inert: parent.hasAttribute("inert"), ariaHidden: parent.getAttribute("aria-hidden"),
          isBody: parent === doc.body, isDocumentElement: parent === doc.documentElement });
      }
      const endedAtDocumentElement = rows[rows.length - 1]?.isDocumentElement === true;
      if (element.isConnected && !endedAtDocumentElement) throw Error("Connected node ancestry did not reach actual documentElement");
      return { rows, depth: rows.length, limit: 96, reachedBody: rows.some((row) => row.isBody), endedAtDocumentElement };
    };
    const measure = (element: Element | null) => {
      if (!element) return null;
      if (!element.isConnected) return { ...describe(element), rect: rect(element), physical: false, state: element.getAttribute("data-state"),
        pointerEvents: null, ariaHiddenAncestors: [], ancestry: null, animations: [] };
      const box = rect(element), chain = ancestry(element), css = getComputedStyle(element);
      const physical = element.isConnected && box.width > 0 && box.height > 0 && element.getClientRects().length > 0
        && chain.rows.every((row) => !row.hidden && !row.inert && row.display !== "none"
          && row.visibility !== "hidden" && row.visibility !== "collapse" && row.opacityNumber > 0);
      const animations = element.getAnimations({ subtree: false });
      if (animations.length > 16) {
        overflow = true;
        throw Error("Own animation budget exceeded16: " + JSON.stringify({ node: describe(element), count: animations.length,
          transitionProperty: css.transitionProperty, transitionDuration: css.transitionDuration, animationName: css.animationName }));
      }
      return { ...describe(element), rect: box, physical, state: element.getAttribute("data-state"), pointerEvents: css.pointerEvents,
        ariaHiddenAncestors: chain.rows.filter((row) => row.ariaHidden === "true").map((row) => ({ uid: row.uid, tag: row.tag, id: row.id })),
        ancestry: chain, ownAnimationCount: animations.length, ownAnimationLimit: 16,
        animations: animations.map((animation) => ({ kind: animation.constructor.name,
          property: animation instanceof CSSTransition ? animation.transitionProperty : null,
          name: animation instanceof CSSAnimation ? animation.animationName : null,
          targetSameElement: animation.effect instanceof KeyframeEffect && animation.effect.target === element,
          playState: animation.playState, pending: animation.pending,
          currentTime: typeof animation.currentTime === "number" ? animation.currentTime : null })) };
    };
    const menuOpen = () => { const own = current(); return Boolean(own.menu?.isConnected && own.menu.dataset.state === "open"
      && own.trigger.getAttribute("aria-expanded") === "true"); };
    const capture = (point: { x: number; y: number } | null, collectControls: boolean) => {
      const own = current(), doc = own.doc;
      const all = collectControls ? [...doc.querySelectorAll<HTMLElement>('button,a[href],input,textarea,select,[role="button"],[role^="menuitem"],[contenteditable="true"]')] : [];
      if (all.length > 512) { overflow = true; throw Error("Interactive candidate budget exceeded512"); }
      const controls: Array<{ element: HTMLElement; value: NonNullable<ReturnType<typeof measure>> }> = [];
      for (const element of all) {
        const value = measure(element); if (!value) throw Error("Actual control measurement missing");
        if (value.physical) controls.push({ element, value });
      }
      if (controls.length > 256) { overflow = true; throw Error("Visible interactive budget exceeded256"); }
      const hit = point ? doc.elementFromPoint(point.x, point.y) : null;
      return { now: performance.now(), attempt, documentFocused: doc.hasFocus(), active: describe(doc.activeElement), menuOpen: menuOpen(),
        bodyInlinePointerEvents: doc.body.style.pointerEvents, body: measure(doc.body), documentElement: measure(doc.documentElement),
        trigger: measure(own.trigger), editor: measure(own.editor), scope: measure(own.scope), sessionRoot: measure(own.root), menu: measure(own.menu),
        background: measure(own.background), outerDialog: own.scope.matches(".session-composer-sheet.is-full") ? measure(own.scope) : null,
        identity: { triggerConnected: own.trigger.isConnected, editorConnected: own.editor.isConnected, scopeConnected: own.scope.isConnected, rootConnected: own.root.isConnected,
          triggerScope: own.trigger.closest(".session-codex-composer, .session-composer-sheet.is-full") === own.scope,
          editorScope: own.editor.closest(".session-codex-composer, .session-composer-sheet.is-full") === own.scope,
          root: own.scope.closest(".session-mode") === own.root, owner: own.scope.dataset.draftOwner ?? null,
          sameDocument: own.editor.ownerDocument === doc && own.scope.ownerDocument === doc && own.root.ownerDocument === doc,
          menuInRootOrDetached: own.menu === null || !own.menu.isConnected || own.root.contains(own.menu) },
        point: point ? { ...point, hit: describe(hit), inTrigger: Boolean(hit && own.trigger.contains(hit)), inEditor: Boolean(hit && own.editor.contains(hit)),
          inMenu: Boolean(hit && own.menu?.contains(hit)) } : null,
        viewport: { width: innerWidth, height: innerHeight, overflow: doc.documentElement.scrollWidth - innerWidth },
        controls: controls.map(({ element, value }) => ({ ...value, isTrigger: element === own.trigger, isEditor: element === own.editor,
          inTrigger: own.trigger.contains(element), inEditor: own.editor.contains(element), inScope: own.scope.contains(element), inMenu: Boolean(own.menu?.contains(element)) })) };
    };
    type PrimitivePath = { kind: string; node: ReturnType<typeof describe> };
    const rows: Array<{ attempt: "A" | "B" | null; type: string; trusted: boolean; now: number; button: number | null; ctrlKey: boolean | null;
      key: string | null; x: number | null; y: number | null; pointerType: string | null; defaultPreventedAtCapture: boolean;
      target: ReturnType<typeof describe>; related: ReturnType<typeof describe>; active: ReturnType<typeof describe>; openBeforeDispatch: boolean;
      inTrigger: boolean; inEditor: boolean; inMenu: boolean; composedPath: PrimitivePath[]; downFrame: ReturnType<typeof capture> | null }> = [];
    const types = ["keydown", "keyup", "focusin", "focusout", "blur", "pointerover", "pointerout", "pointerleave", "pointermove", "pointerdown", "pointerup", "click", "submit"];
    const listener = (event: Event) => {
      if (!owned) return;
      try {
        if (rows.length >= 1024) { overflow = true; return; }
        const own = current(), target = event.target instanceof Element ? event.target : null;
        const related = event instanceof FocusEvent || event instanceof MouseEvent ? event.relatedTarget : null;
        const path = event.composedPath(); if (path.length > 96) { overflow = true; throw Error("Composed path budget exceeded96"); }
        const downPoint = event instanceof MouseEvent ? { x: event.clientX, y: event.clientY } : null;
        rows.push({ attempt, type: event.type, trusted: event.isTrusted, now: performance.now(), button: event instanceof MouseEvent ? event.button : null,
          ctrlKey: event instanceof MouseEvent ? event.ctrlKey : null, key: event instanceof KeyboardEvent ? event.key : null,
          x: downPoint?.x ?? null, y: downPoint?.y ?? null, pointerType: event instanceof PointerEvent ? event.pointerType : null,
          defaultPreventedAtCapture: event.defaultPrevented, target: describe(target), related: describe(related instanceof Element ? related : null),
          active: describe(own.doc.activeElement), openBeforeDispatch: menuOpen(), inTrigger: Boolean(target && own.trigger.contains(target)),
          inEditor: Boolean(target && own.editor.contains(target)), inMenu: Boolean(target && own.menu?.contains(target)),
          composedPath: path.map((entry) => ({ kind: entry instanceof Element ? "element" : entry === own.doc ? "document" : entry === own.doc.defaultView ? "window" : "other", node: describe(entry instanceof Element ? entry : null) })),
          // Synchronous document capture precedes DismissableLayer's document handler.
          downFrame: event.type === "pointerdown" ? capture(downPoint, false) : null });
      } catch (error) { if (faults.length < 8) faults.push(String(error)); else overflow = true; }
    };
    types.forEach((type) => current().doc.addEventListener(type, listener, true));
    return {
      arm: (label: "A" | "B", menu: Element) => {
        const own = current(); if (attempt || own.menu) throw Error("Prior attempt still armed");
        if (!(menu instanceof HTMLElement) || !menu.isConnected || !own.root.contains(menu) || !menu.matches(".session-native-model-menu")) throw Error("Actual owned menu required");
        own.menu = menu; attempt = label;
        if (!menuOpen()) throw Error("Arm requires actual still-open captured menu");
        return { eventStart: rows.length, menu: describe(menu), trigger: describe(own.trigger), editor: describe(own.editor), owner: own.scope.dataset.draftOwner ?? null };
      },
      read: (point: { x: number; y: number } | null = null, controls = false) => {
        if (++reads > 64) throw Error("Reachability read budget exceeded64");
        return { snapshot: capture(point, controls), events: rows.map((row) => ({ ...row })), reads, overflow, faults: [...faults] };
      },
      disarm: () => { const own = current(); const receipt = { attempt, menu: describe(own.menu), eventCount: rows.length }; own.menu = null; attempt = null; return receipt; },
      dispose: () => { const own = current(); types.forEach((type) => own.doc.removeEventListener(type, listener, true));
        const receipt = { disposed: true, subscribed: false, retainedNodes: false, eventCount: rows.length, identities: serial, overflow, faults: [...faults] };
        own.menu = null; owned = null; attempt = null; rows.length = 0; faults.length = 0; return receipt; },
    };
  }, surface);
}
type ReachProbe = Awaited<ReturnType<typeof createReachabilityObserver>>;
const readReach = (probe: ReachProbe, point: { x: number; y: number } | null = null, controls = false) => probe.evaluate((value, options) => value.read(options.point, options.controls), { point, controls });
type ReachRead = Awaited<ReturnType<typeof readReach>>;
function choosePoint(value: ReachRead, kind: "A" | "B") {
  const frame = value.snapshot, trigger = frame.trigger, editor = frame.editor, menu = frame.menu;
  if (!trigger || !editor || !menu || !trigger.physical || !editor.physical || !menu.physical || !frame.menuOpen) throw Error("Point requires actual painted owned open nodes");
  const inside = (x: number, y: number, box: { left: number; top: number; right: number; bottom: number }) => x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
  // A genuine modal Sheet already makes its background noninteractive. Keep all
  // raw boxes, but do not treat covered underlay controls as Sheet obstacles.
  const interactive = frame.outerDialog ? frame.controls.filter((item) => item.inScope || item.inMenu) : frame.controls;
  const obstacleSelection = { domain: frame.outerDialog ? "captured-sheet-or-owned-menu" : "all-physical-document-controls",
    controlUIDs: interactive.map((item) => item.uid), retainedRawControlCount: frame.controls.length };
  const blocked = [menu.rect, ...interactive.filter((item) => kind === "A" ? !item.inTrigger : !item.isEditor).map((item) => item.rect)];
  if (kind === "A") {
    const point = { x: trigger.rect.left + trigger.rect.width / 2, y: trigger.rect.top + trigger.rect.height / 2 };
    if (point.x <= 0 || point.y <= 0 || point.x >= frame.viewport.width || point.y >= frame.viewport.height
      || blocked.some((box) => inside(point.x, point.y, box))) throw Error("Actual Trigger center is geometrically covered/outside viewport; driver cannot classify modal reachability");
    return { ...point, kind, sourceRect: trigger.rect, excludedRects: blocked, obstacleSelection, selection: "actual Trigger center" };
  }
  type Box = { left: number; top: number; right: number; bottom: number };
  let pieces: Box[] = [{ left: Math.max(2, editor.rect.left + 2), top: Math.max(2, editor.rect.top + 2),
    right: Math.min(frame.viewport.width - 2, editor.rect.right - 2), bottom: Math.min(frame.viewport.height - 2, editor.rect.bottom - 2) }];
  for (const cut of blocked) {
    const next: Box[] = [];
    for (const box of pieces) {
      const left = Math.max(box.left, cut.left), right = Math.min(box.right, cut.right), top = Math.max(box.top, cut.top), bottom = Math.min(box.bottom, cut.bottom);
      if (left >= right || top >= bottom) { next.push(box); continue; }
      next.push({ ...box, bottom: top }, { ...box, top: bottom }, { left: box.left, right: left, top, bottom }, { left: right, right: box.right, top, bottom });
    }
    pieces = next.filter((box) => box.right - box.left > 2 && box.bottom - box.top > 2);
    if (pieces.length > 128) throw Error("Editor free-rectangle budget exceeded128");
  }
  pieces.sort((a, b) => (b.right - b.left) * (b.bottom - b.top) - (a.right - a.left) * (a.bottom - a.top) || a.top - b.top || a.left - b.left);
  const selected = pieces[0]; if (!selected) throw Error("No actual visible editor interior outside menu/interactive controls; driver failure");
  const point = { x: (selected.left + selected.right) / 2, y: (selected.top + selected.bottom) / 2 };
  if (!inside(point.x, point.y, editor.rect) || blocked.some((box) => inside(point.x, point.y, box))) throw Error("Editor point failed geometric exclusion proof");
  return { ...point, kind, sourceRect: editor.rect, selectedRect: selected, excludedRects: blocked, obstacleSelection,
    selection: "center of largest actual visible editor free rectangle; no hit-based fallback search" };
}

test.use({ viewport: { width: 1440, height: 900 }, hasTouch: false, isMobile: false });
for (const scenario of scenarios) {
test(`${scenario.id}: first open pointerdown reaches original Trigger/editor without changing outer scope`, async ({ page }, info) => {
  const theme = "dark", draft = "E12 retained nonmodal pointer draft";
  const catalog = [model(TERRA, TL, ["low"], "low", true), model(SOL, "S", ["low", "medium", "high"], "medium", false)];
  const counts = [0, 0, 0, 0], directory: unknown[] = [], writes: unknown[] = [], api: unknown[] = [], external: unknown[] = [];
  const errors: string[] = [], consoleErrors: Array<{ text: string; url: string }> = [], cleanupErrors: string[] = [], screenshots: string[] = [];
  const tabs: Array<{ phase: string; tabs: number }> = [];
  let phase = "setup", origin = "", failure: string | null = null, hardControlsCompleted = false, pointerDown = false;
  let reader: Awaited<ReturnType<typeof createReader>> | null = null, protection: Awaited<ReturnType<typeof createProtectionReader>> | null = null;
  let defaults: Awaited<ReturnType<typeof createDefaultObserver>> | null = null, runtime: Awaited<ReturnType<typeof createRuntimeReader>> | null = null;
  let inputObserver: Awaited<ReturnType<typeof observe>> | null = null, probe: ReachProbe | null = null;
  let stream: Awaited<ReturnType<typeof createFeedbackEventStream>> | null = null;
  let streamCleanup: Awaited<ReturnType<Awaited<ReturnType<typeof createFeedbackEventStream>>["close"]>> | null = null;
  let probeCleanup: unknown = null, finalProbe: ReachRead | null = null, inputEvents: unknown = null, defaultReceipt: unknown = null;
  let defaultCleanup: unknown = null, runtimeCleanup: unknown = null;
  let sourceBefore: ReturnType<typeof hashInputs> | null = null, sourceAfter: ReturnType<typeof hashInputs> | null = null;
  let mainHandles: SurfaceHandles | null = null, activeHandles: SurfaceHandles | null = null;
  const capturedHandles: SurfaceHandles[] = [], menuHandles: NonNullable<Awaited<ReturnType<Locator["elementHandle"]>>>[] = [];
  const main = page.locator(MAIN); let scope = main;
  type State = {
    phase: string; value: Awaited<ReturnType<typeof read>>; identity: Awaited<ReturnType<typeof read>>;
    scope: Awaited<ReturnType<typeof inspectScope>>; dom: Awaited<ReturnType<typeof surfaceIdentity>>;
    publication: { reads: number; overflow: boolean; initialMode: unknown; mode: unknown; sameEnabled: boolean; enabled: unknown[]; moduleURLs: string[]; events: Record<string, unknown>[] };
    runtime: { reads: number; urls: string[]; value: unknown; same: { turns: boolean; status: boolean; timing: boolean; followup: boolean; goals: boolean } };
    reachability: ReachRead | null;
  };
  const states: State[] = [];
  type Attempt = {
    label: "A" | "B"; point: ReturnType<typeof choosePoint>; opened: ReachRead; beforeDown: ReachRead;
    afterDown: ReachRead; afterUp: ReachRead; firstDown: ReachRead["events"][number];
    eventSegment: ReachRead["events"]; disarm: unknown;
  };
  const attempts: Attempt[] = [];
  const behaviorChecks: Array<{ phase: string; name: string; passed: boolean; actual: unknown; expected: unknown }> = [];
  let diagnosticGuardsQualified = false;
  const behavior = (phase: string, name: string, actual: unknown, expected: unknown) => {
    behaviorChecks.push({ phase, name, passed: isDeepStrictEqual(actual, expected), actual: structuredClone(actual), expected: structuredClone(expected) });
  };
  const record = async (name: string, captured?: ReachRead) => {
    if (!reader || !protection || !defaults || !runtime || !activeHandles || states.length >= 32) throw Error("Readonly protection missing or32-state budget exceeded");
    phase = name;
    const row: State = { phase: name, reachability: captured ?? (probe ? await readReach(probe) : null),
      value: await read(page, reader), identity: await protection.evaluate((value) => value.read()),
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
          if (!valid) { writes.push(entry); await route.fulfill({ status: 409, json: { error: "E12 catalog read contract mismatch" } }); return; }
          counts[index]++; await route.fulfill({ json: index === 0 ? { data: catalog, nextCursor: null } : [] }); return;
        }
        if (!["GET", "HEAD"].includes(entry.method) && !reads.has(path) && !bookkeeping.has(path)) {
          writes.push(entry); await route.fulfill({ status: 409, json: { error: "E12 forbidden mutation rejected" } }); return;
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
      await settle(page);
      mainHandles = await captureSurface(main); activeHandles = mainHandles; capturedHandles.push(mainHandles);
      protection = await createProtectionReader(page); defaults = await createDefaultObserver(page); runtime = await createRuntimeReader(page);
      if (scenario.expanded) {
        await main.getByRole("button", { name: "附加文件", exact: true }).click();
        const outerMenu = page.locator('.session-composer-menu[data-slot="popover-content"]');
        await expect(outerMenu).toBeVisible();
        await outerMenu.getByRole("button", { name: "展开编辑", exact: true }).click();
        await outerMenu.waitFor({ state: "detached" });
        scope = page.locator('.session-mode .session-composer-sheet.is-full[data-slot="dialog-content"]');
        await expect(scope).toHaveCount(1); await expect(scope).toBeVisible();
        await scope.getByRole("heading", { name: "展开编辑", exact: true }).waitFor(); await settle(page);
        activeHandles = await captureSurface(scope); capturedHandles.push(activeHandles);
      }
      probe = await createReachabilityObserver(activeHandles);
      const baseline = await record(scenario.expanded ? "baseline-expanded" : "baseline-main"), initialRecent = await recent(page);
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
        if (row.reachability) {
          expect(row.reachability.overflow, row.phase).toBe(false); expect(row.reachability.faults, row.phase).toEqual([]);
          const frame = row.reachability.snapshot;
          expect(frame.documentFocused, row.phase).toBe(true); expect(frame.viewport.overflow, row.phase).toBeLessThanOrEqual(1);
          expect(frame.identity, row.phase).toEqual({ triggerConnected: true, editorConnected: true, scopeConnected: true, rootConnected: true,
            triggerScope: true, editorScope: true, root: true, owner: expanded ? null : OWNER_A, sameDocument: true, menuInRootOrDetached: true });
          if (expanded) {
            // Inner picker nonmodality must not unlock/expose the real outer Dialog background.
            expect(frame.bodyInlinePointerEvents, row.phase).toBe("none");
            expect(frame.outerDialog?.connected, row.phase).toBe(true);
            expect(frame.background?.connected, row.phase).toBe(true);
            expect(frame.background?.ariaHiddenAncestors.length, row.phase).toBeGreaterThan(0);
          }
        }
      };
      await protect(baseline, scenario.expanded);
      expect(baseline.value.entry).toMatchObject({ model: SOL, modelProvider: "openai", reasoningEffort: "medium", serviceTier: "fast",
        revision: 4, pending: false, pendingFields: [], providerModels: { openai: SOL } });
      const trigger = scope.locator(".session-native-model-trigger"), editor = scope.locator(EDITOR).first();
      await expect(trigger).toBeEnabled(); await expect(trigger).toHaveAccessibleName("模型：" + SOL + "，medium");
      for (const label of ["A", "B"] as const) {
        if (!probe || !mainHandles) throw Error("Owned passive probe or original identities missing");
        await editor.click(); await expect(editor).toBeFocused();
        const closed = await record(label + "-closed-before"); await protect(closed, scenario.expanded);
        await keyboardTo(page, trigger, label + " actual Tab to original Trigger", tabs);
        await page.keyboard.press("Enter");
        const menu = page.locator(".session-mode .session-native-model-menu").filter({ visible: true });
        await expect(menu).toHaveCount(1); await expect(menu).toBeVisible(); await settle(page);
        await menu.evaluate(async (node) => { await Promise.all(node.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => {}))); });
        expect(await menu.evaluate((node) => node.contains(node.ownerDocument.activeElement))).toBe(true);
        const menuNode = await menu.elementHandle(); if (!menuNode) throw Error("Actual open menu identity missing"); menuHandles.push(menuNode);
        const armed = await probe.evaluate((value, arg) => value.arm(arg.label, arg.menu), { label, menu: menuNode });
        expect(armed.owner).toBe(scenario.expanded ? null : OWNER_A);
        const opened = await readReach(probe, null, true);
        const openRow = await record(label + "-open-settled", opened); await protect(openRow, scenario.expanded);
        // Prove outer Sheet background lock/AX before excluding its underlay boxes.
        const point = choosePoint(opened, label);
        await shot(label + "-open-settled");
        await page.mouse.move(point.x, point.y, { steps: 1 });
        const beforeDown = await readReach(probe, point, true);
        const beforeRow = await record(label + "-before-open-down", beforeDown); await protect(beforeRow, scenario.expanded);
        const currentPoint = choosePoint(beforeDown, label);
        expect(Math.abs(currentPoint.x - point.x)).toBeLessThanOrEqual(1); expect(Math.abs(currentPoint.y - point.y)).toBeLessThanOrEqual(1);
        expect(beforeDown.snapshot.menuOpen).toBe(true);
        // The captured document pointerdown, not later up/click or hit, decides reachability.
        await page.mouse.down({ button: "left" }); pointerDown = true;
        const afterDown = await readReach(probe, point); const downRow = await record(label + "-after-down", afterDown); await protect(downRow, scenario.expanded);
        await page.mouse.up({ button: "left" }); pointerDown = false;
        const afterUp = await readReach(probe, point); const upRow = await record(label + "-after-up", afterUp); await protect(upRow, scenario.expanded);
        const segment = afterUp.events.slice(armed.eventStart), downs = segment.filter((event) => event.type === "pointerdown");
        expect(downs).toHaveLength(1); const firstDown = downs[0];
        if (!firstDown || !firstDown.downFrame) throw Error("Unique first pointerdown capture with synchronous frame required");
        expect(firstDown).toMatchObject({ attempt: label, trusted: true, button: 0, ctrlKey: false, pointerType: "mouse", openBeforeDispatch: true });
        expect(firstDown.downFrame.menuOpen).toBe(true); expect(firstDown.downFrame.identity.owner).toBe(scenario.expanded ? null : OWNER_A);
        expect(firstDown.composedPath.length).toBeGreaterThan(0); expect(firstDown.composedPath.length).toBeLessThanOrEqual(96);
        expect(firstDown.composedPath[0]?.node?.uid).toBe(firstDown.target?.uid);
        expect(segment.every((event) => event.trusted)).toBe(true); expect(segment.filter((event) => event.type === "submit")).toEqual([]);
        // All behavior is sampled before any cleanup input. A later hit/up/focus cannot replace first-down.
        behavior(label, "first actual open-down reaches original requested target", label === "A" ? firstDown.inTrigger : firstDown.inEditor, true);
        behavior(label, "menu closed after down", afterDown.snapshot.menuOpen, false);
        behavior(label, "menu closed after up", afterUp.snapshot.menuOpen, false);
        behavior(label, "own Trigger AX exposed while open", opened.snapshot.trigger?.ariaHiddenAncestors ?? null, []);
        behavior(label, "own editor AX exposed while open", opened.snapshot.editor?.ariaHiddenAncestors ?? null, []);
        if (!scenario.expanded) {
          behavior(label, "main body remains pointer-unlocked", opened.snapshot.bodyInlinePointerEvents === "none", false);
          behavior(label, "main background AX exposed", opened.snapshot.background?.ariaHiddenAncestors ?? null, []);
        }
        if (label === "B") behavior(label, "B focuses original editor without another click", afterUp.snapshot.active?.uid ?? null, afterUp.snapshot.editor?.uid ?? null);
        // Normal Escape is cleanup only if the wrong old layer still remains open.
        if (await menu.isVisible()) await page.keyboard.press("Escape");
        await menu.waitFor({ state: "detached" });
        const disarm = await probe.evaluate((value) => value.disarm());
        attempts.push({ label, point, opened, beforeDown, afterDown, afterUp, firstDown, eventSegment: segment, disarm });
        await settle(page);
        const restored = await record(label + "-post-attempt"); await protect(restored, scenario.expanded);
        await expect(trigger).toHaveAccessibleName("模型：" + SOL + "，medium");
      }
      expect(attempts.map((attempt) => attempt.label)).toEqual(["A", "B"]);
      if (!probe || !inputObserver) throw Error("Final original probe/input observer missing");
      finalProbe = await readReach(probe); expect(finalProbe.overflow).toBe(false); expect(finalProbe.faults).toEqual([]);
      expect(finalProbe.events.every((event) => event.trusted)).toBe(true);
      probeCleanup = await probe.evaluate((value) => value.dispose());
      expect(probeCleanup).toMatchObject({ disposed: true, subscribed: false, retainedNodes: false, overflow: false, faults: [] });
      await probe.dispose(); probe = null;
      if (scenario.expanded) {
        await scope.getByRole("button", { name: "返回并保留草稿", exact: true }).click();
        await scope.waitFor({ state: "detached" }); scope = main; activeHandles = mainHandles;
        await expect(main.locator(EDITOR).first()).toBeFocused(); await settle(page);
      }
      const final = await record("final-main"); await protect(final, false); await shot("final-main");
      const input = await inputObserver.evaluate((value) => value.read()); expect(input.overflow).toBe(false);
      expect(input.events.filter((event) => event.type === "submit")).toEqual([]);
      expect(input.events.filter((event) => event.type === "click" || event.type === "keydown").every((event) => event.trusted)).toBe(true);
      expect(input.events.filter((event) => event.type === "click" && (event.role === "menuitemradio"
        || /停止生成|发送消息|加入队列|引导当前任务|完全访问权限|清除目标|恢复目标|暂停目标|保存/.test(String(event.label ?? ""))))).toEqual([]);
      expect(directory).toHaveLength(4); hardControlsCompleted = true;
  } catch (error) { failure = String(error); throw error; }
  finally {
    if (pointerDown && !page.isClosed()) { try { await page.mouse.up({ button: "left" }); pointerDown = false; } catch (error) { cleanupErrors.push(String(error)); } }
    if (!page.isClosed()) { try { const menu = page.locator(".session-mode .session-native-model-menu").filter({ visible: true });
      if (await menu.count()) { await page.keyboard.press("Escape"); await menu.waitFor({ state: "detached" }); }
    } catch (error) { cleanupErrors.push(String(error)); } }
    if (reader && protection && defaults && runtime && activeHandles && !page.isClosed()) { try { await record("finally"); } catch (error) { cleanupErrors.push(String(error)); } }
    if (probe) {
      try { finalProbe = await readReach(probe); if (finalProbe.overflow || finalProbe.faults.length) cleanupErrors.push("Late observer overflow/fault"); } catch (error) { cleanupErrors.push(String(error)); }
      try { probeCleanup = await probe.evaluate((value) => value.dispose());
        const result = probeCleanup as { disposed: boolean; subscribed: boolean; retainedNodes: boolean; overflow: boolean; faults: string[] };
        if (!result.disposed || result.subscribed || result.retainedNodes || result.overflow || result.faults.length) cleanupErrors.push("Observer incomplete disposal");
      } catch (error) { cleanupErrors.push(String(error)); }
      try { await probe.dispose(); } catch (error) { cleanupErrors.push(String(error)); }
    }
    if (inputObserver) { try { const value = await inputObserver.evaluate((probe) => probe.read()); inputEvents = value;
      if (value.overflow || value.events.some((event) => event.type === "submit" || ((event.type === "click" || event.type === "keydown") && !event.trusted))) cleanupErrors.push("Late untrusted/submit/overflow input");
      await inputObserver.evaluate((probe) => probe.dispose()); await inputObserver.dispose();
    } catch (error) { cleanupErrors.push(String(error)); } }
    if (defaults) { try { const value = await defaults.evaluate((probe) => probe.read()); defaultReceipt = value;
      if (value.overflow || value.events.length || !value.sameEnabled || value.mode !== "model"
        || !isDeepStrictEqual(value.enabled, ["low", "medium", "high", "xhigh", "ultra", "persistent"])) cleanupErrors.push("Late FI/publication protection failed");
      defaultCleanup = await defaults.evaluate((probe) => probe.dispose()); await defaults.dispose();
      if (!(defaultCleanup as { disposed: boolean }).disposed || (defaultCleanup as { subscribed: boolean }).subscribed) cleanupErrors.push("Default subscription retained");
    } catch (error) { cleanupErrors.push(String(error)); } }
    if (runtime) { try { runtimeCleanup = await runtime.evaluate((probe) => probe.dispose()); await runtime.dispose();
      if (!(runtimeCleanup as { disposed: boolean }).disposed || (runtimeCleanup as { retained: boolean }).retained) cleanupErrors.push("Runtime reader retained");
    } catch (error) { cleanupErrors.push(String(error)); } }
    if (protection) { try { await protection.evaluate((probe) => probe.dispose()); await protection.dispose(); } catch (error) { cleanupErrors.push(String(error)); } }
    if (reader) { try { await reader.dispose(); } catch (error) { cleanupErrors.push(String(error)); } }
    for (const handle of menuHandles) { try { await handle.dispose(); } catch (error) { cleanupErrors.push(String(error)); } } menuHandles.length = 0;
    for (const handles of capturedHandles) for (const handle of Object.values(handles)) { try { await handle.dispose(); } catch (error) { cleanupErrors.push(String(error)); } }
    capturedHandles.length = 0; mainHandles = null; activeHandles = null;
    try { sourceAfter = hashInputs(); if (!isDeepStrictEqual(sourceAfter, sourceBefore)) cleanupErrors.push("E12 source inputs changed"); } catch (error) { cleanupErrors.push(String(error)); }
    if (stream) { try { const closed = await stream.close(); streamCleanup = closed;
      if (!closed.closed || closed.listening || !closed.addressCleared || closed.activeResponses || closed.activeSockets || closed.serverErrorCount || closed.requestOverflow || closed.errors.length
        || closed.acceptedRequests !== 1 || closed.responseFinishCount !== 1 || closed.responseCloseCount !== 1 || closed.ownerEofCount !== 1
        || closed.connections.length !== 1 || closed.connections.some((connection) => connection.closedAtMs === null || connection.finishedAtMs === null || connection.ownerEndedAtMs === null || connection.writeErrors !== 0))
        cleanupErrors.push("Owned SSE accepted/owner-ended/finish/close/EOF incomplete");
    } catch (error) { cleanupErrors.push(String(error)); } }
    try { await page.close(); } catch (error) { cleanupErrors.push(String(error)); }
    // Close the diagnostic qualification over every retained final assertion.
    // Read only: late failures must be in cleanupErrors before classification.
    const lateFailures: string[] = [];
    try {
      const defaultCleanupMatches = defaultCleanup !== null && typeof defaultCleanup === "object"
        && "disposed" in defaultCleanup && defaultCleanup.disposed === true
        && "subscribed" in defaultCleanup && defaultCleanup.subscribed === false
        && "eventCount" in defaultCleanup && defaultCleanup.eventCount === 0
        && "overflow" in defaultCleanup && defaultCleanup.overflow === false;
      const lateChecks: Array<[string, boolean]> = [
        ["hardControlsCompleted", hardControlsCompleted === true],
        ["cleanupErrors", cleanupErrors.length === 0],
        ["source equality", isDeepStrictEqual(sourceAfter, sourceBefore)],
        ["four catalog counts", isDeepStrictEqual(counts, [1, 1, 1, 1])],
        ["directory records", directory.length === 4],
        ["writes", writes.length === 0],
        ["external requests", external.length === 0],
        ["page errors", errors.length === 0],
        ["unexpected console errors", unexpectedConsoleErrors(consoleErrors, origin).length === 0],
        ["two attempts", attempts.length === 2],
        ["state rows", states.length === 15],
        ["all behavior observations recorded", behaviorChecks.length === (scenario.expanded ? 11 : 15)],
        ["probe explicit disposal", probeCleanup !== null && typeof probeCleanup === "object"
          && "disposed" in probeCleanup && probeCleanup.disposed === true
          && "subscribed" in probeCleanup && probeCleanup.subscribed === false
          && "retainedNodes" in probeCleanup && probeCleanup.retainedNodes === false],
        ["default cleanup required fields", defaultCleanupMatches],
      ];
      for (const [name, passed] of lateChecks) if (!passed) lateFailures.push("Late guard failed: " + name);
    } catch (error) { lateFailures.push("Late guard evaluation failed: " + String(error)); }
    cleanupErrors.push(...lateFailures);
    const assertionErrors = info.errors.map((error) => error.message ?? String(error.value ?? "Unknown test error"));
    if (!failure && assertionErrors.length) failure = assertionErrors[0];
    const cleanupOnlyFailure = cleanupErrors.length > 0 && !failure;
    if (cleanupOnlyFailure) failure = "Cleanup failure: " + cleanupErrors.join("; ");
    diagnosticGuardsQualified = hardControlsCompleted && !failure && cleanupErrors.length === 0 && assertionErrors.length === 0;
    const observationsQualified = diagnosticGuardsQualified;
    const behaviorFailures = behaviorChecks.filter((check) => !check.passed);
    const qualifiedBehaviorRED = diagnosticGuardsQualified && behaviorFailures.length > 0;
    const recordedFailure = failure ?? (qualifiedBehaviorRED ? "Qualified E12 behavior mismatch after all hard guards and cleanup" : null);
    // Classification is deliberately computed after all hard/cleanup checks.
    // It is an observation, never a required native recipient or a ct/H verdict.
    const classifications = observationsQualified ? attempts.map((item) => ({ attempt: item.label,
      firstOpenDownRecipient: item.firstDown.inTrigger ? "original-trigger" : item.firstDown.inEditor ? "original-editor"
        : item.firstDown.inMenu ? "open-menu" : item.firstDown.target?.tag === "HTML" ? "documentElement"
          : item.firstDown.target?.tag === "BODY" ? "body" : "other-recipient",
      requestedSurface: item.label === "A" ? "original-trigger-center" : "actual-editor-free-interior",
      actualTargetReached: item.label === "A" ? item.firstDown.inTrigger : item.firstDown.inEditor,
      firstDownOpen: item.firstDown.openBeforeDispatch, target: item.firstDown.target,
      scope: "Local E12 nonmodal target contract; first-down only, no ct/H, nativeGUI or physical-device claim" })) : [];
    const path = info.outputPath("model-nonmodal-pointer.json");
    writeFileSync(path, JSON.stringify({ caseId: scenario.id, scenario, phase, failure: recordedFailure, failureKind: failure ? "diagnostic-guard" : qualifiedBehaviorRED ? "behavior" : null,
      assertionErrors, hardControlsCompleted, diagnosticGuardsQualified, observationsQualified, qualifiedBehaviorRED, behaviorChecks, behaviorFailures,
      classifications, attempts, states, tabs, finalProbe, probeCleanup, inputEvents, defaultReceipt, defaultCleanup, runtimeCleanup,
      counts, directory, api, writes, external, errors, consoleErrors, unexpectedConsoleErrors: origin ? unexpectedConsoleErrors(consoleErrors, origin) : consoleErrors,
      screenshots, cleanupErrors, streamCleanup, sourceBefore, sourceAfter,
      boundary: "Two local1440 main/real ComposerSheet cases, known OpenAI SOL/medium/FI=model. Initial seed only; all later input is real menu UI, Tab/Enter, mouse move/down/up, Escape cleanup or Sheet Back. Physical Sheet owner attribute remains actual null; logical owner independently equals A. First synchronous trusted left no-Ctrl down must reach original Trigger(A) or original free editor(B) with menuOpenBefore=true; afterDown/up closed and B natural editor focus are behavior targets recorded before any cleanup, never replaced by late hit/up or a second editor click. Outer Sheet Dialog lock/background AX are hard guards; inner own-editor/Trigger AX remain target checks. All15 state records and final-main business guards/owned cleanup complete before qualified behavior RED is assigned; finally is diagnostic only. Catalog POST reads/bookkeeping are allowed; all business writes/external denied. No ct/H, nativeGUI/account, physical device, service restart or native authority claim." }, null, 2) + "\n");
    await info.attach("model-nonmodal-pointer", { path, contentType: "application/json" });
    if (cleanupOnlyFailure) throw Error("Owned cleanup failed: " + cleanupErrors.join("; "));
  }
  expect(hardControlsCompleted).toBe(true); expect(cleanupErrors).toEqual([]); expect(sourceAfter).toEqual(sourceBefore);
  expect(counts).toEqual([1, 1, 1, 1]); expect(directory).toHaveLength(4); expect(writes).toEqual([]); expect(external).toEqual([]); expect(errors).toEqual([]);
  expect(unexpectedConsoleErrors(consoleErrors, origin)).toEqual([]); expect(attempts).toHaveLength(2);
  expect(defaultCleanup).toMatchObject({ disposed: true, subscribed: false, eventCount: 0, overflow: false });
  expect(diagnosticGuardsQualified).toBe(true); expect(states).toHaveLength(15);
  expect(behaviorChecks.filter((check) => !check.passed), "qualified E12 behavior targets after complete hard guards and cleanup").toEqual([]);
});
}
