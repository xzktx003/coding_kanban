import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import {
  expect,
  test,
  type Page,
  type Request as PlaywrightRequest,
  type Response as PlaywrightResponse,
} from "@playwright/test";
import type {
  Model,
  ModelListResponse,
} from "../../apps/web/src/session-mode/bindings/v2";
import type {
  ConfigProvider,
  ModelListItem,
  ProviderPreset,
} from "../../apps/web/src/session-mode/components/codex/types";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";

const CURRENT = "r19-current",
  ALTERNATE = "r19-alternate",
  SINGLE = "r19-medium-only",
  OTHER = "r19-other-owner";
const MAIN = ".session-codex-composer",
  EXPANDED = ".session-composer-sheet.is-full";
const EDITOR = '[contenteditable="true"], .session-rich-draft textarea';
const inputs = [
  "apps/web/src/session-mode/components/codex/composer/nativeReasoningOptions.ts",
  "apps/web/src/session-mode/components/codex/composer/NativeModelSelector.tsx",
  "apps/web/src/session-mode/components/codex/composer/NativeModelTrigger.tsx",
  "apps/web/src/session-mode/components/codex/composer/ReasoningEffortSelector.tsx",
  "apps/web/src/session-mode/components/codex/composer/nativeReasoningLabel.ts",
  "apps/web/src/session-mode/components/codex/composer/NativeServiceTierControl.tsx",
  "apps/web/src/session-mode/components/codex/composer/recentModelConfigs.ts",
  "apps/web/src/session-mode/components/codex/composer/NativeComposerIcon.tsx",
  "apps/web/src/session-mode/session-dom.ts",
  "apps/web/src/session-mode/stores/useLayoutStore.ts",
  "apps/web/src/session-mode/components/codex/hooks/useModels.ts",
  "apps/web/src/session-mode/components/codex/types/models.ts",
  "apps/web/src/session-mode/components/codex/stores/useConfigStore.ts",
  "apps/web/src/session-mode/components/codex/stores/useCodexStore.ts",
  "apps/web/src/session-mode/hooks/useThreadModelSettings.ts",
  "apps/web/src/session-mode/stores/useThreadModelStore.ts",
  "apps/web/src/session-mode/stores/useSessionDraftStore.ts",
  "apps/web/src/session-mode/stores/useAgentCenterStore.ts",
  "apps/web/src/session-mode/components/ui/dropdown-menu.tsx",
  "apps/web/src/session-mode/components/codex/composer/v2/ComposerSheet.tsx",
  "apps/web/src/session-mode/components/codex/composer/v2/useComposerSheetHistory.ts",
  "apps/web/src/session-mode/components/codex/composer/composer-native.css",
  "apps/web/src/session-mode/session-composer-compact.css",
  "apps/web/src/session-mode/services/apiAdapt/codex.ts",
  "apps/web/src/session-mode/services/apiAdapt/shared.ts",
  "tests/e2e/session-ux-fixture.ts",
  "tests/e2e/session-model-menu-selection-view.spec.ts",
];
const hashes = () =>
  inputs.map((path) => ({
    path,
    sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
  }));
const businessPattern =
  /\/(?:turn\/(?:start|steer|interrupt)|thread\/(?:start|resume|fork|delete)|followups\/(?:submit|change|stop)|goal\/(?:set|clear)|config\/(?:write|batch-write))$/;
type Case = {
  name: string;
  activation: "pointer" | "Enter" | "Space";
  target: string;
  view: "simple" | "advanced";
  focus: "menu" | "first-item" | "radio";
  retry?: true;
};
const cases: Case[] = [
  {
    name: "pointer-current-simple-container",
    activation: "pointer",
    target: CURRENT,
    view: "simple",
    focus: "menu",
  },
  {
    name: "enter-current-simple-first-item",
    activation: "Enter",
    target: CURRENT,
    view: "simple",
    focus: "first-item",
  },
  {
    name: "space-alternate-simple-first-item",
    activation: "Space",
    target: ALTERNATE,
    view: "simple",
    focus: "first-item",
  },
  {
    name: "enter-single-medium-keeps-advanced-radio",
    activation: "Enter",
    target: SINGLE,
    view: "advanced",
    focus: "radio",
  },
  {
    name: "pointer-search-diagnostic-load-after-singleton-enter",
    activation: "Enter",
    target: CURRENT,
    view: "simple",
    focus: "menu",
    retry: true,
  },
];
function directory(currentEfforts = ["low", "medium", "high"]) {
  const models: Model[] = [ALTERNATE, CURRENT, SINGLE].map((id, index) => ({
    id,
    model: id,
    displayName: ["R19 另一模型", "R19 当前模型", "R19 仅中档"][index],
    description: "Isolated complete advanced selection/view fixture",
    upgrade: null,
    upgradeInfo: null,
    availabilityNux: null,
    hidden: false,
    isDefault: index === 0,
    supportedReasoningEfforts: [["medium", "high"], currentEfforts, ["medium"]][
      index
    ].map((reasoningEffort) => ({
      reasoningEffort,
      description: reasoningEffort,
    })),
    defaultReasoningEffort: "medium",
    inputModalities: ["text", "image"],
    supportsPersonality: false,
    additionalSpeedTiers: [],
    serviceTiers: [],
    defaultServiceTier: null,
  }));
  const response: ModelListResponse = { data: models, nextCursor: null };
  return {
    response,
    providers: [] as ConfigProvider[],
    other: [],
    presets: [] as ProviderPreset[],
    grouped: {} as Record<string, ModelListItem[]>,
  };
}

const storeModulePaths = [
  "/src/session-mode/components/codex/stores/index.ts",
  "/src/session-mode/components/codex/stores/useCodexStore.ts",
] as const;

// Read only modules already requested by this page. Preserve the original
// direct reader and its assertions; this records whether it is the barrel store.
async function readStoreIdentity(
  page: Page,
  stage: string,
  originalDirectURL?: string,
) {
  return page.evaluate(
    async ({ paths, stage, originalDirectURL }) => {
      const all = performance.getEntriesByType("resource").filter((entry) =>
        paths.some((path) => path === new URL(entry.name).pathname),
      );
      const resources = all.slice(-64).map((entry) => ({
        url: entry.name,
        startTime: entry.startTime,
        responseEnd: (entry as PerformanceResourceTiming).responseEnd,
        initiatorType: (entry as PerformanceResourceTiming).initiatorType,
      }));
      const latest = (path: string) =>
        all.findLast((entry) => new URL(entry.name).pathname === path)?.name;
      const barrelURL = latest(paths[0]),
        latestDirectURL = latest(paths[1]),
        directURL = originalDirectURL ?? latestDirectURL;
      if (!barrelURL || !directURL || !all.some((entry) => entry.name === directURL))
        return {
          stage,
          now: performance.now(),
          resources,
          resourceOverflow: all.length > 64,
          error: "A naturally requested barrel/direct module URL is unavailable",
          barrelURL,
          directURL,
          latestDirectURL,
        };
      const [barrel, direct] = await Promise.all([
        import(barrelURL),
        import(directURL),
      ]);
      const barrelState = barrel.useCodexStore.getState(),
        directState = direct.useCodexStore.getState();
      const project = (state: {
        currentThreadId: string | null;
        currentTurnId: string | null;
        threads: Array<{ id: string }>;
        activeThreadIds: string[];
        historyLoadedMap: Record<string, boolean>;
        historyLoadingMap: Record<string, boolean>;
        historyErrorMap: Record<string, unknown>;
      }) => ({
        currentThreadId: state.currentThreadId,
        currentTurnId: state.currentTurnId,
        threadIds: state.threads.slice(0, 512).map((thread) => thread.id),
        activeThreadIds: state.activeThreadIds.slice(0, 512),
        historyLoaded: Object.entries(state.historyLoadedMap).slice(0, 512),
        historyLoading: Object.entries(state.historyLoadingMap).slice(0, 512),
        historyErrorThreadIds: Object.keys(state.historyErrorMap).slice(0, 512),
        overflow: state.threads.length > 512 || state.activeThreadIds.length > 512 ||
          [state.historyLoadedMap, state.historyLoadingMap, state.historyErrorMap]
            .some((map) => Object.keys(map).length > 512),
      });
      return {
        stage,
        now: performance.now(),
        resources,
        resourceOverflow: all.length > 64,
        barrelURL,
        directURL,
        latestDirectURL,
        originalDirectURL: originalDirectURL ?? null,
        storeEqual: barrel.useCodexStore === direct.useCodexStore,
        stateEqual: barrelState === directState,
        barrel: project(barrelState),
        direct: project(directState),
        composerOwners: [...document.querySelectorAll(".session-codex-composer")]
          .slice(0, 8).map((element) => ({
            owner: element.getAttribute("data-draft-owner"),
            hiddenOrInert: Boolean(element.closest("[hidden],[inert]")),
          })),
        error: null,
      };
    },
    { paths: [...storeModulePaths], stage, originalDirectURL },
  );
}

