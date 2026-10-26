import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import type { Model } from "../../apps/web/src/session-mode/bindings/v2";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";

const SELECTED = "initial-focus-selected";
const OTHER = "initial-focus-other";
const MAIN = ".session-codex-composer";
const EXPANDED = ".session-composer-sheet.is-full";
const EDITOR = '[contenteditable="true"], .session-rich-draft textarea';
const entries = ["P", "Enter", "ArrowDown", "naturalAdvancedEnter"] as const;
const inputs = [
  "apps/web/src/session-mode/components/codex/composer/NativeModelSelector.tsx",
  "apps/web/src/session-mode/components/codex/composer/NativeModelTrigger.tsx",
  "apps/web/src/session-mode/components/ui/dropdown-menu.tsx",
  "apps/web/src/session-mode/components/codex/hooks/useModels.ts",
  "apps/web/src/session-mode/components/codex/stores/useConfigStore.ts",
  "apps/web/src/session-mode/hooks/useThreadModelSettings.ts",
  "apps/web/src/session-mode/stores/useThreadModelStore.ts",
  "apps/web/src/session-mode/stores/useSessionDraftStore.ts",
  "apps/web/src/session-mode/components/codex/composer/v2/ComposerSheet.tsx",
  "apps/web/src/session-mode/components/codex/composer/composer-native.css",
  "apps/web/src/session-mode/session-composer-compact.css",
  "apps/web/src/session-mode/hooks/runtime.ts",
  "apps/web/src/session-mode/services/apiAdapt/codex.ts",
  "apps/web/src/session-mode/services/apiAdapt/shared.ts",
  "tests/e2e/session-ux-fixture.ts",
  "tests/e2e/session-model-menu-initial-focus.spec.ts",
];
const hashes = () =>
  inputs.map((path) => ({
    path,
    sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
  }));

