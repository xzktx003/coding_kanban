import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { expect, test, type JSHandle, type Locator, type Page } from "@playwright/test";
import type { Model } from "../../apps/web/src/session-mode/bindings/v2";
import { createFeedbackEventStream } from "./fixtures/session-feedback-event-stream.mts";
import { CWD, EDITOR, MAIN, initialize, createReader, observe, read } from "./fixtures/session-model-command-page.mts";

// Imports above are the intended formal tests/e2e location, not this ignored copy.
const { installSessionUxFixture, seedSessionUx } = createRequire(import.meta.url)("./session-ux-fixture") as typeof import("./session-ux-fixture");
const directoryPaths = ["/api/codex/model/list", "/api/codex/provider/list", "/api/codex/model/list-other", "/api/codex/provider/presets"];
const readPosts = new Set([
  "/api/session/api/codex/account/get", "/api/session/api/codex/config/read", "/api/session/api/codex/thread/list",
  "/api/session/api/bots/list", "/api/session/api/codex/plugin/installed", "/api/session/api/codex/skills/list",
  "/api/session/api/codex/thread/goal/get", "/api/session/api/git/branch-info", "/api/session/api/filesystem/read-directory",
  "/api/session/api/git/status", "/api/session/api/git/diff-stats", "/api/session/api/git/file-diff-meta",
  "/api/session/subagents/snapshot", "/api/session/api/codex/thread/turns/list", "/api/session/git/hunks/read",
  "/api/session/api/codex/thread/access", "/api/session/api/codex/thread/read", "/api/session/api/codex/thread/metadata",
]);
const bookkeepingPaths = new Set(["/api/session/tabs", "/api/session/projects", "/api/session/api/telemetry/active", "/api/session/api/filesystem/watch", "/api/session/api/filesystem/unwatch"]);
const MODEL = "r26-ordinary-second";
const catalog: Model[] = ["r26-ordinary-first", MODEL, "r26-ordinary-third"].map((model, i): Model => ({
  id: model, model, displayName: `R26 ordinary ${i + 1}`, description: "Synthetic ordinary Code model",
  hidden: false, isDefault: i === 0, upgrade: null, upgradeInfo: null, availabilityNux: null,
  supportedReasoningEfforts: ["low", "medium", "high"].map((reasoningEffort) => ({ reasoningEffort, description: reasoningEffort })),
  defaultReasoningEffort: "medium", inputModalities: ["text", "image"], supportsPersonality: false,
  additionalSpeedTiers: [], serviceTiers: [], defaultServiceTier: null,
}));
// Ordinary Permissions.Ht + zh-CN fullAccessConfirm source; no new original GUI run.
const CAPABILITIES = [
  { title: "文件和文件夹", description: "读取、创建、修改、上传或删除此计算机上任意位置的文件" },
  { title: "终端命令", description: "运行命令、安装软件和更改系统设置" },
  { title: "互联网和已连接的应用", description: "访问网站、发送数据并使用已启用的插件" },
];
const EXPECTED_CONTENT = {
  title: "要开启完整访问权限吗？",
  description: "Codex 将能够在未经您许可的情况下，在这台计算机上的任何位置运行命令、使用互联网，以及创建和编辑文件。这包括但不限于：",
  capabilities: CAPABILITIES, risk: true, canTurnOff: true,
  learnMore: "了解更多", learnMoreType: "button", confirm: "确认", confirmType: "submit", cancel: "取消", cancelType: "button", closeButtons: 0,
};
const inputs = [
  "apps/web/src/session-mode/components/codex/composer/AccessModePopover.tsx",
  "apps/web/src/session-mode/components/common/useSessionActionConfirmation.tsx",
  "apps/web/src/session-mode/components/ui/ConfirmDialog.tsx",
  "apps/web/src/session-mode/components/ui/dialog.tsx",
  "apps/web/src/session-mode/components/ui/dropdown-menu.tsx",
  "apps/web/src/session-mode/components/ui/button.tsx",
  "apps/web/src/session-mode/browser-opener.ts",
  "apps/web/src/session-mode/components/codex/composer/Composer.tsx",
  "apps/web/src/session-mode/components/codex/composer/ComposerMenu.tsx",
  "apps/web/src/session-mode/components/codex/composer/ComposerToolbarContext.tsx",
  "apps/web/src/session-mode/components/codex/composer/NativeComposerIcon.tsx",
  "apps/web/src/session-mode/components/codex/composer/v2/ComposerSheet.tsx",
  "apps/web/src/session-mode/components/codex/composer/v2/useComposerSheetHistory.ts",
  "apps/web/src/session-mode/components/codex/hooks/useModels.ts",
  "apps/web/src/session-mode/hooks/useThreadModelSettings.ts",
  "apps/web/src/session-mode/stores/useThreadModelStore.ts",
  "apps/web/src/session-mode/stores/useSessionDraftStore.ts",
  "apps/web/src/session-mode/components/codex/stores/useConfigStore.ts",
  "apps/web/src/session-mode/components/codex/stores/useCodexStore.ts",
  "apps/web/src/session-mode/session-dom.ts",
  "apps/web/src/session-mode/session-theme.css",
  "tests/e2e/session-ux-fixture.ts",
  "tests/e2e/fixtures/session-model-command-page.mts",
  "tests/e2e/fixtures/session-feedback-event-stream.mts",
];
const optionalInputs = [
  "apps/web/src/session-mode/components/codex/composer/NativeFullAccessConfirmation.tsx",
  "apps/web/src/session-mode/components/codex/composer/native-full-access-confirmation.css",
];
const hashInputs = () => [
  ...[...inputs, relative(process.cwd(), fileURLToPath(import.meta.url))].map((path) => ({ path, sha256: createHash("sha256").update(readFileSync(path)).digest("hex") })),
  ...optionalInputs.map((path) => ({ path, optional: true, present: existsSync(path), sha256: existsSync(path) ? createHash("sha256").update(readFileSync(path)).digest("hex") : null })),
];
const settle = (page: Page) => page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
const permissionDialogs = (page: Page) => page.getByRole("dialog", { name: /^(开启完全访问权限？|要开启完整访问权限吗？)$/ });
type State = { value: any; defaultState: any };
function assertProtected(state: State, baseline: State, owner: string, draft: string) {
  const { value, defaultState } = state, original = baseline.value;
  expect(value.currentThreadId).toBe("ux-0"); expect(value.owner).toBe(owner); expect(value.editorText).toBe(draft);
  expect(value.settings).toEqual(original.settings); expect(value.entry).toEqual(original.entry);
  expect(value.allThreads).toEqual(original.allThreads); expect(value.allThreads["ux-1"].revision).toBe(7);
  expect(value.defaults).toEqual(original.defaults); expect(defaultState).toEqual(baseline.defaultState); expect(value.drafts).toEqual(original.drafts);
  expect(value.acp).toEqual(original.acp); expect(value.sideChat).toEqual(original.sideChat);
  expect(value.activeInSide).toBe(false); expect(value.acp.active).toBe(false);
  expect(value.cache).toEqual(original.cache); expect(value.cache.models).toEqual(catalog);
  expect(value.cacheIdentity).toEqual({ captured: true, array: true, models: true, efforts: true });
}
async function projectDialog(dialog: Locator) {
  return dialog.evaluate((node, capabilities) => {
    const leafText = (text: string) => [...node.querySelectorAll("*")].find((child) => child.childElementCount === 0 && child.textContent === text)?.textContent ?? null;
    const button = (text: string) => [...node.querySelectorAll("button")].find((child) => child.textContent?.trim() === text);
    return {
      title: node.querySelector('[data-slot="dialog-title"]')?.textContent ?? null,
      description: node.querySelector('[data-slot="dialog-description"]')?.textContent ?? null,
      capabilities: capabilities.map(({ title, description }) => ({ title: leafText(title), description: leafText(description) })),
      risk: node.textContent?.includes("这会带来敏感数据丢失或泄露、提示注入等风险。") ?? false,
      canTurnOff: node.textContent?.includes("你可以将其关闭。") ?? false,
      learnMore: button("了解更多")?.textContent?.trim() ?? null, learnMoreType: button("了解更多")?.getAttribute("type") ?? null,
      confirm: button("确认")?.textContent?.trim() ?? null, confirmType: button("确认")?.getAttribute("type") ?? null,
      cancel: button("取消")?.textContent?.trim() ?? null, cancelType: button("取消")?.getAttribute("type") ?? null,
      closeButtons: node.querySelectorAll('[data-slot="dialog-close"]').length,
    };
  }, CAPABILITIES);
}
async function inspectDialog(dialog: Locator) {
  return dialog.evaluate((node) => {
    const rect = node.getBoundingClientRect(), css = getComputedStyle(node), active = document.activeElement;
    return { now: performance.now(), role: node.getAttribute("role"), className: node.className,
      rect: { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height },
      color: css.color, background: css.backgroundColor, font: css.font, borderRadius: css.borderRadius,
      cornerShape: css.getPropertyValue("corner-shape"), transform: css.transform,
      active: active ? { tag: active.tagName, role: active.getAttribute("role"), label: active.getAttribute("aria-label"), text: active.textContent?.trim().slice(0, 160), inDialog: node.contains(active) } : null,
      buttons: [...node.querySelectorAll("button")].map((button) => ({ text: button.textContent?.trim(), type: button.getAttribute("type"), disabled: button.disabled })),
      svg: [...node.querySelectorAll("svg")].map((svg) => ({ viewBox: svg.getAttribute("viewBox"), paths: [...svg.querySelectorAll("path")].map((path) => path.getAttribute("d")) })),
      animations: node.getAnimations({ subtree: true }).map((animation) => ({ state: animation.playState, timing: animation.effect?.getComputedTiming() })),
      sessionClass: document.querySelector(".session-mode")?.className, viewport: { width: innerWidth, height: innerHeight },
      childMetrics: (() => {
        const properties = ["display", "box-sizing", "position", "width", "height", "min-height", "max-height", "font", "font-family", "font-size", "font-weight", "line-height", "letter-spacing", "font-synthesis", "font-synthesis-weight", "font-synthesis-style", "text-rendering", "font-kerning", "font-feature-settings", "font-variation-settings", "margin", "margin-top", "margin-bottom", "padding", "padding-top", "padding-bottom", "gap", "row-gap", "column-gap", "border-width", "border-color", "border-radius", "border-top-left-radius", "border-top-right-radius", "border-bottom-right-radius", "border-bottom-left-radius", "corner-shape", "color", "background-color", "box-shadow", "backdrop-filter", "outline-style", "outline-width", "outline-offset", "outline-color", "text-wrap", "white-space", "overflow", "transform", "opacity"];
        const metric = (target: Element | null) => {
          if (!target) return null;
          const box = target.getBoundingClientRect(), style = getComputedStyle(target);
          return { tag: target.tagName, className: target.getAttribute("class"), text: target.textContent?.trim().slice(0, 320) ?? null,
            rect: { x: box.x, y: box.y, right: box.right, bottom: box.bottom, width: box.width, height: box.height },
            relativeRect: { x: box.x - rect.x, y: box.y - rect.y, right: box.right - rect.x, bottom: box.bottom - rect.y },
            clientWidth: target.clientWidth, clientHeight: target.clientHeight, scrollWidth: target.scrollWidth, scrollHeight: target.scrollHeight,
            offsetWidth: target instanceof HTMLElement ? target.offsetWidth : null, offsetHeight: target instanceof HTMLElement ? target.offsetHeight : null,
            type: target.getAttribute("type"), disabled: target.hasAttribute("disabled"), isActualActive: target === active, focusVisible: target.matches(":focus-visible"),
            style: Object.fromEntries(properties.map((key) => [key, style.getPropertyValue(key)])) };
        };
        const icon = (target: Element | null) => target ? { metric: metric(target), viewBox: target.getAttribute("viewBox"),
          shapes: [...target.querySelectorAll("path,circle")].map((shape) => { const style = getComputedStyle(shape); return {
            tag: shape.tagName, d: shape.getAttribute("d"), cx: shape.getAttribute("cx"), cy: shape.getAttribute("cy"), r: shape.getAttribute("r"),
            fill: shape.getAttribute("fill"), computedFill: style.fill, stroke: shape.getAttribute("stroke"), computedStroke: style.stroke, strokeWidth: style.strokeWidth,
          }; }) } : null;
        const form = node.querySelector("form");
        const sections = form ? [...form.children].filter((child) => child.classList.contains("full-access-section")) : [];
        const rows = [...node.querySelectorAll(".full-access-capability")];
        const tokenNames = ["--vscode-editor-background", "--vscode-foreground", "--vscode-descriptionForeground", "--vscode-dropdown-background", "--vscode-charts-red", "--vscode-textLink-foreground", "--vscode-font-family", "--vscode-font-size", "--vscode-font-weight", "--codex-text", "--codex-muted", "--codex-border", "--foreground", "--popover", "--destructive", "--primary", "--ring", "--full-access-terminal-background", "--full-access-internet-background", "--full-access-internet-foreground"];
        const tokens = (target: Element | null) => target ? Object.fromEntries(tokenNames.map((key) => [key, getComputedStyle(target).getPropertyValue(key)])) : null;
        return { root: metric(node), form: metric(form), sectionCount: sections.length,
          sections: Array.from({ length: 5 }, (_, index) => metric(sections[index] ?? null)),
          title: metric(node.querySelector('[data-slot="dialog-title"]')), titleIcon: icon(node.querySelector(".full-access-title-icon")),
          description: metric(node.querySelector('[data-slot="dialog-description"]')), capabilities: metric(node.querySelector(".full-access-capabilities")), rowCount: rows.length,
          rows: Array.from({ length: 3 }, (_, index) => { const row = rows[index]; return row ? {
            row: metric(row), copy: metric(row.querySelector(".full-access-capability-copy")), icon: icon(row.querySelector("svg")),
            title: metric(row.querySelector(".full-access-capability-title")), description: metric(row.querySelector(".full-access-capability-description")),
          } : null; }),
          risk: metric(node.querySelector(".full-access-risk")), learnMore: metric(node.querySelector(".full-access-learn-more")),
          footer: metric(node.querySelector(".full-access-footer")), cancel: metric(node.querySelector(".full-access-cancel")), confirm: metric(node.querySelector(".full-access-confirm")), confirmIcon: icon(node.querySelector(".full-access-confirm-icon")),
          buttons: [...node.querySelectorAll("button")].map((button) => metric(button)),
          overlays: [...document.querySelectorAll('.session-mode [data-slot="dialog-overlay"]')].map((overlay) => metric(overlay)),
          tokens: { document: tokens(document.documentElement), session: tokens(document.querySelector(".session-mode")), dialog: tokens(node) },
          environment: { cornerShapeSupported: CSS.supports("corner-shape", "superellipse(1.5)"), devicePixelRatio, fontLoadingStatus: document.fonts?.status ?? null },
        };
      })(),
    };
  });
}

