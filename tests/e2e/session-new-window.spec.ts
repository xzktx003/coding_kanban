import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import {
  applySessionTabAction,
  type FollowedSession,
} from "../../packages/shared/src/session-tabs";
import { installSessionUxFixture } from "./session-ux-fixture";
import { liveStream } from "./session-sse-fixture";

const NAMESPACE = "ux-fixture-native-domain";
const CWD = "/fixture/项目/very-long-project-path-for-ui-regression";
const originalA = "原页面 A 的未发送草稿";
const originalB =
  "原页面 B 的未发送草稿 @SourcePlugin @SourceAgent @SourceLaterPlugin @SourceLaterAgent";
const popupC = "新窗口 C 的独立草稿 @PopupPlugin @PopupAgent";
const taskWrite =
  /\/(?:turn\/(?:start|steer|interrupt)|thread\/(?:start|resume|fork|archive|unarchive|rollback|acquire)|acp\/(?:start|load-session|new-session|cancel|stop|prompt)|cc\/(?:connect|resume|send|interrupt))$/;

async function moduleOnPage(page: Page, suffix: string) {
  return page.evaluate(
    (suffix) =>
      performance
        .getEntriesByType("resource")
        .findLast((entry) =>
          new URL(entry.name).pathname.endsWith(`/src/session-mode/${suffix}`),
        )?.name ?? `/src/session-mode/${suffix}`,
    suffix,
  );
}
function editor(page: Page) {
  return page
    .locator('.session-codex-composer [contenteditable="true"]')
    .first();
}
async function expectOwner(page: Page, id: string) {
  await expect(
    page.locator(".session-codex-composer[data-owner-thread]"),
  ).toHaveAttribute("data-owner-thread", id);
  await expect(editor(page)).toBeEditable();
}
async function select(page: Page, id: string) {
  const tab = page.locator(`[role=tab][data-tab-key="codex:${id}"]`).first();
  if ((await tab.count()) && (await tab.isVisible())) {
    await tab.scrollIntoViewIfNeeded({ timeout: 5000 });
    // The lower project label is a distinct action; select the visible title.
    await tab.locator(".session-identity-title").click();
  } else {
    // Phones display only the active group; choosing another existing group
    // uses the actual followed menu instead of mutating selection in a store.
    await page
      .getByRole("button", { name: "全部关注会话与窗口组", exact: true })
      .first()
      .click();
    await page
      .locator(`[role=menuitem][data-session-key="codex:${id}"]`)
      .click();
  }
  await expectOwner(page, id);
}
async function captureSite(page: Page) {
  const urls = await Promise.all(
    [
      "stores/useAgentCenterStore.ts",
      "stores/useSessionSplitStore.ts",
      "stores/useSessionDraftStore.ts",
    ].map((suffix) => moduleOnPage(page, suffix)),
  );
  return page.evaluate(async (urls) => {
    const [
      { useAgentCenterStore },
      { useSessionSplitStore },
      { useSessionDraftStore, sessionDraftKey },
    ] = await Promise.all(urls.map((url) => import(url)));
    return {
      current: useAgentCenterStore.getState().currentAgentCardId,
      kind: useAgentCenterStore.getState().currentAgentCardKind,
      split: JSON.stringify(useSessionSplitStore.getState().tree),
      activeGroup: useSessionSplitStore.getState().activeGroupId,
      a: useSessionDraftStore.getState().drafts[
        sessionDraftKey(
          "codex",
          "ux-0",
          "/fixture/项目/very-long-project-path-for-ui-regression",
        )
      ]?.text,
      b: useSessionDraftStore.getState().drafts[
        sessionDraftKey(
          "codex",
          "ux-1",
          "/fixture/项目/very-long-project-path-for-ui-regression",
        )
      ]?.text,
    };
  }, urls);
}
async function richDraft(page: Page, threadId: string, tag?: string) {
  const paths = await Promise.all(
    [
      "features/plugins/pluginInputs.ts",
      "features/subagents/mentions.ts",
      "stores/useSessionDraftStore.ts",
      "services/sessionWindowContext.ts",
    ].map((suffix) => moduleOnPage(page, suffix)),
  );
  return page.evaluate(
    async ({ paths, threadId, tag }) => {
      const [plugins, agents, drafts, windows] = await Promise.all(
        paths.map((path) => import(path)),
      );
      const owner = drafts.sessionDraftKey(
        "codex",
        threadId,
        "/fixture/项目/very-long-project-path-for-ui-regression",
      );
      if (tag) {
        plugins.pluginInputDrafts.add(owner, {
          name: `${tag}Plugin`,
          path: `plugin://fixture-${tag}@market`,
        });
        agents.mentionDrafts.add(owner, {
          name: `${tag}Agent`,
          path: `agent://fixture-${tag}`,
        });
      }
      const persisted = (name: string) =>
        JSON.parse(
          localStorage.getItem(windows.sessionWindowStorageName(name)) ??
            '{"state":{"drafts":{}}}',
        ).state.drafts[owner] ?? [];
      return {
        plugins: plugins.usePluginInputDrafts.getState().drafts[owner] ?? [],
        agents: agents.mentionDrafts.read(owner),
        pluginOwners: Object.keys(
          plugins.usePluginInputDrafts.getState().drafts,
        ),
        agentOwners: Object.keys(
          agents.useAgentMentionDrafts.getState().drafts,
        ),
        savedPlugins: persisted("kanban.session.plugin-inputs"),
        savedAgents: persisted("kanban.session.agent-mentions"),
      };
    },
    { paths, threadId, tag },
  );
}
async function expectRichText(page: Page, threadId: string, text: string) {
  const url = await moduleOnPage(page, "stores/useSessionDraftStore.ts");
  await expect
    .poll(() =>
      page.evaluate(
        async ({ url, threadId }) => {
          const { useSessionDraftStore, sessionDraftKey } = await import(url);
          return useSessionDraftStore.getState().drafts[
            sessionDraftKey(
              "codex",
              threadId,
              "/fixture/项目/very-long-project-path-for-ui-regression",
            )
          ]?.text;
        },
        { url, threadId },
      ),
    )
    .toBe(text);
  // A native mention chip displays its label without the @ used by the
  // actual serialized draft/send text. Verify both representations precisely.
  const display = text
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replaceAll("@", "@?");
  await expect(editor(page)).toHaveText(new RegExp(`^${display}$`));
}

