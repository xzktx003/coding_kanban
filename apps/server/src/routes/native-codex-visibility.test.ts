import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import WebSocket from "ws";
import { registerNativeCodexVisibility } from "./native-codex-visibility.js";
import { registerNativeCodexRoutes } from "./native-codex.js";
import { NativeCodexGateway } from "../services/native-codex-gateway.js";

async function fixture(
  t: TestContext,
  fullRoutes = false,
  privateControl = false,
) {
  const moduleUrl = new URL(
    "../../../../packages/native-codex-host/refresh-prototype/visibility-leases.mjs",
    import.meta.url,
  ).href;
  const { createVisibleLeaseController } = await import(moduleUrl);
  const profileId = randomUUID(),
    instanceId = randomUUID(),
    consumers = new Map<string, Set<string>>();
  const serviceScope = {
    domain: randomUUID(),
    generation: randomUUID(),
    pid: process.pid,
    startTicks: "0",
  };
  let gatewayScope = serviceScope;
  const manager = {
    serviceScope,
    snapshot: () => ({ ready: true, authorizationBound: true }),
    onInvalidated: () => () => {},
    scopeForThread: async (threadId: string) => ({ threadId }),
    open: async (
      key: { threadId: string },
      { consumerId }: { consumerId: string },
    ) => {
      const ids = consumers.get(consumerId) ?? new Set();
      ids.add(key.threadId);
      consumers.set(consumerId, ids);
    },
    disconnect: async (id: string) => {
      consumers.delete(id);
    },
  };
  const controller = createVisibleLeaseController({ manager, profileId });
  let routeController = controller;
  if (privateControl) {
    const { mkdtemp, rm } = await import("node:fs/promises"),
      { tmpdir } = await import("node:os"),
      { join } = await import("node:path");
    const root = await mkdtemp(join(tmpdir(), "ck-route-control-"));
    const { listenRefreshControl, connectRefreshControl } = await import(
      new URL(
        "../../../../packages/native-codex-host/refresh-prototype/control-channel.mjs",
        import.meta.url,
      ).href
    );
    const server = await listenRefreshControl({
      manager,
      runtimeRoot: root,
      profiles: [profileId],
    });
    const connection = await connectRefreshControl({
      runtimeRoot: root,
      record: server.record,
    });
    routeController = connection.visibility(profileId);
    t.after(async () => {
      await connection.close();
      await server.close();
      await rm(root, { recursive: true, force: true });
    });
  }
  const app = Fastify();
  await app.register(websocket);
  app.get("/global", { websocket: true }, (socket) => {
    socket.on("message", (data) => socket.send(data));
  });
  const routeOptions = {
    profileId,
    controller: routeController,
    sameOrigin: (request: import("fastify").FastifyRequest) =>
      request.headers.origin === `http://${request.headers.host}`,
    gateway: {
      runtime: async () => ({ refreshScope: gatewayScope }),
      instanceStatus: async (value: unknown) => ({
        status: 200,
        active: (value as { instanceId: string }).instanceId === instanceId,
      }),
    },
  };
  let localOrigin = "";
  if (fullRoutes) {
    const gateway = new NativeCodexGateway(() => ({}));
    gateway.runtime = async () => ({
      upstream: new URL(localOrigin),
      projectDir: "/private/metadata",
      fixtures: [],
      refreshScope: gatewayScope,
    });
    gateway.instanceStatus = routeOptions.gateway.instanceStatus;
    gateway.status = async () => ({
      available: true,
      resumeAvailable: true,
      sendAvailable: false,
      iframeUrl: "/native-codex/",
    });
    await registerNativeCodexRoutes(app, {
      gateway,
      profileId,
      visibility: routeController,
    });
  } else await registerNativeCodexVisibility(app, routeOptions);
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`,
    url = `${origin.replace("http:", "ws:")}/native-codex/clients/${profileId}/kanban-visibility`;
  localOrigin = origin;
  t.after(async () => {
    await app.close();
    await controller.close();
  });
  async function connect() {
    const socket = new WebSocket(url, { headers: { origin } });
    await once(socket, "open");
    return socket;
  }
  async function message(socket: WebSocket, value: unknown) {
    const next = once(socket, "message");
    socket.send(JSON.stringify(value));
    return JSON.parse(String((await next)[0]));
  }
  return {
    app,
    controller,
    consumers,
    origin,
    url,
    instanceId,
    connect,
    message,
    changeService: () => {
      gatewayScope = { ...gatewayScope, generation: randomUUID() };
    },
  };
}
test("page visibility uses one private lease across reconnect and reports only bounded metadata", async (t) => {
  const f = await fixture(t),
    a = await f.connect();
  const hello = await f.message(a, { type: "hello", instanceId: f.instanceId });
  assert.equal(hello.type, "hello");
  const id = randomUUID();
  assert.deepEqual(
    await f.message(a, { type: "visible", sequence: 1, threadIds: [id] }),
    { type: "ack", sequence: 1 },
  );
  assert.equal(f.consumers.size, 1);
  a.terminate();
  await once(a, "close");
  const b = await f.connect();
  await f.message(b, {
    type: "hello",
    instanceId: f.instanceId,
    leaseId: hello.leaseId,
    token: hello.token,
  });
  assert.deepEqual(
    await f.message(b, { type: "visible", sequence: 1, threadIds: [id] }),
    { type: "ack", sequence: 1 },
  );
  assert.equal(f.consumers.size, 1);
  await f.message(b, { type: "visible", sequence: 2, threadIds: [] });
  assert.equal(f.consumers.size, 0);
  b.close();
});
test(
  "actual profile route uses private control callbacks and fences a changed native service before the next update",
  { timeout: 10000 },
  async (t) => {
    const f = await fixture(t, true, true),
      socket = await f.connect();
    const hello = await f.message(socket, {
      type: "hello",
      instanceId: f.instanceId,
    });
    assert.equal(hello.type, "hello");
    assert.deepEqual(
      await f.message(socket, {
        type: "visible",
        sequence: 1,
        threadIds: [randomUUID()],
      }),
      { type: "ack", sequence: 1 },
    );
    assert.equal(f.consumers.size, 1);
    f.changeService();
    assert.deepEqual(
      await f.message(socket, { type: "visible", sequence: 2, threadIds: [] }),
      { type: "error", code: "unavailable" },
    );
    assert.equal(
      f.consumers.size,
      1,
      "unknown new native identity cannot clear the original protected consumer",
    );
    socket.terminate();
  },
);
test("visibility denies missing and foreign origins before any lease is created", async (t) => {
  const f = await fixture(t);
  for (const origin of [undefined, "http://foreign.invalid"]) {
    const socket = new WebSocket(f.url, origin ? { headers: { origin } } : {});
    const response = await new Promise<number>((resolve, reject) => {
      socket.on("unexpected-response", (_req, res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
        socket.terminate();
      });
      socket.on("error", () => {});
      setTimeout(() => reject(Error("origin refusal missing")), 1000).unref();
    });
    assert.equal(response, 403);
  }
  assert.equal(f.controller.snapshot().leases, 0);
});
test("oversized fragmented visibility messages keep their own limit and leave the shared WS budget intact", async (t) => {
  const f = await fixture(t),
    socket = await f.connect(),
    closed = once(socket, "close");
  socket.send("x".repeat(4096), { fin: false });
  socket.send("x".repeat(4097), { fin: true });
  assert.equal((await closed)[0], 1009);
  const other = new WebSocket(f.origin.replace("http:", "ws:") + "/global");
  await once(other, "open");
  const reply = once(other, "message");
  other.send("x".repeat(2 * 1024 * 1024 + 1));
  assert.equal(String((await reply)[0]).length, 2 * 1024 * 1024 + 1);
  other.close();
});
test("a stale native instance cannot create visibility protection", async (t) => {
  const f = await fixture(t),
    socket = await f.connect(),
    closed = once(socket, "close");
  socket.send(JSON.stringify({ type: "hello", instanceId: randomUUID() }));
  assert.equal((await closed)[0], 1008);
  assert.equal(f.controller.snapshot().leases, 0);
});

test(
  "a registered host from another native service generation cannot acquire or renew the lease",
  { timeout: 2000 },
  async (t) => {
    const f = await fixture(t),
      socket = await f.connect();
    await f.message(socket, { type: "hello", instanceId: f.instanceId });
    f.changeService();
    const closed = once(socket, "close");
    assert.equal(
      (
        await f.message(socket, {
          type: "visible",
          sequence: 1,
          threadIds: [randomUUID()],
        })
      ).type,
      "error",
    );
    assert.equal((await closed)[0], 1008);
    assert.equal(f.consumers.size, 0);
  },
);

test(
  "the explicit control route wins over the native wildcard proxy and only a matching profile advertises it",
  { timeout: 3000 },
  async (t) => {
    const f = await fixture(t, true),
      statusPath =
        new URL(f.url).pathname
          .replace("/kanban-visibility", "")
          .replace("/native-codex/", "/api/native-codex/") + "/status";
    assert.deepEqual(
      (await f.app.inject(statusPath)).json().refreshVisibility,
      { available: true },
    );
    const ordinary = await f.app.inject({
      url: new URL(f.url).pathname,
      headers: { origin: f.origin, host: new URL(f.origin).host },
    });
    assert.equal(ordinary.statusCode, 426);
    const socket = await f.connect();
    assert.equal(
      (await f.message(socket, { type: "hello", instanceId: f.instanceId }))
        .type,
      "hello",
    );
    socket.close();
    f.changeService();
    assert.deepEqual(
      (await f.app.inject(statusPath)).json().refreshVisibility,
      { available: false },
    );
  },
);
