import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import {
  readSessionCodexActivity,
  registerSessionCodexActivityRoutes,
} from "./session-codex-activity.js";

const origin = "http://127.0.0.1:1234";
const threadId = "thread-one";
const running = {
  id: "turn-one",
  status: "inProgress",
  startedAt: 20,
  completedAt: null,
  durationMs: null,
};
function fixture() {
  const calls: Array<{ url: string; options: RequestInit; body: any }> = [];
  const data: any = {
    metadata: {
      thread: {
        id: threadId,
        status: { type: "active", activeFlags: [] },
        preview: "PRIVATE_PREVIEW",
      },
    },
    latest: {
      data: [{ ...running, items: [{ output: "PRIVATE_TOOL_OUTPUT" }] }],
      nextCursor: null,
    },
  };
  const fetcher: typeof fetch = async (url, options = {}) => {
    calls.push({
      url: String(url),
      options,
      body: JSON.parse(String(options.body)),
    });
    return Response.json(
      String(url).endsWith("/metadata") ? data.metadata : data.latest,
    );
  };
  const app = Fastify();
  registerSessionCodexActivityRoutes(app, {
    origin: () => origin,
    fetch: fetcher,
  });
  return { app, calls, data, fetcher };
}

test("activity comes from current owner even when independent history would mark the same turn interrupted", async () => {
  const f = fixture();
  try {
    const result = await f.app.inject({
      method: "POST",
      url: "/api/session/codex/activity",
      payload: { threadId },
    });
    assert.equal(result.statusCode, 200);
    assert.deepEqual(result.json(), {
      threadId,
      status: { type: "active", activeFlags: [] },
      turn: running,
    });
    assert.equal(result.headers["cache-control"], "no-store");
    assert.doesNotMatch(result.body, /PRIVATE|items|preview/);
    assert.deepEqual(
      f.calls.map((c) => c.url),
      [
        origin + "/api/codex/thread/metadata",
        origin + "/api/codex/thread/turns/list",
      ],
    );
    assert.deepEqual(
      f.calls.map((c) => c.body),
      [
        { threadId },
        { threadId, limit: 1, sortDirection: "desc", itemsView: "notLoaded" },
      ],
    );
    assert.ok(
      f.calls.every(
        (c) =>
          c.options.method === "POST" &&
          c.options.redirect === "error" &&
          c.options.cache === "no-store",
      ),
    );
    assert.ok(
      f.calls.every(
        (c) =>
          JSON.stringify(c.options.headers) ===
          JSON.stringify({ "content-type": "application/json" }),
      ),
    );
  } finally {
    await f.app.close();
  }
});
test("empty new idle thread has null activity turn; optional native timestamps remain explicit", async () => {
  const f = fixture();
  try {
    f.data.metadata.thread.status = { type: "idle" };
    f.data.latest.data = [];
    assert.deepEqual(
      await readSessionCodexActivity(origin, f.fetcher, threadId),
      { threadId, status: { type: "idle" }, turn: null },
    );
    f.data.latest.data = [{ id: "old", status: "completed", startedAt: null }];
    assert.deepEqual(
      (await readSessionCodexActivity(origin, f.fetcher, threadId)).turn,
      { id: "old", status: "completed", startedAt: null },
    );
  } finally {
    await f.app.close();
  }
});
test("caller cannot select methods, origins, credentials or malformed identities", async () => {
  const f = fixture();
  try {
    for (const payload of [
      null,
      [],
      {},
      { threadId: "" },
      { threadId: "bad\ninput" },
      { threadId: "constructor" },
      { threadId: "x".repeat(161) },
      { threadId, method: "turn/start" },
      { threadId, origin: "http://example.test" },
      { threadId, token: "not-forwarded" },
    ]) {
      const result = await f.app.inject({
        method: "POST",
        url: "/api/session/codex/activity",
        payload: JSON.stringify(payload),
        headers: { "content-type": "application/json" },
      });
      assert.equal(result.statusCode, 400);
    }
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/session/codex/activity?method=turn/start",
          payload: { threadId },
        })
      ).statusCode,
      400,
    );
    assert.equal(f.calls.length, 0);
  } finally {
    await f.app.close();
  }
});
test("metadata and optional turn identity must match, and execution fields are validated", async () => {
  for (const change of [
    (f: ReturnType<typeof fixture>) => {
      f.data.metadata.thread.id = "other";
    },
    (f: ReturnType<typeof fixture>) => {
      f.data.metadata.thread.status = { type: "active" };
    },
    (f: ReturnType<typeof fixture>) => {
      f.data.metadata.thread.status = {
        type: "active",
        activeFlags: ["unknown"],
      };
    },
    (f: ReturnType<typeof fixture>) => {
      f.data.metadata.thread.status = { type: "mystery" };
    },
    (f: ReturnType<typeof fixture>) => {
      f.data.latest.threadId = "other";
    },
    (f: ReturnType<typeof fixture>) => {
      f.data.latest.data[0].threadId = "other";
    },
    (f: ReturnType<typeof fixture>) => {
      f.data.latest.data[0].id = "__proto__";
    },
    (f: ReturnType<typeof fixture>) => {
      f.data.latest.data[0].status = "unknown";
    },
    (f: ReturnType<typeof fixture>) => {
      delete f.data.latest.data[0].startedAt;
    },
    (f: ReturnType<typeof fixture>) => {
      f.data.latest.data[0].startedAt = -1;
    },
    (f: ReturnType<typeof fixture>) => {
      f.data.latest.data[0].durationMs = "1";
    },
    (f: ReturnType<typeof fixture>) => {
      f.data.latest.data.push({ ...running });
    },
  ]) {
    const f = fixture();
    change(f);
    try {
      const result = await f.app.inject({
        method: "POST",
        url: "/api/session/codex/activity",
        payload: { threadId },
      });
      assert.equal(result.statusCode, 503);
      assert.doesNotMatch(result.body, /PRIVATE/);
    } finally {
      await f.app.close();
    }
  }
});
test("missing runtime, non-OK and malformed upstream responses stay unknown", async () => {
  const app = Fastify();
  registerSessionCodexActivityRoutes(app, {
    origin: () => null,
    fetch: async () => {
      throw Error("unexpected");
    },
  });
  try {
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/session/codex/activity",
          payload: { threadId },
        })
      ).statusCode,
      503,
    );
  } finally {
    await app.close();
  }
  for (const make of [
    () => new Response("PRIVATE_SERVER_DETAIL", { status: 500 }),
    () => new Response("not-json"),
  ]) {
    await assert.rejects(
      readSessionCodexActivity(origin, async () => make(), threadId),
      (error) =>
        (error as any).statusCode === 503 && !String(error).includes("PRIVATE"),
    );
  }
});
test("oversized JSON is canceled while streaming, without response.json or full-history fallback", async () => {
  let cancelled = false,
    calls = 0;
  await assert.rejects(
    readSessionCodexActivity(
      origin,
      async () => {
        calls++;
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(40 * 1024));
              controller.enqueue(new Uint8Array(30 * 1024));
            },
            cancel() {
              cancelled = true;
            },
          }),
        );
      },
      threadId,
    ),
    (error) => (error as any).statusCode === 503,
  );
  assert.equal(cancelled, true);
  assert.equal(calls, 1);
});
test("oversized declared length rejects and cancels before parsing", async () => {
  let cancelled = false;
  await assert.rejects(
    readSessionCodexActivity(
      origin,
      async () =>
        new Response(
          new ReadableStream({
            cancel() {
              cancelled = true;
            },
          }),
          { headers: { "content-length": "65537" } },
        ),
      threadId,
    ),
  );
  assert.equal(cancelled, true);
});
test("external abort cancels a pending body and rejects even if fetch ignores the signal", async () => {
  const controller = new AbortController();
  let cancelled = false;
  const work = readSessionCodexActivity(
    origin,
    async () =>
      new Response(
        new ReadableStream({
          cancel() {
            cancelled = true;
          },
        }),
      ),
    threadId,
    controller.signal,
  );
  const rejected = assert.rejects(
    work,
    (error) => (error as any).statusCode === 503,
  );
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  await rejected;
  assert.equal(cancelled, true);
  const lateController = new AbortController();
  let resolve!: (r: Response) => void;
  let lateCancelled = false;
  const late = assert.rejects(
    readSessionCodexActivity(
      origin,
      () =>
        new Promise<Response>((r) => {
          resolve = r;
        }),
      threadId,
      lateController.signal,
    ),
  );
  lateController.abort();
  await late;
  resolve(
    new Response(
      new ReadableStream({
        cancel() {
          lateCancelled = true;
        },
      }),
    ),
  );
  await new Promise((done) => setImmediate(done));
  assert.equal(lateCancelled, true);
});
test("owned deadline bounds a non-responsive fetch adapter", async (context) => {
  const originalTimeout = globalThis.setTimeout;
  context.mock.method(globalThis, "setTimeout", ((
    fn: () => void,
    ms: number,
    ...args: any[]
  ) => originalTimeout(fn, Math.min(ms, 5), ...args)) as typeof setTimeout);
  const rejection = assert.rejects(
    readSessionCodexActivity(
      origin,
      () => new Promise<Response>(() => {}),
      threadId,
    ),
    (error) => (error as any).statusCode === 503,
  );
  await new Promise((resolve) => originalTimeout(resolve, 15));
  await rejection;
});

