import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { isDeepStrictEqual } from "node:util";
import { expect, test, type JSHandle } from "@playwright/test";
type WheelRecord = { trusted: boolean; cancelable: boolean; ctrl: boolean; deltaX: number; deltaY: number; deltaMode: number; timeStamp: number; inPower: boolean; defaultPrevented: boolean | null; cancellationObservedAt: "unobserved" | "same-root-bubble" };
type WheelProbe = { read: () => { events: WheelRecord[]; overflow: boolean }; dispose: () => void };

import type { Model } from "../../apps/web/src/session-mode/bindings/v2";
import { createFeedbackEventStream } from "./fixtures/session-feedback-event-stream.mts";
import { EDITOR, MAIN, UNKNOWN, SELECTED, initialize, createReader, observe, read } from "./fixtures/session-model-command-page.mts";

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
const catalog: Model[] = [{
  id: SELECTED, model: SELECTED, displayName: "R24 已知模型", description: "Isolated complete model", upgrade: null,
  upgradeInfo: null, availabilityNux: null, hidden: false, isDefault: true,
  supportedReasoningEfforts: ["low", "medium", "high"].map((reasoningEffort) => ({ reasoningEffort, description: reasoningEffort })),
  defaultReasoningEffort: "medium", inputModalities: ["text", "image"], supportsPersonality: false,
  additionalSpeedTiers: [], serviceTiers: [], defaultServiceTier: null,
}];

