import { expect, test, type CDPSession, type Page } from "@playwright/test";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";
import { liveStream } from "./session-sse-fixture";

const THREAD_LIST = ".session-mode [role=button]";

async function openConversationAction(page: Page, label: string) {
  const composer = page.locator(".session-codex-composer:visible");
  const menu = page.getByRole("button", {
    name: "当前会话的更多操作",
    exact: true,
  });
  if (!(await menu.isVisible()))
    await composer.getByRole("button", { name: "附加文件", exact: true }).click();
  await menu.click();
  await page.getByRole("menuitem", { name: label, exact: true }).click();
}

test("Codex thread row and context-menu rename use typed receipts and preserve a newer target", async ({
  page,
}) => {
  test.setTimeout(90000);
  const fixture = await installSessionUxFixture(page, 3);
  const renameRequests: Array<{ method: string; body: any }> = [];
  let releaseLateReject: (() => void) | undefined;
  let delayedRenameArrived!: (body: any) => void;
  const delayedRename = new Promise<any>((resolve) => {
    delayedRenameArrived = resolve;
  });
  const lateReject = new Promise<void>((resolve) => {
    releaseLateReject = resolve;
  });

  await page.route("**/api/session/lifecycle/rename", async (route) => {
    const method = route.request().method();
    const body = method === "POST" ? route.request().postDataJSON() : null;
    renameRequests.push({ method, body });
    if (method === "GET") {
      const url = new URL(route.request().url());
      await route.fulfill({
        json: {
          operationId: url.searchParams.get("operationId"),
          threadId: url.searchParams.get("threadId"),
          status: "rejected",
          error: "fixture receipt says rejected",
        },
      });
      return;
    }
    if (body?.threadId === "ux-1" && body?.name === "迟到失败名称") {
      delayedRenameArrived(body);
      await lateReject;
      await route.fulfill({
        json: {
          operationId: body.operationId,
          threadId: body.threadId,
          status: "rejected",
          error: "fixture late refusal",
        },
      });
      return;
    }
    await route.fulfill({
      json: {
        operationId: body?.operationId,
        threadId: body?.threadId,
        status: "accepted",
      },
    });
  });

  try {
    await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
    await page.locator(".session-mode [contenteditable=true]").first().waitFor();
    await seedSessionUx(page, 3, { sidebarOpen: true });
    const row = (index: number) =>
      page.locator(".session-mode .session-nav-row").nth(index);
    await expect(row(0)).toBeVisible({ timeout: 60000 });
    const originalName = await row(0).innerText();

    // Actual row three-dot menu; cancel must not call the lifecycle route.
    await row(0).hover();
    await expect(row(0).locator(".session-nav-age")).toHaveCSS("visibility", "hidden");
    await row(0).getByRole("button", { name: "会话操作", exact: true }).click();
    await page.getByRole("menuitem", { name: "重命名", exact: true }).click();
    const cancelledListDialog = page.getByRole("dialog");
    await expect(cancelledListDialog.getByLabel("会话名称")).toBeVisible();
    await cancelledListDialog.getByRole("button", { name: "取消", exact: true }).click();
    await expect(cancelledListDialog).toHaveCount(0);
    expect(renameRequests).toEqual([]);
    const normalizeRowText = (value: string) => value.replace(/\s+/g, "");
    expect(normalizeRowText(await row(0).innerText())).toBe(
      normalizeRowText(originalName),
    );

    await row(0).hover();
    await expect(row(0).locator(".session-nav-age")).toHaveCSS("visibility", "hidden");
    await row(0).getByRole("button", { name: "会话操作", exact: true }).click();
    await page.getByRole("menuitem", { name: "重命名", exact: true }).click();
    const listDialog = page.getByRole("dialog");
    await listDialog.getByLabel("会话名称").fill("列表重命名成功");
    await listDialog.getByRole("button", { name: "保存", exact: true }).click();
    await expect(listDialog).toHaveCount(0);
    await expect(row(0)).toContainText("列表重命名成功");
    expect(renameRequests).toHaveLength(1);
    expect(renameRequests[0]).toMatchObject({
      method: "POST",
      body: {
        threadId: "ux-0",
        name: "列表重命名成功",
        expectedScope: "ux-fixture-native-scope",
      },
    });
    expect(renameRequests[0].body.operationId).toEqual(expect.any(String));

    // The row's native context menu is a second real entry point.
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator(".session-mode [contenteditable=true]").first().waitFor();
    await expect(row(0)).toContainText("列表重命名成功");
    await expect(row(1)).toBeVisible();
    await page.evaluate(async () => {
      const mounted = (path: string) =>
        performance.getEntriesByType("resource")
          .findLast((entry) => new URL(entry.name).pathname === path)?.name ?? path;
      const { codexService } = await import(
        mounted("/src/session-mode/services/codexService.ts")
      );
      await codexService.setCurrentThread("ux-1");
    });
    await openConversationAction(page, "重命名聊天");
    const cancelledComposerDialog = page.getByRole("dialog");
    await cancelledComposerDialog.getByLabel("会话名称").fill("不应提交");
    await cancelledComposerDialog.getByRole("button", { name: "关闭面板", exact: true }).click();
    await expect(cancelledComposerDialog).toHaveCount(0);
    expect(renameRequests).toHaveLength(1);

    await openConversationAction(page, "重命名聊天");
    const composerDialog = page.getByRole("dialog");
    await composerDialog.getByLabel("会话名称").fill("菜单入口重命名成功");
    await composerDialog.getByRole("button", { name: "保存名称", exact: true }).click();
    await expect(composerDialog).toHaveCount(0);
    await expect(row(1)).toContainText("菜单入口重命名成功");
    expect(renameRequests).toHaveLength(2);
    expect(renameRequests[1]).toMatchObject({
      method: "POST",
      body: {
        threadId: "ux-1",
        name: "菜单入口重命名成功",
        expectedScope: "ux-fixture-native-scope",
      },
    });

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator(".session-mode [contenteditable=true]").first().waitFor();
    await expect(row(1)).toContainText("菜单入口重命名成功");
    await page.evaluate(async () => {
      const mounted = (path: string) =>
        performance.getEntriesByType("resource")
          .findLast((entry) => new URL(entry.name).pathname === path)?.name ?? path;
      const { codexService } = await import(
        mounted("/src/session-mode/services/codexService.ts")
      );
      await codexService.setCurrentThread("ux-1");
    });
    await openConversationAction(page, "重命名聊天");
    const pendingDialog = page.getByRole("dialog");
    await pendingDialog.getByLabel("会话名称").fill("迟到失败名称");
    await pendingDialog.getByRole("button", { name: "保存名称", exact: true }).click();
    const delayedBody = await delayedRename;
    expect(delayedBody).toMatchObject({
      threadId: "ux-1",
      name: "迟到失败名称",
      expectedScope: "ux-fixture-native-scope",
    });
    expect(delayedBody.operationId).toEqual(expect.any(String));

    // Keep the real app's target-selection service and actual fixture read path.
    await page.evaluate(async () => {
      const mounted = (path: string) =>
        performance.getEntriesByType("resource")
          .findLast((entry) => new URL(entry.name).pathname === path)?.name ?? path;
      const { codexService } = await import(
        mounted("/src/session-mode/services/codexService.ts")
      );
      await codexService.setCurrentThread("ux-2");
    });
    const selectedBeforeReject = await page.evaluate(async () => {
      const mounted = (path: string) =>
        performance.getEntriesByType("resource")
          .findLast((entry) => new URL(entry.name).pathname === path)?.name ?? path;
      const { useCodexStore } = await import(
        mounted("/src/session-mode/components/codex/stores/index.ts")
      );
      return useCodexStore.getState().currentThreadId;
    });
    expect(selectedBeforeReject).toBe("ux-2");
    releaseLateReject!();
    await expect(page.getByText("fixture late refusal", { exact: true })).toBeVisible();
    const selectedAfterReject = await page.evaluate(async () => {
      const mounted = (path: string) =>
        performance.getEntriesByType("resource")
          .findLast((entry) => new URL(entry.name).pathname === path)?.name ?? path;
      const { useCodexStore } = await import(
        mounted("/src/session-mode/components/codex/stores/index.ts")
      );
      return useCodexStore.getState().currentThreadId;
    });
    expect(selectedAfterReject).toBe("ux-2");
    await expect(row(1)).not.toContainText("迟到失败名称");
    expect(renameRequests).toHaveLength(3);
    expect(renameRequests[2]).toMatchObject({
      method: "POST",
      body: {
        threadId: "ux-1",
        name: "迟到失败名称",
        expectedScope: "ux-fixture-native-scope",
      },
    });
    expect(
      fixture.calls.filter((call) =>
        /\/(?:turn\/start|thread\/resume|followups\/submit)$/.test(call.path),
      ),
    ).toEqual([]);
  } finally {
    releaseLateReject?.();
  }
});