test("disconnecting the HTTP caller cancels its owner activity body read", async () => {
  const app = Fastify();
  let reading = false,
    cancelled = false;
  registerSessionCodexActivityRoutes(app, {
    origin: () => origin,
    fetch: async () =>
      new Response(
        new ReadableStream({
          start() {
            reading = true;
          },
          cancel() {
            cancelled = true;
          },
        }),
      ),
  });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  assert.ok(address && typeof address !== "string");
  const controller = new AbortController();
  const pending = fetch(
    `http://127.0.0.1:${address.port}/api/session/codex/activity`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ threadId }),
      signal: controller.signal,
    },
  );
  const rejected = assert.rejects(pending);
  try {
    const deadline = Date.now() + 1000;
    while (!reading) {
      assert.ok(Date.now() < deadline);
      await new Promise((r) => setTimeout(r, 5));
    }
    controller.abort();
    await rejected;
    while (!cancelled) {
      assert.ok(Date.now() < deadline);
      await new Promise((r) => setTimeout(r, 5));
    }
  } finally {
    controller.abort();
    await app.close();
  }
});

test("only a plain server-selected loopback runtime origin can supply activity", async () => {
  let called = false;
  const fetcher: typeof fetch = async () => {
    called = true;
    throw Error("unexpected");
  };
  for (const invalid of [
    "not-a-url",
    "https://127.0.0.1:1234",
    "http://example.test",
    "http://127.0.0.1:1234/path",
    "http://user:secret@127.0.0.1:1234",
    "http://127.0.0.1:1234/?target=other",
  ]) {
    await assert.rejects(
      readSessionCodexActivity(invalid, fetcher, threadId),
      (error) => (error as any).statusCode === 503,
    );
  }
  assert.equal(called, false);
});
