import { test, expect, type Page } from "@playwright/test";
import { installSessionUxFixture } from "./session-ux-fixture";
import { openComposerStatus } from "./session-composer-actions";
import { liveStream } from "./session-sse-fixture";
import { writeFileSync } from "node:fs";
async function openInspection(page: Page, list = true) {
  const summary = page.locator(".session-subagent-summary");
  const expand = summary.getByRole("button", { name: /子智能体 · 已开启/ });
  if (await expand.isVisible()) {
    if ((await expand.getAttribute("aria-expanded")) !== "true")
      await expand.click();
    await summary.locator(":scope > button").first().click();
  } else {
    const process = page
      .getByRole("button", { name: /^工作过程$|^用时/ })
      .first();
    await process.click();
    const created = page
      .getByRole("button", { name: /已创建.*个智能体/ })
      .first();
    if ((await created.getAttribute("aria-expanded")) !== "true")
      await created.click();
    await page
      .locator(".codex-activity-body")
      .getByRole("button", { name: "Atlas", exact: true })
      .click();
  }
  if (list)
    await page
      .getByRole("button", { name: "返回子代理列表", exact: true })
      .click();
}
async function closeInspection(page: Page) {
  const panel = page.locator(".session-subagent-panel");
  const back = panel.getByRole("button", {
    name: "返回子代理列表",
    exact: true,
  });
  if (await back.isVisible()) await back.click();
  await panel.getByRole("button").first().focus();
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
}
async function setup(
  page: Page,
  options: {
    oldRound?: boolean;
    approval?: boolean;
    poisonedRoot?: boolean;
  } = {},
) {
  const fixture = await installSessionUxFixture(page, 2),
    calls: any[] = [];
  const errorEvents: Array<{ text: string; at: number; kind: string }> = [],
    navigationAborts: number[] = [];
  const expectedMetadata404 = new Set<string>();
  const metadataResponses: Array<{
    threadId: string;
    status: number;
    at: number;
    path: string;
  }> = [];
  page.on("response", (response) => {
    const path = new URL(response.url()).pathname;
    if (!path.endsWith("/thread/metadata") || response.status() !== 404) return;
    const body = response.request().postDataJSON();
    metadataResponses.push({
      threadId: body.threadId,
      status: response.status(),
      at: Date.now(),
      path,
    });
  });
  const pendingReads = new Set<import("@playwright/test").Request>();
  page.on("request", (r) => {
    if (/\/thread\/(read|turns\/list)$/.test(new URL(r.url()).pathname))
      pendingReads.add(r);
  });
  page.on("requestfinished", (r) => pendingReads.delete(r));
  page.on("requestfailed", (r) => {
    if (pendingReads.has(r) && r.failure()?.errorText === "net::ERR_ABORTED")
      navigationAborts.push(Date.now());
    pendingReads.delete(r);
  });
  const errors = () =>
    errorEvents
      .filter(
        (e) =>
          !(
            e.kind === "console" &&
            e.text.includes(
              "[CodexService] threadResume error: TypeError: Failed to fetch",
            ) &&
            navigationAborts.some((at) => Math.abs(at - e.at) < 100)
          ) &&
          !(
            e.kind === "console" &&
            e.text ===
              "Failed to load resource: the server responded with a status of 404 (Not Found)" &&
            metadataResponses.some(
              (response) =>
                expectedMetadata404.has(response.threadId) &&
                Math.abs(response.at - e.at) < 100,
            )
          ),
      )
      .map((e) => e.text);
  page.on("pageerror", (e) =>
    errorEvents.push({ text: e.message, at: Date.now(), kind: "pageerror" }),
  );
  page.on("console", (m) => {
    if (
      m.type() === "error" &&
      !m.text().startsWith("[vite]") &&
      !m.text().includes("AbortError")
    )
      errorEvents.push({
        text: m.text().slice(0, 1500),
        at: Date.now(),
        kind: "console",
      });
  });
  const now = Math.floor(Date.now() / 1000);
  if (options.poisonedRoot) {
    Object.assign(fixture.threads[0], {
      source: "cli",
      parentThreadId: null,
      canAcceptDirectInput: true,
    });
    await page.addInitScript(() => {
      const key = `kanban.session.subagent-families:${location.origin}`;
      // Seed once: reload must exercise the repaired persisted state.
      if (localStorage.getItem(key)) return;
      localStorage.setItem(
        key,
        JSON.stringify({
          version: 1,
          state: {
            nodes: {
              "ux-0": {
                thread: { id: "ux-0", canAcceptDirectInput: false },
                parentId: "child-atlas",
                verified: false,
                revision: 1,
              },
            },
            selection: {},
            panelRoot: null,
          },
        }),
      );
    });
  }
  const children: any[] = [
    {
      id: "child-atlas",
      parentThreadId: "ux-0",
      agentNickname: "Atlas",
      agentRole: "explorer",
      canAcceptDirectInput: true,
      status: { type: "active" },
      preview: "检查状态同步",
      cwd: fixture.threads[0].cwd,
      createdAt: now - 5,
      updatedAt: now,
      turns: [
        {
          id: "atlas-turn",
          status: "inProgress",
          startedAt: now - 5,
          durationMs: null,
          completedAt: null,
          items: [],
        },
      ],
    },
    {
      id: "child-iris",
      parentThreadId: "ux-0",
      agentNickname: "Iris",
      agentRole: "reviewer",
      canAcceptDirectInput: false,
      status: { type: "active" },
      preview: "检查审批路由",
      cwd: fixture.threads[0].cwd,
      createdAt: now - 5,
      updatedAt: now,
      turns: [
        {
          id: "iris-turn",
          status: "inProgress",
          startedAt: now - 5,
          durationMs: null,
          completedAt: null,
          items: [],
        },
      ],
    },
    {
      id: "child-echo",
      parentThreadId: "child-atlas",
      agentNickname: "Echo",
      canAcceptDirectInput: false,
      status: { type: "idle" },
      preview: "嵌套任务",
      cwd: fixture.threads[0].cwd,
      turns: [{ id: "echo-turn", status: "completed", items: [] }],
    },
  ];
  for (const child of children)
    child.source = {
      subAgent: { thread_spawn: { parent_thread_id: child.parentThreadId } },
    };
  (fixture.threads[0] as any).turns = [
    {
      id: "parent-turn",
      status: "completed",
      startedAt: now - 8,
      completedAt: now - 5,
      durationMs: 3000,
      items: [
        {
          id: "spawn",
          type: "collabAgentToolCall",
          tool: "spawnAgent",
          status: "completed",
          senderThreadId: "ux-0",
          receiverThreadIds: children.slice(0, 2).map((c) => c.id),
          prompt: "并行检查",
          agentsStates: {},
          model: "fixture-model",
          reasoningEffort: "high",
        },
      ],
    },
  ];
  if (options.oldRound) {
    const spawn = (fixture.threads[0] as any).turns[0].items[0];
    (fixture.threads[0] as any).turns = [
      {
        id: "old-parent",
        status: "completed",
        items: [
          { ...spawn, id: "old-spawn", receiverThreadIds: ["child-iris"] },
        ],
      },
      {
        id: "parent-turn",
        status: "completed",
        items: [{ ...spawn, receiverThreadIds: ["child-atlas"] }],
      },
    ];
  }
  const discovery = {
    complete: true,
    errors: [] as string[],
    unavailableIds: [] as string[],
  };
  if (options.approval)
    await page.route("**/api/session/api/events**", (r) =>
      r.fulfill({
        contentType: "text/event-stream",
        body: `data: ${JSON.stringify({ seq: 0, event: "codex/pending-requests-snapshot", payload: { requests: [{ event: "codex/approval-request", payload: { type: "commandExecution", threadId: "child-iris", turnId: "iris-turn", itemId: "cmd-iris", requestId: 17, command: ["pwd"], cwd: fixture.threads[0].cwd, reason: "子线程审批验收", proposedExecpolicyAmendment: null, startedAtMs: 1 } }] } })}\n\n`,
      }),
    );
  const cards = fixture.threads.map((t) => ({
    kind: "codex",
    id: t.id,
    cwd: t.cwd,
    preview: t.name,
  }));
  await page.route("**/api/session/tabs", (r) =>
    r.fulfill({ json: { cards, initialized: true, revision: 1, sequence: 0 } }),
  );
  await page.addInitScript((cards) => {
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
  }, cards);
  await page.route("**/api/session/subagents/**", async (r) => {
    const body = r.request().postDataJSON(),
      path = new URL(r.request().url()).pathname;
    calls.push({ body, path });
    if (path.endsWith("snapshot"))
      return r.fulfill({
        json: {
          threads: body.rootId === "ux-0" ? children : [],
          ...discovery,
          checkedAt: Date.now(),
        },
      });
    if (path.endsWith("verify"))
      return r.fulfill({
        json: { thread: children.find((c) => c.id === body.threadId) },
      });
    if (path.endsWith("roles"))
      return r.fulfill({
        json: { roles: [{ name: "reviewer", description: "审查变更" }] },
      });
    return r.fulfill({
      json: {
        results: body.targets.map((t: any) => ({ ...t, phase: "requested" })),
      },
    });
  });
  await page.route(
    /\/api\/session\/api\/codex\/thread\/metadata(?:\?.*)?$/,
    async (r) => {
      const body = r.request().postDataJSON(),
        child = children.find((c) => c.id === body.threadId);
      if (!child) return r.fallback();
      calls.push({ body, path: new URL(r.request().url()).pathname });
      const { turns: _turns, ...metadata } = child;
      return r.fulfill({ json: { thread: metadata } });
    },
  );
  await page.route(
    /\/api\/session\/api\/codex\/thread\/read(?:\?.*)?$/,
    async (route) => {
      const body = route.request().postDataJSON();
      const child = children.find((thread) => thread.id === body.threadId);
      if (!child) return route.fallback();
      // The generic fixture fabricates a main thread for unknown IDs. Child
      // history must retain its real parent/source identity after it is opened.
      return route.fulfill({ json: { thread: child } });
    },
  );
  await page.route(
    /\/api\/session\/api\/codex\/thread\/turns\/list(?:\?.*)?$/,
    async (r) => {
      const body = r.request().postDataJSON(),
        child = children.find((c) => c.id === body.threadId);
      if (!child) return r.fallback();
      return r.fulfill({ json: { data: child.turns, nextCursor: null } });
    },
  );
  await page.route("**/api/session/files/upload", (r) =>
    r.fulfill({ json: { path: "/fixture/child-draft.png" } }),
  );
  await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
  const editor = page
    .locator(".session-agent-view [contenteditable=true]")
    .first();
  await editor.waitFor({ timeout: 8000 }).catch((e) => {
    console.log(errors());
    throw e;
  });
  await page
    .locator('[role=tab][data-tab-key="codex:ux-0"] .session-identity-title')
    .click();
  await expect(
    page.locator('[role=tab][data-tab-key="codex:ux-0"]'),
  ).toHaveAttribute("aria-selected", "true");
  await openInspection(page);
  (page as any).sessionOptFixture = {
    calls,
    get errors() {
      return errors();
    },
    navigationAborts,
    metadataResponses,
    get expectedMetadataThreadIds() {
      return [...expectedMetadata404];
    },
  };
  return {
    fixture,
    calls,
    get errors() {
      return errors();
    },
    editor,
    children,
    discovery,
    pendingReads,
    metadataResponses,
    expectedMetadata404,
    errorEvents,
  };
}
test.afterEach(async ({ page }, info) => {
  if (info.status === info.expectedStatus) return;
  const data = await page.evaluate(async () => {
    const module = async (suffix: string) =>
      import(
        performance
          .getEntriesByType("resource")
          .findLast((e) => e.name.includes(suffix))?.name ??
          `/src/session-mode/${suffix}`
      );
    const { useSubagentStore } = await module("features/subagents/store.ts");
    const { useCodexStore } = await module("components/codex/stores/index.ts");
    const s = useSubagentStore.getState(),
      c = useCodexStore.getState();
    return {
      selection: s.selection,
      families: s.families,
      scope: s.scope,
      nodes: s.nodes,
      epoch: s.runtimeEpoch,
      currentThread: c.currentThreadId,
      timing: c.turnTimingMap,
      events: c.events,
    };
  });
  await info.attach("subagent-failure-state", {
    body: JSON.stringify({ data, ...(page as any).sessionOptFixture }, null, 2),
    contentType: "application/json",
  });
});
test("native root recovers from a persisted false child restriction and stays sendable after reload", async ({
  page,
}) => {
  const f = await setup(page, { poisonedRoot: true });
  await closeInspection(page);
  await f.editor.fill("主会话新的草稿");
  const warning = page.getByText(
    "当前子线程由主 Agent 调度，不能直接发送消息。",
    { exact: true },
  );
  await expect(warning).toHaveCount(0);
  const send = page.getByRole("button", { name: "发送消息", exact: true });
  await expect(send).toBeEnabled();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const cached = JSON.parse(
          localStorage.getItem(
            `kanban.session.subagent-families:${location.origin}`,
          ) ?? "{}",
        );
        return !!cached.state?.nodes?.["ux-0"];
      }),
    )
    .toBe(false);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(f.editor).toHaveText("主会话新的草稿");
  await expect(warning).toHaveCount(0);
  await expect(send).toBeEnabled();
  await send.click();
  await expect
    .poll(
      () =>
        f.fixture.calls.filter((c) => c.path.endsWith("/followups/submit"))
          .length,
    )
    .toBe(1);
  expect(
    f.fixture.calls.find((c) => c.path.endsWith("/followups/submit"))!.body,
  ).toMatchObject({
    threadId: "ux-0",
    text: "主会话新的草稿",
  });
  expect(f.errors).toEqual([]);
});
test("child inspection preserves parent input and project; native V2 child is read-only", async ({
  page,
}) => {
  const f = await setup(page);
  await f.editor.fill("主会话草稿保留");
  await page
    .locator('[data-subagent-id="child-iris"]')
    .click({ timeout: 10000 })
    .catch(async (error) => {
      const stores = await page.evaluate(async () => {
        const module = async (suffix: string) =>
          import(
            performance
              .getEntriesByType("resource")
              .findLast((e) => e.name.includes(suffix))?.name ??
              `/src/session-mode/${suffix}`
          );
        const { useSubagentStore } = await module(
          "features/subagents/store.ts",
        );
        const { useCodexStore } = await module(
          "components/codex/stores/index.ts",
        );
        const s = useSubagentStore.getState(),
          c = useCodexStore.getState();
        return {
          selection: s.selection,
          families: s.families,
          scope: s.scope,
          nodes: s.nodes,
          currentThread: c.currentThreadId,
          timing: c.turnTimingMap,
          events: c.events,
        };
      });
      await test.info().attach("subagent-first-open-state", {
        body: JSON.stringify(
          { stores, calls: f.calls, errors: f.errors },
          null,
          2,
        ),
        contentType: "application/json",
      });
      throw error;
    });
  await expect(page.getByText("由主 Agent 调度 · 子线程只读")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "在主会话中跟进 Iris" }),
  ).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "发送给 Iris" })).toHaveCount(
    0,
  );
  await page.screenshot({
    path: ".dev-runtime/subagent-tests/desktop-detail.png",
    fullPage: true,
  });
  await expect(f.editor).toContainText("主会话草稿保留");
  expect(
    f.fixture.calls.filter((c) => /thread\/resume|turn\/start/.test(c.path)),
  ).toEqual([]);
  await expect(
    page.locator('[role=tab][data-tab-key="codex:ux-0"]'),
  ).toHaveAttribute("aria-selected", "true");
  expect(f.errors).toEqual([]);
});
test("interactive child draft and image restore after refresh without changing the main target", async ({
  page,
}) => {
  const f = await setup(page);
  await f.editor.fill("主草稿");
  await page.locator('[data-subagent-id="child-atlas"]').click();
  const childDraft = page.getByRole("textbox", {
    name: "发送给 Atlas",
    exact: true,
  });
  await childDraft.fill("子草稿输入一半");
  await page.locator(".session-subagent-input input[type=file]").setInputFiles({
    name: "draft.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF5cAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await expect(page.locator(".session-subagent-input")).toContainText("ready");
  await closeInspection(page);
  await openInspection(page, false);
  await expect(childDraft).toHaveValue("子草稿输入一半");
  // This case verifies durable drafts after completed reads; navigation-aborted
  // background reads are exercised separately from page runtime errors.
  await expect.poll(() => f.pendingReads.size).toBe(0);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(childDraft)
    .toHaveValue("子草稿输入一半")
    .catch(async (error) => {
      const stores = await page.evaluate(async () => {
        const module = async (suffix: string) =>
          import(
            performance
              .getEntriesByType("resource")
              .findLast((e) => e.name.includes(suffix))?.name ??
              `/src/session-mode/${suffix}`
          );
        const { useSubagentStore } = await module(
          "features/subagents/store.ts",
        );
        const { useCodexStore } = await module(
          "components/codex/stores/useCodexStore.ts",
        );
        const s = useSubagentStore.getState(),
          c = useCodexStore.getState();
        return {
          selection: s.selection,
          families: s.families,
          scope: s.scope,
          nodes: s.nodes,
          currentThread: c.currentThreadId,
          timing: c.turnTimingMap,
          storage: Object.keys(localStorage)
            .filter((k) => k.includes("subagent"))
            .map((k) => [k, localStorage.getItem(k)]),
        };
      });
      await test.info().attach("subagent-reload-state", {
        body: JSON.stringify(
          { stores, calls: f.calls, errors: f.errors },
          null,
          2,
        ),
        contentType: "application/json",
      });
      throw error;
    });
  await expect(page.locator(".session-subagent-input")).toContainText(
    "draft.png",
  );
  await expect(f.editor).toHaveText("主草稿");
  expect(f.errors).toEqual([]);
});
test("role mentions retain native identity in a parent submission; the panel does not stop children", async ({
  page,
}) => {
  const f = await setup(page);
  const panel = page.locator(".session-subagent-panel");
  await expect(panel.getByRole("heading", { name: /已开启/ })).toBeVisible();
  await expect(panel.getByRole("button", { name: /停止/ })).toHaveCount(0);
  await expect(panel.getByLabel("搜索子任务")).toHaveCount(0);
  await closeInspection(page);
  await page.getByRole("button", { name: "附加文件", exact: true }).click();
  await page.getByRole("button", { name: "引用子 Agent 或配置角色" }).click();
  await page
    .locator(".session-agent-mention-menu")
    .getByRole("button", { name: "reviewer" })
    .click();
  await f.editor.fill("请审查变更");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect
    .poll(
      () =>
        f.fixture.calls.filter((c) => c.path.endsWith("/followups/submit"))
          .length,
    )
    .toBe(1);
  expect(
    f.fixture.calls.find((c) => c.path.endsWith("/followups/submit"))!.body
      .mentions,
  ).toEqual([{ name: "reviewer", path: "subagent://reviewer" }]);
  expect(f.errors).toEqual([]);
});
test("mobile child panel returns using the same entry and preserves input", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const f = await setup(page);
  await page.locator('[data-subagent-id="child-iris"]').click();
  await page
    .getByRole("button", { name: "返回子代理列表", exact: true })
    .click();
  await expect(page.locator('[data-subagent-id="child-atlas"]')).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: ".dev-runtime/subagent-tests/mobile-list.png",
    fullPage: true,
  });
  expect(f.errors).toEqual([]);
});

