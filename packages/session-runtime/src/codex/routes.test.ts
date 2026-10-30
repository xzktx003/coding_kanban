import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { registerCodexRoutes } from "./routes.js";
import { CodexService } from "./client.js";
import { EventHub } from "../core/events.js";
import type { Json } from "../core/json.js";
import { RpcError } from "../transport/rpc.js";

test("Slack HTTP preview uses only its private read-only host thread and returns bounded matched fields", async (t) => {
  const app = Fastify(),
    service = new CodexService({
      hub: new EventHub(),
      instance: "slack-fixture",
      sweepIntervalMs: 0,
    });
  const calls: { method: string; params: Json }[] = [];
  Object.assign(service, {
    raw: async (method: string, params: Json) => {
      calls.push({ method, params });
      if (method === "account/read")
        return {
          account: {
            type: "chatgpt",
            email: "fixture@example.invalid",
            planType: "plus",
          },
          workspaceRouting: {
            chatgptAccountId: "account-one",
            backendOrigin: "https://example.invalid",
            accountRoutingOverride: "NO_CONSTRAINT",
          },
        };
      if (method === "mcpServerStatus/list")
        return {
          data: [
            {
              name: "codex_apps",
              tools: {
                profile: {
                  name: "profile",
                  _meta: {
                    connector_name: "Slack",
                    connectorId: "slack",
                    _codex_apps: {
                      resource_uri: "/slack/workspace/slack_read_user_profile",
                    },
                  },
                },
              },
            },
          ],
          nextCursor: null,
        };
      if (method === "thread/start")
        return { thread: { id: "private-preview" } };
      if (method === "mcpServer/tool/call")
        return {
          isError: false,
          content: [
            {
              type: "text",
              text: JSON.stringify({
                result:
                  "User ID: U123\nReal Name: Alice\nTitle: " +
                  "x".repeat(8000) +
                  "\nEmail: private@example.invalid",
              }),
            },
          ],
        };
      if (method === "thread/unsubscribe") return {};
      throw new Error("Unexpected preview RPC: " + method);
    },
  });
  registerCodexRoutes(app, service);
  t.after(async () => {
    await app.close();
    await service.close();
  });
  const href = "https://team.slack.com/team/U123";
  const context = await app.inject({
    method: "POST",
    url: "/api/codex/mcp/slack-preview/context",
    payload: { href },
  });
  assert.equal(context.statusCode, 200);
  assert.equal(typeof context.json().context?.token, "string");
  const response = await app.inject({
    method: "POST",
    url: "/api/codex/mcp/slack-preview/read",
    payload: { href, contextToken: context.json().context.token },
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().data, {
    status: "ready",
    title: "Alice",
    description: "x".repeat(300),
  });
  assert(response.body.length < 1000);
  assert(!response.body.includes("private@example.invalid"));
  assert.deepEqual(calls.find((c) => c.method === "thread/start")?.params, {
    ephemeral: true,
    permissions: ":read-only",
    threadSource: "mcp_extension_host",
  });
  const call = calls.find((c) => c.method === "mcpServer/tool/call")!;
  assert.equal((call.params as any).threadId, "private-preview");
  assert.deepEqual((call.params as any).arguments, {
    user_id: "U123",
    response_format: "detailed",
  });
  assert(
    !calls.some((c) =>
      /^(?:turn\/|thread\/(?:resume|fork|rollback))/u.test(c.method),
    ),
  );
  assert.equal(service.ownership.ids().length, 0);
});

test("GitHub preview endpoints reject unsupported URLs and caller-supplied tool or account routing", async t => {
  const app = Fastify(), service = new CodexService({ hub: new EventHub(), instance: "github-route-validation", sweepIntervalMs: 0 });
  let calls = 0; Object.assign(service, { raw: async () => { calls++; throw new Error("Should not dispatch"); } });
  registerCodexRoutes(app, service); t.after(async () => { await app.close(); await service.close(); });
  for (const payload of [{href:"https://github.com/a/b/pull/1",tool:"shell"}, {href:"https://github.com/a/b/pull/1",threadId:"running-agent"}, {href:"https://evil.invalid/a/b/pull/1"}, {href:"https://github.com/a/b/pull/0"}]) {
    const response = await app.inject({method:"POST",url:"/api/codex/mcp/github-preview/context",payload});
    assert.equal(response.statusCode,400);
  }
  assert.equal(calls,0);
});

test("HTTP readonly history and metadata never implicitly resume; compatibility aliases dispatch exact methods", async (t) => {
  const app = Fastify(),
    service = new CodexService({
      hub: new EventHub(),
      instance: "test",
      sweepIntervalMs: 0,
    });
  const calls: { method: string; params: Json }[] = [];
  const raw = async (method: string, params: Json): Promise<Json> => {
    calls.push({ method, params });
    return {
      config: {
        agents: {
          worker: { description: "safe" },
          token: "secret",
          "bad/name": { description: "hide" },
        },
      },
      thread: { id: "t", turns: [] },
      data: [],
      nextCursor: null,
    };
  };
  Object.assign(service, { raw, call: raw });
  service.readHistory = async (id) => {
    calls.push({ method: "history", params: { id } });
    return { thread: { id, turns: [] } };
  };
  registerCodexRoutes(app, service);
  t.after(() => app.close());
  let r = await app.inject({
    method: "POST",
    url: "/api/codex/thread/metadata",
    payload: { threadId: "t", includeTurns: true },
  });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(calls.pop(), {
    method: "thread/read",
    params: { threadId: "t", includeTurns: false },
  });
  r = await app.inject({
    method: "POST",
    url: "/api/codex/thread/read",
    payload: { threadId: "t" },
  });
  assert.equal(r.statusCode, 200);
  assert.equal(calls.pop()?.method, "history");
  for (const [path, method] of [
    ["start-thread", "thread/start"],
    ["thread/rename", "thread/name/set"],
    ["mcp/status/list", "mcpServerStatus/list"],
    ["feedback/upload", "feedback/upload"],
    [
      "external-agent-config/import/read-histories",
      "externalAgentConfig/import/readHistories",
    ],
  ]) {
    r = await app.inject({
      method: "POST",
      url: "/api/codex/" + path,
      payload: { x: true },
    });
    assert.equal(r.statusCode, 200);
    assert.deepEqual(calls.pop(), { method, params: { x: true } });
  }
  r = await app.inject({
    method: "POST",
    url: "/api/codex/agents/roles",
    payload: { cwd: "/tmp" },
  });
  assert.deepEqual(r.json(), {
    roles: [{ name: "worker", description: "safe" }],
  });
  assert(!calls.some((x) => x.method === "thread/resume"));
});

test("HTTP queue ownership validates u128 and monotonically rejects stale snapshots", async (t) => {
  const app = Fastify(),
    service = new CodexService({
      hub: new EventHub(),
      instance: "test",
      sweepIntervalMs: 0,
    });
  registerCodexRoutes(app, service);
  t.after(() => app.close());
  const send = (payload: object) =>
    app.inject({
      method: "POST",
      url: "/api/internal/codex/queue-holds",
      payload,
    });
  assert.equal(
    (await send({ sequence: "123", busy: false, threadIds: ["t"] })).statusCode,
    200,
  );
  assert.equal(
    (await send({ sequence: "122", busy: false, threadIds: [] })).statusCode,
    409,
  );
  for (const sequence of ["-1", "1.0", (1n << 128n).toString(), ""])
    assert.equal(
      (await send({ sequence, busy: false, threadIds: [] })).statusCode,
      400,
    );
  assert.equal(
    (await send({ sequence: "124", busy: "false", threadIds: [] })).statusCode,
    400,
  );
});

test("MCP refresh forwards only the fixed native RPC and rejects arbitrary parameters",async()=>{
 const app=Fastify(),service=new CodexService({hub:new EventHub(),instance:"mcp-auth-route",sweepIntervalMs:0});
 const calls:any[]=[];
 Object.assign(service,{raw:async(method:string,params:Json)=>{calls.push({method,params});return {};}});
 registerCodexRoutes(app,service);
 try {
  const ok=await app.inject({method:"POST",url:"/api/codex/mcp/reload",payload:{}});assert.equal(ok.statusCode,200);assert.deepEqual(calls,[{method:"config/mcpServer/reload",params:null}]);
  assert.equal((await app.inject({method:"POST",url:"/api/codex/mcp/reload",payload:{path:"/other",command:"anything"}})).statusCode,400);assert.equal(calls.length,1);
 }finally{await app.close();await service.close();}
});

test("completed Goal clear has its own owner-only route and validates the full captured goal", async t => {
  const app = Fastify(), service = new CodexService({ hub: new EventHub(), instance: "goal-clear-route", sweepIntervalMs: 0 });
  let mutations = 0;
  Object.assign(service, { call: async () => { mutations++; throw new Error("Must not acquire"); }, raw: async () => { mutations++; throw new Error("Must not start native"); } });
  registerCodexRoutes(app, service);
  t.after(async () => { await app.close(); await service.close(); });
  const payload = { threadId: "t", expectedAccessGeneration: 0, expectedGoal: { threadId: "t", objective: "completed", status: "complete", tokenBudget: null, tokensUsed: 2, timeUsedSeconds: 1, createdAt: 100, updatedAt: 101 } };
  const send = (body: object) => app.inject({ method: "POST", url: "/api/codex/thread/goal/clear-completed", payload: body });
  const response = await send(payload);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { cleared: false, reason: "notOwned" });
  for (const malformed of [{ ...payload, expectedAccessGeneration: -1 }, { ...payload, expectedAccessGeneration: 0.5 }, { ...payload, expectedGoal: { ...payload.expectedGoal, objective: undefined } }, { ...payload, expectedGoal: { ...payload.expectedGoal, status: "active" } }, { ...payload, expectedGoal: { ...payload.expectedGoal, threadId: "other" } }, { ...payload, expectedGoal: { ...payload.expectedGoal, futureField: true } }, { ...payload, ifGoalUnchanged: payload.expectedGoal }, { ...payload, threadId: "\u0000invalid" }]) {
    assert.equal((await send(malformed)).statusCode, 400);
  }
  assert.equal(mutations, 0);
});