for (const width of [1440, 390]) test.describe(`R26 ordinary Full Access ${width}`, () => {
  test.use({ viewport: { width, height: width === 390 ? 844 : 900 }, hasTouch: width === 390, isMobile: width === 390 });
  for (const surface of ["main", "expanded"] as const) for (const theme of ["dark", "light"] as const)
    test(`${surface} ${theme}: content, Cancel, real keyboard reopen and Escape are inert`, async ({ page }, info) => {
      test.setTimeout(90_000);
      const draft = `R26 unsent ${width} ${surface} ${theme}`;
      const defaultDraft = `R26 untouched new-draft ${width} ${surface} ${theme}`;
      const counts = [0, 0, 0, 0];
      const directory: unknown[] = [], api: unknown[] = [], writes: unknown[] = [], bookkeeping: unknown[] = [], external: unknown[] = [];
      const errors: string[] = [], consoleErrors: Array<{ text: string; url: string }> = [], cleanupErrors: string[] = [];
      const states: Array<{ phase: string } & State> = [], dialogs: Array<{ phase: string; value: unknown }> = [], editorIdentity: unknown[] = [], actions: unknown[] = [], screenshots: string[] = [];
      const readiness = { timeoutMs: 5_000, ringCapacity: 64, reads: 0, discarded: 0, matched: false, samples: [] as Array<{ read: number; now: number; currentThreadId: string | null; owner: string | null }> };
      let expectedOwner: string | null = null;
      let origin = "", phase = "setup", failure: string | null = null, projected: Awaited<ReturnType<typeof projectDialog>> | null = null;
      let reader: Awaited<ReturnType<typeof createReader>> | null = null, observer: Awaited<ReturnType<typeof observe>> | null = null;
      let defaultsReader: JSHandle<() => any> | null = null;
      let stream: Awaited<ReturnType<typeof createFeedbackEventStream>> | null = null;
      let mainNode: Awaited<ReturnType<Locator["elementHandle"]>> = null, expandedNode: Awaited<ReturnType<Locator["elementHandle"]>> = null;
      let inputEvents: any = null, streamBeforeClose: unknown = null, streamCleanup: unknown = null;
      let sourceBefore: ReturnType<typeof hashInputs> | null = null, sourceAfter: ReturnType<typeof hashInputs> | null = null;
      const record = async (name: string): Promise<State> => {
        if (!reader || !defaultsReader) throw Error("Mounted read-only readers unavailable");
        const value = await read(page, reader), defaultState = await defaultsReader.evaluate((get: any) => get());
        const snapshot = { value, defaultState }; states.push({ phase: name, ...snapshot }); return snapshot;
      };
      const shot = async (name: string) => { const path = info.outputPath(name + ".png"); await page.screenshot({ path, fullPage: true }); screenshots.push(path); };
      const sheet = page.locator(".session-mode .session-composer-sheet.is-full");
      let scope = page.locator(MAIN);
      const assertEditors = async (name: string, expandedConnected: boolean) => {
        const actual = { phase: name,
          mainSame: await page.locator(MAIN).locator(EDITOR).first().evaluate((node, old) => node === old, mainNode),
          mainOwner: await page.locator(MAIN).getAttribute("data-draft-owner"),
          expandedSame: expandedConnected ? await sheet.locator(EDITOR).first().evaluate((node, old) => node === old, expandedNode) : null,
          expandedText: expandedConnected ? await sheet.locator(EDITOR).first().evaluate((node) => node instanceof HTMLTextAreaElement ? node.value : node.textContent) : null };
        editorIdentity.push(actual); expect(actual.mainSame).toBe(true); expect(actual.mainOwner).toBe(expectedOwner);
        if (expandedConnected) { expect(actual.expandedSame).toBe(true); expect(actual.expandedText).toBe(draft); }
      };
      page.on("pageerror", (error) => errors.push(error.stack ?? String(error)));
      page.on("console", (message) => { if (message.type() === "error") consoleErrors.push({ text: message.text(), url: message.location().url }); });
      try {
        sourceBefore = hashInputs(); origin = new URL(String(info.project.use.baseURL)).origin;
        if (["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname)) throw Error("R26 requires an explicit owned LAN frontend origin");
        stream = await createFeedbackEventStream(origin);
        await page.addInitScript((nextTheme) => localStorage.setItem("kanban.session.theme-storage", JSON.stringify({ state: { theme: nextTheme }, version: 0 })), theme);
        await page.route("**/*", async (route) => {
          const request = route.request(), url = new URL(request.url());
          if (url.origin !== origin || !["GET", "HEAD"].includes(request.method())) {
            external.push({ method: request.method(), origin: url.origin, path: url.pathname }); await route.abort("blockedbyclient");
          } else await route.continue();
        });
        await installSessionUxFixture(page, 2);
        await page.route("**/api/**", async (route) => {
          const request = route.request(), path = new URL(request.url()).pathname;
          const entry = { method: request.method(), path, body: request.method() === "POST" ? request.postDataJSON() : null }; api.push(entry);
          if (path === "/api/session/api/events" && entry.method === "GET") {
            if (!stream) throw Error("Owned SSE unavailable"); await route.continue({ url: stream.url }); return;
          }
          const index = directoryPaths.findIndex((suffix) => path.endsWith(suffix));
          if (index >= 0) {
            directory.push(entry);
            const valid = path === "/api/session" + directoryPaths[index] && entry.method === (index === 0 ? "POST" : "GET") &&
              (index === 0 ? isDeepStrictEqual(entry.body, { cursor: null, limit: 100 }) : entry.body === null);
            if (!valid) { writes.push(entry); await route.fulfill({ status: 409, json: { error: "R26 read directory contract mismatch" } }); return; }
            counts[index]++; await route.fulfill({ json: index === 0 ? { data: catalog, nextCursor: null } : [] }); return;
          }
          if (bookkeepingPaths.has(path)) bookkeeping.push(entry);
          if (!["GET", "HEAD"].includes(entry.method) && !readPosts.has(path) && !bookkeepingPaths.has(path)) {
            writes.push(entry); await route.fulfill({ status: 409, json: { error: "R26 business mutation refused" } }); return;
          }
          await route.fallback();
        });
        await page.goto("/?mode=session&view=agent", { waitUntil: "domcontentloaded" });
        await page.locator(MAIN).locator(EDITOR).first().waitFor();
        // Initial fixture hydration only, completed before admission/user input.
        await seedSessionUx(page, 2);
        const initialized = await initialize(page, { model: MODEL, effort: "medium" });
        const defaultOwner = await page.evaluate(async ({ cwd, text }) => {
          const path = "/src/session-mode/stores/useSessionDraftStore.ts";
          const url = performance.getEntriesByType("resource").findLast((entry) => new URL(entry.name).pathname === path)?.name;
          if (!url) throw Error("R26 initial default-draft module missing");
          const drafts = await import(url);
          const owner = drafts.sessionDraftKey("codex", null, cwd) as string;
          drafts.useSessionDraftStore.getState().setText(owner, text);
          return owner;
        }, { cwd: CWD, text: defaultDraft });
        const owners = { ...initialized, defaultOwner }; expectedOwner = owners.owner;
        // End of initial hydration: no direct store setter/load below this point.
        reader = await createReader(page, owners); observer = await observe(page);
        await expect.poll(async () => {
          const value = await read(page, reader!); readiness.reads++;
          if (readiness.samples.length === readiness.ringCapacity) { readiness.samples.shift(); readiness.discarded++; }
          readiness.samples.push({ read: readiness.reads, now: value.now, currentThreadId: value.currentThreadId, owner: value.owner });
          return { currentThreadId: value.currentThreadId, owner: value.owner };
        }, { timeout: readiness.timeoutMs, intervals: [25, 50, 100], message: "R26 selected thread and actual main owner must agree before input" })
          .toEqual({ currentThreadId: "ux-0", owner: owners.owner }); readiness.matched = true;
        const mounted = await read(page, reader);
        const configURL = mounted.moduleURLs[0];
        if (new URL(configURL).pathname !== "/src/session-mode/components/codex/stores/useConfigStore.ts") throw Error("R26 mounted default reader identity mismatch");
        // Read-only getter of the SAME already-mounted module; includes fixture
        // revision/pending metadata omitted from the shared settings projection.
        defaultsReader = await page.evaluateHandle(async (url) => {
          const { useConfigStore } = await import(url);
          const fields = ["model", "modelProvider", "providerModels", "reasoningEffort", "serviceTier", "sandbox", "sandboxPolicy", "approvalPolicy", "approvalsReviewer", "autoReviewCapability", "webSearchRequest", "collaborationMode", "personality"];
          return () => {
            const state = useConfigStore.getState();
            return JSON.parse(JSON.stringify({
              settings: Object.fromEntries(fields.map((key) => [key, state[key] ?? null])),
              metadata: Object.fromEntries(["revision", "pending", "pendingFields"].map((key) => [key, {
                present: Object.hasOwn(state, key), value: Object.hasOwn(state, key) ? state[key] ?? null : null,
              }])),
            }));
          };
        }, configURL);
        await page.locator(MAIN).locator(EDITOR).first().fill(draft);
        mainNode = await page.locator(MAIN).locator(EDITOR).first().elementHandle();
        await expect.poll(() => [...counts]).toEqual([1, 1, 1, 1]);
        await expect.poll(async () => (await read(page, reader!)).cache.loaded).toBe(true);
        await expect.poll(async () => (await read(page, reader!)).eventStreamConnected).toBe(true); await settle(page);
        const baseline = await record("baseline");
        expect(baseline.value.settings).toMatchObject({ model: MODEL, reasoningEffort: "medium", sandbox: "workspace-write", approvalPolicy: "on-request", approvalsReviewer: "user", collaborationMode: "default" });
        expect(baseline.value.entry).toMatchObject({ revision: 4, pending: false, pendingFields: [] });
        expect(baseline.value.drafts.defaultOwner).toMatchObject({ text: defaultDraft });
        expect(baseline.value.drafts.otherOwner).toMatchObject({ text: "R22 untouched B draft" });
        expect(baseline.defaultState.settings).toMatchObject({ model: "r22-global-default", reasoningEffort: "medium" });
        // Preserve actual metadata presence/value, including unknown/null. Do
        // not manufacture a global or native version contract from a fixture.
        expect(baseline.value.cache).toMatchObject({ loaded: true, loading: false, error: null, modelStatus: "success", hasModelSnapshot: true });
        assertProtected(baseline, baseline, owners.owner, draft);
        await expect(page.locator(".session-mode")).toHaveClass(theme === "dark" ? /\bdark\b/ : /^(?!.*\bdark\b)/);
        if (surface === "expanded") {
          await scope.getByRole("button", { name: "附加文件", exact: true }).click();
          await page.getByRole("button", { name: "展开编辑", exact: true }).click();
          await page.getByRole("dialog", { name: "展开编辑", exact: true }).waitFor();
          // Distinguish the attachment Popover/menu from the still-open Sheet.
          await page.locator('.session-composer-menu[role="menu"]').waitFor({ state: "detached" });
          await page.locator('.session-composer-menu[data-slot="popover-content"]').waitFor({ state: "detached" });
          scope = sheet; await expect(scope).toHaveCount(1); await expect(scope).toBeVisible();
          await expect.poll(() => scope.locator(EDITOR).first().evaluate((node) => node instanceof HTMLTextAreaElement ? node.value : node.textContent)).toBe(draft);
          expandedNode = await scope.locator(EDITOR).first().elementHandle();
        }
        const trigger = scope.locator(".session-access-trigger");
        await expect(trigger).toHaveCount(1); await expect(trigger).toBeVisible(); await expect(trigger).toBeEnabled();
        phase = "pointer-permission-open";
        await trigger.click(); actions.push({ input: "permission-trigger.click", surface });
        let menu = page.locator('.session-native-permission-menu[role="menu"]');
        await expect(menu).toHaveCount(1); await expect(menu).toBeVisible();
        const fullRow = menu.getByRole("menuitemradio", { name: /完全访问权限/ });
        await expect(fullRow).toBeEnabled(); await fullRow.click(); actions.push({ input: "full-row.click" });
        let dialog = permissionDialogs(page); await expect(dialog).toHaveCount(1); await expect(dialog).toBeVisible();
        dialogs.push({ phase: "first-dialog-dom", value: await inspectDialog(dialog) });
        assertProtected(await record("first-dialog-dom"), baseline, owners.owner, draft);
        await menu.waitFor({ state: "detached" }); await settle(page);
        dialogs.push({ phase: "first-dialog-two-raf", value: await inspectDialog(dialog) });
        dialogs.push({ phase: "first-dialog-animation-results", value: await dialog.evaluate((node) => Promise.all(node.getAnimations({ subtree: true }).map(async (animation) => { try { await animation.finished; return "finished"; } catch { return "cancelled"; } }))) });
        projected = await projectDialog(dialog); dialogs.push({ phase: "first-dialog-settled", value: await inspectDialog(dialog) });
        await assertEditors("first-dialog-settled", surface === "expanded"); await shot("first-dialog-settled");
        phase = "cancel"; await dialog.getByRole("button", { name: "取消", exact: true }).click(); actions.push({ input: "cancel.click" });
        await dialog.waitFor({ state: "detached" });
        assertProtected(await record("after-cancel"), baseline, owners.owner, draft); await assertEditors("after-cancel", surface === "expanded");
        if (surface === "expanded") await expect(sheet).toHaveCount(1);
        await shot("after-cancel");
        phase = "keyboard-reopen";
        // Normal pointer activation of the captured editor, followed by real
        // Tab/Arrow/Enter. Never locator.focus(), handler/store dispatch or force.
        await scope.locator(EDITOR).first().click();
        let reachedTrigger = false, tabs = 0;
        for (; tabs <= 20; tabs++) {
          if (await trigger.evaluate((node) => node === document.activeElement)) { reachedTrigger = true; break; }
          if (tabs < 20) await page.keyboard.press("Tab");
        }
        actions.push({ input: "real Tab from owner editor", tabs, reachedTrigger }); expect(reachedTrigger).toBe(true);
        await page.keyboard.press("ArrowDown"); menu = page.locator('.session-native-permission-menu[role="menu"]');
        await expect(menu).toHaveCount(1); await expect(menu).toBeVisible(); await settle(page); await page.keyboard.press("Home");
        const enabledRadios = menu.locator('[role="menuitemradio"]:not([disabled]):not([data-disabled]):not([aria-disabled="true"])');
        await expect(enabledRadios.first()).toBeFocused();
        const fullKeyboardRow = menu.getByRole("menuitemradio", { name: /完全访问权限/ });
        const bound = await menu.getByRole("menuitemradio").count() + 1;
        let reachedRow = false, arrows = 0;
        for (; arrows <= bound; arrows++) {
          if (await fullKeyboardRow.evaluate((node) => node === document.activeElement)) { reachedRow = true; break; }
          if (arrows < bound) {
            // Radix roving focus commits in a queued task. Observe this one
            // expected step before deciding whether another key is needed.
            const next = await menu.evaluate((node) => {
              const items = [...node.querySelectorAll('[role^="menuitem"]')].filter((item) =>
                !item.hasAttribute("disabled") && !item.hasAttribute("data-disabled") && item.getAttribute("aria-disabled") !== "true");
              const radios = items.filter((item) => item.getAttribute("role") === "menuitemradio");
              const active = document.activeElement;
              const radioIndex = radios.indexOf(active as Element);
              const nextRadio = radios[radioIndex + 1];
              return { radioIndex, hasNext: Boolean(nextRadio), nextIsContiguousRadio: items[items.indexOf(active as Element) + 1] === nextRadio };
            });
            expect(next.radioIndex).toBeGreaterThanOrEqual(0);
            expect(next.hasNext).toBe(true); expect(next.nextIsContiguousRadio).toBe(true);
            const expectedNextRow = enabledRadios.nth(next.radioIndex + 1);
            await page.keyboard.press("ArrowDown");
            await expect(expectedNextRow).toBeFocused();
          }
        }
        actions.push({ input: "real Home/ArrowDown to Full Access", arrows, bound, reachedRow }); expect(reachedRow).toBe(true);
        await page.keyboard.press("Enter"); actions.push({ input: "full-row Enter" });
        dialog = permissionDialogs(page); await expect(dialog).toHaveCount(1); await expect(dialog).toBeVisible();
        dialogs.push({ phase: "reopened-dialog-dom", value: await inspectDialog(dialog) });
        await menu.waitFor({ state: "detached" }); await settle(page);
        assertProtected(await record("reopened-dialog"), baseline, owners.owner, draft); await assertEditors("reopened-dialog", surface === "expanded");
        await shot("reopened-dialog");
        phase = "escape"; await page.keyboard.press("Escape"); actions.push({ input: "dialog Escape" });
        await dialog.waitFor({ state: "detached" });
        assertProtected(await record("after-escape"), baseline, owners.owner, draft); await assertEditors("after-escape", surface === "expanded");
        if (surface === "expanded") {
          await expect(sheet).toHaveCount(1);
          await sheet.getByRole("button", { name: "返回并保留草稿", exact: true }).click(); actions.push({ input: "expanded Back" });
          await sheet.waitFor({ state: "detached" }); scope = page.locator(MAIN);
          await expect(scope.locator(EDITOR).first()).toBeFocused();
        }
        phase = "final"; assertProtected(await record("final"), baseline, owners.owner, draft); await assertEditors("final", false);
        await expect(permissionDialogs(page)).toHaveCount(0); await expect(page.locator('.session-native-permission-menu[role="menu"]')).toHaveCount(0); await expect(sheet).toHaveCount(0);
        expect(counts).toEqual([1, 1, 1, 1]); expect(writes).toEqual([]); expect(external).toEqual([]); expect(errors).toEqual([]);
        expect(consoleErrors.filter((entry) => !(entry.url === origin + "/@vite/client" && entry.text.startsWith("[vite] failed to connect to websocket.")))).toEqual([]);
        const observed = await observer.evaluate((value) => value.read());
        expect(observed.overflow).toBe(false); expect(observed.events.filter((event) => event.type === "submit")).toEqual([]);
        expect(observed.events.filter((event) => event.type === "keydown" || event.type === "pointerdown").every((event) => event.trusted)).toBe(true);
        expect(observed.events.filter((event) => event.type === "pointerdown" && event.role === "menuitemradio" && typeof event.text === "string" && event.text.startsWith("完全访问权限"))).toHaveLength(1);
        expect(observed.events.filter((event) => event.type === "keydown" && event.key === "Enter" && event.role === "menuitemradio" && typeof event.text === "string" && event.text.startsWith("完全访问权限"))).toHaveLength(1);
        expect(observed.events.filter((event) => event.type === "keydown" && event.key === "Escape")).toHaveLength(1);
        expect(observed.events.filter((event) => event.type === "click" && event.text === "取消" && event.trusted)).toHaveLength(1);
        // Radix derives currentTarget.click() from the trusted row Enter. Its
        // synthetic click is recorded; it is not mislabeled a physical click.
        expect(observed.events.filter((event) => event.type === "click" && ["确认", "开启完全访问权限", "了解更多"].includes(String(event.text)))).toEqual([]);
        await shot("final");
        // Exactly one ordinary content projection per case. Save all later
        // controls/guards first so an old-title RED cannot hide Cancel/Escape.
        expect.soft(projected).toEqual(EXPECTED_CONTENT);
      } catch (error) { failure = String(error); throw error; }
      finally {
        const assertionErrors = info.errors.map((error) => error.message ?? String(error.value ?? "Unknown test error"));
        if (!failure && assertionErrors.length) failure = assertionErrors[0];
        if (observer) { try { inputEvents = await observer.evaluate((value) => value.read()); await observer.evaluate((value) => value.dispose()); await observer.dispose(); } catch (error) { cleanupErrors.push(String(error)); } }
        if (reader && defaultsReader) { try { await record("finally"); } catch (error) { cleanupErrors.push(String(error)); } }
        try { await shot("finally"); } catch (error) { cleanupErrors.push(String(error)); }
        for (const handle of [reader, defaultsReader, mainNode, expandedNode]) if (handle) { try { await handle.dispose(); } catch (error) { cleanupErrors.push(String(error)); } }
        try { sourceAfter = hashInputs(); if (!isDeepStrictEqual(sourceAfter, sourceBefore)) cleanupErrors.push("R26 source input drift"); } catch (error) { cleanupErrors.push(String(error)); }
        if (stream) streamBeforeClose = stream.snapshot();
        try { await page.close(); } catch (error) { cleanupErrors.push(String(error)); }
        if (stream) { try {
          const closed = await stream.close(); streamCleanup = closed;
          if (!closed.closed || closed.listening || !closed.addressCleared || closed.activeResponses || closed.activeSockets || closed.serverErrorCount || closed.requestOverflow || closed.errors.length || closed.acceptedRequests < 1)
            cleanupErrors.push("Owned SSE did not satisfy complete teardown");
        } catch (error) { cleanupErrors.push(String(error)); } }
        const cleanupOnlyFailure = cleanupErrors.length > 0 && !failure;
        if (cleanupOnlyFailure) failure = "Cleanup failure: " + cleanupErrors.join("; ");
        const path = info.outputPath("full-access-confirmation.json");
        writeFileSync(path, JSON.stringify({ width, height: width === 390 ? 844 : 900, surface, theme, origin, phase, failure, assertionErrors,
          expectedContent: EXPECTED_CONTENT, contentProjection: projected, readiness, states, dialogs, editorIdentity, actions,
          counts, directory, api, bookkeeping, writes, external, errors, consoleErrors, inputEvents, screenshots, cleanupErrors,
          streamBeforeClose, streamCleanup, sourceBefore, sourceAfter,
          boundary: "Ordinary source-derived Chinese content and inert-cancel workflow in isolated local fixture. Original full Ht GUI/pixels, four-locale rendering, physical phone, real account/native policy and formal activation not claimed. No Confirm/Learn-more activation. One initial seed/initialize/default-draft hydration block only; all subsequent physical UI input trusted, readonly observations do not mutate stores." }, null, 2) + "\n");
        await info.attach("full-access-confirmation", { path, contentType: "application/json" });
        if (cleanupOnlyFailure) throw Error("Owned fixture cleanup failed: " + cleanupErrors.join("; "));
      }
    });
});