test("active and done sections list every descendant without a round filter", async ({
  page,
}) => {
  const f = await setup(page, { oldRound: true });
  const panel = page.locator(".session-subagent-panel");
  await expect(
    panel.getByRole("heading", { name: /已开启 · 2/ }),
  ).toBeVisible();
  await expect(panel.locator('[data-subagent-id="child-atlas"]')).toBeVisible();
  await expect(panel.locator('[data-subagent-id="child-iris"]')).toBeVisible();
  await expect(panel.getByRole("heading", { name: /完成 · 1/ })).toBeVisible();
  await expect(panel.locator('[data-subagent-id="child-echo"]')).toBeVisible();
  await expect(
    panel.getByRole("button", { name: /本轮|全部历史|收起后代/ }),
  ).toHaveCount(0);
  expect(f.calls.filter((c) => c.path.endsWith("/stop"))).toEqual([]);
  expect(f.errors).toEqual([]);
});
test("a finished family leaves the composer summary hidden and shows the empty panel", async ({
  page,
  baseURL,
}) => {
  const stream = await liveStream(page, baseURL!);
  try {
    const f = await setup(page);
    await closeInspection(page);
    const refresh = () =>
      page.evaluate(async () => {
        const path = "/src/session-mode/features/subagents/service.ts";
        const service = await import(
          performance
            .getEntriesByType("resource")
            .findLast((entry) => new URL(entry.name).pathname === path)?.name ??
            path
        );
        await service.subagentService.refresh("ux-0");
      });
    // Settle initial discovery before changing the authoritative fixture snapshot.
    await refresh();
    await expect.poll(() => stream.connections()).toBeGreaterThan(0);
    let seq = 1;
    for (const child of f.children) {
      const previous = child.turns.at(-1);
      const turn = {
        ...previous,
        status: "completed",
        startedAt: previous.startedAt ?? 1,
        completedAt: 2,
      };
      Object.assign(child, { status: { type: "idle" }, turns: [turn] });
      stream.emit(seq++, {
        method: "turn/completed",
        params: { threadId: child.id, turn },
      });
    }
    await refresh();
    await expect(
      page.getByRole("button", { name: /子智能体 · 已开启/ }),
    ).toHaveCount(0);
    await openInspection(page);
    const panel = page.locator(".session-subagent-panel");
    await expect(panel.getByText("已开启 · 0", { exact: true })).toBeVisible();
    await expect(panel.getByText("没有已开启的子代理")).toBeVisible();
    await expect(
      panel.getByRole("heading", { name: "完成 · 3", exact: true }),
    ).toBeVisible();
    expect(f.errors).toEqual([]);
  } finally {
    await stream.close();
  }
});
test("incomplete discovery retains unavailable identities and avoids claiming completion", async ({
  page,
}) => {
  const f = await setup(page);
  f.expectedMetadata404.add("child-atlas");
  f.children.splice(
    f.children.findIndex((c) => c.id === "child-atlas"),
    1,
  );
  f.discovery.complete = false;
  f.discovery.errors = ["fixture history unavailable"];
  f.discovery.unavailableIds = ["child-atlas"];
  await closeInspection(page);
  await openInspection(page);
  await expect(page.locator('[data-subagent-id="child-atlas"]')).toContainText(
    "待确认",
  );
  await expect(
    page.getByRole("heading", { name: "已开启 · 待确认", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const path = "/src/session-mode/features/subagents/store.ts";
        const { useSubagentStore } = await import(
          performance
            .getEntriesByType("resource")
            .findLast((entry) => new URL(entry.name).pathname === path)?.name ??
            path
        );
        const node = useSubagentStore.getState().nodes["child-atlas"];
        return (
          node && {
            id: node.thread.id,
            parentId: node.parentId,
            unavailable: node.unavailable,
            canAcceptDirectInput: node.thread.canAcceptDirectInput,
          }
        );
      }),
    )
    .toEqual({
      id: "child-atlas",
      parentId: "ux-0",
      unavailable: true,
      canAcceptDirectInput: null,
    });
  await expect(
    page.getByText("此子智能体在当前分支上已不可用。", { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: /已开启 · 0/ })).toHaveCount(
    0,
  );
  expect(f.errors).toEqual([]);
  expect(
    f.metadataResponses.filter(
      (response) =>
        response.threadId === "child-atlas" && response.status === 404,
    ).length,
  ).toBeGreaterThan(0);
  expect(
    f.fixture.calls.filter((call) =>
      /thread\/(resume|start)|turn\/(start|interrupt)/.test(call.path),
    ),
  ).toEqual([]);
  writeFileSync(
    test.info().outputPath("expected-metadata-404.json"),
    JSON.stringify(
      {
        expectedThreadIds: [...f.expectedMetadata404],
        responses: f.metadataResponses,
        observedErrors: f.errorEvents,
        unexpectedErrors: f.errors,
        mutationCalls: f.fixture.calls.filter((call) =>
          /thread\/(resume|start)|turn\/(start|interrupt)/.test(call.path),
        ),
      },
      null,
      2,
    ),
  );
});
test("nested descendants stay in the flat list and detail selection survives parent tab switching", async ({
  page,
}) => {
  const f = await setup(page);
  await expect(page.locator('[data-subagent-id="child-echo"]')).toBeVisible();
  await page.locator('[data-subagent-id="child-echo"]').click();
  await expect(page.getByRole("heading", { name: "Echo" })).toBeVisible();
  await expect(page.locator(".session-subagent-panel")).not.toContainText(
    "Atlas / Echo",
  );
  await page.locator('[role=tab][data-tab-key="codex:ux-1"]').click();
  await expect(page.locator(".session-subagent-panel")).toHaveCount(0);
  await page.locator('[role=tab][data-tab-key="codex:ux-0"]').click();
  await expect(page.getByRole("heading", { name: "Echo" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-subagent-id="child-echo"]')).toBeFocused();
  expect(f.errors).toEqual([]);
});
test("restricted child approval replies retain the child's RPC identity after parent completion", async ({
  page,
}) => {
  const f = await setup(page, { approval: true });
  await page.locator('[data-subagent-id="child-iris"]').click();
  // Native approval cards keep the reason visible, including read-only child panes.
  await expect(
    page
      .locator(".session-subagent-panel")
      .getByText("子线程审批验收", { exact: true }),
  ).toBeVisible();
  await page
    .locator(".session-subagent-panel")
    .getByRole("button", { name: /拒绝|Decline/ })
    .click();
  await expect
    .poll(
      () =>
        f.fixture.calls.filter((c) =>
          /approval\/command-execution/.test(c.path),
        ).length,
    )
    .toBe(1);
  const reply = f.fixture.calls.find((c) =>
    /approval\/command-execution/.test(c.path),
  )!;
  expect(reply.body.request_id).toBe(17);
  expect(reply.body.request).toEqual({
    threadId: "child-iris",
    requestId: 17,
    turnId: "iris-turn",
    itemId: "cmd-iris",
  });
  expect(reply.body.decision).toBe("decline");
  expect(
    f.fixture.calls.filter((c) => /thread\/resume|turn\/start/.test(c.path)),
  ).toEqual([]);
  expect(f.errors).toEqual([]);
});

test("light theme keeps the parent draft and does not offer panel stop results", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "kanban.session.theme-storage",
      JSON.stringify({
        version: 0,
        state: { theme: "light", accent: "default" },
      }),
    ),
  );
  const f = await setup(page);
  await f.editor.fill("浅色主草稿");
  await expect(
    page
      .locator(".session-subagent-panel")
      .getByRole("button", { name: /停止/ }),
  ).toHaveCount(0);
  await expect(page.locator(".session-subagent-results")).toHaveCount(0);
  await expect(f.editor).toHaveText("浅色主草稿");
  await page.screenshot({
    path: ".dev-runtime/subagent-tests/light-results.png",
    fullPage: true,
  });
  expect(f.errors).toEqual([]);
});

