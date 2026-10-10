import { expect, test } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { installSessionUxFixture } from "./session-ux-fixture";

test("reload restores background history and status across projects without selecting or sending to them", async ({
  page,
}, info) => {
  test.setTimeout(90000);
  const fixture = await installSessionUxFixture(page, 105);
  const startedAt = Math.floor(Date.now() / 1000) - 60;
  const turn = (id: string, text: string) => ({
    id: `${id}-background-turn`,
    status: "inProgress",
    startedAt,
    completedAt: null,
    durationMs: null,
    error: null,
    items: [
      {
        type: "agentMessage",
        id: `${id}-background-message`,
        text,
        phase: "commentary",
        memoryCitation: null,
      },
    ],
  });
  Object.assign(fixture.threads[104], {
    cwd: "/fixture/second-project",
    status: { type: "active", activeFlags: [] },
    turns: [turn("ux-104", "后台第二项目正在工作")],
  });
  Object.assign(fixture.threads[103], {
    status: { type: "active", activeFlags: ["waitingOnApproval"] },
    turns: [turn("ux-103", "后台原项目等待批准")],
  });
  const cards = [0, 104, 103].map((i) => ({
    kind: "codex",
    id: `ux-${i}`,
    cwd: fixture.threads[i].cwd,
    preview: `中文会话 ${i}`,
  }));
  await page.route("**/api/session/tabs", async (route) => {
    const body =
      route.request().method() === "POST"
        ? route.request().postDataJSON()
        : null;
    await route.fulfill({
      json: {
        cards,
        initialized: true,
        revision: 1,
        sequence: body?.operations?.at(-1)?.seq ?? 0,
      },
    });
  });
  const backgroundPositions = Object.fromEntries(
    [103, 104].map((i) => [
      `kanban.session.read-position.codex:ux-${i}`,
      JSON.stringify({
        atBottom: false,
        anchor: `event-ux-${i}-background-turn-ux-${i}-background-message`,
        offset: -12,
        scrollTop: 120,
        format: "row",
      }),
    ]),
  );
  await page.addInitScript(
    ({ cards, backgroundPositions }) => {
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
      for (const [key, value] of Object.entries(backgroundPositions))
        if (localStorage.getItem(key) === null)
          localStorage.setItem(key, value);
    },
    { cards, backgroundPositions },
  );
  const snapshot = () =>
    page.evaluate(async (positionKeys) => {
      const mountedModule = (path: string) =>
        performance
          .getEntriesByType("resource")
          .findLast((entry) => new URL(entry.name).pathname === path)?.name ??
        path;
      const { useCodexStore } = await import(
        mountedModule("/src/session-mode/components/codex/stores/index.ts")
      );
      const { useAgentCenterStore } = await import(
        mountedModule("/src/session-mode/stores/useAgentCenterStore.ts")
      );
      const { useWorkspaceStore } = await import(
        mountedModule("/src/session-mode/stores/useWorkspaceStore.ts")
      );
      const { useSessionAttentionStore } = await import(
        mountedModule("/src/session-mode/stores/useSessionAttentionStore.ts")
      );
      const codex = useCodexStore.getState();
      return {
        selected: useAgentCenterStore.getState().currentAgentCardId,
        inputThread: codex.currentThreadId,
        cwd: useWorkspaceStore.getState().cwd,
        background: Object.fromEntries(
          ["ux-103", "ux-104"].map((id) => [
            id,
            {
              loaded: codex.historyLoadedMap[id] === true,
              text: (codex.events[id] ?? [])
                .filter(
                  (event: any) =>
                    event.method === "item/completed" &&
                    event.params.item.type === "agentMessage",
                )
                .map((event: any) => event.params.item.text)
                .join("\n"),
              timing: codex.turnTimingMap[id],
              attention:
                useSessionAttentionStore.getState().receipts[`codex:${id}`],
            },
          ]),
        ),
        positions: Object.fromEntries(
          positionKeys.map((key) => [key, localStorage.getItem(key)]),
        ),
      };
    }, Object.keys(backgroundPositions));
  const errors: string[] = [];
  const transport: Array<Record<string, unknown>> = [];
  const documents: Array<Record<string, any>> = [];
  let phase = "initial-load";
  await page.addInitScript(() => {
    if (window.top !== window) return;
    const id = crypto.randomUUID();
    const record = (event: string, details: Record<string, unknown> = {}) =>
      console.debug(
        "__session_status_document__" +
          JSON.stringify({
            id,
            event,
            href: location.href,
            at: Date.now(),
            ...details,
          }),
      );
    record("init");
    window.addEventListener("pagehide", () => record("pagehide"));
    window.addEventListener(
      "error",
      (event) => {
        if (event instanceof ErrorEvent)
          record("js-error", {
            message: event.message,
            filename: event.filename,
            name: event.error?.name,
            stack: event.error?.stack,
          });
      },
      true,
    );
    window.addEventListener("unhandledrejection", (event) =>
      record("unhandledrejection", {
        message: String(event.reason),
        name: event.reason?.name,
        stack: event.reason?.stack,
      }),
    );
  });
  page.on("console", (message) => {
    if (message.text().startsWith("__session_status_document__"))
      documents.push({
        ...JSON.parse(
          message.text().slice("__session_status_document__".length),
        ),
        phase,
        observedAt: Date.now(),
      });
  });
  page.on("request", (request) => {
    if (!new URL(request.url()).pathname.startsWith("/api/")) return;
    transport.push({
      phase,
      event: "request",
      url: request.url(),
      at: Date.now(),
    });
  });
  page.on("requestfinished", (request) => {
    if (!new URL(request.url()).pathname.startsWith("/api/")) return;
    transport.push({
      phase,
      event: "requestfinished",
      url: request.url(),
      at: Date.now(),
    });
  });
  page.on("requestfailed", (request) => {
    if (!new URL(request.url()).pathname.startsWith("/api/")) return;
    transport.push({
      phase,
      event: "requestfailed",
      url: request.url(),
      failure: request.failure(),
      at: Date.now(),
    });
  });
  page.on("pageerror", (error) => {
    errors.push(error.message);
    transport.push({
      phase,
      event: "pageerror",
      name: error.name,
      message: error.message,
      stack: error.stack,
      at: Date.now(),
    });
  });
  await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
  const tabs = page.getByRole("tablist", { name: "关注会话" });
  const running = tabs.locator('[data-tab-key="codex:ux-104"]');
  const pending = tabs.locator('[data-tab-key="codex:ux-103"]');
  await expect(running.locator('[data-state="running"]')).toBeVisible();
  await expect(pending.locator('[data-state="pending"]')).toBeVisible();
  // Status icons come from the list before history reads finish. Reload a
  // confirmed observed history, rather than aborting the mocked initial load.
  await expect
    .poll(async () => (await snapshot()).background)
    .toMatchObject({
      "ux-103": { loaded: true, text: "后台原项目等待批准" },
      "ux-104": { loaded: true, text: "后台第二项目正在工作" },
    });
  for (const suffix of ["/thread/turns/list", "/thread/read"])
    await expect
      .poll(
        () =>
          new Set(
            fixture.calls
              .filter(
                (call) =>
                  call.path.endsWith(suffix) && call.body.threadId !== "ux-0",
              )
              .map((call) => call.body.threadId),
          ),
      )
      .toEqual(new Set(["ux-103", "ux-104"]));
  const beforeReload = fixture.calls.length;
  const reloadAt = Date.now();
  phase = "reload";
  await page.reload({ waitUntil: "domcontentloaded" });
  phase = "after-reload";
  await expect(running.locator('[data-state="running"]')).toBeVisible();
  await expect(pending.locator('[data-state="pending"]')).toBeVisible();
  await expect(tabs.locator('[data-tab-key="codex:ux-0"]')).toHaveAttribute(
    "aria-selected",
    "true",
  );
  // Offscreen restoration uses only recent turns plus read-only metadata.
  // Assert actual transport and mounted-store hydration, never a resume alias.
  for (const suffix of ["/thread/turns/list", "/thread/read"])
    await expect
      .poll(
        () =>
          new Set(
            fixture.calls
              .slice(beforeReload)
              .filter(
                (call) =>
                  call.path.endsWith(suffix) && call.body.threadId !== "ux-0",
              )
              .map((call) => call.body.threadId),
          ),
      )
      .toEqual(new Set(["ux-103", "ux-104"]));
  await expect
    .poll(async () => (await snapshot()).background)
    .toMatchObject({
      "ux-103": {
        loaded: true,
        text: "后台原项目等待批准",
        timing: { status: "inProgress" },
      },
      "ux-104": {
        loaded: true,
        text: "后台第二项目正在工作",
        timing: { status: "inProgress" },
      },
    });
  const restored = await snapshot();
  expect(restored).toMatchObject({
    selected: "ux-0",
    inputThread: "ux-0",
    cwd: fixture.threads[0].cwd,
  });
  expect(restored.positions).toEqual(backgroundPositions);
  await expect(
    running.getByRole("img", { name: "有新的回复未读" }),
  ).toHaveCount(0);
  expect(
    fixture.calls.some(
      (c) => c.path.endsWith("/thread/list") && c.body.cursor === "100",
    ),
  ).toBe(true);

  // Recovery into the foreground must query current status while preserving drafts/selection.
  const editor = page
    .locator(".session-agent-view [contenteditable=true]")
    .first();
  await editor.fill("保留未发送草稿");
  Object.assign(fixture.threads[104], { status: { type: "idle" } });
  const prior = (fixture.threads[104] as any).turns[0];
  Object.assign(fixture.threads[104], {
    turns: [
      {
        ...prior,
        status: "completed",
        completedAt: startedAt + 60,
        durationMs: 60000,
        items: [
          {
            ...prior.items[0],
            text: "后台第二项目完成的真实历史回复",
            phase: "final_answer",
          },
        ],
      },
    ],
  });
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await expect(running.locator('[data-state="running"]')).toHaveCount(0);
  await expect(editor).toHaveText("保留未发送草稿");
  await expect(tabs.locator('[data-tab-key="codex:ux-0"]')).toHaveAttribute(
    "aria-selected",
    "true",
  );
  // The background watchdog reads the same observed turn to completion and
  // derives one unread receipt. No direct attention-store writes fabricate it.
  await expect
    .poll(async () => (await snapshot()).background["ux-104"], {
      timeout: 12000,
    })
    .toMatchObject({
      loaded: true,
      text: "后台第二项目完成的真实历史回复",
      timing: { turnId: "ux-104-background-turn", status: "completed" },
      attention: { completed: [{ id: "ux-104-background-turn" }], read: [] },
    });
  await expect(
    running.getByRole("img", { name: "有新的回复未读" }),
  ).toHaveCount(1);
  await page.setViewportSize({ width: 1440, height: 900 });
  await running.screenshot({
    path: ".dev-runtime/session-tabs-status/single-unread-dot.png",
  });
  await page.setViewportSize({ width: 390, height: 900 });
  await expect(
    running.getByRole("img", { name: "有新的回复未读" }),
  ).toHaveCount(1);
  const completed = await snapshot();
  expect(completed).toMatchObject({
    selected: "ux-0",
    inputThread: "ux-0",
    cwd: fixture.threads[0].cwd,
  });
  expect(completed.positions).toEqual(backgroundPositions);
  await expect(editor).toHaveText("保留未发送草稿");
  expect(
    fixture.calls.filter((call) =>
      /\/thread\/(resume|start|fork|rollback|revert)$|\/turn\/(start|steer|interrupt)$|\/followups\/(submit|stop)$/.test(
        call.path,
      ),
    ),
  ).toEqual([]);
  expect(
    fixture.calls.filter(
      (call) =>
        call.path.endsWith("/thread/access") && call.body.release !== false,
    ),
  ).toEqual([]);
  for (const call of fixture.calls.filter((call) =>
    call.path.endsWith("/thread/turns/list"),
  ))
    expect(call.body).toMatchObject({
      itemsView: "full",
      sortDirection: "desc",
    });
  const initialized = documents.filter((document) => document.event === "init");
  expect(initialized).toHaveLength(2);
  const oldDocument = initialized[0],
    currentDocument = initialized[1];
  const pageErrors = transport.filter((entry) => entry.event === "pageerror");
  const oldNavigationDiagnostics = pageErrors.filter(
    (entry) =>
      entry.phase === "reload" &&
      Number(entry.at) >= reloadAt &&
      Number(entry.at) < currentDocument.at,
  );
  const navigationCancellations = transport.filter(
    (entry) =>
      entry.event === "requestfailed" &&
      entry.phase === "reload" &&
      Number(entry.at) >= reloadAt &&
      Number(entry.at) < currentDocument.at &&
      (entry.failure as { errorText?: string })?.errorText ===
        "Load request cancelled",
  );
  const witness = JSON.stringify(
    {
      restored,
      completed,
      calls: fixture.calls,
      transport,
      errors,
      documents,
      reloadAt,
      oldNavigationDiagnostics,
      navigationCancellations,
    },
    null,
    2,
  );
  writeFileSync(
    info.outputPath("readonly-background-hydration-witness.json"),
    witness,
  );
  await info.attach("readonly-background-hydration-witness.json", {
    contentType: "application/json",
    body: witness,
  });
  // WPE reports old-document navigation network failures through pageerror.
  // Preserve every raw report and only classify the proven old lifecycle;
  // real JS errors in either document and all current-document reports fail.
  expect(
    documents.filter((document) =>
      ["js-error", "unhandledrejection"].includes(document.event),
    ),
  ).toEqual([]);
  expect(
    pageErrors.filter((entry) => Number(entry.at) >= currentDocument.at),
  ).toEqual([]);
  expect(pageErrors).toHaveLength(oldNavigationDiagnostics.length);
  if (oldNavigationDiagnostics.length) {
    expect(
      documents.some(
        (document) =>
          document.id === oldDocument.id &&
          document.event === "pagehide" &&
          document.at >= reloadAt &&
          document.at <= currentDocument.at,
      ),
    ).toBe(true);
    // Keep requestfailed reports as diagnostics. A native old-document network
    // rejection need not produce a transport cancellation event; the lifecycle,
    // exact native report, same origin and both documents' JS guards stay strict.
    const origin = new URL(currentDocument.href).origin;
    const protocol = new URL(currentDocument.href).protocol.slice(0, -1);
    const nativeNames = [
      `Fetch API cannot load ${protocol}`,
      `EventSource cannot load ${protocol}`,
    ];
    for (const entry of oldNavigationDiagnostics) {
      expect(nativeNames).toContain(entry.name);
      const raw = String(entry.message).split(" due to access control checks.");
      expect(raw).toHaveLength(2);
      expect(raw[1]).toBe("");
      const failedUrl = new URL(`${protocol}:/${raw[0]}`);
      expect(failedUrl.origin).toBe(origin);
      expect(failedUrl.pathname.startsWith("/api/session/")).toBe(true);
    }
  }
});
