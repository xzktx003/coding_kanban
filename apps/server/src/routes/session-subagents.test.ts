import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { registerSessionSubagentRoutes } from "./session-subagents.js";
import { registerSessionFollowupRoutes } from "./session-followups.js";
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