test("only a native invalid-request Goal read is projected as structured unavailable", async t => {
  const app = Fastify(), service = new CodexService({ hub: new EventHub(), instance: "goal-read-unavailable", sweepIntervalMs: 0 });
  let failure: Error = new RpcError("thread not found: fixture", -32600);
  Object.assign(service, { call: async () => { throw failure; } });
  app.setErrorHandler((error, _request, reply) => {
    const value = error as Error & { statusCode?: number; code?: string; nativeErrorCode?: number };
    reply.code(value.statusCode ?? 500).send({ error: value.message, ...(value.code ? { code: value.code } : {}), ...(value.nativeErrorCode === undefined ? {} : { nativeErrorCode: value.nativeErrorCode }) });
  });
  registerCodexRoutes(app, service);
  t.after(async () => { await app.close(); await service.close(); });
  const url = "/api/codex/thread/goal/get";
  const unavailable = await app.inject({ method: "POST", url, payload: { threadId: "fixture" } });
  assert.equal(unavailable.statusCode, 409);
  assert.deepEqual(unavailable.json(), {
    error: "原生 Goal 状态暂不可用，不能推断为无活动 Goal",
    code: "NATIVE_READ_UNAVAILABLE",
    nativeErrorCode: -32600,
  });
  failure = new RpcError("unrelated invalid request", -32600);
  const stillScopedToGoal = await app.inject({ method: "POST", url: "/api/codex/thread/queue/list", payload: { threadId: "fixture" } });
  assert.equal(stillScopedToGoal.statusCode, 500);
  failure = Object.assign(new Error("thread not found: fixture"), { code: -32600 });
  const plainError = await app.inject({ method: "POST", url, payload: { threadId: "fixture" } });
  assert.equal(plainError.statusCode, 500);
});

