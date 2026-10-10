import { test, expect, type Page } from "@playwright/test";
import { createServer as httpServer, type ServerResponse } from "node:http";
import { createServer as httpsServer } from "node:https";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
test.use({ ignoreHTTPSErrors: true });
import { installSessionUxFixture } from "./session-ux-fixture";

// A real streaming connection: frames go through the browser's native EventSource,
// eventStream, notification handlers and stores. No direct addEvent injection.
async function liveStream(page: Page, baseURL: string) {
  const clients = new Set<ServerResponse>();
  let opens = 0;
  const cursors: Array<string | null> = [];
  const handler = (req: any, res: ServerResponse) => {
    if (req.url?.startsWith("/events")) {
      opens++;
      cursors.push(new URL(req.url, "http://test").searchParams.get("since"));
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Access-Control-Allow-Origin": "*",
      });
      res.flushHeaders();
      res.write(": connected\n\n");
      clients.add(res);
      req.on("close", () => clients.delete(res));
    } else {
      res.writeHead(404);
      res.end();
    }
  };
  const secure = new URL(baseURL).protocol === "https:";
  const tlsDir = mkdtempSync(join(tmpdir(), "session-sse-"));
  if (secure)
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-days",
        "1",
        "-subj",
        "/CN=isolated-test",
        "-keyout",
        join(tlsDir, "key.pem"),
        "-out",
        join(tlsDir, "cert.pem"),
      ],
      { stdio: "ignore" },
    );
  const server = secure
    ? httpsServer(
        {
          cert: readFileSync(join(tlsDir, "cert.pem")),
          key: readFileSync(join(tlsDir, "key.pem")),
        },
        handler,
      )
    : httpServer(handler);
  await new Promise<void>((r) => server.listen(0, "0.0.0.0", r));
  const port = (server.address() as any).port;
  const origin = new URL(baseURL);
  origin.port = String(port);
  await page.addInitScript(
    ({ origin }) => {
      const Native = window.EventSource;
      window.EventSource = class extends Native {
        constructor(url: string | URL, options?: EventSourceInit) {
          const parsed = new URL(String(url), location.href);
          super(
            parsed.pathname.endsWith("/api/events")
              ? `${origin}/events${parsed.search}`
              : url,
            options,
          );
        }
      };
    },
    { origin: origin.origin },
  );
  const heartbeat = setInterval(() => {
    for (const c of clients) c.write(": alive\n\n");
  }, 250);
  return {
    opens: () => opens,
    cursors: () => cursors,
    emit: (seq: number, payload: any, event = "codex:notification") => {
      for (const c of clients)
        c.write(`data: ${JSON.stringify({ seq, event, payload })}\n\n`);
    },
    close: async () => {
      clearInterval(heartbeat);
      for (const c of clients) c.end();
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
      rmSync(tlsDir, { recursive: true, force: true });
    },
  };
}

