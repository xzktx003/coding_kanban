import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { mkdtemp, mkdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { registerSessionModeRoutes } from "./session-mode.js";
import type { VsCodeWebManager } from "../services/vscode-web-manager.js";

test("private editor companion uses the real listening gateway port and never waits during inject", async () => {
  const dataHome=await mkdtemp(join(tmpdir(),"kanban-host-listen-"));
  let prepare!: (paths:{extensionsDir:string;workspacesDir:string})=>Promise<void>;
  const manager={setCodexHostPreparation(callback:typeof prepare){prepare=callback;}} as unknown as VsCodeWebManager;
  const app=Fastify();
  app.register(async instance=>registerSessionModeRoutes(instance,{attachmentRoot:join(dataHome,"uploads"),vsCodeWebManager:manager}));
  try {
    await app.ready();
    const paths={extensionsDir:join(dataHome,"extensions"),workspacesDir:join(dataHome,"workspaces")};
    await assert.rejects(prepare(paths),/尚未监听/);
    await app.listen({host:"0.0.0.0",port:0});
    await prepare(paths);
    const address=app.server.address(); assert.ok(address && typeof address !== "string");
    const credential=JSON.parse(await readFile(join(dataHome,"codex-host-companion.json"),"utf8"));
    assert.equal(credential.origin,`http://127.0.0.1:${address.port}`);
    assert.equal((await stat(join(dataHome,"codex-host-companion.json"))).mode & 0o777,0o600);
    const companion=JSON.parse(await readFile(join(paths.workspacesDir,"codex-host-companion.json"),"utf8"));
    assert.equal(credential.token===companion.token,true);
    assert.equal((await stat(join(paths.extensionsDir,"coding-kanban.codex-host-bridge-0.1.0","extension.cjs"))).isFile(),true);
  } finally {await app.close();await rm(dataHome,{recursive:true,force:true});}
});

test("session gateway mounts owner-verified host APIs without starting or resuming an Agent", async () => {
  const dataHome = await mkdtemp(join(tmpdir(), "kanban-host-gateway-"));
  const cwd = join(dataHome, "project"); await mkdir(cwd);
  const app = Fastify();
  const requests: string[] = [];
  registerSessionModeRoutes(app, {
    origin: "http://127.0.0.1:1", attachmentRoot: join(dataHome, "uploads"), projects: () => [cwd],
    fetch: async (url) => { requests.push(String(url)); throw new Error("new draft does not need native runtime"); },
  });
  try {
    const relay = await app.inject("/api/session/codex-host/relay.js");
    assert.equal(relay.statusCode, 200); assert.match(relay.headers["content-type"]!, /javascript/);
    const response = await app.inject({ method: "POST", url: "/api/session/codex-host/bind", payload: {
      owner: { cwd, threadId: null, draftOwner: JSON.stringify(["codex", "", "new", cwd]) }, nonce: "nonce-a", editorKey: join(dataHome, "missing.code-workspace"),
    } });
    assert.equal(response.statusCode, 409); assert.match(response.json().message ?? response.json().error, /工作区/);
    assert.deepEqual(requests, []);
  } finally { await app.close(); await rm(dataHome, { recursive: true, force: true }); }
});

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
