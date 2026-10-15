import { test, expect, type Page, type TestInfo } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { installSessionUxFixture } from "./session-ux-fixture";
import { composerAction } from "./session-composer-actions";
import { liveStream } from "./session-sse-fixture";

const artifacts = ".dev-runtime/subagent-identity-release-20261014/e2e";
type NativeThread = Record<string, any>;
type Call = { path: string; body: any };
type Fixture = Awaited<ReturnType<typeof setup>>;
type RequestFailure = {
  at: number;
  readRequestId?: string;
  url: string;
  path: string;
  method: string;
  error: string | undefined;
};
type SignalCancellation = {
  at: number;
  readRequestId: string;
  url: string;
  method: string;
  reason: string;
  stack: string;
};
type NavigationCancellation = {
  at: number;
  navigationAt: number;
  url: string;
  path: string;
  method: string;
  threadId?: string;
};
type ClassifiedCancellation = RequestFailure & {
  classification: "explicit-reload" | "known-fetch-cleanup";
  evidence: NavigationCancellation | SignalCancellation;
};

function isReadOnlyRequest(url: string, method: string) {
  const path = new URL(url).pathname;
  return (
    (method === "GET" && path === "/api/session/health") ||
    (method === "POST" &&
      /^\/api\/session\/(?:api\/codex\/(?:thread\/(?:read|turns\/list|metadata|list)|config\/read)|subagents\/snapshot)$/.test(
        path,
      ))
  );
}

function isKnownCleanup(
  failure: RequestFailure,
  cancellation: SignalCancellation,
) {
  if (
    failure.error !== "net::ERR_ABORTED" ||
    failure.url !== cancellation.url ||
    failure.method !== cancellation.method ||
    cancellation.reason !== "AbortError" ||
    !failure.readRequestId ||
    failure.readRequestId !== cancellation.readRequestId ||
    failure.at < cancellation.at ||
    failure.at - cancellation.at >= 1000
  )
    return false;
  if (failure.method === "GET" && failure.path === "/api/session/health")
    return /\/session-mode\/(?:SessionWorkbench\.tsx|features\/native-mcp-auth\/service\.ts)/.test(
      cancellation.stack,
    );
  if (
    failure.method === "POST" &&
    failure.path === "/api/session/api/codex/config/read"
  )
    return /McpReauthentication\.stop .*\/features\/native-mcp-auth\/controller\.ts/.test(
      cancellation.stack,
    );
  return false;
}

async function mountedState(page: Page) {
  return page.evaluate(async () => {
    const load = async (suffix: string) => {
      const path = `/src/session-mode/${suffix}`;
      return import(
        performance
          .getEntriesByType("resource")
          .findLast((entry) => new URL(entry.name).pathname === path)?.name ??
          path
      );
    };
    const subagents = await load("features/subagents/store.ts");
    const codex = await load("components/codex/stores/index.ts");
    const sub = subagents.useSubagentStore.getState();
    const threads = codex.useCodexStore.getState();
    return {
      nodes: sub.nodes,
      selection: sub.selection,
      panelRoot: sub.panelRoot,
      families: sub.families,
      runtimeEpoch: sub.runtimeEpoch,
      currentThreadId: threads.currentThreadId,
      threads: threads.threads,
    };
  });
}