async function fixture(
  context: BrowserContext,
  main: Page,
  popupNamespace = NAMESPACE,
  wrongMetadata = false,
  options: {
    count?: number;
    fourGroups?: boolean;
    performanceBaseURL?: string;
  } = {},
) {
  const pageFixtures = new Map<
    Page,
    Promise<Awaited<ReturnType<typeof installSessionUxFixture>>>
  >();
  const errors: string[] = [];
  const hmr = new Map<Page, { connected: number; socketErrors: string[] }>();
  const frontend = options.performanceBaseURL
    ? new URL(options.performanceBaseURL)
    : null;
  let runtimeInstance = "ux-fixture";
  let daemonIdentity = "a".repeat(64);
  const count = options.count ?? 3;
  let cards: FollowedSession[] = Array.from({ length: count }, (_, index) => ({
    kind: "codex",
    id: `ux-${index}`,
    cwd: CWD,
    preview: `中文会话 ${index}`,
  }));
  let revision = 1;
  const sequences = new Map<string, number>();
  const attach = (page: Page) => {
    if (pageFixtures.has(page)) return pageFixtures.get(page)!;
    page.on("pageerror", (error) => errors.push(error.message));
    const preparing = (async () => {
      const f = await installSessionUxFixture(page, count);
      await page.route("**/api/session/api/filesystem/search-files", (route) =>
        route.fulfill({ json: [] }),
      );
      if (frontend) {
        const ownedHmr = (value: string) => {
          const url = new URL(value);
          return (
            url.protocol ===
              (frontend.protocol === "https:" ? "wss:" : "ws:") &&
            url.host === frontend.host &&
            url.pathname === "/" &&
            !url.username &&
            !url.password
          );
        };
        const observed = { connected: 0, socketErrors: [] as string[] };
        hmr.set(page, observed);
        page.on("console", (message) => {
          if (message.type() === "error") errors.push(message.text());
        });
        page.on("websocket", (socket) => {
          if (!ownedHmr(socket.url())) return;
          socket.on("framereceived", ({ payload }) => {
            if (typeof payload !== "string") return;
            try {
              if (JSON.parse(payload).type === "connected")
                observed.connected++;
            } catch {
              /* Do not retain unrelated frames. */
            }
          });
          socket.on("socketerror", (error) => {
            observed.socketErrors.push(error);
            errors.push(error);
          });
        });
        await page.routeWebSocket(/.*/, (socket) => {
          if (ownedHmr(socket.url())) socket.connectToServer();
          else socket.close();
        });
      }
      for (const thread of f.threads)
        thread.turns = [
          {
            id: `completed-${thread.id}`,
            status: "completed",
            startedAt: 1,
            durationMs: 1,
            error: null,
            items: [
              {
                id: `reply-${thread.id}`,
                type: "agentMessage",
                text: `保留的正文 ${thread.id}`,
              },
            ],
          },
        ] as any;
      await page.route("**/api/session/tabs", async (route) => {
        const body =
          route.request().method() === "POST"
            ? route.request().postDataJSON()
            : null;
        const client = body?.clientId ?? "readonly";
        let sequence = sequences.get(client) ?? 0;
        for (const operation of body?.operations ?? []) {
          if (operation.seq <= sequence) continue;
          cards = applySessionTabAction(cards, operation.action);
          sequence = operation.seq;
          revision++;
        }
        sequences.set(client, sequence);
        await route.fulfill({
          json: { cards, initialized: true, revision, sequence },
        });
      });
      await page.route("**/api/session/lifecycle/context", (route) =>
        route.fulfill({
          json: {
            namespace: page === main ? NAMESPACE : popupNamespace,
            scopeToken: "ux-fixture-native-scope",
            daemonIdentity,
          },
        }),
      );
      await page.route("**/api/session/health", (route) =>
        route.fulfill({
          json: {
            status: "ok",
            instance: runtimeInstance,
            capabilities: { acpImages: true },
            entries: [],
          },
        }),
      );
      if (page !== main && wrongMetadata)
        await page.route(
          "**/api/session/api/codex/thread/metadata**",
          async (route) => {
            const { turns: _turns, ...metadata } = f.threads[0];
            await route.fulfill({ json: { thread: metadata } });
          },
        );
      return f;
    })();
    pageFixtures.set(page, preparing);
    return preparing;
  };
  context.on("page", attach);
  await attach(main);
  await main.addInitScript(
    ({ cards, cwd, fourGroups }) => {
      const seed = (name: string, value: string) => {
        if (!localStorage.getItem(name)) localStorage.setItem(name, value);
      };
      const group = (id: string, keys: string[]) => ({
        type: "group",
        id,
        keys,
        selected: keys[0],
      });
      const split = (
        id: string,
        first: unknown,
        second: unknown,
        direction = "vertical",
      ) => ({ type: "split", id, first, second, direction, ratio: 50 });
      const tree = fourGroups
        ? split(
            "source-split",
            split(
              "source-left",
              group("source-a", [
                "codex:ux-0",
                ...cards.slice(2, -2).map((card) => `codex:${card.id}`),
              ]),
              group("source-b", ["codex:ux-1"]),
            ),
            split(
              "source-right",
              group("source-c", ["codex:ux-28"]),
              group("source-d", ["codex:ux-29"]),
            ),
            "horizontal",
          )
        : split(
            "source-split",
            group("source-a", ["codex:ux-0", "codex:ux-2"]),
            group("source-b", ["codex:ux-1"]),
          );
      seed(
        "kanban.session.agent-center-store",
        JSON.stringify({
          version: 5,
          state: {
            cards,
            currentAgentCardId: "ux-0",
            currentAgentCardKind: "codex",
            cardsViewMode: "solo",
            sharedTabsInitialized: true,
          },
        }),
      );
      seed(
        "kanban.session.workspace",
        JSON.stringify({ version: 1, state: { cwd, projects: [cwd] } }),
      );
      seed(
        "kanban.session.split-layout",
        JSON.stringify({
          version: 1,
          state: {
            activeGroupId: "source-a",
            tree,
          },
        }),
      );
      seed(
        "kanban.session.layout-storage",
        JSON.stringify({
          version: 0,
          state: {
            view: "agent",
            isSidebarOpen: false,
            isRightPanelOpen: false,
          },
        }),
      );
    },
    { cards, cwd: CWD, fourGroups: options.fourGroups === true },
  );
  await main.goto("/?mode=session", { waitUntil: "domcontentloaded" });
  await expectOwner(main, "ux-0");
  await editor(main).fill(originalA);
  await select(main, "ux-1");
  await editor(main).fill(originalB);
  await expect
    .poll(async () => {
      const site = await captureSite(main);
      return [site.a, site.b];
    })
    .toEqual([originalA, originalB]);
  return {
    errors,
    hmrReady: (page: Page) => (hmr.get(page)?.connected ?? 0) > 0,
    hmrSnapshot: () => [...hmr.values()],
    changeRuntime: (next: string) => {
      runtimeInstance = next;
    },
    changeDaemon: (next: string) => {
      daemonIdentity = next;
    },
    ready: (page: Page) => attach(page),
    async writes() {
      const all = await Promise.all([...pageFixtures.values()]);
      return all
        .flatMap((f) => f.calls)
        .filter((call) => taskWrite.test(call.path));
    },
  };
}
async function openSelectedInNewWindow(
  context: BrowserContext,
  main: Page,
  recordGesture = false,
) {
  const tab = main.locator('[role=tab][data-tab-key="codex:ux-1"]').first();
  const row = tab.locator("xpath=..");
  await row.hover();
  const menu = row.getByRole("button", { name: /^标签操作：/ });
  await menu.click();
  const action = main.getByRole("menuitem", {
    name: "在新窗口打开",
    exact: true,
  });
  await expect(action).toBeVisible();
  if (recordGesture)
    await action.evaluate((item) =>
      item.addEventListener(
        "click",
        () => {
          (window as any).__sessionWindowGestureEpoch =
            performance.timeOrigin + performance.now();
        },
        { capture: true, once: true },
      ),
    );
  const next = context.waitForEvent("page", {
    predicate: (page) => page !== main,
  });
  await action.click();
  return next;
}

