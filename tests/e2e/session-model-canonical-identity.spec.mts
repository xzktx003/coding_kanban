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

// These are source-derived independent DTO fields, not a real authenticated catalog.
const CANON_A = "r25-canonical-a", CANON_B = "r25-canonical-b";
const ID_A = "r25-catalog-a", ID_B = "r25-catalog-b";
const FRIEND_A = "Friendly A", FRIEND_B = "Friendly B";
type Kind = "canonical-known" | "id-only-unknown" | "earlier-id-collision";
type Effort = "low" | "medium" | "high" | "xhigh";
type Scenario = {
  kind: Kind; current: string; effort: Effort; catalog: Model[];
  label: string; effortLabel: string; count: number; position: number; statusEffort: string;
};
function item(id: string, model: string, displayName: string,
  efforts: Array<"low" | "medium" | "high">, defaultReasoningEffort: "medium" | "high", isDefault: boolean): Model {
  return {
    id, model, displayName, description: "R25 synthetic ordinary identity catalog",
    hidden: false, isDefault, upgrade: null, upgradeInfo: null, availabilityNux: null,
    supportedReasoningEfforts: efforts.map((reasoningEffort) => ({ reasoningEffort, description: reasoningEffort })),
    defaultReasoningEffort, inputModalities: ["text", "image"], supportsPersonality: false,
    additionalSpeedTiers: [], serviceTiers: [], defaultServiceTier: null,
  };
}
function scenario(kind: Kind): Scenario {
  const catalog = [
    item(kind === "earlier-id-collision" ? CANON_B : ID_A, CANON_A, FRIEND_A, ["low", "medium"], "medium", true),
    item(ID_B, CANON_B, FRIEND_B, ["medium", "high"], "high", false),
  ];
  if (kind === "canonical-known") return { kind, current: CANON_A, effort: "low", catalog,
    label: FRIEND_A, effortLabel: "轻度", count: 2, position: 1, statusEffort: "轻度" };
  if (kind === "id-only-unknown") return { kind, current: ID_A, effort: "xhigh", catalog,
    label: "自定义", effortLabel: "极高", count: 6, position: 5, statusEffort: "极高" };
  return { kind, current: CANON_B, effort: "high", catalog,
    label: FRIEND_B, effortLabel: "高", count: 2, position: 2, statusEffort: "深度" };
}
const inputs = [
  "apps/web/src/session-mode/components/codex/composer/NativeModelSelector.tsx",
  "apps/web/src/session-mode/components/codex/composer/NativeModelTrigger.tsx",
  "apps/web/src/session-mode/components/codex/composer/nativePowerWheel.ts",
  "apps/web/src/session-mode/components/codex/composer/nativeReasoningOptions.ts",
  "apps/web/src/session-mode/components/codex/composer/nativeReasoningLabel.ts",
  "apps/web/src/session-mode/components/codex/composer/ReasoningEffortSelector.tsx",
  "apps/web/src/session-mode/components/codex/composer/NativeServiceTierControl.tsx",
  "apps/web/src/session-mode/components/codex/composer/recentModelConfigs.ts",
  "apps/web/src/session-mode/components/codex/composer/Composer.tsx",
  "apps/web/src/session-mode/components/codex/composer/v2/ComposerSheet.tsx",
  "apps/web/src/session-mode/components/codex/hooks/useModels.ts",
  "apps/web/src/session-mode/hooks/useThreadModelSettings.ts",
  "apps/web/src/session-mode/stores/useThreadModelStore.ts",
  "apps/web/src/session-mode/stores/useSessionDraftStore.ts",
  "apps/web/src/session-mode/components/codex/stores/useConfigStore.ts",
  "apps/web/src/session-mode/components/codex/stores/useCodexStore.ts",
  "apps/web/src/session-mode/session-dom.ts",
  "apps/web/src/session-mode/components/ui/dropdown-menu.tsx",
  "tests/e2e/session-ux-fixture.ts",
  "tests/e2e/fixtures/session-model-command-page.mts",
  "tests/e2e/fixtures/session-feedback-event-stream.mts",
  "tests/e2e/session-model-canonical-identity.spec.mts",
];
const optionalInputs = ["apps/web/src/session-mode/components/codex/composer/nativeModelIdentity.ts"];
const hashInputs = () => [
  ...inputs.map((path) => ({ path, sha256: createHash("sha256").update(readFileSync(path)).digest("hex") })),
  ...optionalInputs.map((path) => ({ path, optional: true, present: existsSync(path),
    sha256: existsSync(path) ? createHash("sha256").update(readFileSync(path)).digest("hex") : null })),
];
const settle = (page: Page) => page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
async function recent(page: Page) {
  return page.evaluate(async () => {
    const path = "/src/session-mode/components/codex/composer/recentModelConfigs.ts";
    const url = performance.getEntriesByType("resource").findLast((entry) => new URL(entry.name).pathname === path)?.name;
    if (!url) throw Error("Mounted read-only recent reader missing");
    return structuredClone((await import(url)).recentModelConfigs());
  });
}
async function inspectScope(scope: Locator) {
  return scope.evaluate((node) => {
    const trigger = node.querySelector(".session-native-model-trigger");
    const editor = node.querySelector('[contenteditable="true"], .session-rich-draft textarea');
    return {
      className: node.className, ownerAttribute: node.getAttribute("data-draft-owner"),
      editorText: editor instanceof HTMLTextAreaElement ? editor.value : editor?.textContent ?? null,
      trigger: { rawAria: trigger?.getAttribute("aria-label") ?? null,
        label: trigger?.querySelector(".session-native-model-label")?.textContent ?? null,
        effort: trigger?.querySelector(".session-native-model-effort")?.textContent ?? null,
        disabled: trigger?.hasAttribute("disabled") ?? null },
    };
  });
}
function assertProtected(value: any, baseline: any, catalog: Model[], owner: string, draft: string) {
  expect(value.currentThreadId).toBe("ux-0"); expect(value.owner).toBe(owner);
  expect(value.defaults).toEqual(baseline.defaults); expect(value.drafts).toEqual(baseline.drafts);
  expect(value.allThreads["ux-1"]).toEqual(baseline.allThreads["ux-1"]);
  expect(value.editorText).toBe(draft);
  expect(value.cache).toMatchObject({ loaded: true, loading: false, error: null, modelStatus: "success", hasModelSnapshot: true });
  expect(value.cache.models).toEqual(catalog);
  expect(value.cacheIdentity).toEqual({ captured: true, array: true, models: true, efforts: true });
  for (const key of ["modelProvider", "serviceTier", "sandbox", "sandboxPolicy", "approvalPolicy", "approvalsReviewer", "autoReviewCapability", "webSearchRequest", "collaborationMode", "personality"])
    expect(value.settings[key], key).toEqual(baseline.settings[key]);
}

