import assert from "node:assert/strict";
import { test } from "node:test";
import Fastify from "fastify";
import { EventHub } from "../core/events.js";
import { object } from "../core/json.js";
import { CodexService } from "./client.js";
import { registerCodexOperationRoutes } from "./operation-context.js";

const source = String.raw`
const readline=require('node:readline');let count=0;
const send=x=>process.stdout.write(JSON.stringify(x)+'\n');
readline.createInterface({input:process.stdin}).on('line',line=>{
const m=JSON.parse(line);if(!m.method)return;
if(m.method==='initialize'){send({id:m.id,result:{userAgent:'fixture'}});return;}
if(m.method==='initialized')return;
if(m.method==='account/read'){send({id:m.id,result:{account:{type:'amazonBedrock',usesCodexManagedCredentials:false},requiresOpenaiAuth:false,workspaceRouting:null}});return;}
if(m.method==='thread/read'){send({id:m.id,result:{thread:{id:m.params.threadId,source:'cli',status:{type:'idle'}}}});return;}
if(m.method==='thread/loaded/list'){send({id:m.id,result:{data:['t'],nextCursor:null}});return;}
if(m.method==='turn/start'){count++;send({id:m.id,result:{turn:{id:'turn',input:m.params.input}}});return;}
if(m.method==='fixture/same-account'){send({method:'account/updated',params:{authMode:'amazonBedrock'}});send({id:m.id,result:{}});return;}
if(m.method==='fixture/count'){send({id:m.id,result:{count}});return;}
send({id:m.id,result:{}});
});`;
test("lifecycle context is read-only and same-value account notifications revoke a pending write scope", async (t) => {
  const hub = new EventHub(),
    service = new CodexService({
      hub,
      instance: "scoped",
      launch: { command: process.execPath, args: ["-e", source] },
      sweepIntervalMs: 0,
    });
  t.after(async () => {
    await service.close();
    hub.close();
  });
  const context = await service.operationContext();
  assert.match(context.scope, /^[a-f0-9]{64}$/);
  assert.match(context.namespace, /^[a-f0-9]{64}$/);
  assert.equal(
    "daemonIdentity" in context,
    false,
    "a fixture stdio transport is not a verified official endpoint",
  );
  await service.guardedCall(
    "turn/start",
    { threadId: "t", input: [] },
    context.scope,
  );
  assert.equal(object(await service.raw("fixture/count", {})).count, 1);
  await service.raw("fixture/same-account", {});
  assert.throws(
    () =>
      service.guardedCall(
        "turn/start",
        { threadId: "t", input: [] },
        context.scope,
      ),
    /NOT_SENT: account or execution scope changed/,
  );
  assert.equal(object(await service.raw("fixture/count", {})).count, 1);
  const next = await service.operationContext();
  assert.notEqual(next.scope, context.scope);
  assert.equal(next.namespace, context.namespace);
});

test("fixed guarded Resume discards no target and accepts only explicit execution settings", async (t) => {
  const app = Fastify();
  const calls: unknown[] = [];
  registerCodexOperationRoutes(app, {
    operationContext: async () => ({ scope: "s", namespace: "n" }),
    guardedCall: async (...args: unknown[]) => {
      calls.push(args);
      return {};
    },
  } as unknown as CodexService);
  t.after(() => app.close());
  const rejected = await app.inject({
    method: "POST",
    url: "/api/internal/codex/guarded-resume",
    payload: {
      expectedScope: "s",
      threadId: "t",
      parameters: {
        threadId: "other",
        input: [{ type: "text", text: "unwanted" }],
      },
    },
  });
  assert.equal(rejected.statusCode, 400);
  assert.equal(calls.length, 0);
  const ok = await app.inject({
    method: "POST",
    url: "/api/internal/codex/guarded-resume",
    payload: {
      expectedScope: "s",
      threadId: "t",
      parameters: { model: "m", permissions: "workspace" },
    },
  });
  assert.equal(ok.statusCode, 200);
  assert.deepEqual(calls, [
    [
      "turn/start",
      { model: "m", permissions: "workspace", threadId: "t", input: [] },
      "s",
    ],
  ]);
});

test("read-state guard retains the opaque native revision and uses the native operation union", async (t) => {
  const app = Fastify(),
    calls: unknown[] = [];
  registerCodexOperationRoutes(app, {
    operationContext: async () => ({ scope: "s", namespace: "n" }),
    guardedCall: async (...args: unknown[]) => {
      calls.push(args);
      return {};
    },
  } as unknown as CodexService);
  t.after(() => app.close());
  const accepted = await app.inject({
    method: "POST",
    url: "/api/internal/codex/guarded-read-state",
    payload: {
      expectedScope: "s",
      threadId: "t",
      expectedRevision: "native:opaque:0123",
      operation: "read",
    },
  });
  assert.equal(accepted.statusCode, 200);
  assert.deepEqual(calls, [
    [
      "thread/readState/update",
      {
        threadId: "t",
        expectedRevision: "native:opaque:0123",
        operation: { type: "read" },
      },
      "s",
    ],
  ]);
  const rejected = await app.inject({
    method: "POST",
    url: "/api/internal/codex/guarded-read-state",
    payload: {
      expectedScope: "s",
      threadId: "t",
      expectedRevision: 123,
      operation: "read",
    },
  });
  assert.equal(rejected.statusCode, 400);
  assert.equal(calls.length, 1);
});