for (const width of [1440, 393]) {
  test.describe(`session window viewport ${width}`, () => {
    test.use({ viewport: { width, height: 1000 } });
    test(`new session window has one exact target and isolated site/drafts at ${width}`, async ({
      context,
      page,
    }) => {
      test.setTimeout(90_000);
      await page.setViewportSize({ width, height: 1000 });
      const f = await fixture(context, page);
      await expect(page.locator("[data-session-group]")).toHaveCount(
        width < 768 ? 1 : 2,
      );
      const before = await captureSite(page);
      expect(JSON.parse(before.split).type).toBe("split");
      await richDraft(page, "ux-1", "Source");
      const popup = await openSelectedInNewWindow(context, page);
      await f.ready(popup);
      await popup.waitForURL((url) => url.searchParams.has("sessionWindow"));
      expect(new URL(popup.url()).origin).toBe(new URL(page.url()).origin);
      expect(new URL(popup.url()).searchParams.get("sessionWindow")).toMatch(
        /^[0-9a-f-]{36}$/i,
      );
      expect(await popup.evaluate(() => window.opener)).toBeNull();
      await expectOwner(popup, "ux-1");
      await expect(popup.locator("[data-session-group]")).toHaveCount(1);
      await expect(editor(popup)).toHaveText("");
      const initialRich = await richDraft(popup, "ux-1");
      expect(initialRich.pluginOwners).toEqual([]);
      expect(initialRich.agentOwners).toEqual([]);
      // Both real pages now hold their own persisted store instance. Interleave
      // later source edits before a popup write to catch whole-map overwrites.
      await richDraft(page, "ux-1", "SourceLater");
      await select(popup, "ux-2");
      await editor(popup).fill(popupC);
      await richDraft(popup, "ux-2", "Popup");
      await popup.reload({ waitUntil: "domcontentloaded" });
      await expectOwner(popup, "ux-2");
      await expectRichText(popup, "ux-2", popupC);
      await expect(popup.locator("[data-session-group]")).toHaveCount(1);
      const popupRich = await richDraft(popup, "ux-2");
      expect(popupRich.plugins.map((item: any) => item.name)).toEqual([
        "PopupPlugin",
      ]);
      expect(popupRich.agents.map((item: any) => item.name)).toEqual([
        "PopupAgent",
      ]);
      expect(popupRich.savedPlugins).toEqual(popupRich.plugins);
      expect(popupRich.savedAgents).toEqual(popupRich.agents);
      // Runtime replacement can retain the exact shared official daemon. Only
      // an already accepted page may read-only rebind to that same native source.
      const acceptedUrl = popup.url();
      f.changeRuntime("ux-fixture-next-generation");
      await popup.reload({ waitUntil: "domcontentloaded" });
      await expectOwner(popup, "ux-2");
      await expectRichText(popup, "ux-2", popupC);
      expect(popup.url()).toBe(acceptedUrl);
      expect(await richDraft(popup, "ux-2")).toEqual(popupRich);
      await page.reload({ waitUntil: "domcontentloaded" });
      await expectOwner(page, "ux-1");
      await expectRichText(page, "ux-1", originalB);
      expect(await captureSite(page)).toEqual(before);
      const sourceRich = await richDraft(page, "ux-1");
      expect(sourceRich.plugins.map((item: any) => item.name)).toEqual([
        "SourcePlugin",
        "SourceLaterPlugin",
      ]);
      expect(sourceRich.agents.map((item: any) => item.name)).toEqual([
        "SourceAgent",
        "SourceLaterAgent",
      ]);
      expect(sourceRich.savedPlugins).toEqual(sourceRich.plugins);
      expect(sourceRich.savedAgents).toEqual(sourceRich.agents);
      const duplicate = await context.newPage();
      await f.ready(duplicate);
      const duplicateUrl = new URL(popup.url());
      duplicateUrl.searchParams.append(
        "sessionWindow",
        duplicateUrl.searchParams.get("sessionWindow")!,
      );
      await duplicate.goto(duplicateUrl.href, {
        waitUntil: "domcontentloaded",
      });
      await expect(duplicate.getByRole("alert")).toContainText(
        /窗口|来源|连接|验证/,
      );
      await expect(duplicate.locator(".session-codex-composer")).toHaveCount(0);
      await duplicate.close();
      await select(page, "ux-0");
      await expect(editor(page)).toHaveText(originalA);
      expect(await f.writes()).toEqual([]);
      expect(f.errors).toEqual([]);
      await popup.close();
    });

    test(`a new window rejects changed native namespace without mounting a composer at ${width}`, async ({
      context,
      page,
    }) => {
      test.setTimeout(60_000);
      await page.setViewportSize({ width, height: 1000 });
      const f = await fixture(context, page, "different-native-domain");
      const before = await captureSite(page);
      const popup = await openSelectedInNewWindow(context, page);
      await f.ready(popup);
      await expect(popup.getByRole("alert")).toContainText(
        /窗口|来源|连接|验证/,
      );
      await expect(popup.locator(".session-codex-composer")).toHaveCount(0);
      expect(await captureSite(page)).toEqual(before);
      expect(await f.writes()).toEqual([]);
      expect(f.errors).toEqual([]);
      await popup.close();
    });

    test(`an unknown sessionWindow URL never falls back to the original page target at ${width}`, async ({
      context,
      page,
    }) => {
      test.setTimeout(60_000);
      await page.setViewportSize({ width, height: 1000 });
      const f = await fixture(context, page);
      const before = await captureSite(page);
      const unknown = await context.newPage();
      await f.ready(unknown);
      const url = new URL(page.url());
      url.searchParams.set(
        "sessionWindow",
        "11111111-1111-4111-8111-111111111111",
      );
      await unknown.goto(url.href, { waitUntil: "domcontentloaded" });
      await expect(unknown.getByRole("alert")).toContainText(
        /窗口|来源|连接|验证/,
      );
      await expect(unknown.locator(".session-codex-composer")).toHaveCount(0);
      expect(await captureSite(page)).toEqual(before);
      expect(await f.writes()).toEqual([]);
      expect(f.errors).toEqual([]);
      await unknown.close();
    });

    test(`wrong native thread metadata cannot choose another input in a new window at ${width}`, async ({
      context,
      page,
    }) => {
      test.setTimeout(60_000);
      await page.setViewportSize({ width, height: 1000 });
      const f = await fixture(context, page, NAMESPACE, true);
      const before = await captureSite(page);
      const popup = await openSelectedInNewWindow(context, page);
      await f.ready(popup);
      await expect(popup.getByRole("alert")).toContainText(
        /窗口|来源|连接|验证/,
      );
      await expect(popup.locator(".session-codex-composer")).toHaveCount(0);
      expect(await captureSite(page)).toEqual(before);
      expect(await f.writes()).toEqual([]);
      expect(f.errors).toEqual([]);
      await popup.close();
    });

    test(`runtime replacement cannot rebind to a different daemon with the same namespace at ${width}`, async ({
      context,
      page,
    }) => {
      test.setTimeout(60_000);
      await page.setViewportSize({ width, height: 1000 });
      const f = await fixture(context, page);
      const popup = await openSelectedInNewWindow(context, page);
      await f.ready(popup);
      await expectOwner(popup, "ux-1");
      await editor(popup).fill("不同原生服务出现时必须保留的草稿");
      f.changeRuntime("ux-fixture-new-runtime");
      f.changeDaemon("b".repeat(64));
      await popup.reload({ waitUntil: "domcontentloaded" });
      await expect(popup.getByRole("alert")).toContainText(
        /窗口|来源|连接|验证|服务/,
      );
      await expect(popup.locator(".session-codex-composer")).toHaveCount(0);
      // Returning to the originally proven daemon uses fresh read-only proofs;
      // rejection must have preserved the accepted window's own draft storage.
      f.changeDaemon("a".repeat(64));
      await popup.reload({ waitUntil: "domcontentloaded" });
      await expectOwner(popup, "ux-1");
      await expect(editor(popup)).toHaveText(
        "不同原生服务出现时必须保留的草稿",
      );
      await expect(editor(page)).toHaveText(originalB);
      expect(await f.writes()).toEqual([]);
      expect(f.errors).toEqual([]);
      await popup.close();
    });
  });
}