for (const width of [1440, 390]) test.describe(`R25 ordinary canonical model ${width}`, () => {
  test.use({ viewport: { width, height: width === 390 ? 844 : 900 }, hasTouch: width === 390, isMobile: width === 390 });
  for (const kind of ["canonical-known", "id-only-unknown", "earlier-id-collision"] as const)
    test(kind, async ({ page }, info) => {
      const variant = scenario(kind);
      let origin = "";
      const initialTheme = width === 1440 ? "dark" : "light";
      const surface = width === 1440 ? "main" : "expanded";
      const draft = `R25 retained draft ${surface} ${kind}`;
      const counts = [0, 0, 0, 0];
      const directory: unknown[] = [], writes: unknown[] = [], api: unknown[] = [], external: unknown[] = [];
      const errors: string[] = [], consoleErrors: Array<{ text: string; url: string }> = [];
      const states: Array<{ phase: string; value: unknown }> = [];
      const ui: Array<{ phase: string; value: unknown }> = [], recents: Array<{ phase: string; value: unknown }> = [];
      const screenshots: string[] = [], cleanupErrors: string[] = [];
      const setupReadiness = {
        timeoutMs: 5_000, ringCapacity: 64, reads: 0, discarded: 0, matched: false,
        samples: [] as Array<{ read: number; now: number; currentThreadId: string | null; owner: string | null }>,
      };
      let phase = "setup", failure: string | null = null, inputEvents: unknown = null, streamCleanup: unknown = null;
      let reader: Awaited<ReturnType<typeof createReader>> | null = null;
      let observer: Awaited<ReturnType<typeof observe>> | null = null;
      let stream: Awaited<ReturnType<typeof createFeedbackEventStream>> | null = null;
      let draftNode: Awaited<ReturnType<ReturnType<typeof page.locator>["elementHandle"]>> | null = null;
      let sourceBefore: ReturnType<typeof hashInputs> | null = null;
      let sourceAfter: ReturnType<typeof hashInputs> | null = null;
      const record = async (name: string) => {
        if (!reader) throw Error("No mounted read-only reader");
        const value = await read(page, reader); states.push({ phase: name, value }); return value;
      };
      const shot = async (name: string) => {
        const path = info.outputPath(name + ".png"); await page.screenshot({ path, fullPage: true }); screenshots.push(path);
      };
      page.on("pageerror", (error) => errors.push(error.stack ?? String(error)));
      page.on("console", (message) => { if (message.type() === "error") consoleErrors.push({ text: message.text(), url: message.location().url }); });
      try {
        sourceBefore = hashInputs();
        origin = new URL(String(info.project.use.baseURL)).origin;
        const host = new URL(origin).hostname;
        if (["localhost", "127.0.0.1", "[::1]"].includes(host)) throw Error("R25 requires root's explicit owned LAN frontend URL");
        stream = await createFeedbackEventStream(origin);
        await page.addInitScript((theme) => localStorage.setItem("kanban.session.theme-storage", JSON.stringify({ state: { theme }, version: 0 })), initialTheme);
        await page.route("**/*", async (route) => {
          const request = route.request();
          if (new URL(request.url()).origin !== origin || !["GET", "HEAD"].includes(request.method())) {
            external.push({ method: request.method(), url: request.url() }); await route.abort("blockedbyclient");
          } else await route.continue();
        });
        await installSessionUxFixture(page, 2);
        await page.route("**/api/**", async (route) => {
          const request = route.request(), path = new URL(request.url()).pathname;
          const entry = { method: request.method(), path, body: request.method() === "POST" ? request.postDataJSON() : null };
          api.push(entry);
          if (path === "/api/session/api/events" && entry.method === "GET") {
            if (!stream) throw Error("Owned SSE unavailable");
            await route.continue({ url: stream.url }); return;
          }
          const index = paths.findIndex((suffix) => path.endsWith(suffix));
          if (index >= 0) {
            directory.push(entry);
            const valid = path === "/api/session" + paths[index] && entry.method === (index === 0 ? "POST" : "GET") &&
              (index === 0 ? isDeepStrictEqual(entry.body, { cursor: null, limit: 100 }) : entry.body === null);
            if (!valid) { writes.push(entry); await route.fulfill({ status: 409, json: { error: "R25 directory contract mismatch" } }); return; }
            counts[index]++; await route.fulfill({ json: index === 0 ? { data: variant.catalog, nextCursor: null } : [] }); return;
          }
          if (!["GET", "HEAD"].includes(entry.method) && !reads.has(path) && !bookkeeping.has(path)) {
            writes.push(entry); await route.fulfill({ status: 409, json: { error: "R25 unclassified mutation rejected" } }); return;
          }
          await route.fallback();
        });
        await page.goto("/?mode=session&view=agent", { waitUntil: "domcontentloaded" });
        await page.locator(MAIN).locator(EDITOR).first().waitFor();
        // Initial fixture hydration only. No driver setter or loader is used after this point.
        await seedSessionUx(page, 2);
        const owners = await initialize(page, { model: variant.current, effort: variant.effort });
        reader = await createReader(page, owners); observer = await observe(page);
        // Read-only initial admission: never repair selection or repeat fixture hydration.
        await expect.poll(async () => {
          const value = await read(page, reader!);
          setupReadiness.reads++;
          if (setupReadiness.samples.length === setupReadiness.ringCapacity) {
            setupReadiness.samples.shift(); setupReadiness.discarded++;
          }
          setupReadiness.samples.push({ read: setupReadiness.reads, now: value.now,
            currentThreadId: value.currentThreadId, owner: value.owner });
          return { currentThreadId: value.currentThreadId, owner: value.owner };
        }, { timeout: setupReadiness.timeoutMs, intervals: [25, 50, 100],
          message: "R25 initial selected thread and main DOM owner must agree before input" })
          .toEqual({ currentThreadId: "ux-0", owner: owners.owner });
        setupReadiness.matched = true;
        await page.locator(MAIN).locator(EDITOR).first().fill(draft);
        draftNode = await page.locator(MAIN).locator(EDITOR).first().elementHandle();
        await expect.poll(() => counts).toEqual([1, 1, 1, 1]);
        await expect.poll(async () => (await read(page, reader!)).cache.loaded).toBe(true);
        await expect.poll(async () => (await read(page, reader!)).eventStreamConnected).toBe(true);
        await settle(page);
        const baseline = await record("baseline");
        expect(baseline.settings.model).toBe(variant.current); expect(baseline.settings.reasoningEffort).toBe(variant.effort);
        expect(baseline.entry.pending).toBe(false); expect(baseline.entry.revision).toBe(4);
        assertProtected(baseline, baseline, variant.catalog, owners.owner, draft);
        const initialRecent = await recent(page); recents.push({ phase: "baseline", value: initialRecent });
        let scope = page.locator(MAIN);
        if (width === 390) {
          await scope.getByRole("button", { name: "附加文件", exact: true }).click();
          await page.getByRole("button", { name: "展开编辑", exact: true }).click();
          await page.getByRole("dialog", { name: "展开编辑", exact: true }).waitFor();
          scope = page.locator(".session-mode .session-composer-sheet.is-full");
          await expect(scope).toHaveCount(1);
          await expect(scope).toBeVisible();
          await expect.poll(() => scope.locator(EDITOR).first().evaluate((node) =>
            node instanceof HTMLTextAreaElement ? node.value : node.textContent)).toBe(draft);
        }
        const trigger = scope.locator(".session-native-model-trigger");
        await expect(trigger).toBeVisible(); await expect(trigger).toBeEnabled(); await settle(page);
        phase = "closed-trigger";
        const closed = await inspectScope(scope); ui.push({ phase, value: closed });
        // Literal primitive assertions after real readiness/two frames: identity
        // soft failures retain subsequent rows; safety/settings controls stay hard.
        expect.soft(closed.trigger.label).toBe(variant.label);
        expect.soft(closed.trigger.effort).toBe(variant.effortLabel);
        expect.soft(closed.trigger.rawAria).toBe(`模型：${variant.current}，${variant.effort}`);
        await shot("closed-trigger");
        await trigger.click();
        const menu = page.locator(".session-native-model-menu").filter({ visible: true });
        await menu.waitFor(); await menu.evaluate(async (node) => {
          await Promise.all(node.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => {})));
        });
        const assertSimple = async (name: string, label: string, effortLabel: string, count: number, position: number, statusEffort: string) => {
          phase = name;
          const value = await record(name); ui.push({ phase: name, value: await inspectScope(scope) });
          expect(value.modelMenu?.view).toBe("simple");
          expect.soft(await menu.locator(".session-native-power-model").textContent()).toBe(label);
          expect.soft(await menu.locator(".session-native-power-effort").textContent()).toBe(effortLabel);
          expect.soft(value.modelMenu.dots).toBe(count);
          const status = await menu.locator('[data-model-picker-view="simple"] [role="status"]').textContent();
          expect.soft(status).toContain(`${label} ${statusEffort}`);
          expect.soft(status?.replace(/\s+/g, "")).toContain(`第${position}项，共${count}项`);
          return value;
        };
        const opened = await assertSimple("opened-simple", variant.label, variant.effortLabel, variant.count, variant.position, variant.statusEffort);
        assertProtected(opened, baseline, variant.catalog, owners.owner, draft);
        expect(opened.entry).toEqual(baseline.entry); expect(await recent(page)).toEqual(initialRecent);
        await shot("opened-simple");
        const advanced = async (name: string) => {
          await menu.getByRole("menuitem", { name: "选择模型", exact: true }).click();
          await expect(menu.locator('[data-model-picker-view="advanced"]')).toBeVisible();
          await settle(page); phase = name;
          const value = await record(name); ui.push({ phase: name, value: await inspectScope(scope) });
          const rows = menu.getByRole("menuitemradio");
          const first = menu.getByRole("menuitemradio", { name: FRIEND_A, exact: true });
          const second = menu.getByRole("menuitemradio", { name: FRIEND_B, exact: true });
          await expect(first).toBeEnabled(); await expect(second).toBeEnabled();
          const rowEvidence = await rows.evaluateAll((nodes) => nodes.map((node) => ({
            text: node.textContent?.trim() ?? null, role: node.getAttribute("role"),
            checked: node.getAttribute("aria-checked"), title: node.getAttribute("title"),
            disabled: node.hasAttribute("data-disabled") || node.getAttribute("aria-disabled") === "true",
          })));
          ui.push({ phase: name + "-rows", value: rowEvidence });
          const texts = await rows.allTextContents();
          expect.soft(texts.slice(0, 2).map((text) => text.trim())).toEqual([FRIEND_A, FRIEND_B]);
          const currentLabel = kind === "canonical-known" ? FRIEND_A : kind === "earlier-id-collision" ? FRIEND_B : null;
          expect.soft(await first.getAttribute("aria-checked")).toBe(currentLabel === FRIEND_A ? "true" : "false");
          expect.soft(await second.getAttribute("aria-checked")).toBe(currentLabel === FRIEND_B ? "true" : "false");
          const checkedTexts = await menu.locator('[role="menuitemradio"][aria-checked="true"]').allTextContents();
          if (currentLabel) {
            expect.soft(await rows.count()).toBe(2);
            expect.soft(checkedTexts.map((text) => text.trim())).toEqual([currentLabel]);
          } else {
            // Existing unknown extra-row UI is a separate local feature: permit
            // its raw diagnostic checked row, never a known catalog selection.
            expect.soft(checkedTexts.every((text) => text.trim() === variant.current)).toBe(true);
          }
          return { value, first, second };
        };
        const rows = await advanced("advanced-identity");
        assertProtected(rows.value, baseline, variant.catalog, owners.owner, draft);
        expect(rows.value.entry).toEqual(baseline.entry); expect(await recent(page)).toEqual(initialRecent);
        await shot("advanced-identity");
        if (kind === "canonical-known") {
          phase = "explicit-current-canonical";
          await rows.first.click(); await settle(page);
          const same = await assertSimple("explicit-current-canonical", FRIEND_A, "轻度", 2, 1, "轻度");
          assertProtected(same, baseline, variant.catalog, owners.owner, draft);
          // Valid effort low and tier null: current-row selection may update recent,
          // but must not rewrite raw model or create a settings revision.
          expect.soft(same.entry).toEqual(baseline.entry);
          const sameRecent = await recent(page); recents.push({ phase, value: sameRecent });
          expect.soft(sameRecent[0]).toMatchObject({ model: CANON_A, label: FRIEND_A, reasoningEffort: "low", serviceTier: null });
          const otherRows = await advanced("before-explicit-other");
          phase = "explicit-other-canonical";
          await otherRows.second.click(); await settle(page);
          const changed = await assertSimple("explicit-other-canonical", FRIEND_B, "高", 2, 2, "深度");
          assertProtected(changed, baseline, variant.catalog, owners.owner, draft);
          expect.soft(changed.settings.model).toBe(CANON_B); expect.soft(changed.settings.reasoningEffort).toBe("high");
          expect.soft(changed.settings.providerModels.openai).toBe(CANON_B);
          // Existing sequential local setters; this is not a native atomic pair ACK.
          expect.soft(changed.entry.revision).toBe(baseline.entry.revision + 2);
          const changedRecent = await recent(page); recents.push({ phase, value: changedRecent });
          expect.soft(changedRecent[0]).toMatchObject({ model: CANON_B, label: FRIEND_B, reasoningEffort: "high", serviceTier: null });
          await shot("explicit-other-canonical");
        }
        await page.keyboard.press("Escape"); await menu.waitFor({ state: "detached" });
        await expect(scope.locator(EDITOR).first()).toBeFocused();
        if (width === 390) {
          await page.getByRole("button", { name: "返回并保留草稿", exact: true }).click();
          await scope.waitFor({ state: "detached" }); scope = page.locator(MAIN);
        }
        await settle(page); phase = "final-closed";
        const final = await record(phase); ui.push({ phase, value: await inspectScope(scope) });
        assertProtected(final, baseline, variant.catalog, owners.owner, draft);
        if (kind === "canonical-known") {
          expect.soft(final.settings.model).toBe(CANON_B); expect.soft(final.settings.reasoningEffort).toBe("high");
        } else { expect(final.entry).toEqual(baseline.entry); expect(await recent(page)).toEqual(initialRecent); }
        expect(await page.locator(MAIN).locator(EDITOR).first().evaluate((node, old) => node === old, draftNode)).toBe(true);
        expect(counts).toEqual([1, 1, 1, 1]); expect(writes).toEqual([]); expect(external).toEqual([]); expect(errors).toEqual([]);
        expect(consoleErrors.filter((entry) => !(entry.url === origin + "/@vite/client" && entry.text.startsWith("[vite] failed to connect to websocket.")))).toEqual([]);
        const observed = await observer.evaluate((value) => value.read());
        expect(observed.overflow).toBe(false); expect(observed.events.filter((event) => event.type === "submit")).toEqual([]);
        expect(observed.events.filter((event) => event.type === "click" || event.type === "keydown").every((event) => event.trusted)).toBe(true);
        expect(observed.events.filter((event) => event.type === "click" && event.role === "menuitemradio")).toHaveLength(kind === "canonical-known" ? 2 : 0);
        await shot("final-closed");
      } catch (error) { failure = String(error); throw error; }
      finally {
        const assertionErrors = info.errors.map((error) => error.message ?? String(error.value ?? "Unknown test error"));
        if (!failure && assertionErrors.length) failure = assertionErrors[0];
        if (observer) { try { inputEvents = await observer.evaluate((value) => value.read()); await observer.evaluate((value) => value.dispose()); await observer.dispose(); } catch (error) { cleanupErrors.push(String(error)); } }
        if (reader) { try { await record("finally"); await reader.dispose(); } catch (error) { cleanupErrors.push(String(error)); } }
        try { await shot("finally"); } catch (error) { cleanupErrors.push(String(error)); }
        if (draftNode) { try { await draftNode.dispose(); } catch (error) { cleanupErrors.push(String(error)); } }
        try { sourceAfter = hashInputs(); if (!isDeepStrictEqual(sourceAfter, sourceBefore)) cleanupErrors.push("R25 input source drift"); } catch (error) { cleanupErrors.push(String(error)); }
        try { await page.close(); } catch (error) { cleanupErrors.push(String(error)); }
        if (stream) { try {
          const closed = await stream.close(); streamCleanup = closed;
          if (!closed.closed || closed.listening || !closed.addressCleared || closed.activeResponses || closed.activeSockets || closed.serverErrorCount || closed.requestOverflow || closed.errors.length || closed.acceptedRequests < 1)
            cleanupErrors.push("Owned SSE did not satisfy the complete close contract");
        } catch (error) { cleanupErrors.push(String(error)); } }
        const cleanupOnlyFailure = cleanupErrors.length && !failure;
        if (cleanupOnlyFailure) failure = "Cleanup failure: " + cleanupErrors.join("; ");
        const path = info.outputPath("model-identity.json");
        writeFileSync(path, JSON.stringify({ width, surface, kind, variant, initialTheme, origin, phase, failure,
          assertionErrors, setupReadiness, states, ui, recents, counts, directory, api, writes, external, errors, consoleErrors,
          inputEvents, screenshots, cleanupErrors, streamCleanup, sourceBefore, sourceAfter,
          boundary: "Source-derived distinct-id ordinary native fixture; no real catalog/account/alias acceptance, original GUI, native/config write or physical-device claim. Driver does not mutate stores after initial fixture hydration. Unknown extra row remains an unaligned local feature." }, null, 2) + "\n");
        await info.attach("model-identity", { path, contentType: "application/json" });
        if (cleanupOnlyFailure) throw Error("Owned fixture cleanup failed: " + cleanupErrors.join("; "));
      }
    });
});