test("an explicit NOT_SENT guard failure is a definite rejection while ambiguous errors remain unknown", async (t) => {
  const app = Fastify();
  let message = "NOT_SENT: account scope changed";
  registerCodexOperationRoutes(app, {
    operationContext: async () => ({ scope: "s", namespace: "n" }),
    guardedCall: () => {
      throw new Error(message);
    },
  } as unknown as CodexService);
  t.after(() => app.close());
  const body = { expectedScope: "s", threadId: "t" };
  const rejected = await app.inject({
    method: "POST",
    url: "/api/internal/codex/guarded-archive",
    payload: body,
  });
  assert.equal(rejected.statusCode, 409);
  message = "DELIVERY_UNKNOWN: response was lost";
  const unknown = await app.inject({
    method: "POST",
    url: "/api/internal/codex/guarded-archive",
    payload: body,
  });
  assert.equal(unknown.statusCode, 500);
});

test("unarchive consumes the captured scope through a fixed guarded native operation", async (t) => {
  const app = Fastify(),
    calls: unknown[] = [];
  registerCodexOperationRoutes(app, {
    guardedCall: async (...args: unknown[]) => {
      calls.push(args);
      return {};
    },
  } as unknown as CodexService);
  t.after(() => app.close());
  const response = await app.inject({
    method: "POST",
    url: "/api/internal/codex/guarded-unarchive",
    payload: { expectedScope: "captured", threadId: "exact-thread" },
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(calls, [
    ["thread/unarchive", { threadId: "exact-thread" }, "captured"],
  ]);
  const invalid = await app.inject({
    method: "POST",
    url: "/api/internal/codex/guarded-unarchive",
    payload: {
      expectedScope: "captured",
      threadId: "exact-thread",
      method: "turn/start",
    },
  });
  assert.equal(invalid.statusCode, 400);
  assert.equal(calls.length, 1);
});

test("rename accepts only the captured scope, exact target and bounded native name", async (t) => {
  const app = Fastify(),
    calls: unknown[] = [];
  registerCodexOperationRoutes(app, {
    guardedCall: async (...args: unknown[]) => {
      calls.push(args);
      return {};
    },
  } as unknown as CodexService);
  t.after(() => app.close());
  const response = await app.inject({
    method: "POST",
    url: "/api/internal/codex/guarded-rename",
    payload: { expectedScope: "captured", threadId: "t", name: "Renamed" },
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(calls, [
    ["thread/name/set", { threadId: "t", name: "Renamed" }, "captured"],
  ]);
  for (const name of ["", "X".repeat(129), "line\nbreak"]) {
    const rejected = await app.inject({
      method: "POST",
      url: "/api/internal/codex/guarded-rename",
      payload: { expectedScope: "captured", threadId: "t", name },
    });
    assert.equal(rejected.statusCode, 400);
  }
  assert.equal(calls.length, 1);
});

test("fixed guarded review preserves the native target union and never accepts arbitrary dispatch", async (t) => {
  const app = Fastify(),
    calls: unknown[] = [];
  registerCodexOperationRoutes(app, {
    guardedCall: async (...args: unknown[]) => {
      calls.push(args);
      return {};
    },
  } as unknown as CodexService);
  t.after(() => app.close());
  const response = await app.inject({
    method: "POST",
    url: "/api/internal/codex/guarded-review",
    payload: {
      expectedScope: "captured",
      threadId: "t",
      delivery: "inline",
      target: { type: "uncommittedChanges" },
    },
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(calls, [
    [
      "review/start",
      {
        threadId: "t",
        delivery: "inline",
        target: { type: "uncommittedChanges" },
      },
      "captured",
    ],
  ]);
  const rejected = await app.inject({
    method: "POST",
    url: "/api/internal/codex/guarded-review",
    payload: {
      expectedScope: "captured",
      threadId: "t",
      delivery: "inline",
      target: { type: "uncommittedChanges", input: [] },
    },
  });
  assert.equal(rejected.statusCode, 400);
  assert.equal(calls.length, 1);
});

test("explicit queue restoration binds the exact captured native queue ids and scope", async (t) => {
  const app = Fastify(),
    calls: unknown[] = [];
  registerCodexOperationRoutes(app, {
    restoreQueueThread: async (...args: unknown[]) => {
      calls.push(args);
      return {};
    },
  } as unknown as CodexService);
  t.after(() => app.close());
  const response = await app.inject({
    method: "POST",
    url: "/api/internal/codex/guarded-queue-restore",
    payload: {
      expectedScope: "captured",
      threadId: "t",
      queuedSubmissionIds: ["q1", "q2"],
    },
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(calls, [["t", "captured", ["q1", "q2"]]]);
});