async function initialize(page: Page) {
  return page.evaluate(
    async ({ current, other }) => {
      const load = (path: string) =>
        import(
          performance
            .getEntriesByType("resource")
            .findLast((entry) => new URL(entry.name).pathname === path)?.name ??
            path
        );
      const [
        { useConfigStore },
        { useThreadModelStore },
        { useSessionDraftStore, sessionDraftKey },
        { useAgentCenterStore },
        { useLayoutStore },
      ] = await Promise.all([
        load("/src/session-mode/components/codex/stores/useConfigStore.ts"),
        load("/src/session-mode/stores/useThreadModelStore.ts"),
        load("/src/session-mode/stores/useSessionDraftStore.ts"),
        load("/src/session-mode/stores/useAgentCenterStore.ts"),
        load("/src/session-mode/stores/useLayoutStore.ts"),
      ]);
      const settings = {
        model: current,
        modelProvider: "openai",
        reasoningEffort: "medium",
        providerModels: { openai: current },
        serviceTier: null,
        sandbox: "workspace-write",
        sandboxPolicy: null,
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        autoReviewCapability: null,
        webSearchRequest: false,
        collaborationMode: "default",
        personality: null,
      };
      // Explicit synthetic initial hydration only; no model-cache setter or later UI substitute.
      useConfigStore.setState({ ...settings, personality: "friendly" });
      useThreadModelStore.setState({
        threads: {
          ...useThreadModelStore.getState().threads,
          "ux-0": {
            ...settings,
            revision: 4,
            pending: false,
            pendingFields: [],
          },
          [other]: {
            ...settings,
            model: "r19-other-model",
            reasoningEffort: "high",
            providerModels: { openai: "r19-other-model" },
            revision: 7,
            pending: false,
            pendingFields: [],
          },
        },
      });
      const otherOwner = sessionDraftKey("codex", other);
      useSessionDraftStore
        .getState()
        .setText(otherOwner, "R19 另一 owner 的草稿");
      useLayoutStore.setState({ isSidebarOpen: false });
      useAgentCenterStore.getState().addAgentCard(
        {
          kind: "codex",
          id: "ux-0",
          cwd: "/fixture/项目/very-long-project-path-for-ui-regression",
          preview: "R19 原生目录选行视图验收",
        },
        { activate: true },
      );
      return otherOwner as string;
    },
    { current: CURRENT, other: OTHER },
  );
}
async function createReader(page: Page, otherOwner: string, partialInitial = false) {
  return page.evaluateHandle(
    async ({ other, otherOwner, partialInitial }) => {
      const paths = [
        "/src/session-mode/components/codex/stores/useConfigStore.ts",
        "/src/session-mode/components/codex/stores/useCodexStore.ts",
        "/src/session-mode/stores/useThreadModelStore.ts",
        "/src/session-mode/stores/useSessionDraftStore.ts",
        "/src/session-mode/components/codex/hooks/useModels.ts",
      ];
      const moduleURLs = paths.map((path) => {
        const url = performance
          .getEntriesByType("resource")
          .findLast((entry) => new URL(entry.name).pathname === path)?.name;
        if (!url) throw new Error("Mounted module unavailable: " + path);
        return url;
      });
      const [
        { useConfigStore },
        { useCodexStore },
        { useThreadModelStore, getThreadModelSettings },
        { useSessionDraftStore },
        { useModelCacheStore },
      ] = await Promise.all(moduleURLs.map((url) => import(url)));
      const project = (value: Record<string, unknown>) =>
        Object.fromEntries(
          [
            "model",
            "modelProvider",
            "reasoningEffort",
            "providerModels",
            "serviceTier",
            "sandbox",
            "sandboxPolicy",
            "approvalPolicy",
            "approvalsReviewer",
            "autoReviewCapability",
            "webSearchRequest",
            "collaborationMode",
            "personality",
          ]
            .filter((key) => key in value)
            .map((key) => [key, value[key]]),
        );
      const rect = (element: Element | null) => {
        if (!element) return null;
        const r = element.getBoundingClientRect();
        return {
          x: r.x,
          y: r.y,
          right: r.right,
          bottom: r.bottom,
          width: r.width,
          height: r.height,
        };
      };
      type CacheAnchor = {
        array: Model[];
        models: unknown[];
        options: unknown[];
        other: unknown;
        providers: unknown;
        presets: unknown;
      };
      let initial: CacheAnchor | null = null,
        reloaded: CacheAnchor | null = null;
      // Only the diagnostic case accepts a completed partial aggregate read.
      // Its first anchor requires actual model/list success and provenance.
      // The other cases retain the original aggregate loaded precondition.
      return (selector: string) => {
        const cache = useModelCacheStore.getState();
        const canAnchorInitial = cache.loaded ||
          (partialInitial && !cache.loading && cache.modelStatus === "success" &&
            cache.modelSnapshot === cache.openAiModels);
        if (canAnchorInitial && !initial)
          initial = {
            array: cache.openAiModels,
            models: [...cache.openAiModels],
            options: cache.openAiModels.map(
              (model: Model) => model.supportedReasoningEfforts,
            ),
            other: cache.otherModels,
            providers: cache.configProviders,
            presets: cache.presets,
          };
        if (
          cache.loaded &&
          !cache.error &&
          initial &&
          cache.openAiModels !== initial.array &&
          !reloaded
        )
          reloaded = {
            array: cache.openAiModels,
            models: [...cache.openAiModels],
            options: cache.openAiModels.map(
              (model: Model) => model.supportedReasoningEfforts,
            ),
            other: cache.otherModels,
            providers: cache.configProviders,
            presets: cache.presets,
          };
        const currentThreadId = useCodexStore.getState().currentThreadId;
        const threads = useThreadModelStore.getState().threads;
        const scope = document.querySelector(selector);
        const main = document.querySelector(".session-codex-composer");
        const editor =
          scope?.querySelector(
            '[contenteditable="true"], .session-rich-draft textarea',
          ) ?? null;
        const text = (element: Element | null) =>
          element instanceof HTMLTextAreaElement
            ? element.value
            : (element?.textContent ?? null);
        const trigger =
          scope?.querySelector(".session-native-model-trigger") ?? null;
        const menu = document.querySelector(".session-native-model-menu");
        const power = menu?.querySelector("[data-reasoning-slider]") ?? null;
        const owner = main?.getAttribute("data-draft-owner") ?? null;
        const active = document.activeElement;
        return {
          now: performance.now(),
          moduleURLs,
          currentThreadId,
          owner,
          settings: project(getThreadModelSettings(currentThreadId)),
          defaults: project(useConfigStore.getState()),
          entry: currentThreadId ? (threads[currentThreadId] ?? null) : null,
          otherThreads: Object.fromEntries(
            Object.entries(threads).filter(([id]) => id !== currentThreadId),
          ),
          otherSettings: threads[other] ?? null,
          draft: owner
            ? (useSessionDraftStore.getState().drafts[owner] ?? null)
            : null,
          otherDraft:
            useSessionDraftStore.getState().drafts[otherOwner] ?? null,
          editorText: text(editor),
          mainEditorText: text(
            main?.querySelector('[contenteditable="true"]') ?? null,
          ),
          active: active
            ? {
                tag: active.tagName,
                role: active.getAttribute("role"),
                label: active.getAttribute("aria-label"),
                text: active.textContent?.slice(0, 96),
              }
            : null,
          activeIsEditor: active === editor,
          activeIsTrigger: active === trigger,
          activeIsPower: active === power,
          activeIsMenu: active === menu,
          activeIsCaption:
            active === menu?.querySelector(".session-native-power-caption"),
          activeRadioLabel:
            active?.getAttribute("role") === "menuitemradio"
              ? active.textContent
              : null,
          trigger: {
            label: trigger?.getAttribute("aria-label"),
            model: trigger?.querySelector(".session-native-model-label")
              ?.textContent,
            effort: trigger?.querySelector(".session-native-model-effort")
              ?.textContent,
          },
          modelRead: {
            status: cache.modelStatus as "pending" | "success" | "error",
            acceptedSnapshot: cache.modelSnapshot === cache.openAiModels,
          },
          cache: {
            loaded: cache.loaded as boolean,
            loading: cache.loading as boolean,
            error: cache.error as string | null,
            models: cache.openAiModels as Model[],
            otherModels: cache.otherModels as Record<string, ModelListItem[]>,
            configProviders: cache.configProviders as ConfigProvider[],
            presets: cache.presets as ProviderPreset[],
          },
          cacheIdentity: {
            array: initial?.array === cache.openAiModels,
            models: cache.openAiModels.every(
              (model: Model, index: number) => initial?.models[index] === model,
            ),
            options: cache.openAiModels.every(
              (model: Model, index: number) =>
                initial?.options[index] === model.supportedReasoningEfforts,
            ),
            otherModels: initial?.other === cache.otherModels,
            configProviders: initial?.providers === cache.configProviders,
            presets: initial?.presets === cache.presets,
          },
          reloadedCacheIdentity: {
            array: reloaded?.array === cache.openAiModels,
            models: cache.openAiModels.every(
              (model: Model, index: number) =>
                reloaded?.models[index] === model,
            ),
            options: cache.openAiModels.every(
              (model: Model, index: number) =>
                reloaded?.options[index] === model.supportedReasoningEfforts,
            ),
            otherModels: reloaded?.other === cache.otherModels,
            configProviders: reloaded?.providers === cache.configProviders,
            presets: reloaded?.presets === cache.presets,
          },
          cacheEpoch:
            !initial ? "unanchored" : cache.openAiModels === initial.array ? "initial" : "reloaded",
          menu: menu
            ? {
                firstEnabled: (() => {
                  const first = [
                    ...menu.querySelectorAll<HTMLElement>(
                      '[role^="menuitem"]:not([data-disabled]):not([aria-disabled="true"])',
                    ),
                  ].find(
                    (row) =>
                      !row.closest('[hidden], [inert], [aria-hidden="true"]') &&
                      row.getClientRects().length > 0,
                  );
                  return first
                    ? {
                        role: first.getAttribute("role"),
                        label: first.getAttribute("aria-label"),
                        text: first.textContent,
                        active: first === active,
                      }
                    : null;
                })(),
                radios: [
                  ...menu.querySelectorAll('[role="menuitemradio"]'),
                ].map((row) => ({
                  label: row.textContent,
                  checked: row.getAttribute("aria-checked"),
                  active: row === active,
                })),
                coarse: matchMedia("(pointer: coarse)").matches,
                view: menu
                  .querySelector("[data-model-picker-view]")
                  ?.getAttribute("data-model-picker-view"),
                dots: menu.querySelectorAll(".session-native-power-dot").length,
                sliderCount: menu.querySelectorAll(
                  '[data-reasoning-slider], [role="slider"]',
                ).length,
                caption: menu.querySelector(".session-native-power-effort")
                  ?.textContent,
                status: menu.querySelector('[role="status"]')?.textContent,
                thumbLeft: menu.querySelector<HTMLElement>(
                  ".session-native-power-thumb",
                )?.style.left,
                text: menu.textContent,
                searchExpanded: menu.querySelector(".session-native-model-search-toggle")?.getAttribute("aria-expanded"),
                searchInputCount: menu.querySelectorAll('input[aria-label="搜索或输入模型 ID"]').length,
                rect: rect(menu),
                viewport: { width: innerWidth, height: innerHeight },
                horizontalOverflow: menu.scrollWidth - menu.clientWidth,
                pageHorizontalOverflow:
                  document.documentElement.scrollWidth - innerWidth,
              }
            : null,
        };
      };
    },
    { other: OTHER, otherOwner, partialInitial },
  );
}
type Reader = Awaited<ReturnType<typeof createReader>>;
const readView = (page: Page, read: Reader, selector: string) =>
  page.evaluate(({ read, selector }) => read(selector), { read, selector });

