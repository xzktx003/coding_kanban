import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { WebSocketServer } from "ws";
import { CodexService } from "./client.js";
import { EventHub } from "../core/events.js";

async function fixture(t: { after(callback: () => Promise<void>): void }) {
  const root = await mkdtemp(join(tmpdir(), "kanban-daemon-identity-")),
    path = join(root, "native.sock");
  const servers: ReturnType<typeof createServer>[] = [],
    sockets: WebSocketServer[] = [],
    services: CodexService[] = [],
    hubs: EventHub[] = [],
    methods: string[] = [];
  let hold = false,
    release: (() => void) | undefined,
    seen: (() => void) | undefined;
  async function bind() {
    const server = createServer(),
      wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });
    servers.push(server);
    sockets.push(wss);
    server.on("upgrade", (req, socket, head) =>
      wss.handleUpgrade(req, socket, head, (ws) =>
        ws.on("message", (data) => {
          const value = JSON.parse(String(data));
          methods.push(value.method);
          if (value.method === "initialize")
            ws.send(
              JSON.stringify({
                id: value.id,
                result: { userAgent: "Codex Desktop/0.163.0" },
              }),
            );
          if (value.method === "account/read") {
            const reply = () =>
              ws.send(
                JSON.stringify({
                  id: value.id,
                  result: {
                    account: {
                      type: "amazonBedrock",
                      usesCodexManagedCredentials: false,
                    },
                    requiresOpenaiAuth: false,
                    workspaceRouting: null,
                  },
                }),
              );
            if (hold) {
              hold = false;
              release = reply;
              seen?.();
            } else reply();
          }
        }),
      ),
    );
    await new Promise<void>((resolve) => server.listen(path, resolve));
    await chmod(path, 0o600);
  }
  function client(instance: string) {
    const hub = new EventHub(),
      service = new CodexService({
        hub,
        instance,
        env: {
          CODEX_HOME: root,
          SESSION_CODEX_DAEMON_SOCKET: path,
          SESSION_CODEX_DAEMON_AUTO_START: "0",
        },
        sweepIntervalMs: 0,
      });
    hubs.push(hub);
    services.push(service);
    return service;
  }
  t.after(async () => {
    for (const s of services) await s.close();
    for (const hub of hubs) hub.close();
    for (const wss of sockets) for (const c of wss.clients) c.terminate();
    for (const s of servers) await new Promise<void>((r) => s.close(() => r()));
    for (const wss of sockets) wss.close();
    await rm(root, { recursive: true, force: true });
  });
  await bind();
  return {
    path,
    bind,
    client,
    methods,
    holdAccount() {
      hold = true;
      const waiting = new Promise<void>((r) => {
        seen = r;
      });
      return {
        waiting,
        release() {
          release?.();
        },
      };
    },
  };
}

test("opaque daemon identity survives Kanban runtime/client replacement but not a fixed endpoint rebind", async (t) => {
  const f = await fixture(t),
    a = f.client("kanban-runtime-a"),
    b = f.client("kanban-runtime-b");
  const first = (await a.operationContext()) as {
      scope: string;
      namespace: string;
      daemonIdentity?: string;
    },
    second = (await b.operationContext()) as typeof first;
  assert.match(first.daemonIdentity ?? "", /^[a-f0-9]{64}$/);
  assert.equal(second.daemonIdentity, first.daemonIdentity);
  assert.equal(second.namespace, first.namespace);
  assert.notEqual(second.scope, first.scope);
  await a.close();
  const replacement = (await f
    .client("kanban-runtime-after-restart")
    .operationContext()) as typeof first;
  assert.equal(replacement.daemonIdentity, first.daemonIdentity);
  await rm(f.path);
  await f.bind();
  const newDaemon = f.client("kanban-runtime-new-daemon");
  const rebound = (await newDaemon.operationContext()) as typeof first;
  assert.equal(rebound.namespace, first.namespace);
  assert.notEqual(rebound.daemonIdentity, first.daemonIdentity);
  await assert.rejects(
    b.operationContext(),
    /NOT_SENT.*(endpoint|daemon).*changed/i,
  );
  await rm(f.path);
  await assert.rejects(
    newDaemon.operationContext(),
    /NOT_SENT.*(endpoint|daemon).*changed/i,
  );
  assert.ok(
    f.methods.every((method) =>
      ["initialize", "initialized", "account/read"].includes(method),
    ),
  );
});

test("an endpoint rebind during account verification cannot return a late daemon identity", async (t) => {
  const f = await fixture(t),
    service = f.client("kanban-held-context");
  await service.operationContext();
  const held = f.holdAccount(),
    pending = service.operationContext();
  await held.waiting;
  await rm(f.path);
  await f.bind();
  held.release();
  await assert.rejects(pending, /NOT_SENT.*(endpoint|daemon).*changed/i);
  assert.ok(
    f.methods.every((method) =>
      ["initialize", "initialized", "account/read"].includes(method),
    ),
  );
});