test("a lower runtime snapshot resets the stream cursor without refreshing the page", async ({
  page,
  baseURL,
}) => {
  const { fixture, stream } = await setup(page, baseURL!);
  let bridgeReady = false;
  page.on("console", (message) => {
    if (message.text().includes("[useSseEventBridge] Setting up"))
      bridgeReady = true;
  });
  try {
    await page.goto("/?mode=session");
    const documentStartedAt = await page.evaluate(() => performance.timeOrigin);
    const editor = page.locator(".session-agent-view [contenteditable=true]");
    await expect(editor).toBeVisible();
    await editor.fill("序号重置后保留的草稿");
    await expect.poll(stream.opens).toBeGreaterThan(0);
    await expect.poll(() => bridgeReady).toBe(true);
    stream.emit(900, {
      method: "item/completed",
      params: {
        threadId: "ux-0",
        turnId: "old-runtime-turn",
        item: {
          type: "agentMessage",
          id: "cursor-probe",
          text: "旧实例游标已接收",
        },
      },
    });
    await expect(
      page.getByText("旧实例游标已接收", { exact: true }),
    ).toBeVisible();
    const before = stream.opens();
    stream.emit(2, { requests: [] }, "codex/pending-requests-snapshot");
    await expect.poll(stream.opens).toBeGreaterThan(before);
    expect(stream.cursors()[before]).toBeNull();
    const turn = {
      id: "new-runtime-turn",
      status: "inProgress",
      startedAt: Math.floor(Date.now() / 1000),
      items: [],
      error: null,
      durationMs: null,
    };
    stream.emit(3, {
      method: "turn/started",
      params: { threadId: "ux-0", turn },
    });
    stream.emit(4, {
      method: "item/completed",
      params: {
        threadId: "ux-0",
        turnId: turn.id,
        item: {
          type: "agentMessage",
          id: "new-runtime-answer",
          text: "新运行实例的实时回复",
        },
      },
    });
    await expect(
      page.getByText("新运行实例的实时回复", { exact: true }),
    ).toBeVisible({ timeout: 2500 });
    await expect(editor).toHaveText("序号重置后保留的草稿");
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(
      documentStartedAt,
    );
    expect(
      fixture.calls.filter((c) =>
        /\/turn\/(start|interrupt)|\/thread\/resume|followups\/submit/.test(
          c.path,
        ),
      ),
    ).toEqual([]);
  } finally {
    await page.close();
    await stream.close();
  }
});
async function setup(page: Page, baseURL: string) {
  const fixture = await installSessionUxFixture(page, 2);
  const cards = fixture.threads.map((t) => ({
    kind: "codex",
    id: t.id,
    cwd: t.cwd,
    preview: t.name,
  }));
  await page.route("**/api/session/tabs", (r) =>
    r.fulfill({ json: { cards, initialized: true, revision: 1, sequence: 0 } }),
  );
  await page.addInitScript(
    (cards) =>
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
      ),
    cards,
  );
  const stream = await liveStream(page, baseURL);
  return { fixture, stream };
}
for (const { width, healthFailure } of [
  { width: 375, healthFailure: false },
  { width: 1440, healthFailure: false },
  { width: 1440, healthFailure: true },
])
  test(`accepted message and missing completion heal without refresh over a silent SSE (${width}px, healthFailure=${healthFailure})`, async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width, height: 900 });
    const { fixture, stream } = await setup(page, baseURL!);
    let failHealth = false;
    if (healthFailure)
      await page.route("**/api/session/health", (route) =>
        route.fulfill(
          failHealth
            ? { status: 503, json: { error: "health probe unavailable" } }
            : { json: { status: "ok" } },
        ),
      );
    let submissions = 0;
    let receipt: any = { revision: 0, paused: null, items: [] };
    await page.route(
      (url) =>
        url.pathname === "/api/session/followups" &&
        url.searchParams.get("threadId") === "ux-0",
      (route) => route.fulfill({ json: receipt }),
    );
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const startedAt = Math.floor(Date.now() / 1000);
    let turn: any;
    await page.route("**/api/session/followups/submit", async (route) => {
      submissions++;
      const body = route.request().postDataJSON();
      turn = {
        id: "silent-turn",
        status: "inProgress",
        startedAt,
        durationMs: null,
        error: null,
        items: [
          {
            type: "userMessage",
            id: "u",
            clientId: body.id,
            content: [{ type: "text", text: body.text, text_elements: [] }],
          },
          {
            type: "agentMessage",
            id: "answer",
            text: "真实事件流静默后补回的回复",
          },
        ],
      };
      fixture.threads[0].turns = [turn] as any;
      fixture.threads[0].status = { type: "active", activeFlags: [] } as any;
      receipt = {
        revision: 1,
        paused: null,
        awaitingTurnId: turn.id,
        items: [
          {
            ...body,
            status: "sent",
            turnId: turn.id,
            createdAt: Date.now(),
            fingerprint: "fixture",
          },
        ],
      };
      await route.fulfill({ json: receipt });
    });
    try {
      await page.goto("/?mode=session");
      await expect.poll(stream.opens).toBeGreaterThan(0);
      const editor = page.locator(".session-agent-view [contenteditable=true]");
      if (healthFailure) {
        await expect(editor).toBeVisible();
        failHealth = true;
        await expect(
          page.getByText("会话服务连接中断，正在自动重连。草稿已保留。"),
        ).toBeVisible({ timeout: 22000 });
      }
      await editor.fill("只投递一次，等待真实流恢复");
      await page.getByRole("button", { name: "发送消息", exact: true }).click();
      await expect.poll(() => submissions).toBe(1);
      await expect(
        page.getByText("真实事件流静默后补回的回复", { exact: true }),
      ).toBeVisible({ timeout: 15000 });
      await expect(page.locator("[data-delivery-echo]")).toHaveCount(0);
      await page
        .locator('[data-tab-key="codex:ux-1"]')
        .click({ position: { x: 24, y: 10 } });
      await editor.fill("另一个会话的草稿");
      turn.status = "completed";
      turn.durationMs = 1234;
      fixture.threads[0].status = { type: "idle" };
      await expect(
        page.locator(
          '[data-tab-key="codex:ux-0"] .session-status-dot[data-state="unread"]',
        ),
      ).toBeVisible({ timeout: 20000 });
      await expect(
        page.locator('[data-tab-key="codex:ux-0"] .session-status-spin'),
      ).toHaveCount(0);
      await expect(page.locator('[data-tab-key="codex:ux-1"]')).toHaveAttribute(
        "aria-selected",
        "true",
      );
      await expect(editor).toHaveText("另一个会话的草稿");
      expect(submissions).toBe(1);
      expect(
        fixture.calls.filter((c) =>
          /\/turn\/(start|interrupt)|\/thread\/resume/.test(c.path),
        ),
      ).toEqual([]);
      expect(errors).toEqual([]);
    } finally {
      await page.close();
      await stream.close();
    }
  });

