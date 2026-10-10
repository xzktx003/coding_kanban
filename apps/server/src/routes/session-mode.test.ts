import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";

import { registerSessionModeRoutes } from "./session-mode.js";

test("session gateway preserves JSON, query parameters and response status", async () => {
  const app = Fastify();
  const requests: Array<{ url: string; body?: string }> = [];
  registerSessionModeRoutes(app, {
    origin: "http://127.0.0.1:12345",
    fetch: async (url, init) => {
      requests.push({ url: String(url), body: init?.body as string });
      return new Response(JSON.stringify({ thread: "one" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    },
  });
  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/session/api/codex/thread/start?cursor=a%2Fb",
      payload: { cwd: "/project" },
    });
    assert.equal(response.statusCode, 201);
    assert.deepEqual(response.json(), { thread: "one" });
    assert.equal(
      requests[0].url,
      "http://127.0.0.1:12345/api/codex/thread/start?cursor=a%2Fb",
    );
    assert.deepEqual(JSON.parse(requests[0].body!), { cwd: "/project" });
  } finally {
    await app.close();
  }
});

test("gateway returns an actionable unavailable response", async () => {
  const app = Fastify();
  registerSessionModeRoutes(app, {
    origin: "http://127.0.0.1:12345",
    fetch: async () => {
      throw new Error("offline");
    },
  });
  try {
    const response = await app.inject({ url: "/api/session/health" });
    assert.equal(response.statusCode, 503);
    assert.match(response.json().error, /会话|session/i);
  } finally {
    await app.close();
  }
});

test("gateway rejects attempts to change the upstream or traverse its namespace", async () => {
  for (const origin of [
    "https://example.org",
    "http://10.0.0.1:12345",
    "http://127.0.0.1:12345/private",
  ]) {
    assert.throws(
      () => registerSessionModeRoutes(Fastify(), { origin }),
      /loopback|origin/i,
    );
  }
});

test("binary assets remain byte identical through the gateway", async () => {
  const app = Fastify();
  const bytes = Buffer.from([0, 255, 137, 80, 78, 71]);
  registerSessionModeRoutes(app, {
    origin: "http://127.0.0.1:12345",
    fetch: async () =>
      new Response(bytes, { headers: { "content-type": "image/png" } }),
  });
  try {
    const response = await app.inject({
      url: "/api/session/api/filesystem/asset?path=%2Fproject%2Fimage.png",
    });
    assert.deepEqual(response.rawPayload, bytes);
    assert.equal(response.headers["content-type"], "image/png");
  } finally {
    await app.close();
  }
});

test("shared project catalog merges local terminal and session paths and excludes remote paths", async () => {
  const app = Fastify();
  registerSessionModeRoutes(app, {
    origin: "http://127.0.0.1:12345",
    projects: () => ["/shared", "/terminal", "~", "/bad\npath"],
    fetch: async () =>
      new Response(
        JSON.stringify({ workspace: { projects: ["/shared", "/session"] } }),
      ),
  });
  try {
    const response = await app.inject("/api/workbench/projects");
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json().projects, [
      "/shared",
      "/terminal",
      "/session",
    ]);
  } finally {
    await app.close();
  }
});

test("WebSocket gateway retains replay cursors and namespace filters", async () => {
  const { default: websocket } = await import("@fastify/websocket");
  const { WebSocket, WebSocketServer } = await import("ws");
  const upstream = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise<void>((resolve) => upstream.once("listening", resolve));
  const port = (upstream.address() as { port: number }).port;
  const received = new Promise<string>((resolve) =>
    upstream.once("connection", (socket, request) => {
      resolve(request.url!);
      socket.send("connected");
    }),
  );
  const app = Fastify();
  await app.register(websocket);
  await app.register(async (instance) =>
    registerSessionModeRoutes(instance, { origin: `http://127.0.0.1:${port}` }),
  );
  await app.listen({ host: "127.0.0.1", port: 0 });
  const client = new WebSocket(
    `${app.listeningOrigin.replace(/^http/, "ws")}/ws/session?since=42&agents=terminal`,
  );
  try {
    await new Promise((resolve) => client.once("message", resolve));
    assert.equal(await received, "/ws?since=42&agents=terminal");
  } finally {
    client.close();
    for (const socket of upstream.clients) socket.terminate();
    await app.close();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  }
});

