import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import type {
  Model,
  ModelListResponse,
} from "../../apps/web/src/session-mode/bindings/v2";
import type {
  ConfigProvider,
  FrontendProviderModels,
  ModelListItem,
  ProviderPreset,
} from "../../apps/web/src/session-mode/components/codex/types";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";

const UNKNOWN = "r20-typed-unknown";
const FUTURE = "gpt-9.99-fixture-future";
const SHARED = "r20-shared-provider-model";
const CUSTOM = "r20-custom";
const OTHER = "r20-other-owner";
const MAIN = ".session-codex-composer";
const EXPANDED = ".session-composer-sheet.is-full";
const EDITOR = '[contenteditable="true"], .session-rich-draft textarea';
const UNKNOWN_OPTIONS = ["minimal", "low", "medium", "high", "xhigh", "max"];
const GENERIC_OPTIONS = ["none", "low", "medium", "high", "xhigh"];
const WARM_ERROR = "R20 warm provider label control";
const inputs = [
  "apps/web/src/session-mode/components/codex/composer/nativeReasoningOptions.ts",
  "apps/web/src/session-mode/components/codex/composer/NativeModelSelector.tsx",
  "apps/web/src/session-mode/components/codex/composer/NativeModelTrigger.tsx",
  "apps/web/src/session-mode/components/codex/composer/ReasoningEffortSelector.tsx",
  "apps/web/src/session-mode/components/codex/composer/nativeReasoningLabel.ts",
  "apps/web/src/session-mode/components/codex/composer/NativeServiceTierControl.tsx",
  "apps/web/src/session-mode/components/codex/composer/recentModelConfigs.ts",
  "apps/web/src/session-mode/components/codex/composer/NativeComposerIcon.tsx",
  "apps/web/src/session-mode/components/codex/composer/ComposerTooltip.tsx",
  "apps/web/src/session-mode/components/ui/tooltip.tsx",
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
  "tests/e2e/session-model-menu-unknown-label.spec.ts",
];
const hashes = () =>
  inputs.map((path) => ({
    path,
    sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
  }));
const businessPattern =
  /\/(?:turn\/(?:start|steer|interrupt)|thread\/(?:start|resume|fork|delete)|followups\/(?:submit|change|stop)|goal\/(?:set|clear)|config\/(?:write|batch-write))$/;
