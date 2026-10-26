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
const nativeScenarios = [
  { id: "model-current-medium", raw: "medium", mode: "model", label: "A deliberately wide current model label", purpose: "选择强度", widthWinner: "current" },
  { id: "default-placeholder-wider", raw: null, mode: "default", label: "S", purpose: "选择模型", widthWinner: "placeholder" },
] as const;
const CUSTOM_PROVIDER = "e7-custom-provider", CUSTOM_MODEL = "e7-custom-model";
type FooterCase = {
  id: string; width: 320 | 390 | 1440; surface: "main" | "expanded";
  kind: "core" | "running" | "custom"; mode: "model" | "default";
  raw: string | null; label: string; purpose: string; widthWinner: "current" | "placeholder";
  running: boolean; followupMode: "queue" | "steer"; otherSheet: boolean;
};
const cases: FooterCase[] = [];
for (const scenario of nativeScenarios) for (const width of [320, 390, 1440] as const)
  for (const surface of ["main", "expanded"] as const) cases.push({ ...scenario,
    id: scenario.id + "-" + width + "-" + surface, width, surface, kind: "core",
    running: false, followupMode: "queue", otherSheet: width === 1440 && surface === "main" && scenario.mode === "model" });
for (const width of [320, 390] as const) for (const followupMode of ["queue", "steer"] as const)
  cases.push({ ...nativeScenarios[0], id: "running-" + width + "-" + followupMode, width,
    surface: "expanded", kind: "running", running: true, followupMode, otherSheet: false });
cases.push({ ...nativeScenarios[0], id: "running-1440-steer", width: 1440, surface: "expanded",
  kind: "running", running: true, followupMode: "steer", otherSheet: false });