test.describe("actual popup performance", () => {
  test.use({ viewport: { width: 1440, height: 1000 } });
  test("thirty real popup gestures keep the exact composer usable within two seconds with three existing pages", async ({
    context,
    page,
    baseURL,
  }, info) => {
    test.skip(
      process.env.SESSION_NEW_WINDOW_PERFORMANCE !== "1",
      "Explicit quiet performance window required; a skip is not acceptance evidence.",
    );
    test.setTimeout(360_000);
    await page.setViewportSize({ width: 1440, height: 1000 });
    if (!baseURL) throw new Error("A frozen LAN frontend URL is required");
    // liveStream only uses addInitScript on its first argument. Installing that
    // same native EventSource bridge on the context covers every real popup,
    // while retaining one bounded HTTPS fixture server for the whole run.
    const stream = await liveStream(context as unknown as Page, baseURL);
    try {
      await context.addInitScript(() => {
        const metrics = ((window as any).__newWindowPerformance = {
          navEpoch: 0,
          readyEpoch: 0,
          keyEpoch: 0,
          inputTwoFrames: 0,
          inputAtTwoFrames: "",
        });
        const epoch = () => performance.timeOrigin + performance.now();
        const observer = new MutationObserver(() => {
          if (
            !metrics.navEpoch &&
            document.querySelector('[data-navigation-ready="true"]')
          )
            metrics.navEpoch = epoch();
          const composer = document.querySelector<HTMLElement>(
            '.session-codex-composer[data-owner-thread="ux-1"]',
          );
          const input = composer?.querySelector<HTMLElement>(
            '[contenteditable="true"]',
          );
          if (
            metrics.readyEpoch ||
            !input?.isContentEditable ||
            !input.getClientRects().length ||
            input.closest("[hidden],[inert]")
          )
            return;
          const style = getComputedStyle(input);
          if (style.visibility === "hidden" || style.display === "none") return;
          metrics.readyEpoch = epoch();
          observer.disconnect();
        });
        observer.observe(document, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: [
            "data-owner-thread",
            "contenteditable",
            "hidden",
            "inert",
          ],
        });
        document.addEventListener(
          "keydown",
          (event) => {
            if (
              event.key === "x" &&
              (event.target as HTMLElement)?.closest(
                '.session-codex-composer[data-owner-thread="ux-1"] [contenteditable="true"]',
              )
            ) {
              metrics.keyEpoch = epoch();
              const target = event.target as HTMLElement;
              requestAnimationFrame(() =>
                requestAnimationFrame(() => {
                  metrics.inputTwoFrames = epoch() - metrics.keyEpoch;
                  metrics.inputAtTwoFrames = target.innerText;
                }),
              );
            }
          },
          { capture: true },
        );
      });
      const f = await fixture(context, page, NAMESPACE, false, {
        count: 30,
        fourGroups: true,
        performanceBaseURL: baseURL,
      });
      await expect(page.locator("[data-session-group]")).toHaveCount(4);
      expect(f.hmrReady(page)).toBe(true);
      const original = await captureSite(page);
      const held: Page[] = [],
        samples: Array<{
          index: number;
          gestureEpoch: number;
          navigation: number;
          composer: number;
          inputTwoFrames: number;
          target: string;
          nonce: string;
        }> = [];
      const errors: string[] = [];
      const summarize = (values: number[]) => {
        const sorted = [...values].sort((a, b) => a - b);
        return {
          count: sorted.length,
          p50: sorted[Math.floor(sorted.length / 2)] ?? null,
          p95: sorted[Math.ceil(sorted.length * 0.95) - 1] ?? null,
          max: sorted.at(-1) ?? null,
        };
      };
      try {
        // Three genuinely loaded pages exist before each measured fourth popup.
        for (let index = 0; index < 2; index++) {
          const warm = await openSelectedInNewWindow(context, page);
          held.push(warm);
          await f.ready(warm);
          await expectOwner(warm, "ux-1");
          await expect(warm.locator("[data-session-group]")).toHaveCount(1);
          expect(f.hmrReady(warm)).toBe(true);
        }
        await expect.poll(stream.connections).toBeGreaterThanOrEqual(3);
        for (let index = 0; index < 30; index++) {
          let popup: Page | undefined;
          try {
            await page.bringToFront();
            popup = await openSelectedInNewWindow(context, page, true);
            await f.ready(popup);
            await popup.waitForFunction(
              () => (window as any).__newWindowPerformance?.readyEpoch > 0,
              undefined,
              { polling: "raf", timeout: 15_000 },
            );
            await expectOwner(popup, "ux-1");
            expect(
              f.hmrReady(popup),
              "The exact owned Vite HMR transport must be connected",
            ).toBe(true);
            await expect.poll(stream.connections).toBeGreaterThanOrEqual(4);
            await expect(popup.locator("[data-session-group]")).toHaveCount(1);
            await expect(editor(popup)).toHaveText("");
            expect(await popup.evaluate(() => window.opener)).toBeNull();
            expect(new URL(popup.url()).origin).toBe(
              new URL(page.url()).origin,
            );
            const gestureEpoch = await page.evaluate(
              () => (window as any).__sessionWindowGestureEpoch as number,
            );
            const metrics = await popup.evaluate(
              () => (window as any).__newWindowPerformance,
            );
            expect(gestureEpoch).toBeGreaterThan(0);
            expect(metrics.navEpoch).toBeGreaterThan(gestureEpoch);
            expect(metrics.readyEpoch).toBeGreaterThan(gestureEpoch);
            expect((await captureSite(popup)).current).toBe("ux-1");
            await editor(popup).press("x");
            await expect(editor(popup)).toHaveText("x");
            await popup.waitForFunction(
              () => (window as any).__newWindowPerformance.inputTwoFrames > 0,
            );
            const inputMetrics = await popup.evaluate(
              () => (window as any).__newWindowPerformance,
            );
            expect(inputMetrics.keyEpoch).toBeGreaterThan(0);
            expect(inputMetrics.inputAtTwoFrames).toBe("x");
            const inputTwoFrames = inputMetrics.inputTwoFrames;
            const nonce = new URL(popup.url()).searchParams.get(
              "sessionWindow",
            )!;
            expect(nonce).toMatch(/^[0-9a-f-]{36}$/i);
            samples.push({
              index,
              gestureEpoch,
              navigation: metrics.navEpoch - gestureEpoch,
              composer: metrics.readyEpoch - gestureEpoch,
              inputTwoFrames,
              target: "ux-1",
              nonce,
            });
            await expect(editor(page)).toHaveText(originalB);
            expect(await captureSite(page)).toEqual(original);
          } catch (error) {
            errors.push(`Sample ${index}: ${String(error)}`);
            throw error;
          } finally {
            await popup?.close();
          }
        }
        expect(samples).toHaveLength(30);
        expect(new Set(samples.map((sample) => sample.nonce)).size).toBe(30);
        expect(
          summarize(samples.map((sample) => sample.composer)).p95,
        ).toBeLessThanOrEqual(2000);
        expect(
          summarize(samples.map((sample) => sample.navigation)).p95,
        ).toBeLessThanOrEqual(2000);
        expect(
          summarize(samples.map((sample) => sample.inputTwoFrames)).p95,
        ).toBeLessThanOrEqual(100);
        expect(await f.writes()).toEqual([]);
        expect(f.errors).toEqual([]);
      } finally {
        const navigation = summarize(
            samples.map((sample) => sample.navigation),
          ),
          composer = summarize(samples.map((sample) => sample.composer)),
          inputTwoFrames = summarize(
            samples.map((sample) => sample.inputTwoFrames),
          ),
          nativeTaskWrites = await f.writes();
        const eligible =
          samples.length === 30 && !errors.length && !f.errors.length;
        const result = {
          baseURL,
          actualPopupGesture: true,
          requiredSamples: 30,
          load: {
            followed: 30,
            sourceVisiblePanes: 4,
            existingPages: 3,
            pagesDuringPopup: 4,
          },
          acceptanceEligible: eligible,
          passed:
            eligible &&
            navigation.p95! <= 2000 &&
            composer.p95! <= 2000 &&
            inputTwoFrames.p95! <= 100 &&
            !nativeTaskWrites.length,
          thresholds: {
            navigationP95Ms: 2000,
            correctComposerP95Ms: 2000,
            inputTwoFramesP95Ms: 100,
          },
          navigation,
          composer,
          inputTwoFrames,
          samples,
          errors,
          pageErrors: f.errors,
          nativeTaskWrites,
          hmr: f.hmrSnapshot(),
          eventSource: {
            native: true,
            opens: stream.opens(),
            connections: stream.connections(),
          },
          boundary:
            "Real browser window.open from a menu item with noopener; private read-only protocol fixture, native HTTPS EventSource, actual owned HMR and actual DOM/keyboard; history is measured separately. API routing disables HTTP cache; no threshold, retries or timeouts are removed.",
        };
        await writeFile(
          info.outputPath("new-window-performance.json"),
          JSON.stringify(result, null, 2),
        );
        for (const warm of held) await warm.close();
      }
    } finally {
      await page.close();
      await stream.close();
    }
  });
});
