import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { isDeepStrictEqual } from "node:util";
import { expect, test, type Locator, type Page } from "@playwright/test";
import type { Model } from "../../apps/web/src/session-mode/bindings/v2";
import { createFeedbackEventStream } from "./fixtures/session-feedback-event-stream.mts";
import { EDITOR, MAIN, initialize, createReader, observe, read } from "./fixtures/session-model-command-page.mts";

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
const CURRENT = "r28e3-preference-model", LABEL = "E3 偏好模型";
const OWNER_A = JSON.stringify(["codex", "", "session", "ux-0"]);
const OWNER_B = JSON.stringify(["codex", "", "session", "ux-1"]);
const CUSTOM = { "r27-custom-provider": [{ id: "r27-custom-model", name: "R27 保留自定义模型" }] };
function model(id: string, label: string, efforts: string[], defaultReasoningEffort: string, isDefault: boolean): Model {
  return {
    id, model: id, displayName: label,
    description: "Complete synthetic ordinary changed-row fixture, not a real account catalog",
    hidden: false, isDefault, upgrade: null, upgradeInfo: null, availabilityNux: null,
    supportedReasoningEfforts: efforts.map((reasoningEffort) => ({ reasoningEffort, description: reasoningEffort })),
    defaultReasoningEffort, inputModalities: ["text", "image"], supportsPersonality: false,
    additionalSpeedTiers: [], serviceTiers: [], defaultServiceTier: null,
  };
}