for (const width of [320, 390] as const) cases.push({ ...nativeScenarios[0], id: "custom-expanded-" + width,
  width, surface: "expanded", kind: "custom", running: false, followupMode: "queue", otherSheet: false });
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
];
async function initializeJoint(page: Page, initial: Initial & { serviceTier: string | null; provider: string; running: boolean; followupMode: "queue" | "steer" }) {
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
    const a = { ...setting(initial.model, initial.effort, 4), serviceTier: initial.serviceTier,
      modelProvider: initial.provider, providerModels: { [initial.provider]: initial.model } };
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
    const followupPath = "/src/session-mode/stores/useFollowupSettingsStore.ts";
    const followupURL = performance.getEntriesByType("resource").findLast((entry) => new URL(entry.name).pathname === followupPath)?.name;
    if (!followupURL) throw Error("Mounted followup settings missing before initial hydration");
    const followup = await import(followupURL);
    followup.useFollowupSettingsStore.getState().setMode(initial.followupMode);
    if (initial.running) {
      const state = codex.useCodexStore.getState();
      const turn = { id: "e10-initial-turn", status: "inProgress", startedAt: 1, durationMs: null, items: [] };
      const status = { type: "active", activeFlags: [] };
      codex.useCodexStore.setState({
        threads: state.threads.map((thread: { id: string }) => thread.id === "ux-0" ? { ...thread, status, turns: [turn] } : thread),
        currentTurnId: turn.id,
        threadStatusMap: { ...state.threadStatusMap, "ux-0": status },
        turnTimingMap: { ...state.turnTimingMap, "ux-0": { turnId: turn.id, status: "inProgress", startedAtMs: 1000, durationMs: null } },
      });
    }
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
async function menuDOM(menu: Locator) {
  return menu.evaluate((node) => {
    const active = document.activeElement;
    const radios = [...node.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].filter((row) => !row.closest('[hidden],[inert],[aria-hidden="true"]'));
    return { connected: node.isConnected, view: node.querySelector('[data-model-picker-view]')?.getAttribute('data-model-picker-view'),
      dots: [...node.querySelectorAll<HTMLElement>('.session-native-power-dot')].map((dot) => ({ left: dot.style.left, selected: dot.dataset.selected ?? null })),
      status: node.querySelector('[role="status"]')?.textContent ?? null,
      caption: (() => {
        const captions = node.querySelectorAll('.session-native-power-caption[role="menuitem"]');
        return captions.length === 1 ? captions[0].getAttribute("aria-label") : null;
      })(),
      effortAccent: node.querySelector(".session-native-power-effort")?.getAttribute("data-accent") ?? null,
      radios: radios.map((row) => ({ text: row.textContent?.trim(), checked: row.getAttribute('aria-checked'), disabled: row.getAttribute('aria-disabled') })),
      active: { role: active?.getAttribute('role') ?? null, text: active?.textContent?.trim().slice(0, 120) ?? null, inMenu: Boolean(active && node.contains(active)) } };
  });
}
function capturedMenu(state: { phase: string; menu: Awaited<ReturnType<typeof menuDOM>> | null }): Awaited<ReturnType<typeof menuDOM>> {
  const value = state.menu;
  if (value === null) throw Error("Captured menu missing for " + state.phase);
  return value;
}
async function triggerDOM(trigger: Locator) {
  return trigger.evaluate((node) => {
    const content = node.querySelector<HTMLElement>(".session-native-model-trigger-content");
    const measurement = node.querySelector<HTMLElement>(".session-native-model-trigger-measurement");
    const placeholder = node.querySelector<HTMLElement>(".session-native-model-trigger-placeholder");
    const button = node as HTMLElement, buttonStyle = getComputedStyle(button);
    const box = (element: Element | null) => {
      if (!element) return null; const rect = element.getBoundingClientRect();
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
    };
    const styleFields = (style: CSSStyleDeclaration) => ({
      display: style.display, position: style.position, boxSizing: style.boxSizing,
      width: style.width, minWidth: style.minWidth, maxWidth: style.maxWidth,
      paddingLeft: style.paddingLeft, paddingRight: style.paddingRight,
      paddingTop: style.paddingTop, paddingBottom: style.paddingBottom,
      borderLeft: style.borderLeftWidth, borderRight: style.borderRightWidth,
      borderTop: style.borderTopWidth, borderBottom: style.borderBottomWidth,
      columnGap: style.columnGap, gridTemplateColumns: style.gridTemplateColumns,
      gridColumnStart: style.gridColumnStart, gridColumnEnd: style.gridColumnEnd,
      direction: style.direction, writingMode: style.writingMode,
      overflowX: style.overflowX, overflowY: style.overflowY,
      transform: style.transform, translate: style.getPropertyValue("translate"),
      scale: style.getPropertyValue("scale"), zoom: style.getPropertyValue("zoom"),
    });
    const cssPixels = (text: string) => {
      if (!/^(?:\d+(?:\.\d*)?|\.\d+)px$/.test(text)) return null;
      const value = Number(text.slice(0, -2)); return Number.isFinite(value) ? value : null;
    };
    const parent = button.parentElement, parentStyle = parent ? getComputedStyle(parent) : null;
    const parentRect = box(parent);
    const parentContentBox = (() => {
      if (!parentRect || !parentStyle) return null;
      const left = cssPixels(parentStyle.paddingLeft), right = cssPixels(parentStyle.paddingRight);
      const top = cssPixels(parentStyle.paddingTop), bottom = cssPixels(parentStyle.paddingBottom);
      const borderLeft = cssPixels(parentStyle.borderLeftWidth), borderRight = cssPixels(parentStyle.borderRightWidth);
      const borderTop = cssPixels(parentStyle.borderTopWidth), borderBottom = cssPixels(parentStyle.borderBottomWidth);
      if (left === null || right === null || top === null || bottom === null || borderLeft === null || borderRight === null || borderTop === null || borderBottom === null) return null;
      return { left: parentRect.left + borderLeft + left, top: parentRect.top + borderTop + top,
        right: parentRect.right - borderRight - right, bottom: parentRect.bottom - borderBottom - bottom,
        width: parentRect.width - borderLeft - borderRight - left - right,
        height: parentRect.height - borderTop - borderBottom - top - bottom };
    })();
    const ancestry: Array<{ tag: string; classes: string; transform: string; scale: string; zoom: string }> = [];
    let reachedSessionRoot = false;
    for (let ancestor: Element | null = button; ancestor && ancestry.length < 32; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor);
      ancestry.push({ tag: ancestor.tagName, classes: ancestor.className,
        transform: style.transform, scale: style.getPropertyValue("scale"), zoom: style.getPropertyValue("zoom") });
      if (ancestor.matches(".session-mode")) { reachedSessionRoot = true; break; }
    }
    const documentRoot = document.documentElement, body = document.body;
    const buttonGeometry = { rect: box(button), clientWidth: button.clientWidth, scrollWidth: button.scrollWidth,
      maxWidth: buttonStyle.maxWidth, chevron: box(button.querySelector("svg")), computed: styleFields(buttonStyle),
      parent: parent && parentStyle ? { tag: parent.tagName, classes: parent.className,
        isFullSheetFooter: parent.matches(".session-composer-sheet.is-full > footer"),
        hasExpandedSubmit: Boolean(parent.querySelector(":scope > .session-expanded-submit")),
        rect: parentRect, clientWidth: parent.clientWidth, scrollWidth: parent.scrollWidth,
        clientHeight: parent.clientHeight, scrollHeight: parent.scrollHeight,
        contentBox: parentContentBox, computed: styleFields(parentStyle) } : null,
      ancestry, reachedSessionRoot };
    const viewport = { width: window.innerWidth, height: window.innerHeight,
      documentClientWidth: documentRoot.clientWidth, documentScrollWidth: documentRoot.scrollWidth,
      bodyClientWidth: body?.clientWidth ?? null, bodyScrollWidth: body?.scrollWidth ?? null };
    const visible = (element: Element | null) => {
      if (!element) return false; const style = getComputedStyle(element);
      return element.isConnected && !element.closest("[hidden],[inert]") && element.getClientRects().length > 0 && style.display !== "none" && style.visibility !== "hidden" && style.visibility !== "collapse";
    };
    const geometry = (element: HTMLElement | null) => {
      if (!element) return null; const style = getComputedStyle(element), rect = element.getBoundingClientRect();
      return { text: element.textContent, width: rect.width, rect: box(element), minWidth: element.style.minWidth,
        preferredWidth: element.style.width, inlineFlexBasis: element.style.flexBasis,
        computedWidth: style.width, computedMinWidth: style.minWidth, computedMaxWidth: style.maxWidth,
        flexGrow: style.flexGrow, flexShrink: style.flexShrink, flexBasis: style.flexBasis,
        boxSizing: style.boxSizing, visibility: style.visibility,
        position: style.position, pointerEvents: style.pointerEvents, whiteSpace: style.whiteSpace,
        ariaHidden: element.getAttribute("aria-hidden"), visible: visible(element) };
    };
    const hidden: string[] = []; for (let parent: Element | null = node; parent; parent = parent.parentElement) if (parent.getAttribute("aria-hidden") === "true") hidden.push(parent.tagName + "." + parent.className);
    return { connected: node.isConnected, physicallyVisible: visible(node), button: buttonGeometry, viewport, expanded: node.getAttribute("aria-expanded"),
      aria: node.getAttribute("aria-label"), labelledby: node.getAttribute("aria-labelledby"), axHiddenAncestors: hidden,
      selectionSpanCount: node.querySelectorAll(".session-native-model-label,.session-native-model-effort").length,
      model: node.querySelector(".session-native-model-label")?.textContent ?? null,
      effort: node.querySelector(".session-native-model-effort")?.textContent ?? null,
      content: geometry(content), measurement: geometry(measurement), placeholder: geometry(placeholder) };
  });
}
function resolveTriggerCap(value: Awaited<ReturnType<typeof triggerDOM>>) {
  // Test-only arithmetic on primitive DOM observations. Never calls the product.
  const diagnostics: string[] = [];
  const pixels = (text: string) => {
    if (!/^(?:\d+(?:\.\d*)?|\.\d+)px$/.test(text)) return null;
    const number = Number(text.slice(0, -2)); return Number.isFinite(number) ? number : null;
  };
  const sumPixels = (values: string[], label: string) => {
    const numbers = values.map(pixels);
    if (numbers.some((number) => number === null)) { diagnostics.push(label + " is not complete px lengths"); return null; }
    return numbers.reduce<number>((sum, number) => sum + (number ?? 0), 0);
  };
  const translationOnly = (text: string) => {
    if (text === "none" || text === "") return true;
    const match = /^(matrix|matrix3d)\(([^)]+)\)$/.exec(text);
    if (!match) return false;
    const values = match[2].split(",").map((entry) => Number(entry.trim()));
    if (!values.every(Number.isFinite)) return false;
    if (match[1] === "matrix") return values.length === 6 && [values[0], values[1], values[2], values[3]].every((number, index) => Math.abs(number - [1, 0, 0, 1][index]) < 0.000001);
    return values.length === 16 && values.every((number, index) => [12, 13, 14].includes(index) || Math.abs(number - ([0, 5, 10, 15].includes(index) ? 1 : 0)) < 0.000001);
  };
  if (!value.button.reachedSessionRoot) diagnostics.push("captured session ancestor not reached within 32 observations");
  for (const ancestor of value.button.ancestry) {
    if (!translationOnly(ancestor.transform)
      || !["", "none", "1", "1 1", "1 1 1"].includes(ancestor.scale)
      || !["", "normal", "1", "100%"].includes(ancestor.zoom)) diagnostics.push("unsupported scale/transform at " + ancestor.tag + "." + ancestor.classes);
  }
  const own = value.button.computed;
  const ownExtra = sumPixels([own.paddingLeft, own.paddingRight, own.borderLeft, own.borderRight], "button padding/borders");
  const gap = pixels(own.columnGap);
  if (gap === null) diagnostics.push("button column gap is not a px length");
  if (!["border-box", "content-box"].includes(own.boxSizing)) diagnostics.push("unsupported button boxSizing " + own.boxSizing);
  if (own.writingMode !== "horizontal-tb") diagnostics.push("unsupported button writing mode " + own.writingMode);
  const raw = value.button.maxWidth.trim();
  let kind: "none" | "px" | "percentage" | "unsupported" = "unsupported";
  let cssCap: number | null = null, borderBoxCap: number | null = null;
  let containingBlock: { source: string; left: number; right: number; width: number; tracks: number[]; gap: number | null } | null = null;
  if (raw === "" || raw === "none") kind = "none";
  else if (pixels(raw) !== null) { kind = "px"; cssCap = pixels(raw); }
  else if (/^(?:\d+(?:\.\d*)?|\.\d+)%$/.test(raw) && Number.isFinite(Number(raw.slice(0, -1)))) {
    kind = "percentage";
    const parent = value.button.parent;
    if (!parent || !parent.rect || !parent.contentBox) diagnostics.push("percentage containing parent/content box missing");
    else {
      const parentStyle = parent.computed, content = parent.contentBox;
      if (own.position !== "static" && own.position !== "relative") diagnostics.push("unsupported out-of-flow percentage button");
      if (parentStyle.writingMode !== "horizontal-tb" || parentStyle.direction !== "ltr") diagnostics.push("unsupported percentage parent writing mode/direction");
      if (parentStyle.overflowY === "scroll" || (parentStyle.overflowY === "auto" && parent.scrollHeight > parent.clientHeight + 1)) diagnostics.push("scrollbar-containing percentage parent unsupported");
      if (parentStyle.display === "grid") {
        const trackTokens = parentStyle.gridTemplateColumns.trim().split(/\s+/);
        const tracks = trackTokens.map(pixels), gridGap = pixels(parentStyle.columnGap);
        const numericSpan = /^\d+$/.test(own.gridColumnStart) && /^\d+$/.test(own.gridColumnEnd);
        const start = Number(own.gridColumnStart), end = Number(own.gridColumnEnd);
        if (!parent.isFullSheetFooter || !parent.hasExpandedSubmit || !numericSpan || start !== 2 || end !== 4
          || tracks.length !== 3 || tracks.some((track) => track === null) || gridGap === null) diagnostics.push("unsupported percentage grid tracks/placement: " + parentStyle.gridTemplateColumns + " / " + own.gridColumnStart + ":" + own.gridColumnEnd);
        else {
          const used = tracks.map((track) => track ?? 0);
          const left = content.left + used.slice(0, start - 1).reduce((sum, track) => sum + track, 0) + gridGap * (start - 1);
          const width = used.slice(start - 1, end - 1).reduce((sum, track) => sum + track, 0) + gridGap * (end - start - 1);
          containingBlock = { source: "actual current Sheet grid columns 2/4", left, right: left + width, width, tracks: used, gap: gridGap };
        }
      } else if (["block", "flex", "inline-flex"].includes(parentStyle.display)) {
        containingBlock = { source: "actual current supported parent content box", left: content.left, right: content.right, width: content.width, tracks: [], gap: null };
      } else diagnostics.push("unsupported percentage parent display " + parentStyle.display);
      if (containingBlock) cssCap = containingBlock.width * Number(raw.slice(0, -1)) / 100;
    }
  } else diagnostics.push("unsupported computed max-width " + raw);
  if (cssCap !== null && ownExtra !== null && ["border-box", "content-box"].includes(own.boxSizing)) borderBoxCap = cssCap + (own.boxSizing === "content-box" ? ownExtra : 0);
  const buttonWidth = value.button.rect?.width ?? null, chevronWidth = value.button.chevron?.width ?? null;
  if (chevronWidth === null) diagnostics.push("captured chevron box missing");
  const contentBudget = buttonWidth !== null && ownExtra !== null && chevronWidth !== null && gap !== null ? Math.max(0, buttonWidth - ownExtra - chevronWidth - gap) : null;
  const cappedContentBudget = borderBoxCap !== null && ownExtra !== null && chevronWidth !== null && gap !== null ? Math.max(0, borderBoxCap - ownExtra - chevronWidth - gap) : null;
  return { kind, raw, cssCap, borderBoxCap, containingBlock, ownExtra, contentBudget, cappedContentBudget, diagnostics };
}
async function tooltipDOM(trigger: Locator, targetId: string | null = null) {
  return trigger.evaluate((button, targetId) => {
    const physical = (node: Element | null) => {
      const positiveOpacity = (raw: string) => {
        const value = Number.parseFloat(raw);
        if (!Number.isFinite(value) || value < 0 || value > 1) throw Error("Unsupported computed Tooltip opacity: " + raw);
        return value > 0;
      };
      if (!node || !node.isConnected || node.closest("[hidden],[inert]")) return false;
      const rect = node.getBoundingClientRect(), style = getComputedStyle(node), hasVisibleOpacity = positiveOpacity(style.opacity);
      if (rect.width <= 0 || rect.height <= 0 || node.getClientRects().length === 0 || style.display === "none" || ["hidden", "collapse"].includes(style.visibility) || !hasVisibleOpacity) return false;
      for (let parent = node.parentElement; parent; parent = parent.parentElement) {
        const value = getComputedStyle(parent), hasVisibleOpacity = positiveOpacity(value.opacity); if (value.display === "none" || ["hidden", "collapse"].includes(value.visibility) || !hasVisibleOpacity) return false;
      }
      return true;
    };
    // Passive diagnostics only: retain the original physical/visibleLabels oracle below.
    const renderDiagnostics = (node: Element | null) => {
      if (!node) return null;
      const startedAt = performance.now();
      let textOverflow = false;
      const text = (value: string) => { if (value.length > 256) textOverflow = true; return value.slice(0, 256); };
      const time = (value: unknown) => value == null ? null : typeof value === "number" && Number.isFinite(value) ? value : text(String(value));
      const rect = node.getBoundingClientRect(), value = getComputedStyle(node);
      const computed = {
        opacity: text(value.opacity), display: text(value.display), visibility: text(value.visibility),
        contentVisibility: text(value.contentVisibility), transform: text(value.transform), filter: text(value.filter), clipPath: text(value.clipPath),
        animationName: text(value.animationName), animationDuration: text(value.animationDuration), animationDelay: text(value.animationDelay),
        animationTimingFunction: text(value.animationTimingFunction), animationFillMode: text(value.animationFillMode), animationPlayState: text(value.animationPlayState),
        transitionProperty: text(value.transitionProperty), transitionDuration: text(value.transitionDuration), transitionDelay: text(value.transitionDelay),
      };
      const ancestors: Array<{ depth: number; tag: string; opacity: string; display: string; visibility: string; contentVisibility: string; transform: string; filter: string }> = [];
      let parent: Element | null = node.parentElement;
      while (parent && ancestors.length < 24) {
        const ancestor = getComputedStyle(parent);
        ancestors.push({ depth: ancestors.length + 1, tag: parent.tagName, opacity: text(ancestor.opacity), display: text(ancestor.display),
          visibility: text(ancestor.visibility), contentVisibility: text(ancestor.contentVisibility), transform: text(ancestor.transform), filter: text(ancestor.filter) });
        parent = parent.parentElement;
      }
      const animations = node.getAnimations({ subtree: false });
      const ownAnimations = animations.slice(0, 8).map((animation) => {
        const timing = animation.effect?.getComputedTiming();
        return { id: text(animation.id), playState: animation.playState, pending: animation.pending, playbackRate: animation.playbackRate,
          currentTime: time(animation.currentTime), startTime: time(animation.startTime), timelineTime: time(animation.timeline?.currentTime),
          timing: timing ? { delay: time(timing.delay), endDelay: time(timing.endDelay), duration: time(timing.duration), iterations: time(timing.iterations),
            iterationStart: time(timing.iterationStart), direction: timing.direction, easing: timing.easing == null ? null : text(timing.easing), fill: timing.fill,
            activeDuration: time(timing.activeDuration), endTime: time(timing.endTime), localTime: time(timing.localTime),
            progress: time(timing.progress), currentIteration: time(timing.currentIteration) } : null };
      });
      return { startedAt, finishedAt: performance.now(), connected: node.isConnected, tag: node.tagName,
        rect: { x: rect.x, y: rect.y, left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height },
        clientRectCount: node.getClientRects().length, computed, ancestors, ancestorOverflow: parent !== null,
        ownAnimationCount: animations.length, ownAnimationOverflow: animations.length > 8, ownAnimations, textOverflow };
    };
    const all = [...document.querySelectorAll<HTMLElement>('.session-native-composer-tooltip[data-slot="tooltip-content"]')];
    const ids = (button.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
    if (targetId && ids.some((id) => id !== targetId)) throw Error("Captured model Tooltip native id changed");
    const matches = targetId ? [...document.querySelectorAll<HTMLElement>('[role="tooltip"]')].filter((node) => node.id === targetId) : [];
    if (matches.length > 1) throw Error("Duplicate captured model Tooltip native id");
    const ownRoots = matches.map((description) => description.closest<HTMLElement>('.session-native-composer-tooltip[data-slot="tooltip-content"]'));
    if (ownRoots.some((root) => !root || !all.includes(root))) throw Error("Captured model Tooltip moved to an unknown Content root");
    const owned = all.filter((content) => ownRoots.includes(content));
    const model = targetId === null ? null : { id: targetId, nativeIdCount: matches.length, contentCount: owned.length,
      visibleLabels: owned.filter(physical).map((content) => content.querySelector<HTMLElement>(":scope > .session-native-composer-tooltip-label")).filter(physical).map((label) => label?.textContent ?? null) };
    return { model, overflow: all.length > 8 || ids.length > 8,
      contents: all.slice(0, 8).map((content) => {
        const label = content.querySelector<HTMLElement>(":scope > .session-native-composer-tooltip-label");
        const copies = [...content.querySelectorAll<HTMLElement>('[role="tooltip"]')];
        if (copies.length > 8) throw Error("Tooltip description-id observation overflow");
        return { nativeDescriptionIds: copies.map((description) => description.id), state: content.dataset.state ?? null, visible: physical(content), labelVisible: physical(label), label: label?.textContent ?? null,
          ariaHidden: content.getAttribute("aria-hidden"), nestedDescriptionCopies: content.querySelectorAll('[role="tooltip"]').length,
          renderDiagnostics: { content: renderDiagnostics(content), directLabel: renderDiagnostics(label) } };
      }),
      // Description clones are not included in visibleLabels.
      visibleLabels: all.slice(0, 8).filter(physical).map((content) => content.querySelector<HTMLElement>(":scope > .session-native-composer-tooltip-label")).filter(physical).map((label) => label?.textContent ?? null),
      describedby: button.getAttribute("aria-describedby"), descriptions: ids.slice(0, 8).map((id) => {
        const description = document.getElementById(id); return { id, role: description?.getAttribute("role") ?? null,
          text: description?.textContent ?? null, physicallyVisible: physical(description) };
      }),
      rawName: button.getAttribute("aria-label"), labelledby: button.getAttribute("aria-labelledby"),
      axHiddenAncestors: (() => { const names: string[] = []; for (let parent: Element | null = button; parent; parent = parent.parentElement) if (parent.getAttribute("aria-hidden") === "true") names.push(parent.tagName); return names; })() };
  }, targetId);
}
async function observeLifecycle(trigger: Locator) {
  return trigger.evaluateHandle((button) => {
    const doc = button.ownerDocument;
    let held: Element | null = button, root: Element | null = button.closest(".session-codex-composer,.session-composer-sheet.is-full");
    let editor: Element | null = root?.querySelector('[contenteditable="true"],.session-rich-draft textarea') ?? null;
    if (!root || !editor) throw Error("Owned lifecycle observation scope/editor missing");
    let subscribed = true, overflow = false;
    const events: Array<{ type: string; trusted: boolean; now: number; key: string | null; code: string | null; repeat: boolean | null;
      pointerType: string | null; x: number | null; y: number | null; target: string; related: string; isTrigger: boolean;
      insideTrigger: boolean; isPower: boolean; inModelMenu: boolean; text: string | null;
      activeIsTrigger: boolean; activeIsEditor: boolean; triggerFocusVisible: boolean; hasFocus: boolean }> = [];
    const kind = (node: EventTarget | null) => {
      if (!(node instanceof Element)) return node === doc ? "document" : "non-element";
      if (node === held) return "trigger";
      if (node === editor || editor?.contains(node)) return "editor";
      if (node.closest('[data-reasoning-slider]')) return "power";
      if (node.closest('.session-native-power-caption')) return "caption";
      if (node.closest('.session-native-model-menu')) return "model-menu";
      if (node.closest('.session-native-composer-tooltip')) return "tooltip-neighbour-or-exit";
      return node.tagName.toLowerCase() + (node.getAttribute("role") ? ":" + node.getAttribute("role") : "");
    };
    const active = () => ({ trigger: doc.activeElement === held, editor: doc.activeElement === editor,
      kind: kind(doc.activeElement), focusVisible: held?.matches(":focus-visible") ?? false,
      hasFocus: doc.hasFocus(), connected: held?.isConnected ?? false, hovered: held?.matches(":hover") ?? false });
    const listener = (event: Event) => {
      if (!held || !subscribed) return;
      if (events.length >= 384) { overflow = true; return; }
      const target = event.target instanceof Element ? event.target : null;
      const related = event instanceof FocusEvent || event instanceof MouseEvent ? event.relatedTarget : null;
      events.push({ type: event.type, trusted: event.isTrusted, now: performance.now(),
        key: event instanceof KeyboardEvent ? event.key : null, code: event instanceof KeyboardEvent ? event.code : null,
        repeat: event instanceof KeyboardEvent ? event.repeat : null,
        pointerType: event instanceof PointerEvent ? event.pointerType : null,
        x: event instanceof MouseEvent ? event.clientX : null, y: event instanceof MouseEvent ? event.clientY : null,
        target: kind(target), related: kind(related), isTrigger: target === held, insideTrigger: Boolean(target && held.contains(target)),
        isPower: Boolean(target?.closest('[data-reasoning-slider]')), inModelMenu: Boolean(target?.closest('.session-native-model-menu')),
        text: target?.getAttribute("aria-label") ?? target?.textContent?.slice(0, 120) ?? null,
        activeIsTrigger: doc.activeElement === held, activeIsEditor: doc.activeElement === editor,
        triggerFocusVisible: held.matches(":focus-visible"), hasFocus: doc.hasFocus() });
    };
    const types = ["keydown", "focusin", "blur", "focusout", "pointerenter", "pointerleave", "pointerover", "pointerout", "pointermove", "pointerdown", "click"];
    types.forEach((type) => doc.addEventListener(type, listener, true));
    return {
      read: () => { if (!subscribed || !held) throw Error("Lifecycle observer disposed"); return { subscribed, overflow, now: performance.now(), active: active(), events: events.map((event) => ({ ...event })) }; },
      dispose: () => { types.forEach((type) => doc.removeEventListener(type, listener, true)); subscribed = false;
        const eventCount = events.length; events.length = 0; held = null; root = null; editor = null;
        return { disposed: true, subscribed, retainedNodes: false, eventCount, overflow }; },
    };
  });
}
async function readLifecycle(probe: Awaited<ReturnType<typeof observeLifecycle>>) { return probe.evaluate((value) => value.read()); }
const actualTriggerBlurs = (row: Awaited<ReturnType<typeof readLifecycle>>) => row.events.filter((event) => event.type === "blur" && event.isTrigger).length;
const actualTriggerLeaves = (row: Awaited<ReturnType<typeof readLifecycle>>) => row.events.filter((event) => event.isTrigger && ["pointerleave", "pointerout"].includes(event.type));
async function focusSnapshot(trigger: Locator) {
  return trigger.evaluate((button) => ({ trigger: document.activeElement === button, focusVisible: button.matches(":focus-visible"),
    documentFocused: document.hasFocus(), editor: Boolean(document.activeElement?.matches('[contenteditable="true"],.session-rich-draft textarea')) }));
}
async function tabToTrigger(page: Page, trigger: Locator, receipts: Array<{ phase: string; tabs: number; focused: boolean; focusVisible: boolean }>, phase: string) {
  let tabs = 0;
  while (!(await focusSnapshot(trigger)).trigger && tabs < 20) { await page.keyboard.press("Tab"); tabs++; }
  const value = await focusSnapshot(trigger); receipts.push({ phase, tabs, focused: value.trigger, focusVisible: value.focusVisible });
  expect(tabs, phase).toBeGreaterThan(0); expect(tabs, phase).toBeLessThanOrEqual(20);
  expect(value, phase).toMatchObject({ trigger: true, focusVisible: true, documentFocused: true });
}


/** One synchronous DOM frame for roots, all text/icon clips, tracks, caps and hit tests. */
async function footerDOM(scope: Locator) {
  return scope.evaluate((root) => {
    const node = root.querySelector<HTMLElement>(".session-native-model-trigger");
    const footer = root.matches(".session-composer-sheet.is-full")
      ? root.querySelector<HTMLElement>(":scope > footer")
      : root.querySelector<HTMLElement>(".session-composer-toolbar");
    if (!node || !footer) throw Error("Actual scope model/footer is missing");
    const model = (() => {
    const content = node.querySelector<HTMLElement>(".session-native-model-trigger-content");
    const measurement = node.querySelector<HTMLElement>(".session-native-model-trigger-measurement");
    const placeholder = node.querySelector<HTMLElement>(".session-native-model-trigger-placeholder");
    const button = node as HTMLElement, buttonStyle = getComputedStyle(button);
    const box = (element: Element | null) => {
      if (!element) return null; const rect = element.getBoundingClientRect();
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
    };
    const styleFields = (style: CSSStyleDeclaration) => ({
      display: style.display, position: style.position, boxSizing: style.boxSizing,
      width: style.width, minWidth: style.minWidth, maxWidth: style.maxWidth,
      paddingLeft: style.paddingLeft, paddingRight: style.paddingRight,
      paddingTop: style.paddingTop, paddingBottom: style.paddingBottom,
      borderLeft: style.borderLeftWidth, borderRight: style.borderRightWidth,
      borderTop: style.borderTopWidth, borderBottom: style.borderBottomWidth,
      columnGap: style.columnGap, gridTemplateColumns: style.gridTemplateColumns,
      gridColumnStart: style.gridColumnStart, gridColumnEnd: style.gridColumnEnd,
      direction: style.direction, writingMode: style.writingMode,
      overflowX: style.overflowX, overflowY: style.overflowY,
      transform: style.transform, translate: style.getPropertyValue("translate"),
      scale: style.getPropertyValue("scale"), zoom: style.getPropertyValue("zoom"),
    });
    const cssPixels = (text: string) => {
      if (!/^(?:\d+(?:\.\d*)?|\.\d+)px$/.test(text)) return null;
      const value = Number(text.slice(0, -2)); return Number.isFinite(value) ? value : null;
    };
    const parent = button.parentElement, parentStyle = parent ? getComputedStyle(parent) : null;
    const parentRect = box(parent);
    const parentContentBox = (() => {
      if (!parentRect || !parentStyle) return null;
      const left = cssPixels(parentStyle.paddingLeft), right = cssPixels(parentStyle.paddingRight);
      const top = cssPixels(parentStyle.paddingTop), bottom = cssPixels(parentStyle.paddingBottom);
      const borderLeft = cssPixels(parentStyle.borderLeftWidth), borderRight = cssPixels(parentStyle.borderRightWidth);
      const borderTop = cssPixels(parentStyle.borderTopWidth), borderBottom = cssPixels(parentStyle.borderBottomWidth);
      if (left === null || right === null || top === null || bottom === null || borderLeft === null || borderRight === null || borderTop === null || borderBottom === null) return null;
      return { left: parentRect.left + borderLeft + left, top: parentRect.top + borderTop + top,
        right: parentRect.right - borderRight - right, bottom: parentRect.bottom - borderBottom - bottom,
        width: parentRect.width - borderLeft - borderRight - left - right,
        height: parentRect.height - borderTop - borderBottom - top - bottom };
    })();
    const ancestry: Array<{ tag: string; classes: string; transform: string; scale: string; zoom: string }> = [];
    let reachedSessionRoot = false;
    for (let ancestor: Element | null = button; ancestor && ancestry.length < 32; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor);
      ancestry.push({ tag: ancestor.tagName, classes: ancestor.className,
        transform: style.transform, scale: style.getPropertyValue("scale"), zoom: style.getPropertyValue("zoom") });
      if (ancestor.matches(".session-mode")) { reachedSessionRoot = true; break; }
    }
    const documentRoot = document.documentElement, body = document.body;
    const buttonGeometry = { rect: box(button), clientWidth: button.clientWidth, scrollWidth: button.scrollWidth,
      maxWidth: buttonStyle.maxWidth, chevron: box(button.querySelector("svg")), computed: styleFields(buttonStyle),
      parent: parent && parentStyle ? { tag: parent.tagName, classes: parent.className,
        isFullSheetFooter: parent.matches(".session-composer-sheet.is-full > footer"),
        hasExpandedSubmit: Boolean(parent.querySelector(":scope > .session-expanded-submit")),
        rect: parentRect, clientWidth: parent.clientWidth, scrollWidth: parent.scrollWidth,
        clientHeight: parent.clientHeight, scrollHeight: parent.scrollHeight,
        contentBox: parentContentBox, computed: styleFields(parentStyle) } : null,
      ancestry, reachedSessionRoot };
    const viewport = { width: window.innerWidth, height: window.innerHeight,
      documentClientWidth: documentRoot.clientWidth, documentScrollWidth: documentRoot.scrollWidth,
      bodyClientWidth: body?.clientWidth ?? null, bodyScrollWidth: body?.scrollWidth ?? null };
    const visible = (element: Element | null) => {
      if (!element) return false; const style = getComputedStyle(element);
      return element.isConnected && !element.closest("[hidden],[inert]") && element.getClientRects().length > 0 && style.display !== "none" && style.visibility !== "hidden" && style.visibility !== "collapse";
    };
    const geometry = (element: HTMLElement | null) => {
      if (!element) return null; const style = getComputedStyle(element), rect = element.getBoundingClientRect();
      return { text: element.textContent, width: rect.width, rect: box(element), minWidth: element.style.minWidth,
        preferredWidth: element.style.width, inlineFlexBasis: element.style.flexBasis,
        computedWidth: style.width, computedMinWidth: style.minWidth, computedMaxWidth: style.maxWidth,
        flexGrow: style.flexGrow, flexShrink: style.flexShrink, flexBasis: style.flexBasis,
        boxSizing: style.boxSizing, visibility: style.visibility,
        position: style.position, pointerEvents: style.pointerEvents, whiteSpace: style.whiteSpace,
        ariaHidden: element.getAttribute("aria-hidden"), visible: visible(element) };
    };
    const hidden: string[] = []; for (let parent: Element | null = node; parent; parent = parent.parentElement) if (parent.getAttribute("aria-hidden") === "true") hidden.push(parent.tagName + "." + parent.className);
    return { connected: node.isConnected, physicallyVisible: visible(node), button: buttonGeometry, viewport, expanded: node.getAttribute("aria-expanded"),
      aria: node.getAttribute("aria-label"), labelledby: node.getAttribute("aria-labelledby"), axHiddenAncestors: hidden,
      selectionSpanCount: node.querySelectorAll(".session-native-model-label,.session-native-model-effort").length,
      model: node.querySelector(".session-native-model-label")?.textContent ?? null,
      effort: node.querySelector(".session-native-model-effort")?.textContent ?? null,
      content: geometry(content), measurement: geometry(measurement), placeholder: geometry(placeholder) };
    })();
    const box = (element: Element) => {
      const r = element.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    };
    type Box = ReturnType<typeof box>;
    const diagnostics: string[] = [];
    const pixels = (value: string, context: string) => {
      if (!/^(?:\d+(?:\.\d*)?|\.\d+)px$/.test(value)) { diagnostics.push(context + ": unsupported CSS length " + value); return 0; }
      const result = Number(value.slice(0, -2));
      if (!Number.isFinite(result)) { diagnostics.push(context + ": nonfinite CSS length"); return 0; }
      return result;
    };
    const physical = (element: Element | null) => {
      if (!element || !element.isConnected || element.closest("[hidden],[inert]")) return false;
      const r = element.getBoundingClientRect(); if (r.width <= 0 || r.height <= 0 || !element.getClientRects().length) return false;
      let depth = 0;
      for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement) {
        if (++depth > 48) { diagnostics.push("Physical ancestor overflow"); return false; }
        const style = getComputedStyle(ancestor), opacity = Number.parseFloat(style.opacity);
        if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) { diagnostics.push("Unknown computed opacity"); return false; }
        if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse" || opacity <= 0) return false;
      }
      return true;
    };
    const identify = (element: Element | null) => element ? { tag: element.tagName,
      classes: element.getAttribute("class"), role: element.getAttribute("role"), label: element.getAttribute("aria-label") } : null;
    const contentBox = (element: Element) => {
      const r = box(element), st = getComputedStyle(element);
      const edges = { left: pixels(st.borderLeftWidth, "left border") + pixels(st.paddingLeft, "left padding"),
        right: pixels(st.borderRightWidth, "right border") + pixels(st.paddingRight, "right padding"),
        top: pixels(st.borderTopWidth, "top border") + pixels(st.paddingTop, "top padding"),
        bottom: pixels(st.borderBottomWidth, "bottom border") + pixels(st.paddingBottom, "bottom padding") };
      return { left: r.left + edges.left, right: r.right - edges.right,
        top: r.top + edges.top, bottom: r.bottom - edges.bottom,
        width: r.width - edges.left - edges.right, height: r.height - edges.top - edges.bottom };
    };
    const intersect = (a: Box, b: Box): Box | null => {
      const left = Math.max(a.left, b.left), right = Math.min(a.right, b.right);
      const top = Math.max(a.top, b.top), bottom = Math.min(a.bottom, b.bottom);
      return right > left && bottom > top ? { left, right, top, bottom, width: right - left, height: bottom - top } : null;
    };
    const viewport = { left: 0, top: 0, right: innerWidth, bottom: innerHeight, width: innerWidth, height: innerHeight };
    const rawRange = (element: Element) => {
      const range = document.createRange(); range.selectNodeContents(element);
      const values = [...range.getClientRects()]; range.detach();
      if (values.length > 32) diagnostics.push("Text Range rect overflow");
      return values.slice(0, 32).map((r) => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }));
    };
    // Text nodes still paint through a display:contents wrapper with no own
    // box. Only real positive Range rects plus the actual ancestor CSS qualify
    // text; SVG/nontext elements keep the unchanged own-box physical predicate.
    const textStyles = (element: Element) => {
      const ancestry: Array<{ node: ReturnType<typeof identify>; display: string; visibility: string; opacity: string }> = [];
      let allowed = element.isConnected && !element.closest("[hidden],[inert]");
      for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement) {
        if (ancestry.length >= 48) { diagnostics.push("Text paint ancestor overflow"); allowed = false; break; }
        const css = getComputedStyle(ancestor), opacity = Number.parseFloat(css.opacity);
        ancestry.push({ node: identify(ancestor), display: css.display, visibility: css.visibility, opacity: css.opacity });
        if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) { diagnostics.push("Unknown computed text opacity"); allowed = false; }
        if (css.display === "none" || css.visibility === "hidden" || css.visibility === "collapse" || opacity <= 0) allowed = false;
      }
      return { allowed, ancestry };
    };
    const part = (element: Element, kind: string, text: boolean) => {
      const raw = text ? rawRange(element) : [box(element)], textPaint = text ? textStyles(element) : null;
      const positiveRaw = raw.filter((r) => r.width > 0 && r.height > 0);
      const visible = text ? Boolean(textPaint?.allowed && positiveRaw.length > 0) : physical(element);
      const clips: Array<{ node: ReturnType<typeof identify>; x: boolean; y: boolean; box: Box; overflowX: string; overflowY: string }> = [];
      let depth = 0;
      for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement) {
        if (++depth > 48) { diagnostics.push("Text clipping ancestor overflow"); break; }
        const css = getComputedStyle(ancestor), r = box(ancestor);
        const x = ["hidden", "clip", "auto", "scroll"].includes(css.overflowX), y = ["hidden", "clip", "auto", "scroll"].includes(css.overflowY);
        if (x || y) {
          const left = r.left + pixels(css.borderLeftWidth, "clip left border"), right = r.right - pixels(css.borderRightWidth, "clip right border");
          const top = r.top + pixels(css.borderTopWidth, "clip top border"), bottom = r.bottom - pixels(css.borderBottomWidth, "clip bottom border");
          clips.push({ node: identify(ancestor), x, y, overflowX: css.overflowX, overflowY: css.overflowY,
            box: { left, right, top, bottom, width: right - left, height: bottom - top } });
        }
      }
      const clipped = visible ? raw.map((r) => {
        let value: Box | null = intersect(r, viewport);
        for (const clip of clips) {
          if (!value) break;
          value = intersect(value, { ...value, left: clip.x ? clip.box.left : value.left,
            right: clip.x ? clip.box.right : value.right, top: clip.y ? clip.box.top : value.top,
            bottom: clip.y ? clip.box.bottom : value.bottom });
        }
        return value;
      }).filter((value): value is Box => value !== null) : [];
      const css = getComputedStyle(element);
      return { kind, node: identify(element), text: text ? element.textContent : null, visible, rect: box(element), raw, clipped, clips,
        textPaint: textPaint ? { ...textPaint, positiveRawRectCount: positiveRaw.length } : null,
        css: { overflowX: css.overflowX, overflowY: css.overflowY, textOverflow: css.textOverflow, whiteSpace: css.whiteSpace,
          flexShrink: css.flexShrink, minWidth: css.minWidth, width: css.width, pointerEvents: css.pointerEvents },
        icon: element instanceof SVGSVGElement ? { name: element.getAttribute("data-native-icon"), viewBox: element.getAttribute("viewBox"), width: element.getAttribute("width"), height: element.getAttribute("height") } : null };
    };
    const selectors = { access: ".session-access-trigger", model: ".session-native-model-trigger",
      stop: ".session-expanded-stop,.session-composer-stop", send: ".session-expanded-submit,.session-composer-send" };
    const controlElements: Array<{ key: keyof typeof selectors; element: HTMLElement }> = [];
    for (const key of Object.keys(selectors) as Array<keyof typeof selectors>) {
      const matches = root.querySelectorAll<HTMLElement>(selectors[key]);
      if (matches.length > 1) diagnostics.push("Duplicate " + key + " control in actual scope");
      if (matches[0]) controlElements.push({ key, element: matches[0] });
    }
    const overlays = [...document.querySelectorAll<HTMLElement>('[role="menu"],.session-composer-menu,[role="alertdialog"],[role="dialog"]')]
      .filter(physical).filter((element) => !element.contains(root));
    const canAssertBackgroundHits = overlays.length === 0;
    const controls = controlElements.map(({ key, element }) => {
      const r = box(element), css = getComputedStyle(element), parts: ReturnType<typeof part>[] = [];
      if (key === "model") {
        for (const match of element.querySelectorAll<HTMLElement>(".session-native-model-label,.session-native-model-effort,.session-native-model-trigger-placeholder"))
          parts.push(part(match, match.classList.contains("session-native-model-trigger-placeholder") ? "purpose" : match.classList.contains("session-native-model-effort") ? "effort" : "label", true));
      } else if (key === "access") {
        for (const match of element.querySelectorAll<HTMLElement>(":scope > span")) parts.push(part(match, "permission-label", true));
      } else for (const match of element.querySelectorAll<HTMLElement>(".session-native-submit-content")) parts.push(part(match, "submit-content", Boolean(match.textContent?.trim())));
      const icons = [...element.querySelectorAll<SVGSVGElement>("svg")];
      if (icons.length > 8) diagnostics.push("Control icon observation overflow");
      for (const icon of icons.slice(0, 8)) parts.push(part(icon, "icon", false));
      const inset = Math.min(5, r.width / 4, r.height / 4);
      const points = [{ name: "center", x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 },
        { name: "inset-left", x: r.left + inset, y: (r.top + r.bottom) / 2 },
        { name: "inset-right", x: r.right - inset, y: (r.top + r.bottom) / 2 },
        { name: "inset-top", x: (r.left + r.right) / 2, y: r.top + inset },
        { name: "inset-bottom", x: (r.left + r.right) / 2, y: r.bottom - inset }];
      const hits = points.map((point) => { const hit = document.elementFromPoint(point.x, point.y); return { ...point, rawHit: identify(hit),
        owned: Boolean(hit && (hit === element || element.contains(hit))), candidateControl: controlElements.find((entry) => Boolean(hit && (hit === entry.element || entry.element.contains(hit))))?.key ?? null }; });
      return { key, node: identify(element), rect: r, visible: physical(element), text: element.textContent, label: element.getAttribute("aria-label"),
        disabled: element instanceof HTMLButtonElement ? element.disabled : null, type: element.getAttribute("type"), parts, hits,
        css: { display: css.display, position: css.position, boxSizing: css.boxSizing, minWidth: css.minWidth, maxWidth: css.maxWidth,
          width: css.width, height: css.height, padding: css.padding, border: css.border, gridColumnStart: css.gridColumnStart,
          gridColumnEnd: css.gridColumnEnd, gridRowStart: css.gridRowStart, gridRowEnd: css.gridRowEnd,
          transform: css.transform, translate: css.getPropertyValue("translate"), scale: css.getPropertyValue("scale") } };
    });
    const footerStyle = getComputedStyle(footer);
    return { now: performance.now(), model, controls, diagnostics, canAssertBackgroundHits,
      overlays: overlays.map(identify), viewport, document: { clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth, bodyScrollWidth: document.body.scrollWidth },
      footer: { node: identify(footer), rect: box(footer), contentBox: contentBox(footer),
        directControlOrder: [...footer.children].filter((element) => controlElements.some((control) => control.element === element)).map((element) => controlElements.find((control) => control.element === element)?.key),
        css: { display: footerStyle.display, gridTemplateColumns: footerStyle.gridTemplateColumns,
          gridTemplateRows: footerStyle.gridTemplateRows, gap: footerStyle.gap, columnGap: footerStyle.columnGap,
          rowGap: footerStyle.rowGap, padding: footerStyle.padding, border: footerStyle.border, boxSizing: footerStyle.boxSizing,
          transform: footerStyle.transform, translate: footerStyle.getPropertyValue("translate") } } };
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
        followup: { mode: followup.useFollowupSettingsStore.getState().mode,
          enterBehavior: followup.useFollowupSettingsStore.getState().enterBehavior, reviewDelivery: followup.useFollowupSettingsStore.getState().reviewDelivery } };
    };
    let fixed: { turns: unknown; status: unknown; timing: unknown; followup: unknown } | null = (() => {
      const state = runtime.useCodexStore.getState();
      return { turns: state.threads.find((entry: { id: string }) => entry.id === "ux-0")?.turns,
        status: state.threadStatusMap["ux-0"], timing: state.turnTimingMap["ux-0"], followup: followup.useFollowupSettingsStore.getState() };
    })();
    let reads = 0;
    return { read: () => {
      if (!fixed || ++reads > 64) throw Error("Runtime protection reader disposed or overflowed");
      const state = runtime.useCodexStore.getState();
      return { reads, urls, value: JSON.parse(JSON.stringify(value())), same: {
        turns: state.threads.find((entry: { id: string }) => entry.id === "ux-0")?.turns === fixed.turns,
        status: state.threadStatusMap["ux-0"] === fixed.status, timing: state.turnTimingMap["ux-0"] === fixed.timing,
        followup: followup.useFollowupSettingsStore.getState() === fixed.followup } };
    }, dispose: () => { fixed = null; return { disposed: true, retained: false }; } };
  });
}