test("browsers cannot forge queue ownership holds through the session proxy", async () => {
  const app = Fastify();
  let calls = 0;
  registerSessionModeRoutes(app, {
    origin: "http://127.0.0.1:12345",
    fetch: async () => {
      calls++;
      return new Response("{}");
    },
  });
  try {
    for (const prefix of ["internal", "%69nternal"]) {
      const response = await app.inject({
        method: "POST",
        url: `/api/session/api/${prefix}/codex/queue-holds`,
        payload: { busy: false, threadIds: [] },
      });
      assert.equal(response.statusCode, 403);
    }
    assert.equal(calls, 0);
  } finally {
    await app.close();
  }
});

test("session gateway chat SSE projection strips tool bodies before browser delivery", async () => {
  const app = Fastify();
  const requests: string[] = [];
  const big = "x".repeat(10_000);
  registerSessionModeRoutes(app, {
    origin: "http://127.0.0.1:12345",
    fetch: async (url) => {
      requests.push(String(url));
      return new Response(
        [
          `data: ${JSON.stringify({
            seq: 1,
            event: "codex:notification",
            payload: {
              method: "item/commandExecution/outputDelta",
              params: {
                threadId: "thread",
                turnId: "turn",
                itemId: "cmd",
                delta: big,
              },
            },
          })}\r\n\r\n`,
          `data: ${JSON.stringify({
            seq: 2,
            event: "codex/approval-request",
            payload: {
              threadId: "thread",
              turnId: "turn",
              itemId: "cmd",
              requestId: "approval",
              reason: "needs approval",
            },
          })}\n\n`,
          `data: ${JSON.stringify({
            seq: 3,
            event: "codex:notification",
            payload: {
              method: "item/completed",
              params: {
                threadId: "thread",
                turnId: "turn",
                item: {
                  id: "cmd",
                  type: "commandExecution",
                  status: "completed",
                  command: "cat huge.log",
                  aggregatedOutput: big,
                  exitCode: 0,
                },
              },
            },
          })}\n\n`,
          `data: ${JSON.stringify({
            seq: 4,
            event: "codex:notification",
            payload: {
              method: "rawResponseItem/completed",
              params: {
                threadId: "thread",
                turnId: "turn",
                item: {
                  type: "function_call",
                  id: "raw",
                  name: "web.run",
                  arguments: big,
                  call_id: "call",
                },
              },
            },
          })}\n\n`,
          `data: ${JSON.stringify({
            seq: 5,
            event: "codex:notification",
            payload: {
              method: "item/commandExecution/terminalInteraction",
              params: {
                threadId: "thread",
                turnId: "turn",
                itemId: "cmd",
                processId: "proc",
                stdin: big,
              },
            },
          })}\n\n`,
          `data: ${JSON.stringify({
            seq: 6,
            event: "codex:notification",
            payload: {
              method: "hook/completed",
              params: {
                threadId: "thread",
                turnId: "turn",
                run: {
                  id: "hook",
                  status: "completed",
                  eventName: "Stop",
                  entries: [{ output: big }],
                },
              },
            },
          })}\n\n`,
          `data: ${JSON.stringify({
            seq: 7,
            event: "codex:notification",
            payload: {
              method: "item/autoApprovalReview/completed",
              params: {
                threadId: "thread",
                turnId: "turn",
                reviewId: "review",
                targetItemId: "cmd",
                startedAtMs: 1,
                completedAtMs: 2,
                decisionSource: "user",
                review: {
                  status: "approved",
                  riskLevel: "medium",
                  userAuthorization: null,
                  rationale: big,
                },
                action: {
                  type: "command",
                  command: big,
                  cwd: "/repo",
                },
              },
            },
          })}\n\n`,
        ].join(""),
        { headers: { "content-type": "text/event-stream" } },
      );
    },
  });
  try {
    const response = await app.inject({
      url: "/api/session/api/events?since=5&view=chat",
    });
    assert.equal(response.statusCode, 200);
    assert.equal(requests[0], "http://127.0.0.1:12345/api/events?since=5");
    assert.equal(response.body.includes(big), false);
    const frames = response.body
      .trim()
      .split("\n\n")
      .map((frame) => JSON.parse(frame.replace(/^data: /, "")));
    assert.equal(frames[0].seq, 1);
    assert.equal(frames[0].payload.params.delta, undefined);
    assert.equal(frames[1].event, "codex/approval-request");
    assert.equal(frames[1].payload.reason, "needs approval");
    assert.equal(frames[2].payload.params.item.id, "cmd");
    assert.equal(frames[2].payload.params.item.status, "completed");
    assert.equal(frames[2].payload.params.item.command, undefined);
    assert.equal(frames[2].payload.params.item.aggregatedOutput, undefined);
    assert.deepEqual(frames[3].payload.params.item, {
      type: "function_call",
      id: "raw",
      name: "web.run",
      call_id: "call",
    });
    assert.deepEqual(frames[4].payload.params, {
      threadId: "thread",
      turnId: "turn",
      itemId: "cmd",
      processId: "proc",
    });
    assert.deepEqual(frames[5].payload.params.run, {
      id: "hook",
      status: "completed",
      eventName: "Stop",
    });
    assert.equal(frames[6].payload.params.review.rationale.length, 1025);
    assert.equal(frames[6].payload.params.action.command, undefined);
    assert.equal(frames[6].payload.params.action.type, "command");
  } finally {
    await app.close();
  }
});