test("unconfirmed inspection can be retried without granting child input or changing the parent", async ({
  page,
}) => {
  const f = await setup(page);
  await f.editor.fill("验证失败也保留主草稿");
  await page.route("**/api/session/subagents/verify", (r) =>
    r.fulfill({
      json: { thread: { id: "foreign", canAcceptDirectInput: true } },
    }),
  );
  await page.locator('[data-subagent-id="child-atlas"]').click();
  await expect(
    page.locator(".session-subagent-panel").getByRole("alert"),
  ).toContainText("身份尚未确认");
  await expect(
    page.getByRole("textbox", { name: "发送给 Atlas", exact: true }),
  ).toHaveCount(0);
  await page.unroute("**/api/session/subagents/verify");
  await page.getByRole("button", { name: "重新确认所属关系" }).click();
  await expect(
    page.getByRole("textbox", { name: "发送给 Atlas", exact: true }),
  ).toBeVisible();
  await expect(f.editor).toHaveText("验证失败也保留主草稿");
  expect(
    f.fixture.calls.filter((c) => /thread\/resume|turn\/start/.test(c.path)),
  ).toEqual([]);
  expect(f.errors).toEqual([]);
});

test("allowed child submission sends its own target and native settings while preserving the parent", async ({
  page,
}) => {
  const f = await setup(page);
  f.children[0].model = "child-specific-model";
  f.children[0].reasoningEffort = "medium";
  await f.editor.fill("主会话继续保留");
  await page.locator('[data-subagent-id="child-atlas"]').click();
  await page
    .getByRole("textbox", { name: "发送给 Atlas", exact: true })
    .fill("子线程继续");
  await page
    .locator(".session-subagent-input")
    .getByRole("button", { name: "发送给 Atlas", exact: true })
    .click();
  await expect
    .poll(
      () =>
        f.fixture.calls.filter((c) => c.path.endsWith("/followups/submit"))
          .length,
    )
    .toBe(1);
  const submitted = f.fixture.calls.find((c) =>
    c.path.endsWith("/followups/submit"),
  )!.body;
  expect(submitted.threadId).toBe("child-atlas");
  expect(submitted.text).toBe("子线程继续");
  expect(submitted.parameters).toEqual({
    cwd: f.children[0].cwd,
    model: "child-specific-model",
    effort: "medium",
  });
  await expect(
    page.getByRole("textbox", { name: "发送给 Atlas", exact: true }),
  ).toHaveValue("");
  await expect(f.editor).toHaveText("主会话继续保留");
  await expect(
    page.locator('[role=tab][data-tab-key="codex:ux-0"]'),
  ).toHaveAttribute("aria-selected", "true");
  expect(f.errors).toEqual([]);
});

