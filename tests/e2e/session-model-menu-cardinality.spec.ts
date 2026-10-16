import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { expect, test, type JSHandle, type Page } from "@playwright/test";
import type { Model } from "../../apps/web/src/session-mode/bindings/v2";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";

const SELECTED = "cardinality-selected";
const OTHER = "cardinality-other-owner";
const inputs = [
  "apps/web/src/session-mode/components/codex/composer/NativeModelSelector.tsx",
  "apps/web/src/session-mode/components/codex/hooks/useModels.ts",
  "apps/web/src/session-mode/components/codex/composer/NativeModelTrigger.tsx",
  "apps/web/src/session-mode/hooks/useThreadModelSettings.ts",
  "apps/web/src/session-mode/stores/useThreadModelStore.ts",
  "apps/web/src/session-mode/stores/useSessionDraftStore.ts",
  "apps/web/src/session-mode/components/codex/composer/v2/ComposerSheet.tsx",
  "apps/web/src/session-mode/components/codex/composer/composer-native.css",
  "apps/web/src/session-mode/session-composer-compact.css",
  "apps/web/src/session-mode/services/apiAdapt/codex.ts",
  "tests/e2e/session-ux-fixture.ts",
  "tests/e2e/session-model-menu-cardinality.spec.ts",
];
const hashes = () =>
  inputs.map((path) => ({
    path,
    sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
  }));

