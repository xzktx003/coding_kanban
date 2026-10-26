import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import type { Model } from "../../apps/web/src/session-mode/bindings/v2";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";

const SELECTED = "effort-filter-selected";
const OTHER = "effort-filter-other";
const MAIN = ".session-codex-composer";
const EXPANDED = ".session-composer-sheet.is-full";
const EDITOR = '[contenteditable="true"], .session-rich-draft textarea';
type Surface = "main" | "expanded" | "side" | "conversation";
type Scenario = "limited" | "skip-persistent" | "configured-persistent";
const inputs = [
  "apps/web/src/session-mode/components/codex/composer/nativeReasoningOptions.ts",
  "apps/web/src/session-mode/components/codex/composer/NativeModelSelector.tsx",
  "apps/web/src/session-mode/components/codex/composer/NativeModelTrigger.tsx",
  "apps/web/src/session-mode/components/codex/composer/ReasoningEffortSelector.tsx",
  "apps/web/src/session-mode/components/codex/composer/nativeReasoningLabel.ts",
  "apps/web/src/session-mode/components/codex/composer/ModelReasonSelector.tsx",
  "apps/web/src/session-mode/components/codex/composer/SideChatPanel.tsx",
  "apps/web/src/session-mode/components/codex/composer/ConversationMenu.tsx",
  "apps/web/src/session-mode/components/common/EffortSlider.tsx",
  "apps/web/src/session-mode/components/ui/dropdown-menu.tsx",
  "apps/web/src/session-mode/components/codex/hooks/useModels.ts",
  "apps/web/src/session-mode/components/codex/stores/useConfigStore.ts",
  "apps/web/src/session-mode/hooks/useThreadModelSettings.ts",
  "apps/web/src/session-mode/stores/useThreadModelStore.ts",
  "apps/web/src/session-mode/stores/useSessionDraftStore.ts",
  "apps/web/src/session-mode/stores/useSideChatStore.ts",
  "apps/web/src/session-mode/components/codex/composer/v2/ComposerSheet.tsx",
  "apps/web/src/session-mode/components/codex/composer/composer-native.css",
  "apps/web/src/session-mode/session-composer-compact.css",
  "apps/web/src/session-mode/services/apiAdapt/codex.ts",
  "apps/web/src/session-mode/services/apiAdapt/shared.ts",
  "tests/e2e/session-ux-fixture.ts",
  "tests/e2e/session-model-menu-effort-filter.spec.ts",
];
const hashes = () =>
  inputs.map((path) => ({
    path,
    sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
  }));
const businessPattern =
  /\/(?:turn\/(?:start|steer|interrupt)|thread\/(?:start|resume|fork|delete)|followups\/(?:submit|change|stop)|goal\/(?:set|clear))$/;