test("session gateway chat SSE projection stops on oversized frames", async () => {
  const app = Fastify();
  const oversized = "x".repeat(17 * 1024 * 1024);
  registerSessionModeRoutes(app, {
    origin: "http://127.0.0.1:12345",
    fetch: async () =>
      new Response(
        `data: ${JSON.stringify({
          seq: 9,
          event: "codex:notification",
          payload: {
            method: "item/agentMessage/delta",
            params: {
              threadId: "thread",
              turnId: "turn",
              itemId: "reply",
              delta: oversized,
            },
          },
        })}\n\n`,
        { headers: { "content-type": "text/event-stream" } },
      ),
  });
  try {
    const response = await app.inject({
      url: "/api/session/api/events?view=chat",
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.includes(oversized), false);
    assert.match(response.body, /^event: session-projection-error\n/);
    assert.match(
      response.body,
      /Session event frame exceeds chat projection limit/,
    );
  } finally {
    await app.close();
  }
});

test("session gateway chat history projection strips tool bodies but keeps protocol shape", async () => {
  const app = Fastify();
  const big = "x".repeat(10_000);
  const requests: string[] = [];
  registerSessionModeRoutes(app, {
    origin: "http://127.0.0.1:12345",
    fetch: async (url) => {
      requests.push(String(url));
      return new Response(
        JSON.stringify({
          thread: {
            id: "thread",
            turns: [
              {
                id: "turn",
                items: [
                  { id: "reply", type: "agentMessage", text: "visible reply" },
                  {
                    id: "cmd",
                    type: "commandExecution",
                    status: "completed",
                    command: big,
                    aggregatedOutput: big,
                  },
                  {
                    id: "spawn",
                    type: "collabAgentToolCall",
                    tool: "spawnAgent",
                    status: "completed",
                    receiverThreadIds: ["child"],
                    agentsStates: {
                      child: { status: "completed", message: big },
                    },
                    prompt: big,
                  },
                ],
              },
            ],
          },
        }),
        { headers: { "content-type": "application/json" } },
      );
    },
  });
  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/session/api/codex/thread/read?view=chat",
      payload: { threadId: "thread" },
    });
    assert.equal(response.statusCode, 200);
    assert.equal(requests[0], "http://127.0.0.1:12345/api/codex/thread/read");
    assert.equal(response.body.includes(big), false);
    const body = response.json();
    const items = body.thread.turns[0].items;
    assert.equal(items[0].text, "visible reply");
    assert.deepEqual(items[1], {
      id: "cmd",
      type: "commandExecution",
      status: "completed",
    });
    assert.deepEqual(items[2], {
      id: "spawn",
      type: "collabAgentToolCall",
      tool: "spawnAgent",
      status: "completed",
      receiverThreadIds: ["child"],
      prompt: `${big.slice(0, 1024)}…`,
      agentsStates: {
        child: { status: "completed", message: `${big.slice(0, 1024)}…` },
      },
    });
  } finally {
    await app.close();
  }
});