test("a restored agent preference cannot hide the selected Codex family's inspector", async ({
  page,
}) => {
  const f = await setup(page);
  await page.evaluate(async () => {
    const path = "/src/session-mode/stores/useAgentSettingsStore.ts";
    const { useAgentSettingsStore } = await import(
      performance
        .getEntriesByType("resource")
        .findLast((e) => new URL(e.name).pathname === path)?.name ?? path
    );
    useAgentSettingsStore.setState({ selectedAgent: "cc" });
  });
  await expect(page.locator('[data-subagent-id="child-atlas"]')).toBeVisible();
  await page.locator('[data-subagent-id="child-iris"]').click();
  await expect(page.locator(".session-subagent-panel")).toContainText("Iris");
  expect(f.errors).toEqual([]);
});

test("background batch stop confirms only this round and rejects a stale confirmation", async ({
  page,
}) => {
  const f = await setup(page, { oldRound: true });
  await expect(page.locator(".session-subagent-panel")).toBeVisible();
  await openComposerStatus(page);
  await page
    .locator(".session-background-agents button[aria-expanded]")
    .click();
  await page.getByRole("button", { name: "全部停止", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "停止本轮子智能体" });
  await expect(dialog).toContainText("Atlas");
  await expect(dialog).not.toContainText("Iris");
  expect(f.calls.filter((c) => c.path.endsWith("/stop"))).toEqual([]);
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  expect(f.calls.filter((c) => c.path.endsWith("/stop"))).toEqual([]);
  await page.getByRole("button", { name: "全部停止", exact: true }).click();
  await page.evaluate(async () => {
    const path = "/src/session-mode/components/codex/stores/index.ts";
    const { useCodexStore } = await import(
      performance
        .getEntriesByType("resource")
        .findLast((e) => new URL(e.name).pathname === path)?.name ?? path
    );
    useCodexStore.setState((s) => ({
      turnTimingMap: {
        ...s.turnTimingMap,
        "ux-0": { ...s.turnTimingMap["ux-0"], turnId: "next-parent-round" },
      },
    }));
  });
  await dialog.getByRole("button", { name: "确认停止", exact: true }).click();
  await expect(
    page.getByText("任务范围已变化，请重新确认停止名单", { exact: true }),
  ).toBeVisible();
  expect(f.calls.filter((c) => c.path.endsWith("/stop"))).toEqual([]);
  expect(f.errors).toEqual([]);
});