const inputs = [
  "apps/web/src/session-mode/components/codex/composer/NativeModelSelector.tsx",
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
  "tests/e2e/session-model-changed-row-display-effort.spec.mts",
  "tests/e2e/session-model-picker-preferences.spec.mts",
  "apps/web/src/session-mode/components/codex/composer/ConversationMenu.tsx",
  "apps/web/src/session-mode/components/codex/composer/ordinaryNativePickerModels.ts",
  "apps/web/src/session-mode/components/codex/composer/nativePickerEffortProjection.ts",
  "apps/web/src/session-mode/stores/settings/useNativeModelPickerPreferencesStore.ts",
];
const hashInputs = () => inputs.map((path) => ({ path, sha256: existsSync(path) ? createHash("sha256").update(readFileSync(path)).digest("hex") : null }));
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
    return { ownerAttribute: node.getAttribute("data-draft-owner"),
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
    const ids = new WeakMap<object, number>(); let serial = 0;
    const identity = (value: object) => { if (!ids.has(value)) ids.set(value, ++serial); return ids.get(value); };
    return {
      read: () => {
        if (!fixed || ++count > 64) throw Error("Protection reader disposed or bounded read limit exceeded");
        const current = thread(), richNow = richState(), aRich = richNow.drafts[ownerA];
        return clone({ reads: count, moduleURLs: urls,
          a: current.threads["ux-0"], aIdentity: identity(current.threads["ux-0"]), oldAUnchanged: JSON.stringify(fixed.a) === JSON.stringify(fixed.aValue),
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

// Explicit diagnostic preference input: imports only the real, existing own
// preference store (old UI need not consume it). This is not a product editor
// or a settings hydration driver. It never writes model/thread/native state.
async function preferenceInput(page: Page) {
  return page.evaluateHandle(async () => {
    const path = "/src/session-mode/stores/settings/useNativeModelPickerPreferencesStore.ts";
    const url = performance.getEntriesByType("resource").findLast((entry) => new URL(entry.name).pathname === path)?.name ?? path;
    const { useNativeModelPickerPreferencesStore: store } = await import(url);
    let reads = 0, writes = 0;
    const wheels: Array<{ trusted: boolean; deltaY: number; inPower: boolean }> = [];
    const listener = (event: WheelEvent) => {
      if (wheels.length >= 16) throw Error("Wheel observation budget exceeded");
      wheels.push({ trusted: event.isTrusted, deltaY: event.deltaY,
        inPower: event.target instanceof Element && Boolean(event.target.closest(".session-native-power-slider")) });
    };
    document.addEventListener("wheel", listener, true);
    return {
      read: () => {
        if (++reads > 64) throw Error("Preference read budget exceeded");
        const state = store.getState();
        return { moduleURL: url, selectionMode: state.selectionMode, enabled: [...state.enabledReasoningEfforts], writes, wheels: [...wheels] };
      },
      set: (enabled: string[]) => {
        if (++writes > 4) throw Error("Preference stimulus budget exceeded");
        store.getState().setEnabledReasoningEfforts(enabled);
      },
      dispose: () => document.removeEventListener("wheel", listener, true),
    };
  });
}
function protect(value: any, baseline: any, identity: any, first: any, owner: string, draft: string, expanded: boolean, catalog: Model[]) {
  expect(value.currentThreadId).toBe("ux-0"); expect(value.owner).toBe(owner); expect(value.eventStreamConnected).toBe(true);
  expect(value.defaults).toEqual(baseline.defaults); expect(value.drafts).toEqual(baseline.drafts);
  expect(value.allThreads["ux-1"]).toEqual(baseline.allThreads["ux-1"]); expect(value.editorText).toBe(draft);
  expect(value.cache).toMatchObject({ loaded: true, loading: false, error: null, modelStatus: "success", hasModelSnapshot: true });
  expect(value.cache.models).toEqual(catalog);
  expect(value.cacheIdentity).toEqual({ captured: true, array: true, models: true, efforts: true });
  const stable = (entry: any) => {
    const { reasoningEffort, revision, pending, pendingFields, ...rest } = entry;
    return rest;
  };
  expect(stable(value.entry)).toEqual(stable(baseline.entry)); expect(identity.oldAUnchanged).toBe(true);
  expect(value.settings.model).toBe(CURRENT); expect(value.settings.modelProvider).toBe("openai");
  expect({ ...identity.same, a: true }).toEqual({ a: true, b: true, defaults: true, custom: true, text: true, cache: true,
    richB: true, richContexts: true, richDrawings: true });
  expect(identity.b).toEqual(first.b); expect(identity.defaults).toEqual(first.defaults);
  expect(identity.custom).toEqual(CUSTOM); expect(identity.text).toEqual(first.text);
  expect(identity.rich.a).toEqual({ ...first.rich.a, expanded });
  expect(identity.rich.b).toEqual(first.rich.b); expect(identity.rich.others).toEqual(first.rich.others);
  expect(identity.rich.error).toBeNull();
}
for (const width of [1440, 390]) test.describe("E3 ordinary display preferences " + width, () => {
  test.use({ viewport: { width, height: width === 390 ? 844 : 900 }, hasTouch: width === 390, isMobile: width === 390 });
  for (const surface of ["main", "expanded"] as const) test(surface + " shares display preferences with genuine Power and command inputs", async ({ page }, info) => {
    const theme = width === 1440 ? "dark" : "light", draft = "E3 retained draft " + width + " " + surface;
    const catalog: Model[] = [
      model(CURRENT, LABEL, ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra", "persistent"], "medium", true),
    ];
    const counts = [0, 0, 0, 0];
    const directory: unknown[] = [], writes: unknown[] = [], api: unknown[] = [], external: unknown[] = [];
    const errors: string[] = [], consoleErrors: Array<{ text: string; url: string }> = [];
    const states: Array<{ phase: string; value: any; identity: any; scope: any; prefs: any }> = [], screenshots: string[] = [], cleanupErrors: string[] = [];
    const setup = { timeoutMs: 5000, ringCapacity: 64, reads: 0, discarded: 0, matched: false,
      samples: [] as Array<{ read: number; now: number; currentThreadId: string | null; owner: string | null }> };
    let origin = "", phase = "setup", failure: string | null = null, inputEvents: unknown = null, streamCleanup: unknown = null;
    let reader: Awaited<ReturnType<typeof createReader>> | null = null;
    let observer: Awaited<ReturnType<typeof observe>> | null = null;
    let protection: Awaited<ReturnType<typeof createProtectionReader>> | null = null;
    let stream: Awaited<ReturnType<typeof createFeedbackEventStream>> | null = null;
    let draftNode: Awaited<ReturnType<ReturnType<typeof page.locator>["elementHandle"]>> | null = null;
    let prefInput: Awaited<ReturnType<typeof preferenceInput>> | null = null;
    let sourceBefore: ReturnType<typeof hashInputs> | null = null, sourceAfter: ReturnType<typeof hashInputs> | null = null;
    let scope = page.locator(MAIN);
    const record = async (name: string) => {
      if (!reader || !protection || !prefInput || states.length >= 32) throw Error("Read-only state reader missing or bounded phase limit exceeded");
      phase = name;
      const value = await read(page, reader), identity = await protection.evaluate((probe) => probe.read());
      const row = { phase: name, value, identity, scope: await inspectScope(scope), prefs: await prefInput.evaluate((input) => input.read()) }; states.push(row); return row;
    };
    const shot = async (name: string) => {
      const path = info.outputPath(name + ".png"); await page.screenshot({ path, fullPage: true }); screenshots.push(path);
    };
    page.on("pageerror", (error) => errors.push(error.stack ?? String(error)));
    page.on("console", (message) => { if (message.type() === "error") consoleErrors.push({ text: message.text(), url: message.location().url }); });
    try {
      sourceBefore = hashInputs();
      origin = new URL(String(info.project.use.baseURL)).origin;
      if (["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname)) throw Error("Explicit owned LAN frontend required");
      stream = await createFeedbackEventStream(origin);
      // Initial isolated browser storage only: real stores hydrate their own custom/rich data.
      await page.addInitScript(({ theme, custom, ownerA, ownerB }) => {
        localStorage.setItem("kanban.session.native-model-picker-preferences", JSON.stringify({ state: {
          selectionMode: "default", enabledReasoningEfforts: ["low", "medium", "high", "xhigh", "ultra", "persistent"],
        }, version: 1 }));
        localStorage.setItem("kanban.session.theme-storage", JSON.stringify({ state: { theme }, version: 0 }));
        localStorage.setItem("kanban.session.model-settings", JSON.stringify({ state: { models: custom }, version: 2 }));
        localStorage.setItem("kanban.session.composer-v2", JSON.stringify({
          [ownerA]: { contexts: [], drawings: {}, expanded: false, plain: true },
          [ownerB]: { contexts: [], drawings: {}, expanded: false, plain: false },
        }));
      }, { theme, custom: CUSTOM, ownerA: OWNER_A, ownerB: OWNER_B });
      await page.route("**/*", async (route) => {
        const request = route.request();
        if (new URL(request.url()).origin !== origin || !["GET", "HEAD"].includes(request.method())) {
          external.push({ method: request.method(), url: request.url() }); await route.abort("blockedbyclient");
        } else await route.continue();
      });
      await installSessionUxFixture(page, 2);
      await page.route("**/api/**", async (route) => {
        const request = route.request(), url = new URL(request.url()), path = url.pathname;
        const entry = { method: request.method(), path, body: request.method() === "POST" ? request.postDataJSON() : null };
        api.push(entry);
        if (url.origin !== origin) { external.push({ method: entry.method, url: request.url() }); await route.abort("blockedbyclient"); return; }
        if (path === "/api/session/api/events" && entry.method === "GET") {
          if (!stream) throw Error("Owned SSE missing"); await route.continue({ url: stream.url }); return;
        }
        const index = paths.findIndex((suffix) => path.endsWith(suffix));
        if (index >= 0) {
          directory.push(entry);
          const valid = path === "/api/session" + paths[index] && entry.method === (index === 0 ? "POST" : "GET") &&
            (index === 0 ? isDeepStrictEqual(entry.body, { cursor: null, limit: 100 }) : entry.body === null);
          if (!valid) { writes.push(entry); await route.fulfill({ status: 409, json: { error: "R29 catalog read contract mismatch" } }); return; }
          counts[index]++; await route.fulfill({ json: index === 0 ? { data: catalog, nextCursor: null } : [] }); return;
        }
        if (!["GET", "HEAD"].includes(entry.method) && !reads.has(path) && !bookkeeping.has(path)) {
          writes.push(entry); await route.fulfill({ status: 409, json: { error: "R29 unexpected mutation rejected" } }); return;
        }
        await route.fallback();
      });
      await page.goto("/?mode=session&view=agent", { waitUntil: "domcontentloaded" });
      await page.locator(MAIN).locator(EDITOR).first().waitFor();
      // Sole initial application-store fixture setup. Never hydrate or call loaders after UI input.
      await seedSessionUx(page, 2);
      const owners = await initialize(page, { model: CURRENT, effort: "ultra" });
      expect(owners.owner).toBe(OWNER_A); expect(owners.otherOwner).toBe(OWNER_B);
      reader = await createReader(page, owners); observer = await observe(page);
      await expect.poll(async () => {
        const value = await read(page, reader!); setup.reads++;
        if (setup.samples.length === setup.ringCapacity) { setup.samples.shift(); setup.discarded++; }
        setup.samples.push({ read: setup.reads, now: value.now, currentThreadId: value.currentThreadId, owner: value.owner });
        return { currentThreadId: value.currentThreadId, owner: value.owner };
      }, { timeout: setup.timeoutMs, intervals: [25, 50, 100] }).toEqual({ currentThreadId: "ux-0", owner: owners.owner });
      setup.matched = true;
      await page.locator(MAIN).locator(EDITOR).first().fill(draft);
      draftNode = await page.locator(MAIN).locator(EDITOR).first().elementHandle();
      await expect.poll(() => counts).toEqual([1, 1, 1, 1]);
      await expect.poll(async () => (await read(page, reader!)).cache.loaded).toBe(true);
      await expect.poll(async () => (await read(page, reader!)).eventStreamConnected).toBe(true);
      await settle(page); protection = await createProtectionReader(page); prefInput = await preferenceInput(page);
      const baseline = await record("baseline"), initialRecent = await recent(page);
      const checkProtected = (row: typeof baseline, expanded: boolean) => {
        protect(row.value, baseline.value, row.identity, baseline.identity, owners.owner, draft, expanded, catalog);
        expect(row.scope.editorText).toBe(draft);
        if (row.scope.trigger.expanded && row.value.modelMenu?.view === "simple") {
          expect(row.scope.trigger.model).toBeNull(); expect(row.scope.trigger.rawAria).toBeNull();
          expect(row.scope.trigger.purpose).toBe("选择强度");
        } else expect(row.scope.trigger.model).toBe(LABEL);
        expect(row.prefs.selectionMode).toBe("default");
      };
      const readonly = async (row: typeof baseline, previous: typeof baseline, expanded: boolean) => {
        checkProtected(row, expanded);
        expect(row.value.entry).toEqual(previous.value.entry);
        expect(row.identity.aIdentity).toBe(previous.identity.aIdentity);
      };
      const expectEffort = (row: typeof baseline, raw: string, caption: string) => {
        expect.soft(row.value.settings.reasoningEffort, row.phase).toBe(raw);
        expect.soft(row.value.entry.reasoningEffort, row.phase).toBe(raw);
        expect.soft(row.scope.trigger.effort, row.phase).toBe(row.scope.trigger.expanded && row.value.modelMenu?.view === "simple" ? null : caption);
      };
      const expectPower = async (row: typeof baseline, count: number, caption: string, position: number) => {
        expect.soft(row.value.modelMenu?.view, row.phase).toBe("simple");
        expect.soft(row.value.modelMenu?.dots, row.phase).toBe(count);
        expect.soft(await page.locator(".session-native-model-menu .session-native-power-effort").textContent(), row.phase).toBe(caption);
        expect.soft(await page.locator(".session-native-model-menu").getByRole("status").textContent(), row.phase)
          .toContain("第 " + position + " 项，共 " + count + " 项");
      };
      const setPreferences = async (enabled: string[]) => {
        if (!prefInput) throw Error("Own preference input missing");
        await prefInput.evaluate((input, values) => input.set(values), enabled);
        await settle(page);
      };
      expect(baseline.value.settings).toMatchObject({ model: CURRENT, modelProvider: "openai", reasoningEffort: "ultra" });
      expect(baseline.value.entry).toMatchObject({ revision: 4, pending: false, pendingFields: [] });
      expect(baseline.prefs.enabled).toEqual(["low", "medium", "high", "xhigh", "ultra", "persistent"]);
      await readonly(baseline, baseline, false);
      if (surface === "expanded") {
        await scope.getByRole("button", { name: "附加文件", exact: true }).click();
        await page.getByRole("button", { name: "展开编辑", exact: true }).click();
        await page.getByRole("dialog", { name: "展开编辑", exact: true }).waitFor();
        scope = page.locator(".session-mode .session-composer-sheet.is-full");
        await expect(scope).toHaveCount(1); await expect(scope).toBeVisible();
        await expect.poll(() => scope.locator(EDITOR).first().evaluate((node) =>
          node instanceof HTMLTextAreaElement ? node.value : node.textContent)).toBe(draft);
      }
      const expanded = surface === "expanded", trigger = scope.locator(".session-native-model-trigger");
      await expect(trigger).toBeVisible(); await expect(trigger).toBeEnabled(); await settle(page);
      const closed = await record("closed-before");
      await readonly(closed, baseline, expanded); expect(await recent(page)).toEqual(initialRecent);
      expectEffort(closed, "ultra", "中"); await shot("closed-before");
      await trigger.click();
      const menu = page.locator(".session-native-model-menu").filter({ visible: true });
      await menu.waitFor(); await menu.evaluate(async (node) => {
        await Promise.all(node.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => {})));
      });
      const opened = await record("opened-default-four");
      await readonly(opened, closed, expanded); expect(await recent(page)).toEqual(initialRecent);
      await expectPower(opened, 4, "中", 2); await shot("default-four");
      // Deliberate external own-preference stimulus. It never sets expected
      // model/effort values, calls a loader, or claims a reachable preference editor.
      await setPreferences(["high", "low", "high", "persistent"]);
      const filtered = await record("live-filtered-two");
      await readonly(filtered, opened, expanded); expect(await recent(page)).toEqual(initialRecent);
      expect(filtered.prefs.enabled).toEqual(["high", "low", "high", "persistent"]);
      await expectPower(filtered, 2, "轻度", 1); expectEffort(filtered, "ultra", "中");
      const slider = menu.locator(".session-native-power-slider");
      await expect(slider).toBeVisible(); const box = await slider.boundingBox();
      if (!box || box.width < 40 || box.height < 1) throw Error("Real visible Power geometry required");
      await slider.click({ position: { x: box.width - 13, y: box.height / 2 } }); await settle(page);
      const pointer = await record("pointer-high"); checkProtected(pointer, expanded);
      expectEffort(pointer, "high", "高"); await expectPower(pointer, 2, "高", 2);
      await menu.getByRole("menuitem", { name: "强度", exact: true }).press("ArrowLeft"); await settle(page);
      const arrow = await record("arrow-low"); checkProtected(arrow, expanded);
      expectEffort(arrow, "low", "轻度"); await expectPower(arrow, 2, "轻度", 1);
      await slider.hover(); await page.mouse.wheel(0, -40); await settle(page);
      const wheel = await record("committed-wheel-high"); checkProtected(wheel, expanded);
      expectEffort(wheel, "high", "高"); await expectPower(wheel, 2, "高", 2); await shot("filtered-power");
      const beforeEmptyRecent = await recent(page);
      await setPreferences([]);
      const empty = await record("live-known-empty"); await readonly(empty, wheel, expanded);
      expect(await recent(page)).toEqual(beforeEmptyRecent); expect(empty.prefs.enabled).toEqual([]);
      expect.soft(empty.value.modelMenu?.view).toBe("advanced"); expect.soft(empty.value.modelMenu?.dots).toBe(0);
      expect.soft(empty.value.modelMenu?.sliderCount).toBe(0);
      expect.soft(empty.value.modelMenu?.modelRows).toHaveLength(1); await shot("known-empty");
      await page.keyboard.press("Escape"); await menu.waitFor({ state: "detached" });
      await expect(scope.locator(EDITOR).first()).toBeFocused();
      const escaped = await record("menu-escaped"); await readonly(escaped, empty, expanded);
      if (expanded) {
        await page.getByRole("button", { name: "返回并保留草稿", exact: true }).click();
        await scope.waitFor({ state: "detached" }); scope = page.locator(MAIN);
        await expect(scope.locator(EDITOR).first()).toBeFocused();
      }
      const main = await record("main-before-commands"); await readonly(main, empty, false);
      const closeCommandLayers = async () => {
        for (let count = 0; count < 4; count++) {
          const layers = page.locator('.session-composer-menu[role="menu"], [data-slot="popover-content"]');
          if (!await layers.filter({ visible: true }).count()) break;
          await page.keyboard.press("Escape"); await page.waitForTimeout(100);
        }
        // Existing R22 contract: finish the real layer exit before a new open.
        await page.waitForTimeout(350);
        await expect(page.locator('.session-composer-menu[role="menu"], [data-slot="popover-content"]').filter({ visible: true })).toHaveCount(0);
      };
      const commandItem = async (label: string) => {
        await closeCommandLayers();
        await page.locator(MAIN).getByRole("button", { name: "附加文件", exact: true }).click();
        const entrance = page.getByRole("button", { name: "当前会话的更多操作", exact: true }).filter({ visible: true });
        await expect(entrance).toBeVisible(); await entrance.click();
        const item = page.getByRole("menuitem", { name: label, exact: true }).filter({ visible: true });
        await expect(item).toBeVisible(); await expect(item).toBeEnabled(); return item;
      };
      let previous = main;
      for (const label of ["提高推理强度", "降低推理强度", "循环切换推理强度"]) {
        const item = await commandItem(label); await item.click(); await settle(page);
        const row = await record("empty-command-" + label); checkProtected(row, false);
        expect.soft(row.value.entry).toEqual(previous.value.entry);
        expect.soft(row.identity.aIdentity).toBe(previous.identity.aIdentity);
        previous = row;
      }
      // The menu is already open when preferences change. The action must read
      // the latest enabled membership inside the existing exact owner guard.
      const increase = await commandItem("提高推理强度");
      await setPreferences(["max", "medium", "low", "medium"]);
      const beforeIncrease = await record("open-command-latest-preferences");
      await readonly(beforeIncrease, previous, false);
      await increase.click(); await settle(page);
      const increased = await record("command-max"); checkProtected(increased, false); expectEffort(increased, "max", "Max");
      const decrease = await commandItem("降低推理强度"); await decrease.press("Enter"); await settle(page);
      const decreased = await record("command-medium"); checkProtected(decreased, false); expectEffort(decreased, "medium", "中");
      const cycle = await commandItem("循环切换推理强度");
      await setPreferences(["low", "high"]);
      const beforeCycle = await record("open-cycle-latest-preferences"); await readonly(beforeCycle, decreased, false);
      await cycle.press("Space"); await settle(page);
      const final = await record("final-closed"); checkProtected(final, false); expectEffort(final, "low", "轻度");
      expect(final.prefs.writes).toBe(4); expect(final.prefs.wheels).toEqual([{ trusted: true, deltaY: -40, inPower: true }]);
      expect(await page.locator(MAIN).locator(EDITOR).first().evaluate((node, old) => node === old, draftNode)).toBe(true);
      expect(counts).toEqual([1, 1, 1, 1]); expect(writes).toEqual([]); expect(external).toEqual([]); expect(errors).toEqual([]);
      expect(consoleErrors.filter((entry) => !(entry.url === origin + "/@vite/client" && entry.text.startsWith("[vite] failed to connect to websocket.")))).toEqual([]);
      const observed = await observer.evaluate((value) => value.read());
      expect(observed.overflow).toBe(false); expect(observed.events.filter((event) => event.type === "submit")).toEqual([]);
      const inputEvents = observed.events.filter((event) => event.type === "click" || event.type === "keydown");
      let bridgedKeyboardClicks = 0;
      for (const [index, event] of inputEvents.entries()) {
        if (event.trusted) continue;
        // Radix converts its trusted Enter/Space to synchronous element.click().
        // Only that exact same-item bridge is allowed; arbitrary synthetic UI
        // input still fails these hard guards.
        const previous = inputEvents[index - 1];
        expect(event).toMatchObject({ type: "click", trusted: false, role: "menuitem", inCommandMenu: true });
        expect(previous).toMatchObject({ type: "keydown", trusted: true, role: "menuitem", inCommandMenu: true, text: event.text });
        expect(["Enter", " "]).toContain(previous.key);
        expect(["降低推理强度", "循环切换推理强度"]).toContain(event.text);
        expect(Number(event.now) - Number(previous.now)).toBeGreaterThanOrEqual(0);
        expect(Number(event.now) - Number(previous.now)).toBeLessThanOrEqual(50);
        bridgedKeyboardClicks++;
      }
      expect(bridgedKeyboardClicks).toBe(2);
      expect(observed.events.some((event) => event.type === "click" && event.inCommandMenu)).toBe(true);
      await shot("final-closed");
    } catch (error) { failure = String(error); throw error; }
    finally {
      const assertionErrors = info.errors.map((error) => error.message ?? String(error.value ?? "Unknown test error"));
      if (!failure && assertionErrors.length) failure = assertionErrors[0];
      if (observer) { try { inputEvents = await observer.evaluate((value) => value.read()); await observer.evaluate((value) => value.dispose()); await observer.dispose(); } catch (error) { cleanupErrors.push(String(error)); } }
      if (reader && protection && !page.isClosed()) { try { await record("finally"); } catch (error) { cleanupErrors.push(String(error)); } }
      if (prefInput) { try { await prefInput.evaluate((input) => input.dispose()); await prefInput.dispose(); } catch (error) { cleanupErrors.push(String(error)); } }
      if (protection) { try { await protection.evaluate((value) => value.dispose()); await protection.dispose(); } catch (error) { cleanupErrors.push(String(error)); } }
      if (reader) { try { await reader.dispose(); } catch (error) { cleanupErrors.push(String(error)); } }
      if (!page.isClosed()) { try { await shot("finally"); } catch (error) { cleanupErrors.push(String(error)); } }
      if (draftNode) { try { await draftNode.dispose(); } catch (error) { cleanupErrors.push(String(error)); } }
      try { sourceAfter = hashInputs(); if (!isDeepStrictEqual(sourceAfter, sourceBefore)) cleanupErrors.push("E3 input source drift"); } catch (error) { cleanupErrors.push(String(error)); }
      try { await page.close(); } catch (error) { cleanupErrors.push(String(error)); }
      if (stream) { try {
        const closed = await stream.close(); streamCleanup = closed;
        if (!closed.closed || closed.listening || !closed.addressCleared || closed.activeResponses || closed.activeSockets ||
          closed.serverErrorCount || closed.requestOverflow || closed.errors.length || closed.acceptedRequests < 1)
          cleanupErrors.push("Owned SSE did not satisfy the complete close contract");
      } catch (error) { cleanupErrors.push(String(error)); } }
      const cleanupOnlyFailure = cleanupErrors.length > 0 && !failure;
      if (cleanupOnlyFailure) failure = "Cleanup failure: " + cleanupErrors.join("; ");
      const path = info.outputPath("model-picker-preferences.json");
      writeFileSync(path, JSON.stringify({ caseId: "E3", width, surface, theme, origin, phase, failure, assertionErrors,
        fixture: { model: CURRENT, rawEffort: "ultra", initialPreferences: ["low", "medium", "high", "xhigh", "ultra", "persistent"], includeUltraPolicy: false, catalog, custom: CUSTOM }, setup, states, counts, directory,
        api, writes, external, errors, consoleErrors, inputEvents, screenshots, cleanupErrors, streamCleanup, sourceBefore, sourceAfter,
        boundary: "Four synthetic real-page/main or real ComposerSheet cases, real pointer/arrow/wheel and nested main commands. Own preference store is an explicit bounded diagnostic stimulus, not a reachable preference editor or setting-hydration action. Initial setup only for models, no setting setters/loaders after UI input. No authenticated account, real catalog, official feature flag, native RPC, FI/Default/presets/action permission or physical-device claim. Raw DTO/cache and wire values remain intact." }, null, 2) + "\n");
      await info.attach("model-picker-preferences", { path, contentType: "application/json" });
      if (cleanupOnlyFailure) throw Error("Owned fixture cleanup failed: " + cleanupErrors.join("; "));
    }
  });
});