test("real SSE sequence gap repairs transcript and a failed read offers read-only retry", async ({
  page,
  baseURL,
}) => {
  test.setTimeout(60000);
  const { fixture, stream } = await setup(page, baseURL!);
  let fail = false,
    reads = 0;
  await page.route(
    (url) => url.pathname.endsWith("/api/codex/thread/turns/list"),
    (route) => {
      reads++;
      const id = route.request().postDataJSON().threadId;
      return route.fulfill(
        fail
          ? { status: 503, json: { error: "isolated outage" } }
          : {
              json: {
                data: [
                  ...fixture.threads.find((t) => t.id === id)!.turns,
                ].reverse(),
                nextCursor: null,
              },
            },
      );
    },
  );
  try {
    await page.goto("/?mode=session");
    await expect.poll(stream.opens).toBeGreaterThan(0);
    await expect.poll(() => reads).toBeGreaterThanOrEqual(2);
    const editor = page.locator(".session-agent-view [contenteditable=true]");
    await editor.fill("恢复期间不要清空草稿");
    stream.emit(1, {
      method: "thread/status/changed",
      params: { threadId: "ux-0", status: { type: "active", activeFlags: [] } },
    });
    await expect(
      page.locator('[data-tab-key="codex:ux-0"] .session-status-spin'),
    ).toBeVisible();
    fail = true;
    stream.emit(3, {
      method: "thread/tokenUsage/updated",
      params: { threadId: "ux-0", tokenUsage: null },
    });
    await expect(
      page.locator("[data-session-recovery=retrying]").first(),
    ).toBeVisible({ timeout: 15000 });
    const beforeRetry = reads;
    await page.getByRole("button", { name: "重试", exact: true }).click();
    await expect.poll(() => reads).toBeGreaterThan(beforeRetry);
    fail = false;
    fixture.threads[0].status = { type: "idle" };
    fixture.threads[0].turns = [
      {
        id: "recovered",
        status: "completed",
        startedAt: 1,
        durationMs: 10,
        error: null,
        items: [
          { type: "agentMessage", id: "reply", text: "跳号遗漏的正文已恢复" },
        ],
      },
    ] as any;
    await expect(
      page.getByText("跳号遗漏的正文已恢复", { exact: true }),
    ).toBeVisible({ timeout: 20000 });
    await expect(editor).toHaveText("恢复期间不要清空草稿");
    await expect(
      page.locator('[data-tab-key="codex:ux-0"] .session-status-spin'),
    ).toHaveCount(0);
    expect(
      fixture.calls.filter((c) =>
        /\/turn\/(start|interrupt)|\/thread\/resume|followups\/submit/.test(
          c.path,
        ),
      ),
    ).toEqual([]);
  } finally {
    await page.close();
    await stream.close();
  }
});