async function setup(
  page: Page,
  options: {
    activity?: "v1" | "v2";
    cachedWrongIdentity?: boolean;
    activeChildren?: boolean;
    unknownRoot?: boolean;
    access?: { state: string; reason: string; generation: number };
  } = {},
) {
  const fixture = await installSessionUxFixture(page, 2);
  // Keep the exact same-origin Vite HMR handshake real; application sockets stay isolated.
  await page.routeWebSocket(
    (url) =>
      url.host === new URL(test.info().project.use.baseURL!).host &&
      url.pathname === "/" &&
      url.searchParams.has("token") &&
      [...url.searchParams.keys()].every((key) => key === "token"),
    (socket) => {
      socket.connectToServer();
    },
  );
  const calls: Call[] = [];
  const errorEvents: Array<{ text: string; at: number; kind: string }> = [];
  const navigationWindows: number[] = [];
  const navigationAborts: NavigationCancellation[] = [];
  const signalCancellations: SignalCancellation[] = [];
  const requestFailures: RequestFailure[] = [];
  const pendingStarts: Array<{
    readRequestId: string;
    url: string;
    method: string;
  }> = [];
  const readRequestIds = new Map<import("@playwright/test").Request, string>();
  await page.exposeFunction(
    "__identityFixtureReadStarted",
    (event: { readRequestId: string; url: string; method: string }) => {
      if (pendingStarts.length < 256) pendingStarts.push(event);
    },
  );
  await page.exposeFunction(
    "__identityFixtureSignalCancellation",
    (event: SignalCancellation) => {
      if (signalCancellations.length < 256) signalCancellations.push(event);
    },
  );
  await page.addInitScript(() => {
    const fetch = window.fetch;
    const documentId = crypto.randomUUID();
    let readSequence = 0;
    window.fetch = function (input, init) {
      const request = input instanceof Request ? input : undefined;
      const signal = init?.signal ?? request?.signal;
      const url = new URL(request?.url ?? String(input), location.href).href;
      const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
      const path = new URL(url).pathname;
      const readOnly =
        (method === "GET" && path === "/api/session/health") ||
        (method === "POST" &&
          /^\/api\/session\/(?:api\/codex\/(?:thread\/(?:read|turns\/list|metadata|list)|config\/read)|subagents\/snapshot)$/.test(
            path,
          ));
      if (!readOnly || signal?.aborted) return fetch.call(this, input, init);
      const readRequestId = `${documentId}:${++readSequence}`;
      void (window as any)
        .__identityFixtureReadStarted({ readRequestId, url, method })
        .catch(() => {});
      const cancelled = () => {
        void (window as any)
          .__identityFixtureSignalCancellation({
            at: Date.now(),
            readRequestId,
            url,
            method,
            reason: signal?.reason?.name ?? String(signal?.reason),
            stack: new Error("Observed fetch signal cancellation").stack
              ?.split("\n")
              .slice(0, 5)
              .join("\n"),
          })
          .catch(() => {});
      };
      signal?.addEventListener("abort", cancelled, { once: true });
      const promise = fetch.call(this, input, init);
      // Observe settlement without replacing the fetch promise, response or signal.
      const settled = () => signal?.removeEventListener("abort", cancelled);
      void promise.then(settled, settled);
      return promise;
    };
  });
  const pendingReads = new Set<import("@playwright/test").Request>();
  page.on("pageerror", (error) =>
    errorEvents.push({
      text: error.message,
      at: Date.now(),
      kind: "pageerror",
    }),
  );
  page.on("console", (message) => {
    if (message.type() === "error")
      errorEvents.push({
        text: message.text(),
        at: Date.now(),
        kind: "console",
      });
  });
  page.on("request", (request) => {
    if (isReadOnlyRequest(request.url(), request.method())) {
      pendingReads.add(request);
      const index = pendingStarts.findIndex(
        (started) =>
          started.url === request.url() && started.method === request.method(),
      );
      if (index !== -1)
        readRequestIds.set(
          request,
          pendingStarts.splice(index, 1)[0].readRequestId,
        );
    }
  });
  page.on("requestfinished", (request) => {
    pendingReads.delete(request);
    readRequestIds.delete(request);
  });
  page.on("requestfailed", (request) => {
    const at = Date.now();
    const navigationAt = navigationWindows.findLast(
      (startedAt) => at >= startedAt && at - startedAt < 1000,
    );
    const body = pendingReads.has(request) ? request.postDataJSON() : null;
    requestFailures.push({
      at,
      readRequestId: readRequestIds.get(request),
      url: request.url(),
      path: new URL(request.url()).pathname,
      method: request.method(),
      error: request.failure()?.errorText,
    });
    if (
      pendingReads.has(request) &&
      request.failure()?.errorText === "net::ERR_ABORTED" &&
      navigationAt !== undefined
    ) {
      navigationAborts.push({
        at,
        navigationAt,
        url: request.url(),
        path: new URL(request.url()).pathname,
        method: request.method(),
        threadId: body?.threadId,
      });
    }
    pendingReads.delete(request);
    readRequestIds.delete(request);
  });
  const root = fixture.threads[0] as NativeThread;
  Object.assign(root, {
    source: "vscode",
    parentThreadId: null,
    turns: [
      {
        id: "identity-root-turn",
        status: "completed",
        items: [
          {
            id: "identity-response",
            type: "agentMessage",
            text: "主会话已完成，正文与草稿应正常保留。",
          },
        ],
      },
    ],
  });
  if (options.unknownRoot) {
    root.source = "unknown";
    delete root.parentThreadId;
  }
  const children: NativeThread[] = [false, null, true].map(
    (capability, index) => ({
      id: `identity-child-${index}`,
      parentThreadId: "ux-0",
      source: {
        subAgent: { thread_spawn: { parent_thread_id: "ux-0", depth: 1 } },
      },
      agentNickname: ["Restricted", "Unknown", "Allowed"][index],
      cwd: root.cwd,
      canAcceptDirectInput: capability,
      status: { type: options.activeChildren ? "active" : "idle" },
      turns: [
        {
          id: `identity-child-turn-${index}`,
          status: options.activeChildren ? "inProgress" : "completed",
          items: [],
        },
      ],
    }),
  );
  root.turns[0].items.push({
    id: "identity-spawn",
    type: "collabAgentToolCall",
    tool: "spawnAgent",
    status: "completed",
    senderThreadId: "ux-0",
    receiverThreadIds: children.map((child) => child.id),
    agentsStates: {},
    prompt: "隔离身份与输入权限验收",
    model: "fixture-model",
    reasoningEffort: "medium",
  });
  if (options.activity === "v1")
    root.turns[0].items.push({
      id: "child-to-parent-message",
      type: "collabAgentToolCall",
      tool: "sendMessage",
      status: "completed",
      senderThreadId: children[0].id,
      receiverThreadIds: ["ux-0", "ux-1", children[0].id],
      agentsStates: {},
    });
  if (options.activity === "v2")
    root.turns[0].items.push({
      id: "child-to-parent-v2",
      type: "subAgentActivity",
      kind: "interacted",
      agentThreadId: "ux-0",
      status: "completed",
      receiverThreadId: "ux-0",
    });
  const cards = fixture.threads.map((thread) => ({
    kind: "codex",
    id: thread.id,
    cwd: thread.cwd,
    preview: thread.name,
  }));
  await page.route("**/api/session/tabs", (route) =>
    route.fulfill({
      json: { cards, initialized: true, revision: 1, sequence: 0 },
    }),
  );
  await page.addInitScript(
    ({ cards, cached }) => {
      localStorage.setItem(
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
      const key = `kanban.session.subagent-families:${location.origin}`;
      if (cached && !localStorage.getItem(key))
        localStorage.setItem(
          key,
          JSON.stringify({
            version: 1,
            state: {
              nodes: {
                "ux-0": {
                  parentId: "identity-child-0",
                  verified: false,
                  revision: 3,
                  thread: {
                    id: "ux-0",
                    canAcceptDirectInput: null,
                    status: { type: "idle" },
                  },
                },
              },
              selection: { "ux-0": null },
              panelRoot: null,
            },
          }),
        );
    },
    { cards, cached: options.cachedWrongIdentity ?? false },
  );
  const access = options.access ?? {
    state: "owned",
    reason: "",
    generation: 1,
  };
  await page.route("**/api/session/api/codex/thread/access", async (route) => {
    calls.push({
      path: new URL(route.request().url()).pathname,
      body: route.request().postDataJSON(),
    });
    await route.fulfill({ json: access });
  });
  await page.route(
    /\/api\/session\/api\/codex\/thread\/metadata(?:\?.*)?$/,
    async (route) => {
      const body = route.request().postDataJSON();
      calls.push({ path: new URL(route.request().url()).pathname, body });
      const thread =
        children.find((child) => child.id === body.threadId) ??
        fixture.threads.find((thread) => thread.id === body.threadId);
      await route.fulfill({ json: { thread } });
    },
  );
  await page.route("**/api/session/subagents/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const body = route.request().postDataJSON();
    calls.push({ path, body });
    if (path.endsWith("snapshot"))
      return route.fulfill({
        json: {
          threads: body.rootId === "ux-0" ? children : [],
          complete: true,
          errors: [],
          unavailableIds: [],
          checkedAt: Date.now(),
        },
      });
    if (path.endsWith("verify"))
      return route.fulfill({
        json: { thread: children.find((child) => child.id === body.threadId) },
      });
    return route.fulfill({ json: { roles: [] } });
  });
  await page.route(
    /\/api\/session\/api\/codex\/thread\/(read|turns\/list)(?:\?.*)?$/,
    async (route) => {
      const path = new URL(route.request().url()).pathname;
      const body = route.request().postDataJSON();
      const child = children.find((child) => child.id === body.threadId);
      if (!child) return route.fallback();
      calls.push({ path, body });
      await route.fulfill({
        json: path.endsWith("read")
          ? { thread: child }
          : { data: child.turns, nextCursor: null },
      });
    },
  );
  await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
  const editor = page
    .locator(".session-agent-view [contenteditable=true]")
    .first();
  await expect(editor).toBeVisible({ timeout: 20000 });
  await page
    .locator('[role=tab][data-tab-key="codex:ux-0"] .session-identity-title')
    .click();
  await expect(
    page.locator('[role=tab][data-tab-key="codex:ux-0"]'),
  ).toHaveAttribute("aria-selected", "true");
  const result = {
    fixture,
    root,
    children,
    access,
    calls,
    get errors() {
      return errorEvents
        .filter(
          (event) =>
            !(
              event.kind === "console" &&
              event.text.includes(
                "[CodexService] threadResume error: TypeError: Failed to fetch",
              ) &&
              navigationAborts.some(
                (abort) =>
                  /^\/api\/session\/api\/codex\/thread\/(read|turns\/list)$/.test(
                    abort.path,
                  ) && Math.abs(event.at - abort.at) < 100,
              )
            ),
        )
        .map((event) => event.text);
    },
    navigationWindows,
    navigationAborts,
    errorEvents,
    signalCancellations,
    requestFailures,
    pendingReads,
    get classifiedCancellations() {
      return requestFailures.flatMap<ClassifiedCancellation>((failure) => {
        const navigation = navigationAborts.find(
          (abort) =>
            abort.url === failure.url &&
            abort.method === failure.method &&
            abort.at === failure.at,
        );
        if (navigation)
          return [
            {
              ...failure,
              classification: "explicit-reload",
              evidence: navigation,
            },
          ];
        const signal = signalCancellations.find((cancellation) =>
          isKnownCleanup(failure, cancellation),
        );
        return signal
          ? [
              {
                ...failure,
                classification: "known-fetch-cleanup",
                evidence: signal,
              },
            ]
          : [];
      });
    },
    get networkFailures() {
      return requestFailures
        .filter(
          (failure) =>
            !navigationAborts.some(
              (abort) =>
                abort.url === failure.url &&
                abort.method === failure.method &&
                abort.at === failure.at,
            ) &&
            !signalCancellations.some((cancellation) =>
              isKnownCleanup(failure, cancellation),
            ),
        )
        .map(
          (failure) => `${failure.method} ${failure.path}: ${failure.error}`,
        );
    },
    editor,
  };
  (page as any).__identityReleaseFixture = result;
  return result;
}

