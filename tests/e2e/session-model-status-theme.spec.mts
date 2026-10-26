import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { isDeepStrictEqual } from "node:util";
import { expect, test } from "@playwright/test";
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
  id: SELECTED, model: SELECTED, displayName: "R23 已知模型", description: "Isolated complete model", upgrade: null,
  upgradeInfo: null, availabilityNux: null, hidden: false, isDefault: true,
  supportedReasoningEfforts: ["low", "medium", "high"].map((reasoningEffort) => ({ reasoningEffort, description: reasoningEffort })),
  defaultReasoningEffort: "medium", inputModalities: ["text", "image"], supportsPersonality: false,
  additionalSpeedTiers: [], serviceTiers: [], defaultServiceTier: null,
}];

for (const width of [1440, 390]) test.describe(`R23 status and ordinary notice ${width}`, () => {
  test.use({ viewport: { width, height: width === 390 ? 844 : 900 }, hasTouch: width === 390, isMobile: width === 390 });
  test("natural Power change, preserved draft, same notice follows real theme toggle", async ({ page }, info) => {
    const origin = new URL(String(info.project.use.baseURL)).origin;
    const initialTheme = width === 1440 ? "dark" : "light";
    const nextTheme = initialTheme === "dark" ? "light" : "dark";
    const model = width === 1440 ? SELECTED : UNKNOWN;
    const modelLabel = width === 1440 ? "R23 已知模型" : "自定义";
    const draft = `R23 retained draft ${width}`;
    const counts = [0, 0, 0, 0];
    const directory: unknown[] = [], checks: Array<{ name: string; pass: boolean; value: unknown }> = [];
    const writes: unknown[] = [], api: unknown[] = [], external: unknown[] = [];
    const errors: string[] = [], consoleErrors: Array<{ text: string; url: string }> = [], states: Array<{ phase: string; value: unknown }> = [];
    const screenshots: string[] = [], cleanupErrors: string[] = [];
    let failure: string | null = null;
    let reader: Awaited<ReturnType<typeof createReader>> | null = null;
    let observer: Awaited<ReturnType<typeof observe>> | null = null;
    let inputEvents: unknown = null;
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
          if (!valid) { writes.push(entry); await route.fulfill({ status: 409, json: { error: "R23 directory contract mismatch" } }); return; }
          counts[index]++; await route.fulfill({ json: index === 0 ? { data: catalog, nextCursor: null } : [] }); return;
        }
        if (!["GET", "HEAD"].includes(entry.method) && !reads.has(path) && !bookkeeping.has(path)) {
          writes.push(entry); await route.fulfill({ status: 409, json: { error: "R23 unclassified mutation rejected" } }); return;
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
      const power = menu.locator("[data-reasoning-slider]");
      const caption = menu.locator(".session-native-power-effort");
      await expect(caption).toHaveText("中");
      const statusText = () => power.evaluate((node) => node.getAttribute("aria-describedby")?.split(/\s+/).map((id) => document.getElementById(id)?.textContent).join(" "));
      const initialStatus = await statusText();
      states.push({ phase: "power-medium-status", value: { caption: await caption.textContent(), status: initialStatus, model: await menu.locator(".session-native-power-model").textContent() } });
      checks.push({ name: "medium live status uses work-power label", pass: initialStatus?.includes(modelLabel + " 标准") === true, value: initialStatus });
      // Natural roving focus: do not script-focus or pointer-drag the Power thumb.
      for (let n = 0; n < 8 && !(await power.evaluate((node) => node === document.activeElement)); n++) await page.keyboard.press("ArrowDown");
      await expect(power).toBeFocused();
      await page.keyboard.press("ArrowRight");
      await expect(caption).toHaveText("高");
      const highStatus = await statusText();
      states.push({ phase: "power-high-status", value: { caption: await caption.textContent(), status: highStatus, model: await menu.locator(".session-native-power-model").textContent() } });
      checks.push({ name: "high live status uses work-power label", pass: highStatus?.includes(modelLabel + " 深度") === true, value: highStatus });
      const adjusted = await record("power-high");
      expect(adjusted.settings.model).toBe(model);
      expect(adjusted.settings.reasoningEffort).toBe("high");
      expect(adjusted.entry.revision).toBe(baseline.entry.revision + 1);
      await shot("power-status");
      await page.keyboard.press("Escape"); await menu.waitFor({ state: "detached" });
      await expect(scope.locator(EDITOR).first()).toBeFocused();
      if (width === 390) {
        await page.getByRole("button", { name: "返回并保留草稿", exact: true }).click();
        await scope.waitFor({ state: "detached" }); scope = page.locator(MAIN);
      }
      await scope.getByRole("button", { name: "附加文件", exact: true }).click();
      await page.getByRole("button", { name: "当前会话的更多操作", exact: true }).filter({ visible: true }).click();
      await page.getByRole("menuitem", { name: "降低推理强度", exact: true }).filter({ visible: true }).click();
      const toaster = page.locator('[data-sonner-toaster]:not(.codex-native-sonner-toaster)');
      const notice = toaster.locator("[data-sonner-toast]").filter({ hasText: "推理强度已设为中" });
      await expect(notice).toHaveCount(1); await expect(notice).toBeVisible();
      const noticeNode = await notice.elementHandle();
      const themeSample = async (phase: string) => {
        const value = await notice.evaluate((node) => {
          const t = node.closest("[data-sonner-toaster]")!, c = getComputedStyle(node), rect = node.getBoundingClientRect();
          const close = node.querySelector("[data-close-button]")!.getBoundingClientRect();
          return { now: performance.now(), sessionClass: document.querySelector(".session-mode")?.className,
            theme: t.getAttribute("data-sonner-theme"), x: t.getAttribute("data-x-position"), y: t.getAttribute("data-y-position"),
            background: c.backgroundColor, color: c.color, border: c.borderColor, font: c.font,
            transform: c.transform, mounted: node.getAttribute("data-mounted"),
            animations: node.getAnimations({ subtree: true }).map((animation) => ({ playState: animation.playState, currentTime: animation.currentTime, timing: animation.effect?.getComputedTiming() })),
            normalBackground: c.getPropertyValue("--normal-bg"), normalText: c.getPropertyValue("--normal-text"),
            rect: { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom },
            close: { x: close.x, y: close.y, right: close.right, bottom: close.bottom }, viewport: { width: innerWidth, height: innerHeight } };
        });
        states.push({ phase, value }); return value;
      };
      await expect(toaster).toHaveAttribute("data-sonner-theme", initialTheme);
      await themeSample("notice-entry-initial-theme");
      const entrance = await notice.evaluate(async (node) => {
        const animations = node.getAnimations({ subtree: true });
        return Promise.all(animations.map(async (animation) => {
          try { await animation.finished; return "finished"; }
          catch { return "cancelled"; }
        }));
      });
      states.push({ phase: "notice-entrance-animation-results", value: entrance });
      const initialNotice = await themeSample("notice-initial-theme-settled");
      expect(initialNotice.background).toBe(initialTheme === "dark" ? "rgb(0, 0, 0)" : "rgb(255, 255, 255)");
      // An ordinary top-right notice covers the header theme button. Use real
      // keyboard navigation while the same notice remains alive; no force/focus,
      // changed duration, repositioning or replacement notice is involved.
      await page.locator('.session-composer-menu[role="menu"]').waitFor({ state: "detached" });
      await page.keyboard.press("Escape");
      await expect(page.locator(MAIN).getByRole("button", { name: "附加文件", exact: true })).toHaveAttribute("aria-expanded", "false");
      await page.locator('.session-composer-menu[data-slot="popover-content"]').waitFor({ state: "detached" });
      const themeLabel = nextTheme === "light" ? "切换为浅色模式" : "切换为深色模式";
      let reachedTheme = false;
      for (let n = 0; n <= 64; n++) {
        if (await page.evaluate((label) => document.activeElement?.getAttribute("aria-label") === label, themeLabel)) { reachedTheme = true; break; }
        if (n < 64) await page.keyboard.press("Shift+Tab");
      }
      expect(reachedTheme).toBe(true);
      await record("theme-button-keyboard-focused");
      await page.keyboard.press("Enter");
      await expect(toaster).toHaveAttribute("data-sonner-theme", nextTheme);
      expect(await notice.evaluate((node, old) => node === old, noticeNode)).toBe(true);
      const updatedNotice = await themeSample("notice-changed-theme");
      expect(updatedNotice.background).toBe(nextTheme === "dark" ? "rgb(0, 0, 0)" : "rgb(255, 255, 255)");
      expect(updatedNotice.x).toBe("right"); expect(updatedNotice.y).toBe("top");
      expect(initialNotice.x).toBe(updatedNotice.x); expect(initialNotice.y).toBe(updatedNotice.y);
      for (const sample of [initialNotice, updatedNotice]) {
        expect(sample.rect.x).toBeGreaterThanOrEqual(0); expect(sample.rect.right).toBeLessThanOrEqual(width);
        expect(sample.rect.y).toBeGreaterThanOrEqual(0); expect(sample.rect.bottom).toBeLessThanOrEqual(sample.viewport.height);
        expect(sample.close.x).toBeGreaterThanOrEqual(0); expect(sample.close.right).toBeLessThanOrEqual(width);
        expect(sample.close.y).toBeGreaterThanOrEqual(0); expect(sample.close.bottom).toBeLessThanOrEqual(sample.viewport.height);
      }
      expect(await page.locator('.codex-native-sonner-toaster [data-sonner-toast]').filter({ hasText: "推理强度已设为中" }).count()).toBe(0);
      await shot("notice-changed-theme");
      await notice.locator("[data-close-button]").click(); await notice.waitFor({ state: "detached" });
      const final = await record("final");
      expect(final.settings.model).toBe(model); expect(final.settings.reasoningEffort).toBe("medium");
      expect(final.entry.revision).toBe(baseline.entry.revision + 2);
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
      expect(observed.events.filter((e) => e.type === "keydown" && e.key === "ArrowRight" && e.inModelMenu)).toHaveLength(1);
      expect(observed.events.filter((e) => e.type === "keydown" || e.type === "click").every((e) => e.trusted)).toBe(true);
      expect(checks.filter((c) => !c.pass)).toEqual([]);
      await noticeNode?.dispose();
    } catch (error) { failure = String(error); throw error; }
    finally {
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
      const path = info.outputPath("model-status-theme.json");
      writeFileSync(path, JSON.stringify({ width, model, initialTheme, nextTheme, failure, checks, states, counts, directory, api, writes, external, errors, consoleErrors, inputEvents, screenshots, cleanupErrors, streamCleanup }, null, 2) + "\n");
      await info.attach("model-status-theme", { path, contentType: "application/json" });
      if (cleanupErrors.length) throw new Error("Owned fixture cleanup failed: " + cleanupErrors.join("; "));
    }
  });
});