for (const path of ["set", "clear", "clear-completed"]) test(`an aborted Goal ${path} HTTP request reaches its preflight cancellation signal before any response`, async t => {
  const app = Fastify(), service = new CodexService({ hub: new EventHub(), instance: "goal-abort-route", sweepIntervalMs: 0 });
  let entered!: (signal: AbortSignal | undefined) => void;
  const pending = new Promise<AbortSignal | undefined>(resolve => { entered = resolve; });
  let cancelled!: () => void;
  const cancellation = new Promise<void>(resolve => { cancelled = resolve; });
  const waitForCancellation = async (options?: { signal?: AbortSignal }) => {
    entered(options?.signal);
    if (!options?.signal) return {};
    await new Promise<void>(resolve => options.signal!.addEventListener("abort", () => { cancelled(); resolve(); }, { once: true }));
    return {};
  };
  Object.assign(service, { call: async (_method: string, _params: Json, options?: { signal?: AbortSignal }) => waitForCancellation(options) });
  Object.assign(service.ownership, { clearCompletedGoal: async (_params: Json, options?: { signal?: AbortSignal }) => waitForCancellation(options) });
  registerCodexRoutes(app, service);
  const origin = await app.listen({ host: "127.0.0.1", port: 0 });
  t.after(async () => { await app.close(); await service.close(); });
  const controller = new AbortController();
  const request = fetch(origin + "/api/codex/thread/goal/" + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ threadId: "t", status: "active" }), signal: controller.signal }).catch(() => undefined);
  const signal = await pending;
  controller.abort();
  await request;
  assert.ok(signal);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([cancellation, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Goal preflight cancellation did not reach runtime")), 1000); })]);
  } finally { clearTimeout(timer); }
  assert.equal(signal.aborted, true);
});

test("explicit start and fork scopes are checked in the native write guard and never forwarded as native parameters",async t=>{const hub=new EventHub(),service=new CodexService({hub,instance:"private-create-route-fixture",sweepIntervalMs:0}),app=Fastify(),calls:Array<{method:string;params:Json;scope:string}>=[];Object.assign(service,{guardedCall:async(method:string,params:Json,scope:string)=>{calls.push({method,params,scope});return {thread:{id:"created",cwd:"/project"}};},call:async()=>{throw new Error("Scoped creation must not use an unguarded write");}});registerCodexRoutes(app,service);t.after(async()=>{await app.close();await service.close();hub.close();});for(const method of ["start","fork"]){const params=method==="start"?{cwd:"/project"}:{threadId:"source",cwd:"/project"};const response=await app.inject({method:"POST",url:"/api/codex/thread/"+method,payload:{...params,expectedScope:"a".repeat(64)}});assert.equal(response.statusCode,200,response.body);assert.deepEqual(calls.at(-1),{method:"thread/"+method,params,scope:"a".repeat(64)});}const bad=await app.inject({method:"POST",url:"/api/codex/thread/start",payload:{cwd:"/project",expectedScope:"malformed"}});assert.equal(bad.statusCode,400);assert.equal(calls.length,2);});