function mutationCalls(f: Fixture) {
  return [...f.fixture.calls, ...f.calls].filter(
    (call) =>
      /thread\/(resume|start)|turn\/(start|interrupt)|subagents\/stop/.test(
        call.path,
      ) || call.body?.release === true,
  );
}

async function assertRootUnchanged(page: Page, f: Fixture, draft: string) {
  await expect(f.editor).toHaveText(draft);
  const state = await mountedState(page);
  expect(state.currentThreadId).toBe("ux-0");
  expect(state.threads.find((thread) => thread.id === "ux-0")?.cwd).toBe(
    f.root.cwd,
  );
  expect(mutationCalls(f)).toEqual([]);
}

async function record(page: Page, info: TestInfo) {
  const fixture = (page as any).__identityReleaseFixture as Fixture | undefined;
  if (!fixture) return;
  await mkdir(artifacts, { recursive: true });
  const name = info.title.replace(/[^a-zA-Z0-9]+/g, "-").slice(0, 130);
  const state = await mountedState(page).catch((error) => ({
    inspectionError: String(error),
  }));
  const report = {
    title: info.title,
    status: info.status,
    url: page.url(),
    viewport: page.viewportSize(),
    errors: fixture.errors,
    observedErrorEvents: fixture.errorEvents,
    requestFailures: fixture.requestFailures,
    signalCancellations: fixture.signalCancellations,
    classifiedCancellations: fixture.classifiedCancellations,
    navigationWindows: fixture.navigationWindows,
    navigationAborts: fixture.navigationAborts,
    networkFailures: fixture.networkFailures,
    calls: [...fixture.fixture.calls, ...fixture.calls],
    state,
  };
  await writeFile(`${artifacts}/${name}.json`, JSON.stringify(report, null, 2));
  await info.attach("identity-release-browser-state", {
    body: JSON.stringify(report, null, 2),
    contentType: "application/json",
  });
  await page.screenshot({ path: `${artifacts}/${name}.png`, fullPage: true });
}
test.afterEach(async ({ page }, info) => {
  await record(page, info);
  const fixture = (page as any).__identityReleaseFixture as Fixture | undefined;
  if (fixture) {
    expect(fixture.errors).toEqual([]);
    expect(fixture.networkFailures).toEqual([]);
  }
});