type FooterObservation = Awaited<ReturnType<typeof footerDOM>>;
type GeometryCheck = { phase: string; target: string; pass: boolean; actual: unknown; expected: unknown };
function geometryChecks(value: FooterObservation, phase: string, item: FooterCase, opening: FooterObservation | null): GeometryCheck[] {
  const checks: GeometryCheck[] = [], tolerance = 1;
  const add = (target: string, pass: boolean, actual: unknown, expected: unknown) => checks.push({ phase, target, pass, actual, expected });
  const inside = (a: { left: number; right: number; top: number; bottom: number }, b: { left: number; right: number; top: number; bottom: number }) =>
    a.left >= b.left - tolerance && a.right <= b.right + tolerance && a.top >= b.top - tolerance && a.bottom <= b.bottom + tolerance;
  add("page has no horizontal overflow", value.document.scrollWidth <= value.viewport.width + tolerance && value.document.bodyScrollWidth <= value.viewport.width + tolerance,
    value.document, { maximumWidth: value.viewport.width + tolerance });
  for (const control of value.controls) {
    add(control.key + " root in footer content/viewport", control.visible && control.rect.width > 0 && control.rect.height > 0 && inside(control.rect, value.footer.contentBox) && inside(control.rect, value.viewport),
      { rect: control.rect, footer: value.footer.contentBox, visible: control.visible }, "visible and contained (1px)");
    for (const part of control.parts) if (part.visible) {
      add(control.key + ":" + part.kind + " visible clipped paint in root", part.clipped.length > 0 && part.clipped.every((r) => inside(r, control.rect)),
        { raw: part.raw, clipped: part.clipped, root: control.rect, clips: part.clips }, "real clipped text/icon within own root; raw ellipsis Range may exceed");
      if (control.key === "access") add("permission text/icon is not cropped or hidden", part.raw.every((r) => inside(r, control.rect)) && inside(part.rect, control.rect),
        part, "full permission content inside its own button");
      if (part.icon) add(control.key + " SVG size is positive and inside own root", part.rect.width > 0 && part.rect.height > 0 && inside(part.rect, control.rect), part, "positive unscaled actual SVG");
    }
    if (value.canAssertBackgroundHits) add(control.key + " center and four interior hits", control.hits.every((hit) => hit.owned), control.hits, "same actual root or descendant");
  }
  for (let a = 0; a < value.controls.length; a++) for (let b = a + 1; b < value.controls.length; b++) {
    const first = value.controls[a], second = value.controls[b];
    const x = Math.min(first.rect.right, second.rect.right) - Math.max(first.rect.left, second.rect.left);
    const y = Math.min(first.rect.bottom, second.rect.bottom) - Math.max(first.rect.top, second.rect.top);
    add(first.key + "/" + second.key + " do not overlap", x <= tolerance || y <= tolerance, { x, y, first: first.rect, second: second.rect }, "intersection <=1px on at least one axis");
  }
  if (item.surface === "expanded") {
    const access = value.controls.find((control) => control.key === "access");
    add("expanded permission label remains visible", Boolean(access && access.parts.some((part) => part.kind === "permission-label" && part.visible && (part.text?.trim().length ?? 0) > 0)), access ?? null, "compact Access text visible");
    const send = value.controls.find((control) => control.key === "send");
    const sendText = send?.parts.filter((part) => part.kind === "submit-content") ?? [];
    const expectedSendText = item.running ? item.followupMode === "queue" ? "加入队列" : "引导当前任务" : "发送消息";
    add("expanded Send has its full nonempty source-derived text", sendText.length === 1 && sendText[0].text?.trim() === expectedSendText,
      sendText, expectedSendText);
    add("expanded Send full Range actually paints without clipping", Boolean(send && sendText.length === 1 && sendText[0].visible && sendText[0].textPaint?.allowed
      && sendText[0].textPaint.positiveRawRectCount > 0 && sendText[0].raw.filter((r) => r.width > 0 && r.height > 0).every((raw) =>
        inside(raw, send.rect) && inside(raw, value.footer.contentBox) && inside(raw, value.viewport)
        && sendText[0].clipped.some((clipped) => inside(raw, clipped)))),
      { root: send?.rect ?? null, textParts: sendText }, "all positive raw glyph Range rects retained by real clipping and inside button/footer/viewport (1px)");
  }
  const modelControl = value.controls.find((control) => control.key === "model");
  if (item.surface === "main" && item.width < 768) add("existing main110 cap", Boolean(modelControl && modelControl.rect.width <= 111 && value.model.button.maxWidth === "110px"), modelControl, "main max-width110px; 1px bound");
  const cap = resolveTriggerCap(value.model);
  add("phase-local cap is supported", cap.diagnostics.length === 0, cap, "complete CSS cap/track/content-box interpretation");
  if (cap.borderBoxCap !== null) add("model obeys phase-local border-box cap", Boolean(value.model.button.rect && value.model.button.rect.width <= cap.borderBoxCap + tolerance), { button: value.model.button.rect, cap }, "phase-local CSS border-box cap+1px");
  if (item.kind === "custom") {
    add("generic custom Trigger has its real flat adapter shape", value.model.content === null && value.model.measurement === null && value.model.placeholder === null && value.model.selectionSpanCount === 2,
      value.model, "flat model/effort/chevron; enhanced wrappers legitimately absent");
  } else {
    const content = value.model.content, measurement = value.model.measurement, placeholder = value.model.placeholder;
    add("ordinary enhanced wrapper/measurement exists", content !== null && measurement !== null, value.model, "ordinary content and hidden purpose measurement");
    if (content && measurement && placeholder && opening) {
      const currentWidth = opening.model.content?.width ?? null;
      const purposeWidth = measurement.width;
      const sourceMax = currentWidth === null ? null : Math.max(currentWidth, purposeWidth);
      add("simple-open pre-replacement width source exists", currentWidth !== null && currentWidth > 0 && purposeWidth > 0,
        { currentWidth, purposeWidth }, "actual same-surface closed content and hidden purpose widths");
      if (currentWidth !== null && sourceMax !== null) {
        add("simple-open intrinsic width winner", item.widthWinner === "current" ? currentWidth > purposeWidth : purposeWidth > currentWidth,
          { currentWidth, purposeWidth, declaredWinner: item.widthWinner }, "literal current-wider/purpose-wider source case");
        const openingCap = resolveTriggerCap(opening.model);
        const chrome = Math.max(0, (opening.model.button.rect?.width ?? currentWidth) - currentWidth);
        if (cap.kind === "percentage") {
          add("percentage cap uses shrinkable preferred source maximum", content.minWidth === "" && content.computedMinWidth === "0px" && Number(content.flexShrink) === 1
            && /^(?:\d+(?:\.\d*)?|\.\d+)px$/.test(content.preferredWidth) && Math.abs(Number.parseFloat(content.preferredWidth) - sourceMax) <= tolerance,
            { content, sourceMax, cap }, "preferred source maximum, min0 and original flex shrink");
          if (cap.contentBudget !== null) add("percentage content retains source or uses current available area", Math.abs(content.width - Math.min(sourceMax, cap.contentBudget)) <= tolerance,
            { content: content.width, sourceMax, available: cap.contentBudget }, "min(sourceMaximum,current used content budget) +/-1px");
          if (cap.cappedContentBudget !== null && cap.cappedContentBudget >= sourceMax - tolerance) add("source max retained when cap has room", content.width >= sourceMax - tolerance,
            { content: content.width, sourceMax, availableCap: cap.cappedContentBudget }, "source maximum retained, no stale opening-area clamp");
        } else if (cap.kind === "px" || cap.kind === "none") {
          const expectedMinimum = openingCap.borderBoxCap === null ? sourceMax : Math.min(sourceMax, Math.max(0, openingCap.borderBoxCap - chrome));
          add("px/none retain original numeric minimum", content.preferredWidth === "" && Math.abs(Number.parseFloat(content.minWidth) - expectedMinimum) <= tolerance && content.width >= expectedMinimum - tolerance,
            { content, sourceMax, expectedMinimum, chrome }, "existing E8 numeric min, no new sizing policy");
        }
      }
    }
    if (!placeholder && value.model.expanded === "false") add("close clears both temporary widths", content !== null && content.minWidth === "" && content.preferredWidth === "", content,
      "both cleared only after close; advanced is not a clear boundary");
  }
  return checks;
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

for (const scenario of cases) test.describe("E10 footer " + scenario.id, () => {
  test.use({ viewport: { width: scenario.width, height: scenario.width < 768 ? 844 : 900 },
    hasTouch: scenario.width < 768, isMobile: scenario.width < 768 });
  test("actual controls remain contained and separately hittable through readonly lifecycle", async ({ page }, info) => {
    const theme = scenario.width === 1440 ? "dark" : "light";
    const draft = "E10 retained draft " + scenario.id;
    const initialModel = scenario.kind === "custom" ? CUSTOM_MODEL : SOL;
    const initialProvider = scenario.kind === "custom" ? CUSTOM_PROVIDER : "openai";
    const catalog = [model(TERRA, TL, ["low"], "low", true), model(SOL, scenario.label, ["low", "medium", "high"], "medium", false)];
    const counts = [0, 0, 0, 0], directory: unknown[] = [], writes: unknown[] = [], api: unknown[] = [], external: unknown[] = [];
    const errors: string[] = [], consoleErrors: Array<{ text: string; url: string }> = [], cleanupErrors: string[] = [], screenshots: string[] = [];
    const targetChecks: GeometryCheck[] = [];
    const tabReceipts: Array<{ phase: string; tabs: number; focused: boolean; focusVisible: boolean }> = [];
    const completionReceipts: Array<{ before: Awaited<ReturnType<typeof readLifecycle>>; after: Awaited<ReturnType<typeof readLifecycle>>; menu: Awaited<ReturnType<typeof menuDOM>> }> = [];
    const setup = { timeoutMs: 5000, ringCapacity: 64, reads: 0, discarded: 0, matched: false,
      samples: [] as Array<{ read: number; now: number; currentThreadId: string | null; owner: string | null }> };
    let origin = "", phase = "setup", failure: string | null = null, hardControlsCompleted = false;
    let reader: Awaited<ReturnType<typeof createReader>> | null = null;
    let protection: Awaited<ReturnType<typeof createProtectionReader>> | null = null;
    let defaults: Awaited<ReturnType<typeof createDefaultObserver>> | null = null;
    let runtime: Awaited<ReturnType<typeof createRuntimeReader>> | null = null;
    let inputObserver: Awaited<ReturnType<typeof observe>> | null = null;
    let lifecycle: Awaited<ReturnType<typeof observeLifecycle>> | null = null;
    let stream: Awaited<ReturnType<typeof createFeedbackEventStream>> | null = null;
    let streamCleanup: Awaited<ReturnType<Awaited<ReturnType<typeof createFeedbackEventStream>>["close"]>> | null = null;
    let inputEvents: unknown = null, defaultReceipt: unknown = null, defaultCleanup: unknown = null;
    let lifecycleEvents: unknown = null, lifecycleCleanup: unknown = null, runtimeCleanup: unknown = null;
    let sourceBefore: ReturnType<typeof hashInputs> | null = null, sourceAfter: ReturnType<typeof hashInputs> | null = null;
    const main = page.locator(MAIN); let scope = main, trigger: Locator | null = null, menu: Locator | null = null;
    let mainHandles: SurfaceHandles | null = null, activeHandles: SurfaceHandles | null = null;
    const capturedHandles: SurfaceHandles[] = [];
    type State = {
      phase: string; value: Awaited<ReturnType<typeof read>>;
      identity: Awaited<ReturnType<typeof read>>;
      scope: Awaited<ReturnType<typeof inspectScope>>;
      dom: Awaited<ReturnType<typeof surfaceIdentity>>;
      publication: { reads: number; overflow: boolean; initialMode: unknown; mode: unknown; sameEnabled: boolean; enabled: unknown[]; moduleURLs: string[]; events: Record<string, unknown>[] };
      runtime: { reads: number; urls: string[]; value: unknown; same: { turns: boolean; status: boolean; timing: boolean; followup: boolean } };
      geometry: FooterObservation; menu: Awaited<ReturnType<typeof menuDOM>> | null;
      tooltip: Awaited<ReturnType<typeof tooltipDOM>> | null;
    };
    // Page-side readonly modules already have the proven helper shapes; the raw
    // JSON is retained as well as every actual ref equality in each phase.
    const states: State[] = [];
    let opening: FooterObservation | null = null, modelHintId: string | null = null;
    const record = async (name: string) => {
      if (!reader || !protection || !defaults || !runtime || !activeHandles || states.length >= 40) throw Error("Readonly probes missing or phase bound exceeded");
      phase = name;
      const row = { phase: name, value: await read(page, reader), identity: await protection.evaluate((probe) => probe.read()),
        scope: await inspectScope(scope), dom: await surfaceIdentity(scope, activeHandles),
        publication: await defaults.evaluate((probe) => probe.read()), runtime: await runtime.evaluate((probe) => probe.read()),
        geometry: await footerDOM(scope), menu: menu && await menu.count() ? await menuDOM(menu) : null,
        tooltip: trigger ? await tooltipDOM(trigger, modelHintId) : null };
      states.push(row); return row;
    };
    const shot = async (name: string) => { const path = info.outputPath(name + ".png"); await page.screenshot({ path, fullPage: true }); screenshots.push(path); };
    page.on("pageerror", (error) => errors.push(error.stack ?? String(error)));
    page.on("console", (message) => { if (message.type() === "error") consoleErrors.push({ text: message.text(), url: message.location().url }); });
    try {
      sourceBefore = hashInputs(); origin = new URL(String(info.project.use.baseURL)).origin;
      if (["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname)) throw Error("Explicit owned LAN frontend required");
      stream = await createFeedbackEventStream(origin);
      await page.addInitScript(({ theme, custom, ownerA, ownerB, mode, origin }) => {
        if (window !== window.top || location.origin !== origin) return;
        localStorage.setItem("kanban.session.native-model-picker-preferences", JSON.stringify({ state: { selectionMode: mode,
          enabledReasoningEfforts: ["low", "medium", "high", "xhigh", "ultra", "persistent"] }, version: 1 }));
        localStorage.setItem("kanban.session.theme-storage", JSON.stringify({ state: { theme }, version: 0 }));
        localStorage.setItem("kanban.session.model-settings", JSON.stringify({ state: { models: custom }, version: 2 }));
        localStorage.setItem("kanban.session.composer-v2", JSON.stringify({ [ownerA]: { contexts: [], drawings: {}, expanded: false, plain: true },
          [ownerB]: { contexts: [], drawings: {}, expanded: false, plain: false } }));
      }, { theme, custom: CUSTOM, ownerA: OWNER_A, ownerB: OWNER_B, mode: scenario.mode, origin });
      await page.route("**/*", async (route) => {
        const request = route.request();
        if (new URL(request.url()).origin !== origin || !["GET", "HEAD"].includes(request.method())) {
          external.push({ method: request.method(), url: request.url() }); await route.abort("blockedbyclient");
        } else await route.continue();
      });
      const fixture = await installSessionUxFixture(page, 2);
      if (scenario.running) {
        const initialThread = fixture.threads.find((thread) => thread.id === "ux-0");
        if (!initialThread) throw Error("Owned initial API thread missing");
        Object.assign(initialThread, { status: { type: "active", activeFlags: [] },
          turns: [{ id: "e10-initial-turn", status: "inProgress", startedAt: 1, durationMs: null, items: [] }] });
      }
      await page.route("**/api/**", async (route) => {
        const request = route.request(), url = new URL(request.url()), path = url.pathname;
        const entry = { method: request.method(), path, body: request.method() === "POST" ? request.postDataJSON() : null }; api.push(entry);
        if (url.origin !== origin) { external.push({ method: entry.method, url: request.url() }); await route.abort("blockedbyclient"); return; }
        if (path === "/api/session/api/events" && entry.method === "GET") {
          if (!stream) throw Error("Owned SSE missing"); await route.continue({ url: stream.url }); return;
        }
        const index = paths.findIndex((suffix) => path.endsWith(suffix));
        if (index >= 0) {
          directory.push(entry);
          const valid = path === "/api/session" + paths[index] && entry.method === (index === 0 ? "POST" : "GET") &&
            (index === 0 ? isDeepStrictEqual(entry.body, { cursor: null, limit: 100 }) : entry.body === null);
          if (!valid) { writes.push(entry); await route.fulfill({ status: 409, json: { error: "E10 catalog read contract mismatch" } }); return; }
          counts[index]++; await route.fulfill({ json: index === 0 ? { data: catalog, nextCursor: null } : [] }); return;
        }
        if (!["GET", "HEAD"].includes(entry.method) && !reads.has(path) && !bookkeeping.has(path)) {
          writes.push(entry); await route.fulfill({ status: 409, json: { error: "E10 unexpected mutation rejected" } }); return;
        }
        await route.fallback();
      });
      await page.goto("/?mode=session&view=agent", { waitUntil: "domcontentloaded" }); await main.locator(EDITOR).first().waitFor();
      // All synthetic model/running/preference/API state is initialized before
      // the first real UI input; no later setters, SSE events or chooser calls.
      await seedSessionUx(page, 2);
      const owners = await initializeJoint(page, { model: initialModel, effort: scenario.raw, serviceTier: "fast",
        provider: initialProvider, running: scenario.running, followupMode: scenario.followupMode });
      expect(owners.owner).toBe(OWNER_A); expect(owners.otherOwner).toBe(OWNER_B);
      reader = await createReader(page, owners); inputObserver = await observe(page);
      await expect.poll(async () => {
        if (!reader) throw Error("Initial readonly reader missing");
        const value = await read(page, reader); setup.reads++;
        if (setup.samples.length === setup.ringCapacity) { setup.samples.shift(); setup.discarded++; }
        setup.samples.push({ read: setup.reads, now: value.now, currentThreadId: value.currentThreadId, owner: value.owner });
        return { currentThreadId: value.currentThreadId, owner: value.owner };
      }, { timeout: setup.timeoutMs, intervals: [25, 50, 100] }).toEqual({ currentThreadId: "ux-0", owner: owners.owner }); setup.matched = true;
      await main.locator(EDITOR).first().fill(draft);
      await expect.poll(() => counts).toEqual([1, 1, 1, 1]);
      await expect.poll(async () => { if (!reader) throw Error("Reader missing"); return (await read(page, reader)).cache.loaded; }).toBe(true);
      await expect.poll(async () => { if (!reader) throw Error("Reader missing"); return (await read(page, reader)).eventStreamConnected; }).toBe(true);
      await settle(page);
      mainHandles = await captureSurface(main); activeHandles = mainHandles; capturedHandles.push(mainHandles);
      protection = await createProtectionReader(page); defaults = await createDefaultObserver(page); runtime = await createRuntimeReader(page);
      const baseline = await record("baseline-main"), initialRecent = await recent(page);
      const protect = async (row: typeof baseline, expanded: boolean) => {
        const value = row.value, first = baseline.value, identity = row.identity, firstIdentity = baseline.identity;
        expect(value.currentThreadId, row.phase).toBe("ux-0"); expect(value.owner, row.phase).toBe(owners.owner); expect(value.eventStreamConnected, row.phase).toBe(true);
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
        expect(row.scope.scopeKind, row.phase).toBe(expanded ? "expanded" : "main"); expect(row.scope.ownerAttribute, row.phase).toBe(expanded ? null : owners.owner); expect(row.scope.editorText, row.phase).toBe(draft);
        expect(row.dom, row.phase).toEqual({ scope: true, editor: true, trigger: true, sessionRoot: true, connected: true });
        expect(row.publication.sameEnabled, row.phase).toBe(true); expect(row.publication.overflow, row.phase).toBe(false);
        expect(row.publication.enabled, row.phase).toEqual(["low", "medium", "high", "xhigh", "ultra", "persistent"]); expect(row.publication.mode, row.phase).toBe(scenario.mode); expect(row.publication.events, row.phase).toEqual([]);
        expect(row.runtime.value, row.phase).toEqual(baseline.runtime.value); expect(row.runtime.same, row.phase).toEqual({ turns: true, status: true, timing: true, followup: true });
        expect(row.geometry.diagnostics, row.phase).toEqual([]); expect(resolveTriggerCap(row.geometry.model).diagnostics, row.phase + ": unsupported fixture cap").toEqual([]); expect(counts, row.phase).toEqual([1, 1, 1, 1]); expect(writes, row.phase).toEqual([]); expect(external, row.phase).toEqual([]); expect(errors, row.phase).toEqual([]);
        expect(await recent(page), row.phase).toEqual(initialRecent);
      };
      await protect(baseline, false);
      expect(baseline.value.entry).toMatchObject({ model: initialModel, modelProvider: initialProvider, reasoningEffort: scenario.raw, revision: 4,
        pending: false, pendingFields: [], serviceTier: "fast", providerModels: { [initialProvider]: initialModel } });
      expect(baseline.runtime.value).toMatchObject({ followup: { mode: scenario.followupMode } });
      if (scenario.running) expect(baseline.runtime.value).toMatchObject({ currentThreadId: "ux-0", currentTurnId: "e10-initial-turn",
        status: { type: "active" }, timing: { turnId: "e10-initial-turn", status: "inProgress" }, turns: [{ id: "e10-initial-turn", status: "inProgress" }] });
      else expect(baseline.runtime.value).toMatchObject({ currentTurnId: null });
      const captureGeometry = (row: typeof baseline, item = scenario) => {
        if (targetChecks.length > 4096) throw Error("Bounded geometry check capacity exceeded");
        targetChecks.push(...geometryChecks(row.geometry, row.phase, item, opening));
      };
      if (scenario.surface === "main") captureGeometry(baseline);
      if (scenario.otherSheet) {
        await main.getByRole("button", { name: "附加文件", exact: true }).click();
        await page.getByRole("button", { name: "输入状态与消息队列", exact: true }).click();
        const other = page.locator(".session-mode .session-composer-sheet:not(.is-full)"); await expect(other).toHaveCount(1); await expect(other).toBeVisible();
        expect(await other.locator(":scope > footer").count()).toBe(0);
        const background = await record("other-real-nonfull-sheet"); await protect(background, false); expect(background.geometry.canAssertBackgroundHits).toBe(false);
        await other.getByRole("button", { name: "关闭面板", exact: true }).click(); await other.waitFor({ state: "detached" });
        await expect(main.locator(EDITOR).first()).toBeFocused(); await settle(page);
        const returned = await record("returned-from-other-sheet"); await protect(returned, false); captureGeometry(returned);
      }
      if (scenario.surface === "expanded") {
        await main.getByRole("button", { name: "附加文件", exact: true }).click(); await page.getByRole("button", { name: "展开编辑", exact: true }).click();
        scope = page.locator(".session-mode .session-composer-sheet.is-full"); await expect(scope).toHaveCount(1); await expect(scope).toBeVisible();
        await expect.poll(() => scope.locator(EDITOR).first().evaluate((node) => node instanceof HTMLTextAreaElement ? node.value : node.textContent)).toBe(draft);
        activeHandles = await captureSurface(scope); capturedHandles.push(activeHandles);
      }
      trigger = scope.locator(".session-native-model-trigger"); await expect(trigger).toBeVisible(); await expect(trigger).toBeEnabled();
      await scope.locator(EDITOR).first().click(); await expect(scope.locator(EDITOR).first()).toBeFocused();
      lifecycle = await observeLifecycle(trigger);
      const park = async () => {
        if (!trigger || !lifecycle) throw Error("Own parked input observation missing");
        const rect = await trigger.evaluate((node) => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: innerWidth, height: innerHeight }; });
        expect(rect.top).toBeGreaterThan(24); expect(rect.width).toBeGreaterThan(16); expect(rect.height).toBeGreaterThan(16);
        const before = (await readLifecycle(lifecycle)).events.length;
        await page.mouse.move(16, 16); await settle(page); await page.mouse.move(8, 8);
        const moved = (await readLifecycle(lifecycle)).events.slice(before).filter((event) => event.type === "pointermove");
        expect(moved.map(({ x, y, trusted, pointerType, insideTrigger }) => ({ x, y, trusted, pointerType, insideTrigger }))).toEqual([
          { x: 16, y: 16, trusted: true, pointerType: "mouse", insideTrigger: false }, { x: 8, y: 8, trusted: true, pointerType: "mouse", insideTrigger: false }]);
      };
      await park(); await settle(page);
      const closed = await record("closed-before"); await protect(closed, scenario.surface === "expanded"); opening = closed.geometry; captureGeometry(closed);
      const expectedKeys = scenario.running ? ["access", "model", "stop", "send"] : ["access", "model", "send"];
      expect(closed.geometry.controls.map((control) => control.key)).toEqual(expectedKeys);
      if (scenario.surface === "expanded") expect(closed.geometry.footer.directControlOrder).toEqual(expectedKeys);
      const send = closed.geometry.controls.find((control) => control.key === "send"), stop = closed.geometry.controls.find((control) => control.key === "stop");
      if (!send) throw Error("Actual Send control absent");
      expect(send.disabled).toBe(false); expect(send.label).toBe(scenario.running ? scenario.followupMode === "queue" ? "加入队列" : "引导当前任务" : "发送消息");
      if (scenario.running) { if (!stop) throw Error("Actual running Stop control absent"); expect(stop.disabled).toBe(false); expect(stop.label).toBe("停止生成"); }
      await shot("closed-before");
      const closedName = "模型：" + initialModel + "，medium";
      await expect(trigger).toHaveAccessibleName(closedName);
      // Permission remains naturally reachable. Open/close only, never choose a
      // permission, Full Access, approval, Stop or Send operation.
      const access = scope.getByRole("button", { name: "执行权限：请求批准", exact: true });
      let accessTabs = 0;
      while (!(await access.evaluate((node) => node === document.activeElement)) && accessTabs < 20) { await page.keyboard.press("Tab"); accessTabs++; }
      expect(accessTabs).toBeGreaterThan(0); expect(accessTabs).toBeLessThanOrEqual(20); await expect(access).toBeFocused();
      await page.keyboard.press("Enter"); const permissionMenu = page.locator(".session-native-permission-menu").filter({ visible: true }); await expect(permissionMenu).toHaveCount(1); await settle(page);
      const permission = await record("permission-open-readonly"); await protect(permission, scenario.surface === "expanded"); captureGeometry(permission); expect(permission.geometry.canAssertBackgroundHits).toBe(false);
      await page.keyboard.press("Escape"); await permissionMenu.waitFor({ state: "detached" });
      // Real editor click supplies the normal keyboard starting point; it is
      // not a rescue after a failed completion/focus assertion.
      await scope.locator(EDITOR).first().click(); await expect(scope.locator(EDITOR).first()).toBeFocused(); await park();
      const permissionClosed = await record("permission-closed"); await protect(permissionClosed, scenario.surface === "expanded"); captureGeometry(permissionClosed);
      await tabToTrigger(page, trigger, tabReceipts, "editor -> actual model Trigger");
      if (scenario.kind !== "custom") {
        await expect(trigger).toHaveAttribute("aria-describedby", /\S/);
        const hint = await tooltipDOM(trigger); expect(hint.overflow).toBe(false); expect(hint.descriptions).toHaveLength(1);
        const nativeId = hint.descriptions[0];
        if (!nativeId || !nativeId.id || nativeId.role !== "tooltip") throw Error("Initial model hint native id not captured"); modelHintId = nativeId.id;
        const positive = await record("positive-closed-hint"); await protect(positive, scenario.surface === "expanded"); captureGeometry(positive);
        expect(positive.tooltip?.model).toMatchObject({ id: modelHintId, nativeIdCount: 1, contentCount: 1, visibleLabels: [scenario.purpose] });
      }
      await page.keyboard.press("Enter"); menu = page.locator(".session-native-model-menu").filter({ visible: true }); await expect(menu).toHaveCount(1); await settle(page);
      const opened = await record("simple-open"); await protect(opened, scenario.surface === "expanded"); captureGeometry(opened);
      expect(opened.geometry.canAssertBackgroundHits).toBe(false);
      if (scenario.kind === "custom") {
        // Generic/custom uses its own actual legacy menu. No enhanced wrapper,
        // native Power purpose, or native preset-count expectation is invented.
        expect(opened.geometry.model.content).toBeNull(); expect(opened.geometry.model.placeholder).toBeNull();
        await shot("custom-menu-open");
        await page.keyboard.press("Escape"); await menu.waitFor({ state: "detached" }); menu = null;
        await expect(scope.locator(EDITOR).first()).toBeFocused(); await settle(page);
        const escaped = await record("custom-escaped"); await protect(escaped, true); captureGeometry(escaped); await expect(trigger).toHaveAccessibleName(closedName);
      } else {
        expect(capturedMenu(opened)).toMatchObject({ connected: true, view: "simple", caption: "选择模型" });
        expect(capturedMenu(opened).dots).toHaveLength(scenario.mode === "default" ? 4 : 3);
        expect(capturedMenu(opened).status).toContain(scenario.mode === "default" ? "第 3 项，共 4 项" : "第 2 项，共 3 项");
        expect(opened.geometry.model.aria).toBeNull(); expect(opened.geometry.model.labelledby).toBeNull(); expect(opened.geometry.model.selectionSpanCount).toBe(0);
        expect(opened.geometry.model.placeholder?.text).toBe(scenario.purpose);
        await shot("simple-open");
        const caption = menu.getByRole("menuitem", { name: "选择模型", exact: true }); await expect(caption).toBeEnabled();
        if (await menu.evaluate((node) => node === document.activeElement)) await page.keyboard.press("ArrowDown");
        await expect(caption).toBeFocused(); await caption.click(); await settle(page);
        const advanced = await record("advanced-open"); await protect(advanced, scenario.surface === "expanded"); captureGeometry(advanced);
        expect(capturedMenu(advanced).view).toBe("advanced"); expect(advanced.geometry.model.aria).toBe(closedName); expect(advanced.geometry.model.placeholder).toBeNull();
        expect(capturedMenu(advanced).radios.some((row) => row.checked === "true")).toBe(true); await shot("advanced-open");
        // Advanced alone restores the raw subtree, but does not clear temporary
        // width. Only actual close is the existing width-release boundary.
        await page.keyboard.press("Escape"); await menu.waitFor({ state: "detached" }); menu = null;
        await expect(scope.locator(EDITOR).first()).toBeFocused(); await settle(page);
        const escaped = await record("advanced-escaped"); await protect(escaped, scenario.surface === "expanded"); captureGeometry(escaped);
        expect(escaped.geometry.model.content?.minWidth).toBe(""); expect(escaped.geometry.model.content?.preferredWidth).toBe("");
        await page.waitForTimeout(360);
        const reset = await record("after-original350ms-reset"); await protect(reset, scenario.surface === "expanded"); captureGeometry(reset);
        expect(reset.value.now - escaped.value.now).toBeGreaterThan(350);
        if (scenario.kind === "core") {
          await park(); await tabToTrigger(page, trigger, tabReceipts, "advanced reset editor -> Trigger");
          const reopenedSource = await record("before-reopen"); await protect(reopenedSource, scenario.surface === "expanded"); opening = reopenedSource.geometry;
          await page.keyboard.press("Enter"); menu = page.locator(".session-native-model-menu").filter({ visible: true }); await expect(menu).toHaveCount(1); await settle(page);
          const reopened = await record("returned-simple"); await protect(reopened, scenario.surface === "expanded"); captureGeometry(reopened);
          expect(capturedMenu(reopened)).toMatchObject({ view: "simple", caption: "选择模型" });
          const newCaption = menu.getByRole("menuitem", { name: "选择模型", exact: true }); await expect(newCaption).toBeEnabled();
          if (await menu.evaluate((node) => node === document.activeElement)) await page.keyboard.press("ArrowDown"); await expect(newCaption).toBeFocused();
          const power = menu.getByRole("menuitem", { name: "强度", exact: true }); await expect(power).toBeEnabled();
          let tabs = 0; while (!(await power.evaluate((node) => node === document.activeElement)) && tabs < 4) { await page.keyboard.press("Tab"); tabs++; }
          expect(tabs).toBeGreaterThan(0); expect(tabs).toBeLessThanOrEqual(4); await expect(power).toBeFocused();
          if (!lifecycle) throw Error("Actual lifecycle observer missing");
          const before = await readLifecycle(lifecycle), beforeMenu = await menuDOM(menu);
          expect(before.active).toMatchObject({ trigger: false, kind: "power", hasFocus: true }); expect(actualTriggerBlurs(before)).toBeGreaterThan(0);
          await page.keyboard.press("Enter"); await menu.waitFor({ state: "detached" }); menu = null;
          await expect(scope.locator(EDITOR).first()).toBeFocused(); await settle(page);
          const after = await readLifecycle(lifecycle);
          expect(after.active).toMatchObject({ editor: true, trigger: false, hasFocus: true }); expect(actualTriggerBlurs(after)).toBe(actualTriggerBlurs(before));
          const delivered = after.events.slice(before.events.length).filter((event) => event.type === "keydown" && event.key === "Enter");
          expect(delivered).toHaveLength(1); expect(delivered[0]).toMatchObject({ trusted: true, isPower: true, inModelMenu: true, code: "Enter", repeat: false });
          completionReceipts.push({ before, after, menu: beforeMenu });
          const completed = await record("power-Enter-completed"); await protect(completed, scenario.surface === "expanded"); captureGeometry(completed);
          const keyboardStart = after.events.length, startLeaves = actualTriggerLeaves(after).length;
          await tabToTrigger(page, trigger, tabReceipts, "Power completion -> held Trigger"); await settle(page);
          const held = await record("held-on-natural-Trigger-focus"); await protect(held, scenario.surface === "expanded"); captureGeometry(held);
          expect(held.tooltip?.model).toMatchObject({ id: modelHintId, visibleLabels: [] });
          await page.waitForTimeout(360);
          const held350 = await record("held-after-independent350ms"); await protect(held350, scenario.surface === "expanded"); captureGeometry(held350);
          expect(held350.value.now - held.value.now).toBeGreaterThan(350); expect(held350.tooltip?.model).toMatchObject({ id: modelHintId, visibleLabels: [] }); await shot("held-after350ms");
          const blurs = actualTriggerBlurs(await readLifecycle(lifecycle));
          await page.keyboard.press("Tab"); expect((await focusSnapshot(trigger)).trigger).toBe(false);
          expect(actualTriggerBlurs(await readLifecycle(lifecycle))).toBe(blurs + 1);
          await page.keyboard.press("Shift+Tab"); await expect(trigger).toBeFocused(); await settle(page);
          const skipped = await record("first-real-blur-consumed"); await protect(skipped, scenario.surface === "expanded"); captureGeometry(skipped); expect(skipped.tooltip?.model).toMatchObject({ id: modelHintId, visibleLabels: [] });
          await page.keyboard.press("Tab"); expect((await focusSnapshot(trigger)).trigger).toBe(false);
          expect(actualTriggerBlurs(await readLifecycle(lifecycle))).toBe(blurs + 2);
          await page.keyboard.press("Shift+Tab"); await expect(trigger).toBeFocused(); await settle(page);
          const released = await record("second-real-blur-released-hint"); await protect(released, scenario.surface === "expanded"); captureGeometry(released);
          expect(released.tooltip?.model).toMatchObject({ id: modelHintId, nativeIdCount: 1, contentCount: 1, visibleLabels: [scenario.purpose] }); await shot("restored-hint");
          const trace = await readLifecycle(lifecycle);
          expect(actualTriggerLeaves(trace).length).toBe(startLeaves);
          expect(trace.events.slice(keyboardStart).filter((event) => ["pointermove", "pointerdown", "click"].includes(event.type))).toEqual([]);
          await page.keyboard.press("Enter"); menu = page.locator(".session-native-model-menu").filter({ visible: true }); await expect(menu).toHaveCount(1);
          await page.keyboard.press("Escape"); await menu.waitFor({ state: "detached" }); menu = null; await expect(scope.locator(EDITOR).first()).toBeFocused(); await settle(page);
          const finalClosed = await record("core-final-closed"); await protect(finalClosed, scenario.surface === "expanded"); captureGeometry(finalClosed); await expect(trigger).toHaveAccessibleName(closedName);
        }
      }
      if (scenario.surface === "expanded") {
        const lastExpanded = await record("before-keep-draft-return"); await protect(lastExpanded, true); captureGeometry(lastExpanded); await shot("expanded-final");
        await page.getByRole("button", { name: "返回并保留草稿", exact: true }).click(); await scope.waitFor({ state: "detached" });
        if (!mainHandles) throw Error("Original main DOM handles missing"); scope = main; activeHandles = mainHandles; trigger = null;
        await expect(main.locator(EDITOR).first()).toBeFocused(); await settle(page);
      }
      const final = await record("final-main"); await protect(final, false);
      if (scenario.surface === "main") captureGeometry(final);
      expect(final.dom).toEqual({ scope: true, editor: true, trigger: true, sessionRoot: true, connected: true });
      expect(consoleErrors.filter((entry) => !(entry.url === origin + "/@vite/client" && entry.text.startsWith("[vite] failed to connect to websocket.")))).toEqual([]);
      if (!inputObserver || !lifecycle) throw Error("Actual input observers missing at final controls");
      const observed = await inputObserver.evaluate((probe) => probe.read()), trace = await readLifecycle(lifecycle);
      expect(observed.overflow).toBe(false); expect(observed.events.filter((event) => event.type === "submit")).toEqual([]);
      expect(observed.events.filter((event) => event.type === "click" || event.type === "keydown").every((event) => event.trusted)).toBe(true);
      expect(observed.events.filter((event) => event.type === "click" && event.role === "menuitemradio")).toEqual([]);
      expect(observed.events.filter((event) => event.type === "click" && /停止生成|发送消息|加入队列|引导当前任务/.test(String(event.label ?? "")))).toEqual([]);
      expect(trace.overflow).toBe(false); expect(trace.subscribed).toBe(true); expect(trace.events.every((event) => event.trusted)).toBe(true);
      expect(trace.events.filter((event) => event.type === "keydown" && event.key === "Enter" && event.isPower)).toHaveLength(scenario.kind === "core" ? 1 : 0);
      expect(completionReceipts).toHaveLength(scenario.kind === "core" ? 1 : 0);
      expect(targetChecks.length).toBeGreaterThan(0); expect(targetChecks.length).toBeLessThanOrEqual(4096);
      await shot("final-main"); hardControlsCompleted = true;
    } catch (error) { failure = String(error); throw error; }
    finally {
      const assertionErrors = info.errors.map((error) => error.message ?? String(error.value ?? "Unknown test error")); if (!failure && assertionErrors.length) failure = assertionErrors[0];
      if (reader && protection && defaults && runtime && activeHandles && !page.isClosed()) {
        try { await record("finally"); } catch (error) { cleanupErrors.push(String(error)); }
      }
      if (!page.isClosed()) { try { await shot("finally"); } catch (error) { cleanupErrors.push(String(error)); } }
      if (lifecycle) { try {
        lifecycleEvents = await readLifecycle(lifecycle); lifecycleCleanup = await lifecycle.evaluate((probe) => probe.dispose());
        const receipt = lifecycleCleanup as { disposed?: boolean; subscribed?: boolean; retainedNodes?: boolean; overflow?: boolean };
        if (!receipt.disposed || receipt.subscribed !== false || receipt.retainedNodes !== false || receipt.overflow) cleanupErrors.push("Lifecycle observer did not fully release");
        await lifecycle.dispose();
      } catch (error) { cleanupErrors.push(String(error)); } }
      if (inputObserver) { try {
        const finalInput = await inputObserver.evaluate((probe) => probe.read()); inputEvents = finalInput;
        if (finalInput.overflow || finalInput.events.some((event) => event.type === "submit" || ((event.type === "click" || event.type === "keydown") && !event.trusted))) cleanupErrors.push("Late input overflow/untrusted/submit event");
        await inputObserver.evaluate((probe) => probe.dispose()); await inputObserver.dispose();
      } catch (error) { cleanupErrors.push(String(error)); } }
      if (defaults) { try {
        const lastPublication = await defaults.evaluate((probe) => probe.read()); defaultReceipt = lastPublication;
        if (lastPublication.overflow || lastPublication.events.length || !lastPublication.sameEnabled || lastPublication.mode !== scenario.mode
          || !isDeepStrictEqual(lastPublication.enabled, ["low", "medium", "high", "xhigh", "ultra", "persistent"])) cleanupErrors.push("Late Default/publication protection failed");
        defaultCleanup = await defaults.evaluate((probe) => probe.dispose());
        if (!(defaultCleanup as { disposed?: boolean }).disposed || (defaultCleanup as { subscribed?: boolean }).subscribed !== false) cleanupErrors.push("Default subscriptions did not release");
        await defaults.dispose();
      } catch (error) { cleanupErrors.push(String(error)); } }
      if (runtime) { try { runtimeCleanup = await runtime.evaluate((probe) => probe.dispose());
        if (!(runtimeCleanup as { disposed?: boolean }).disposed || (runtimeCleanup as { retained?: boolean }).retained !== false) cleanupErrors.push("Runtime reader retained state");
        await runtime.dispose();
      } catch (error) { cleanupErrors.push(String(error)); } }
      if (protection) { try { await protection.evaluate((probe) => probe.dispose()); await protection.dispose(); } catch (error) { cleanupErrors.push(String(error)); } }
      if (reader) { try { await reader.dispose(); } catch (error) { cleanupErrors.push(String(error)); } }
      for (const handles of capturedHandles) for (const handle of Object.values(handles)) {
        try { await handle.dispose(); } catch (error) { cleanupErrors.push(String(error)); }
      }
      capturedHandles.length = 0; mainHandles = null; activeHandles = null;
      try { sourceAfter = hashInputs(); if (!isDeepStrictEqual(sourceAfter, sourceBefore)) cleanupErrors.push("E10 source input drift"); } catch (error) { cleanupErrors.push(String(error)); }
      // Probes and retained DOM are released first. Owner-end the real stream
      // while its browser is still connected; capture server finish/close/EOF,
      // then close this page promptly. No client-consumed-EOF/event claim.
      if (stream) { try {
        const closed = await stream.close(); streamCleanup = closed;
        if (!closed.closed || closed.listening || !closed.addressCleared || closed.activeResponses || closed.activeSockets || closed.serverErrorCount || closed.requestOverflow || closed.errors.length
          || closed.acceptedRequests !== 1 || closed.responseFinishCount !== 1 || closed.responseCloseCount !== 1 || closed.ownerEofCount !== 1
          || closed.connections.length !== 1 || closed.connections.some((connection) => connection.closedAtMs === null || connection.finishedAtMs === null || connection.ownerEndedAtMs === null || connection.writeErrors !== 0))
          cleanupErrors.push("Owned SSE accepted/owner-ended/finish/close/EOF contract not fully closed");
      } catch (error) { cleanupErrors.push(String(error)); } }
      try { await page.close(); } catch (error) { cleanupErrors.push(String(error)); }
      const cleanupOnlyFailure = cleanupErrors.length > 0 && !failure;
      if (cleanupOnlyFailure) failure = "Cleanup failure: " + cleanupErrors.join("; ");
      if (!failure && hardControlsCompleted && targetChecks.some((check) => !check.pass)) failure = "Late footer geometry target mismatch; all hard controls and cleanup reached";
      const path = info.outputPath("sheet-footer.json");
      writeFileSync(path, JSON.stringify({ caseId: scenario.id, scenario, theme, origin, phase, failure, assertionErrors, setup,
        fixture: { initialModel, initialProvider, rawEffort: scenario.raw, initialTier: "fast", initialMode: scenario.mode,
          initialRunning: scenario.running, followupMode: scenario.followupMode, catalog, custom: CUSTOM },
        states, targetChecks, hardControlsCompleted, completionReceipts, tabReceipts, modelHintId,
        counts, directory, api, writes, external, errors, consoleErrors, inputEvents, lifecycleEvents, lifecycleCleanup,
        defaultReceipt, defaultCleanup, runtimeCleanup, screenshots, cleanupErrors, streamCleanup, sourceBefore, sourceAfter,
        boundary: "Nineteen synthetic owned fixture cases:12 ordinary model/Default main/fullSheet at320/390/1440;5 initial-running fullSheet controls and2 custom-provider fullSheet mobile controls. One real non-full Sheet is a separate phase of the desktop main model case. Running state and matching API snapshot/preference are seeded only before baseline; SSE connection/owner EOF never claims a turn event or client-consumed EOF. All geometry is one passive evaluate frame per phase: actual CSS tracks/clip intersections/control roots/SVG/hits, original1px bounds and actual current containing-block cap. Main/Sheet actualDOM identities and logicalowner/rawA/B/default/custom/FI/visible-enabled/recent/cache/drafts are hard; geometry failures are asserted only after all hard guards, owned-probe/DOM release, source equality and accepted+finish+close+ownerEOF SSE cleanup. Generic custom flat Trigger legitimately lacks enhanced measurement/content. No forced events/focus/style, geometry polling, stop/send/permission grant/model action, native GUI/auth/RPC/CAS, physical-device, full zoom, longRSS or wholeGoal completion claim." }, null, 2) + "\n");
      await info.attach("sheet-footer", { path, contentType: "application/json" });
      if (cleanupOnlyFailure) throw Error("Owned fixture cleanup failed: " + cleanupErrors.join("; "));
    }
    expect(hardControlsCompleted).toBe(true); expect(cleanupErrors).toEqual([]); expect(sourceAfter).toEqual(sourceBefore);
    expect(counts).toEqual([1, 1, 1, 1]); expect(writes).toEqual([]); expect(external).toEqual([]); expect(errors).toEqual([]);
    expect(consoleErrors.filter((entry) => !(entry.url === origin + "/@vite/client" && entry.text.startsWith("[vite] failed to connect to websocket.")))).toEqual([]);
    expect(targetChecks.length).toBeGreaterThan(0);
    for (const check of targetChecks) expect.soft(check.pass, check.phase + ": " + check.target + " actual=" + JSON.stringify(check.actual)).toBe(true);
  });
});
