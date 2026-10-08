import { test, expect, type Page } from "@playwright/test";
import Fastify from "fastify";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerSessionFollowupRoutes } from "../../apps/server/src/routes/session-followups";
import { installSessionUxFixture } from "./session-ux-fixture";
import { applySessionTabAction } from "../../packages/shared/src/session-tabs";

export async function setup(page: Page, active = true) {
  const root = await mkdtemp(join(tmpdir(), "kanban-followup-e2e-")),
    app = Fastify();
  const fixture = await installSessionUxFixture(page, 2);
  const calls: Array<{ method: string; params: any }> = [];
  let storeUrl = "",
    settingsUrl = "";
  page.on("request", (r) => {
    if (
      new URL(r.url()).pathname ===
      "/src/session-mode/stores/useFollowupSettingsStore.ts"
    )
      settingsUrl = r.url();
    if (
      new URL(r.url()).pathname ===
      "/src/session-mode/components/codex/stores/index.ts"
    )
      storeUrl = r.url();
  });
  Object.assign(fixture.threads[0], {
    status: active ? { type: "active", activeFlags: [] } : { type: "idle" },
    turns: active
      ? [
          {
            id: "initial-turn",
            status: "inProgress",
            items: [
              {
                type: "userMessage",
                id: "preview-user",
                content: [
                  {
                    type: "text",
                    text: "请检查浏览器刷新后的会话状态。",
                    text_elements: [],
                  },
                ],
              },
              {
                type: "agentMessage",
                id: "preview-agent",
                text: "我会检查状态恢复与事件同步，并保留正在运行的会话和未发送草稿。",
                phase: "commentary",
              },
            ],
            startedAt: Math.floor(Date.now() / 1000) - 10,
            durationMs: null,
            error: null,
          },
        ]
      : [],
  });
  const queue = registerSessionFollowupRoutes(app, {
    origin: () => null,
    file: join(root, "queue.json"),
    autoStart: false,
    runtime: {
      statuses: async (ids) =>
        Object.fromEntries(
          ids.map((id) => [
            id,
            fixture.threads.find((t) => t.id === id)?.status.type ?? "idle",
          ]),
        ),
      call: async (method, params) => {
        calls.push({ method, params });
        if (method === "turn/start") {
          const turn = {
            id: "run-" + params.clientUserMessageId,
            status: "inProgress",
            items: [],
            startedAt: 1,
            durationMs: null,
            error: null,
          };
          const t = fixture.threads.find((t) => t.id === params.threadId);
          if (t)
            Object.assign(t, {
              status: { type: "active", activeFlags: [] },
              turns: [turn],
            });
          return { turn };
        }
        if (method === "review/start")
          return {
            reviewThreadId:
              params.delivery === "detached"
                ? "review-thread"
                : params.threadId,
            turn: { id: "review-turn", status: "inProgress", items: [] },
          };
        return { turnId: params.expectedTurnId };
      },
    },
  });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const addr = app.server.address();
  if (!addr || typeof addr === "string") throw Error("address");
  const origin = `http://127.0.0.1:${addr.port}`;
  await page.route("**/api/session/followups**", async (route) => {
    const req = route.request();
    const response = await page.request.fetch(
      origin + new URL(req.url()).pathname + new URL(req.url()).search,
      {
        method: req.method(),
        ...(req.method() === "POST" ? { data: req.postDataJSON() } : {}),
      },
    );
    await route.fulfill({ response });
  });
  let cards = fixture.threads.map((t) => ({
    kind: "codex" as const,
    id: t.id,
    cwd: t.cwd,
    preview: t.name,
  }));
  await page.route("**/api/session/tabs", async (route) => {
    const body =
      route.request().method() === "POST"
        ? route.request().postDataJSON()
        : null;
    for (const op of body?.operations ?? [])
      cards = applySessionTabAction(cards, op.action) as typeof cards;
    await route.fulfill({
      json: {
        cards,
        initialized: true,
        revision: 1,
        sequence: body?.operations?.at(-1)?.seq ?? 0,
      },
    });
  });
  await page.route("**/api/session/api/codex/thread/fork", async (route) => {
    const t = {
      ...fixture.threads[0],
      id: "side-thread",
      status: { type: "idle" },
      turns: [],
    };
    fixture.threads.push(t);
    await route.fulfill({ json: { thread: t } });
  });
  await page.route("**/api/session/api/codex/review/start", async (route) => {
    const body = route.request().postDataJSON();
    calls.push({ method: "review/start", params: body });
    const t = {
      ...fixture.threads[0],
      id: body.delivery === "detached" ? "review-thread" : body.threadId,
      status: { type: "active", activeFlags: [] },
      turns: [],
    };
    if (body.delivery === "detached") fixture.threads.push(t);
    await route.fulfill({
      json: {
        reviewThreadId: t.id,
        turn: {
          id: "review-turn",
          status: "inProgress",
          items: [
            {
              type: "userMessage",
              id: "preview-user",
              content: [
                {
                  type: "text",
                  text: "请检查浏览器刷新后的会话状态。",
                  text_elements: [],
                },
              ],
            },
            {
              type: "agentMessage",
              id: "preview-agent",
              text: "我会检查状态恢复与事件同步，并保留正在运行的会话和未发送草稿。",
              phase: "commentary",
            },
          ],
          startedAt: Math.floor(Date.now() / 1000) - 10,
        },
      },
    });
  });
  await page.addInitScript((cards) => {
    if (!localStorage.getItem("kanban.session.agent-center-store"))
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
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
  await page
    .locator(".session-agent-view [contenteditable=true]")
    .first()
    .waitFor();
  const event = async (method: string, turnId: string, status: string) => {
    const payload = {
      method,
      params: {
        threadId: "ux-0",
        turn: { id: turnId, status, startedAt: 1, durationMs: null, items: [] },
      },
    };
    Object.assign(fixture.threads[0], {
      status: {
        type: status === "inProgress" ? "active" : "idle",
        activeFlags: [],
      },
    });
    await queue.observe(payload);
    await page.evaluate(
      async ({ url, event }) => {
        const { useCodexStore } = await import(url);
        useCodexStore.getState().addEvent("ux-0", event);
        useCodexStore.setState((s) => ({
          threadStatusMap: {
            ...s.threadStatusMap,
            "ux-0": {
              type:
                event.params.turn.status === "inProgress" ? "active" : "idle",
              activeFlags: [],
            },
          },
        }));
      },
      { url: storeUrl, event: payload },
    );
  };
  return {
    queue,
    calls,
    fixture,
    errors,
    event,
    origin,
    settingsUrl: () => settingsUrl,
    storeUrl: () => storeUrl,
    close: async () => {
      await page.unroute("**/api/session/followups**").catch(()=>{});
      await app.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}