test("conversation menu copies real Markdown and exact thread URLs; clipboard failures keep target and draft", async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(90000);
  const fixture = await installSessionUxFixture(page, 2);
  const turns = [
    {
      id: "copy-turn-0",
      status: "completed",
      startedAt: 1,
      durationMs: 1,
      error: null,
      items: [
        {
          type: "userMessage",
          id: "copy-user-0",
          clientId: null,
          content: [
            { type: "text", text: "真实菜单 Markdown 用户正文", text_elements: [] },
          ],
        },
        {
          type: "agentMessage",
          id: "copy-assistant-0",
          text: "真实菜单 Markdown 助手正文",
          phase: "final_answer",
          memoryCitation: null,
        },
      ],
    },
  ];
  fixture.threads[0].turns = turns;
  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: baseURL!,
  });
  await page.addInitScript(() => {
    const nativeWrite = navigator.clipboard.writeText.bind(navigator.clipboard);
    Object.defineProperty(navigator.clipboard, "writeText", {
      configurable: true,
      value: (value: string) =>
        (window as any).__denyClipboardWrite
          ? Promise.reject(
              new DOMException("fixture clipboard denial", "NotAllowedError"),
            )
          : nativeWrite(value),
    });
    (window as any).__denyClipboardWrite = false;
  });

  await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
  await page.locator(".session-mode [contenteditable=true]").first().waitFor();
  await seedSessionUx(page, 2);
  await page.evaluate(async ({ turns }) => {
    const mounted = (path: string) =>
      performance.getEntriesByType("resource")
        .findLast((entry) => new URL(entry.name).pathname === path)?.name ?? path;
    const { useCodexStore } = await import(
      mounted("/src/session-mode/components/codex/stores/index.ts")
    );
    const { useAgentCenterStore } = await import(
      mounted("/src/session-mode/stores/useAgentCenterStore.ts")
    );
    const { useSessionDraftStore, sessionDraftKey } = await import(
      mounted("/src/session-mode/stores/useSessionDraftStore.ts")
    );
    const events = turns.flatMap((turn: any) => [
      {
        method: "item/started",
        params: { threadId: "ux-0", turnId: turn.id, item: turn.items[0] },
      },
      {
        method: "item/completed",
        params: { threadId: "ux-0", turnId: turn.id, item: turn.items[1] },
      },
      { method: "turn/completed", params: { threadId: "ux-0", turn } },
    ]);
    useCodexStore.setState((state: any) => ({
      threads: state.threads.map((thread: any) =>
        thread.id === "ux-0"
          ? { ...thread, turns }
          : thread,
      ),
      currentThreadId: "ux-0",
      currentTurnId: null,
      events: { ...state.events, "ux-0": events },
      historyLoadedMap: { ...state.historyLoadedMap, "ux-0": true },
      historyLoadingMap: {},
      historyErrorMap: {},
      threadStatusMap: { ...state.threadStatusMap, "ux-0": { type: "idle" } },
      turnTimingMap: {},
    }));
    useAgentCenterStore.getState().addAgentCard(
      {
        kind: "codex",
        id: "ux-0",
        cwd: "/fixture/项目/very-long-project-path-for-ui-regression",
        preview: "Copy fixture conversation",
      },
      { activate: true },
    );
    useSessionDraftStore.getState().setText(
      sessionDraftKey("codex", "ux-0"),
      "copy action keeps this draft",
    );
  }, { turns });
  await expect(page.locator('[data-thread-workflows="ux-0"]')).toHaveCount(1);

  await openConversationAction(page, "复制为 Markdown");
  await expect(page.getByText("已复制为 Markdown", { exact: true })).toBeVisible();
  const markdown = await page.evaluate(() => navigator.clipboard.readText());
  const visibleTitle = fixture.threads[0].name;
  expect(
    markdown.startsWith("# " + visibleTitle + "\n"),
    JSON.stringify({ visibleTitle, markdown }),
  ).toBe(true);
  expect(markdown).toContain("真实菜单 Markdown 用户正文");
  expect(markdown).toContain("真实菜单 Markdown 助手正文");

  await openConversationAction(page, "复制深层链接");
  await expect(page.getByText("已复制深层链接", { exact: true })).toBeVisible();
  const copiedLink = await page.evaluate(() => navigator.clipboard.readText());
  const parsed = new URL(copiedLink);
  expect(parsed.origin).toBe(new URL(baseURL!).origin);
  expect([...parsed.searchParams.entries()]).toEqual([
    ["mode", "session"],
    ["thread", "ux-0"],
  ]);
  expect(parsed.hash).toBe("");

  for (const [label, toast] of [
    ["复制为 Markdown", "未能复制为 Markdown"],
    ["复制深层链接", "未能复制会话链接"],
  ] as const) {
    await page.evaluate(() => {
      (window as any).__denyClipboardWrite = true;
    });
    await openConversationAction(page, label);
    await expect(page.getByText(toast, { exact: true })).toBeVisible();
    const state = await page.evaluate(async () => {
      const mounted = (path: string) =>
        performance.getEntriesByType("resource")
          .findLast((entry) => new URL(entry.name).pathname === path)?.name ?? path;
      const { useCodexStore } = await import(
        mounted("/src/session-mode/components/codex/stores/index.ts")
      );
      const { useSessionDraftStore, sessionDraftKey } = await import(
        mounted("/src/session-mode/stores/useSessionDraftStore.ts")
      );
      return {
        currentThreadId: useCodexStore.getState().currentThreadId,
        draft: useSessionDraftStore.getState().drafts[
          sessionDraftKey("codex", "ux-0")
        ]?.text,
      };
    });
    expect(state).toEqual({
      currentThreadId: "ux-0",
      draft: "copy action keeps this draft",
    });
    await page.evaluate(() => {
      (window as any).__denyClipboardWrite = false;
    });
  }

  expect(
    fixture.calls.filter((call) =>
      /\/(?:turn\/start|turn\/steer|thread\/resume|followups\/submit)$/.test(
        call.path,
      ),
    ),
  ).toEqual([]);
});