function catalog(scenario: Scenario): Model[] {
  return ["effort-filter-first", SELECTED, "effort-filter-third"].map(
    (id, index) => ({
      id,
      model: id,
      displayName: ["过滤首项", "过滤选中项", "过滤第三项"][index],
      description: "Isolated complete model/list effort-filter fixture",
      upgrade: null,
      upgradeInfo: null,
      availabilityNux: null,
      hidden: false,
      isDefault: index === 0,
      supportedReasoningEfforts: (index === 1
        ? scenario === "limited"
          ? ["medium", "persistent"]
          : ["low", "persistent", "medium"]
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
    }),
  );
}

async function initialize(page: Page, surface: Surface, effort: string) {
  return page.evaluate(
    async ({ selected, other, surface, effort }) => {
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
      const entry = (
        model: string,
        reasoningEffort: string,
        revision: number,
      ) => ({
        model,
        modelProvider: "openai",
        reasoningEffort,
        providerModels: { openai: model },
        serviceTier: null,
        revision,
        pending: false,
      });
      useConfigStore.setState({
        model: selected,
        modelProvider: "openai",
        reasoningEffort: effort,
        providerModels: { openai: selected },
        serviceTier: null,
      });
      const existing = surface === "side" || surface === "conversation";
      useThreadModelStore.setState({
        threads: {
          ...useThreadModelStore.getState().threads,
          [other]: entry("effort-filter-third", "high", 7),
          ...(existing ? { "ux-0": entry(selected, effort, 4) } : {}),
        },
      });
      const otherOwner = sessionDraftKey("codex", other);
      useSessionDraftStore
        .getState()
        .setText(otherOwner, "另一 owner 的过滤草稿");
      if (existing) {
        useLayoutStore.setState({ isSidebarOpen: false });
        useAgentCenterStore.getState().addAgentCard(
          {
            kind: "codex",
            id: "ux-0",
            cwd: "/fixture/项目/very-long-project-path-for-ui-regression",
            preview: "推理选项过滤验收",
          },
          { activate: true },
        );
      }
      return otherOwner as string;
    },
    { selected: SELECTED, other: OTHER, surface, effort },
  );
}

async function createReader(page: Page, surface: Surface, otherOwner: string) {
  return page.evaluateHandle(
    async ({ surface, other, otherOwner }) => {
      const paths = [
        "/src/session-mode/components/codex/stores/useConfigStore.ts",
        "/src/session-mode/components/codex/stores/useCodexStore.ts",
        "/src/session-mode/stores/useThreadModelStore.ts",
        "/src/session-mode/stores/useSessionDraftStore.ts",
        "/src/session-mode/stores/useSideChatStore.ts",
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
        { useSideChatStore },
        { useModelCacheStore },
      ] = await Promise.all(moduleURLs.map((url) => import(url)));
      const project = (value: Record<string, unknown>) => ({
        model: value.model,
        modelProvider: value.modelProvider,
        reasoningEffort: value.reasoningEffort,
        serviceTier: value.serviceTier,
        sandbox: value.sandbox,
        approvalPolicy: value.approvalPolicy,
        approvalsReviewer: value.approvalsReviewer,
        collaborationMode: value.collaborationMode,
        personality: value.personality,
        providerModels: value.providerModels,
        webSearchRequest: value.webSearchRequest,
        autoReviewCapability: value.autoReviewCapability,
      });
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
      const describe = (element: Element | null) =>
        element
          ? {
              tag: element.tagName,
              role: element.getAttribute("role"),
              label: element.getAttribute("aria-label"),
              text: element.textContent?.slice(0, 96),
            }
          : null;
      let initialModels: Model[] | null = null;
      let initialOptions: unknown[] = [];
      let modelObjects: unknown[] = [];
      // One actual mounted-module reader serves both readiness and snapshots.
      // It reads the loaded catalog; it never seeds or mutates the model cache.
      return (selector: string) => {
        const cache = useModelCacheStore.getState();
        if (cache.loaded && !initialModels) {
          initialModels = cache.openAiModels;
          modelObjects = [...cache.openAiModels];
          initialOptions = cache.openAiModels.map(
            (model: Model) => model.supportedReasoningEfforts,
          );
        }
        const currentThreadId = useCodexStore.getState().currentThreadId;
        const sideId = useSideChatStore.getState().chat?.id ?? null;
        const targetId = surface === "side" ? sideId : currentThreadId;
        const scope = document.querySelector(selector);
        const main = document.querySelector(".session-codex-composer");
        const editor =
          surface === "side"
            ? document.querySelector(
                '.session-side-chat textarea[aria-label="侧边聊天输入"]',
              )
            : (scope?.querySelector(
                '[contenteditable="true"], .session-rich-draft textarea',
              ) ?? null);
        const value = (element: Element | null) =>
          element instanceof HTMLTextAreaElement
            ? element.value
            : (element?.textContent ?? null);
        const trigger =
          scope?.querySelector(".session-native-model-trigger") ?? null;
        const menu = document.querySelector(
          surface === "conversation"
            ? '.session-composer-menu[role="menu"]'
            : ".session-native-model-menu",
        );
        const panel =
          surface === "side"
            ? document.querySelector(".session-composer-sheet:not(.is-full)")
            : null;
        const power =
          menu?.querySelector("[data-reasoning-slider]") ??
          panel?.querySelector('[role="slider"][aria-label="推理强度"]') ??
          null;
        const container = menu ?? panel;
        const owner = main?.getAttribute("data-draft-owner") ?? null;
        const threads = useThreadModelStore.getState().threads;
        const active = document.activeElement;
        return {
          now: performance.now(),
          moduleURLs,
          currentThreadId,
          sideId,
          targetId,
          settings: project(getThreadModelSettings(targetId)),
          defaults: project(useConfigStore.getState()),
          mainSettings: project(getThreadModelSettings(currentThreadId)),
          targetEntry: targetId ? (threads[targetId] ?? null) : null,
          otherThreads: Object.fromEntries(
            Object.entries(threads).filter(([id]) => id !== targetId),
          ),
          otherSettings: threads[other] ?? null,
          owner,
          draft: owner
            ? (useSessionDraftStore.getState().drafts[owner] ?? null)
            : null,
          otherDraft:
            useSessionDraftStore.getState().drafts[otherOwner] ?? null,
          editorText: value(editor),
          mainEditorText: value(
            main?.querySelector('[contenteditable="true"]') ?? null,
          ),
          active: describe(active),
          activeIsEditor: active === editor,
          activeIsTrigger: active === trigger,
          activeIsPower: active === power,
          activeInSide: Boolean(active?.closest(".session-side-chat")),
          activeInMain: Boolean(active?.closest(".session-codex-composer")),
          triggerEffort:
            trigger?.querySelector(".session-native-model-effort")
              ?.textContent ?? null,
          cache: {
            loaded: cache.loaded as boolean,
            loading: cache.loading as boolean,
            error: cache.error as string | null,
            models: cache.openAiModels as Model[],
          },
          cacheIdentity: {
            array: initialModels === cache.openAiModels,
            models: cache.openAiModels.every(
              (model: Model, index: number) => modelObjects[index] === model,
            ),
            options: cache.openAiModels.every(
              (model: Model, index: number) =>
                initialOptions[index] === model.supportedReasoningEfforts,
            ),
          },
          controls: container
            ? {
                view:
                  surface === "conversation"
                    ? "conversation"
                    : (menu
                        ?.querySelector("[data-model-picker-view]")
                        ?.getAttribute("data-model-picker-view") ?? "panel"),
                sliderCount: container.querySelectorAll(
                  '[data-reasoning-slider], [role="slider"]',
                ).length,
                dots:
                  menu?.querySelectorAll(".session-native-power-dot").length ??
                  power?.querySelectorAll(":scope > span").length ??
                  0,
                caption:
                  menu?.querySelector(".session-native-power-effort")
                    ?.textContent ?? null,
                status:
                  menu?.querySelector('[role="status"]')?.textContent ?? null,
                thumbLeft:
                  menu?.querySelector<HTMLElement>(
                    ".session-native-power-thumb",
                  )?.style.left ?? null,
                slider: power
                  ? {
                      min: power.getAttribute("aria-valuemin"),
                      max: power.getAttribute("aria-valuemax"),
                      now: power.getAttribute("aria-valuenow"),
                      text: power.getAttribute("aria-valuetext"),
                    }
                  : null,
                radios: [
                  ...container.querySelectorAll('[role="menuitemradio"]'),
                ].map((row) => ({
                  label: row.textContent,
                  checked: row.getAttribute("aria-checked"),
                })),
                rect: rect(container),
                viewport: { width: innerWidth, height: innerHeight },
                horizontalOverflow:
                  container.scrollWidth - container.clientWidth,
                pageHorizontalOverflow:
                  document.documentElement.scrollWidth - innerWidth,
                text: container.textContent,
              }
            : null,
        };
      };
    },
    { surface, other: OTHER, otherOwner },
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
        controlText: target
          ?.closest("button, [role^=menuitem]")
          ?.textContent?.trim()
          .slice(0, 96),
        withinTrigger: Boolean(
          target?.closest(".session-native-model-trigger"),
        ),
        withinPower: Boolean(
          target?.closest('[data-reasoning-slider], [role="slider"]'),
        ),
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
  test.describe("effort filter " + width, () => {
    test.use({
      viewport: { width, height: width === 390 ? 844 : 1000 },
      hasTouch: width === 390,
      isMobile: width === 390,
    });
    const cases: Array<{ surface: Surface; scenario: Scenario }> = [
      ...(["main", "expanded"] as const).flatMap((surface) =>
        (["limited", "skip-persistent", "configured-persistent"] as const).map(
          (scenario) => ({ surface, scenario }),
        ),
      ),
      { surface: "side", scenario: "skip-persistent" },
      { surface: "conversation", scenario: "skip-persistent" },
    ];
    for (const { surface, scenario } of cases) {
      test(`${surface} ${scenario} preserves the raw model and edits only the intended effort`, async ({
        page,
      }, info) => {
        test.setTimeout(60_000);
        const before = hashes(),
          models = catalog(scenario);
        const pageErrors: string[] = [],
          consoleErrors: string[] = [],
          captureErrors: string[] = [],
          screenshots: string[] = [];
        const api: Array<{
          method: string;
          path: string;
          body: unknown;
          allowedSetupFork: boolean;
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
          setupForkAdmitted = false,
          setupComplete = false,
          tabs = 0;
        let scope = surface === "expanded" ? EXPANDED : MAIN;
        const draft = `保留过滤草稿 ${width} ${surface} ${scenario}`;
        const sideDraft = "侧边独立过滤草稿";
        const initialEffort =
          scenario === "configured-persistent"
            ? "persistent"
            : scenario === "limited"
              ? "medium"
              : "low";
        const expectedEffort =
          scenario === "configured-persistent"
            ? "low"
            : scenario === "limited"
              ? "medium"
              : "medium";
        page.on("pageerror", (error) => pageErrors.push(String(error)));
        page.on("console", (message) => {
          if (message.type() === "error") consoleErrors.push(message.text());
        });
        const fixture = await installSessionUxFixture(
          page,
          surface === "side" || surface === "conversation" ? 1 : 0,
          {
            forkSettings: {
              model: SELECTED,
              modelProvider: "openai",
              reasoningEffort: "low",
              serviceTier: null,
            },
          },
        );
        await page.route("**/api/**", async (route) => {
          const request = route.request(),
            path = new URL(request.url()).pathname;
          const body =
            request.method() === "POST" ? request.postDataJSON() : null;
          const allowedSetupFork =
            surface === "side" &&
            !setupComplete &&
            !setupForkAdmitted &&
            path.endsWith("/thread/fork") &&
            body?.threadId === "ux-0";
          api.push({ method: request.method(), path, body, allowedSetupFork });
          if (path.endsWith("/api/codex/model/list"))
            await route.fulfill({ json: { data: models, nextCursor: null } });
          else if (businessPattern.test(path) && !allowedSetupFork)
            await route.fulfill({
              status: 409,
              json: { error: "Unexpected fixture business mutation denied" },
            });
          else {
            if (allowedSetupFork) setupForkAdmitted = true;
            await route.fallback();
          }
        });
        const record = async (phase: string) => {
          if (!reader) throw new Error("Mounted view reader unavailable");
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
        const tabTo = async (kind: "trigger" | "power") => {
          if (!reader) throw new Error("View reader unavailable");
          const maximum = kind === "trigger" ? 20 : 30;
          for (let index = 0; index <= maximum; index++) {
            const value = await readView(page, reader, scope);
            if (
              kind === "trigger" ? value.activeIsTrigger : value.activeIsPower
            )
              return;
            if (index === maximum)
              throw new Error(
                `${kind} unreachable with ${maximum} real Tab presses`,
              );
            await page.keyboard.press("Tab");
            tabs++;
            await record(`tab-to-${kind}-${index + 1}`);
          }
        };
        const openConversation = async () => {
          // The outer attachment popover may remain open after an inner menu
          // action. Reuse its visible trigger instead of toggling it closed.
          if (
            !(await page
              .getByRole("button", { name: "当前会话的更多操作", exact: true })
              .isVisible())
          )
            await page
              .getByRole("button", { name: "附加文件", exact: true })
              .click();
          await page
            .getByRole("button", { name: "当前会话的更多操作", exact: true })
            .click();
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
          await seedSessionUx(
            page,
            surface === "side" || surface === "conversation" ? 1 : 0,
          );
          const otherOwner = await initialize(page, surface, initialEffort);
          const read = await createReader(page, surface, otherOwner);
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
                message: "Actual complete raw model/list catalog ready",
              },
            )
            .toEqual({ loaded: true, loading: false, error: null, models });
          // This read prerequisite is checked before UI interactions. The API
          // prefix is /api/session/api/codex on HTTP; the cache is never seeded.
          expect(
            api.some(
              (call) =>
                call.method === "POST" &&
                call.path.endsWith("/api/codex/model/list"),
            ),
          ).toBe(true);
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
          } else if (surface === "side") {
            await openConversation();
            await page
              .getByRole("menuitem", { name: "侧边聊天", exact: true })
              .click();
            await page
              .getByRole("region", { name: "侧边聊天", exact: true })
              .waitFor();
            await page
              .getByRole("textbox", { name: "侧边聊天输入", exact: true })
              .fill(sideDraft);
          }
          setupComplete = true;
          await record("before-open");
          if (surface === "side") {
            await page
              .getByRole("button", { name: "侧边模型与思考强度", exact: true })
              .click();
            await page
              .getByRole("dialog", { name: "侧边模型与思考强度", exact: true })
              .waitFor();
          } else if (surface === "conversation") {
            await openConversation();
            await page
              .getByRole("menuitem", { name: "提高推理强度", exact: true })
              .waitFor();
          } else {
            await tabTo("trigger");
            await page.keyboard.press("Enter");
            await page.locator(".session-native-model-menu").waitFor();
          }
          await page.evaluate(
            () =>
              new Promise<void>((done) =>
                requestAnimationFrame(() =>
                  requestAnimationFrame(() => done()),
                ),
              ),
          );
          await record("natural-open");
          await screenshot(`open-${width}-${surface}-${scenario}.png`);
          if (scenario === "limited") {
            for (const key of [
              "ArrowDown",
              "ArrowUp",
              "ArrowLeft",
              "ArrowRight",
            ]) {
              await page.keyboard.press(key);
              await record(key);
            }
          } else if (surface === "conversation") {
            await page
              .getByRole("menuitem", { name: "提高推理强度", exact: true })
              .click();
            await page
              .locator('.session-composer-menu[role="menu"]')
              .waitFor({ state: "detached" });
            await expect
              .poll(
                async () =>
                  (await readView(page, read, scope)).settings.reasoningEffort,
              )
              .toBe(expectedEffort);
            await record("after-adjust");
          } else {
            await tabTo("power");
            await page.keyboard.press(
              scenario === "configured-persistent" ? "ArrowLeft" : "ArrowRight",
            );
            await expect
              .poll(
                async () =>
                  (await readView(page, read, scope)).settings.reasoningEffort,
              )
              .toBe(expectedEffort);
            await record("after-adjust");
            await screenshot(`adjusted-${width}-${surface}-${scenario}.png`);
          }
          if (surface === "conversation") {
            // The action dismisses the menu normally. Reopen then Escape to
            // exercise dismissal without sending or changing effort again.
            await openConversation();
          }
          await page.keyboard.press("Escape");
          if (surface === "side")
            await page
              .getByRole("dialog", { name: "侧边模型与思考强度", exact: true })
              .waitFor({ state: "detached" });
          else
            await page
              .locator(
                surface === "conversation"
                  ? '[role="menu"]'
                  : ".session-native-model-menu",
              )
              .waitFor({ state: "detached" });
          if (surface !== "conversation")
            await expect
              .poll(
                async () => {
                  const value = await readView(page, read, scope);
                  return surface === "side"
                    ? value.activeInSide
                    : value.activeIsEditor;
                },
                {
                  timeout: 3000,
                  message:
                    "Escape restores the original owner input or side control",
                },
              )
              .toBe(true);
          await record("escape-restored");
          if (
            surface === "conversation" &&
            (await page
              .getByRole("button", { name: "当前会话的更多操作", exact: true })
              .isVisible())
          ) {
            await page.keyboard.press("Escape");
            await page
              .getByRole("button", { name: "当前会话的更多操作", exact: true })
              .waitFor({ state: "hidden" });
            await record("outer-popover-escape");
          }
          if (surface === "conversation")
            await expect
              .poll(
                async () => (await readView(page, read, scope)).activeInMain,
                { timeout: 3000 },
              )
              .toBe(true);
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
                const result = log.read();
                log.stop();
                return result;
              });
              await observer.dispose();
            } catch (error) {
              captureErrors.push("observer release: " + String(error));
            }
          await screenshot(`final-${width}-${surface}-${scenario}.png`);
          if (reader)
            try {
              await reader.dispose();
            } catch (error) {
              captureErrors.push("reader release: " + String(error));
            }
          const after = hashes();
          const modelReads = api.filter((call) =>
            call.path.endsWith("/api/codex/model/list"),
          );
          const setupForks = api.filter((call) => call.allowedSetupFork);
          const forbiddenWrites = api.filter(
            (call) => businessPattern.test(call.path) && !call.allowedSetupFork,
          );
          const fixtureViteConsole = consoleErrors.filter((message) =>
            message.startsWith("[vite] failed to connect to websocket."),
          );
          const unexpectedConsoleErrors = consoleErrors.filter(
            (message) => !fixtureViteConsole.includes(message),
          );
          const evidence = {
            width,
            surface,
            scenario,
            models,
            initialEffort,
            expectedEffort,
            sources: { before, after },
            readiness,
            modelReads,
            api,
            setupForks,
            forbiddenWrites,
            fixtureCalls: fixture.calls,
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
              "Real local UI/useModels with isolated API/WS fixture, no original bundle/native/account. 390 is viewport/touch simulation, not physical phone. Side-only setup has one explicit fixture fork ux-0→ux-side; all subsequent business mutations denied. Vite WS diagnostics are separately preserved.",
          };
          const path = info.outputPath("model-menu-effort-filter.json");
          writeFileSync(path, JSON.stringify(evidence, null, 2));
          await info.attach("model-menu-effort-filter", {
            path,
            contentType: "application/json",
          });
          // Always write the complete source/API/state/input/screenshot receipt
          // before parity assertions, including a failing interaction attempt.
          if (failure) throw failure;
          expect(after).toEqual(before);
          expect(modelReads.length).toBeGreaterThan(0);
          expect(
            modelReads.every(
              (call) =>
                call.method === "POST" &&
                JSON.stringify(call.body) ===
                  JSON.stringify({ cursor: null, limit: 100 }),
            ),
          ).toBe(true);
          expect(setupForks).toHaveLength(surface === "side" ? 1 : 0);
          expect(forbiddenWrites).toEqual([]);
          expect(pageErrors).toEqual([]);
          expect(unexpectedConsoleErrors).toEqual([]);
          expect(captureErrors).toEqual([]);
          expect(events?.overflow).toBe(false);
          expect(
            events?.events.filter((event) => event.type === "submit"),
          ).toEqual([]);
          const realTabs = events?.events.filter(
            (event) => event.type === "keydown" && event.key === "Tab",
          );
          expect(realTabs).toHaveLength(tabs);
          expect(realTabs?.every((event) => event.trusted)).toBe(true);
          if (surface === "side")
            expect(
              events?.events.filter(
                (event) =>
                  event.type === "click" &&
                  event.controlText === "侧边聊天" &&
                  event.trusted,
              ),
            ).toHaveLength(1);
          if (surface === "conversation")
            expect(
              events?.events.filter(
                (event) =>
                  event.type === "click" &&
                  event.controlText === "提高推理强度" &&
                  event.trusted,
              ),
            ).toHaveLength(1);
          const baseline = states.find(
            (state) => state.phase === "before-open",
          )!.value;
          const opened = states.find(
            (state) => state.phase === "natural-open",
          )!.value;
          expect(baseline.settings).toMatchObject({
            model: SELECTED,
            modelProvider: "openai",
            reasoningEffort: initialEffort,
            serviceTier: null,
          });
          expect(baseline.otherDraft).toMatchObject({
            text: "另一 owner 的过滤草稿",
          });
          expect(baseline.otherSettings).toMatchObject({
            model: "effort-filter-third",
            reasoningEffort: "high",
            revision: 7,
          });
          expect(opened.settings).toEqual(baseline.settings);
          if (surface === "main" || surface === "expanded") {
            expect(tabs).toBeGreaterThan(0);
            expect(
              events?.events.some(
                (event) =>
                  event.type === "keydown" &&
                  event.key === "Enter" &&
                  event.withinTrigger &&
                  event.trusted,
              ),
            ).toBe(true);
            if (scenario === "limited") {
              expect(opened.controls?.view).toBe("advanced");
              expect(opened.controls?.sliderCount).toBe(0);
              expect(opened.controls?.radios).toHaveLength(3);
              expect(opened.controls?.radios.map((row) => row.checked)).toEqual(
                ["false", "true", "false"],
              );
            } else {
              expect(opened.controls).toMatchObject({
                view: "simple",
                dots: 2,
                sliderCount: 1,
                caption: scenario === "configured-persistent" ? "中" : "轻度",
              });
              expect(opened.controls?.text).not.toContain("持续");
              expect(baseline.triggerEffort).toBe(
                scenario === "configured-persistent" ? "中" : "轻度",
              );
              expect(opened.controls?.status).toContain(
                scenario === "configured-persistent"
                  ? "第 2 项，共 2 项"
                  : "第 1 项，共 2 项",
              );
              if (scenario === "configured-persistent")
                expect(opened.controls?.thumbLeft).toMatch(
                  /^calc\((?:187px|13px \+ 174px)\)$/,
                );
            }
          } else if (surface === "side") {
            expect(baseline.targetId).toBe("ux-side");
            expect(opened.controls).toMatchObject({
              view: "panel",
              dots: 2,
              sliderCount: 1,
              slider: { min: "0", max: "1", now: "0", text: "low" },
            });
          }
          const adjusted = states.find(
            (state) => state.phase === "after-adjust",
          )?.value;
          if (scenario !== "limited") {
            expect(adjusted?.settings).toEqual({
              ...baseline.settings,
              reasoningEffort: expectedEffort,
            });
            if (surface !== "conversation")
              expect(
                events?.events.filter(
                  (event) =>
                    event.type === "keydown" &&
                    event.withinPower &&
                    event.trusted &&
                    event.key ===
                      (scenario === "configured-persistent"
                        ? "ArrowLeft"
                        : "ArrowRight"),
                ),
              ).toHaveLength(1);
          }
          let afterAdjust = false;
          for (const state of states) {
            if (state.phase === "after-adjust") afterAdjust = true;
            expect(state.value.settings, state.phase).toEqual({
              ...baseline.settings,
              reasoningEffort: afterAdjust ? expectedEffort : initialEffort,
            });
            expect(state.value.cache, state.phase).toEqual({
              loaded: true,
              loading: false,
              error: null,
              models,
            });
            expect(state.value.cacheIdentity, state.phase).toEqual({
              array: true,
              models: true,
              options: true,
            });
            expect(state.value.currentThreadId, state.phase).toBe(
              baseline.currentThreadId,
            );
            expect(state.value.owner, state.phase).toBe(baseline.owner);
            expect(state.value.draft, state.phase).toEqual(baseline.draft);
            expect(state.value.otherDraft, state.phase).toEqual(
              baseline.otherDraft,
            );
            expect(state.value.otherThreads, state.phase).toEqual(
              baseline.otherThreads,
            );
            expect(state.value.editorText, state.phase).toBe(
              surface === "side" ? sideDraft : draft,
            );
            expect(state.value.mainEditorText, state.phase).toBe(draft);
            if (surface === "side") {
              expect(state.value.mainSettings, state.phase).toEqual(
                baseline.mainSettings,
              );
            }
            if (surface === "side" || surface === "conversation")
              expect(state.value.defaults, state.phase).toEqual(
                baseline.defaults,
              );
            if (state.value.controls?.rect) {
              const {
                rect,
                viewport,
                horizontalOverflow,
                pageHorizontalOverflow,
              } = state.value.controls;
              expect(rect.width, state.phase).toBeGreaterThan(0);
              expect(rect.x, state.phase).toBeGreaterThanOrEqual(-1);
              expect(rect.right, state.phase).toBeLessThanOrEqual(
                viewport.width + 1,
              );
              expect(horizontalOverflow, state.phase).toBeLessThanOrEqual(1);
              expect(pageHorizontalOverflow, state.phase).toBeLessThanOrEqual(
                1,
              );
            }
          }
          const escaped = states.find(
            (state) => state.phase === "escape-restored",
          )!.value;
          if (surface === "main" || surface === "expanded")
            expect(escaped.activeIsEditor).toBe(true);
          if (surface === "side") expect(escaped.activeInSide).toBe(true);
          if (surface === "conversation")
            expect(states.at(-1)?.value.activeInMain).toBe(true);
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