function catalog(advanced: boolean): Model[] {
  return ["initial-focus-first", SELECTED, "initial-focus-third"].map(
    (id, index) => ({
      id,
      model: id,
      displayName: ["焦点首项", "焦点选中项", "焦点第三项"][index],
      description: "Isolated initial-focus model/list fixture",
      upgrade: null,
      upgradeInfo: null,
      availabilityNux: null,
      hidden: false,
      isDefault: index === 0,
      supportedReasoningEfforts: (advanced && index === 1
        ? ["medium" as const]
        : ["low" as const, "medium" as const, "high" as const]
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

async function initializeSettings(page: Page) {
  return page.evaluate(
    async ({ selected, other }) => {
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
      ] = await Promise.all([
        load("/src/session-mode/components/codex/stores/useConfigStore.ts"),
        load("/src/session-mode/stores/useThreadModelStore.ts"),
        load("/src/session-mode/stores/useSessionDraftStore.ts"),
      ]);
      useConfigStore.setState({
        model: selected,
        modelProvider: "openai",
        reasoningEffort: "medium",
        serviceTier: null,
      });
      useThreadModelStore.setState({
        threads: {
          ...useThreadModelStore.getState().threads,
          [other]: {
            model: "initial-focus-third",
            modelProvider: "openai",
            reasoningEffort: "high",
            serviceTier: null,
            providerModels: {},
            revision: 7,
            pending: false,
          },
        },
      });
      const otherOwner = sessionDraftKey("codex", other);
      useSessionDraftStore
        .getState()
        .setText(otherOwner, "另一 owner 的未发送草稿");
      return otherOwner as string;
    },
    { selected: SELECTED, other: OTHER },
  );
}

async function createReader(page: Page, otherOwner: string) {
  return page.evaluateHandle(
    async ({ other, otherOwner }) => {
      const paths = [
        "/src/session-mode/components/codex/stores/useConfigStore.ts",
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
        { useThreadModelStore },
        { useSessionDraftStore },
        { useModelCacheStore },
      ] = await Promise.all(moduleURLs.map((url) => import(url)));
      const describe = (element: Element | null) =>
        element
          ? {
              tag: element.tagName,
              id: element.id,
              role: element.getAttribute("role"),
              label: element.getAttribute("aria-label"),
              text: element.textContent?.slice(0, 96),
            }
          : null;
      const rect = (element: Element | null) => {
        if (!element) return null;
        const r = element.getBoundingClientRect();
        return {
          x: r.x,
          y: r.y,
          width: r.width,
          height: r.height,
          right: r.right,
          bottom: r.bottom,
        };
      };
      // A single read-only closure owns module identity for readiness and all
      // observations. No cache, focus method or menu hook is replaced.
      return (selector: string) => {
        const config = useConfigStore.getState(),
          cache = useModelCacheStore.getState();
        const scope = document.querySelector(selector);
        const editor =
          scope?.querySelector(
            '[contenteditable="true"], .session-rich-draft textarea',
          ) ?? null;
        const owner =
          document
            .querySelector(".session-codex-composer")
            ?.getAttribute("data-draft-owner") ?? null;
        const trigger =
          scope?.querySelector(".session-native-model-trigger") ?? null;
        const menu = document.querySelector(".session-native-model-menu");
        const items = [
          ...(menu?.querySelectorAll<HTMLElement>(
            '[role^="menuitem"]:not([data-disabled]):not([aria-disabled="true"])',
          ) ?? []),
        ];
        const caption =
          menu?.querySelector('[role="menuitem"][aria-label="选择模型"]') ??
          null;
        const power = menu?.querySelector('[aria-label="强度"]') ?? null;
        const active = document.activeElement;
        return {
          now: performance.now(),
          moduleURLs,
          settings: {
            model: config.model,
            modelProvider: config.modelProvider,
            reasoningEffort: config.reasoningEffort,
            serviceTier: config.serviceTier,
          },
          owner,
          draft: owner
            ? (useSessionDraftStore.getState().drafts[owner] ?? null)
            : null,
          otherDraft:
            useSessionDraftStore.getState().drafts[otherOwner] ?? null,
          otherSettings: useThreadModelStore.getState().threads[other] ?? null,
          cache: {
            loaded: cache.loaded as boolean,
            loading: cache.loading as boolean,
            error: cache.error as string | null,
            models: cache.openAiModels as Model[],
          },
          editorText:
            editor instanceof HTMLTextAreaElement
              ? editor.value
              : (editor?.textContent ?? null),
          active: describe(active),
          activeIsEditor: active === editor,
          activeIsTrigger: active === trigger,
          activeIsMenu: !!menu && active === menu,
          activeIsCaption: !!caption && active === caption,
          activeIsPower: !!power && active === power,
          activeIsFirstItem: !!items.length && active === items[0],
          activeIsChecked:
            !!active && active.getAttribute("aria-checked") === "true",
          triggerControls: trigger?.getAttribute("aria-controls") ?? null,
          menu: menu
            ? {
                id: menu.id,
                view: menu
                  .querySelector("[data-model-picker-view]")
                  ?.getAttribute("data-model-picker-view"),
                sliderCount: menu.querySelectorAll("[data-reasoning-slider]")
                  .length,
                items: items.map((item) => ({
                  ...describe(item),
                  checked: item.getAttribute("aria-checked"),
                  active: active === item,
                })),
                rect: rect(menu),
                viewport: { width: innerWidth, height: innerHeight },
                coarse: matchMedia("(pointer: coarse)").matches,
                horizontalOverflow: menu.scrollWidth > menu.clientWidth,
              }
            : null,
        };
      };
    },
    { other: OTHER, otherOwner },
  );
}
type Reader = Awaited<ReturnType<typeof createReader>>;
const readView = (page: Page, reader: Reader, selector: string) =>
  page.evaluate(({ read, selector }) => read(selector), {
    read: reader,
    selector,
  });

async function observeInputs(page: Page) {
  return page.evaluateHandle(() => {
    const events: Array<Record<string, unknown>> = [];
    let overflow = false;
    const describe = (element: Element | null) =>
      element
        ? {
            tag: element.tagName,
            id: element.id,
            role: element.getAttribute("role"),
            label: element.getAttribute("aria-label"),
          }
        : null;
    const listener = (event: Event) => {
      if (events.length >= 128) {
        overflow = true;
        return;
      }
      const target = event.target instanceof Element ? event.target : null;
      events.push({
        type: event.type,
        time: performance.now(),
        trusted: event.isTrusted,
        key: event instanceof KeyboardEvent ? event.key : null,
        code: event instanceof KeyboardEvent ? event.code : null,
        button: event instanceof MouseEvent ? event.button : null,
        target: describe(target),
        active: describe(document.activeElement),
        targetWithinTrigger: !!target?.closest(".session-native-model-trigger"),
      });
    };
    const types = ["keydown", "pointerdown", "focusin", "submit"];
    types.forEach((type) =>
      document.addEventListener(type, listener, {
        capture: true,
        passive: true,
      }),
    );
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
  test.describe("initial model focus " + width, () => {
    test.use({
      viewport: { width, height: 1000 },
      hasTouch: width === 390,
      isMobile: width === 390,
    });
    for (const owner of ["main", "expanded"] as const) {
      for (const entry of entries) {
        test(
          owner +
            " " +
            entry +
            " preserves native initial focus and draft ownership",
          async ({ page }, info) => {
            test.setTimeout(60_000);
            const before = hashes(),
              models = catalog(entry === "naturalAdvancedEnter");
            const api: Array<{ method: string; path: string; body: unknown }> =
              [];
            const modelReads: typeof api = [];
            const pageErrors: string[] = [],
              consoleErrors: string[] = [],
              captureErrors: string[] = [];
            const states: Array<{
              phase: string;
              value: Awaited<ReturnType<typeof readView>>;
            }> = [];
            const readiness: Array<
              Awaited<ReturnType<typeof readView>>["cache"]
            > = [];
            const screenshots: string[] = [];
            let reader: Reader | null = null,
              observer: Awaited<ReturnType<typeof observeInputs>> | null = null;
            let events: {
              events: Array<Record<string, unknown>>;
              overflow: boolean;
            } | null = null;
            let failure: unknown = null,
              tabs = 0;
            let scope = owner === "main" ? MAIN : EXPANDED;
            const draft = `保留 initial focus ${width} ${owner} ${entry} 草稿`;
            const record = async (phase: string) => {
              if (!reader) throw new Error("View reader unavailable");
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
            page.on("pageerror", (error) => pageErrors.push(String(error)));
            page.on("console", (message) => {
              if (message.type() === "error")
                consoleErrors.push(message.text());
            });
            const fixture = await installSessionUxFixture(page, 0);
            await page.route("**/api/**", async (route) => {
              const request = route.request(),
                path = new URL(request.url()).pathname;
              const read = {
                method: request.method(),
                path,
                body:
                  request.method() === "POST" ? request.postDataJSON() : null,
              };
              api.push(read);
              if (path.endsWith("/api/codex/model/list")) {
                modelReads.push(read);
                await route.fulfill({
                  json: { data: models, nextCursor: null },
                });
              } else await route.fallback();
            });
            try {
              await page.goto("/?mode=session", {
                waitUntil: "domcontentloaded",
              });
              await page
                .locator(MAIN)
                .locator('[contenteditable="true"]')
                .first()
                .waitFor();
              await seedSessionUx(page, 0);
              const otherOwner = await initializeSettings(page);
              const read = await createReader(page, otherOwner);
              reader = read;
              await expect
                .poll(
                  async () => {
                    const value = (await readView(page, read, MAIN)).cache;
                    readiness.push(value);
                    if (readiness.length > 20) readiness.shift();
                    return value;
                  },
                  {
                    timeout: 10_000,
                    message: "Actual model/list complete catalog ready",
                  },
                )
                .toEqual({ loaded: true, loading: false, error: null, models });
              expect(modelReads.length).toBeGreaterThan(0);
              expect(
                modelReads.every(
                  (r) =>
                    r.method === "POST" &&
                    JSON.stringify(r.body) ===
                      JSON.stringify({ cursor: null, limit: 100 }),
                ),
              ).toBe(true);
              await page
                .locator(MAIN)
                .locator('[contenteditable="true"]')
                .first()
                .fill(draft);
              if (owner === "expanded") {
                await page
                  .getByRole("button", { name: "附加文件", exact: true })
                  .click();
                await page
                  .getByRole("button", { name: "展开编辑", exact: true })
                  .click();
                await page
                  .getByRole("dialog", { name: "展开编辑", exact: true })
                  .waitFor();
                // Actual text input establishes editor focus, including expanded
                // textareas. No locator.focus/press or injected focus API is used.
                await page.locator(scope).locator(EDITOR).first().fill(draft);
              }
              observer = await observeInputs(page);
              const baseline = await record("editor-ready");
              expect(baseline.activeIsEditor).toBe(true);
              const trigger = page
                .locator(scope)
                .locator(".session-native-model-trigger");
              if (entry !== "P") {
                while (!(await readView(page, read, scope)).activeIsTrigger) {
                  if (tabs === 20)
                    throw new Error(
                      "Model trigger unreachable after 20 real Tab presses",
                    );
                  await page.keyboard.press("Tab");
                  tabs++;
                  await record("tab-" + tabs);
                }
              }
              await record("before-open");
              if (entry === "P") await trigger.click();
              else
                await page.keyboard.press(
                  entry === "ArrowDown" ? "ArrowDown" : "Enter",
                );
              // Synchronous predicate: an async waitForFunction would accept a
              // truthy Promise on the installed Playwright version.
              await page.waitForFunction(
                (selector) => {
                  const trigger = document
                    .querySelector(selector)
                    ?.querySelector(".session-native-model-trigger");
                  const id = trigger?.getAttribute("aria-controls");
                  return (
                    !!id &&
                    document.getElementById(id)?.getAttribute("role") === "menu"
                  );
                },
                scope,
                { timeout: 5000 },
              );
              const first = await record("first-linked-menu-dom");
              await page.evaluate(
                () =>
                  new Promise<void>((done) =>
                    requestAnimationFrame(() =>
                      requestAnimationFrame(() => done()),
                    ),
                  ),
              );
              await record("two-real-raf");
              await page.evaluate(async (start) => {
                const remaining = Math.max(
                  0,
                  200 - (performance.now() - start),
                );
                if (remaining > 0)
                  await new Promise((done) => setTimeout(done, remaining));
              }, first.now);
              await record("approximately-200ms");
              await screenshot(`initial-${width}-${owner}-${entry}.png`);
              await page.keyboard.press("Escape");
              await page
                .locator(".session-native-model-menu")
                .waitFor({ state: "detached", timeout: 5000 });
              await page.waitForFunction(
                (selector) => {
                  const editor = document
                    .querySelector(selector)
                    ?.querySelector(
                      '[contenteditable="true"], .session-rich-draft textarea',
                    );
                  return !!editor && document.activeElement === editor;
                },
                scope,
                { timeout: 3000 },
              );
              await record("escape-restored");
              await trigger.click({ trial: true, timeout: 5000 });
              if (owner === "expanded") {
                await page
                  .getByRole("button", { name: "返回并保留草稿", exact: true })
                  .click();
                scope = MAIN;
                await page
                  .getByRole("dialog", { name: "展开编辑", exact: true })
                  .waitFor({ state: "detached" });
                await page.waitForFunction(
                  (selector) => {
                    const editor = document
                      .querySelector(selector)
                      ?.querySelector('[contenteditable="true"]');
                    return !!editor && document.activeElement === editor;
                  },
                  MAIN,
                  { timeout: 3000 },
                );
                await record("expanded-closed");
              }
            } catch (error) {
              failure = error;
            } finally {
              if (reader) {
                try {
                  await record("finally-current");
                } catch (error) {
                  captureErrors.push("final observation: " + String(error));
                }
              }
              if (observer) {
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
              }
              await screenshot(`final-${width}-${owner}-${entry}.png`);
              if (reader) {
                try {
                  await reader.dispose();
                } catch (error) {
                  captureErrors.push("reader release: " + String(error));
                }
              }
              const after = hashes();
              const businessPattern =
                /\/(?:turn\/(?:start|steer|interrupt)|thread\/(?:start|resume|fork|delete)|followups\/(?:submit|change|stop)|goal\/(?:set|clear))$/;
              const businessWrites = api.filter((call) =>
                businessPattern.test(call.path),
              );
              const evidence = {
                width,
                owner,
                entry,
                models,
                sources: { before, after },
                modelReads,
                api,
                readiness,
                states,
                tabs,
                events,
                businessWrites,
                fixtureBusinessWrites: fixture.calls.filter((call) =>
                  businessPattern.test(call.path),
                ),
                pageErrors,
                consoleErrors,
                captureErrors,
                screenshots,
                failure: failure ? String(failure) : null,
                boundary:
                  "Isolated API/WS fixture and real local product. Viewport/touch simulation, not physical device or real account. Native P/Enter/Down/K3 observations supply expectations; no original bundle execution in this test.",
              };
              const path = info.outputPath("model-menu-initial-focus.json");
              writeFileSync(path, JSON.stringify(evidence, null, 2));
              await info.attach("model-menu-initial-focus", {
                path,
                contentType: "application/json",
              });
              // Complete source/API/input/sample/screenshot evidence precedes all
              // parity comparisons; failures preserve the same final receipt.
              if (failure) throw failure;
              expect(after).toEqual(before);
              expect(modelReads.length).toBeGreaterThan(0);
              expect(
                modelReads.every(
                  (r) =>
                    r.method === "POST" &&
                    r.path.endsWith("/api/codex/model/list") &&
                    JSON.stringify(r.body) ===
                      JSON.stringify({ cursor: null, limit: 100 }),
                ),
              ).toBe(true);
              const baseline = states.find(
                (s) => s.phase === "editor-ready",
              )!.value;
              expect(baseline.settings).toEqual({
                model: SELECTED,
                modelProvider: "openai",
                reasoningEffort: "medium",
                serviceTier: null,
              });
              expect(baseline.owner).toBeTruthy();
              expect(baseline.otherDraft).toMatchObject({
                text: "另一 owner 的未发送草稿",
              });
              expect(baseline.otherSettings).toMatchObject({
                revision: 7,
                model: "initial-focus-third",
                reasoningEffort: "high",
              });
              expect(events?.overflow).toBe(false);
              expect(events?.events.filter((e) => e.type === "submit")).toEqual(
                [],
              );
              const opening = events?.events.filter(
                (e) =>
                  e.targetWithinTrigger &&
                  (entry === "P"
                    ? e.type === "pointerdown"
                    : e.type === "keydown" &&
                      e.key ===
                        (entry === "ArrowDown" ? "ArrowDown" : "Enter")),
              );
              expect(opening).toHaveLength(1);
              expect(opening?.[0].trusted).toBe(true);
              if (entry !== "P") {
                expect(tabs).toBeGreaterThan(0);
                expect(tabs).toBeLessThanOrEqual(20);
              }
              for (const state of states) {
                expect(state.value.settings, state.phase).toEqual(
                  baseline.settings,
                );
                expect(state.value.owner, state.phase).toBe(baseline.owner);
                expect(state.value.draft, state.phase).toEqual(baseline.draft);
                expect(state.value.otherDraft, state.phase).toEqual(
                  baseline.otherDraft,
                );
                expect(state.value.otherSettings, state.phase).toEqual(
                  baseline.otherSettings,
                );
                expect(state.value.editorText, state.phase).toBe(draft);
                expect(state.value.cache, state.phase).toEqual({
                  loaded: true,
                  loading: false,
                  error: null,
                  models,
                });
                expect(state.value.moduleURLs, state.phase).toEqual(
                  baseline.moduleURLs,
                );
              }
              for (const phase of [
                "first-linked-menu-dom",
                "two-real-raf",
                "approximately-200ms",
              ]) {
                const s = states.find((s) => s.phase === phase)!.value;
                expect(s.menu?.id, phase).toBe(s.triggerControls);
                expect(s.menu?.view, phase).toBe(
                  entry === "naturalAdvancedEnter" ? "advanced" : "simple",
                );
                expect(s.activeIsPower, phase).toBe(false);
                expect(s.activeIsChecked, phase).toBe(false);
                if (entry === "P") expect(s.activeIsMenu, phase).toBe(true);
                else {
                  expect(s.activeIsFirstItem, phase).toBe(true);
                  if (entry === "naturalAdvancedEnter") {
                    expect(s.menu?.sliderCount, phase).toBe(0);
                    expect(
                      s.menu?.items.map((i) => i.checked),
                      phase,
                    ).toEqual(["false", "true", "false"]);
                    expect(s.active?.role, phase).toBe("menuitemradio");
                  } else {
                    expect(s.activeIsCaption, phase).toBe(true);
                    expect(s.active?.label, phase).toBe("选择模型");
                  }
                }
              }
              expect(
                states.find((s) => s.phase === "escape-restored")!.value
                  .activeIsEditor,
              ).toBe(true);
              if (owner === "expanded")
                expect(
                  states.find((s) => s.phase === "expanded-closed")!.value
                    .activeIsEditor,
                ).toBe(true);
              expect(businessWrites).toEqual([]);
              expect(evidence.fixtureBusinessWrites).toEqual([]);
              expect(pageErrors).toEqual([]);
              expect(captureErrors).toEqual([]);
            }
          },
        );
      }
    }
  });
}