const directoryPaths = [
  "/api/codex/model/list",
  "/api/codex/provider/list",
  "/api/codex/model/list-other",
  "/api/codex/provider/presets",
];
// Explicit local-fixture read routes and bookkeeping only. Unknown non-GETs are denied.
const readPostPaths = new Set([
  "/api/session/api/codex/account/get",
  "/api/session/api/codex/config/read",
  "/api/session/api/codex/thread/list",
  "/api/session/api/bots/list",
  "/api/session/api/codex/plugin/installed",
  "/api/session/api/codex/skills/list",
  "/api/session/api/codex/thread/goal/get",
  "/api/session/api/git/branch-info",
  "/api/session/api/filesystem/read-directory",
  "/api/session/api/git/status",
  "/api/session/api/git/diff-stats",
  "/api/session/api/git/file-diff-meta",
  "/api/session/subagents/snapshot",
  "/api/session/api/codex/thread/turns/list",
  "/api/session/git/hunks/read",
  "/api/session/api/codex/thread/access",
  "/api/session/api/codex/thread/read",
  "/api/session/api/codex/thread/metadata",
]);
const bookkeepingPaths = new Set([
  "/api/session/tabs",
  "/api/session/projects",
  "/api/session/api/telemetry/active",
  "/api/session/api/filesystem/watch",
  "/api/session/api/filesystem/unwatch",
]);
type Case = {
  name: string;
  kind: "unknown" | "known" | "custom" | "warm-error" | "diagnostics";
  model: string;
  provider: string;
  effort: string | null;
  catalog: "empty" | "full";
};
const positives: Case[] = [
  {
    name: "unknown-empty-none",
    kind: "unknown",
    model: UNKNOWN,
    provider: "openai",
    effort: "none",
    catalog: "empty",
  },
  {
    name: "gpt-unknown-unrelated-null",
    kind: "unknown",
    model: FUTURE,
    provider: "openai",
    effort: null,
    catalog: "full",
  },
];
const controls: Array<{ surface: "main" | "expanded"; variant: Case }> = [
  {
    surface: "main",
    variant: {
      name: "known-catalog-label",
      kind: "known",
      model: SHARED,
      provider: "openai",
      effort: "medium",
      catalog: "full",
    },
  },
  {
    surface: "main",
    variant: {
      name: "custom-provider-same-openai-id",
      kind: "custom",
      model: SHARED,
      provider: CUSTOM,
      effort: "none",
      catalog: "full",
    },
  },
  {
    surface: "expanded",
    variant: {
      name: "warm-error-preserves-model-read",
      kind: "warm-error",
      model: UNKNOWN,
      provider: "openai",
      effort: "none",
      catalog: "full",
    },
  },
  {
    surface: "main",
    variant: {
      name: "raw-tooltip-status-recent",
      kind: "diagnostics",
      model: FUTURE,
      provider: "openai",
      effort: "medium",
      catalog: "full",
    },
  },
];
function directory(variant: Case) {
  const models: Model[] = (
    variant.catalog === "empty"
      ? []
      : ["r20-catalog-first", SHARED, "r20-catalog-third"]
  ).map((id, index) => ({
    id,
    model: id,
    displayName: ["R20 目录首项", "R20 目录选中项", "R20 目录第三项"][index],
    description: "Isolated complete unknown-label model/list fixture",
    upgrade: null,
    upgradeInfo: null,
    availabilityNux: null,
    hidden: false,
    isDefault: index === 0,
    supportedReasoningEfforts: (index === 1
      ? ["medium", "high"]
      : ["low", "medium", "high"]
    ).map((reasoningEffort) => ({
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
  const providers: ConfigProvider[] =
    variant.kind === "custom"
      ? [
          {
            name: CUSTOM,
            base_url: "https://unused-fixture.invalid/v1",
            env_key: null,
          },
        ]
      : [];
  const other: FrontendProviderModels[] =
    variant.kind === "custom"
      ? [{ provider: CUSTOM, models: [{ id: SHARED, context_length: 32768 }] }]
      : [];
  const presets: ProviderPreset[] = [];
  const grouped: Record<string, ModelListItem[]> =
    variant.kind === "custom"
      ? { [CUSTOM]: [{ id: SHARED, label: SHARED }] }
      : {};
  return { response, providers, other, presets, grouped };
}
async function initialize(page: Page, variant: Case) {
  return page.evaluate(
    async ({ variant, other }) => {
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
        model: variant.model,
        modelProvider: variant.provider,
        reasoningEffort: variant.effort,
        providerModels: {
          openai: variant.model,
          ...(variant.provider !== "openai"
            ? { [variant.provider]: variant.model }
            : {}),
        },
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
      // Synthetic initial configuration only. Null is only the captured existing thread's effort.
      // Readiness/catalog state is populated exclusively by the real useModels four-read flow.
      useConfigStore.setState({
        ...settings,
        reasoningEffort: variant.effort ?? "high",
        personality: "friendly",
      });
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
            model: "r20-other-model",
            modelProvider: "openai",
            reasoningEffort: "high",
            providerModels: { openai: "r20-other-model" },
            revision: 7,
            pending: false,
            pendingFields: [],
          },
        },
      });
      const otherOwner = sessionDraftKey("codex", other);
      useSessionDraftStore
        .getState()
        .setText(otherOwner, "R20 另一 owner 的草稿");
      useLayoutStore.setState({ isSidebarOpen: false });
      useAgentCenterStore
        .getState()
        .addAgentCard(
          {
            kind: "codex",
            id: "ux-0",
            cwd: "/fixture/项目/very-long-project-path-for-ui-regression",
            preview: "R20 未知模型可见标签验收",
          },
          { activate: true },
        );
      return otherOwner as string;
    },
    { variant, other: OTHER },
  );
}
async function createReader(page: Page, otherOwner: string) {
  return page.evaluateHandle(
    async ({ other, otherOwner }) => {
      const paths = [
        "/src/session-mode/components/codex/stores/useConfigStore.ts",
        "/src/session-mode/components/codex/stores/useCodexStore.ts",
        "/src/session-mode/stores/useThreadModelStore.ts",
        "/src/session-mode/stores/useSessionDraftStore.ts",
        "/src/session-mode/components/codex/hooks/useModels.ts",
        "/src/session-mode/components/codex/composer/recentModelConfigs.ts",
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
        { recentModelConfigs },
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
      let initial: {
        array: Model[];
        models: unknown[];
        options: unknown[];
        other: unknown;
        providers: unknown;
        presets: unknown;
      } | null = null;
      // The loaded flag is read directly from the actual store. This fixture does
      // not require a new useModels return field or infer success from !loading.
      return (selector: string) => {
        const cache = useModelCacheStore.getState();
        if (cache.loaded && !initial)
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
          recent: recentModelConfigs() as Array<{
            model: string;
            label: string;
            reasoningEffort: string | null;
            serviceTier: string | null;
          }>,
          tooltipLabels: [
            ...document.querySelectorAll(
              ".session-native-composer-tooltip > .session-native-composer-tooltip-label",
            ),
          ].map((element) => element.textContent),
          trigger: {
            label: trigger?.getAttribute("aria-label"),
            purpose: trigger?.querySelector(".session-native-model-trigger-placeholder")?.textContent ?? null,
            model: trigger?.querySelector(".session-native-model-label")
              ?.textContent,
            modelVisible: Boolean(
              trigger
                ?.querySelector(".session-native-model-label")
                ?.getClientRects().length,
            ),
            rect: rect(trigger),
            effort: trigger?.querySelector(".session-native-model-effort")
              ?.textContent,
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
          menu: menu
            ? {
                view: menu
                  .querySelector("[data-model-picker-view]")
                  ?.getAttribute("data-model-picker-view"),
                dots: menu.querySelectorAll(".session-native-power-dot").length,
                sliderCount: menu.querySelectorAll(
                  '[data-reasoning-slider], [role="slider"]',
                ).length,
                model: menu.querySelector(".session-native-power-model")
                  ?.textContent,
                modelVisible: Boolean(
                  menu
                    .querySelector(".session-native-power-model")
                    ?.getClientRects().length,
                ),
                modelRect: rect(
                  menu.querySelector(".session-native-power-model"),
                ),
                captionAria: menu
                  .querySelector(".session-native-power-caption")
                  ?.getAttribute("aria-label"),
                radios: [
                  ...menu.querySelectorAll('[role="menuitemradio"]'),
                ].map((row) => ({
                  label: row.textContent?.trim(),
                  checked: row.getAttribute("aria-checked"),
                  active: row === active,
                })),
                recentGroup:
                  menu.querySelector(
                    '[role="group"][aria-label="最近使用的模型"]',
                  )?.textContent ?? null,
                caption: menu.querySelector(".session-native-power-effort")
                  ?.textContent,
                status: menu.querySelector('[role="status"]')?.textContent,
                thumbLeft: menu.querySelector<HTMLElement>(
                  ".session-native-power-thumb",
                )?.style.left,
                text: menu.textContent,
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
    { other: OTHER, otherOwner },
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

for (const width of [1440, 390]) {
  test.describe("unknown model visible label " + width, () => {
    test.use({
      viewport: { width, height: width === 390 ? 844 : 1000 },
      hasTouch: width === 390,
      isMobile: width === 390,
    });
    const cases = [
      ...(["main", "expanded"] as const).flatMap((surface) =>
        positives.map((variant) => ({ surface, variant })),
      ),
      ...controls,
    ];
    for (const { surface, variant } of cases)
      test(`${surface} ${variant.name} separates visible label from raw identity`, async ({
        page,
      }, info) => {
        test.setTimeout(60_000);
        const before = hashes(),
          responses = directory(variant),
          height = width === 390 ? 844 : 1000;
        const expectedCache = {
          loaded: true,
          loading: false,
          error: null,
          models: responses.response.data,
          otherModels: responses.grouped,
          configProviders: responses.providers,
          presets: responses.presets,
        };
        const pageErrors: string[] = [],
          consoleErrors: string[] = [],
          consoleDetails: Array<{ text: string; url: string }> = [],
          captureErrors: string[] = [],
          screenshots: string[] = [];
        const setupTimeline: Array<{ phase: string; wallTime: number; url: string }> = [];
        const mainNavigations: Array<{ wallTime: number; url: string }> = [];
        let navigationOverflow = false;
        const setupMark = (phase: string) => setupTimeline.push({ phase, wallTime: Date.now(), url: page.url() });
        const api: Array<{ method: string; path: string; body: unknown }> = [],
          deniedWrites: typeof api = [],
          bookkeeping: typeof api = [];
        const directoryReads: Array<{
          method: string;
          path: string;
          body: unknown;
          status: number;
        }> = [];
        const directoryFulfillments: Array<{
          method: string;
          path: string;
          ordinal: number;
          status: number;
          json: unknown;
        }> = [];
        const directoryCounts = [0, 0, 0, 0];
        const publicReads: Array<
          Awaited<ReturnType<typeof refreshProvidersRead>>
        > = [];
        const blockedExternalRequests: Array<{ method: string; url: string }> =
          [];
        const states: Array<{
          phase: string;
          value: Awaited<ReturnType<typeof readView>>;
        }> = [];
        const readiness: Array<Awaited<ReturnType<typeof readView>>["cache"]> =
          [];
        let reader: Reader | null = null,
          observer: Awaited<ReturnType<typeof observeInputs>> | null = null;
        let events: {
            events: Array<Record<string, unknown>>;
            overflow: boolean;
          } | null = null,
          failure: unknown = null,
          tabs = 0;
        let scope = surface === "main" ? MAIN : EXPANDED;
        const draft = `R20 保留草稿 ${width} ${surface} ${variant.name}`;
        const baseURL = String(info.project.use.baseURL ?? "");
        const origin = new URL(baseURL).origin;
        page.on("framenavigated", (frame) => {
          if (frame !== page.mainFrame()) return;
          if (mainNavigations.length < 64) mainNavigations.push({ wallTime: Date.now(), url: frame.url() });
          else navigationOverflow = true;
        });
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
        // Bottom route fences all external origins; fixture routes fully handle business API/WS.
        await page.route("**/*", async (route) => {
          const request = route.request();
          if (new URL(request.url()).origin !== origin) {
            blockedExternalRequests.push({
              method: request.method(),
              url: request.url(),
            });
            await route.abort("blockedbyclient");
          } else await route.continue();
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
            const ordinal = ++directoryCounts[index];
            const status =
              variant.kind === "warm-error" && index === 1 && ordinal === 2
                ? 500
                : 200;
            const json =
              status === 500
                ? { error: WARM_ERROR }
                : [
                    responses.response,
                    responses.providers,
                    responses.other,
                    responses.presets,
                  ][index];
            await route.fulfill({ status, json });
            directoryReads.push({ ...entry, status });
            directoryFulfillments.push({
              method: entry.method,
              path,
              ordinal,
              status,
              json,
            });
          } else if (
            businessPattern.test(path) ||
            (!["GET", "HEAD"].includes(entry.method) &&
              !readPostPaths.has(path) &&
              !bookkeepingPaths.has(path))
          ) {
            deniedWrites.push(entry);
            await route.fulfill({
              status: 409,
              json: { error: "R20 non-read operation denied" },
            });
          } else {
            if (bookkeepingPaths.has(path) && entry.method !== "GET")
              bookkeeping.push(entry);
            await route.fallback();
          }
        });
        const record = async (phase: string) => {
          if (!reader) throw new Error("Mounted readonly reader unavailable");
          const value = await readView(page, reader, scope);
          states.push({ phase, value });
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
        const frames = () =>
          page.evaluate(
            () =>
              new Promise<void>((done) =>
                requestAnimationFrame(() =>
                  requestAnimationFrame(() => done()),
                ),
              ),
          );
        const sample = async (prefix: string) => {
          await record(prefix + "-immediate");
          await frames();
          await record(prefix + "-2raf");
          await page.waitForTimeout(200);
          await record(prefix + "-settled");
        };
        const tabTo = async (target: "trigger" | "power") => {
          for (let index = 0; index <= 30; index++) {
            if (!reader) throw new Error("Readonly reader unavailable");
            const value = await readView(page, reader, scope);
            if (
              target === "trigger" ? value.activeIsTrigger : value.activeIsPower
            )
              return;
            if (index === (target === "trigger" ? 20 : 30))
              throw new Error(target + " unreachable by ordinary Tab");
            await page.keyboard.press("Tab");
            tabs++;
            await record(`tab-to-${target}-${index + 1}`);
          }
        };
        try {
          setupMark("before-goto");
          await page.goto("/?mode=session&view=agent", {
            waitUntil: "domcontentloaded",
          });
          setupMark("after-domcontentloaded");
          await page
            .locator(MAIN)
            .locator('[contenteditable="true"]')
            .first()
            .waitFor();
          setupMark("main-editor-mounted");
          await seedSessionUx(page, 1);
          setupMark("seed-complete");
          const otherOwner = await initialize(page, variant);
          setupMark("initialize-complete");
          const read = await createReader(page, otherOwner);
          setupMark("reader-ready");
          reader = read;
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
                  "Four actual successful directory reads and full raw cache, before menu interaction",
              },
            )
            .toEqual(expectedCache);
          expect(directoryReads).toHaveLength(4);
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
          await record("before-open");
          if (variant.kind === "diagnostics") {
            // Actual Radix tooltip delay/hover, without mocked timers or focus APIs.
            await page
              .locator(scope)
              .locator(".session-native-model-trigger")
              .hover();
            await page
              .locator(
                ".session-native-composer-tooltip > .session-native-composer-tooltip-label",
              )
              .first()
              .waitFor({ state: "visible" });
            await record("raw-identity-tooltip");
            await screenshot(`tooltip-${width}-${surface}-${variant.name}.png`);
            await page.mouse.move(0, 0);
          }
          await tabTo("trigger");
          await page.keyboard.press("Enter");
          await page.locator(".session-native-model-menu").waitFor();
          // Never wait for desired focus/label before the first observation.
          await sample("natural-open");
          await screenshot(`open-${width}-${surface}-${variant.name}.png`);
          if (variant.kind === "warm-error") {
            publicReads.push(await refreshProvidersRead(page));
            await expect
              .poll(
                async () => (await readView(page, read, scope)).cache.error,
                { timeout: 3000 },
              )
              .toBe(WARM_ERROR);
            await sample("warm-error");
            await screenshot(
              `warm-error-${width}-${surface}-${variant.name}.png`,
            );
          }
          if (variant.kind === "diagnostics") {
            await tabTo("power");
            await page.keyboard.press("ArrowRight");
            await expect
              .poll(
                async () =>
                  (await readView(page, read, scope)).settings.reasoningEffort,
                { timeout: 3000 },
              )
              .toBe("high");
            await record("explicit-effort-adjusted");
            await screenshot(
              `adjusted-${width}-${surface}-${variant.name}.png`,
            );
          }
          await page
            .locator(".session-native-model-menu .session-native-power-caption")
            .click();
          await sample("advanced");
          await screenshot(`advanced-${width}-${surface}-${variant.name}.png`);
          if (variant.kind === "diagnostics") {
            await page
              .getByRole("button", { name: "打开最近使用的模型", exact: true })
              .click();
            await record("raw-recent-visible");
            await screenshot(`recent-${width}-${surface}-${variant.name}.png`);
          }
          await page.keyboard.press("Escape");
          await page
            .locator(".session-native-model-menu")
            .waitFor({ state: "detached" });
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
          if (reader)
            try {
              await record("finally-current");
            } catch (error) {
              captureErrors.push("final snapshot: " + String(error));
            }
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
          if (reader)
            try {
              await reader.dispose();
            } catch (error) {
              captureErrors.push("reader release: " + String(error));
            }
          const after = hashes();
          const fixtureViteConsole = consoleErrors.filter((message) =>
            message.startsWith("[vite] failed to connect to websocket."),
          );
          const failedProviderURL = api.find(
            (entry) =>
              variant.kind === "warm-error" &&
              entry.path.endsWith("/api/codex/provider/list"),
          )?.path;
          const fixtureWarmConsole =
            variant.kind === "warm-error"
              ? consoleDetails
                  .filter(
                    (entry) =>
                      entry.text.startsWith(
                        "Failed to load resource: the server responded with a status of 500",
                      ) &&
                      new URL(entry.url, origin).origin === origin &&
                      new URL(entry.url, origin).pathname === failedProviderURL,
                  )
                  .map((entry) => entry.text)
              : [];
          const unexpectedConsoleErrors = consoleErrors.filter(
            (message) =>
              !fixtureViteConsole.includes(message) &&
              !fixtureWarmConsole.includes(message),
          );
          const evidence = {
            width,
            height,
            surface,
            variant,
            responses,
            sources: { before, after },
            directoryReads,
            directoryFulfillments,
            directoryCounts,
            publicReads,
            externalReadBoundary:
              variant.kind === "warm-error"
                ? "One explicit public useModelCacheStore.refreshProviders() read (not a user UI action) triggers the held-success warm error gate."
                : null,
            api,
            deniedWrites,
            bookkeeping,
            readPostPaths: [...readPostPaths],
            bookkeepingPaths: [...bookkeepingPaths],
            blockedExternalRequests,
            fixtureCalls: fixture.calls,
            readiness,
            states,
            setupTimeline,
            mainNavigations,
            navigationOverflow,
            tabs,
            events,
            pageErrors,
            consoleErrors,
            consoleDetails,
            fixtureViteConsole,
            fixtureWarmConsole,
            unexpectedConsoleErrors,
            captureErrors,
            screenshots,
            failure: failure ? String(failure) : null,
            boundary:
              "Local product through isolated API/WS fixture; no original import/native/authenticated account.390x844 mobile/coarse simulation, not physical device. Chinese 自定义 is grounded in sealed official dictionary source only; no new original Chinese runtime. Two model spans are visible labels; ordinary native live status uses localized model and toa effort wording. Existing raw aria/recent/extra checked row are preserved local diagnostics, not original parity claims; the ordinary diagnostic tooltip uses its effective purpose; visible effort caption/trigger retain P8.",
          };
          const path = info.outputPath("model-menu-unknown-label.json");
          writeFileSync(path, JSON.stringify(evidence, null, 2));
          await info.attach("model-menu-unknown-label", {
            path,
            contentType: "application/json",
          });
          // Evidence is persisted before every final label/behavior/source assertion.
          if (failure) throw failure;
          expect(after).toEqual(before);
          expect(pageErrors).toEqual([]);
          expect(captureErrors).toEqual([]);
          expect(unexpectedConsoleErrors).toEqual([]);
          expect(deniedWrites).toEqual([]);
          expect(blockedExternalRequests).toEqual([]);
          expect(
            fixture.calls.filter((call) => businessPattern.test(call.path)),
          ).toEqual([]);
          expect(api.filter((call) => businessPattern.test(call.path))).toEqual(
            [],
          );
          expect(events?.overflow).toBe(false);
          expect(
            events?.events.filter((event) => event.type === "submit"),
          ).toEqual([]);
          expect(directoryCounts).toEqual(
            variant.kind === "warm-error" ? [1, 2, 1, 1] : [1, 1, 1, 1],
          );
          expect(directoryReads).toHaveLength(
            variant.kind === "warm-error" ? 5 : 4,
          );
          expect(directoryFulfillments).toHaveLength(
            variant.kind === "warm-error" ? 5 : 4,
          );
          for (const [index, suffix] of directoryPaths.entries()) {
            const count = variant.kind === "warm-error" && index === 1 ? 2 : 1;
            const expected = Array.from({ length: count }, (_, ordinal) => ({
              method: index === 0 ? "POST" : "GET",
              path: "/api/session" + suffix,
              body: index === 0 ? { cursor: null, limit: 100 } : null,
              status: ordinal === 1 ? 500 : 200,
            }));
            expect(
              directoryReads.filter((read) => read.path.endsWith(suffix)),
            ).toEqual(expected);
            expect(
              directoryFulfillments.filter((read) =>
                read.path.endsWith(suffix),
              ),
            ).toEqual(
              expected.map((read, ordinal) => ({
                method: read.method,
                path: read.path,
                ordinal: ordinal + 1,
                status: read.status,
                json:
                  read.status === 500
                    ? { error: WARM_ERROR }
                    : [
                        responses.response,
                        responses.providers,
                        responses.other,
                        responses.presets,
                      ][index],
              })),
            );
          }
          const lookup = new Map(
            states.map((state) => [state.phase, state.value]),
          );
          const baseline = lookup.get("before-open")!;
          expect(baseline.currentThreadId).toBe("ux-0");
          expect(baseline.owner).toBeTruthy();
          expect(baseline.settings).toMatchObject({
            model: variant.model,
            modelProvider: variant.provider,
            reasoningEffort: variant.effort,
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
          expect(baseline.recent).toEqual([]);
          expect(baseline.defaults).toMatchObject({
            model: variant.model,
            modelProvider: variant.provider,
            reasoningEffort: variant.effort ?? "high",
          });
          expect(baseline.otherSettings).toMatchObject({
            model: "r20-other-model",
            reasoningEffort: "high",
            revision: 7,
          });
          expect(baseline.otherDraft?.text).toBe("R20 另一 owner 的草稿");
          if (variant.effort === null) {
            expect(baseline.entry?.reasoningEffort).toBeNull();
            expect(baseline.defaults.reasoningEffort).toBe("high");
          }
          const identity =
            variant.kind === "known" ? "R20 目录选中项" : variant.model;
          const visible =
            variant.kind === "known" || variant.kind === "custom"
              ? identity
              : "自定义";
          const initialDisplay = variant.kind === "custom" ? "none" : "medium";
          const initialOptions =
            variant.kind === "known"
              ? ["medium", "high"]
              : variant.kind === "custom"
                ? GENERIC_OPTIONS
                : UNKNOWN_OPTIONS;
          const label = (effort: string) =>
            effort === "none" ? "无" : effort === "high" ? "高" : "中";
          const statusLabel = (effort: string) =>
            variant.provider === "openai" && effort === "medium" ? "标准"
              : variant.provider === "openai" && effort === "high" ? "深度"
                : label(effort);
          expect(baseline.trigger.model).toBe(visible);
          expect(baseline.trigger.modelVisible).toBe(true);
          expect(baseline.trigger.label).toBe(
            `模型：${variant.model}，${initialDisplay}`,
          );
          expect(baseline.trigger.effort).toBe(label(initialDisplay));
          for (const phase of [
            "natural-open-immediate",
            "natural-open-2raf",
            "natural-open-settled",
          ]) {
            const value = lookup.get(phase)!;
            expect(value.menu, phase).toMatchObject({
              view: "simple",
              model: visible,
              modelVisible: true,
              captionAria: "选择模型",
              caption: label(initialDisplay),
              dots: initialOptions.length,
              sliderCount: 1,
            });
            if (variant.kind === "custom") expect(value.trigger.model, phase).toBe(visible);
            else {
              expect(value.trigger.model, phase).toBeUndefined();
              expect(value.trigger.effort, phase).toBeUndefined();
              expect(value.trigger.label, phase).toBeNull();
              expect(value.trigger.purpose, phase).toBe("选择强度");
            }
            expect(value.menu?.status, phase).toContain(
              `${visible} ${statusLabel(initialDisplay)}`,
            );
            expect(value.menu?.status, phase).toContain(
              `第 ${initialOptions.indexOf(initialDisplay) + 1} 项，共 ${initialOptions.length} 项`,
            );
          }
          if (variant.kind === "warm-error") {
            expect(publicReads).toHaveLength(1);
            expect(publicReads[0]).toMatchObject({
              operation: "useModelCacheStore.refreshProviders",
              moduleURL: baseline.moduleURLs[4],
              loaded: true,
              loading: false,
              error: WARM_ERROR,
            });
            for (const phase of ["warm-error-2raf", "warm-error-settled"]) {
              const value = lookup.get(phase)!;
              // Native model/list status is independent of this ancillary
              // provider refresh; its accepted unknown-model snapshot remains.
              expect(value.trigger).toMatchObject({
                model: undefined,
                label: null,
                effort: undefined,
                purpose: "选择强度",
              });
              expect(value.menu).toMatchObject({
                view: "simple",
                model: "自定义",
                caption: "中",
                dots: 6,
              });
              expect(value.menu?.status).toContain("自定义 标准");
            }
          } else expect(publicReads).toEqual([]);
          if (variant.kind === "diagnostics") {
            expect(lookup.get("raw-identity-tooltip")?.tooltipLabels).toContain(
              "选择强度",
            );
            const adjusted = lookup.get("explicit-effort-adjusted")!;
            expect(adjusted.menu).toMatchObject({
              view: "simple",
              model: "自定义",
              caption: "高",
              dots: 6,
            });
            expect(adjusted.menu?.status).toContain("自定义 深度");
            expect(
              lookup.get("raw-recent-visible")?.menu?.recentGroup,
            ).toContain(`${variant.model} · 高 · 标准`);
          }
          const expectedRadios =
            variant.kind === "custom"
              ? [{ label: SHARED, checked: "true" }]
              : [
                  ...responses.response.data.map((model) => ({
                    label: model.displayName,
                    checked: model.id === variant.model ? "true" : "false",
                  })),
                  ...(!responses.response.data.some(
                    (model) => model.id === variant.model,
                  )
                    ? [{ label: variant.model, checked: "true" }]
                    : []),
                ];
          for (const phase of [
            "advanced-immediate",
            "advanced-2raf",
            "advanced-settled",
          ]) {
            const value = lookup.get(phase)!;
            expect(value.menu?.view, phase).toBe("advanced");
            expect(value.menu?.sliderCount, phase).toBe(0);
            expect(
              value.menu?.radios.map(({ label, checked }) => ({
                label,
                checked,
              })),
              phase,
            ).toEqual(expectedRadios);
          }
          let adjusted = false,
            warm = false;
          for (const state of states) {
            adjusted ||= state.phase === "explicit-effort-adjusted";
            warm ||= state.phase === "warm-error-immediate";
            const value = state.value;
            const nextSettings = adjusted
              ? { ...baseline.settings, reasoningEffort: "high" }
              : baseline.settings;
            expect(value.settings, state.phase).toEqual(nextSettings);
            expect(value.entry, state.phase).toEqual(
              adjusted
                ? {
                    ...baseline.entry,
                    reasoningEffort: "high",
                    revision: 5,
                    pending: true,
                    pendingFields: ["reasoningEffort"],
                  }
                : baseline.entry,
            );
            for (const key of [
              "defaults",
              "currentThreadId",
              "owner",
              "otherThreads",
              "otherSettings",
              "draft",
              "otherDraft",
              "moduleURLs",
            ] as const)
              expect(value[key], `${state.phase} ${key}`).toEqual(
                baseline[key],
              );
            expect(value.editorText, state.phase).toBe(draft);
            expect(value.mainEditorText, state.phase).toBe(draft);
            expect(value.cache, state.phase).toEqual({
              ...expectedCache,
              error: warm ? WARM_ERROR : null,
            });
            expect(value.cacheIdentity, state.phase).toEqual({
              array: true,
              models: true,
              options: true,
              otherModels: true,
              configProviders: true,
              presets: true,
            });
            expect(value.recent, state.phase).toEqual(
              adjusted
                ? [
                    {
                      model: variant.model,
                      label: variant.model,
                      reasoningEffort: "high",
                      serviceTier: null,
                    },
                  ]
                : [],
            );
            if (value.menu?.rect) {
              expect(value.menu.viewport).toEqual({ width, height });
              expect(value.menu.rect.width).toBeGreaterThan(0);
              expect(value.menu.rect.x).toBeGreaterThanOrEqual(-1);
              expect(value.menu.rect.right).toBeLessThanOrEqual(width + 1);
              expect(value.menu.horizontalOverflow).toBeLessThanOrEqual(1);
              expect(value.menu.pageHorizontalOverflow).toBeLessThanOrEqual(1);
            }
          }
          const keys =
            events?.events.filter((event) => event.type === "keydown") ?? [];
          expect(
            keys.every((event) => event.trusted && event.code === event.key),
          ).toBe(true);
          expect(keys.filter((event) => event.key === "Tab")).toHaveLength(
            tabs,
          );
          expect(tabs).toBeGreaterThan(0);
          expect(
            keys.filter(
              (event) => event.key === "Enter" && event.withinTrigger,
            ),
          ).toHaveLength(1);
          expect(keys.filter((event) => event.key === "Escape")).toHaveLength(
            1,
          );
          expect(
            keys.filter((event) => String(event.key).startsWith("Arrow")),
          ).toHaveLength(variant.kind === "diagnostics" ? 1 : 0);
          if (variant.kind === "diagnostics")
            expect(
              keys.filter(
                (event) => event.key === "ArrowRight" && event.withinPower,
              ),
            ).toHaveLength(1);
          expect(
            events?.events.filter(
              (event) =>
                event.type === "click" && event.withinCaption && event.trusted,
            ),
          ).toHaveLength(1);
          expect(lookup.get("escape-restored")?.activeIsEditor).toBe(true);
          expect(lookup.get("escape-restored")?.menu).toBeNull();
          if (surface === "expanded")
            expect(lookup.get("expanded-back")?.activeIsEditor).toBe(true);
        }
      });
  });
}
