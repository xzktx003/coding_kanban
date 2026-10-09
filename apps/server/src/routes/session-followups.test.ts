import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { registerSessionFollowupRoutes } from "./session-followups.js";

const execFileAsync = promisify(execFile);

const body = {
  id: "request",
  threadId: "thread",
  text: "hello",
  images: [],
  parameters: { model: "saved" },
  mode: "queue",
};

async function flockProcessesFor(path: string): Promise<string[]> {
  const { stdout } = await execFileAsync("ps", ["-eo", "pid=,args="], {
    encoding: "utf8",
  });
  return stdout
    .split("\n")
    .filter((line) => line.includes("flock") && line.includes(path));
}

test("validates input before journaling, deduplicates requests and serializes revision conflicts", async () => {
  const app = Fastify();
  const calls: any[] = [];
  const queue = registerSessionFollowupRoutes(app, {
    origin: () => null,
    autoStart: false,
    runtime: {
      statuses: async () => ({ thread: "idle" }),
      call: async (method, params) => {
        calls.push({ method, params });
        return { turn: { id: "run" } };
      },
    },
  });
  try {
    for (const bad of [
      { ...body, threadId: "__proto__" },
      { ...body, images: ["/tmp/x\0"] },
      { ...body, parameters: { threadId: "other" } },
      { ...body, mode: "exec" },
      { ...body, text: "", images: [] },
      {
        ...body,
        contexts: [{ id: "ref", kind: "exec", name: "x", text: "x" }],
      },
      {
        ...body,
        contexts: [
          { id: "ref", kind: "file", name: "x", text: "x", path: "/tmp/x\0" },
        ],
      },
      {
        ...body,
        contexts: [
          {
            id: "ref",
            kind: "file",
            name: "x",
            text: "x",
            range: { start: 8, end: 1 },
          },
        ],
      },
      {
        ...body,
        contexts: [
          { id: "ref", kind: "paste", name: "x", text: "x".repeat(200_000) },
        ],
      },
    ]) {
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url: "/api/session/followups/submit",
            payload: bad,
          })
        ).statusCode,
        400,
      );
    }
    const a = await app.inject({
      method: "POST",
      url: "/api/session/followups/submit",
      payload: body,
    });
    assert.equal(a.statusCode, 200);
    const b = await app.inject({
      method: "POST",
      url: "/api/session/followups/submit",
      payload: body,
    });
    assert.equal(b.json().items.length, 1);
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/session/followups/change",
          payload: {
            threadId: "thread",
            revision: 0,
            action: { type: "clear" },
          },
        })
      ).statusCode,
      409,
    );
    await queue.tick();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].params.model, "saved");
    assert.equal(
      (
        await app.inject({ url: "/api/session/followups?threadId=thread" })
      ).json().items[0].status,
      "sent",
    );
  } finally {
    await app.close();
  }
});

test("followup parameters allow only native approval reviewer values and forward them", async () => {
  const app = Fastify();
  const calls: any[] = [];
  const queue = registerSessionFollowupRoutes(app, {
    origin: () => null,
    autoStart: false,
    runtime: {
      statuses: async () => ({ thread: "idle" }),
      call: async (method, params) => {
        calls.push({ method, params });
        return { turn: { id: "run" } };
      },
    },
  });
  try {
    const accepted = await app.inject({
      method: "POST",
      url: "/api/session/followups/submit",
      payload: {
        ...body,
        id: "auto-review",
        parameters: {
          approvalPolicy: "on-request",
          approvalsReviewer: "auto_review",
        },
      },
    });
    assert.equal(accepted.statusCode, 200, accepted.body);
    const rejected = await app.inject({
      method: "POST",
      url: "/api/session/followups/submit",
      payload: {
        ...body,
        id: "bad-reviewer",
        parameters: { approvalsReviewer: "browser_auto_approve" },
      },
    });
    assert.equal(rejected.statusCode, 400);
    await queue.tick();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].params.approvalsReviewer, "auto_review");
  } finally {
    await app.close();
  }
});