function catalog(count: 0 | 1): Model[] {
  return ["cardinality-first", SELECTED, "cardinality-third"].map(
    (id, index) => ({
      id,
      model: id,
      displayName: ["目录首项", "目录选中项", "目录第三项"][index],
      description: "Isolated model/list cardinality fixture",
      upgrade: null,
      upgradeInfo: null,
      availabilityNux: null,
      hidden: false,
      isDefault: index === 0,
      supportedReasoningEfforts: (index === 1
        ? count === 0
          ? []
          : ["medium" as const]
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

type ModelCacheSnapshot = {
  moduleURL: string;
  loaded: boolean;
  loading: boolean;
  error: string | null;
  models: Model[];
};
type ModelCacheReader = JSHandle<() => ModelCacheSnapshot>;

async function createModelCacheReader(page: Page): Promise<ModelCacheReader> {
  return page.evaluateHandle(async () => {
    const path = "/src/session-mode/components/codex/hooks/useModels.ts";
    const moduleURL = performance
      .getEntriesByType("resource")
      .findLast((entry) => new URL(entry.name).pathname === path)?.name;
    if (!moduleURL) throw new Error("Mounted model cache resource unavailable");
    // Resolve the already loaded module once. Both the readiness poll and later
    // snapshots read this exact store; no cache or hook is seeded or replaced.
    const { useModelCacheStore } = await import(moduleURL);
    return (): ModelCacheSnapshot => {
      const state = useModelCacheStore.getState();
      return {
        moduleURL,
        loaded: state.loaded,
        loading: state.loading,
        error: state.error,
        models: state.openAiModels,
      };
    };
  });
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
      // The unselected owner is fixture data, never a real thread or navigation.
      useThreadModelStore.setState({
        threads: {
          ...useThreadModelStore.getState().threads,
          [other]: {
            model: "cardinality-third",
            modelProvider: "openai",
            reasoningEffort: "high",
            providerModels: {},
            serviceTier: null,
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

async function snapshot(
  page: Page,
  selector: string,
  otherOwner: string,
  readModelCache: ModelCacheReader,
) {
  return page.evaluate(
    async ({ selector, otherOwner, other, readModelCache }) => {
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
        { useSessionDraftStore },
      ] = await Promise.all([
        load("/src/session-mode/components/codex/stores/useConfigStore.ts"),
        load("/src/session-mode/stores/useThreadModelStore.ts"),
        load("/src/session-mode/stores/useSessionDraftStore.ts"),
      ]);
      const scope = document.querySelector(selector);
      const editor = scope?.querySelector<HTMLElement>(
        '[contenteditable="true"], .session-rich-draft textarea',
      );
      const owner =
        document
          .querySelector(".session-codex-composer")
          ?.getAttribute("data-draft-owner") ?? null;
      const config = useConfigStore.getState();
      const menu = document.querySelector(".session-native-model-menu");
      return {
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
        otherDraft: useSessionDraftStore.getState().drafts[otherOwner] ?? null,
        otherSettings: useThreadModelStore.getState().threads[other] ?? null,
        editorValue:
          editor instanceof HTMLTextAreaElement
            ? editor.value
            : (editor?.textContent ?? null),
        activeIsEditor: document.activeElement === editor,
        active: document.activeElement
          ? {
              tag: document.activeElement.tagName,
              role: document.activeElement.getAttribute("role"),
              label: document.activeElement.getAttribute("aria-label"),
            }
          : null,
        cache: readModelCache(),
        menu: menu
          ? {
              view: menu
                .querySelector("[data-model-picker-view]")
                ?.getAttribute("data-model-picker-view"),
              sliderCount: menu.querySelectorAll(
                '[data-reasoning-slider], [role="slider"], .session-native-power-slider',
              ).length,
              strengthCount:
                menu.querySelectorAll('[aria-label="强度"]').length,
              radios: [...menu.querySelectorAll('[role="menuitemradio"]')].map(
                (row) => ({
                  label: row.textContent,
                  checked: row.getAttribute("aria-checked"),
                  active: document.activeElement === row,
                }),
              ),
            }
          : null,
      };
    },
    { selector, otherOwner, other: OTHER, readModelCache },
  );
}

for (const width of [1440, 390]) {
  test.describe("catalog cardinality " + width, () => {
    test.use({
      viewport: { width, height: 1000 },
      hasTouch: width === 390,
      isMobile: width === 390,
    });
    for (const owner of ["main", "expanded"] as const) {
      for (const count of [0, 1] as const) {
        test(
          owner +
            " known" +
            count +
            " opens natural advanced without changing effort or drafts",
          async ({ page }, info) => {
            test.setTimeout(60_000);
            const before = hashes(),
              pageErrors: string[] = [],
              consoleErrors: string[] = [];
            const api: Array<{ method: string; path: string; body: unknown }> =
              [];
            const modelReads: Array<{
              method: string;
              path: string;
              body: unknown;
            }> = [];
            const states: Array<{
              phase: string;
              value: Awaited<ReturnType<typeof snapshot>>;
            }> = [];
            const models = catalog(count);
            let failure: unknown = null,
              otherOwner = "",
              geometry: unknown = null;
            let modelCacheReader: ModelCacheReader | null = null;
            const catalogReadiness: ModelCacheSnapshot[] = [];
            const screenshots: string[] = [],
              captureErrors: string[] = [];
            page.on("pageerror", (error) => pageErrors.push(String(error)));
            page.on("console", (message) => {
              if (message.type() === "error")
                consoleErrors.push(message.text());
            });
            const fixture = await installSessionUxFixture(page, 0);
            // Newest route wins; the actual useModels/listModels path receives this
            // full catalog. No cache, hook, menu view or provider is replaced.
            await page.route("**/api/**", async (route) => {
              const request = route.request(),
                path = new URL(request.url()).pathname;
              const entry = {
                method: request.method(),
                path,
                body:
                  request.method() === "POST" ? request.postDataJSON() : null,
              };
              api.push(entry);
              // buildUrl prefixes the adapter path with /api/session on HTTP.
              if (path.endsWith("/api/codex/model/list")) {
                modelReads.push(entry);
                await route.fulfill({
                  json: { data: models, nextCursor: null },
                });
              } else await route.fallback();
            });
            const selector =
              owner === "main"
                ? ".session-codex-composer"
                : ".session-composer-sheet.is-full";
            const draft =
              "保留 cardinality " +
              width +
              " " +
              owner +
              " known" +
              count +
              " 草稿";
            const record = async (phase: string, scope = selector) => {
              if (!modelCacheReader)
                throw new Error("Model cache reader unavailable");
              const value = await snapshot(
                page,
                scope,
                otherOwner,
                modelCacheReader,
              );
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
            try {
              await page.goto("/?mode=session", {
                waitUntil: "domcontentloaded",
              });
              await page
                .locator(".session-codex-composer [contenteditable=true]")
                .first()
                .waitFor();
              await seedSessionUx(page, 0);
              otherOwner = await initializeSettings(page);
              const readModelCache = await createModelCacheReader(page);
              modelCacheReader = readModelCache;
              // Playwright 1.58.2's waitForFunction tests the Promise itself for
              // async predicates. expect.poll awaits this actual read instead.
              await expect
                .poll(
                  async () => {
                    const value = await page.evaluate(
                      (read) => read(),
                      readModelCache,
                    );
                    catalogReadiness.push(value);
                    if (catalogReadiness.length > 20) catalogReadiness.shift();
                    return {
                      loaded: value.loaded,
                      loading: value.loading,
                      error: value.error,
                      models: value.models,
                    };
                  },
                  {
                    timeout: 10_000,
                    message: "Actual model/list catalog ready",
                  },
                )
                .toEqual({
                  loaded: true,
                  loading: false,
                  error: null,
                  models,
                });
              // Reject a wrong fixture before any menu or draft interaction.
              expect(modelReads.length).toBeGreaterThan(0);
              expect(
                modelReads.every(
                  (read) =>
                    read.method === "POST" &&
                    JSON.stringify(read.body) ===
                      JSON.stringify({ cursor: null, limit: 100 }),
                ),
              ).toBe(true);
              await page
                .locator(".session-codex-composer [contenteditable=true]")
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
              }
              const trigger = page
                .locator(selector)
                .locator(".session-native-model-trigger");
              const baseline = await record("before-open");
              expect(baseline.cache).toMatchObject({
                loaded: true,
                loading: false,
                error: null,
                models,
              });
              await trigger.click();
              const menu = page.locator(".session-native-model-menu");
              await menu.waitFor({ state: "visible", timeout: 5000 });
              await record("natural-open");
              geometry = await menu.evaluate(async (element) => {
                await Promise.all(
                  element
                    .getAnimations()
                    .map((animation) => animation.finished.catch(() => {})),
                );
                await new Promise<void>((done) =>
                  requestAnimationFrame(() =>
                    requestAnimationFrame(() => done()),
                  ),
                );
                const rect = (node: Element) => {
                  const r = node.getBoundingClientRect();
                  return {
                    x: r.x,
                    y: r.y,
                    width: r.width,
                    height: r.height,
                    right: r.right,
                    bottom: r.bottom,
                  };
                };
                return {
                  menu: rect(element),
                  viewport: { width: innerWidth, height: innerHeight },
                  coarse: matchMedia("(pointer: coarse)").matches,
                  horizontalOverflow: element.scrollWidth > element.clientWidth,
                  rows: [
                    ...element.querySelectorAll('[role="menuitemradio"]'),
                  ].map((row) => ({
                    label: row.textContent,
                    checked: row.getAttribute("aria-checked"),
                    rect: rect(row),
                  })),
                  transform: getComputedStyle(element).transform,
                  runningAnimations: element
                    .getAnimations()
                    .filter(
                      (animation) =>
                        animation.playState === "running" || animation.pending,
                    ).length,
                };
              });
              await screenshot(
                "natural-advanced-" +
                  width +
                  "-" +
                  owner +
                  "-known" +
                  count +
                  ".png",
              );
              for (const key of [
                "ArrowDown",
                "ArrowUp",
                "ArrowLeft",
                "ArrowRight",
              ]) {
                await page.keyboard.press(key);
                await record(key);
              }
              await page.keyboard.press("Escape");
              await menu.waitFor({ state: "detached", timeout: 5000 });
              await record("escape-restored");
              // Trial checks normal button hit-testing; it does not reopen.
              await trigger.click({ trial: true, timeout: 5000 });
              if (owner === "expanded") {
                await page
                  .getByRole("button", { name: "返回并保留草稿", exact: true })
                  .click();
                await page
                  .getByRole("dialog", { name: "展开编辑", exact: true })
                  .waitFor({ state: "detached" });
                await record("expanded-closed", ".session-codex-composer");
              }
            } catch (error) {
              failure = error;
            } finally {
              await screenshot(
                "cardinality-final-" +
                  width +
                  "-" +
                  owner +
                  "-known" +
                  count +
                  ".png",
              );
              const after = hashes();
              const businessWrites = fixture.calls.filter((call) =>
                /\/(?:turn\/(?:start|steer|interrupt)|thread\/(?:start|resume|fork|delete)|followups\/(?:submit|change|stop)|goal\/(?:set|clear))$/.test(
                  call.path,
                ),
              );
              const evidence = {
                width,
                owner,
                count,
                models,
                sources: { before, after },
                modelReads,
                api,
                catalogReadiness,
                businessWrites,
                states,
                geometry,
                screenshots,
                pageErrors,
                consoleErrors,
                captureErrors,
                failure: failure ? String(failure) : null,
                boundary:
                  "Local product with isolated API/WS fixtures; viewport/touch emulation, no physical-device or original full-hCa focus claim.",
              };
              const path = info.outputPath("model-menu-cardinality.json");
              writeFileSync(path, JSON.stringify(evidence, null, 2));
              await info.attach("model-menu-cardinality", {
                path,
                contentType: "application/json",
              });
              await modelCacheReader?.dispose();
              // Persist complete evidence before behavioral comparisons.
              if (failure) throw failure;
              expect(after).toEqual(before);
              expect(modelReads.length).toBeGreaterThan(0);
              expect(modelReads.every((read) => read.method === "POST")).toBe(
                true,
              );
              expect(
                modelReads.every(
                  (read) =>
                    JSON.stringify(read.body) ===
                    JSON.stringify({ cursor: null, limit: 100 }),
                ),
              ).toBe(true);
              const baseline = states.find(
                (state) => state.phase === "before-open",
              )!.value;
              const opened = states.find(
                (state) => state.phase === "natural-open",
              )!.value;
              expect(baseline.settings).toEqual({
                model: SELECTED,
                modelProvider: "openai",
                reasoningEffort: "medium",
                serviceTier: null,
              });
              expect(baseline.owner).toBeTruthy();
              expect(baseline.otherDraft?.text).toBe("另一 owner 的未发送草稿");
              expect(baseline.otherSettings?.revision).toBe(7);
              expect(opened.cache.loaded).toBe(true);
              expect(opened.cache.error).toBeNull();
              expect(
                opened.cache.models.map((model: { id: string }) => model.id),
              ).toEqual(models.map((model) => model.id));
              expect(
                opened.cache.models[1].supportedReasoningEfforts,
              ).toHaveLength(count);
              expect(opened.menu?.view).toBe("advanced");
              expect(opened.menu?.sliderCount).toBe(0);
              expect(opened.menu?.strengthCount).toBe(0);
              expect(opened.menu?.radios.map((row) => row.checked)).toEqual([
                "false",
                "true",
                "false",
              ]);
              for (const state of states) {
                expect(state.value.cache, state.phase).toEqual(baseline.cache);
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
                expect(state.value.editorValue, state.phase).toBe(draft);
                if (
                  state.phase === "natural-open" ||
                  state.phase.startsWith("Arrow")
                ) {
                  expect(state.value.menu?.view, state.phase).toBe("advanced");
                  expect(state.value.menu?.sliderCount, state.phase).toBe(0);
                  expect(state.value.menu?.strengthCount, state.phase).toBe(0);
                  expect(
                    state.value.menu?.radios.map((row) => row.checked),
                    state.phase,
                  ).toEqual(["false", "true", "false"]);
                }
              }
              for (const phase of ["ArrowDown", "ArrowUp"])
                expect(
                  states.find((state) => state.phase === phase)!.value.active
                    ?.role,
                  phase,
                ).toBe("menuitemradio");
              expect(
                states.find((state) => state.phase === "escape-restored")!.value
                  .activeIsEditor,
              ).toBe(true);
              if (owner === "expanded")
                expect(
                  states.find((state) => state.phase === "expanded-closed")!
                    .value.activeIsEditor,
                ).toBe(true);
              const bounds = geometry as {
                horizontalOverflow: boolean;
                viewport: { width: number };
                menu: { x: number; right: number };
                runningAnimations: number;
              };
              expect(bounds.horizontalOverflow).toBe(false);
              expect(bounds.menu.x).toBeGreaterThanOrEqual(-1);
              expect(bounds.menu.right).toBeLessThanOrEqual(
                bounds.viewport.width + 1,
              );
              expect(bounds.runningAnimations).toBe(0);
              expect(businessWrites).toEqual([]);
              expect(pageErrors).toEqual([]);
              expect(captureErrors).toEqual([]);
            }
          },
        );
      }
    }
  });
}
