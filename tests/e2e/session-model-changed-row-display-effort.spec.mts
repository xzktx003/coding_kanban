import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
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
const CURRENT = "r27-current-model", LABEL = "R27 当前模型";
const OWNER_A = JSON.stringify(["codex", "", "session", "ux-0"]);
const OWNER_B = JSON.stringify(["codex", "", "session", "ux-1"]);
const CUSTOM = { "r27-custom-provider": [{ id: "r27-custom-model", name: "R27 保留自定义模型" }] };
type ChangedRowCase = {
  id: "ROW01" | "ROW02"; raw: string | null;
  currentEfforts: string[]; targetEfforts: string[]; targetDefault: string;
  initialPower: "高" | "中";
};
const TARGET = "r27-different-model", TARGET_LABEL = "R27 另一模型";
const changedRowCases: ChangedRowCase[] = [
  { id: "ROW01", raw: null, currentEfforts: ["low", "high"],
    targetEfforts: ["low", "medium", "high"], targetDefault: "high", initialPower: "高" },
  { id: "ROW02", raw: "max", currentEfforts: ["low", "medium", "high"],
    targetEfforts: ["max", "medium"], targetDefault: "max", initialPower: "中" },
];
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
];
const hashInputs = () => inputs.map((path) => ({ path, sha256: createHash("sha256").update(readFileSync(path)).digest("hex") }));
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
function assertProtected(value: any, baseline: any, identity: any, firstIdentity: any, owner: string, draft: string, expanded: boolean, catalog: Model[], selected: boolean) {
  expect(value.currentThreadId).toBe("ux-0"); expect(value.owner).toBe(owner); expect(value.eventStreamConnected).toBe(true);
  expect(value.defaults).toEqual(baseline.defaults); expect(value.drafts).toEqual(baseline.drafts);
  expect(value.allThreads["ux-1"]).toEqual(baseline.allThreads["ux-1"]); expect(value.editorText).toBe(draft);
  expect(value.cache).toMatchObject({ loaded: true, loading: false, error: null, modelStatus: "success", hasModelSnapshot: true });
  expect(value.cache.models).toEqual(catalog);
  expect(value.cacheIdentity).toEqual({ captured: true, array: true, models: true, efforts: true });
  // Only the explicit different-row model/provider map, notice and prospective
  // effort/revision/pending may change. Tier and all other A fields remain hard.
  const stable = (entry: any) => {
    const { model, providerModels, notice, reasoningEffort, revision, pending, pendingFields, ...protectedFields } = entry;
    return protectedFields;
  };
  expect(stable(value.entry)).toEqual(stable(baseline.entry)); expect(identity.oldAUnchanged).toBe(true);
  expect(value.entry.model).toBe(selected ? TARGET : CURRENT);
  expect(value.settings.model).toBe(selected ? TARGET : CURRENT);
  expect(value.entry.providerModels).toEqual({ ...baseline.entry.providerModels, openai: selected ? TARGET : CURRENT });
  expect(identity.same.a).toBe(!selected);
  if (selected) {
    expect(value.entry.revision).toBeGreaterThan(baseline.entry.revision);
    expect(value.entry.pending).toBe(true);
    expect(value.entry.pendingFields).toEqual(expect.arrayContaining(["model"]));
  }
  expect({ ...identity.same, a: true }).toEqual({ a: true, b: true, defaults: true, custom: true, text: true, cache: true,
    richB: true, richContexts: true, richDrawings: true });
  expect(identity.b).toEqual(firstIdentity.b); expect(identity.defaults).toEqual(firstIdentity.defaults);
  expect(identity.custom).toEqual(CUSTOM); expect(identity.text).toEqual(firstIdentity.text);
  expect(identity.rich.a).toEqual({ ...firstIdentity.rich.a, expanded });
  expect(identity.rich.b).toEqual(firstIdentity.rich.b); expect(identity.rich.others).toEqual(firstIdentity.rich.others);
  expect(identity.rich.error).toBeNull();
}