test("SSE gap recovery preserves a middle reading position and leaves the new reply unread", async ({
  page,
  baseURL,
}) => {
  test.setTimeout(60000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const { fixture, stream } = await setup(page, baseURL!);
  // Separate final reports keep this reading fixture scrollable with native turn grouping.
  const oldTurns = Array.from({ length: 20 }, (_, i) => ({
    id: `old-turn-${i}`,
    status: "completed",
    startedAt: 1,
    durationMs: 20,
    error: null,
    items: [
      {
        type: "agentMessage",
        id: `old-${i}`,
        phase: "final_answer",
        text: `旧消息 ${i} ${"保持阅读位置。".repeat(70)}`,
      },
    ],
  }));
  fixture.threads[0].turns = oldTurns as any;
  try {
    await page.goto("/?mode=session");
    await expect.poll(stream.opens).toBeGreaterThan(0);
    await expect(
      page.locator("[data-codex-row]").filter({ hasText: "旧消息 19" }),
    ).toHaveCount(1);
    const viewport = page
      .locator('.session-mode [data-slot="scroll-area-viewport"]')
      .filter({ has: page.locator("[data-session-latest]") });
    await viewport.evaluate((el) => {
      el.dispatchEvent(
        new WheelEvent("wheel", { deltaY: -500, bubbles: true }),
      );
      el.scrollTop = 100;
      el.dispatchEvent(new Event("scroll"));
    });
    let previous = -1,
      stable = 0;
    await expect
      .poll(async () => {
        const box = await viewport.evaluate((el) => ({
          top: el.scrollTop,
          distance: el.scrollHeight - el.clientHeight - el.scrollTop,
        }));
        stable = box.top === previous ? stable + 1 : 0;
        previous = box.top;
        return stable >= 2 && box.distance > 200;
      })
      .toBe(true);
    const position = await viewport.evaluate((el) => el.scrollTop);
    stream.emit(1, {
      method: "thread/status/changed",
      params: { threadId: "ux-0", status: { type: "active", activeFlags: [] } },
    });
    fixture.threads[0].turns.push({
      id: "gap-turn",
      status: "completed",
      startedAt: 2,
      durationMs: 20,
      error: null,
      items: [
        {
          type: "agentMessage",
          id: "gap-answer",
          text: "自动补回但不抢阅读位置的新回复",
        },
      ],
    } as never);
    stream.emit(3, {
      method: "thread/status/changed",
      params: { threadId: "ux-0", status: { type: "idle" } },
    });
    // Offscreen rows are virtualized: verify recovered data without scrolling to it.
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const path = "/src/session-mode/components/codex/stores/index.ts";
          const { useCodexStore } = await import(
            performance
              .getEntriesByType("resource")
              .findLast((e) => new URL(e.name).pathname === path)?.name ?? path
          );
          return JSON.stringify(
            useCodexStore.getState().events["ux-0"],
          ).includes("自动补回但不抢阅读位置的新回复");
        }),
      )
      .toBe(true);
    expect(await viewport.evaluate((el) => el.scrollTop)).toBe(position);
    await expect(
      page.locator(
        '[data-tab-key="codex:ux-0"] .session-status-dot[data-state="unread"]',
      ),
    ).toBeVisible();
  } finally {
    await page.close();
    await stream.close();
  }
});
