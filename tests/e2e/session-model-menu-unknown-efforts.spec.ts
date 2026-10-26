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

const UNKNOWN = "r18-typed-unknown";
const SHARED = "r18-shared-provider-model";
const CUSTOM = "r18-custom";
const OTHER = "r18-other-owner";
const MAIN = ".session-codex-composer";
const EXPANDED = ".session-composer-sheet.is-full";
const EDITOR = '[contenteditable="true"], .session-rich-draft textarea';
const UNKNOWN_OPTIONS = ["minimal", "low", "medium", "high", "xhigh", "max"];
const CUSTOM_OPTIONS = ["none", "low", "medium", "high", "xhigh"];
const inputs = [
  "apps/web/src/session-mode/components/codex/composer/nativeReasoningOptions.ts",
  "apps/web/src/session-mode/components/codex/composer/NativeModelSelector.tsx",
  "apps/web/src/session-mode/components/codex/composer/NativeModelTrigger.tsx",
  "apps/web/src/session-mode/components/codex/composer/ReasoningEffortSelector.tsx",
  "apps/web/src/session-mode/components/codex/composer/nativeReasoningLabel.ts",
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
  "tests/e2e/session-model-menu-unknown-efforts.spec.ts",
];
const hashes = () =>
  inputs.map((path) => ({
    path,
    sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
  }));
const businessPattern =
  /\/(?:turn\/(?:start|steer|interrupt)|thread\/(?:start|resume|fork|delete)|followups\/(?:submit|change|stop)|goal\/(?:set|clear))$/;

type Case = {
  name: string;
  provider: string;
  effort: string | null;
  display: string;
  displayLabel: string;
  key: "ArrowLeft" | "ArrowRight";
  next: string;
};
const unknownCases: Case[] = [
  {
    name: "low-left-minimal",
    provider: "openai",
    effort: "low",
    display: "low",
    displayLabel: "轻度",
    key: "ArrowLeft",
    next: "minimal",
  },
  {
    name: "xhigh-right-max",
    provider: "openai",
    effort: "xhigh",
    display: "xhigh",
    displayLabel: "极高",
    key: "ArrowRight",
    next: "max",
  },
  {
    name: "none-display-medium-right-high",
    provider: "openai",
    effort: "none",
    display: "medium",
    displayLabel: "中",
    key: "ArrowRight",
    next: "high",
  },
  {
    name: "null-display-medium-right-high",
    provider: "openai",
    effort: null,
    display: "medium",
    displayLabel: "中",
    key: "ArrowRight",
    next: "high",
  },
];
const customCase: Case = {
  name: "custom-none-right-low",
  provider: CUSTOM,
  effort: "none",
  display: "none",
  displayLabel: "无",
  key: "ArrowRight",
  next: "low",
};