test("an old batch-stop confirmation stays invalid after the scope returns", async ({
  page,
}) => {
  const f = await setup(page, { oldRound: true });
  await expect(page.locator(".session-subagent-panel")).toBeVisible();
  await openComposerStatus(page);
  await page
    .locator(".session-background-agents button[aria-expanded]")
    .click();
  await page.getByRole("button", { name: "全部停止", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "停止本轮子智能体" });
  await expect(dialog).toContainText("Atlas");
  await page.evaluate(async () => {
    const path = "/src/session-mode/components/codex/stores/index.ts";
    const { useCodexStore } = await import(
      performance
        .getEntriesByType("resource")
        .findLast((e) => new URL(e.name).pathname === path)?.name ?? path
    );
    const timing = useCodexStore.getState().turnTimingMap;
    useCodexStore.setState({
      turnTimingMap: {
        ...timing,
        "ux-0": { ...timing["ux-0"], turnId: "next-parent-round" },
      },
    });
    useCodexStore.setState({ turnTimingMap: timing });
  });
  await dialog.getByRole("button", { name: "确认停止", exact: true }).click();
  await expect(
    page.getByText("任务范围已变化，请重新确认停止名单", { exact: true }),
  ).toBeVisible();
  expect(f.calls.filter((c) => c.path.endsWith("/stop"))).toEqual([]);
  expect(f.errors).toEqual([]);
});