test("the HTTP runtime adapter reconciles a released queue through thread/read and never thread/resume", async () => {
  const app = Fastify();
  let state = "active",
    accepted = 0;
  const calls: Array<{ path: string; body: any }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    const data = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ path, body: data });
    if (path === "/health") return Response.json({ instance: "isolated" });
    if (path === "/api/events")
      return new Response(
        new ReadableStream({
          start(controller) {
            init?.signal?.addEventListener("abort", () => controller.close(), {
              once: true,
            });
          },
        }),
      );
    if (path === "/api/internal/codex/queue-holds") return Response.json({});
    if (path === "/api/codex/thread/list")
      return Response.json({
        data: [{ id: "thread", status: { type: state } }],
        nextCursor: null,
      });
    if (path === "/api/codex/thread/read")
      return Response.json({
        thread: {
          id: "thread",
          status: { type: "notLoaded" },
          turns: [{ id: "run-1", status: "completed" }],
        },
      });
    if (path === "/api/codex/turn/start") {
      state = "active";
      return Response.json({ turn: { id: `run-${++accepted}` } });
    }
    throw new Error(`Unexpected endpoint ${path}`);
  };
  const queue = registerSessionFollowupRoutes(app, {
    origin: () => "http://isolated.invalid",
    fetch: fetcher,
  });
  try {
    await app.ready();
    await new Promise<void>((resolve) => setImmediate(resolve));
    await app.inject({
      method: "POST",
      url: "/api/session/followups/submit",
      payload: body,
    });
    state = "idle";
    await queue.tick();
    assert.equal(accepted, 1);
    await app.inject({
      method: "POST",
      url: "/api/session/followups/submit",
      payload: { ...body, id: "next", images: ["/original.png"] },
    });
    state = "notLoaded";
    await queue.tick();
    await queue.tick();
    assert.equal(accepted, 2);
    assert.equal(calls.filter((c) => c.path.endsWith("thread/read")).length, 1);
    assert.equal(
      calls.filter((c) => c.path.endsWith("thread/resume")).length,
      0,
    );
    assert.deepEqual(
      calls
        .filter((c) => c.path.endsWith("turn/start"))
        .map((c) => c.body.clientUserMessageId),
      ["request", "next"],
    );
    const snapshot = (
      await app.inject({ url: "/api/session/followups?threadId=thread" })
    ).json();
    assert.equal(snapshot.items[1].status, "sent");
    assert.deepEqual(snapshot.items[1].images, ["/original.png"]);
  } finally {
    await app.close();
  }
});

test("blank cwd from restored mobile clients inherits the native thread directory without weakening path checks", async () => {
  const app = Fastify();
  const calls: any[] = [];
  const queue = registerSessionFollowupRoutes(app, {
    origin: () => null,
    autoStart: false,
    runtime: {
      statuses: async () => ({ thread: "idle" }),
      call: async (method, params) => {
        calls.push({ method, params });
        return { turn: { id: "run" } };
      },
    },
  });
  try {
    for (const cwd of ["", "   "]) {
      const response = await app.inject({
        method: "POST",
        url: "/api/session/followups/submit",
        payload: { ...body, id: "blank-" + cwd.length, parameters: { cwd } },
      });
      assert.equal(response.statusCode, 200, response.body);
      assert.equal(response.json().items.at(-1).parameters.cwd, null);
    }
    for (const cwd of ["relative/project", "../project", "/project\0", 123]) {
      const response = await app.inject({
        method: "POST",
        url: "/api/session/followups/submit",
        payload: { ...body, id: "invalid", parameters: { cwd } },
      });
      assert.equal(response.statusCode, 400);
    }
    await queue.tick();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].params.cwd, null);
  } finally {
    await app.close();
  }
});

test("newly submitted messages dispatch without waiting for the one-second poll", async () => {
  const app = Fastify();
  let accepted = 0;
  registerSessionFollowupRoutes(app, {
    origin: () => null,
    runtime: {
      statuses: async () => ({ thread: "idle" }),
      call: async () => ({ turn: { id: `run-${++accepted}` } }),
    },
  });
  try {
    await app.ready();
    await new Promise<void>((resolve) => setImmediate(resolve));
    await app.inject({
      method: "POST",
      url: "/api/session/followups/submit",
      payload: body,
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(accepted, 1);
    await app.inject({
      method: "POST",
      url: "/api/session/followups/submit",
      payload: body,
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(accepted, 1, "duplicate submissions must not dispatch twice");
  } finally {
    await app.close();
  }
});

test("closing during queue lease startup does not leave a flock child", async () => {
  const root = await mkdtemp(join(tmpdir(), "kanban-native-reply-"));
  const file = join(root, "codex-followups.json");
  try {
    const app = Fastify();
    registerSessionFollowupRoutes(app, {
      file,
      origin: () => null,
    });

    await app.ready();
    await app.close();
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(await flockProcessesFor(file + ".lock"), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