function directory(custom: boolean) {
  const models: Model[] = [
    "r18-catalog-first",
    SHARED,
    "r18-catalog-third",
  ].map((id, index) => ({
    id,
    model: id,
    displayName: ["R18 目录首项", "R18 同名 OpenAI 项", "R18 目录第三项"][
      index
    ],
    description: "Isolated complete unknown-effort model/list fixture",
    upgrade: null,
    upgradeInfo: null,
    availabilityNux: null,
    hidden: false,
    isDefault: index === 0,
    // A same-ID OpenAI model has only medium. It must not restrict the custom
    // provider's five choices or normalize that provider's configured none.
    supportedReasoningEfforts: (index === 1
      ? ["medium"]
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
  const providers: ConfigProvider[] = custom
    ? [
        {
          name: CUSTOM,
          base_url: "https://unused-fixture.invalid/v1",
          env_key: null,
        },
      ]
    : [];
  const other: FrontendProviderModels[] = custom
    ? [{ provider: CUSTOM, models: [{ id: SHARED, context_length: 32768 }] }]
    : [];
  const presets: ProviderPreset[] = [];
  const grouped: Record<string, ModelListItem[]> = custom
    ? { [CUSTOM]: [{ id: SHARED, label: SHARED }] }
    : {};
  return { response, providers, other, presets, grouped };
}

async function initialize(page: Page, variant: Case) {
  return page.evaluate(
    async ({ variant, unknown, shared, custom, other }) => {
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
      const model = variant.provider === custom ? shared : unknown;
      const providerModels =
        variant.provider === custom
          ? { openai: shared, [custom]: shared }
          : { openai: unknown };
      // Only explicit synthetic configuration/draft setup. The model cache is
      // initialized by the real useModels effect through its four API reads.
      useConfigStore.setState({
        model,
        modelProvider: variant.provider,
        // Existing-thread null stays in ux-0 below; the new-chat defaults are
        // independently initialized to a legal medium setting.
        reasoningEffort: variant.effort ?? "medium",
        providerModels,
        serviceTier: null,
      });
      useThreadModelStore.setState({
        threads: {
          ...useThreadModelStore.getState().threads,
          "ux-0": {
            model,
            modelProvider: variant.provider,
            reasoningEffort: variant.effort,
            providerModels,
            serviceTier: null,
            revision: 4,
            pending: false,
            pendingFields: [],
          },
          [other]: {
            model: "r18-catalog-third",
            modelProvider: "openai",
            reasoningEffort: "high",
            providerModels: { openai: "r18-catalog-third" },
            serviceTier: null,
            revision: 7,
            pending: false,
          },
        },
      });
      const otherOwner = sessionDraftKey("codex", other);
      useSessionDraftStore
        .getState()
        .setText(otherOwner, "R18 另一 owner 的草稿");
      useLayoutStore.setState({ isSidebarOpen: false });
      useAgentCenterStore
        .getState()
        .addAgentCard(
          {
            kind: "codex",
            id: "ux-0",
            cwd: "/fixture/项目/very-long-project-path-for-ui-regression",
            preview: "R18 未知模型强度验收",
          },
          { activate: true },
        );
      return otherOwner as string;
    },
    { variant, unknown: UNKNOWN, shared: SHARED, custom: CUSTOM, other: OTHER },
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
          trigger: {
            label: trigger?.getAttribute("aria-label"),
            model: trigger?.querySelector(".session-native-model-label")
              ?.textContent,
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
        trusted: event.isTrusted,
        key: event instanceof KeyboardEvent ? event.key : null,
        code: event instanceof KeyboardEvent ? event.code : null,
        role: target?.getAttribute("role"),
        label: target?.getAttribute("aria-label"),
        controlLabel: target
          ?.closest("button, [role^=menuitem]")
          ?.getAttribute("aria-label"),
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

for (const width of [1440, 390]) {
  test.describe("unknown efforts " + width, () => {
    test.use({
      viewport: { width, height: width === 390 ? 844 : 1000 },
      hasTouch: width === 390,
      isMobile: width === 390,
    });
    const cases = [
      ...(["main", "expanded"] as const).flatMap((surface) =>
        unknownCases.map((variant) => ({ surface, variant })),
      ),
      { surface: "main" as const, variant: customCase },
    ];
    for (const { surface, variant } of cases) {
      test(`${surface} ${variant.name} keeps raw catalog and other owners intact`, async ({
        page,
      }, info) => {
        test.setTimeout(60_000);
        const before = hashes();
        const custom = variant.provider === CUSTOM,
          responses = directory(custom);
        const expectedCache = {
          loaded: true,
          loading: false,
          error: null,
          models: responses.response.data,
          otherModels: responses.grouped,
          configProviders: responses.providers,
          presets: responses.presets,
        };
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
        const api: Array<{ method: string; path: string; body: unknown }> = [];
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
        const readiness: Array<Awaited<ReturnType<typeof readView>>["cache"]> =
          [];
        let reader: Reader | null = null,
          observer: Awaited<ReturnType<typeof observeInputs>> | null = null;
        let events: {
          events: Array<Record<string, unknown>>;
          overflow: boolean;
        } | null = null;
        let failure: unknown = null,
          tabs = 0;
        let scope = surface === "main" ? MAIN : EXPANDED;
        const draft = `R18 保留草稿 ${width} ${surface} ${variant.name}`;
        page.on("pageerror", (error) => pageErrors.push(String(error)));
        page.on("console", (message) => {
          if (message.type() === "error") consoleErrors.push(message.text());
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
            const json = [
              responses.response,
              responses.providers,
              responses.other,
              responses.presets,
            ][index];
            await route.fulfill({ json });
            directoryReads.push({ ...entry, status: 200 });
          } else if (businessPattern.test(path))
            await route.fulfill({
              status: 409,
              json: { error: "Unexpected R18 business mutation denied" },
            });
          else await route.fallback();
        });
        const record = async (phase: string) => {
          if (!reader) throw new Error("Mounted reader unavailable");
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
        const tabTo = async (target: "trigger" | "power") => {
          if (!reader) throw new Error("View reader unavailable");
          const maximum = target === "trigger" ? 20 : 30;
          for (let index = 0; index <= maximum; index++) {
            const value = await readView(page, reader, scope);
            if (
              target === "trigger" ? value.activeIsTrigger : value.activeIsPower
            )
              return;
            if (index === maximum)
              throw new Error(
                `${target} unreachable after ${maximum} real Tab presses`,
              );
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
          const otherOwner = await initialize(page, variant);
          const read = await createReader(page, otherOwner);
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
                  "All four actual directory reads and full raw cache ready",
              },
            )
            .toEqual(expectedCache);
          // Reject a wrong directory fixture before touching the menu. Both id
          // and model are absent for unknown OpenAI; custom intentionally shares
          // its id with a known one-medium OpenAI model, in a separate provider.
          expect(directoryReads).toHaveLength(4);
          for (const [index, suffix] of directoryPaths.entries()) {
            const reads = directoryReads.filter((entry) =>
              entry.path.endsWith(suffix),
            );
            expect(reads).toHaveLength(1);
            expect(reads[0]).toMatchObject({
              method: index === 0 ? "POST" : "GET",
              path: "/api/session" + suffix,
              body: index === 0 ? { cursor: null, limit: 100 } : null,
              status: 200,
            });
          }
          expect(
            responses.response.data.some(
              (model) => model.id === UNKNOWN || model.model === UNKNOWN,
            ),
          ).toBe(false);
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
          await tabTo("trigger");
          await page.keyboard.press("Enter");
          await page.locator(".session-native-model-menu").waitFor();
          await page.evaluate(
            () =>
              new Promise<void>((done) =>
                requestAnimationFrame(() =>
                  requestAnimationFrame(() => done()),
                ),
              ),
          );
          await record("natural-open");
          await screenshot(`open-${width}-${surface}-${variant.name}.png`);
          await tabTo("power");
          await page.keyboard.press(variant.key);
          await expect
            .poll(
              async () =>
                (await readView(page, read, scope)).settings.reasoningEffort,
              { timeout: 3000 },
            )
            .toBe(variant.next);
          await record("after-adjust");
          await screenshot(`adjusted-${width}-${surface}-${variant.name}.png`);
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
          const after = hashes(),
            forbiddenWrites = api.filter((call) =>
              businessPattern.test(call.path),
            );
          const fixtureViteConsole = consoleErrors.filter((message) =>
            message.startsWith("[vite] failed to connect to websocket."),
          );
          const unexpectedConsoleErrors = consoleErrors.filter(
            (message) => !fixtureViteConsole.includes(message),
          );
          const evidence = {
            width,
            height: width === 390 ? 844 : 1000,
            surface,
            variant,
            responses,
            sources: { before, after },
            directoryReads,
            api,
            forbiddenWrites,
            fixtureCalls: fixture.calls,
            readiness,
            states,
            tabs,
            events,
            pageErrors,
            consoleErrors,
            fixtureViteConsole,
            unexpectedConsoleErrors,
            captureErrors,
            screenshots,
            failure: failure ? String(failure) : null,
            boundary:
              "Isolated API/WS and actual local product, no original import/native/account. 390x844 viewport/touch emulation, not physical device. Four real directory reads prove loaded success. Only explicit ux-0 effort may change; defaults/other owners/raw catalog remain intact. Open captures follow two RAFs, not complete settled pixel parity.",
          };
          const path = info.outputPath("model-menu-unknown-efforts.json");
          writeFileSync(path, JSON.stringify(evidence, null, 2));
          await info.attach("model-menu-unknown-efforts", {
            path,
            contentType: "application/json",
          });
          // Preserve all observations before parity assertions, even when a
          // genuine interaction or readiness prerequisite fails.
          if (failure) throw failure;
          expect(after).toEqual(before);
          expect(forbiddenWrites).toEqual([]);
          expect(
            fixture.calls.filter((call) => businessPattern.test(call.path)),
          ).toEqual([]);
          expect(pageErrors).toEqual([]);
          expect(unexpectedConsoleErrors).toEqual([]);
          expect(captureErrors).toEqual([]);
          expect(events?.overflow).toBe(false);
          expect(
            events?.events.filter((event) => event.type === "submit"),
          ).toEqual([]);
          expect(directoryReads).toHaveLength(4);
          expect(
            api.filter((call) =>
              directoryPaths.some((suffix) => call.path.endsWith(suffix)),
            ),
          ).toHaveLength(4);
          const baseline = states.find(
            (state) => state.phase === "before-open",
          )!.value;
          const opened = states.find(
            (state) => state.phase === "natural-open",
          )!.value;
          const adjusted = states.find(
            (state) => state.phase === "after-adjust",
          )!.value;
          const options = custom ? CUSTOM_OPTIONS : UNKNOWN_OPTIONS;
          const model = custom ? SHARED : UNKNOWN;
          expect(baseline.currentThreadId).toBe("ux-0");
          expect(baseline.owner).toBeTruthy();
          expect(baseline.settings).toMatchObject({
            model,
            modelProvider: variant.provider,
            reasoningEffort: variant.effort,
            serviceTier: null,
          });
          expect(baseline.defaults).toMatchObject({
            model,
            modelProvider: variant.provider,
            reasoningEffort: variant.effort ?? "medium",
            serviceTier: null,
          });
          expect(baseline.entry).toMatchObject({
            revision: 4,
            pending: false,
            pendingFields: [],
          });
          if (variant.effort === null) {
            expect(baseline.entry.reasoningEffort).toBeNull();
            expect(baseline.settings.reasoningEffort).toBeNull();
            expect(baseline.defaults.reasoningEffort).toBe("medium");
          }
          expect(baseline.otherDraft).toMatchObject({
            text: "R18 另一 owner 的草稿",
          });
          expect(baseline.otherSettings).toMatchObject({
            model: "r18-catalog-third",
            reasoningEffort: "high",
            revision: 7,
          });
          expect(baseline.trigger.effort).toBe(variant.displayLabel);
          expect(baseline.trigger.label).toBe(
            `模型：${model}，${variant.display}`,
          );
          expect(opened.settings).toEqual(baseline.settings);
          expect(opened.entry).toEqual(baseline.entry);
          expect(opened.menu).toMatchObject({
            view: "simple",
            dots: options.length,
            sliderCount: 1,
            caption: variant.displayLabel,
          });
          expect(opened.menu?.status).toContain(
            `第 ${options.indexOf(variant.display) + 1} 项，共 ${options.length} 项`,
          );
          expect(adjusted.settings).toEqual({
            ...baseline.settings,
            reasoningEffort: variant.next,
          });
          expect(adjusted.menu?.status).toContain(
            `第 ${options.indexOf(variant.next) + 1} 项，共 ${options.length} 项`,
          );
          expect(adjusted.entry).toMatchObject({
            revision: 5,
            pending: true,
            pendingFields: ["reasoningEffort"],
          });
          const keydowns =
            events?.events.filter((event) => event.type === "keydown") ?? [];
          const tabEvents = keydowns.filter((event) => event.key === "Tab");
          expect(tabEvents).toHaveLength(tabs);
          expect(tabs).toBeGreaterThan(0);
          expect(
            keydowns.every(
              (event) => event.trusted && event.code === event.key,
            ),
          ).toBe(true);
          expect(
            keydowns.filter(
              (event) => event.key === "Enter" && event.withinTrigger,
            ),
          ).toHaveLength(1);
          expect(
            keydowns.filter(
              (event) => event.withinPower && event.key === variant.key,
            ),
          ).toHaveLength(1);
          expect(
            keydowns.filter((event) => String(event.key).startsWith("Arrow")),
          ).toHaveLength(1);
          let afterAdjust = false;
          for (const state of states) {
            if (state.phase === "after-adjust") afterAdjust = true;
            expect(state.value.settings, state.phase).toEqual({
              ...baseline.settings,
              reasoningEffort: afterAdjust ? variant.next : variant.effort,
            });
            expect(state.value.defaults, state.phase).toEqual(
              baseline.defaults,
            );
            expect(state.value.currentThreadId, state.phase).toBe("ux-0");
            expect(state.value.owner, state.phase).toBe(baseline.owner);
            expect(state.value.draft, state.phase).toEqual(baseline.draft);
            expect(state.value.otherDraft, state.phase).toEqual(
              baseline.otherDraft,
            );
            expect(state.value.otherThreads, state.phase).toEqual(
              baseline.otherThreads,
            );
            expect(state.value.editorText, state.phase).toBe(draft);
            expect(state.value.mainEditorText, state.phase).toBe(draft);
            expect(state.value.cache, state.phase).toEqual(expectedCache);
            expect(state.value.cacheIdentity, state.phase).toEqual({
              array: true,
              models: true,
              options: true,
              otherModels: true,
              configProviders: true,
              presets: true,
            });
            if (!afterAdjust)
              expect(state.value.entry, state.phase).toEqual(baseline.entry);
            if (state.value.menu?.rect) {
              const {
                rect,
                viewport,
                horizontalOverflow,
                pageHorizontalOverflow,
              } = state.value.menu;
              expect(viewport).toEqual({
                width,
                height: width === 390 ? 844 : 1000,
              });
              expect(rect.width).toBeGreaterThan(0);
              expect(rect.x).toBeGreaterThanOrEqual(-1);
              expect(rect.right).toBeLessThanOrEqual(width + 1);
              expect(horizontalOverflow).toBeLessThanOrEqual(1);
              expect(pageHorizontalOverflow).toBeLessThanOrEqual(1);
            }
          }
          expect(
            states.find((state) => state.phase === "escape-restored")?.value
              .activeIsEditor,
          ).toBe(true);
          if (surface === "expanded")
            expect(
              states.find((state) => state.phase === "expanded-back")?.value
                .activeIsEditor,
            ).toBe(true);
        }
      });
    }
  });
}