async function observeInputs(page: Page) {
  return page.evaluateHandle(() => {
    const events: Array<Record<string, unknown>> = [];
    let overflow = false;
    const types = ["keydown", "pointerdown", "click", "focusin", "submit"];
    const listener = (event: Event) => {
      if (events.length === 512) {
        overflow = true;
        return;
      }
      const target = event.target instanceof Element ? event.target : null;
      events.push({
        type: event.type,
        now: performance.now(),
        trusted: event.isTrusted,
        key: event instanceof KeyboardEvent ? event.key : null,
        code: event instanceof KeyboardEvent ? event.code : null,
        role: target?.getAttribute("role"),
        label: target?.getAttribute("aria-label"),
        controlLabel: target
          ?.closest("button, [role^=menuitem]")
          ?.getAttribute("aria-label"),
        controlText:
          target?.closest('button, [role^="menuitem"]')?.textContent ?? null,
        withinCaption: Boolean(
          target?.closest(".session-native-power-caption"),
        ),
        withinRadio: Boolean(target?.closest('[role="menuitemradio"]')),
        withinTrigger: Boolean(
          target?.closest(".session-native-model-trigger"),
        ),
        withinPower: Boolean(target?.closest("[data-reasoning-slider]")),
      });
    };
    types.forEach((type) => document.addEventListener(type, listener, true));
    return {
      read: () => ({ events: [...events], overflow }),
      stop: () =>
        types.forEach((type) =>
          document.removeEventListener(type, listener, true),
        ),
    };
  });
}

