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
  "apps/web/src/session-mode/components/common/SessionRowTitle.tsx",
  "apps/web/src/session-mode/components/codex/thread/ThreadList.tsx",
  "apps/web/src/session-mode/components/layout/SideBarProjectList.tsx",
  "apps/web/src/session-mode/components/layout/SideBarAgentPane.tsx",
  "apps/web/src/session-mode/components/layout/SideBarTab.tsx",
  "apps/web/src/session-mode/components/layout/AppSidebar.tsx",
  "apps/web/src/session-mode/components/layout/AppLayout.tsx",
  "apps/web/src/session-mode/components/agent/ProjectNavigationButton.tsx",
  "tests/e2e/session-composer-tooltip-coordination.spec.mts",
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

const cases = [
  { id: "desktop-sidebar-radix-peer", width: 1440, peer: "sidebar" },
  { id: "mobile-two-common-peers", width: 390, peer: "model" },
] as const;
const ROW_TITLE = "中文会话 0 " + "长标题".repeat(6);

/** All original Content/neighbours remain visible to this passive reader. */
async function coordinationObserver(first: Locator, second: Locator) {
  const secondNode = await second.elementHandle(); if (!secondNode) throw Error("Second actual target missing");
  try {
    return await first.evaluateHandle((firstNode, secondNode) => {
      const doc = firstNode.ownerDocument;
      if (!(secondNode instanceof HTMLElement) || secondNode.ownerDocument !== doc) throw Error("Targets must share the actual page document");
      let a: Element | null = firstNode, b: Element | null = secondNode, active = true, overflow = false, reads = 0, nextId = 0;
      const ids = new WeakMap<Element, number>();
      const uid = (node: Element | null) => { if (!node) return null; let id = ids.get(node); if (!id) { if (++nextId > 64) { overflow = true; return null; } id = nextId; ids.set(node, id); } return id; };
      const classify = (node: EventTarget | null) => node instanceof Element ? a?.contains(node) ? "first" : b?.contains(node) ? "second" : "other" : "non-element";
      const events: Array<{ type: string; trusted: boolean; now: number; target: string; related: string; key: string | null; pointerType: string | null; x: number | null; y: number | null; active: string }> = [];
      const listener = (event: Event) => {
        if (!active) return; if (events.length >= 512) { overflow = true; return; }
        events.push({ type: event.type, trusted: event.isTrusted, now: performance.now(), target: classify(event.target),
          related: classify(event instanceof FocusEvent || event instanceof MouseEvent ? event.relatedTarget : null),
          key: event instanceof KeyboardEvent ? event.key : null, pointerType: event instanceof PointerEvent ? event.pointerType : null,
          x: event instanceof MouseEvent ? event.clientX : null, y: event instanceof MouseEvent ? event.clientY : null, active: classify(doc.activeElement) });
      };
      const types = ["keydown", "focusin", "blur", "focusout", "pointerover", "pointerout", "pointerleave", "pointermove", "pointerdown", "click", "submit"];
      types.forEach((type) => doc.addEventListener(type, listener, true));
      const physical = (node: Element | null) => {
        if (!node || !node.isConnected || node.closest("[hidden],[inert]")) return false;
        const rect = node.getBoundingClientRect(); if (rect.width <= 0 || rect.height <= 0 || node.getClientRects().length === 0) return false;
        for (let parent: Element | null = node; parent; parent = parent.parentElement) {
          const css = getComputedStyle(parent), opacity = Number.parseFloat(css.opacity);
          if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) throw Error("Unsupported computed tooltip opacity " + css.opacity);
          if (css.display === "none" || ["hidden", "collapse"].includes(css.visibility) || opacity === 0) return false;
        } return true;
      };
      const rect = (node: Element) => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, top: r.top, right: r.right, bottom: r.bottom, left: r.left, width: r.width, height: r.height }; };
      const target = (node: Element | null, capturedId: string | null) => {
        if (!node || !node.isConnected || node.ownerDocument !== doc) throw Error("Captured target node/document changed");
        const describedby = node.getAttribute("aria-describedby"), tokens = (describedby ?? "").split(/\s+/).filter(Boolean);
        if (tokens.length > 1 || (capturedId && tokens.some((id) => id !== capturedId))) throw Error("Tooltip native identity changed or became ambiguous");
        const nativeId = capturedId ?? tokens[0] ?? null;
        const copies = nativeId ? [...doc.querySelectorAll<HTMLElement>('[role="tooltip"]')].filter((item) => item.id === nativeId) : [];
        if (copies.length > 1) throw Error("Duplicate Tooltip native description ID");
        const root = copies[0]?.closest<HTMLElement>('[data-slot="tooltip-content"]') ?? null;
        if (copies.length && !root) throw Error("Tooltip description moved outside actual Content");
        const label = root?.querySelector<HTMLElement>(":scope > .session-native-composer-tooltip-label");
        return { uid: uid(node), connected: node.isConnected, nativeId, describedby, rawAria: node.getAttribute("aria-label"),
          text: node.textContent, rect: rect(node), physical: physical(node), focus: doc.activeElement === node,
          focusVisible: node.matches(":focus-visible"), hovered: node.matches(":hover"), contentUID: uid(root),
          nativeCount: copies.length, visible: physical(root) && (!label || physical(label)),
          label: label?.textContent ?? (root ? [...root.childNodes].filter((child) => !(child instanceof Element) || child.getAttribute("role") !== "tooltip").map((child) => child.textContent ?? "").join("") : null) };
      };
      return {
        read: (captured: { first: string | null; second: string | null }) => {
          if (!active || ++reads > 64) throw Error("Coordination observer disposed or read cap exceeded");
          const all = [...doc.querySelectorAll<HTMLElement>('[data-slot="tooltip-content"]')]; if (all.length > 16) overflow = true;
          return { now: performance.now(), subscribed: active, reads, overflow, first: target(a, captured.first), second: target(b, captured.second),
            active: classify(doc.activeElement), focused: doc.hasFocus(), viewport: { width: innerWidth, height: innerHeight, overflow: doc.documentElement.scrollWidth - innerWidth },
            contents: all.slice(0, 16).map((root) => {
              const animations = root.getAnimations({ subtree: false }); if (animations.length > 8) overflow = true;
              const descriptions = [...root.querySelectorAll<HTMLElement>('[role="tooltip"]')]; if (descriptions.length > 8) overflow = true;
              const css = getComputedStyle(root);
              return { uid: uid(root), state: root.dataset.state ?? null, visible: physical(root), rect: rect(root), opacity: css.opacity,
                descriptions: descriptions.slice(0, 8).map((description) => ({ id: description.id, text: description.textContent, physical: physical(description) })),
                label: root.querySelector(":scope > .session-native-composer-tooltip-label")?.textContent ?? null,
                peer: root.classList.contains("session-row-tooltip"), animationCount: animations.length,
                animations: animations.slice(0, 8).map((animation) => ({ playState: animation.playState, pending: animation.pending, currentTime: typeof animation.currentTime === "number" ? animation.currentTime : null })) };
            }), events: events.map((event) => ({ ...event })) };
        },
        dispose: () => { types.forEach((type) => doc.removeEventListener(type, listener, true)); active = false;
          const result = { disposed: true, subscribed: active, retainedNodes: false, overflow, events: events.length, ids: nextId }; events.length = 0; a = null; b = null; return result; },
      };
    }, secondNode);
  } finally { await secondNode.dispose(); }
}
function unexpectedConsoleErrors(records: ReadonlyArray<{ text: string; url: string }>, origin: string) {
  const viteURL = new URL("/@vite/client", origin).href;
  return records.filter((entry) => !(entry.url === viteURL && entry.text.startsWith("[vite] failed to connect to websocket.\n")));
}
function captureSessionRoot(scope: Locator) {
  return scope.evaluateHandle((node) => {
    const sessionRoot = node.closest(".session-mode");
    if (!sessionRoot) throw Error("Captured actual scope has no session root");
    return sessionRoot;
  });
}
async function keyboardTo(page: Page, target: Locator, phase: string, receipts: Array<{ phase: string; tabs: number }>) {
  let tabs = 0;
  while (!(await target.evaluate((node) => document.activeElement === node)) && tabs < 64) { await page.keyboard.press("Tab"); tabs++; }
  expect(tabs, phase + " requires actual keyboard navigation").toBeGreaterThan(0); expect(await target.evaluate((node) => document.activeElement === node && node.matches(":focus-visible")), phase).toBe(true); receipts.push({ phase, tabs });
}
async function hoverActual(page: Page, target: Locator, phase: string, receipts: Array<Record<string, unknown>>) {
  const geometry = await target.evaluate((node) => { const r = node.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
    return { x, y, width: r.width, height: r.height, viewport: { width: innerWidth, height: innerHeight }, hit: node.contains(document.elementFromPoint(x, y)) }; });
  expect(geometry.hit, phase + " actual hit target").toBe(true); expect(geometry.width).toBeGreaterThan(0); expect(geometry.height).toBeGreaterThan(0);
  expect(geometry.x).toBeGreaterThan(0); expect(geometry.y).toBeGreaterThan(0); expect(geometry.x).toBeLessThan(geometry.viewport.width); expect(geometry.y).toBeLessThan(geometry.viewport.height);
  await page.mouse.move(geometry.x, geometry.y); receipts.push({ phase, ...geometry });
}
/** Wait only for own CSS animation quiescence, never for an expected hidden result. */
async function settleContentAnimations(page: Page) {
  for (let frame = 0; frame < 32; frame++) {
    const observation = await page.evaluate(() => {
      const roots = [...document.querySelectorAll<HTMLElement>('[data-slot="tooltip-content"]')];
      if (roots.length > 16) throw Error("Global Tooltip animation observation overflow");
      const animations = roots.flatMap((root) => { const own = root.getAnimations({ subtree: false }); if (own.length > 8) throw Error("Own Tooltip animation observation overflow"); return own; });
      return { frameTime: performance.now(), roots: roots.length, count: animations.length, running: animations.some((animation) => animation.pending || animation.playState === "running") };
    });
    if (!observation.running) return { frame, ...observation };
    await settle(page);
  }
  throw Error("Tooltip CSS animation quiescence not observed in 32 double-RAF frames");
}