test("same-value live restriction rejects an older readonly permission response without rerendering identity", async ({
  page,
  baseURL,
}) => {
  const stream = await liveStream(page, baseURL!);
  try {
    const f = await setup(page, { activeChildren: true });
    await f.editor.fill("旧权限响应不得改变主会话草稿");
    await page.getByRole("button", { name: /子智能体 · 已开启/ }).click();
    await page.getByRole("button", { name: "Restricted", exact: true }).click();
    await expect(
      page.getByRole("textbox", { name: "发送给 Restricted", exact: true }),
    ).toHaveCount(0);
    await expect.poll(() => f.pendingReads.size).toBe(0);
    let started = false;
    let release = () => {};
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(
      /\/api\/session\/api\/codex\/thread\/metadata(?:\?.*)?$/,
      async (route) => {
        const body = route.request().postDataJSON();
        if (body.threadId !== "identity-child-0") return route.fallback();
        f.calls.push({ path: new URL(route.request().url()).pathname, body });
        started = true;
        await barrier;
        await route.fulfill({
          json: { thread: { ...f.children[0], canAcceptDirectInput: true } },
        });
      },
    );
    await page.evaluate(async (nativeThread) => {
      const load = async (suffix: string) => {
        const path = `/src/session-mode/${suffix}`;
        return import(
          performance
            .getEntriesByType("resource")
            .findLast((entry) => new URL(entry.name).pathname === path)?.name ??
            path
        );
      };
      const { subagentService } = await load("features/subagents/service.ts");
      const { useSubagentStore, observeSubagents } = await load(
        "features/subagents/store.ts",
      );
      observeSubagents({
        method: "thread/started",
        params: { thread: nativeThread },
      });
      const previous = useSubagentStore.getState();
      (window as any).__sameRestrictedMetadata = {
        ...previous.nodes["identity-child-0"].thread,
        ...previous.identities["identity-child-0"].thread,
      };
      (window as any).__identityChanges = 0;
      (window as any).__identityUnsubscribe = useSubagentStore.subscribe(
        (next: any) => {
          if (
            next.nodes["identity-child-0"] !==
              previous.nodes["identity-child-0"] ||
            next.identities["identity-child-0"] !==
              previous.identities["identity-child-0"]
          )
            (window as any).__identityChanges++;
        },
      );
      (window as any).__metadataResult = undefined;
      void subagentService
        .inspectIdentity("identity-child-0")
        .then((thread: any) => {
          (window as any).__metadataResult = {
            capability: thread.canAcceptDirectInput,
          };
        })
        .catch((error: unknown) => {
          (window as any).__metadataResult = { error: String(error) };
        });
    }, f.children[0]);
    await expect.poll(() => started).toBe(true);
    await page.evaluate(async () => {
      const path = "/src/session-mode/features/subagents/store.ts";
      const { observeSubagents } = await import(
        performance
          .getEntriesByType("resource")
          .findLast((entry) => new URL(entry.name).pathname === path)?.name ??
          path
      );
      observeSubagents({
        method: "thread/started",
        params: { thread: (window as any).__sameRestrictedMetadata },
      });
    });
    expect(await page.evaluate(() => (window as any).__identityChanges)).toBe(
      0,
    );
    release();
    await expect
      .poll(() => page.evaluate(() => (window as any).__metadataResult))
      .toEqual({ capability: false });
    await expect(
      page.getByRole("textbox", { name: "发送给 Restricted", exact: true }),
    ).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).__identityChanges)).toBe(
      0,
    );
    await page.evaluate(() => (window as any).__identityUnsubscribe());
    await assertRootUnchanged(page, f, "旧权限响应不得改变主会话草稿");
    expect(f.errors).toEqual([]);
    expect(f.networkFailures).toEqual([]);
  } finally {
    await stream.close();
  }
});