async function refreshProvidersRead(page: Page) {
  return page.evaluate(async () => {
    const path = "/src/session-mode/components/codex/hooks/useModels.ts";
    const moduleURL = performance
      .getEntriesByType("resource")
      .findLast((entry) => new URL(entry.name).pathname === path)?.name;
    if (!moduleURL)
      throw new Error("Mounted public refresh module unavailable");
    const { useModelCacheStore } = await import(moduleURL);
    const started = performance.now();
    // Explicit authorized public read refresh, not a user UI action or store setter.
    await useModelCacheStore.getState().refreshProviders();
    const cache = useModelCacheStore.getState();
    return {
      operation: "useModelCacheStore.refreshProviders",
      moduleURL,
      started,
      finished: performance.now(),
      loaded: cache.loaded,
      loading: cache.loading,
      error: cache.error,
    };
  });
}

async function loadDirectoryRead(page: Page) {
  return page.evaluate(async () => {
    const path = "/src/session-mode/components/codex/hooks/useModels.ts";
    const moduleURL = performance
      .getEntriesByType("resource")
      .findLast((entry) => new URL(entry.name).pathname === path)?.name;
    if (!moduleURL)
      throw new Error("Mounted public directory load module unavailable");
    const { useModelCacheStore } = await import(moduleURL);
    const started = performance.now();
    // Separate explicit read diagnostic after genuine pointer Search; no setter.
    await useModelCacheStore.getState().load();
    const cache = useModelCacheStore.getState();
    return {
      operation: "useModelCacheStore.load",
      moduleURL,
      started,
      finished: performance.now(),
      loaded: cache.loaded,
      loading: cache.loading,
      error: cache.error,
    };
  });
}