for (const scenario of changedRowCases) for (const width of [1440, 390]) test.describe("R29 " + scenario.id + " changed native row " + width, () => {
  test.use({ viewport: { width, height: width === 390 ? 844 : 900 }, hasTouch: width === 390, isMobile: width === 390 });
  for (const surface of ["main", "expanded"] as const) test(surface + " changed row explicitly saves medium", async ({ page }, info) => {
    const theme = width === 1440 ? "dark" : "light", draft = "R29 " + scenario.id + " retained draft " + width + " " + surface;
    const catalog: Model[] = [
      model(CURRENT, LABEL, scenario.currentEfforts, "high", true),
      model(TARGET, TARGET_LABEL, scenario.targetEfforts, scenario.targetDefault, false),
    ];
    const counts = [0, 0, 0, 0];
    const directory: unknown[] = [], writes: unknown[] = [], api: unknown[] = [], external: unknown[] = [];
    const errors: string[] = [], consoleErrors: Array<{ text: string; url: string }> = [];
    const states: Array<{ phase: string; value: any; identity: any; scope: any }> = [], screenshots: string[] = [], cleanupErrors: string[] = [];
    const setup = { timeoutMs: 5000, ringCapacity: 64, reads: 0, discarded: 0, matched: false,
      samples: [] as Array<{ read: number; now: number; currentThreadId: string | null; owner: string | null }> };
    let origin = "", phase = "setup", failure: string | null = null, inputEvents: unknown = null, streamCleanup: unknown = null;
    let reader: Awaited<ReturnType<typeof createReader>> | null = null;
    let observer: Awaited<ReturnType<typeof observe>> | null = null;
    let protection: Awaited<ReturnType<typeof createProtectionReader>> | null = null;
    let stream: Awaited<ReturnType<typeof createFeedbackEventStream>> | null = null;
    let draftNode: Awaited<ReturnType<ReturnType<typeof page.locator>["elementHandle"]>> | null = null;
    let sourceBefore: ReturnType<typeof hashInputs> | null = null, sourceAfter: ReturnType<typeof hashInputs> | null = null;
    let scope = page.locator(MAIN);
    const record = async (name: string) => {
      if (!reader || !protection || states.length >= 32) throw Error("Read-only state reader missing or bounded phase limit exceeded");
      phase = name;
      const value = await read(page, reader), identity = await protection.evaluate((probe) => probe.read());
      const row = { phase: name, value, identity, scope: await inspectScope(scope) }; states.push(row); return row;
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
        // Initial fixture membership preserves R29 target [max, medium].
        // It does not override the app ordinary ultra=false display policy.
        localStorage.setItem("kanban.session.native-model-picker-preferences", JSON.stringify({
          state: { selectionMode: null, enabledReasoningEfforts: ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra", "persistent"] }, version: 1,
        }));
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
      const owners = await initialize(page, { model: CURRENT, effort: scenario.raw });
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
      await settle(page); protection = await createProtectionReader(page);
      const baseline = await record("baseline"), initialRecent = await recent(page);
      const protect = (row: typeof baseline, expanded: boolean, selected = false) => {
        assertProtected(row.value, baseline.value, row.identity, baseline.identity, owners.owner, draft, expanded, catalog, selected);
        expect(row.scope.editorText).toBe(draft);
        if (row.scope.trigger.expanded && row.value.modelMenu?.view === "simple") {
          expect(row.scope.trigger.model).toBeNull(); expect(row.scope.trigger.rawAria).toBeNull(); expect(row.scope.trigger.purpose).toBe("选择强度");
        } else {
          expect(row.scope.trigger.model).toBe(selected ? TARGET_LABEL : LABEL);
          expect(row.scope.trigger.rawAria?.startsWith("模型：" + (selected ? TARGET : CURRENT) + "，")).toBe(true);
        }
      };
      const stillReadOnly = async (row: typeof baseline, expanded: boolean) => {
        protect(row, expanded); expect(row.identity.same.a).toBe(true); expect(row.value.entry).toEqual(baseline.value.entry);
        expect(await recent(page)).toEqual(initialRecent);
      };
      expect(baseline.value.settings).toMatchObject({ model: CURRENT, modelProvider: "openai", reasoningEffort: scenario.raw });
      expect(baseline.value.entry).toMatchObject({ revision: 4, pending: false, pendingFields: [] });
      await stillReadOnly(baseline, false);
      if (surface === "expanded") {
        await scope.getByRole("button", { name: "附加文件", exact: true }).click();
        await page.getByRole("button", { name: "展开编辑", exact: true }).click();
        await page.getByRole("dialog", { name: "展开编辑", exact: true }).waitFor();
        scope = page.locator(".session-mode .session-composer-sheet.is-full");
        await expect(scope).toHaveCount(1); await expect(scope).toBeVisible();
        await expect.poll(() => scope.locator(EDITOR).first().evaluate((node) =>
          node instanceof HTMLTextAreaElement ? node.value : node.textContent)).toBe(draft);
      }
      const trigger = scope.locator(".session-native-model-trigger");
      await expect(trigger).toBeVisible(); await expect(trigger).toBeEnabled(); await settle(page);
      const closed = await record("closed-before");
      await stillReadOnly(closed, surface === "expanded");
      expect(closed.scope.trigger).toEqual({ rawAria: "模型：" + CURRENT + "，medium", model: LABEL, effort: "中", expanded: false, purpose: null });
      await shot("closed-before");
      await trigger.click();
      const menu = page.locator(".session-native-model-menu").filter({ visible: true });
      await menu.waitFor(); await menu.evaluate(async (node) => {
        await Promise.all(node.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => {})));
      });
      const opened = await record("opened-simple");
      expect(opened.value.modelMenu?.view).toBe("simple"); expect(opened.value.modelMenu?.dots).toBe(scenario.currentEfforts.length);
      expect(await menu.locator(".session-native-power-effort").textContent()).toBe(scenario.initialPower);
      await stillReadOnly(opened, surface === "expanded");
      await menu.getByRole("menuitem", { name: "选择模型", exact: true }).click();
      await expect(menu.locator('[data-model-picker-view="advanced"]')).toBeVisible(); await settle(page);
      const advanced = await record("advanced-current-checked");
      await stillReadOnly(advanced, surface === "expanded");
      const currentRow = menu.getByRole("menuitemradio", { name: LABEL, exact: true });
      const targetRow = menu.getByRole("menuitemradio", { name: TARGET_LABEL, exact: true });
      await expect(currentRow).toBeEnabled(); await expect(currentRow).toHaveAttribute("aria-checked", "true");
      await expect(targetRow).toBeEnabled(); await expect(targetRow).toHaveAttribute("aria-checked", "false");
      await expect(menu.getByRole("menuitemradio")).toHaveCount(2);
      await shot("advanced-current-checked");
      // The only settings action is this real, different canonical row click.
      await targetRow.click(); await settle(page);
      const selected = await record("selected-target");
      protect(selected, surface === "expanded", true);
      expect(selected.value.modelMenu?.view).toBe("simple"); expect(selected.value.modelMenu?.dots).toBe(scenario.targetEfforts.length);
      await expect(menu).toBeVisible();
      const selectedPower = await menu.locator(".session-native-power-effort").textContent();
      const selectedStatus = await menu.getByRole("status").textContent();
      const selectedRecent = await recent(page);
      expect(selectedRecent[0]).toMatchObject({ model: TARGET, label: TARGET_LABEL, serviceTier: null });
      expect(selectedRecent.slice(1)).toEqual(initialRecent.slice(0, 7));
      await shot("selected-target-simple");
      await page.keyboard.press("Escape"); await menu.waitFor({ state: "detached" });
      await expect(scope.locator(EDITOR).first()).toBeFocused();
      const escaped = await record("menu-escaped"); protect(escaped, surface === "expanded", true);
      expect(escaped.scope.ownerAttribute).toBe(closed.scope.ownerAttribute); expect(escaped.scope.activeIsEditor).toBe(true);
      if (surface === "expanded") {
        await page.getByRole("button", { name: "返回并保留草稿", exact: true }).click();
        await scope.waitFor({ state: "detached" }); scope = page.locator(MAIN);
        await expect(scope.locator(EDITOR).first()).toBeFocused();
      }
      await settle(page); const final = await record("final-closed"); protect(final, false, true);
      expect(await recent(page)).toEqual(selectedRecent);
      expect(await page.locator(MAIN).locator(EDITOR).first().evaluate((node, old) => node === old, draftNode)).toBe(true);
      expect(counts).toEqual([1, 1, 1, 1]); expect(writes).toEqual([]); expect(external).toEqual([]); expect(errors).toEqual([]);
      expect(consoleErrors.filter((entry) => !(entry.url === origin + "/@vite/client" && entry.text.startsWith("[vite] failed to connect to websocket.")))).toEqual([]);
      const observed = await observer.evaluate((value) => value.read());
      expect(observed.overflow).toBe(false); expect(observed.events.filter((event) => event.type === "submit")).toEqual([]);
      expect(observed.events.filter((event) => event.type === "click" || event.type === "keydown").every((event) => event.trusted)).toBe(true);
      const rowClicks = observed.events.filter((event) => event.type === "click" && event.role === "menuitemradio");
      expect(rowClicks).toHaveLength(1); expect(rowClicks[0]).toMatchObject({ trusted: true, inModelMenu: true });
      expect(rowClicks[0].text).toContain(TARGET_LABEL);
      await shot("final-closed");
      // ALL safety, real-UI, read-count, owner, raw catalog/ref and focus-return
      // controls above run before these soft target projections on old product.
      for (const row of [selected, escaped, final]) {
        expect.soft(row.value.settings.reasoningEffort, row.phase).toBe("medium");
        expect.soft(row.value.entry.reasoningEffort, row.phase).toBe("medium");
        expect.soft(row.value.entry.pendingFields, row.phase).toEqual(expect.arrayContaining(["model", "reasoningEffort"]));
        expect.soft(row.scope.trigger.effort, row.phase).toBe(row.scope.trigger.expanded && row.value.modelMenu?.view === "simple" ? null : "中");
      }
      expect.soft(selectedPower).toBe("中");
      expect.soft(selectedStatus).toContain("标准，第 2 项，共 " + scenario.targetEfforts.length + " 项");
      expect.soft(selectedRecent[0].reasoningEffort).toBe("medium");
    } catch (error) { failure = String(error); throw error; }
    finally {
      const assertionErrors = info.errors.map((error) => error.message ?? String(error.value ?? "Unknown test error"));
      if (!failure && assertionErrors.length) failure = assertionErrors[0];
      if (observer) { try { inputEvents = await observer.evaluate((value) => value.read()); await observer.evaluate((value) => value.dispose()); await observer.dispose(); } catch (error) { cleanupErrors.push(String(error)); } }
      if (reader && protection && !page.isClosed()) { try { await record("finally"); } catch (error) { cleanupErrors.push(String(error)); } }
      if (protection) { try { await protection.evaluate((value) => value.dispose()); await protection.dispose(); } catch (error) { cleanupErrors.push(String(error)); } }
      if (reader) { try { await reader.dispose(); } catch (error) { cleanupErrors.push(String(error)); } }
      if (!page.isClosed()) { try { await shot("finally"); } catch (error) { cleanupErrors.push(String(error)); } }
      if (draftNode) { try { await draftNode.dispose(); } catch (error) { cleanupErrors.push(String(error)); } }
      try { sourceAfter = hashInputs(); if (!isDeepStrictEqual(sourceAfter, sourceBefore)) cleanupErrors.push("R29 input source drift"); } catch (error) { cleanupErrors.push(String(error)); }
      try { await page.close(); } catch (error) { cleanupErrors.push(String(error)); }
      if (stream) { try {
        const closed = await stream.close(); streamCleanup = closed;
        if (!closed.closed || closed.listening || !closed.addressCleared || closed.activeResponses || closed.activeSockets ||
          closed.serverErrorCount || closed.requestOverflow || closed.errors.length || closed.acceptedRequests < 1)
          cleanupErrors.push("Owned SSE did not satisfy the complete close contract");
      } catch (error) { cleanupErrors.push(String(error)); } }
      const cleanupOnlyFailure = cleanupErrors.length > 0 && !failure;
      if (cleanupOnlyFailure) failure = "Cleanup failure: " + cleanupErrors.join("; ");
      const path = info.outputPath("model-changed-row-display-effort.json");
      writeFileSync(path, JSON.stringify({ caseId: scenario.id, width, surface, theme, origin, phase, failure, assertionErrors,
        fixture: { model: CURRENT, rawEffort: scenario.raw, targetModel: TARGET, targetEffort: "medium", initialPower: scenario.initialPower, catalog, custom: CUSTOM }, setup, states, counts, directory,
        api, writes, external, errors, consoleErrors, inputEvents, screenshots, cleanupErrors, streamCleanup, sourceBefore, sourceAfter,
        boundary: "Eight ordinary existing-thread changed-row synthetic fixtures; real page/main or real ComposerSheet UI, no authenticated account/real catalog/native RPC/SDK or physical-device claim; the UI may change local settings in the counterexample. Driver never hydrates, calls a loader or invokes choose after initial setup. Recent remains local compatibility bookkeeping; FI/locked/default presets, native action permissions and atomic RPC/CAS are outside scope. The unchanged R27 companion spec separately protects same-current null/tier/revision behavior." }, null, 2) + "\n");
      await info.attach("model-changed-row-display-effort", { path, contentType: "application/json" });
      if (cleanupOnlyFailure) throw Error("Owned fixture cleanup failed: " + cleanupErrors.join("; "));
    }
  });
});
