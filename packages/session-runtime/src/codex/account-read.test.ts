import assert from "node:assert/strict";
import { test } from "node:test";
import Fastify from "fastify";
import { EventHub } from "../core/events.js";
import { HttpError, object, type Json } from "../core/json.js";
import { CodexService } from "./client.js";
import { registerCodexRoutes } from "./routes.js";
import { RpcError } from "../transport/rpc.js";

const account = {
  account: {
    type: "chatgpt",
    email: "fixture@example.invalid",
    planType: "pro",
  },
  requiresOpenaiAuth: true,
  workspaceRouting: {
    chatgptAccountId: "workspace-a",
    backendOrigin: "https://chatgpt.com",
    accountRoutingOverride: "NO_CONSTRAINT",
  },
};

const source = String.raw`
const readline = require("node:readline");
let reads = 0;
const held = [];
const send = (value) => process.stdout.write(JSON.stringify(value) + "\n");
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  if (!message.method) return;
  if (message.method === "initialize") {
    send({ id: message.id, result: { userAgent: "fixture" } });
    return;
  }
  if (message.method === "initialized") return;
  if (message.method === "account/read") {
    reads += 1;
    if (process.env.ACCOUNT_READ_MODE === "hold") {
      held.push(message.id);
      return;
    }
    if (process.env.ACCOUNT_READ_MODE === "timeout" && reads === 1) {
      send({
        id: message.id,
        error: { code: -32603, message: "workspace routing discovery timed out" },
      });
      return;
    }
    if (process.env.ACCOUNT_READ_MODE === "missing") {
      send({
        id: message.id,
        result: {
          account: { type: "chatgpt", email: "fixture@example.invalid" },
          requiresOpenaiAuth: true,
          workspaceRouting: {},
        },
      });
      return;
    }
    send({ id: message.id, result: ${JSON.stringify(account)} });
    return;
  }
  if (message.method === "fixture/count") {
    send({ id: message.id, result: { reads } });
    return;
  }
  if (message.method === "fixture/release") {
    for (const id of held.splice(0)) send({ id, result: ${JSON.stringify(account)} });
    send({ id: message.id, result: { reads } });
    return;
  }
  if (message.method === "fixture/account-updated") {
    send({ method: "account/updated", params: { authMode: "chatgpt" } });
    send({ id: message.id, result: {} });
    return;
  }
  send({ id: message.id, result: {} });
});
`;

function service(mode?: string) {
  const hub = new EventHub();
  const runtime = new CodexService({
    hub,
    instance: "account-read-coalesce",
    launch: { command: process.execPath, args: ["-e", source] },
    sweepIntervalMs: 0,
    env: mode ? { ACCOUNT_READ_MODE: mode } : {},
  });
  return { hub, runtime };
}

test("one connection generation shares a single passive account read", async (t) => {
  const { hub, runtime } = service("hold");
  t.after(async () => {
    await runtime.close();
    hub.close();
  });
  const pending = Promise.all([
    runtime.operationContext(),
    runtime.raw("account/read", { refreshToken: false }),
  ]);
  let reads = 0;
  for (let attempt = 0; attempt < 50 && reads < 1; attempt += 1) {
    reads = Number(object(await runtime.raw("fixture/count", {})).reads);
    if (reads < 1) await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(reads, 1);
  const released = object(await runtime.raw("fixture/release", {}));
  const [context, snapshot] = await pending;
  assert.equal(released.reads, 1);
  assert.equal(object(snapshot).account && object(object(snapshot).account).type, "chatgpt");
  assert.match(context.namespace, /^[a-f0-9]{64}$/);
  assert.equal(Number(object(await runtime.raw("fixture/count", {})).reads), 1);
});

test("cancelling one account reader leaves the shared discovery running", async (t) => {
  const { hub, runtime } = service("hold");
  t.after(async () => {
    await runtime.close();
    hub.close();
  });
  const kept = runtime.operationContext();
  const controller = new AbortController();
  const cancelled = runtime.raw("account/read", { refreshToken: false }, {
    signal: controller.signal,
  });
  controller.abort();
  await assert.rejects(cancelled, /NOT_SENT: RPC request aborted/);
  assert.equal(Number(object(await runtime.raw("fixture/release", {})).reads), 1);
  assert.match((await kept).namespace, /^[a-f0-9]{64}$/);
});

test("workspace routing discovery timeout is retryable and is not an identity failure", async (t) => {
  const { hub, runtime } = service("timeout");
  t.after(async () => {
    await runtime.close();
    hub.close();
  });
  await assert.rejects(
    runtime.operationContext(),
    /WORKSPACE_ROUTING_DISCOVERY_TIMEOUT/,
  );
  const context = await runtime.operationContext();
  assert.match(context.namespace, /^[a-f0-9]{64}$/);
  assert.equal(Number(object(await runtime.raw("fixture/count", {})).reads), 2);
});

test("a ChatGPT account without workspace identity stays unsupported", async (t) => {
  const { hub, runtime } = service("missing");
  t.after(async () => {
    await runtime.close();
    hub.close();
  });
  await assert.rejects(
    runtime.operationContext(),
    /DAEMON_CONTEXT_UNSUPPORTED/,
  );
});

test("account/updated drops the shared snapshot and reads again", async (t) => {
  const { hub, runtime } = service();
  t.after(async () => {
    await runtime.close();
    hub.close();
  });
  await runtime.operationContext();
  await runtime.raw("account/read", { refreshToken: false });
  assert.equal(Number(object(await runtime.raw("fixture/count", {})).reads), 1);
  await runtime.raw("fixture/account-updated", {});
  await runtime.operationContext();
  assert.equal(Number(object(await runtime.raw("fixture/count", {})).reads), 2);
});

test("public account/get maps discovery timeout to a retryable 503", async (t) => {
  const app = Fastify();
  const hub = new EventHub();
  const runtime = new CodexService({
    hub,
    instance: "account-read-route",
    sweepIntervalMs: 0,
  });
  let calls = 0;
  Object.assign(runtime, {
    call: async (method: string, params: Json) => {
      calls += 1;
      assert.equal(method, "account/read");
      assert.deepEqual(params, { refreshToken: false });
      throw new RpcError("workspace routing discovery timed out", -32603);
    },
  });
  app.setErrorHandler((error, _request, reply) => {
    const failure = error as Error & { statusCode?: number; code?: string };
    reply.code(failure.statusCode ?? 500).send({
      error: failure.message,
      ...(failure.code ? { code: failure.code } : {}),
    });
  });
  registerCodexRoutes(app, runtime);
  t.after(async () => {
    await app.close();
    await runtime.close();
    hub.close();
  });
  const response = await app.inject({
    method: "POST",
    url: "/api/codex/account/get",
    payload: { refreshToken: false },
  });
  assert.equal(response.statusCode, 503);
  assert.equal(response.json().code, "WORKSPACE_ROUTING_DISCOVERY_TIMEOUT");
  assert.equal(calls, 1);
  assert.ok(!(response.json().error instanceof HttpError));
});