async function observeAudioContexts(cdp: CDPSession) {
  const active = new Set<string>();
  let created = 0;
  cdp.on("WebAudio.contextCreated", ({ context }) => {
    created++;
    if (context.contextState !== "closed") active.add(context.contextId);
  });
  cdp.on("WebAudio.contextChanged", ({ context }) => {
    if (context.contextState === "closed") active.delete(context.contextId);
  });
  cdp.on("WebAudio.contextWillBeDestroyed", ({ contextId }) =>
    active.delete(contextId),
  );
  await cdp.send("WebAudio.enable");
  return () => ({ created, active: active.size });
}

test("retained event owner completes a truly reclaimed transcript and cleans one beep graph", async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(180000);
  const fixture = await installSessionUxFixture(page, 2);
  const cards = fixture.threads.map((thread) => ({
    kind: "codex",
    id: thread.id,
    cwd: thread.cwd,
    preview: thread.name,
  }));
  for (const thread of fixture.threads) {
    (thread as any).turns = [
      {
        id: thread.id + "-initial",
        status: "completed",
        startedAt: 1,
        durationMs: 1,
        items: [
          {
            type: "agentMessage",
            id: thread.id + "-initial-answer",
            text: "预热历史 " + thread.id,
            phase: "final_answer",
          },
        ],
      },
    ];
  }
  await page.route("**/api/session/tabs", (route) =>
    route.fulfill({
      json: { cards, initialized: true, revision: 1, sequence: 0 },
    }),
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
    localStorage.setItem(
      "kanban.session.layout-storage",
      JSON.stringify({
        version: 0,
        state: { view: "agent", isSidebarOpen: false, isRightPanelOpen: false },
      }),
    );
    localStorage.setItem(
      "kanban.session.settings-storage",
      JSON.stringify({
        version: 13,
        state: { warmFollowedSessions: false, enableTaskCompleteBeep: "always" },
      }),
    );
  }, cards);
  const stream = await liveStream(page, baseURL!);
  await page.addInitScript(() => {
    const counters = { oscillatorsCreated: 0, oscillatorsDisconnected: 0 };
    const created = new WeakSet<AudioNode>();
    const disconnected = new WeakSet<AudioNode>();
    const audioNodePrototype = AudioNode.prototype as any;
    const nativeCreate = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function (this: AudioContext) {
      const oscillator = nativeCreate.call(this);
      counters.oscillatorsCreated++;
      created.add(oscillator);
      return oscillator;
    };
    const nativeDisconnect = audioNodePrototype.disconnect;
    audioNodePrototype.disconnect = function (this: AudioNode, ...args: any[]) {
      if (created.has(this) && !disconnected.has(this)) {
        disconnected.add(this);
        counters.oscillatorsDisconnected++;
      }
      return nativeDisconnect.apply(this, args);
    };
    (window as any).__beepAudioProbe = counters;
  });
  const cdp = await context.newCDPSession(page);
  const audio = await observeAudioContexts(cdp);
  const snapshot = async () =>
    page.evaluate(async () => {
      const mounted = (path: string) =>
        performance.getEntriesByType("resource")
          .findLast((entry) => new URL(entry.name).pathname === path)?.name ?? path;
      const { useCodexStore } = await import(
        mounted("/src/session-mode/components/codex/stores/index.ts")
      );
      const { useSessionAttentionStore } = await import(
        mounted("/src/session-mode/stores/useSessionAttentionStore.ts")
      );
      const { useSessionDraftStore, sessionDraftKey } = await import(
        mounted("/src/session-mode/stores/useSessionDraftStore.ts")
      );
      const state = useCodexStore.getState();
      return {
        selected: state.currentThreadId,
        bodyEvents: state.events["ux-1"]?.length,
        timing: state.turnTimingMap["ux-1"],
        unread: useSessionAttentionStore.getState().receipts["codex:ux-1"],
        draft: useSessionDraftStore
          .getState()
          .drafts[sessionDraftKey("codex", "ux-0")]?.text,
        audio: (window as any).__beepAudioProbe,
      };
    });
  try {
    await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
    await expect(page.locator('[data-codex-transcript-shell="ux-0"]')).toBeVisible();
    await expect.poll(stream.opens).toBeGreaterThan(0);

    // Mount the target body once, then switch away using the actual tab control.
    await page.locator('[data-tab-key="codex:ux-1"]').first().click({
      position: { x: 20, y: 12 },
    });
    await expect(page.locator('[data-codex-transcript-shell="ux-1"]')).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const mounted = (path: string) =>
            performance.getEntriesByType("resource")
              .findLast((entry) => new URL(entry.name).pathname === path)?.name ?? path;
          const { useCodexStore } = await import(
            mounted("/src/session-mode/components/codex/stores/index.ts")
          );
          return useCodexStore.getState().historyLoadedMap["ux-1"];
        }),
      )
      .toBe(true);
    await page.locator('[data-tab-key="codex:ux-0"]').first().click({
      position: { x: 20, y: 12 },
    });
    await expect(page.locator('[data-codex-transcript-shell="ux-0"]')).toBeVisible();
    await expect(page.locator('[data-codex-transcript-shell="ux-1"]')).toHaveCount(0);

    const editor = page.locator(
      '.session-codex-composer[data-owner-thread="ux-0"] [contenteditable="true"]',
    ).first();
    await editor.fill("当前目标草稿在后台完成期间保留");
    await expect(editor).toHaveText("当前目标草稿在后台完成期间保留");

    // The persisted explicit opt-out uses the real 60-second invisible-body
    // release path. Wait for the stored event body itself to be evicted.
    await expect
      .poll(async () => (await snapshot()).bodyEvents, { timeout: 90_000 })
      .toBeUndefined();
    expect(audio()).toEqual({ created: 0, active: 0 });
    const reply = {
      type: "agentMessage",
      id: "background-completed-reply",
      text: "真正休眠后仍收到的完整最终回复",
      phase: "final_answer",
      memoryCitation: null,
    };
    const turn = {
      id: "background-completed-turn",
      status: "completed",
      startedAt: Math.floor(Date.now() / 1000),
      completedAt: Math.floor(Date.now() / 1000) + 1,
      durationMs: 1000,
      error: null,
      items: [reply],
    };
    fixture.threads[1].turns.push(turn);
    stream.emit(1, {
      method: "turn/started",
      params: {
        threadId: "ux-1",
        turn: { ...turn, status: "inProgress", items: [] },
      },
    });
    stream.emit(2, {
      method: "item/completed",
      params: {
        threadId: "ux-1",
        turnId: turn.id,
        item: reply,
        completedAtMs: Date.now(),
      },
    });
    stream.emit(3, {
      method: "turn/completed",
      params: { threadId: "ux-1", turn },
    });

    await expect
      .poll(async () => (await snapshot()).timing?.status)
      .toBe("completed");
    await expect
      .poll(async () =>
        (await snapshot()).unread?.completed?.some(
          (receipt: any) => receipt.id === turn.id,
        ),
      )
      .toBe(true);
    await expect(
      page.locator('[data-tab-key="codex:ux-1"] [data-state="unread"]'),
    ).toBeVisible();
    expect((await snapshot()).bodyEvents).toBeUndefined();
    expect((await snapshot()).selected).toBe("ux-0");
    expect((await snapshot()).draft).toBe("当前目标草稿在后台完成期间保留");
    await expect(page.locator('[data-codex-transcript-shell="ux-1"]')).toHaveCount(0);

    await expect.poll(() => page.evaluate(
      () => (window as any).__beepAudioProbe.oscillatorsCreated,
    )).toBe(1);
    expect(audio().created).toBe(1);
    expect(audio().active).toBeLessThanOrEqual(1);
    await expect.poll(() => page.evaluate(
      () => (window as any).__beepAudioProbe.oscillatorsDisconnected,
    )).toBe(1);
    // The single native context closes on its natural 30-second idle timer.
    await expect.poll(() => audio().active, { timeout: 35_000 }).toBe(0);
    expect(audio()).toEqual({ created: 1, active: 0 });
    expect(await page.evaluate(() => (window as any).__beepAudioProbe)).toEqual({
      oscillatorsCreated: 1,
      oscillatorsDisconnected: 1,
    });

    // Re-showing the target is read-only and recovers the exact final reply.
    await page.locator('[data-tab-key="codex:ux-1"]').first().click({
      position: { x: 20, y: 12 },
    });
    await expect(
      page.getByText("真正休眠后仍收到的完整最终回复", { exact: true }),
    ).toBeVisible({ timeout: 30000 });
    expect((await snapshot()).selected).toBe("ux-1");
    expect(
      fixture.calls.filter((call) =>
        /\/(?:turn\/start|turn\/steer|turn\/interrupt|thread\/resume|followups\/submit)$/.test(
          call.path,
        ),
      ),
    ).toEqual([]);
  } finally {
    await stream.close();
    await cdp.detach();
  }
});
