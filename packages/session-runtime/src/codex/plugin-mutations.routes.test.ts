import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { registerCodexRoutes } from "./routes.js";
import { CodexService } from "./client.js";
import { EventHub } from "../core/events.js";
import type { Json } from "../core/json.js";
const scope = "a".repeat(64),
  target = {
    marketplacePath: "/private/market/marketplace.json",
    remoteMarketplaceName: null,
    pluginName: "example",
  };
test("plugin HTTP mutations require durable runtime and exact validated scope/target", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "kanban-plugin-route-")),
    hub = new EventHub(),
    service = new CodexService({
      hub,
      instance: "private-plugin-route",
      sweepIntervalMs: 0,
      dataHome: home,
      env: {
        HOME: home,
        CODEX_HOME: join(home, "codex"),
        CODEX_PATH: join(home, "absent"),
        SESSION_CODEX_DAEMON_AUTO_START: "0",
      },
    }),
    app = Fastify();
  let installed = false;
  const calls: string[] = [];
  service.operationContext = async () => ({
    scope,
    namespace: "private-domain",
  });
  service.isOperationScopeCurrent = (value) => value === scope;
  service.guardedCall = async (
    method,
    params,
    expected,
    beforeSend,
  ): Promise<Json> => {
    assert.equal(expected, scope);
    calls.push(method);
    beforeSend?.();
    if (method === "plugin/read")
      return {
        plugin: {
          marketplacePath: target.marketplacePath,
          marketplaceName: "private",
          summary: {
            id: "opaque",
            name: "example",
            installed,
            source: { type: "local" },
          },
          apps: [{ id: "owned" }],
        },
      };
    if (method === "plugin/install") {
      installed = true;
      return { authPolicy: "ON_INSTALL", appsNeedingAuth: [] };
    }
    if (method === "app/list")
      return {
        data: [
          { id: "owned", isAccessible: true },
          { id: "foreign", isAccessible: true },
        ],
        nextCursor: null,
      };
    throw new Error(String(params));
  };
  registerCodexRoutes(app, service);
  t.after(async () => {
    await app.close();
    await service.close();
    hub.close();
    await rm(home, { recursive: true, force: true });
  });
  for (const invalid of [
    { expectedScope: "b".repeat(64) },
    { target: { ...target, marketplacePath: "relative" } },
    { command: "shell" },
  ]) {
    const response = await app.inject({
      method: "POST",
      url: "/api/codex/plugin/mutation",
      payload: {
        operationId: "one",
        operation: "install",
        target,
        expectedScope: scope,
        ...invalid,
      },
    });
    assert.ok(response.statusCode >= 400);
    assert.equal(response.json().deliveryStage, "not-admitted");
  }
  assert.deepEqual(calls, []);
  const response = await app.inject({
    method: "POST",
    url: "/api/codex/plugin/mutation",
    payload: {
      operationId: "one",
      operation: "install",
      target,
      expectedScope: scope,
    },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["cache-control"], "no-store");
  assert.equal(response.json().status, "accepted");
  const authentication = await app.inject({
    method: "POST",
    url: "/api/codex/plugin/authentication",
    payload: { target, expectedScope: scope, appIds: ["owned", "foreign"] },
  });
  assert.equal(authentication.statusCode, 200);
  assert.equal(authentication.headers["cache-control"], "no-store");
  assert.deepEqual(authentication.json().apps, [
    { id: "owned", isAccessible: true },
    { id: "foreign", isAccessible: null },
  ]);
  const noHome = new CodexService({
      hub,
      instance: "no-durable-store",
      sweepIntervalMs: 0,
      env: {
        HOME: home,
        CODEX_HOME: join(home, "codex"),
        CODEX_PATH: join(home, "absent"),
        SESSION_CODEX_DAEMON_AUTO_START: "0",
      },
    }),
    unsupported = Fastify();
  registerCodexRoutes(unsupported, noHome);
  const unavailable = await unsupported.inject({
    method: "POST",
    url: "/api/codex/plugin/mutation",
    payload: {},
  });
  assert.equal(unavailable.statusCode, 503);
  assert.equal(unavailable.json().deliveryStage, "not-admitted");
  await unsupported.close();
  await noHome.close();
});
