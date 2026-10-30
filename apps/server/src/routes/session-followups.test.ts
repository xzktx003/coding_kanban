import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { registerSessionFollowupRoutes } from "./session-followups.js";
import { FollowupRejected } from "../services/codex-followups.js";

const execFileAsync = promisify(execFile);

const body = {
  id: "request",
  threadId: "thread",
  text: "hello",
  images: [],
  parameters: { model: "saved" },
  mode: "queue",
};

test("followup read failures stay explicit and never become an empty queue", async () => {
  for (const scenario of [
    {
      label: "upstream 500",
      status: 500,
      code: "FOLLOWUP_READ_UNAVAILABLE",
    },
    {
      label: "upstream 4xx",
      status: 404,
      code: "FOLLOWUP_REJECTED",
    },
  ]) {
    const app = Fastify();
    registerSessionFollowupRoutes(app, {
      origin: () => "http://fixture.invalid",
      fetch: async (input) => {
        const url = String(input);
        if (url.endsWith("/api/internal/codex/operation-context"))
          return new Response(JSON.stringify({ scope: "scope", namespace: "ns" }));
        assert.match(url, /\/api\/codex\/thread\/queue\/list$/);
        return new Response(JSON.stringify({ error: "fixture read error" }), {
          status: scenario.status,
          headers: { "content-type": "application/json" },
        });
      },
      autoStart: false,
    });
    try {
      const response = await app.inject({
        url: "/api/session/followups?threadId=thread",
      });
      assert.equal(response.statusCode, 409, scenario.label);
      assert.equal(response.json().code, scenario.code, scenario.label);
      assert.equal(response.json().items, undefined, "unreadable native queue is not reported as empty");
      assert.doesNotMatch(response.body, /thread is empty|items\":\[\]/);
    } finally {
      await app.close();
    }
  }
});

test("a native 4xx rejection remains distinct from an unavailable read", async () => {
  const app = Fastify();
  registerSessionFollowupRoutes(app, {
    origin: () => null,
    runtime: {
      statuses: async () => ({}),
      call: async () => {
        throw new FollowupRejected("native request rejected");
      },
    },
    nativeQueue: true,
    autoStart: false,
  });
  try {
    const response = await app.inject({
      url: "/api/session/followups?threadId=thread",
    });
    assert.equal(response.statusCode, 409);
    assert.equal(response.json().code, "FOLLOWUP_REJECTED");
    assert.equal(response.json().deliveryStage, undefined);
  } finally {
    await app.close();
  }
});

test("upstream 5xx stays uncertain while a native 4xx is a definite rejection", async () => {
  const root = await mkdtemp(join(tmpdir(), "followup-error-certainty-"));
  const app = Fastify();
  let queueMutationStatus = 500;
  registerSessionFollowupRoutes(app, {
    file: join(root, "legacy.json"),
    origin: () => "http://fixture.invalid",
    fetch: async (input, init) => {
      const url = String(input);
      if (url.endsWith("/api/internal/codex/operation-context"))
        return new Response(JSON.stringify({ scope: "scope", namespace: "ns" }));
      if (url.endsWith("/api/internal/codex/guarded-queue"))
        return new Response(JSON.stringify({ error: "fixture mutation failure" }), {
          status: queueMutationStatus,
          headers: { "content-type": "application/json" },
        });
      if (url.endsWith("/api/codex/thread/queue/list"))
        return new Response(JSON.stringify({ data: [], nextCursor: null }));
      throw new Error(`Unexpected fixture request ${init?.method} ${url}`);
    },
    autoStart: false,
  });
  const send = (id: string, threadId: string) => app.inject({
    method: "POST",
    url: "/api/session/followups/submit",
    payload: { ...body, id, threadId, expectedScope: "scope" },
  });
  try {
    const unknown = await send("request-unknown", "thread-unknown");
    assert.equal(unknown.statusCode, 200, unknown.body);
    assert.equal(unknown.json().items[0].status, "uncertain");
    assert.match(unknown.json().items[0].error, /fixture mutation failure/);

    queueMutationStatus = 409;
    const rejected = await send("request-rejected", "thread-rejected");
    assert.equal(rejected.statusCode, 200, rejected.body);
    assert.equal(rejected.json().items[0].status, "failed");
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("native per-thread turn settings pass queue validation and reach the runtime unchanged", async () => {
  const granular = {
    granular: {
      sandbox_approval: true,
      rules: false,
      skill_approval: true,
      request_permissions: false,
      mcp_elicitations: true,
    },
  };
  for (const parameters of [
    { serviceTier: null, approvalsReviewer: "user", personality: "pragmatic" },
    { serviceTier: "fast", approvalsReviewer: "auto_review" },
    {
      serviceTier: "flex",
      approvalsReviewer: "guardian_subagent",
      approvalPolicy: granular,
    },
    {
      serviceTier: null,
      approvalsReviewer: "user",
      sandboxPolicy: { type: "externalSandbox", networkAccess: "restricted" },
    },
    {
      serviceTier: null,
      approvalsReviewer: "user",
      sandboxPolicy: { type: "externalSandbox", networkAccess: "enabled" },
    },
  ]) {
    const app = Fastify();
    const calls: Array<{ method: string; params: any }> = [];
    const queue = registerSessionFollowupRoutes(app, {
      origin: () => null,
      autoStart: false,
      runtime: {
        statuses: async () => ({ thread: "idle" }),
        call: async (method, params) => {
          calls.push({ method, params });
          return { turn: { id: "native-settings-turn" } };
        },
      },
    });
    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/session/followups/submit",
        payload: { ...body, parameters: { ...body.parameters, ...parameters } },
      });
      assert.equal(response.statusCode, 200, response.body);
      await queue.tick();
      assert.equal(calls.length, 1);
      assert.equal(calls[0].method, "turn/start");
      for (const [name, value] of Object.entries(parameters))
        assert.deepEqual(calls[0].params[name], value);
    } finally {
      await app.close();
    }
  }
});

test("malformed native turn settings are rejected before journaling or runtime calls", async () => {
  const app = Fastify();
  let calls = 0;
  const queue = registerSessionFollowupRoutes(app, {
    origin: () => null,
    autoStart: false,
    runtime: {
      statuses: async () => ({ thread: "idle" }),
      call: async () => {
        calls++;
        return { turn: { id: "unexpected" } };
      },
    },
  });
  try {
    for (const parameters of [
      { serviceTier: 1 },
      { serviceTier: "tier\0" },
      { serviceTier: "x".repeat(257) },
      { approvalsReviewer: "invented-reviewer" },
      { personality: "playful" },
      { approvalsReviewer: true },
      { approvalPolicy: { granular: { sandbox_approval: "true" } } },
      {
        approvalPolicy: {
          granular: {
            sandbox_approval: true,
            rules: false,
            skill_approval: true,
            request_permissions: false,
            mcp_elicitations: true,
            execute: true,
          },
        },
      },
      { sandboxPolicy: { type: "externalSandbox", networkAccess: true } },
      { sandboxPolicy: { type: "externalSandbox", networkAccess: "invented" } },
      { sandboxPolicy: { type: "readOnly", networkAccess: "enabled" } },
    ]) {
      const response = await app.inject({
        method: "POST",
        url: "/api/session/followups/submit",
        payload: { ...body, parameters },
      });
      assert.equal(response.statusCode, 400, response.body);
    }
    await queue.tick();
    assert.equal(calls, 0);
  } finally {
    await app.close();
  }
});

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
    nativeQueue: false,
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

test("accepted steer display HTTP reads are scoped, paginated and never submit another native operation", async () => {
  const root = await mkdtemp(join(tmpdir(), "kanban-steer-display-http-")), app = Fastify();
  const writes: string[] = [];
  try {
    registerSessionFollowupRoutes(app, { file: join(root, "queue.json"), nativeQueue: true, origin: () => null, autoStart: false, runtime: {
      context: async () => ({ scope: "scope-a", namespace: "namespace-a" }), statuses: async () => ({ thread: "running" }),
      async call(method) { if (method === "thread/queue/list") return { data: [], nextCursor: null }; throw new Error(method); },
      async guardedCall(method, params, scope) { assert.equal(scope, "scope-a"); assert.equal(method, "turn/steer"); writes.push(method); return { turnId: params.expectedTurnId }; },
    } });
    const accepted = await app.inject({ method: "POST", url: "/api/session/followups/submit", payload: { ...body, mode: "steer", expectedTurnId: "turn-a", expectedScope: "scope-a", text: "保留补充说明" } });
    assert.equal(accepted.statusCode, 200);
    const path = "/api/session/followups/steer-receipts?threadId=thread";
    assert.equal((await app.inject(path)).statusCode, 409);
    assert.equal((await app.inject(path + "&expectedScope=scope-a&limit=31")).statusCode, 400);
    const read = await app.inject(path + "&expectedScope=scope-a&limit=1");
    assert.equal(read.statusCode, 200); assert.equal(read.headers["cache-control"], "no-store");
    assert.equal(read.json().data[0].text, "保留补充说明");
    assert.equal(read.json().data[0].turnId, "turn-a");
    assert.deepEqual(writes, ["turn/steer"]);
  } finally { await app.close(); await rm(root, { recursive: true, force: true }); }
});
