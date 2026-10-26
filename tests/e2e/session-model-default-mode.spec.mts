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
const TERRA = "gpt-5.6-terra", SOL = "gpt-5.6-sol", TL = "E7 Terra", SL = "E7 Sol";
const OWNER_A = JSON.stringify(["codex", "", "session", "ux-0"]);
const OWNER_B = JSON.stringify(["codex", "", "session", "ux-1"]);
const CUSTOM = { "e7-custom-provider": [{ id: "e7-custom-model", name: "E7 保留自定义模型" }] };
const scenarios = [
  { id: "null-current", raw: null, mode: null, solEfforts: ["low", "medium", "high"] },
  { id: "default-holes", raw: "medium", mode: "model", solEfforts: ["medium", "xhigh"] },
] as const;
function model(id: string, label: string, efforts: readonly string[], defaultReasoningEffort: string, isDefault: boolean): Model {
  return { id, model: id, displayName: label,
    description: "Synthetic E7 ordinary local Default/pair catalog, not account/native eligibility",
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
  "tests/e2e/session-model-default-mode.spec.mts",
  "apps/web/src/session-mode/components/codex/composer/ConversationMenu.tsx",
  "apps/web/src/session-mode/components/codex/composer/ordinaryNativePickerModels.ts",
  "apps/web/src/session-mode/stores/settings/useNativeModelPickerPreferencesStore.ts",
  "apps/web/src/session-mode/services/nativeThreadPermissionMetadata.ts",
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
        effort: trigger?.querySelector(".session-native-model-effort")?.textContent ?? null,
        expanded: trigger?.getAttribute("aria-expanded") === "true",
        purpose: trigger?.querySelector(".session-native-model-trigger-placeholder")?.textContent ?? null } };
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
async function createWheelObservation(node: Locator) {
  return node.evaluateHandle((target) => {
    let overflow = false; const events: Array<Record<string, unknown>> = [];
    const listener = (event: Event) => {
      if (!(event instanceof WheelEvent)) return;
      if (events.length >= 8) { overflow = true; return; }
      events.push({ trusted: event.isTrusted, deltaX: event.deltaX, deltaY: event.deltaY, deltaMode: event.deltaMode, ctrlKey: event.ctrlKey, defaultPrevented: event.defaultPrevented, sameNode: event.currentTarget === target });
    };
    target.addEventListener("wheel", listener, { passive: true });
    return { read: () => ({ events: events.map((event) => ({ ...event })), overflow }), dispose: () => { target.removeEventListener("wheel", listener); return { disposed: true }; } };
  });
}
async function tabToPower(page: Page, menu: Locator) {
  await expect(menu).toBeFocused();
  const caption = menu.getByRole("menuitem", { name: "选择模型", exact: true });
  await expect(caption).toBeEnabled();
  await page.keyboard.press("ArrowDown");
  await expect(caption).toBeFocused();
  for (let count = 0; count <= 8; count++) {
    const active = await menu.evaluate((node) => Boolean(document.activeElement?.closest('[data-reasoning-slider]') && node.contains(document.activeElement)));
    if (active) return;
    if (count === 8) throw Error("Eight genuine Tabs could not reach the active Power control");
    await page.keyboard.press("Tab");
  }
}
async function menuDOM(menu: Locator) {
  return menu.evaluate((node) => {
    const active = document.activeElement;
    const radios = [...node.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].filter((row) => !row.closest('[hidden],[inert],[aria-hidden="true"]'));
    return { connected: node.isConnected, view: node.querySelector('[data-model-picker-view]')?.getAttribute('data-model-picker-view'),
      dots: [...node.querySelectorAll<HTMLElement>('.session-native-power-dot')].map((dot) => ({ left: dot.style.left, selected: dot.dataset.selected ?? null })),
      status: node.querySelector('[role="status"]')?.textContent ?? null,
      caption: [...node.querySelectorAll('[role="menuitem"]')].find((row) => row.textContent?.includes('选择模型'))?.textContent ?? null,
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
test.setTimeout(30_000);
for (const scenario of scenarios) for (const width of [1440, 390]) test.describe("E7 " + scenario.id + " " + width, () => {
  test.use({ viewport: { width, height: width === 390 ? 844 : 900 }, hasTouch: width === 390, isMobile: width === 390 });
  for (const surface of ["main", "expanded"] as const) test(surface + " genuine Default and local pair intent", async ({ page }, info) => {
    const theme = width === 1440 ? "dark" : "light", draft = "E7 retained draft " + scenario.id + " " + width + " " + surface;
    const catalog = [model(TERRA, TL, ["low"], "low", true), model(SOL, SL, scenario.solEfforts, "medium", false)];
    const counts = [0, 0, 0, 0]; const directory: unknown[] = [], writes: unknown[] = [], api: unknown[] = [], external: unknown[] = [];
    const errors: string[] = [], consoleErrors: Array<{ text: string; url: string }> = [], cleanupErrors: string[] = [], screenshots: string[] = [];
    const states: Array<{ phase: string; value: any; identity: any; scope: any; publication: any; menu: any }> = [];
    const finalProjections: Array<() => void> = [];
    const setup = { timeoutMs: 5000, ringCapacity: 64, reads: 0, discarded: 0, matched: false,
      samples: [] as Array<{ read: number; now: number; currentThreadId: string | null; owner: string | null }> };
    let origin = "", phase = "setup", failure: string | null = null;
    let reader: Awaited<ReturnType<typeof createReader>> | null = null, inputObserver: Awaited<ReturnType<typeof observe>> | null = null;
    let protection: Awaited<ReturnType<typeof createProtectionReader>> | null = null, defaults: Awaited<ReturnType<typeof createDefaultObserver>> | null = null;
    let wheelObserver: Awaited<ReturnType<typeof createWheelObservation>> | null = null;
    let stream: Awaited<ReturnType<typeof createFeedbackEventStream>> | null = null, streamCleanup: unknown = null;
    let inputEvents: unknown = null, defaultReceipt: unknown = null, defaultCleanup: unknown = null, wheelReceipt: unknown = null;
    let draftNode: Awaited<ReturnType<ReturnType<typeof page.locator>["elementHandle"]>> | null = null;
    let sourceBefore: ReturnType<typeof hashInputs> | null = null, sourceAfter: ReturnType<typeof hashInputs> | null = null;
    let scope = page.locator(MAIN), menu: Locator | null = null;
    const record = async (name: string) => {
      if (!reader || !protection || !defaults || states.length >= 32) throw Error("Read-only Default probes missing or phase cap exceeded");
      phase = name; const row = { phase: name, value: await read(page, reader), identity: await protection.evaluate((probe) => probe.read()),
        scope: await inspectScope(scope), publication: await defaults.evaluate((probe) => probe.read()), menu: menu && await menu.count() ? await menuDOM(menu) : null };
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
          if (!valid) { writes.push(entry); await route.fulfill({ status: 409, json: { error: "E7 catalog read contract mismatch" } }); return; }
          counts[index]++; await route.fulfill({ json: index === 0 ? { data: catalog, nextCursor: null } : [] }); return;
        }
        if (!["GET", "HEAD"].includes(entry.method) && !reads.has(path) && !bookkeeping.has(path)) { writes.push(entry); await route.fulfill({ status: 409, json: { error: "E7 unexpected mutation rejected" } }); return; }
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
      let expected = { model: SOL, reasoningEffort: scenario.raw as string | null, revision: baseline.value.entry.revision as number, changed: false };
      const protect = (row: typeof baseline, expanded: boolean) => {
        assertProtected(row.value, baseline.value, row.identity, baseline.identity, owners.owner, draft, expanded, catalog, expected);
        expect(row.scope.editorText).toBe(draft); expect(row.scope.scopeKind).toBe(expanded ? "expanded" : "main");
        expect(row.scope.ownerAttribute).toBe(expanded ? null : owners.owner); expect(row.publication.sameEnabled).toBe(true); expect(row.publication.overflow).toBe(false);
        if (row.scope.trigger.expanded && row.value.modelMenu?.view === "simple") {
          expect(row.scope.trigger.model).toBeNull(); expect(row.scope.trigger.rawAria).toBeNull();
          expect(row.scope.trigger.purpose).toBe(row.publication.mode === "default" ? "选择模型" : "选择强度");
        } else {
          expect(row.scope.trigger.model).toBe(expected.model === SOL ? SL : TL);
          expect(row.scope.trigger.rawAria).toBe("模型：" + expected.model + "，" + (expected.reasoningEffort ?? "medium"));
        }
        expect(row.publication.enabled).toEqual(["low", "medium", "high", "xhigh", "ultra", "persistent"]);
      };
      protect(baseline, false); expect(baseline.publication.mode).toBe(scenario.mode); expect(baseline.value.entry).toMatchObject({ revision: 4, pending: false, pendingFields: [], serviceTier: "fast" });
      if (surface === "expanded") {
        await scope.getByRole("button", { name: "附加文件", exact: true }).click(); await page.getByRole("button", { name: "展开编辑", exact: true }).click();
        await page.getByRole("dialog", { name: "展开编辑", exact: true }).waitFor(); scope = page.locator(".session-mode .session-composer-sheet.is-full");
        await expect(scope).toHaveCount(1); await expect(scope).toBeVisible(); await expect.poll(() => scope.locator(EDITOR).first().evaluate((node) => node instanceof HTMLTextAreaElement ? node.value : node.textContent)).toBe(draft);
      }
      const trigger = scope.locator(".session-native-model-trigger"); await expect(trigger).toBeVisible(); await expect(trigger).toBeEnabled();
      const closed = await record("closed-before"); protect(closed, surface === "expanded"); expect(closed.publication.mode).toBe(scenario.mode); expect(await recent(page)).toEqual(initialRecent);
      await trigger.click(); menu = page.locator(".session-native-model-menu").filter({ visible: true }); await menu.waitFor();
      await menu.evaluate(async (node) => { await Promise.all(node.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => {}))); });
      const opened = await record("opened"); protect(opened, surface === "expanded"); expect(await recent(page)).toEqual(initialRecent); await shot("opened");
      await menu.getByRole("menuitem", { name: "选择模型", exact: true }).click(); await expect(menu.locator('[data-model-picker-view="advanced"]')).toBeVisible(); await settle(page);
      const advanced = await record("advanced"); protect(advanced, surface === "expanded"); expect(await recent(page)).toEqual(initialRecent);
      await shot("advanced");
      const defaultRow = menu.getByRole("menuitemradio", { name: /^默认/ });
      if (scenario.id === "null-current") {
        const present = await defaultRow.count(), current = menu.getByRole("menuitemradio", { name: SL, exact: true });
        await expect(current).toBeEnabled(); const oldChecked = await current.getAttribute("aria-checked");
        await current.click(); await expect(menu.locator('[data-model-picker-view="simple"]')).toBeVisible(); await settle(page);
        const selected = await record("current-row"); protect(selected, surface === "expanded");
        expect(selected.value.entry).toEqual(baseline.value.entry); expect(selected.identity.same.a).toBe(true);
        const recents = await recent(page); expect(recents[0]).toMatchObject({ model: SOL, reasoningEffort: null, serviceTier: "fast" });
        expect(recents.slice(1)).toEqual(initialRecent.slice(0, 7));
        await shot("current-row");
        // Defer all soft target projections until the final hard IO/focus/cleanup prerequisites below.
        finalProjections.push(() => {
        expect.soft(opened.value.modelMenu?.dots).toBe(4); expect.soft(opened.publication.mode).toBe("default");
        expect.soft(present).toBe(1); expect.soft(oldChecked).toBe("false");
        if (present === 1) { const d = capturedMenu(advanced).radios.find((row: any) => row.text?.startsWith("默认")); expect.soft(d?.checked).toBe("true"); expect.soft(d?.text).toContain("推荐模型集"); }
        expect.soft(selected.publication.mode).toBe("model"); expect.soft(selected.publication.events).toEqual([{ kind: "mode", mode: "default" }, { kind: "mode", mode: "model" }]);
        expect.soft(selected.value.modelMenu?.dots).toBe(3);
        expect.soft(capturedMenu(opened).effortAccent).toBe("false"); expect.soft(capturedMenu(selected).effortAccent).toBe("true");
        });
      } else {
        await expect(defaultRow).toBeEnabled(); await expect(defaultRow).toHaveAttribute("aria-checked", "false"); expect(await defaultRow.textContent()).toContain("推荐模型集");
        await defaultRow.click(); await expect(menu.locator('[data-model-picker-view="simple"]')).toBeVisible(); await settle(page);
        expected = { model: TERRA, reasoningEffort: "low", revision: baseline.value.entry.revision + 1, changed: true };
        const chosenDefault = await record("default-started"); protect(chosenDefault, surface === "expanded"); expect(await recent(page)).toEqual(initialRecent);
        expect(chosenDefault.publication.mode).toBe("default");
        expect(chosenDefault.publication.events).toEqual([{ kind: "mode", mode: "default" }, { kind: "intent", ...expected, serviceTier: "fast", mode: "default" }].map(({ changed: _changed, ...event }: any) => event));
        expect(chosenDefault.value.modelMenu?.dots).toBe(3); expect(capturedMenu(chosenDefault).status).toContain("第 1 项，共 3 项");
        expect(capturedMenu(chosenDefault).dots.map((dot: any) => dot.left)).toEqual(["13px", "100px", "187px"]);
        await tabToPower(page, menu); await page.keyboard.press("ArrowRight"); await settle(page);
        expected = { model: SOL, reasoningEffort: "medium", revision: baseline.value.entry.revision + 2, changed: true };
        const arrow = await record("power-arrow"); protect(arrow, surface === "expanded"); expect(capturedMenu(arrow).status).toContain("第 2 项，共 3 项");
        const slider = menu.locator(".session-native-power-slider"); wheelObserver = await createWheelObservation(slider);
        const bounds = await slider.boundingBox(); if (!bounds) throw Error("Visible Power bounds missing");
        await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2); await page.mouse.wheel(0, -35);
        await expect.poll(async () => (await read(page, reader!)).settings.reasoningEffort).toBe("xhigh"); await settle(page);
        expected = { model: SOL, reasoningEffort: "xhigh", revision: baseline.value.entry.revision + 3, changed: true };
        const wheeled = await record("power-wheel"); protect(wheeled, surface === "expanded"); expect(capturedMenu(wheeled).status).toContain("第 3 项，共 3 项");
        const currentBounds = await slider.boundingBox(); if (!currentBounds) throw Error("Current Power bounds missing");
        await page.mouse.click(currentBounds.x + 6, currentBounds.y + currentBounds.height / 2); await settle(page);
        expected = { model: TERRA, reasoningEffort: "low", revision: baseline.value.entry.revision + 4, changed: true };
        const pointer = await record("power-pointer"); protect(pointer, surface === "expanded"); expect(capturedMenu(pointer).status).toContain("第 1 项，共 3 项");
        expect(pointer.publication.mode).toBe("default"); expect(pointer.publication.events.filter((event: any) => event.kind === "mode")).toEqual([{ kind: "mode", mode: "default" }]);
        expect(pointer.publication.events.filter((event: any) => event.kind === "intent").map((event: any) => ({ model: event.model, reasoningEffort: event.reasoningEffort, serviceTier: event.serviceTier, revision: event.revision }))).toEqual([
          { model: TERRA, reasoningEffort: "low", serviceTier: "fast", revision: baseline.value.entry.revision + 1 },
          { model: SOL, reasoningEffort: "medium", serviceTier: "fast", revision: baseline.value.entry.revision + 2 },
          { model: SOL, reasoningEffort: "xhigh", serviceTier: "fast", revision: baseline.value.entry.revision + 3 },
          { model: TERRA, reasoningEffort: "low", serviceTier: "fast", revision: baseline.value.entry.revision + 4 },
        ]);
        expect((await recent(page))[0]).toMatchObject({ model: TERRA, label: TL, reasoningEffort: "low", serviceTier: "fast" });
        wheelReceipt = await wheelObserver.evaluate((probe) => probe.read());
        expect(wheelReceipt).toMatchObject({ overflow: false, events: [{ trusted: true, deltaX: 0, deltaY: -35, deltaMode: 0, ctrlKey: false, defaultPrevented: true, sameNode: true }] });
        await shot("compact-power");
        finalProjections.push(() => {
          expect.soft(capturedMenu(opened).effortAccent).toBe("true");
          for (const state of [chosenDefault, arrow, wheeled, pointer]) expect.soft(capturedMenu(state).effortAccent).toBe("false");
        });
      }
      const lastRecent = await recent(page); await page.keyboard.press("Escape"); await menu.waitFor({ state: "detached" }); menu = null;
      await expect(scope.locator(EDITOR).first()).toBeFocused(); const escaped = await record("menu-escaped"); protect(escaped, surface === "expanded");
      if (surface === "expanded") {
        await page.getByRole("button", { name: "返回并保留草稿", exact: true }).click(); await scope.waitFor({ state: "detached" }); scope = page.locator(MAIN);
        await expect(scope.locator(EDITOR).first()).toBeFocused();
      }
      await settle(page); const final = await record("final-closed"); protect(final, false); expect(await recent(page)).toEqual(lastRecent);
      expect(await page.locator(MAIN).locator(EDITOR).first().evaluate((node, old) => node === old, draftNode)).toBe(true);
      expect(counts).toEqual([1, 1, 1, 1]); expect(writes).toEqual([]); expect(external).toEqual([]); expect(errors).toEqual([]);
      expect(consoleErrors.filter((item) => !(item.url === origin + "/@vite/client" && item.text.startsWith("[vite] failed to connect to websocket.")))).toEqual([]);
      const observed = await inputObserver.evaluate((probe) => probe.read()); expect(observed.overflow).toBe(false); expect(observed.events.filter((event) => event.type === "submit")).toEqual([]);
      expect(observed.events.filter((event) => event.type === "click" || event.type === "keydown").every((event) => event.trusted)).toBe(true);
      const radioClicks = observed.events.filter((event) => event.type === "click" && event.role === "menuitemradio"); expect(radioClicks).toHaveLength(1);
      expect(radioClicks[0]).toMatchObject({ trusted: true, inModelMenu: true }); expect(radioClicks[0].text).toContain(scenario.id === "null-current" ? SL : "默认");
      await shot("final-closed");
      finalProjections.forEach((assertProjection) => assertProjection());
    } catch (error) { failure = String(error); throw error; }
    finally {
      const assertionErrors = info.errors.map((error) => error.message ?? String(error.value ?? "Unknown test error")); if (!failure && assertionErrors.length) failure = assertionErrors[0];
      if (inputObserver) { try { inputEvents = await inputObserver.evaluate((probe) => probe.read()); await inputObserver.evaluate((probe) => probe.dispose()); await inputObserver.dispose(); } catch (error) { cleanupErrors.push(String(error)); } }
      if (reader && protection && defaults && !page.isClosed()) { try { await record("finally"); } catch (error) { cleanupErrors.push(String(error)); } }
      if (wheelObserver) { try { wheelReceipt = await wheelObserver.evaluate((probe) => probe.read()); await wheelObserver.evaluate((probe) => probe.dispose()); await wheelObserver.dispose(); } catch (error) { cleanupErrors.push(String(error)); } }
      if (defaults) { try { defaultReceipt = await defaults.evaluate((probe) => probe.read()); defaultCleanup = await defaults.evaluate((probe) => probe.dispose());
        if (!(defaultCleanup as { disposed?: boolean }).disposed || (defaultCleanup as { subscribed?: boolean }).subscribed !== false) cleanupErrors.push("Default subscriptions did not release"); await defaults.dispose();
      } catch (error) { cleanupErrors.push(String(error)); } }
      if (protection) { try { await protection.evaluate((probe) => probe.dispose()); await protection.dispose(); } catch (error) { cleanupErrors.push(String(error)); } }
      if (reader) { try { await reader.dispose(); } catch (error) { cleanupErrors.push(String(error)); } }
      if (!page.isClosed()) { try { await shot("finally"); } catch (error) { cleanupErrors.push(String(error)); } }
      if (draftNode) { try { await draftNode.dispose(); } catch (error) { cleanupErrors.push(String(error)); } }
      try { sourceAfter = hashInputs(); if (!isDeepStrictEqual(sourceAfter, sourceBefore)) cleanupErrors.push("E7 input source drift"); } catch (error) { cleanupErrors.push(String(error)); }
      try { await page.close(); } catch (error) { cleanupErrors.push(String(error)); }
      if (stream) { try { const closed = await stream.close(); streamCleanup = closed;
        if (!closed.closed || closed.listening || !closed.addressCleared || closed.activeResponses || closed.activeSockets || closed.serverErrorCount || closed.requestOverflow || closed.errors.length || closed.acceptedRequests < 1) cleanupErrors.push("Owned SSE incomplete close");
      } catch (error) { cleanupErrors.push(String(error)); } }
      const cleanupOnlyFailure = cleanupErrors.length > 0 && !failure; if (cleanupOnlyFailure) failure = "Cleanup failure: " + cleanupErrors.join("; ");
      const path = info.outputPath("model-default-mode.json");
      writeFileSync(path, JSON.stringify({ caseId: scenario.id, width, surface, theme, origin, phase, failure, assertionErrors, setup,
        fixture: { current: SOL, rawEffort: scenario.raw, initialMode: scenario.mode, initialTier: "fast", catalog, custom: CUSTOM },
        states, counts, directory, api, writes, external, errors, consoleErrors, inputEvents, defaultReceipt, defaultCleanup, wheelReceipt, screenshots, cleanupErrors, streamCleanup, sourceBefore, sourceAfter,
        boundary: "Eight local ordinary Default/FI/pair synthetic fixtures with real page main or real ComposerSheet. No authenticated account/real catalog/native RPC/SDK/physical-device/native eligibility or atomic CAS claim. UI intentionally may change own FI and local pending settings. Initial storage/seed/initialize occurs before first UI input; afterward only real pointer/keyboard/wheel actions plus bounded passive actual-module readers/subscriptions run. No post-action setter/hydrate/load/choose. Captured 350ms/layer/owner controls and commands current gt remain separately covered by real unit and retained suites. Opened Trigger placeholder, complete Lti/Pti permissions and original GUI pixel parity remain outside this core batch." }, null, 2) + "\n");
      await info.attach("model-default-mode", { path, contentType: "application/json" }); if (cleanupOnlyFailure) throw Error("Owned fixture cleanup failed: " + cleanupErrors.join("; "));
    }
  });
});