for (const width of [1440, 390]) {
  test.describe("advanced model selection " + width, () => {
    test.use({
      viewport: { width, height: width === 390 ? 844 : 1000 },
      hasTouch: width === 390,
      isMobile: width === 390,
    });
    for (const surface of ["main", "expanded"] as const)
      for (const variant of cases) {
        test(`${surface} ${variant.name} preserves captured settings and owner`, async ({
          page,
        }, info) => {
          test.setTimeout(60_000);
          const before = hashes(),
            responses = variant.retry ? directory(["medium"]) : directory();
          const reloadedResponses = variant.retry
            ? directory(["medium", "high"])
            : null;
          const expectedCache = {
            loaded: !variant.retry,
            loading: false,
            error: variant.retry ? "R22 diagnostic provider unavailable" : null,
            models: responses.response.data,
            otherModels: responses.grouped,
            configProviders: responses.providers,
            presets: responses.presets,
          };
          const reloadedExpectedCache = reloadedResponses
            ? { ...expectedCache, loaded: true, error: null, models: reloadedResponses.response.data }
            : null;
          const publicReads: Awaited<
            ReturnType<typeof refreshProvidersRead>
          >[] = [];
          const consoleDetails: Array<{ text: string; url: string }> = [];
          let resolveInitialProvider = () => {};
          const initialProviderGate = variant.retry
            ? new Promise<void>((resolve) => { resolveInitialProvider = resolve; })
            : Promise.resolve();
          let providerReleaseReason: "consumers-mounted" | "finally" | null = null;
          let providerReleasePrecondition: Awaited<ReturnType<typeof readView>> | null = null;
          const releaseInitialProvider = (reason: "consumers-mounted" | "finally") => {
            if (providerReleaseReason !== null) return;
            providerReleaseReason = reason;
            resolveInitialProvider();
          };
          const directoryRequestCounts = [0, 0, 0, 0];
          const directoryFulfillments: Array<{
            method: string;
            path: string;
            ordinal: number;
            status: number;
            json: unknown;
          }> = [];
          const directoryPaths = [
            "/api/codex/model/list",
            "/api/codex/provider/list",
            "/api/codex/model/list-other",
            "/api/codex/provider/presets",
          ];
          const pageErrors: string[] = [],
            consoleErrors: string[] = [],
            captureErrors: string[] = [],
            screenshots: string[] = [];
          const api: Array<{ method: string; path: string; body: unknown }> =
            [];
          const directoryReads: Array<{
            method: string;
            path: string;
            body: unknown;
            status: number;
          }> = [];
          const states: Array<{
            phase: string;
            value: Awaited<ReturnType<typeof readView>>;
          }> = [];
          const readiness: Array<
            Awaited<ReturnType<typeof readView>>["cache"]
          > = [];
          const storeIdentityStages: Awaited<ReturnType<typeof readStoreIdentity>>[] = [];
          const storeIdentityErrors: Array<{ stage: string; error: string }> = [];
          const storeModuleNetwork = {
            requests: [] as Array<{ url: string; observedAt: string; startTime: number }>,
            responses: [] as Array<{
              url: string;
              observedAt: string;
              status: number;
              bodyState: "pending" | "complete" | "too-large" | "error";
              bodyBytes?: number;
              sha256?: string;
              reexports?: Array<{ specifier: string; resolvedURL: string }>;
              error?: string;
            }>,
            overflow: false,
          };
          const fixtureOrigin = new URL(String(info.project.use.baseURL)).origin;
          const isStoreModule = (url: string) => {
            const parsed = new URL(url);
            return parsed.origin === fixtureOrigin &&
              (storeModulePaths as readonly string[]).includes(parsed.pathname);
          };
          const onStoreRequest = (request: PlaywrightRequest) => {
            if (!isStoreModule(request.url())) return;
            if (storeModuleNetwork.requests.length >= 32) {
              storeModuleNetwork.overflow = true;
              return;
            }
            storeModuleNetwork.requests.push({
              url: request.url(),
              observedAt: new Date().toISOString(),
              startTime: request.timing().startTime,
            });
          };
          const onStoreResponse = (response: PlaywrightResponse) => {
            if (!isStoreModule(response.url())) return;
            if (storeModuleNetwork.responses.length >= 32) {
              storeModuleNetwork.overflow = true;
              return;
            }
            const record: (typeof storeModuleNetwork.responses)[number] = {
              url: response.url(),
              observedAt: new Date().toISOString(),
              status: response.status(),
              bodyState: "pending",
            };
            storeModuleNetwork.responses.push(record);
            // Inspect only the response already requested by the real page.
            // No fetch/retry/wait is introduced for this passive observer.
            void response.text().then((body) => {
              record.bodyBytes = Buffer.byteLength(body);
              record.sha256 = createHash("sha256").update(body).digest("hex");
              if (record.bodyBytes > 65_536) {
                record.bodyState = "too-large";
                return;
              }
              record.reexports = [...body.matchAll(
                /\bexport\s+(?:\*|\{[^}]*\})\s+from\s+["']([^"']+)["']/g,
              )].slice(0, 32).map((match) => ({
                specifier: match[1],
                resolvedURL: new URL(match[1], response.url()).href,
              })).filter((entry) => storeModulePaths.includes(
                new URL(entry.resolvedURL).pathname as typeof storeModulePaths[number],
              ));
              record.bodyState = "complete";
            }).catch((error) => {
              record.bodyState = "error";
              record.error = String(error);
            });
          };
          page.on("request", onStoreRequest);
          page.on("response", onStoreResponse);
          let originalDirectURL: string | undefined;
          const recordStoreIdentity = async (stage: string) => {
            try {
              storeIdentityStages.push(await readStoreIdentity(page, stage, originalDirectURL));
            } catch (error) {
              storeIdentityErrors.push({ stage, error: String(error) });
            }
          };
          let reader: Reader | null = null,
            observer: Awaited<ReturnType<typeof observeInputs>> | null = null;
          let events: {
            events: Array<Record<string, unknown>>;
            overflow: boolean;
          } | null = null;
          let failure: unknown = null,
            tabs = 0,
            scope: string = surface === "main" ? MAIN : EXPANDED;
          const draft = `R19 保留草稿 ${width} ${surface} ${variant.name}`;
          page.on("pageerror", (error) => pageErrors.push(String(error)));
          page.on("console", (message) => {
            if (message.type() === "error") {
              consoleErrors.push(message.text());
              consoleDetails.push({
                text: message.text(),
                url: message.location().url,
              });
            }
          });
          const fixture = await installSessionUxFixture(page, 1);
          await page.route("**/api/**", async (route) => {
            const request = route.request(),
              path = new URL(request.url()).pathname;
            const entry = {
              method: request.method(),
              path,
              body: request.method() === "POST" ? request.postDataJSON() : null,
            };
            api.push(entry);
            const index = directoryPaths.findIndex((suffix) =>
              path.endsWith(suffix),
            );
            if (index >= 0) {
              const ordinal = ++directoryRequestCounts[index];
              if (variant.retry && index === 1 && ordinal <= 2) {
                if (ordinal === 1) await initialProviderGate;
                await route.fulfill({
                  status: 500,
                  json: { error: "R22 diagnostic provider unavailable" },
                });
                directoryReads.push({ ...entry, status: 500 });
                directoryFulfillments.push({
                  method: entry.method,
                  path,
                  ordinal,
                  status: 500,
                  json: { error: "R22 diagnostic provider unavailable" },
                });
              } else {
                const actual =
                  variant.retry && index === 0 && ordinal === 2
                    ? reloadedResponses!
                    : responses;
                const json = [
                  actual.response,
                  actual.providers,
                  actual.other,
                  actual.presets,
                ][index];
                await route.fulfill({ json });
                directoryReads.push({ ...entry, status: 200 });
                directoryFulfillments.push({
                  method: entry.method,
                  path,
                  ordinal,
                  status: 200,
                  json,
                });
              }
            } else if (businessPattern.test(path))
              await route.fulfill({
                status: 409,
                json: { error: "Unexpected R19 business mutation denied" },
              });
            else await route.fallback();
          });
          const record = async (phase: string) => {
            if (!reader) throw new Error("Mounted reader unavailable");
            const value = await readView(page, reader, scope);
            states.push({ phase, value });
            originalDirectURL ??= value.moduleURLs[1];
            return value;
          };
          const screenshot = async (name: string) => {
            const path = info.outputPath(name);
            try {
              await page.screenshot({ path, fullPage: true });
              screenshots.push(path);
            } catch (error) {
              captureErrors.push(name + ": " + String(error));
            }
          };
          const twoFrames = () =>
            page.evaluate(
              () =>
                new Promise<void>((done) =>
                  requestAnimationFrame(() =>
                    requestAnimationFrame(() => done()),
                  ),
                ),
            );
          const tabTo = async (target: "trigger" | "caption") => {
            for (let index = 0; index <= 20; index++) {
              if (!reader) throw new Error("Reader unavailable");
              const value = await readView(page, reader, scope);
              if (
                target === "trigger"
                  ? value.activeIsTrigger
                  : value.activeIsCaption
              )
                return;
              if (index === 20)
                throw new Error(`${target} unreachable after20 real Tabs`);
              await page.keyboard.press("Tab");
              tabs++;
              await record(`tab-to-${target}-${index + 1}`);
            }
          };
          try {
            await page.goto("/?mode=session&view=agent", {
              waitUntil: "domcontentloaded",
            });
            await page
              .locator(MAIN)
              .locator('[contenteditable="true"]')
              .first()
              .waitFor();
            await seedSessionUx(page, 1);
            const otherOwner = await initialize(page),
              read = await createReader(page, otherOwner, Boolean(variant.retry));
            reader = read;
            const expectInitialDirectory = async () => {
              await expect
                .poll(
                  async () => {
                    const cache = (await readView(page, read, MAIN)).cache;
                    readiness.push(cache);
                    if (readiness.length > 20) readiness.shift();
                    return cache;
                  },
                  {
                    timeout: 10_000,
                    message:
                      variant.retry
                        ? "The original four reads settle with provider500 and the accepted model snapshot"
                        : "All four real directory reads load the full raw cache",
                  },
                )
                .toEqual(expectedCache);
              // Preconditions fail with complete evidence; never substitute cache state.
              expect(directoryReads).toHaveLength(4);
              for (const [index, suffix] of directoryPaths.entries())
                expect(
                  directoryReads.filter((entry) => entry.path.endsWith(suffix)),
                ).toEqual([
                  {
                    method: index === 0 ? "POST" : "GET",
                    path: "/api/session" + suffix,
                    body: index === 0 ? { cursor: null, limit: 100 } : null,
                    status: variant.retry && index === 1 ? 500 : 200,
                  },
                ]);
            };
            if (variant.retry) {
              await expect.poll(async () => {
                const value = await readView(page, read, MAIN);
                readiness.push(value.cache);
                if (readiness.length > 20) readiness.shift();
                return {
                  modelRead: value.modelRead,
                  loaded: value.cache.loaded,
                  loading: value.cache.loading,
                  error: value.cache.error,
                  models: value.cache.models,
                };
              }, { timeout: 10_000, message: "Actual model snapshot becomes ready while provider ordinal1 stays pending" }).toEqual({
                modelRead: { status: "success", acceptedSnapshot: true },
                loaded: false, loading: true, error: null,
                models: responses.response.data,
              });
              await expect.poll(() => [...directoryRequestCounts]).toEqual([1, 1, 1, 1]);
              await expect.poll(() => directoryReads.length).toBe(3);
            } else await expectInitialDirectory();
            await page
              .locator(MAIN)
              .locator('[contenteditable="true"]')
              .first()
              .fill(draft);
            observer = await observeInputs(page);
            if (surface === "expanded") {
              await page
                .getByRole("button", { name: "附加文件", exact: true })
                .click();
              await page
                .getByRole("button", { name: "展开编辑", exact: true })
                .click();
              await page
                .getByRole("dialog", { name: "展开编辑", exact: true })
                .waitFor();
              await page.locator(scope).locator(EDITOR).first().fill(draft);
            }
            if (variant.retry) {
              // Both genuine consumers are mounted before the held first provider
              // settles. Its shared loading=true coalesces Sheet's mount effect.
              await twoFrames();
              providerReleasePrecondition = await readView(page, read, scope);
              expect(providerReleasePrecondition.modelRead).toEqual({ status: "success", acceptedSnapshot: true });
              expect(providerReleasePrecondition.cache.loaded).toBe(false);
              expect(providerReleasePrecondition.cache.loading).toBe(true);
              expect(providerReleasePrecondition.cache.error).toBeNull();
              expect(directoryRequestCounts).toEqual([1, 1, 1, 1]);
              await expect(page.locator(scope).locator(".session-native-model-trigger")).toBeEnabled();
              releaseInitialProvider("consumers-mounted");
              await expectInitialDirectory();
              expect((await readView(page, read, scope)).modelRead).toEqual({ status: "success", acceptedSnapshot: true });
              expect(directoryRequestCounts).toEqual([1, 1, 1, 1]);
            }
            await record("before-open");
            await recordStoreIdentity("before-open");
            if (variant.activation === "pointer")
              await page
                .locator(scope)
                .locator(".session-native-model-trigger")
                .click();
            else {
              await tabTo("trigger");
              await page.keyboard.press("Enter");
            }
            const menu = page.locator(".session-native-model-menu");
            await menu.waitFor();
            if (!variant.retry) {
              await page.locator('[data-model-picker-view="simple"]').waitFor();
              await twoFrames();
              await page.waitForTimeout(200);
              await record("initial-simple");
              if (variant.activation === "pointer")
                await menu
                  .getByRole("menuitem", { name: "选择模型", exact: true })
                  .click();
              else {
                await tabTo("caption");
                await page.keyboard.press("Enter");
              }
            }
            await page.locator('[data-model-picker-view="advanced"]').waitFor();
            await twoFrames();
            await page.waitForTimeout(200);
            await record("advanced-before-select");
            await screenshot(
              `advanced-${width}-${surface}-${variant.name}.png`,
            );
            const targetIndex = responses.response.data.findIndex(
                (model) => model.id === variant.target,
              ),
              targetLabel = responses.response.data[targetIndex].displayName;
            if (variant.activation === "pointer")
              await menu
                .getByRole("menuitemradio", { name: targetLabel, exact: true })
                .click();
            else {
              await page.keyboard.press("Home");
              await record("row-navigation-Home");
              for (let index = 0; index < targetIndex; index++) {
                await page.keyboard.press("ArrowDown");
                await record(`row-navigation-ArrowDown-${index + 1}`);
              }
              const ready = await record("row-before-activation");
              if (ready.activeRadioLabel !== targetLabel)
                throw new Error(
                  `Actual keyboard row differs: ${ready.activeRadioLabel} != ${targetLabel}`,
                );
              await page.keyboard.press(variant.activation);
            }
            if (variant.retry) {
              await record("singleton-enter-immediate");
              await twoFrames();
              await record("singleton-enter-2raf");
              await page.waitForTimeout(40);
              await record("singleton-enter-40ms");
              await page.waitForTimeout(200);
              await record("singleton-enter-settled");
              publicReads.push(await refreshProvidersRead(page));
              await record("provider-refresh-error");
              await screenshot(
                `provider-error-${width}-${surface}-${variant.name}.png`,
              );
              await menu
                .getByRole("button", { name: "搜索模型", exact: true })
                .click();
              await record("pointer-search-before-diagnostic");
              publicReads.push(await loadDirectoryRead(page));
              // Wait for actual diagnostic read readiness, never desired focus.
              await expect
                .poll(
                  async () => {
                    const cache = (await readView(page, read, scope)).cache;
                    readiness.push(cache);
                    if (readiness.length > 20) readiness.shift();
                    return cache;
                  },
                  {
                    timeout: 10_000,
                    message:
                      "Public load diagnostic reads the two-choice catalog",
                  },
                )
                .toEqual(reloadedExpectedCache);
            }
            // Read the actual first DOM, two real animation frames, then ~200ms. No
            // focus method, synthetic event, desired-state poll or view mutation here.
            await record("selection-immediate");
            await twoFrames();
            await record("selection-2raf");
            if (variant.retry) {
              await page.waitForTimeout(40);
              await record("selection-40ms");
            }
            await page.waitForTimeout(200);
            await record("selection-settled");
            await screenshot(
              `selected-${width}-${surface}-${variant.name}.png`,
            );
            await page.keyboard.press("Escape");
            await menu.waitFor({ state: "detached" });
            await expect
              .poll(
                async () => (await readView(page, read, scope)).activeIsEditor,
                { timeout: 3000 },
              )
              .toBe(true);
            await record("escape-restored");
            if (surface === "expanded") {
              await page
                .getByRole("button", { name: "返回并保留草稿", exact: true })
                .click();
              await page
                .getByRole("dialog", { name: "展开编辑", exact: true })
                .waitFor({ state: "detached" });
              scope = MAIN;
              await expect
                .poll(
                  async () => (await readView(page, read, MAIN)).activeIsEditor,
                  { timeout: 3000 },
                )
                .toBe(true);
              await record("expanded-back");
            }
          } catch (error) {
            failure = error;
          } finally {
            if (variant.retry) releaseInitialProvider("finally");
            if (reader)
              try {
                await record("finally-current");
              } catch (error) {
                captureErrors.push("final snapshot: " + String(error));
              }
            await recordStoreIdentity("finally");
            if (observer)
              try {
                events = await observer.evaluate((log) => {
                  const value = log.read();
                  log.stop();
                  return value;
                });
                await observer.dispose();
              } catch (error) {
                captureErrors.push("observer release: " + String(error));
              }
            await screenshot(`final-${width}-${surface}-${variant.name}.png`);
            const after = hashes(),
              forbiddenWrites = api.filter((call) =>
                businessPattern.test(call.path),
              );
            const fixtureViteConsole = consoleErrors.filter((message) =>
              message.startsWith("[vite] failed to connect to websocket."),
            );
            const fixtureRetryConsole = variant.retry
              ? consoleDetails
                  .filter(
                    (detail) =>
                      /^Failed to load resource: the server responded with a status of 500(?:\s|$)/.test(
                        detail.text,
                      ) &&
                      directoryReads.some(
                        (read) =>
                          read.status === 500 &&
                          read.path.endsWith("/api/codex/provider/list") &&
                          (() => {
                            try {
                              return new URL(detail.url).pathname === read.path;
                            } catch {
                              return false;
                            }
                          })(),
                      ),
                  )
                  .map((detail) => detail.text)
              : [];
            const unexpectedConsoleErrors = consoleErrors.filter(
              (message) =>
                !fixtureViteConsole.includes(message) &&
                !fixtureRetryConsole.includes(message),
            );
            page.off("request", onStoreRequest);
            page.off("response", onStoreResponse);
            const evidence = {
              width,
              height: width === 390 ? 844 : 1000,
              surface,
              variant,
              responses,
              reloadedResponses,
              publicReads,
              initialProviderGate: variant.retry ? {
                ordinal: 1,
                releaseReason: providerReleaseReason,
                releasePrecondition: providerReleasePrecondition,
              } : null,
              directoryRequestCounts,
              directoryFulfillments,
              externalReadBoundary: variant.retry
                ? "Provider ordinal1 is held only until real main/Sheet consumers mount, then released as fixture500; model/list already succeeded. Public refreshProviders also returns fixture500, preserving genuine loaded=false. Actual pointer Search clears keyboard intent, followed by a separate public load diagnostic. Neither public read is a user Retry operation; no cache field setter."
                : null,
              sources: { before, after },
              directoryReads,
              api,
              forbiddenWrites,
              fixtureCalls: fixture.calls,
              readiness,
              storeIdentityDiagnostic: {
                stages: storeIdentityStages,
                errors: storeIdentityErrors,
                network: storeModuleNetwork,
                boundary: "Parallel read-only barrel/direct identity diagnostic. Existing direct reader, baseline assertions, user actions, and directory gates are retained. Only naturally requested module URLs/responses; no additional fetch, setter, focus, wait, or retry. Pending/overflow/error remains explicit.",
              },
              states,
              tabs,
              events,
              pageErrors,
              consoleErrors,
              consoleDetails,
              fixtureViteConsole,
              fixtureRetryConsole,
              unexpectedConsoleErrors,
              captureErrors,
              screenshots,
              failure: failure ? String(failure) : null,
              boundary:
                "Local product/isolated API+WS fixture; actual directory reads and raw cache; ordinary trusted keyboard/pointer inputs. Radix can derive an untrusted click from a trusted Enter/Space.390x844 touch/mobile emulation, no physical/native account/full IDE claim.",
            };
            const path = info.outputPath("model-menu-selection-view.json");
            writeFileSync(path, JSON.stringify(evidence, null, 2));
            await info.attach("model-menu-selection-view", {
              path,
              contentType: "application/json",
            });
            await reader?.dispose();
            // Evidence is complete on disk before every behavior/focus/source comparison.
            if (failure) throw failure;
            expect(after).toEqual(before);
            expect(pageErrors).toEqual([]);
            expect(captureErrors).toEqual([]);
            expect(unexpectedConsoleErrors).toEqual([]);
            expect(forbiddenWrites).toEqual([]);
            expect(
              fixture.calls.filter((call) => businessPattern.test(call.path)),
            ).toEqual([]);
            expect(directoryReads).toHaveLength(variant.retry ? 9 : 4);
            expect(
              api.filter((call) =>
                directoryPaths.some((suffix) => call.path.endsWith(suffix)),
              ),
            ).toHaveLength(variant.retry ? 9 : 4);
            expect(directoryFulfillments).toHaveLength(variant.retry ? 9 : 4);
            if (!variant.retry) expect(publicReads).toEqual([]);
            expect(directoryRequestCounts).toEqual(
              variant.retry ? [2, 3, 2, 2] : [1, 1, 1, 1],
            );
            for (const [index, suffix] of directoryPaths.entries()) {
              const reads = directoryReads.filter((entry) =>
                entry.path.endsWith(suffix),
              );
              expect(
                reads.map((read) => ({
                  method: read.method,
                  path: read.path,
                  body: read.body,
                  status: read.status,
                })),
              ).toEqual(
                Array.from(
                  { length: variant.retry ? [2, 3, 2, 2][index] : 1 },
                  (_, ordinal) => ({
                    method: index === 0 ? "POST" : "GET",
                    path: "/api/session" + suffix,
                    body: index === 0 ? { cursor: null, limit: 100 } : null,
                    status:
                      variant.retry && index === 1 && ordinal < 2 ? 500 : 200,
                  }),
                ),
              );
            }
            expect(events?.overflow).toBe(false);
            expect(
              events?.events.filter((event) => event.type === "submit"),
            ).toEqual([]);
            const lookup = new Map(
                states.map((state) => [state.phase, state.value]),
              ),
              baseline = lookup.get("before-open")!,
              advanced = lookup.get("advanced-before-select")!;
            const targetIndex = responses.response.data.findIndex(
                (model) => model.id === variant.target,
              ),
              target = responses.response.data[targetIndex];
            expect(baseline.currentThreadId).toBe("ux-0");
            expect(baseline.owner).toBeTruthy();
            expect(baseline.settings).toMatchObject({
              model: CURRENT,
              modelProvider: "openai",
              reasoningEffort: "medium",
              serviceTier: null,
              sandbox: "workspace-write",
              sandboxPolicy: null,
              approvalPolicy: "on-request",
            });
            expect(baseline.entry).toMatchObject({
              revision: 4,
              pending: false,
              pendingFields: [],
            });
            expect(baseline.otherDraft).toMatchObject({
              text: "R19 另一 owner 的草稿",
            });
            expect(baseline.otherSettings).toMatchObject({
              model: "r19-other-model",
              reasoningEffort: "high",
              revision: 7,
            });
            if (!variant.retry)
              expect(lookup.get("initial-simple")?.menu).toMatchObject({
                view: "simple",
                dots: 3,
                sliderCount: 1,
                caption: "中",
              });
            else {
              expect(publicReads).toHaveLength(2);
              expect(publicReads[0]).toMatchObject({
                operation: "useModelCacheStore.refreshProviders",
                moduleURL: baseline.moduleURLs[4],
                loaded: false,
                loading: false,
                error: "R22 diagnostic provider unavailable",
              });
              expect(publicReads[1]).toMatchObject({
                operation: "useModelCacheStore.load",
                moduleURL: baseline.moduleURLs[4],
                loaded: true,
                loading: false,
                error: null,
              });
              expect(providerReleaseReason).toBe("consumers-mounted");
              expect(fixtureRetryConsole).toHaveLength(2);
              for (const phase of [
                "singleton-enter-immediate",
                "singleton-enter-2raf",
                "singleton-enter-40ms",
                "singleton-enter-settled",
              ]) {
                const value = lookup.get(phase)!;
                expect(value.menu, phase).toMatchObject({
                  view: "advanced",
                  sliderCount: 0,
                });
                expect(value.activeRadioLabel, phase).toBe("R19 当前模型");
                expect(
                  value.menu?.radios.map((row) => ({
                    label: row.label,
                    checked: row.checked,
                    active: row.active,
                  })),
                  phase,
                ).toEqual(
                  responses.response.data.map((model) => ({
                    label: model.displayName,
                    checked: model.id === CURRENT ? "true" : "false",
                    active: model.id === CURRENT,
                  })),
                );
              }
              expect(lookup.get("provider-refresh-error")?.cache).toEqual({
                ...expectedCache,
                error: "R22 diagnostic provider unavailable",
              });
              expect(
                lookup.get("provider-refresh-error")?.menu?.text,
              ).not.toContain("重试");
              expect(lookup.get("provider-refresh-error")?.menu?.view).toBe(
                "advanced",
              );
              expect(lookup.get("pointer-search-before-diagnostic")?.menu).toMatchObject({
                view: "advanced", searchExpanded: "true", searchInputCount: 1,
              });
              expect(lookup.get("pointer-search-before-diagnostic")?.cache).toEqual(expectedCache);
              for (const receipt of publicReads)
                expect(receipt.finished).toBeGreaterThanOrEqual(receipt.started);
            }
            expect(advanced.menu).toMatchObject({
              view: "advanced",
              sliderCount: 0,
            });
            expect(
              advanced.menu?.radios.map((row) => ({
                label: row.label,
                checked: row.checked,
              })),
            ).toEqual(
              responses.response.data.map((model) => ({
                label: model.displayName,
                checked: model.id === CURRENT ? "true" : "false",
              })),
            );
            expect(advanced.entry).toEqual(baseline.entry);
            expect(advanced.settings).toEqual(baseline.settings);
            const changed = variant.target !== CURRENT;
            const expectedSettings = changed
              ? {
                  ...baseline.settings,
                  model: variant.target,
                  providerModels: {
                    ...(baseline.settings.providerModels as Record<
                      string,
                      string
                    >),
                    openai: variant.target,
                  },
                }
              : baseline.settings;
            const expectedEntry = changed
              ? {
                  ...baseline.entry,
                  model: variant.target,
                  providerModels: {
                    ...baseline.entry.providerModels,
                    openai: variant.target,
                  },
                  revision: 5,
                  pending: true,
                  pendingFields: ["model"],
                  notice: {
                    id: 5,
                    from: CURRENT,
                    to: variant.target,
                    dismissed: false,
                  },
                }
              : baseline.entry;
            let selected = false;
            for (const state of states) {
              if (state.phase === "selection-immediate") selected = true;
              expect(state.value.settings, state.phase).toEqual(
                selected ? expectedSettings : baseline.settings,
              );
              expect(state.value.entry, state.phase).toEqual(
                selected ? expectedEntry : baseline.entry,
              );
              for (const field of [
                "defaults",
                "otherThreads",
                "otherSettings",
                "draft",
                "otherDraft",
                "currentThreadId",
                "owner",
                "moduleURLs",
              ] as const)
                expect(state.value[field], state.phase + " " + field).toEqual(
                  baseline[field],
                );
              expect(state.value.editorText, state.phase).toBe(draft);
              expect(state.value.mainEditorText, state.phase).toBe(draft);
              if (!variant.retry) {
                expect(state.value.cache, state.phase).toEqual(expectedCache);
                expect(state.value.cacheIdentity, state.phase).toEqual({
                  array: true,
                  models: true,
                  options: true,
                  otherModels: true,
                  configProviders: true,
                  presets: true,
                });
              } else {
                expect(state.value.modelRead, state.phase).toEqual({ status: "success", acceptedSnapshot: true });
                const refreshed = state.value.cacheEpoch === "reloaded";
                expect(state.value.cache, state.phase).toEqual(
                  refreshed
                    ? reloadedExpectedCache
                    : state.phase === "provider-refresh-error"
                      ? { ...expectedCache, error: "R22 diagnostic provider unavailable" }
                      : expectedCache,
                );
                expect(state.value.cacheIdentity, state.phase).toEqual({
                  array: !refreshed,
                  models: !refreshed,
                  options: !refreshed,
                  otherModels: !refreshed,
                  configProviders: !refreshed,
                  presets: !refreshed,
                });
                if (refreshed)
                  expect(
                    state.value.reloadedCacheIdentity,
                    state.phase,
                  ).toEqual({
                    array: true,
                    models: true,
                    options: true,
                    otherModels: true,
                    configProviders: true,
                    presets: true,
                  });
              }
              if (state.value.menu) {
                const {
                  rect,
                  viewport,
                  horizontalOverflow,
                  pageHorizontalOverflow,
                  coarse,
                } = state.value.menu;
                expect(viewport, state.phase).toEqual({
                  width,
                  height: width === 390 ? 844 : 1000,
                });
                expect(coarse, state.phase).toBe(width === 390);
                expect(rect?.width, state.phase).toBeGreaterThan(0);
                expect(rect?.x, state.phase).toBeGreaterThanOrEqual(-1);
                expect(rect?.right, state.phase).toBeLessThanOrEqual(width + 1);
                expect(horizontalOverflow, state.phase).toBeLessThanOrEqual(1);
                expect(pageHorizontalOverflow, state.phase).toBeLessThanOrEqual(
                  1,
                );
              }
            }
            for (const phase of ["selection-2raf", ...(variant.retry ? ["selection-40ms"] : []), "selection-settled"]) {
              const value = lookup.get(phase)!;
              expect(value.menu?.view, phase).toBe(variant.view);
              if (variant.view === "simple") {
                expect(value.menu, phase).toMatchObject({
                  sliderCount: 1,
                  dots: variant.retry
                    ? reloadedResponses!.response.data[targetIndex]
                        .supportedReasoningEfforts.length
                    : target.supportedReasoningEfforts.length,
                  caption: "中",
                });
                if (variant.focus === "menu")
                  expect(value.activeIsMenu, phase).toBe(true);
                else {
                  expect(value.menu?.firstEnabled, phase).toMatchObject({
                    role: "menuitem",
                    label: "选择模型",
                    active: true,
                  });
                  expect(value.activeIsCaption, phase).toBe(true);
                }
              } else {
                expect(value.menu?.sliderCount, phase).toBe(0);
                expect(value.activeRadioLabel, phase).toBe(target.displayName);
                expect(
                  value.menu?.radios.map((row) => ({
                    label: row.label,
                    checked: row.checked,
                    active: row.active,
                  })),
                  phase,
                ).toEqual(
                  responses.response.data.map((model) => ({
                    label: model.displayName,
                    checked: model.id === variant.target ? "true" : "false",
                    active: model.id === variant.target,
                  })),
                );
              }
            }
            const log = events?.events ?? [],
              keys = log.filter((event) => event.type === "keydown"),
              rowKeys = keys.filter(
                (event) =>
                  event.withinRadio &&
                  (event.key === "Enter" || event.key === " "),
              );
            expect(
              keys.every(
                (event) =>
                  event.trusted &&
                  event.code === (event.key === " " ? "Space" : event.key),
              ),
            ).toBe(true);
            expect(
              log
                .filter((event) => event.type === "pointerdown")
                .every((event) => event.trusted),
            ).toBe(true);
            expect(keys.filter((event) => event.key === "Tab")).toHaveLength(
              tabs,
            );
            expect(keys.filter((event) => event.key === "Escape")).toHaveLength(
              1,
            );
            if (variant.activation === "pointer") {
              expect(tabs).toBe(0);
              expect(rowKeys).toEqual([]);
              expect(
                log.filter(
                  (event) =>
                    event.type === "pointerdown" &&
                    event.withinTrigger &&
                    event.trusted,
                ),
              ).toHaveLength(1);
              expect(
                log.filter(
                  (event) =>
                    event.type === "click" &&
                    event.withinCaption &&
                    event.trusted,
                ),
              ).toHaveLength(1);
              expect(
                log.filter(
                  (event) =>
                    event.type === "click" &&
                    event.withinRadio &&
                    event.controlText === target.displayName &&
                    event.trusted,
                ),
              ).toHaveLength(1);
            } else {
              expect(tabs).toBeGreaterThan(0);
              expect(
                keys.filter(
                  (event) => event.key === "Enter" && event.withinTrigger,
                ),
              ).toHaveLength(1);
              expect(
                keys.filter(
                  (event) => event.key === "Enter" && event.withinCaption,
                ),
              ).toHaveLength(variant.retry ? 0 : 1);
              expect(
                rowKeys.map((event) => ({
                  key: event.key,
                  code: event.code,
                  text: event.controlText,
                  trusted: event.trusted,
                })),
              ).toEqual([
                {
                  key: variant.activation === "Space" ? " " : "Enter",
                  code: variant.activation,
                  text: target.displayName,
                  trusted: true,
                },
              ]);
              expect(keys.filter((event) => event.key === "Home")).toHaveLength(
                1,
              );
              expect(
                keys.filter((event) => event.key === "ArrowDown"),
              ).toHaveLength(targetIndex);
              expect(
                keys.filter((event) =>
                  ["ArrowLeft", "ArrowRight", "ArrowUp"].includes(
                    String(event.key),
                  ),
                ),
              ).toEqual([]);
            }
            if (variant.retry) {
              expect(
                log.filter(
                  (event) =>
                    event.type === "pointerdown" &&
                    event.controlLabel === "搜索模型" &&
                    event.trusted,
                ),
              ).toHaveLength(1);
              expect(
                log.filter(
                  (event) =>
                    event.type === "click" &&
                    event.controlLabel === "搜索模型" &&
                    event.trusted,
                ),
              ).toHaveLength(1);
              const pointerSearch = log.find((event) => event.type === "click" && event.controlLabel === "搜索模型" && event.trusted);
              expect(pointerSearch).toBeTruthy();
              expect(publicReads[1].started).toBeGreaterThanOrEqual(Number(pointerSearch?.now));
              expect(lookup.get("selection-settled")?.cacheEpoch).toBe(
                "reloaded",
              );
              expect(lookup.get("selection-settled")?.activeIsMenu).toBe(true);
            }
            expect(lookup.get("escape-restored")?.activeIsEditor).toBe(true);
            expect(lookup.get("escape-restored")?.menu).toBeNull();
            if (surface === "expanded")
              expect(lookup.get("expanded-back")?.activeIsEditor).toBe(true);
          }
        });
      }
  });
}
