import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { registerSessionSubagentRoutes } from "./session-subagents.js";
import { registerSessionFollowupRoutes } from "./session-followups.js";

test("passive child snapshots and identity verification never transmit native item bodies", async () => {
  const app = Fastify();
  const calls: string[] = [];
  const body = "private-tool-output:" + "x".repeat(4 * 1024 * 1024);
  const child = {
    id: "child",
    source: {
      subAgent: {
        thread_spawn: {
          parent_thread_id: "root",
          agent_nickname: "Scout",
          agent_role: "reviewer",
          prompt: body,
        },
      },
    },
    canAcceptDirectInput: true,
    cwd: "/workspace/project",
    historyMode: "native",
    status: { type: "active", activeFlags: ["waitingOnApproval"] },
    preview: body,
    unknownFutureBody: body,
  };
  const turn = {
    id: "current",
    status: "inProgress",
    startedAt: 123,
    items: [
      { id: "command", type: "commandExecution", aggregatedOutput: body },
    ],
  };
  registerSessionSubagentRoutes(app, {
    origin: () => "http://fixture.invalid",
    fetch: async (url) => {
      const method = String(url).split("/api/codex/")[1];
      calls.push(method);
      if (method === "thread/list")
        return Response.json({ data: [child], nextCursor: null });
      if (method === "thread/turns/list")
        return Response.json({ data: [turn], nextCursor: null });
      // Compatibility runtimes may return full history from thread/read.
      if (method === "thread/metadata")
        return Response.json({}, { status: 404 });
      if (method === "thread/read")
        return Response.json({ thread: { ...child, turns: [turn] } });
      throw new Error(`Unexpected request: ${method}`);
    },
    stop: async () => {
      throw new Error("Passive reads cannot stop tasks");
    },
  });
  try {
    for (const endpoint of ["snapshot", "snapshot", "verify"]) {
      const response = await app.inject({
        method: "POST",
        url: `/api/session/subagents/${endpoint}`,
        payload: { rootId: "root", threadId: "child" },
      });
      assert.equal(response.statusCode, 200);
      assert.ok(
        Buffer.byteLength(response.body) < 16 * 1024,
        `${endpoint} sent ${Buffer.byteLength(response.body)} bytes`,
      );
      const result = response.json();
      const projected = result.threads[0];
      assert.equal(projected.parentThreadId, "root");
      assert.equal(projected.agentNickname, "Scout");
      assert.equal(projected.agentRole, "reviewer");
      assert.equal(projected.canAcceptDirectInput, true);
      assert.equal(projected.cwd, child.cwd);
      assert.equal(projected.historyMode, "native");
      assert.deepEqual(projected.status, child.status);
      assert.deepEqual(projected.turns, [
        { id: "current", status: "inProgress", startedAt: 123 },
      ]);
      assert.equal(projected.unknownFutureBody, undefined);
      assert.ok(projected.preview.length <= 1024);
      assert.equal(projected.source.subAgent.thread_spawn, undefined);
      if (endpoint === "snapshot") {
        assert.equal(result.complete, true);
        assert.deepEqual(result.errors, []);
      } else assert.deepEqual(result.thread, projected);
    }
    assert.ok(
      calls.every((method) =>
        [
          "thread/list",
          "thread/metadata",
          "thread/read",
          "thread/turns/list",
        ].includes(method),
      ),
    );
  } finally {
    await app.close();
  }
});
test("metadata projection preserves denied or unknown permissions and incomplete discovery", async () => {
  const app = Fastify();
  const children = [false, null, undefined].map((permission, index) => ({
    id: `child-${index}`,
    parentThreadId: "root",
    source: { subAgent: {} },
    canAcceptDirectInput: permission,
    status: { type: "idle" },
  }));
  registerSessionSubagentRoutes(app, {
    origin: () => "http://fixture.invalid",
    fetch: async (url) =>
      String(url).endsWith("thread/list")
        ? Response.json({ data: children, nextCursor: null })
        : Response.json({ error: "unavailable" }, { status: 503 }),
    stop: async () => {
      throw new Error("Passive reads cannot stop tasks");
    },
  });
  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/session/subagents/snapshot",
      payload: { rootId: "root", observedIds: ["missing-child"] },
    });
    assert.equal(response.statusCode, 200);
    const result = response.json();
    assert.deepEqual(
      result.threads.map((thread: any) => thread.canAcceptDirectInput),
      [false, null, undefined],
    );
    assert.equal(
      Object.hasOwn(result.threads[2], "canAcceptDirectInput"),
      false,
    );
    assert.equal(result.complete, false);
    assert.deepEqual(result.unavailableIds, ["missing-child"]);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0], /missing-child/);
  } finally {
    await app.close();
  }
});
test("validates identities and stop ranges before any upstream request", async () => {
  const app = Fastify();
  let calls = 0;
  registerSessionSubagentRoutes(app, {
    origin: () => "http://127.0.0.1",
    fetch: async () => {
      calls++;
      throw Error("should not call");
    },
    stop: async () => {},
  });
  try {
    for (const [url, payload] of [
      ["snapshot", { rootId: "__proto__" }],
      ["snapshot", { rootId: "root", observedIds: ["../../secret"] }],
      ["roles", { rootId: "root\0" }],
      [
        "stop",
        {
          rootId: "root",
          targets: [
            { threadId: "child", turnId: "turn" },
            { threadId: "child", turnId: "turn" },
          ],
        },
      ],
    ] as const)
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url: `/api/session/subagents/${url}`,
            payload,
          })
        ).statusCode,
        400,
      );
    assert.equal(calls, 0);
  } finally {
    await app.close();
  }
});
test("roles derive cwd from native identity, not an injected client path; metadata fallback is read-only", async () => {
  const app = Fastify(),
    calls: any[] = [];
  registerSessionSubagentRoutes(app, {
    origin: () => "http://127.0.0.1",
    fetch: async (url, init) => {
      const body = JSON.parse(init?.body as string);
      calls.push({ url, body });
      if (String(url).endsWith("metadata"))
        return Response.json({}, { status: 404 });
      return Response.json(
        String(url).endsWith("roles")
          ? { roles: [{ name: "reviewer" }] }
          : { thread: { id: "root", cwd: "/trusted" } },
      );
    },
    stop: async () => {},
  });
  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/session/subagents/roles",
      payload: { rootId: "root", cwd: "/untrusted" },
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(calls.at(-1).body, { cwd: "/trusted" });
    assert.ok(!calls.some((c) => /resume|start/.test(c.url)));
  } finally {
    await app.close();
  }
});
test("older runtime role fallback filters effective config and never exposes unrelated fields", async () => {
  const app = Fastify();
  registerSessionSubagentRoutes(app, {
    origin: () => "http://127.0.0.1",
    fetch: async (url) => {
      if (String(url).endsWith("agents/roles"))
        return Response.json({}, { status: 404 });
      if (String(url).endsWith("config/read"))
        return Response.json({
          config: {
            ignored: "private value",
            agents: {
              reviewer: { description: "Review", config_file: "/private" },
              max_threads: 6,
              "../unsafe": { description: "bad" },
            },
          },
        });
      return Response.json({ thread: { id: "root", cwd: "/trusted" } });
    },
    stop: async () => {},
  });
  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/session/subagents/roles",
      payload: { rootId: "root" },
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      roles: [{ name: "reviewer", description: "Review" }],
    });
  } finally {
    await app.close();
  }
});
test("structured role and instance mentions survive queueing and reach the native input with their identity", async () => {
  const app = Fastify(),
    calls: any[] = [];
  const queue = registerSessionFollowupRoutes(app, {
    origin: () => null,
    autoStart: false,
    runtime: {
      statuses: async () => ({ root: "idle" }),
      call: async (method, params) => {
        calls.push({ method, params });
        return { turn: { id: "turn" } };
      },
    },
  });
  try {
    const payload = {
      id: "mention-message",
      threadId: "root",
      text: "delegate",
      images: [],
      mode: "queue",
      parameters: {},
      mentions: [
        { name: "reviewer", path: "subagent://reviewer" },
        { name: "Atlas", path: "agent://child" },
      ],
    };
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/session/followups/submit",
          payload: {
            ...payload,
            mentions: [{ name: "bad", path: "file:///secret" }],
          },
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/session/followups/submit",
          payload,
        })
      ).statusCode,
      200,
    );
    await queue.tick();
    assert.deepEqual(
      calls.find((c) => c.method === "turn/start").params.input.slice(0, 2),
      payload.mentions.map((m) => ({ type: "mention", ...m })),
    );
  } finally {
    await app.close();
  }
});