for (const activity of ["v1", "v2"] as const)
  test(`${activity} communication cannot turn a native root into a restricted child`, async ({
    page,
  }) => {
    const f = await setup(page, { activity });
    const draft = `${activity} 主会话草稿`;
    await f.editor.fill(draft);
    await expect(
      page.getByText("当前子线程由主 Agent 调度，不能直接发送消息。", {
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "发送消息", exact: true }),
    ).toBeEnabled();
    await expect
      .poll(async () => (await mountedState(page)).nodes["ux-0"])
      .toBeUndefined();
    if (activity === "v1")
      expect((await mountedState(page)).nodes["ux-1"]).toBeUndefined();
    await assertRootUnchanged(page, f, draft);
    await expect.poll(() => f.pendingReads.size).toBe(0);
    f.navigationWindows.push(Date.now());
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(f.editor).toHaveText(draft);
    await expect(
      page.getByRole("button", { name: "发送消息", exact: true }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    await expect
      .poll(
        () =>
          f.fixture.calls.filter((call) =>
            call.path.endsWith("/followups/submit"),
          ).length,
      )
      .toBe(1);
    const submitted = f.fixture.calls.find((call) =>
      call.path.endsWith("/followups/submit"),
    )!.body;
    expect(submitted.threadId).toBe("ux-0");
    expect(submitted.text).toBe(draft);
    await expect(f.editor).toHaveText("");
    expect(f.errors).toEqual([]);
    expect(f.networkFailures).toEqual([]);
  });

test("old communication cache is corrected without changing drafts or the native root target", async ({
  page,
}) => {
  const f = await setup(page, { cachedWrongIdentity: true });
  const draft = "错误关系缓存纠正后仍保留的主草稿";
  await f.editor.fill(draft);
  await expect(
    page.getByRole("button", { name: "发送消息", exact: true }),
  ).toBeEnabled();
  await expect
    .poll(async () => (await mountedState(page)).nodes["ux-0"])
    .toBeUndefined();
  await assertRootUnchanged(page, f, draft);
  await expect.poll(() => f.pendingReads.size).toBe(0);
  f.navigationWindows.push(Date.now());
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(f.editor).toHaveText(draft);
  await expect(
    page.getByRole("button", { name: "发送消息", exact: true }),
  ).toBeEnabled();
  await expect
    .poll(async () => (await mountedState(page)).nodes["ux-0"])
    .toBeUndefined();
  expect(f.errors).toEqual([]);
  expect(f.networkFailures).toEqual([]);
});

test("native child false and unknown permissions stay restricted while true is independently verified", async ({
  page,
}) => {
  const f = await setup(page, { activeChildren: true });
  await f.editor.fill("检查子线程也保留主草稿");
  await page.getByRole("button", { name: /子智能体 · 已开启/ }).click();
  await page.getByRole("button", { name: "Restricted", exact: true }).click();
  await page
    .getByRole("button", { name: "返回子代理列表", exact: true })
    .click();
  for (const [index, name] of ["Restricted", "Unknown", "Allowed"].entries()) {
    await page.locator(`[data-subagent-id="identity-child-${index}"]`).click();
    const input = page.getByRole("textbox", {
      name: `发送给 ${name}`,
      exact: true,
    });
    if (index < 2) await expect(input).toHaveCount(0);
    else {
      await expect(input).toBeVisible();
      await input.fill("只属于 Allowed 子线程的草稿");
      // Native permission changes while the panel is open. The send must verify again.
      await page.route("**/api/session/subagents/verify", async (route) => {
        const body = route.request().postDataJSON();
        if (body.threadId !== "identity-child-2") return route.fallback();
        // Change the authoritative snapshot when the send's verification starts,
        // so passive fixture reconnects cannot remove the button before the click.
        f.children[2].canAcceptDirectInput = false;
        f.calls.push({ path: new URL(route.request().url()).pathname, body });
        await route.fulfill({ json: { thread: f.children[2] } });
      });
      await page
        .locator(".session-subagent-input")
        .getByRole("button", { name: "发送给 Allowed", exact: true })
        .click();
      await expect
        .poll(
          () =>
            f.calls.filter(
              (call) =>
                call.path.endsWith("/verify") &&
                call.body.threadId === "identity-child-2",
            ).length,
        )
        .toBeGreaterThan(1);
      expect(
        f.fixture.calls.filter((call) =>
          call.path.endsWith("/followups/submit"),
        ),
      ).toEqual([]);
      const stored = await page.evaluate(async () => {
        const path = "/src/session-mode/stores/useSessionDraftStore.ts";
        const { readDraft, sessionDraftKey } = await import(
          performance
            .getEntriesByType("resource")
            .findLast((entry) => new URL(entry.name).pathname === path)?.name ??
            path
        );
        return readDraft(sessionDraftKey("codex", "identity-child-2"));
      });
      expect(stored.text).toBe("只属于 Allowed 子线程的草稿");
    }
    await page
      .getByRole("button", { name: "返回子代理列表", exact: true })
      .click();
  }
  await assertRootUnchanged(page, f, "检查子线程也保留主草稿");
  expect(f.errors).toEqual([]);
  expect(f.networkFailures).toEqual([]);
});

test("unknown cached identity can be checked read-only without resume or changing the main draft", async ({
  page,
}) => {
  const f = await setup(page, { cachedWrongIdentity: true, unknownRoot: true });
  const draft = "只读核对前后原会话独立草稿";
  await f.editor.fill(draft);
  await expect(
    page.getByRole("button", { name: "发送消息", exact: true }),
  ).toBeDisabled();
  await expect(page.locator(".session-codex-composer")).not.toContainText(
    "当前子线程由主 Agent 调度",
  );
  const retry = page
    .locator(".session-codex-composer")
    .getByRole("button", { name: "重新核对", exact: true });
  await expect(retry).toBeVisible();
  const before = f.calls.filter((call) =>
    call.path.endsWith("/metadata"),
  ).length;
  f.root.source = "vscode";
  await retry.click();
  await expect
    .poll(
      () => f.calls.filter((call) => call.path.endsWith("/metadata")).length,
    )
    .toBeGreaterThan(before);
  await expect(
    page.getByRole("button", { name: "发送消息", exact: true }),
  ).toBeEnabled();
  await assertRootUnchanged(page, f, draft);
  expect(f.errors).toEqual([]);
  expect(f.networkFailures).toEqual([]);
});

for (const width of [1440, 375])
  test(`${width}px owned loaded-only details never cover transcript or disable the composer`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const f = await setup(page, {
      access: {
        state: "owned",
        reason: "仍有已加载的子 Agent，等待其退出后释放",
        generation: 1,
      },
    });
    const draft = "实例保留也可以编辑的主草稿";
    await f.editor.fill(draft);
    await expect(
      page.locator(".session-agent-view .session-access-notice"),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "发送消息", exact: true }),
    ).toBeEnabled();
    await expect(
      page.getByRole("button", { name: /子智能体 · 已开启/ }),
    ).toHaveCount(0);
    await composerAction(page, "当前会话的更多操作");
    await page
      .getByRole("menuitem", { name: "查看执行状态", exact: true })
      .click();
    await page.keyboard.press("Escape");
    await expect(
      page.getByText("本项目保留执行实例", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("仍有已加载的子 Agent，等待其退出后释放", { exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const editorBox = await f.editor.boundingBox();
    const detailsBox = await page
      .getByText("仍有已加载的子 Agent，等待其退出后释放", { exact: true })
      .boundingBox();
    expect(editorBox).not.toBeNull();
    expect(detailsBox).not.toBeNull();
    expect(
      detailsBox!.y + detailsBox!.height <= editorBox!.y ||
        detailsBox!.y >= editorBox!.y + editorBox!.height,
    ).toBe(true);
    const messageBox = await page
      .getByText("主会话已完成，正文与草稿应正常保留。", { exact: true })
      .boundingBox();
    expect(messageBox).not.toBeNull();
    const overlapsBody =
      detailsBox!.x < messageBox!.x + messageBox!.width &&
      detailsBox!.x + detailsBox!.width > messageBox!.x &&
      detailsBox!.y < messageBox!.y + messageBox!.height &&
      detailsBox!.y + detailsBox!.height > messageBox!.y;
    expect(overlapsBody).toBe(false);
    await assertRootUnchanged(page, f, draft);
    expect(f.errors).toEqual([]);
    expect(f.networkFailures).toEqual([]);
  });