for (const width of [1440, 390]) test.describe(`R24 ordinary Power wheel ${width}`, () => {
  test.use({ viewport: { width, height: width === 390 ? 844 : 900 }, hasTouch: width === 390, isMobile: width === 390 });
  test("trusted Power wheel steps, no-ops and detached-listener controls preserve owner and draft", async ({ page }, info) => {
    const origin = new URL(String(info.project.use.baseURL)).origin;
    const initialTheme = width === 1440 ? "dark" : "light";
        const model = SELECTED;
    const draft = `R24 retained draft ${width}`;
    const counts = [0, 0, 0, 0];
    const directory: unknown[] = [];
    const writes: unknown[] = [], api: unknown[] = [], external: unknown[] = [];
    const errors: string[] = [], consoleErrors: Array<{ text: string; url: string }> = [], states: Array<{ phase: string; value: unknown }> = [];
    const screenshots: string[] = [], cleanupErrors: string[] = [];
    let failure: string | null = null;
    let reader: Awaited<ReturnType<typeof createReader>> | null = null;
    let observer: Awaited<ReturnType<typeof observe>> | null = null;
    let inputEvents: unknown = null;
    let wheelEvents: unknown = null;
    let wheelObserver: JSHandle<WheelProbe> | null = null;
    let streamCleanup: unknown = null;
    let draftNode: Awaited<ReturnType<ReturnType<typeof page.locator>["elementHandle"]>> | null = null;
    const stream = await createFeedbackEventStream(origin);
    const record = async (phase: string) => {
      if (!reader) throw Error("No mounted reader");
      const value = await read(page, reader); states.push({ phase, value }); return value;
    };
    const shot = async (phase: string) => {
      const path = info.outputPath(phase + ".png"); await page.screenshot({ path, fullPage: true }); screenshots.push(path);
    };
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => { if (m.type() === "error") consoleErrors.push({ text: m.text(), url: m.location().url }); });
    try {
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
        if (path === "/api/session/api/events" && entry.method === "GET") { await route.continue({ url: stream.url }); return; }
        const index = paths.findIndex((suffix) => path.endsWith(suffix));
        if (index >= 0) {
          directory.push(entry);
          const valid = path === "/api/session" + paths[index] && entry.method === (index === 0 ? "POST" : "GET") &&
            (index === 0 ? isDeepStrictEqual(entry.body, { cursor: null, limit: 100 }) : entry.body === null);
          if (!valid) { writes.push(entry); await route.fulfill({ status: 409, json: { error: "R24 directory contract mismatch" } }); return; }
          counts[index]++; await route.fulfill({ json: index === 0 ? { data: catalog, nextCursor: null } : [] }); return;
        }
        if (!["GET", "HEAD"].includes(entry.method) && !reads.has(path) && !bookkeeping.has(path)) {
          writes.push(entry); await route.fulfill({ status: 409, json: { error: "R24 unclassified mutation rejected" } }); return;
        }
        await route.fallback();
      });
      await page.goto("/?mode=session&view=agent", { waitUntil: "domcontentloaded" });
      await page.locator(MAIN).locator(EDITOR).first().waitFor();
      await seedSessionUx(page, 2);
      const owners = await initialize(page, { model, effort: "medium" });
      reader = await createReader(page, owners); observer = await observe(page);
      await page.locator(MAIN).locator(EDITOR).first().fill(draft);
      draftNode = await page.locator(MAIN).locator(EDITOR).first().elementHandle();
      await expect.poll(() => counts).toEqual([1, 1, 1, 1]);
      await expect.poll(async () => (await record("readiness")).cache.loaded).toBe(true);
      await expect.poll(async () => (await record("stream-readiness")).eventStreamConnected).toBe(true);
      const baseline = await record("baseline");
      expect(baseline.currentThreadId).toBe("ux-0");
      expect(baseline.owner).toBe(owners.owner);
      expect(baseline.cache.models).toEqual(catalog); expect(baseline.cache.hasModelSnapshot).toBe(true);
      let scope = page.locator(MAIN);
      if (width === 390) {
        await scope.getByRole("button", { name: "附加文件", exact: true }).click();
        await page.getByRole("button", { name: "展开编辑", exact: true }).click();
        scope = page.getByRole("dialog", { name: "展开编辑", exact: true }); await scope.waitFor();
      }
      await scope.locator(".session-native-model-trigger").click();
      const menu = page.locator(".session-native-model-menu").filter({ visible: true });
      await menu.evaluate(async (node) => {
        await Promise.all(node.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => {})));
      });
      const powerRoot = menu.locator(".session-native-power-slider");
      const caption = menu.locator(".session-native-power-effort");
      await expect(powerRoot).toHaveCount(1); await expect(caption).toHaveText("中");
      // Register this passive observer on the same actual Root after the menu
      // has mounted and its entrance has finished. The product's native Root
      // listener runs first; stopPropagation does not skip same-node listeners.
      wheelObserver = await powerRoot.evaluateHandle((node) => {
        if (!(node instanceof HTMLElement)) throw Error("Expected the mounted ordinary Power HTMLElement");
        const events: WheelRecord[] = [];
        const byEvent = new WeakMap<WheelEvent, WheelRecord>();
        let overflow = false;
        const capture = (event: WheelEvent) => {
          if (events.length >= 32) { overflow = true; return; }
          const target = event.target instanceof Element ? event.target : null;
          const primitive: WheelRecord = {
            trusted: event.isTrusted, cancelable: event.cancelable, ctrl: event.ctrlKey,
            deltaX: event.deltaX, deltaY: event.deltaY, deltaMode: event.deltaMode, timeStamp: event.timeStamp,
            inPower: Boolean(target?.closest(".session-native-power-slider")),
            defaultPrevented: null, cancellationObservedAt: "unobserved",
          };
          events.push(primitive); byEvent.set(event, primitive);
        };
        const bubble = (event: WheelEvent) => {
          const primitive = byEvent.get(event);
          if (primitive) {
            primitive.defaultPrevented = event.defaultPrevented;
            primitive.cancellationObservedAt = "same-root-bubble";
          }
        };
        document.addEventListener("wheel", capture, { capture: true, passive: true });
        node.addEventListener("wheel", bubble, { passive: true });
        return {
          read: () => ({ events: events.map((event) => ({ ...event })), overflow }),
          dispose: () => {
            document.removeEventListener("wheel", capture, true);
            node.removeEventListener("wheel", bubble); events.length = 0;
          },
        };
      });
      const recent = () => page.evaluate(async () => {
        const path = "/src/session-mode/components/codex/composer/recentModelConfigs.ts";
        const url = performance.getEntriesByType("resource").findLast((entry) => new URL(entry.name).pathname === path)?.name;
        if (!url) throw Error("Mounted recent model reader missing");
        return structuredClone((await import(url)).recentModelConfigs());
      });
      const initialRecent = await recent();
      const wheel = async (deltaY: number, phase: string) => {
        await powerRoot.hover(); await page.mouse.wheel(0, deltaY);
        await expect.poll(async () => (await wheelObserver!.evaluate((value) => value.read())).events.length).toBe(wheelCount + 1);
        wheelCount++;
        const value = await record(phase); states.push({ phase: phase + "-recent", value: await recent() }); return value;
      };
      let wheelCount = 0;
      await wheel(-35, "wheel-increase"); await expect(caption).toHaveText("高");
      const high = await record("wheel-high-settled");
      expect(high.settings.reasoningEffort).toBe("high"); expect(high.entry.revision).toBe(baseline.entry.revision + 1);
      const highRecent = await recent();
      expect(highRecent).not.toEqual(initialRecent);
      const boundary = await wheel(-35, "wheel-high-boundary");
      expect(boundary.entry).toEqual(high.entry); expect(await recent()).toEqual(highRecent);
      const below = await wheel(10, "wheel-subthreshold");
      expect(below.entry).toEqual(high.entry); expect(await recent()).toEqual(highRecent);
      await wheel(35, "wheel-decrease"); await expect(caption).toHaveText("中");
      const medium = await record("wheel-medium-settled"), mediumRecent = await recent();
      expect(medium.settings.reasoningEffort).toBe("medium"); expect(medium.entry.revision).toBe(baseline.entry.revision + 2);
      await page.keyboard.down("Control");
      try { await wheel(-35, "wheel-control-bypass"); } finally { await page.keyboard.up("Control"); }
      const control = await record("wheel-control-settled");
      expect(control.entry).toEqual(medium.entry); expect(await recent()).toEqual(mediumRecent);
      await shot("power-wheel-medium");
      const powerEvents = await wheelObserver.evaluate((value) => value.read());
      expect(powerEvents.overflow).toBe(false); expect(powerEvents.events).toHaveLength(5);
      expect(powerEvents.events.every((event) => event.trusted && event.inPower && event.deltaMode === 0 && event.cancellationObservedAt === "same-root-bubble")).toBe(true);
      expect(powerEvents.events.slice(0, 4).every((event) => event.defaultPrevented && !event.ctrl)).toBe(true);
      expect(powerEvents.events[4].ctrl).toBe(true);
      // Parent scroll-lock may also cancel wheel. The Ctrl event's browser
      // default is recorded, not attributed to the slider or asserted as zoom.
      await page.keyboard.press("Escape"); await menu.waitFor({ state: "detached" });
      await expect(scope.locator(EDITOR).first()).toBeFocused();
      if (width === 390) {
        await page.getByRole("button", { name: "返回并保留草稿", exact: true }).click();
        await scope.waitFor({ state: "detached" }); scope = page.locator(MAIN);
      }
      await scope.locator(EDITOR).first().hover(); await page.mouse.wheel(0, -35);
      await expect.poll(async () => (await wheelObserver!.evaluate((value) => value.read())).events.length).toBe(6);
      const outsideEvents = await wheelObserver.evaluate((value) => value.read());
      expect(outsideEvents.overflow).toBe(false); expect(outsideEvents.events).toHaveLength(6);
      expect(outsideEvents.events[5]).toMatchObject({ trusted: true, inPower: false, ctrl: false, defaultPrevented: null, cancellationObservedAt: "unobserved" });
      expect(await recent()).toEqual(mediumRecent);
      const final = await record("final");
      expect(final.settings.model).toBe(model); expect(final.settings.reasoningEffort).toBe("medium");
      expect(final.entry.revision).toBe(baseline.entry.revision + 2);
      expect(final.cache.models).toEqual(catalog); expect(final.cache.hasModelSnapshot).toBe(true);
      expect(final.cacheIdentity).toEqual({ captured: true, array: true, models: true, efforts: true });
      expect(final.drafts).toEqual(baseline.drafts); expect(final.defaults).toEqual(baseline.defaults);
      expect(final.allThreads["ux-1"]).toEqual(baseline.allThreads["ux-1"]);
      expect(final.currentThreadId).toBe("ux-0"); expect(final.owner).toBe(owners.owner); expect(final.editorText).toBe(draft);
      expect(await page.locator(MAIN).locator(EDITOR).first().evaluate((node, old) => node === old, draftNode)).toBe(true);
      expect(counts).toEqual([1, 1, 1, 1]); expect(writes).toEqual([]); expect(external).toEqual([]); expect(errors).toEqual([]);
      // The existing API/WS fixture intentionally prevents Vite HMR connections.
      // Keep that exact dev-client message visible in the receipt; reject others.
      expect(consoleErrors.filter((e) => !(e.url === origin + "/@vite/client" && e.text.startsWith("[vite] failed to connect to websocket.")))).toEqual([]);
      const observed = await observer.evaluate((o) => o.read());
      expect(observed.overflow).toBe(false);
      expect(observed.events.filter((e) => e.type === "submit")).toEqual([]);
      expect(observed.events.filter((e) => e.type === "keydown" && e.key === "ArrowRight")).toHaveLength(0);
      expect(observed.events.filter((e) => e.type === "keydown" || e.type === "click").every((e) => e.trusted)).toBe(true);

    } catch (error) { failure = String(error); throw error; }
    finally {
      if (wheelObserver) { try { wheelEvents = await wheelObserver.evaluate((value) => value.read()); await wheelObserver.evaluate((value) => value.dispose()); await wheelObserver.dispose(); } catch (e) { cleanupErrors.push(String(e)); } }
      if (observer) { try { inputEvents = await observer.evaluate((o) => o.read()); await observer.evaluate((o) => o.dispose()); await observer.dispose(); } catch (e) { cleanupErrors.push(String(e)); } }
      if (reader) { try { await record("finally"); await reader.dispose(); } catch (e) { cleanupErrors.push(String(e)); } }
      try { await shot("finally"); } catch (e) { cleanupErrors.push(String(e)); }
      if (draftNode) { try { await draftNode.dispose(); } catch (e) { cleanupErrors.push(String(e)); } }
      try { await page.close(); } catch (e) { cleanupErrors.push(String(e)); }
      try {
        const closed = await stream.close(); streamCleanup = closed;
        if (!closed.closed || closed.listening || !closed.addressCleared || closed.activeResponses || closed.activeSockets || closed.serverErrorCount || closed.requestOverflow || closed.errors.length || closed.acceptedRequests < 1)
          cleanupErrors.push("Owned SSE did not satisfy the complete close contract");
      } catch (e) { cleanupErrors.push(String(e)); }
      if (cleanupErrors.length && !failure) failure = "Cleanup failure: " + cleanupErrors.join("; ");
      const path = info.outputPath("model-power-wheel.json");
      writeFileSync(path, JSON.stringify({ width, model, initialTheme, failure, states, counts, directory, api, writes, external, errors, consoleErrors, inputEvents, wheelEvents, screenshots, cleanupErrors, streamCleanup }, null, 2) + "\n");
      await info.attach("model-power-wheel", { path, contentType: "application/json" });
      if (cleanupErrors.length) throw new Error("Owned fixture cleanup failed: " + cleanupErrors.join("; "));
    }
  });
});
