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
  { id: "model-current-wider", raw: null, mode: "model", label: "A deliberately wide current model label", purpose: "选择强度", widthWinner: "current" },
  { id: "default-placeholder-wider", raw: null, mode: "default", label: "S", purpose: "选择模型", widthWinner: "placeholder" },
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
function assertProtected(value: any, baseline: any, identity: any, firstIdentity: any, owner: string, draft: string, expanded: boolean, catalog: Model[], expected: { model: string; reasoningEffort: string | null; revision: number; changed: boolean }) {
  expect(value.currentThreadId).toBe("ux-0"); expect(value.owner).toBe(owner); expect(value.eventStreamConnected).toBe(true);
  expect(value.defaults).toEqual(baseline.defaults); expect(value.drafts).toEqual(baseline.drafts); expect(value.allThreads["ux-1"]).toEqual(baseline.allThreads["ux-1"]); expect(value.editorText).toBe(draft);
  expect(value.cache).toMatchObject({ loaded: true, loading: false, error: null, modelStatus: "success", hasModelSnapshot: true });
  expect(value.cache.models).toEqual(catalog); expect(value.cacheIdentity).toEqual({ captured: true, array: true, models: true, efforts: true });
  const stable = (entry: any) => { const { model, providerModels, notice, reasoningEffort, revision, pending, pendingFields, ...rest } = entry; return rest; };
  expect(stable(value.entry)).toEqual(stable(baseline.entry)); expect(identity.oldAUnchanged).toBe(true);
  expect(value.entry).toMatchObject({ model: expected.model, reasoningEffort: expected.reasoningEffort, serviceTier: "fast", revision: expected.revision });
  expect(value.settings).toMatchObject({ model: expected.model, reasoningEffort: expected.reasoningEffort, serviceTier: "fast" });
  expect(value.entry.providerModels).toEqual({ ...baseline.entry.providerModels, openai: expected.model });
  expect(identity.same.a).toBe(!expected.changed);
  if (!expected.changed) expect(value.entry).toEqual(baseline.entry);
  else { expect(value.entry.pending).toBe(true); expect(value.entry.pendingFields).toEqual(expect.arrayContaining(["model", "reasoningEffort"])); expect(value.entry.pendingFields).not.toContain("serviceTier"); }
  expect({ ...identity.same, a: true }).toEqual({ a: true, b: true, defaults: true, custom: true, text: true, cache: true, richB: true, richContexts: true, richDrawings: true });
  expect(identity.b).toEqual(firstIdentity.b); expect(identity.defaults).toEqual(firstIdentity.defaults); expect(identity.custom).toEqual(CUSTOM); expect(identity.text).toEqual(firstIdentity.text);
  expect(identity.rich.a).toEqual({ ...firstIdentity.rich.a, expanded }); expect(identity.rich.b).toEqual(firstIdentity.rich.b); expect(identity.rich.others).toEqual(firstIdentity.rich.others); expect(identity.rich.error).toBeNull();
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
async function tooltipDOM(trigger: Locator) {
  return trigger.evaluate((button) => {
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
    return { overflow: all.length > 8 || ids.length > 8,
      contents: all.slice(0, 8).map((content) => {
        const label = content.querySelector<HTMLElement>(":scope > .session-native-composer-tooltip-label");
        return { state: content.dataset.state ?? null, visible: physical(content), labelVisible: physical(label), label: label?.textContent ?? null,
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
  });
}
async function readAwayGeometry(trigger: Locator) {
  return trigger.evaluate((button) => {
    const box = (node: Element) => { const rect = node.getBoundingClientRect(); return {
      left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
    };
    const contents = [...button.ownerDocument.querySelectorAll<HTMLElement>('.session-native-composer-tooltip[data-slot="tooltip-content"]')].filter((node) => {
      const rect = node.getBoundingClientRect(), style = getComputedStyle(node);
      return node.isConnected && !node.closest("[hidden],[inert]") && node.getClientRects().length > 0 && rect.width > 0 && rect.height > 0 &&
        style.display !== "none" && style.visibility !== "hidden" && style.visibility !== "collapse";
    });
    if (contents.length !== 1) throw Error("Away-move fixture requires exactly one visible Tooltip Content");
    return { button: box(button), tooltip: box(contents[0]), viewport: { width: innerWidth, height: innerHeight } };
  });
}
async function observeTooltipInput(trigger: Locator) {
  return trigger.evaluateHandle((button) => {
    let held: Element | null = button, subscribed = true, overflow = false;
    const doc = button.ownerDocument, events: Array<{ type: string; trusted: boolean; pointerType: string | null; now: number }> = [];
    const awayMoves: Array<{ x: number; y: number; now: number; trusted: boolean; pointerType: string; insideTrigger: boolean; insideTooltip: boolean }> = [];
    let awayOverflow = false;
    const types = ["pointerover", "pointermove", "focusin", "pointerleave"];
    const listener = (event: Event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (event instanceof PointerEvent && event.type === "pointermove" &&
          ((event.clientX === 16 && event.clientY === 16) || (event.clientX === 8 && event.clientY === 8))) {
        if (awayMoves.length >= 8) awayOverflow = true;
        else awayMoves.push({ x: event.clientX, y: event.clientY, now: performance.now(), trusted: event.isTrusted,
          pointerType: event.pointerType, insideTrigger: held?.contains(target) ?? false,
          insideTooltip: Boolean(target?.closest('.session-native-composer-tooltip[data-slot="tooltip-content"]')) });
      }
      if (!held || target?.closest(".session-native-model-trigger") !== held) return;
      if (events.length >= 64) { overflow = true; return; }
      events.push({ type: event.type, trusted: event.isTrusted,
        pointerType: event instanceof PointerEvent ? event.pointerType : null, now: performance.now() });
    };
    types.forEach((type) => doc.addEventListener(type, listener, true));
    return { read: () => ({ subscribed, overflow, events: events.map((event) => ({ ...event })),
      awayOverflow, awayMoves: awayMoves.map((event) => ({ ...event })) }), dispose: () => {
      types.forEach((type) => doc.removeEventListener(type, listener, true)); subscribed = false; held = null;
      return { disposed: true, subscribed, retainedNode: held !== null };
    } };
  });
}
test.setTimeout(30_000);
for (const scenario of scenarios) for (const width of [1440, 390]) test.describe("E9a tooltip " + scenario.id + " " + width, () => {
  test.use({ viewport: { width, height: width === 390 ? 844 : 900 }, hasTouch: width === 390, isMobile: width === 390 });
  for (const surface of ["main", "expanded"] as const) test(surface + " closed effective tooltip purpose with actual-open suppression and raw protections", async ({ page }, info) => {
    const theme = width === 1440 ? "dark" : "light", draft = "E9a retained draft " + scenario.id + " " + width + " " + surface;
    const catalog = [model(TERRA, TL, ["low"], "low", true), model(SOL, scenario.label, ["low", "medium", "high"], "medium", false)];
    const counts = [0, 0, 0, 0]; const directory: unknown[] = [], writes: unknown[] = [], api: unknown[] = [], external: unknown[] = [];
    const errors: string[] = [], consoleErrors: Array<{ text: string; url: string }> = [], cleanupErrors: string[] = [], screenshots: string[] = [];
    const states: Array<{ phase: string; value: any; identity: any; scope: any; publication: any; menu: Awaited<ReturnType<typeof menuDOM>> | null; trigger: Awaited<ReturnType<typeof triggerDOM>> | null; sameTrigger: boolean | null; tooltip: Awaited<ReturnType<typeof tooltipDOM>> | null }> = [];
    const tooltipChecks: Array<{ phase: string; kind: "wording" | "open-hidden"; expected: string[]; actual: Array<string | null>; pass: boolean }> = [];
    const awayReceipts: Array<{ phase: string; geometry: Awaited<ReturnType<typeof readAwayGeometry>>; beforeLength: number; afterLength: number;
      events: Array<{ x: number; y: number; now: number; trusted: boolean; pointerType: string; insideTrigger: boolean; insideTooltip: boolean }> }> = [];
    let hardControlsCompleted = false, tooltipInputEvents: unknown = null, tooltipInputCleanup: unknown = null;
    let tooltipInput: Awaited<ReturnType<typeof observeTooltipInput>> | null = null;
    const nameReceipts: Array<{ phase: string; axHidden: boolean; expectedName: string; matched: boolean }> = [];
    const geometryReceipts: Array<{ phase: string; sourceMaximum: number | null; cap: ReturnType<typeof resolveTriggerCap> }> = [];
    const setup = { timeoutMs: 5000, ringCapacity: 64, reads: 0, discarded: 0, matched: false,
      samples: [] as Array<{ read: number; now: number; currentThreadId: string | null; owner: string | null }> };
    let origin = "", phase = "setup", failure: string | null = null;
    let reader: Awaited<ReturnType<typeof createReader>> | null = null, inputObserver: Awaited<ReturnType<typeof observe>> | null = null;
    let protection: Awaited<ReturnType<typeof createProtectionReader>> | null = null, defaults: Awaited<ReturnType<typeof createDefaultObserver>> | null = null;
    let stream: Awaited<ReturnType<typeof createFeedbackEventStream>> | null = null, streamCleanup: unknown = null;
    let inputEvents: unknown = null, defaultReceipt: unknown = null, defaultCleanup: unknown = null;
    let draftNode: Awaited<ReturnType<ReturnType<typeof page.locator>["elementHandle"]>> | null = null;
    let triggerNode: Awaited<ReturnType<ReturnType<typeof page.locator>["elementHandle"]>> | null = null;
    let sourceBefore: ReturnType<typeof hashInputs> | null = null, sourceAfter: ReturnType<typeof hashInputs> | null = null;
    let scope = page.locator(MAIN), menu: Locator | null = null, trigger: Locator | null = null;
    const record = async (name: string) => {
      if (!reader || !protection || !defaults || states.length >= 32) throw Error("Read-only E8 probes missing or phase cap exceeded");
      phase = name; const row = { phase: name, value: await read(page, reader), identity: await protection.evaluate((probe) => probe.read()),
        scope: await inspectScope(scope), publication: await defaults.evaluate((probe) => probe.read()),
        menu: menu && await menu.count() ? await menuDOM(menu) : null,
        trigger: trigger ? await triggerDOM(trigger) : null,
        tooltip: trigger ? await tooltipDOM(trigger) : null,
        sameTrigger: trigger && triggerNode ? await trigger.evaluate((node, held) => node === held, triggerNode) : null };
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
        localStorage.setItem("kanban.session.native-model-picker-preferences", JSON.stringify({ state: { selectionMode: mode, enabledReasoningEfforts: ["low", "medium", "high", "xhigh", "ultra", "persistent"] }, version: 1 }));
        localStorage.setItem("kanban.session.theme-storage", JSON.stringify({ state: { theme }, version: 0 }));
        localStorage.setItem("kanban.session.model-settings", JSON.stringify({ state: { models: custom }, version: 2 }));
        localStorage.setItem("kanban.session.composer-v2", JSON.stringify({ [ownerA]: { contexts: [], drawings: {}, expanded: false, plain: true }, [ownerB]: { contexts: [], drawings: {}, expanded: false, plain: false } }));
      }, { theme, custom: CUSTOM, ownerA: OWNER_A, ownerB: OWNER_B, mode: scenario.mode, origin });
      await page.route("**/*", async (route) => {
        const request = route.request();
        if (new URL(request.url()).origin !== origin || !["GET", "HEAD"].includes(request.method())) { external.push({ method: request.method(), url: request.url() }); await route.abort("blockedbyclient"); }
        else await route.continue();
      });
      await installSessionUxFixture(page, 2);
      await page.route("**/api/**", async (route) => {
        const request = route.request(), url = new URL(request.url()), path = url.pathname;
        const entry = { method: request.method(), path, body: request.method() === "POST" ? request.postDataJSON() : null }; api.push(entry);
        if (url.origin !== origin) { external.push({ method: entry.method, url: request.url() }); await route.abort("blockedbyclient"); return; }
        if (path === "/api/session/api/events" && entry.method === "GET") { if (!stream) throw Error("Owned SSE missing"); await route.continue({ url: stream.url }); return; }
        const index = paths.findIndex((suffix) => path.endsWith(suffix));
        if (index >= 0) {
          directory.push(entry); const valid = path === "/api/session" + paths[index] && entry.method === (index === 0 ? "POST" : "GET") && (index === 0 ? isDeepStrictEqual(entry.body, { cursor: null, limit: 100 }) : entry.body === null);
          if (!valid) { writes.push(entry); await route.fulfill({ status: 409, json: { error: "E8 catalog read contract mismatch" } }); return; }
          counts[index]++; await route.fulfill({ json: index === 0 ? { data: catalog, nextCursor: null } : [] }); return;
        }
        if (!["GET", "HEAD"].includes(entry.method) && !reads.has(path) && !bookkeeping.has(path)) { writes.push(entry); await route.fulfill({ status: 409, json: { error: "E8 unexpected mutation rejected" } }); return; }
        await route.fallback();
      });
      await page.goto("/?mode=session&view=agent", { waitUntil: "domcontentloaded" }); await page.locator(MAIN).locator(EDITOR).first().waitFor();
      // Sole initial fixture hydration, before any UI input. No later setters/load/choose.
      await seedSessionUx(page, 2); const owners = await initializeJoint(page, { model: SOL, effort: scenario.raw, serviceTier: "fast" });
      expect(owners.owner).toBe(OWNER_A); expect(owners.otherOwner).toBe(OWNER_B);
      reader = await createReader(page, owners); inputObserver = await observe(page);
      await expect.poll(async () => {
        const value = await read(page, reader!); setup.reads++;
        if (setup.samples.length === setup.ringCapacity) { setup.samples.shift(); setup.discarded++; }
        setup.samples.push({ read: setup.reads, now: value.now, currentThreadId: value.currentThreadId, owner: value.owner });
        return { currentThreadId: value.currentThreadId, owner: value.owner };
      }, { timeout: setup.timeoutMs, intervals: [25, 50, 100] }).toEqual({ currentThreadId: "ux-0", owner: owners.owner }); setup.matched = true;
      await page.locator(MAIN).locator(EDITOR).first().fill(draft); draftNode = await page.locator(MAIN).locator(EDITOR).first().elementHandle();
      await expect.poll(() => counts).toEqual([1, 1, 1, 1]); await expect.poll(async () => (await read(page, reader!)).cache.loaded).toBe(true);
      await expect.poll(async () => (await read(page, reader!)).eventStreamConnected).toBe(true); await settle(page);
      protection = await createProtectionReader(page); defaults = await createDefaultObserver(page);
      const baseline = await record("baseline"), initialRecent = await recent(page);
      const expected = { model: SOL, reasoningEffort: scenario.raw as string | null, revision: baseline.value.entry.revision as number, changed: false };
      const protect = (row: typeof baseline, expanded: boolean) => {
        assertProtected(row.value, baseline.value, row.identity, baseline.identity, owners.owner, draft, expanded, catalog, expected);
        expect(row.scope.editorText).toBe(draft); expect(row.scope.scopeKind).toBe(expanded ? "expanded" : "main");
        expect(row.scope.ownerAttribute).toBe(expanded ? null : owners.owner); expect(row.publication.sameEnabled).toBe(true); expect(row.publication.overflow).toBe(false);
        expect(row.publication.enabled).toEqual(["low", "medium", "high", "xhigh", "ultra", "persistent"]);
        expect(row.publication.mode).toBe(scenario.mode); expect(row.publication.events).toEqual([]);
        expect(row.value.entry).toEqual(baseline.value.entry); expect(row.identity.same.a).toBe(true);
        expect(counts).toEqual([1, 1, 1, 1]); expect(writes).toEqual([]); expect(external).toEqual([]); expect(errors).toEqual([]);
      };
      protect(baseline, false); expect(baseline.value.entry).toMatchObject({ revision: 4, pending: false, pendingFields: [], serviceTier: "fast" });
      if (surface === "expanded") {
        await scope.getByRole("button", { name: "附加文件", exact: true }).click(); await page.getByRole("button", { name: "展开编辑", exact: true }).click();
        await page.getByRole("dialog", { name: "展开编辑", exact: true }).waitFor(); scope = page.locator(".session-mode .session-composer-sheet.is-full");
        await expect(scope).toHaveCount(1); await expect(scope).toBeVisible(); await expect.poll(() => scope.locator(EDITOR).first().evaluate((node) => node instanceof HTMLTextAreaElement ? node.value : node.textContent)).toBe(draft);
      }
      trigger = scope.locator(".session-native-model-trigger"); await expect(trigger).toBeVisible(); await expect(trigger).toBeEnabled(); triggerNode = await trigger.elementHandle();
      if (!triggerNode) throw Error("Captured own Trigger handle missing");
      tooltipInput = await observeTooltipInput(trigger);
      const closed = await record("closed-before"); protect(closed, surface === "expanded"); expect(await recent(page)).toEqual(initialRecent);
      await expect(trigger).toHaveAccessibleName("模型：" + SOL + "，medium");
      const visibleHint = page.locator('.session-native-composer-tooltip[data-slot="tooltip-content"] > .session-native-composer-tooltip-label').filter({ visible: true });
      const leaveHintByMouse = async (name: string) => {
        if (!trigger || !tooltipInput) throw Error("Owned Trigger/input observer missing before away moves");
        const geometry = await readAwayGeometry(trigger);
        expect(Object.values(geometry.button).every(Number.isFinite)).toBe(true);
        expect(Object.values(geometry.tooltip).every(Number.isFinite)).toBe(true);
        expect(geometry.button.top).toBeGreaterThan(24); expect(geometry.tooltip.top).toBeGreaterThan(24);
        for (const point of [{ x: 16, y: 16 }, { x: 8, y: 8 }]) {
          expect(point.x).toBeGreaterThan(0); expect(point.y).toBeGreaterThan(0);
          expect(point.x).toBeLessThan(geometry.viewport.width); expect(point.y).toBeLessThan(geometry.viewport.height);
          for (const rect of [geometry.button, geometry.tooltip])
            expect(point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom).toBe(false);
        }
        const before = await tooltipInput.evaluate((probe) => probe.read());
        expect(before.awayOverflow).toBe(false); const beforeLength = before.awayMoves.length;
        await page.mouse.move(16, 16); await settle(page); await page.mouse.move(8, 8);
        const after = await tooltipInput.evaluate((probe) => probe.read());
        const events = after.awayMoves.slice(beforeLength);
        awayReceipts.push({ phase: name, geometry, beforeLength, afterLength: after.awayMoves.length, events });
        expect(after.awayOverflow).toBe(false); expect(events).toHaveLength(2);
        expect(events.map(({ x, y, trusted, pointerType, insideTrigger, insideTooltip }) => ({ x, y, trusted, pointerType, insideTrigger, insideTooltip }))).toEqual([
          { x: 16, y: 16, trusted: true, pointerType: "mouse", insideTrigger: false, insideTooltip: false },
          { x: 8, y: 8, trusted: true, pointerType: "mouse", insideTrigger: false, insideTooltip: false },
        ]);
        expect(events.every((event) => Number.isFinite(event.now))).toBe(true); expect(events[1].now).toBeGreaterThanOrEqual(events[0].now);
        await expect(visibleHint).toHaveCount(0);
      };
      await trigger.hover(); await expect(visibleHint).toHaveCount(1); await expect(visibleHint).toBeVisible();
      const closedHint = await record("closed-tooltip"); protect(closedHint, surface === "expanded");
      expect(closedHint.tooltip?.overflow).toBe(false); expect(closedHint.tooltip?.axHiddenAncestors).toEqual([]);
      await expect(trigger).toHaveAccessibleName("模型：" + SOL + "，medium"); await shot("closed-tooltip");
      await leaveHintByMouse("closed-tooltip-left");
      const observeName = async (row: typeof baseline, current = false) => {
        if (!trigger || !row.trigger) throw Error("Captured Trigger observation missing");
        const axHidden = row.trigger.axHiddenAncestors.length > 0;
        const expectedName = current ? "模型：" + SOL + "，medium" : scenario.purpose;
        // Name is a live matcher on the same captured node. Phase hard guards above
        // precede this soft observation; later hard IO/cleanup still run on mismatch.
        const failuresBefore = info.errors.length;
        expect.soft(row.trigger.axHiddenAncestors, row.phase + ": ordinary nonmodal AX exposure").toEqual([]);
        await expect.soft(trigger, row.phase).toHaveAccessibleName(expectedName, { timeout: 1 });
        nameReceipts.push({ phase: row.phase, axHidden, expectedName, matched: info.errors.length === failuresBefore });
      };
      await trigger.click(); menu = page.locator(".session-native-model-menu").filter({ visible: true }); await menu.waitFor();
      const immediate = await record("open-immediate"); protect(immediate, surface === "expanded"); await observeName(immediate);
      await settle(page); const twoRAF = await record("open-2raf"); protect(twoRAF, surface === "expanded"); await observeName(twoRAF);
      await menu.evaluate(async (node) => { await Promise.all(node.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => {}))); });
      const opened = await record("open-settled"); protect(opened, surface === "expanded"); await observeName(opened);
      expect.soft(opened.trigger?.axHiddenAncestors).toEqual([]); expect(await recent(page)).toEqual(initialRecent);
      const caption = menu.getByRole("menuitem", { name: "选择模型", exact: true }); await expect(caption).toBeEnabled(); await expect(caption).toHaveAccessibleName("选择模型");
      await shot("open-settled"); await caption.click(); await expect(menu.locator('[data-model-picker-view="advanced"]')).toBeVisible(); await settle(page);
      const advanced = await record("advanced"); protect(advanced, surface === "expanded"); await observeName(advanced, true); expect(await recent(page)).toEqual(initialRecent);
      await shot("advanced");
      const selectedRow = scenario.mode === "default" ? menu.getByRole("menuitemradio", { name: /^默认/ }) : menu.getByRole("menuitemradio", { name: scenario.label, exact: true });
      await expect(selectedRow).toBeEnabled(); await expect(selectedRow).toHaveAttribute("aria-checked", "true"); await selectedRow.click();
      await expect(menu.locator('[data-model-picker-view="simple"]')).toBeVisible(); await settle(page);
      const returned = await record("returned-simple"); protect(returned, surface === "expanded"); await observeName(returned);
      if (scenario.mode === "model") expect((await recent(page))[0]).toMatchObject({ model: SOL, reasoningEffort: null, serviceTier: "fast" });
      else expect(await recent(page)).toEqual(initialRecent);
      await menu.getByRole("menuitem", { name: "选择模型", exact: true }).click(); await expect(menu.locator('[data-model-picker-view="advanced"]')).toBeVisible(); await settle(page);
      const beforeClose = await record("advanced-before-close"); protect(beforeClose, surface === "expanded"); await observeName(beforeClose, true);
      const lastRecent = await recent(page); await page.keyboard.press("Escape"); await menu.waitFor({ state: "detached" }); menu = null;
      await expect(scope.locator(EDITOR).first()).toBeFocused(); const escaped = await record("closed-after"); protect(escaped, surface === "expanded");
      await expect(trigger).toHaveAccessibleName("模型：" + SOL + "，medium"); expect(escaped.trigger?.axHiddenAncestors).toEqual([]);
      await trigger.hover(); await expect(visibleHint).toHaveCount(1); await expect(visibleHint).toBeVisible();
      const returnedHint = await record("closed-returned-tooltip"); protect(returnedHint, surface === "expanded");
      expect(returnedHint.tooltip?.overflow).toBe(false); expect(returnedHint.tooltip?.axHiddenAncestors).toEqual([]);
      await expect(trigger).toHaveAccessibleName("模型：" + SOL + "，medium"); await shot("closed-returned-tooltip");
      await leaveHintByMouse("closed-returned-tooltip-left");
      // Existing 350ms advanced reset remains tested; this delay is not a purpose timer.
      await page.waitForTimeout(360);
      await trigger.press("ArrowDown"); menu = page.locator(".session-native-model-menu").filter({ visible: true }); await menu.waitFor(); await settle(page);
      const reopened = await record("reopened-keyboard"); protect(reopened, surface === "expanded"); await observeName(reopened);
      await expect(menu.getByRole("menuitem", { name: "选择模型", exact: true })).toBeFocused(); await page.keyboard.press("ArrowDown"); await expect(menu.getByRole("menuitem", { name: "强度", exact: true })).toBeFocused();
      await page.keyboard.press("Escape"); await menu.waitFor({ state: "detached" }); menu = null; await expect(scope.locator(EDITOR).first()).toBeFocused();
      const lastClosed = await record("closed-reopened"); protect(lastClosed, surface === "expanded"); await expect(trigger).toHaveAccessibleName("模型：" + SOL + "，medium");
      if (surface === "expanded") {
        await page.getByRole("button", { name: "返回并保留草稿", exact: true }).click(); await scope.waitFor({ state: "detached" }); scope = page.locator(MAIN); trigger = null;
        await expect(scope.locator(EDITOR).first()).toBeFocused();
      }
      await settle(page); const final = await record("final-closed"); protect(final, false); expect(await recent(page)).toEqual(lastRecent);
      expect(await page.locator(MAIN).locator(EDITOR).first().evaluate((node, old) => node === old, draftNode)).toBe(true);
      expect(consoleErrors.filter((item) => !(item.url === origin + "/@vite/client" && item.text.startsWith("[vite] failed to connect to websocket.")))).toEqual([]);
      const observed = await inputObserver.evaluate((probe) => probe.read()); expect(observed.overflow).toBe(false); expect(observed.events.filter((event) => event.type === "submit")).toEqual([]);
      expect(observed.events.filter((event) => event.type === "click" || event.type === "keydown").every((event) => event.trusted)).toBe(true);
      const radioClicks = observed.events.filter((event) => event.type === "click" && event.role === "menuitemradio"); expect(radioClicks).toHaveLength(1); expect(radioClicks[0]).toMatchObject({ trusted: true, inModelMenu: true });
      expect(radioClicks[0].text).toContain(scenario.mode === "default" ? "默认" : scenario.label);
      await shot("final-closed");
      const hoverInputs = await tooltipInput.evaluate((probe) => probe.read());
      expect(hoverInputs.overflow).toBe(false); expect(hoverInputs.subscribed).toBe(true);
      expect(hoverInputs.awayOverflow).toBe(false); expect(awayReceipts).toHaveLength(2);
      expect(hoverInputs.events.some((event) => event.type === "pointermove" && event.trusted && event.pointerType === "mouse")).toBe(true);
      expect(hoverInputs.events.every((event) => event.trusted)).toBe(true);
      // These are primitive receipts only. Prospective wording assertions run
      // after the finally block has closed the page, readers and owned SSE.
      for (const row of [closedHint, returnedHint]) {
        const actual = row.tooltip?.visibleLabels ?? [];
        tooltipChecks.push({ phase: row.phase, kind: "wording", expected: [scenario.purpose], actual,
          pass: actual.length === 1 && actual[0] === scenario.purpose });
      }
      for (const row of [immediate, twoRAF, opened, advanced, returned, beforeClose, reopened]) {
        const actual = row.tooltip?.visibleLabels ?? [];
        tooltipChecks.push({ phase: row.phase, kind: "open-hidden", expected: [], actual,
          pass: row.tooltip !== null && !row.tooltip.overflow && actual.length === 0 });
      }
      hardControlsCompleted = true;
      // New visible-purpose/geometry requirements are deferred until every hard
      // state, trusted-input, raw, owner, directory, draft and transport control.
      for (const row of [immediate, twoRAF, opened, returned, reopened]) {
        const value = row.trigger; expect.soft(value, row.phase).not.toBeNull();
        expect.soft(row.sameTrigger, row.phase).toBe(true); expect.soft(value?.connected, row.phase).toBe(true); expect.soft(value?.physicallyVisible, row.phase).toBe(true);
        expect.soft(value?.aria, row.phase).toBeNull(); expect.soft(value?.labelledby, row.phase).toBeNull(); expect.soft(value?.selectionSpanCount, row.phase).toBe(0);
        expect.soft(value?.placeholder?.text, row.phase).toBe(scenario.purpose); expect.soft(value?.placeholder?.visible, row.phase).toBe(true);
        expect.soft(value?.measurement?.text, row.phase).toBe(scenario.purpose); expect.soft(value?.measurement?.ariaHidden, row.phase).toBe("true");
        expect.soft(value?.measurement, row.phase).toMatchObject({ visibility: "hidden", position: "fixed", pointerEvents: "none", whiteSpace: "nowrap", visible: false });
        expect.soft(row.value.modelMenu?.view, row.phase).toBe("simple"); expect.soft(capturedMenu(row).caption, row.phase).toBe("选择模型");
      }
      for (const row of [closed, advanced, beforeClose, escaped, lastClosed]) {
        expect.soft(row.sameTrigger, row.phase).toBe(true); expect.soft(row.trigger?.aria, row.phase).toBe("模型：" + SOL + "，medium");
        expect.soft(row.trigger?.model, row.phase).toBe(scenario.label); expect.soft(row.trigger?.effort, row.phase).toBe("中"); expect.soft(row.trigger?.placeholder, row.phase).toBeNull();
      }
      const currentWidth = closed.trigger?.content?.width ?? null, placeholderWidth = opened.trigger?.measurement?.width ?? null;
      expect.soft(currentWidth).not.toBeNull(); expect.soft(placeholderWidth).not.toBeNull();
      const sourceMaximum = currentWidth !== null && placeholderWidth !== null ? Math.max(currentWidth, placeholderWidth) : null;
      if (currentWidth !== null && placeholderWidth !== null && sourceMaximum !== null && closed.trigger) {
        expect.soft(currentWidth).toBeGreaterThan(0); expect.soft(placeholderWidth).toBeGreaterThan(0);
        if (scenario.widthWinner === "current") expect.soft(currentWidth).toBeGreaterThan(placeholderWidth); else expect.soft(placeholderWidth).toBeGreaterThan(currentWidth);
        const closedCap = resolveTriggerCap(closed.trigger);
        const chrome = Math.max(0, (closed.trigger.button.rect?.width ?? currentWidth) - currentWidth);
        for (const row of [opened, returned, reopened]) {
          const value = row.trigger, content = value?.content;
          expect.soft(content, row.phase).not.toBeNull();
          if (!value || !content) continue; // Missing old-product hooks remain null failures, never fallbacks.
          const cap = resolveTriggerCap(value);
          if (cap.kind === "percentage") {
            expect.soft(content.minWidth, row.phase).toBe("");
            expect.soft(content.computedMinWidth, row.phase).toBe("0px");
            expect.soft(Number(content.flexShrink), row.phase).toBe(1);
            expect.soft(/^(?:\d+(?:\.\d*)?|\.\d+)px$/.test(content.preferredWidth), row.phase).toBe(true);
            expect.soft(Number.parseFloat(content.preferredWidth), row.phase).toBeCloseTo(sourceMaximum, 0);
            if (cap.contentBudget !== null) {
              const used = Math.min(sourceMaximum, cap.contentBudget);
              expect.soft(content.width, row.phase).toBeGreaterThanOrEqual(used - 1);
              expect.soft(content.width, row.phase).toBeLessThanOrEqual(used + 1);
              if (cap.contentBudget >= sourceMaximum - 1) expect.soft(content.width, row.phase).toBeGreaterThanOrEqual(sourceMaximum - 1);
            }
            if (cap.cappedContentBudget !== null && cap.cappedContentBudget >= sourceMaximum - 1) expect.soft(content.width, row.phase).toBeGreaterThanOrEqual(sourceMaximum - 1);
          } else if (cap.kind === "px" || cap.kind === "none") {
            const expectedMinimum = closedCap.borderBoxCap === null ? sourceMaximum : Math.min(sourceMaximum, Math.max(0, closedCap.borderBoxCap - chrome));
            expect.soft(content.preferredWidth, row.phase).toBe("");
            expect.soft(Number.parseFloat(content.minWidth), row.phase).toBeCloseTo(expectedMinimum, 0);
            expect.soft(content.width, row.phase).toBeGreaterThanOrEqual(expectedMinimum - 1);
          }
        }
      }
      // Width is retained in open advanced; only the original close phases clear both representations.
      for (const row of [escaped, lastClosed]) {
        expect.soft(row.trigger?.content?.minWidth, row.phase).toBe("");
        expect.soft(row.trigger?.content?.preferredWidth, row.phase).toBe("");
      }
      const initialViewport = closed.trigger?.viewport;
      for (const row of [closed, immediate, twoRAF, opened, advanced, returned, beforeClose, escaped, reopened, lastClosed, final]) {
        if (row.trigger === null) continue; // Actual full Sheet is physically gone in final-closed.
        const value = row.trigger, rect = value.button.rect, capText = value.button.maxWidth;
        const cap = resolveTriggerCap(value); geometryReceipts.push({ phase: row.phase, sourceMaximum, cap });
        expect.soft(cap.diagnostics, "Unsupported fixture geometry: " + row.phase).toEqual([]);
        expect.soft(rect, row.phase).not.toBeNull(); expect.soft(capText, row.phase).not.toBeNull();
        if (surface === "main" && width === 390) expect.soft(capText, row.phase).toBe("110px");
        if (rect) {
          expect.soft(rect.width, row.phase).toBeGreaterThan(0); expect.soft(rect.height, row.phase).toBeGreaterThan(0);
          if (cap.borderBoxCap !== null) expect.soft(rect.width, row.phase).toBeLessThanOrEqual(cap.borderBoxCap + 1);
          if (cap.containingBlock) {
            expect.soft(rect.left, row.phase).toBeGreaterThanOrEqual(cap.containingBlock.left - 1);
            expect.soft(rect.right, row.phase).toBeLessThanOrEqual(cap.containingBlock.right + 1);
          }
          expect.soft(rect.left, row.phase).toBeGreaterThanOrEqual(-1); expect.soft(rect.right, row.phase).toBeLessThanOrEqual(value.viewport.width + 1);
          expect.soft(rect.top, row.phase).toBeGreaterThanOrEqual(-1); expect.soft(rect.bottom, row.phase).toBeLessThanOrEqual(value.viewport.height + 1);
          const chevron = value.button.chevron; expect.soft(chevron, row.phase).not.toBeNull();
          if (chevron) {
            expect.soft(chevron.left, row.phase).toBeGreaterThanOrEqual(rect.left - 1); expect.soft(chevron.right, row.phase).toBeLessThanOrEqual(rect.right + 1);
            expect.soft(chevron.top, row.phase).toBeGreaterThanOrEqual(rect.top - 1); expect.soft(chevron.bottom, row.phase).toBeLessThanOrEqual(rect.bottom + 1);
          }
        }
        expect.soft(initialViewport, row.phase).not.toBeUndefined();
        if (initialViewport) {
          const initialOverflow = Math.max(0, initialViewport.documentScrollWidth - initialViewport.documentClientWidth);
          expect.soft(Math.max(0, value.viewport.documentScrollWidth - value.viewport.documentClientWidth), row.phase).toBeLessThanOrEqual(initialOverflow + 1);
          if (initialViewport.bodyScrollWidth !== null && initialViewport.bodyClientWidth !== null && value.viewport.bodyScrollWidth !== null && value.viewport.bodyClientWidth !== null) {
            const initialBodyOverflow = Math.max(0, initialViewport.bodyScrollWidth - initialViewport.bodyClientWidth);
            expect.soft(Math.max(0, value.viewport.bodyScrollWidth - value.viewport.bodyClientWidth), row.phase).toBeLessThanOrEqual(initialBodyOverflow + 1);
          }
        }
      }
    } catch (error) { failure = String(error); throw error; }
    finally {
      const assertionErrors = info.errors.map((error) => error.message ?? String(error.value ?? "Unknown test error")); if (!failure && assertionErrors.length) failure = assertionErrors[0];
      if (tooltipInput) { try {
        tooltipInputEvents = await tooltipInput.evaluate((probe) => probe.read());
        tooltipInputCleanup = await tooltipInput.evaluate((probe) => probe.dispose());
        const receipt = tooltipInputCleanup as { disposed?: boolean; subscribed?: boolean; retainedNode?: boolean };
        if (!receipt.disposed || receipt.subscribed !== false || receipt.retainedNode !== false) cleanupErrors.push("Tooltip input observer incomplete close");
        await tooltipInput.dispose();
      } catch (error) { cleanupErrors.push(String(error)); } }
      if (inputObserver) { try { inputEvents = await inputObserver.evaluate((probe) => probe.read()); await inputObserver.evaluate((probe) => probe.dispose()); await inputObserver.dispose(); } catch (error) { cleanupErrors.push(String(error)); } }
      if (reader && protection && defaults && !page.isClosed()) { try { await record("finally"); } catch (error) { cleanupErrors.push(String(error)); } }
      if (defaults) { try { defaultReceipt = await defaults.evaluate((probe) => probe.read()); defaultCleanup = await defaults.evaluate((probe) => probe.dispose());
        if (!(defaultCleanup as { disposed?: boolean }).disposed || (defaultCleanup as { subscribed?: boolean }).subscribed !== false) cleanupErrors.push("Default subscriptions did not release"); await defaults.dispose();
      } catch (error) { cleanupErrors.push(String(error)); } }
      if (protection) { try { await protection.evaluate((probe) => probe.dispose()); await protection.dispose(); } catch (error) { cleanupErrors.push(String(error)); } }
      if (reader) { try { await reader.dispose(); } catch (error) { cleanupErrors.push(String(error)); } }
      if (!page.isClosed()) { try { await shot("finally"); } catch (error) { cleanupErrors.push(String(error)); } }
      for (const handle of [draftNode, triggerNode]) if (handle) { try { await handle.dispose(); } catch (error) { cleanupErrors.push(String(error)); } }
      try { sourceAfter = hashInputs(); if (!isDeepStrictEqual(sourceAfter, sourceBefore)) cleanupErrors.push("E8 input source drift"); } catch (error) { cleanupErrors.push(String(error)); }
      try { await page.close(); } catch (error) { cleanupErrors.push(String(error)); }
      if (stream) { try { const closed = await stream.close(); streamCleanup = closed;
        if (!closed.closed || closed.listening || !closed.addressCleared || closed.activeResponses || closed.activeSockets || closed.serverErrorCount || closed.requestOverflow || closed.errors.length || closed.acceptedRequests < 1) cleanupErrors.push("Owned SSE incomplete close");
      } catch (error) { cleanupErrors.push(String(error)); } }
      const cleanupOnlyFailure = cleanupErrors.length > 0 && !failure; if (cleanupOnlyFailure) failure = "Cleanup failure: " + cleanupErrors.join("; ");
      if (!failure && hardControlsCompleted && tooltipChecks.some((check) => !check.pass)) failure = "Prospective tooltip label/suppression mismatch; hard controls and cleanup reached";
      const path = info.outputPath("model-tooltip-purpose.json");
      writeFileSync(path, JSON.stringify({ caseId: scenario.id, width, surface, theme, origin, phase, failure, assertionErrors, setup,
        fixture: { current: SOL, rawEffort: scenario.raw, initialMode: scenario.mode, initialTier: "fast", catalog, custom: CUSTOM, normalCSSScale: 1 },
        states, nameReceipts, geometryReceipts, tooltipChecks, hardControlsCompleted, tooltipInputEvents, tooltipInputCleanup, awayReceipts, counts, directory, api, writes, external, errors, consoleErrors, inputEvents, defaultReceipt, defaultCleanup, screenshots, cleanupErrors, streamCleanup, sourceBefore, sourceAfter,
        boundary: "Eight synthetic local ordinary model/default cases on actual main/ComposerSheet with trusted pointer/keyboard. Public DOM hooks missing on old product are null requirements, never fallback current spans. Ordinary OpenAI inner pickers are locally nonmodal: captured Trigger AX ancestors must remain empty and live names are purpose/simple or selection/advanced; the outer real ComposerSheet Dialog keeps its background lock and AX boundary. No authenticated account/real catalog/native RPC/SDK/physical device/complete Lti/Pti/zoom/pixel/atomicCAS claim. Single initial store setup occurs before first input; all later activity is real UI and bounded passive readers. Same-current APP recent and same-value FI setter persistence are allowed while raw complete A entry is protected. Natural reset350ms remains; no new purpose timer or DPR scale. Original official GUI was not run by this test. E9a adds genuine hover and bounded passive input/visible Content readings; hidden role=tooltip clones are description observations only. No full Dca selected-close/first-blur/leave, native timing or native AX parity claim. Target wording assertions occur only after page/observer/owned-SSE cleanup; own SSE counts are measured per case, never inherited from other batches." }, null, 2) + "\n");
      await info.attach("model-tooltip-purpose", { path, contentType: "application/json" }); if (cleanupOnlyFailure) throw Error("Owned fixture cleanup failed: " + cleanupErrors.join("; "));
    }
    // All hard state/input/source and finally cleanup guards have completed.
    expect(hardControlsCompleted).toBe(true); expect(cleanupErrors).toEqual([]);
    expect(tooltipChecks).toHaveLength(9);
    for (const check of tooltipChecks) {
      expect.soft(check.actual, check.phase + ": " + check.kind).toEqual(check.expected);
      expect.soft(check.pass, check.phase + ": " + check.kind + ": complete observation").toBe(true);
    }
  });
});
