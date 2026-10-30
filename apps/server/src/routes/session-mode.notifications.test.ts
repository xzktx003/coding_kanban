import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import Fastify from "fastify";
import { emptyFollowupThread } from "@agent-orchestrator/shared";
import { registerSessionModeRoutes } from "./session-mode.js";

const threadId = "notification-thread";
const final = (id: string, phase = "final_answer") => ({
  id,
  status: "completed",
  items: [{ type: "agentMessage", phase, text: `reply-${id}` }],
});
async function until(check: () => boolean | Promise<boolean>) {
  const deadline = Date.now() + 3000;
  while (!(await check())) {
    assert.ok(Date.now() < deadline, "notification fixture timed out");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
async function fixture(
  options: { latest?: string; pending?: string; queued?: boolean } = {},
) {
  const root = await mkdtemp(join(tmpdir(), "session-notification-gate-"));
  const stateFile = join(root, "codex-completion-notifications.json");
  if (options.pending)
    await writeFile(
      stateFile,
      JSON.stringify({
        version: 1,
        instance: "fixture",
        cursor: 1,
        sent: {},
        skipped: {},
        pending: {
          [`${threadId}:${options.pending}`]: {
            key: `${threadId}:${options.pending}`,
            threadId,
            turnId: options.pending,
            eventTurn: { id: options.pending, status: "completed" },
            enqueuedAt: "2026-10-01T00:00:00.000Z",
          },
        },
      }),
    );
  if (options.queued)
    await writeFile(
      join(root, "codex-followups.json"),
      JSON.stringify({
        version: 1,
        threads: {
          [threadId]: {
            ...emptyFollowupThread(),
            paused: "manual",
            items: [
              {
                id: "next",
                status: "queued",
                mode: "queue",
                text: "not sent",
                images: [],
                parameters: {},
              },
            ],
          },
        },
      }),
    );
  const sent: any[] = [],
    calls: Array<{ path: string; body: any }> = [];
  const state = {
    status: "idle",
    latest: options.latest ?? "one",
    phase: "final_answer",
  };
  let stream: ReadableStreamDefaultController<Uint8Array> | undefined;
  let seq = 1;
  const app = Fastify();
  registerSessionModeRoutes(app, {
    origin: "http://127.0.0.1:1234",
    attachmentRoot: join(root, "uploads"),
    loadDetailChannel: async () => ({
      registerLocalItemDetailChannel: () => {},
    }),
    completionNotifications: {
      settings: { get: () => ({ configured: true, enabled: true }) },
      sender: {
        send: async (event) => {
          sent.push(event);
        },
      },
    },
    fetch: async (url, init) => {
      const path = new URL(String(url)).pathname;
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      calls.push({ path, body });
      if (path === "/health") return Response.json({ instance: "fixture" });
      if (path === "/api/internal/codex/operation-context") return Response.json({ scope: "notification-scope", namespace: "notification-namespace" });
      if (path === "/api/codex/thread/queue/list") return Response.json({ data: [], nextCursor: null });
      if (path === "/api/codex/thread/loaded/list") return Response.json({ data: [threadId], nextCursor: null });
      if (path === "/api/events")
        return new Response(
          new ReadableStream({
            start(controller) {
              stream = controller;
              init?.signal?.addEventListener(
                "abort",
                () => {
                  try {
                    controller.close();
                  } catch {}
                },
                { once: true },
              );
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        );
      if (path === "/api/internal/codex/queue-holds")
        return new Response(null, { status: 204 });
      if (path === "/api/codex/thread/list")
        return Response.json({
          data: [{ id: threadId, status: { type: state.status } }],
          nextCursor: null,
        });
      if (path === "/api/codex/thread/metadata")
        return Response.json({
          thread: { id: threadId, status: { type: state.status } },
        });
      if (path === "/api/codex/thread/goal/get")
        return Response.json({ goal: null });
      if (path === "/api/codex/thread/turns/list")
        return Response.json({
          data:
            body.itemsView === "notLoaded"
              ? [{ id: state.latest, status: "completed" }]
              : [
                  final(state.latest, state.phase),
                  final(options.pending ?? "one"),
                ],
          nextCursor: null,
        });
      throw new Error(`Unexpected runtime write or read: ${path}`);
    },
  });
  await app.ready();
  await until(() => !!stream);
  const saved = async () => {
    try {
      return JSON.parse(await readFile(stateFile, "utf8"));
    } catch {
      return null;
    }
  };
  return {
    app,
    state,
    sent,
    calls,
    saved,
    emit(method: string, id: string) {
      stream!.enqueue(
        new TextEncoder().encode(
          `data: ${JSON.stringify({ seq: ++seq, event: "codex:notification", payload: { method, params: { threadId, turn: { id, status: method === "turn/started" ? "inProgress" : "completed" } } } })}\n\n`,
        ),
      );
    },
    async close() {
      await app.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

test("gateway discards a restored old notification using latest metadata without full old history", async () => {
  const f = await fixture({ pending: "old", latest: "new" });
  try {
    await until(async () => {
      const state = await f.saved();
      return state && !state.pending[`${threadId}:old`];
    });
    assert.equal(f.sent.length, 0);
    assert.equal((await f.saved()).skipped[`${threadId}:old`], true);
    assert.equal(
      f.calls.some(
        (c) => c.path.endsWith("turns/list") && c.body.itemsView === "full",
      ),
      false,
    );
  } finally {
    await f.close();
  }
});

test("gateway holds a completion when a paused queue still has an unsent message", async () => {
  const f = await fixture({ queued: true });
  try {
    f.emit("turn/completed", "one");
    await until(() => f.calls.some((c) => c.path.endsWith("turns/list")));
    // All fixture requests settle immediately; let the notification pass finish.
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(f.sent.length, 0);
    assert.ok((await f.saved()).pending[`${threadId}:one`]);
    assert.equal(
      f.calls.some((c) => c.path.endsWith("turn/start")),
      false,
    );
  } finally {
    await f.close();
  }
});

test("gateway ignores interim commentary and sends the latest final result after task continuation", async () => {
  const f = await fixture();
  try {
    f.state.phase = "commentary";
    f.emit("turn/completed", "one");
    await until(async () => (await f.saved())?.skipped[`${threadId}:one`]);
    assert.equal(f.sent.length, 0);
    f.state.latest = "two";
    f.state.status = "active";
    f.emit("turn/started", "two");
    f.state.status = "idle";
    f.state.phase = "final_answer";
    f.emit("turn/completed", "two");
    await until(() => f.sent.length === 1);
    assert.equal(f.sent[0].completionId, "two");
    assert.equal(f.sent[0].summary, "reply-two");
    assert.ok(
      f.calls.some(
        (c) =>
          c.path.endsWith("turns/list") && c.body.itemsView === "notLoaded",
      ),
    );
  } finally {
    await f.close();
  }
});
