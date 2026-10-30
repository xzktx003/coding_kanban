/** Private protocol fixture around the production routes and durable coordinator.
 * It never starts a native daemon, executes a plugin, or loads login data. */
import { createRequire } from "node:module";
import { createInterface } from "node:readline";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CodexService } from "../../../packages/session-runtime/src/codex/client.ts";
import { EventHub } from "../../../packages/session-runtime/src/core/events.ts";
import { registerCodexRoutes } from "../../../packages/session-runtime/src/codex/routes.ts";
import { registerSessionModeRoutes } from "../../../apps/server/src/routes/session-mode.ts";
import {
  object,
  type Json,
} from "../../../packages/session-runtime/src/core/json.ts";
const require = createRequire(resolve("packages/session-runtime/package.json")),
  Fastify = require("fastify");
const home = await mkdtemp(join(tmpdir(), "kanban-plugin-browser-")),
  hub = new EventHub(),
  service = new CodexService({
    hub,
    instance: "private-plugin-browser",
    sweepIntervalMs: 0,
    dataHome: home,
    env: {
      PATH: process.env.PATH,
      HOME: home,
      CODEX_HOME: join(home, "private-codex"),
      CODEX_PATH: join(home, "unavailable-native"),
      SESSION_CODEX_DAEMON_AUTO_START: "0",
    },
  }),
  scope = "a".repeat(64);
let unknown = false,
  accessible = false;
const installed = new Map([
    ["alpha", false],
    ["beta", false],
  ]),
  calls: Array<{ method: string; params: Json }> = [];
const apps = [
  {
    id: "app-a",
    name: "App A",
    installUrl: "https://auth.invalid/a",
    description: "Private A",
    logoUrl: null,
  },
  {
    id: "app-b",
    name: "App B",
    installUrl: "https://auth.invalid/b",
    description: "Private B",
    logoUrl: null,
  },
];
const summary = (name: string) => ({
  id: "same-native-id",
  name,
  source: { type: "local", path: `/private/${name}/plugin` },
  installed: installed.get(name),
  enabled: true,
  installPolicy: "AVAILABLE",
  authPolicy: "ON_INSTALL",
  interface: {
    displayName: name === "alpha" ? "Alpha Plugin" : "Beta Plugin",
    shortDescription: `Private ${name}`,
  },
});
const detail = (name: string) => ({
  marketplaceName: name,
  marketplacePath: `/private/${name}`,
  summary: summary(name),
  description: `${name} detail`,
  skills: [],
  hooks: [],
  apps: installed.get(name) ? apps : [],
  appTemplates: [],
  mcpServers: [],
  scheduledTasks: null,
});
service.operationContext = async () => ({
  scope,
  namespace: "private-plugin-browser-domain",
});
service.isOperationScopeCurrent = (value) => value === scope;
service.raw = async (method, params) => {
  calls.push({ method, params });
  const p = object(params),
    name = String(p.pluginName ?? "");
  if (method === "plugin/list" || method === "plugin/installed")
    return {
      marketplaces: ["alpha", "beta"].map((name) => ({
        name,
        path: `/private/${name}`,
        plugins: [summary(name)],
      })),
      marketplaceLoadErrors: [],
    } as Json;
  if (method === "plugin/read") return { plugin: detail(name) } as Json;
  if (method === "plugin/install") {
    if (!unknown) installed.set(name, true);
    if (unknown) throw new Error("connection lost after native write");
    return { authPolicy: "ON_INSTALL", appsNeedingAuth: apps } as Json;
  }
  if (method === "plugin/uninstall") {
    installed.set("alpha", false);
    return {};
  }
  if (method === "app/list")
    return {
      data: apps.map((app) => ({ ...app, isAccessible: accessible })),
      nextCursor: null,
    } as Json;
  throw new Error(`Unexpected private native method ${method}`);
};
service.call = async (method, params) => service.raw(method, params);
service.guardedCall = async (method, params, expected, beforeSend) => {
  if (expected !== scope) throw new Error("NOT_SENT: scope changed");
  beforeSend?.();
  return service.raw(method, params);
};
const native = Fastify();
registerCodexRoutes(native, service);
await native.listen({ host: "127.0.0.1", port: 0 });
const gateway = Fastify();
registerSessionModeRoutes(gateway, {
  origin: `http://127.0.0.1:${native.server.address().port}`,
});
await gateway.listen({ host: "127.0.0.1", port: 0 });
const send = (value: unknown) =>
  process.stdout.write(JSON.stringify(value) + "\n");
send({
  kind: "ready",
  origin: `http://127.0.0.1:${gateway.server.address().port}`,
  scope,
  namespace: "private-plugin-browser-domain",
});
let closing: Promise<void> | undefined;
const close = () =>
  (closing ??= (async () => {
    await gateway.close();
    await native.close();
    await service.close();
    hub.close();
    await rm(home, { recursive: true, force: true });
  })());
const lines = createInterface({ input: process.stdin });
lines.on("line", (line) => {
  void (async () => {
    const value = JSON.parse(line);
    if (value.method === "unknown") unknown = true;
    else if (value.method === "complete") installed.set("alpha", true);
    else if (value.method === "accessible") accessible = true;
    else if (value.method === "close") {
      await close();
      send({ id: value.id, value: { closed: true } });
      lines.close();
      process.stdin.destroy();
      return;
    } else if (value.method !== "metrics")
      throw new Error("Unknown private fixture control");
    send({
      id: value.id,
      value: { calls, installed: Object.fromEntries(installed) },
    });
  })().catch((error) => {
    console.error(error);
    void close().finally(() => process.exit(1));
  });
});
lines.once("close", () => void close());
process.once("SIGTERM", () => void close().finally(() => process.exit(0)));