for (const scenario of cases) test.describe("E9b owned Tooltip coordination " + scenario.id, () => {
  test.use({ viewport: { width: scenario.width, height: scenario.width === 390 ? 844 : 900 }, hasTouch: scenario.width === 390, isMobile: scenario.width === 390 });
  test("main keyboard focus and genuine hover coordinate actual peers in both directions", async ({ page }, info) => {
    const theme = scenario.width === 1440 ? "dark" : "light", draft = "E9b coordination retained draft " + scenario.id;
    const catalog = [model(TERRA, TL, ["low"], "low", true), model(SOL, "S", ["low", "medium", "high"], "medium", false)];
    const counts = [0, 0, 0, 0]; const directory: unknown[] = [], writes: unknown[] = [], api: unknown[] = [], external: unknown[] = [];
    const errors: string[] = [], consoleErrors: Array<{ text: string; url: string }> = [], cleanupErrors: string[] = [], screenshots: string[] = [];
    const states: Array<{ phase: string; value: any; identity: any; scope: Awaited<ReturnType<typeof inspectScope>>; publication: any; recent: unknown; tooltip: any; dom: { scope: boolean; editor: boolean; sessionRoot: boolean } }> = [];
    const targets: Array<{ phase: string; actual: unknown; expected: unknown; pass: boolean }> = [], tabs: Array<{ phase: string; tabs: number }> = [], points: Array<Record<string, unknown>> = [];
    const quiescence: Array<Awaited<ReturnType<typeof settleContentAnimations>>> = [];
    let phase = "setup", origin = "", failure: string | null = null, hardControlsCompleted = false;
    let reader: Awaited<ReturnType<typeof createReader>> | null = null, inputsProbe: Awaited<ReturnType<typeof observe>> | null = null;
    let protection: Awaited<ReturnType<typeof createProtectionReader>> | null = null, defaults: Awaited<ReturnType<typeof createDefaultObserver>> | null = null;
    let coordination: Awaited<ReturnType<typeof coordinationObserver>> | null = null, coordinationCleanup: unknown = null, finalEvents: unknown = null, defaultCleanup: unknown = null;
    let stream: Awaited<ReturnType<typeof createFeedbackEventStream>> | null = null, streamCleanup: unknown = null, inputsReceipt: unknown = null;
    let sourceBefore: ReturnType<typeof hashInputs> | null = null, sourceAfter: ReturnType<typeof hashInputs> | null = null;
    let firstNode: Awaited<ReturnType<Locator["elementHandle"]>> | null = null, secondNode: Awaited<ReturnType<Locator["elementHandle"]>> | null = null;
    let scopeNode: Awaited<ReturnType<Locator["elementHandle"]>> | null = null, editorNode: Awaited<ReturnType<Locator["elementHandle"]>> | null = null;
    let sessionRootNode: Awaited<ReturnType<typeof captureSessionRoot>> | null = null;
    const captured = { first: null as string | null, second: null as string | null };
    const scope = page.locator(MAIN);
    const shot = async (name: string) => { const path = info.outputPath(name + ".png"); await page.screenshot({ path, fullPage: true }); screenshots.push(path); };
    page.on("pageerror", (error) => errors.push(error.stack ?? String(error)));
    page.on("console", (message) => { if (message.type() === "error") consoleErrors.push({ text: message.text(), url: message.location().url }); });
    try {
      sourceBefore = hashInputs(); origin = new URL(String(info.project.use.baseURL)).origin;
      if (["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname)) throw Error("Owned LAN frontend required");
      stream = await createFeedbackEventStream(origin);
      await page.addInitScript(({ theme, custom, ownerA, ownerB, origin }) => {
        if (window !== window.top || location.origin !== origin) return;
        localStorage.setItem("kanban.session.native-model-picker-preferences", JSON.stringify({ state: { selectionMode: "model", enabledReasoningEfforts: ["low", "medium", "high", "xhigh", "ultra", "persistent"] }, version: 1 }));
        localStorage.setItem("kanban.session.theme-storage", JSON.stringify({ state: { theme }, version: 0 }));
        localStorage.setItem("kanban.session.model-settings", JSON.stringify({ state: { models: custom }, version: 2 }));
        localStorage.setItem("kanban.session.composer-v2", JSON.stringify({ [ownerA]: { contexts: [], drawings: {}, expanded: false, plain: true }, [ownerB]: { contexts: [], drawings: {}, expanded: false, plain: false } }));
      }, { theme, custom: CUSTOM, ownerA: OWNER_A, ownerB: OWNER_B, origin });
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
          if (!valid) { writes.push(entry); await route.fulfill({ status: 409, json: { error: "Catalog read contract mismatch" } }); return; }
          counts[index]++; await route.fulfill({ json: index === 0 ? { data: catalog, nextCursor: null } : [] }); return;
        }
        if (!["GET", "HEAD"].includes(entry.method) && !reads.has(path) && !bookkeeping.has(path)) { writes.push(entry); await route.fulfill({ status: 409, json: { error: "Unexpected mutation rejected" } }); return; }
        await route.fallback();
      });
      await page.goto("/?mode=session&view=agent", { waitUntil: "domcontentloaded" }); await scope.locator(EDITOR).first().waitFor();
      // The only fixture hydration occurs before genuine input; no later setters.
      await seedSessionUx(page, 2); const owners = await initializeJoint(page, { model: SOL, effort: "medium", serviceTier: "fast" });
      reader = await createReader(page, owners); inputsProbe = await observe(page);
      await expect.poll(async () => { const value = await read(page, reader!); return { owner: value.owner, id: value.currentThreadId }; }, { timeout: 5000, intervals: [25, 50, 100] }).toEqual({ owner: OWNER_A, id: "ux-0" });
      await scope.locator(EDITOR).first().fill(draft); await expect.poll(() => counts).toEqual([1, 1, 1, 1]);
      await expect.poll(async () => (await read(page, reader!)).cache.loaded).toBe(true); await expect.poll(async () => (await read(page, reader!)).eventStreamConnected).toBe(true); await settle(page);
      protection = await createProtectionReader(page); defaults = await createDefaultObserver(page);
      scopeNode = await scope.elementHandle(); editorNode = await scope.locator(EDITOR).first().elementHandle(); sessionRootNode = await captureSessionRoot(scope);
      if (!scopeNode || !editorNode) throw Error("Initial actual scope/editor identity handles missing");
      const baselineValue = await read(page, reader), baselineIdentity = await protection.evaluate((probe) => probe.read()), initialRecent = await recent(page);
      const expected = { model: SOL, reasoningEffort: "medium", revision: 4, changed: false };
      const record = async (name: string) => {
        if (states.length >= 16 || !scopeNode || !editorNode || !sessionRootNode) throw Error("Coordination phase limit or captured actual DOM handles missing"); phase = name;
        const row = { phase: name, value: await read(page, reader!), identity: await protection!.evaluate((probe) => probe.read()), scope: await inspectScope(scope),
          publication: await defaults!.evaluate((probe) => probe.read()), recent: await recent(page), tooltip: coordination ? await coordination.evaluate((probe, ids) => probe.read(ids), captured) : null,
          dom: { scope: await scope.evaluate((node, held) => node === held && held.isConnected, scopeNode),
            editor: await scope.locator(EDITOR).first().evaluate((node, held) => node === held && held.isConnected, editorNode),
            sessionRoot: await scope.evaluate((node, held) => node.closest(".session-mode") === held && held.isConnected, sessionRootNode) } };
        assertProtected(row.value, baselineValue, row.identity, baselineIdentity, OWNER_A, draft, false, catalog, expected);
        expect(row.dom).toEqual({ scope: true, editor: true, sessionRoot: true }); expect(row.scope.scopeKind).toBe("main");
        expect(row.scope.ownerAttribute).toBe(OWNER_A); expect(row.scope.editorText).toBe(draft); expect(row.publication.events).toEqual([]); expect(row.publication.mode).toBe("model");
        expect(row.publication.enabled).toEqual(["low", "medium", "high", "xhigh", "ultra", "persistent"]); expect(row.publication.sameEnabled).toBe(true); expect(row.publication.overflow).toBe(false); expect(row.recent).toEqual(initialRecent);
        expect(counts).toEqual([1, 1, 1, 1]); expect(writes).toEqual([]); expect(external).toEqual([]); expect(errors).toEqual([]); expect(unexpectedConsoleErrors(consoleErrors, origin)).toEqual([]);
        if (row.tooltip) { expect(row.tooltip.overflow).toBe(false); expect(row.tooltip.focused).toBe(true); expect(row.tooltip.viewport.overflow).toBeLessThanOrEqual(1); }
        states.push(row); return row;
      };
      await record("baseline");
      if (scenario.peer === "sidebar") {
        await page.getByRole("button", { name: "展开项目列表", exact: true }).click();
        const projects = page.getByRole("button", { name: "项目列表", exact: true });
        if (await projects.getAttribute("aria-expanded") === "false") await projects.click();
      }
      const first = scenario.peer === "sidebar" ? page.locator('[data-slot="sidebar-inner"] .session-project-sessions .session-row-title').filter({ hasText: new RegExp("^" + ROW_TITLE + "$") }) : scope.locator(".session-native-model-trigger");
      const second = scope.getByRole("button", { name: "附加文件", exact: true });
      await expect(first).toHaveCount(1); await expect(first).toBeVisible(); await expect(second).toBeVisible();
      firstNode = await first.elementHandle(); secondNode = await second.elementHandle(); if (!firstNode || !secondNode) throw Error("Actual peer handles missing");
      coordination = await coordinationObserver(first, second);
      await page.mouse.move(16, 16); await settle(page); await page.mouse.move(8, 8);
      await keyboardTo(page, first, "first-keyboard", tabs);
      await expect.poll(async () => (await coordination!.evaluate((probe, ids) => probe.read(ids), captured)).first.visible).toBe(true);
      const positiveFirst = await record("first-positive"); if (positiveFirst.tooltip === null) throw Error("Post-observer first-positive tooltip snapshot missing"); captured.first = positiveFirst.tooltip.first.nativeId; expect(captured.first).toMatch(/^\S+$/);
      if (scenario.peer === "sidebar") expect(positiveFirst.tooltip.first.label).toContain(ROW_TITLE); else expect(positiveFirst.tooltip.first.label).toBe("选择强度");
      const beforeForward = positiveFirst.tooltip.events.length;
      await hoverActual(page, second, "hover-second", points);
      await expect.poll(async () => (await coordination!.evaluate((probe, ids) => probe.read(ids), captured)).second.visible).toBe(true);
      quiescence.push(await settleContentAnimations(page)); const forward = await record("forward-after-hover"); if (forward.tooltip === null) throw Error("Post-observer forward-after-hover tooltip snapshot missing");
      captured.second = forward.tooltip.second.nativeId; expect(captured.second).toMatch(/^\S+$/); expect(forward.tooltip.second.label).toBe("附加文件@");
      const forwardEvents = forward.tooltip.events.slice(beforeForward);
      expect(positiveFirst.tooltip.first.hovered).toBe(false); expect(forward.tooltip.first.focus).toBe(true); expect(forward.tooltip.first.uid).toBe(positiveFirst.tooltip.first.uid);
      expect(forwardEvents.filter((event: any) => event.target === "first" && ["blur", "focusout", "pointerout", "pointerleave"].includes(event.type))).toEqual([]);
      expect(forwardEvents.some((event: any) => event.target === "second" && event.type === "pointermove" && event.trusted && event.pointerType === "mouse")).toBe(true);
      targets.push({ phase: "forward closes the still-focused old peer", actual: { visible: forward.tooltip.first.visible, describedby: forward.tooltip.first.describedby }, expected: { visible: false, describedby: null }, pass: !forward.tooltip.first.visible && forward.tooltip.first.describedby === null });
      await shot("forward");
      // Reset solely with real pointer movement and actual Tab. No product handler/focus call.
      await page.mouse.move(16, 16); await settle(page); await page.mouse.move(8, 8);
      await keyboardTo(page, second, "second-keyboard", tabs);
      await expect.poll(async () => (await coordination!.evaluate((probe, ids) => probe.read(ids), captured)).second.visible).toBe(true);
      const positiveSecond = await record("second-positive"); if (positiveSecond.tooltip === null) throw Error("Post-observer second-positive tooltip snapshot missing"); expect(positiveSecond.tooltip.second.focus).toBe(true);
      const beforeReverse = positiveSecond.tooltip.events.length;
      await hoverActual(page, first, "hover-first", points);
      await expect.poll(async () => (await coordination!.evaluate((probe, ids) => probe.read(ids), captured)).first.visible).toBe(true);
      quiescence.push(await settleContentAnimations(page)); const reverse = await record("reverse-after-hover"); if (reverse.tooltip === null) throw Error("Post-observer reverse-after-hover tooltip snapshot missing");
      const reverseEvents = reverse.tooltip.events.slice(beforeReverse);
      expect(positiveSecond.tooltip.second.hovered).toBe(false); expect(reverse.tooltip.second.focus).toBe(true); expect(reverse.tooltip.second.uid).toBe(forward.tooltip.second.uid);
      expect(reverseEvents.filter((event: any) => event.target === "second" && ["blur", "focusout", "pointerout", "pointerleave"].includes(event.type))).toEqual([]);
      expect(reverseEvents.some((event: any) => event.target === "first" && event.type === "pointermove" && event.trusted && event.pointerType === "mouse")).toBe(true);
      targets.push({ phase: "reverse closes the still-focused Common", actual: { visible: reverse.tooltip.second.visible, describedby: reverse.tooltip.second.describedby }, expected: { visible: false, describedby: null }, pass: !reverse.tooltip.second.visible && reverse.tooltip.second.describedby === null });
      await shot("reverse");
      expect(await first.evaluate((node, held) => node === held, firstNode)).toBe(true); expect(await second.evaluate((node, held) => node === held, secondNode)).toBe(true);
      const last = await record("final-hard-controls"); if (last.tooltip === null) throw Error("Post-observer final-hard-controls tooltip snapshot missing");
      expect(last.tooltip.events.filter((event: any) => event.target !== "other" && ["pointerdown", "click", "submit"].includes(event.type))).toEqual([]);
      expect(last.tooltip.events.every((event: any) => event.trusted)).toBe(true);
      expect(last.publication.events).toEqual([]); expect(last.value.settings).toEqual(baselineValue.settings); expect(last.value.entry).toEqual(baselineValue.entry);
      expect(last.identity.same.a).toBe(true); expect(last.identity.same.cache).toBe(true); expect(last.value.drafts).toEqual(baselineValue.drafts); expect(directory).toHaveLength(4);
      hardControlsCompleted = true;
    } catch (error) { failure = String(error); throw error; }
    finally {
      if (coordination) { try { finalEvents = await coordination.evaluate((probe, ids) => probe.read(ids), captured); coordinationCleanup = await coordination.evaluate((probe) => probe.dispose()); await coordination.dispose();
        const value = coordinationCleanup as { disposed: boolean; subscribed: boolean; retainedNodes: boolean; overflow: boolean }; if (!value.disposed || value.subscribed || value.retainedNodes || value.overflow) cleanupErrors.push("Coordination observer incomplete dispose"); } catch (error) { cleanupErrors.push(String(error)); } }
      if (inputsProbe) { try { inputsReceipt = await inputsProbe.evaluate((probe) => { const receipt = probe.read(); probe.dispose(); return receipt; }); await inputsProbe.dispose(); if ((inputsReceipt as { overflow: boolean }).overflow) cleanupErrors.push("Original input observer overflow"); } catch (error) { cleanupErrors.push(String(error)); } }
      if (defaults) { try { defaultCleanup = await defaults.evaluate((probe) => probe.dispose()); await defaults.dispose(); const value = defaultCleanup as { disposed: boolean; subscribed: boolean }; if (!value.disposed || value.subscribed) cleanupErrors.push("Default observer incomplete dispose"); } catch (error) { cleanupErrors.push(String(error)); } }
      if (protection) { try { await protection.evaluate((probe) => probe.dispose()); await protection.dispose(); } catch (error) { cleanupErrors.push(String(error)); } }
      if (reader) { try { await reader.dispose(); } catch (error) { cleanupErrors.push(String(error)); } }
      for (const handle of [firstNode, secondNode, scopeNode, editorNode, sessionRootNode]) if (handle) { try { await handle.dispose(); } catch (error) { cleanupErrors.push(String(error)); } }
      try { sourceAfter = hashInputs(); if (!isDeepStrictEqual(sourceAfter, sourceBefore)) cleanupErrors.push("Coordination input source drift"); } catch (error) { cleanupErrors.push(String(error)); }
      if (!page.isClosed()) { try { await page.close(); } catch (error) { cleanupErrors.push(String(error)); } }
      if (stream) { try { const closed = await stream.close(); streamCleanup = closed;
        if (!closed.closed || closed.listening || !closed.addressCleared || closed.activeResponses || closed.activeSockets || closed.serverErrorCount || closed.requestOverflow || closed.errors.length || closed.acceptedRequests < 1) cleanupErrors.push("Owned SSE incomplete close");
      } catch (error) { cleanupErrors.push(String(error)); } }
      if (!failure && cleanupErrors.length) failure = "Cleanup failure: " + cleanupErrors.join("; ");
      if (!failure && hardControlsCompleted && targets.some((check) => !check.pass)) failure = "Coordination mismatch after all hard controls and cleanup";
      const path = info.outputPath("composer-tooltip-coordination.json");
      writeFileSync(path, JSON.stringify({ caseId: scenario.id, width: scenario.width, surface: "main", phase, failure, hardControlsCompleted, states, targets, tabs, points, quiescence,
        finalEvents, coordinationCleanup, inputsReceipt, defaultCleanup, counts, directory, api, writes, external, errors, consoleErrors, unexpectedConsoleErrors: origin ? unexpectedConsoleErrors(consoleErrors, origin) : consoleErrors, screenshots, cleanupErrors, streamCleanup, sourceBefore, sourceAfter,
        boundary: "Two real-page controls only: desktop real sidebar SessionRowTitle versus attachment Common, and 390 simulated main model versus attachment Common. Bounded actual Tab plus trusted pointer movement; no direct focus, Locator.press, popup opening, row selection, fake peer, native/auth/task or settings write. CSS animation quiescence is independently bounded and never conditioned on target hidden. Physical opacity and all Content/neighbour/description IDs are retained; hidden role copies are not visual hints. Target closure assertions occur only after complete raw/ref/FI/draft/cache/read/no-write/owner/source and own observer/page/SSE cleanup; no physical-device or native GUI proof." }, null, 2) + "\n");
      await info.attach("composer-tooltip-coordination", { path, contentType: "application/json" });
    }
    expect(hardControlsCompleted).toBe(true); expect(cleanupErrors).toEqual([]); expect(targets).toHaveLength(2);
    expect(counts).toEqual([1, 1, 1, 1]); expect(directory).toHaveLength(4); expect(writes).toEqual([]); expect(external).toEqual([]); expect(errors).toEqual([]); expect(unexpectedConsoleErrors(consoleErrors, origin)).toEqual([]);
    expect(defaultCleanup).toMatchObject({ disposed: true, subscribed: false, eventCount: 0, overflow: false }); expect(sourceAfter).toEqual(sourceBefore);
    for (const check of targets) { expect.soft(check.actual, check.phase).toEqual(check.expected); expect.soft(check.pass, check.phase).toBe(true); }
  });
});
