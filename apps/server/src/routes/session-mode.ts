import { registerSessionFollowupRoutes } from "./session-followups.js";
import { registerSessionSubagentRoutes } from "./session-subagents.js";
import { registerSessionProjectsRoutes } from "./session-projects.js";
import { registerWorkspaceFileRoutes } from "./workspace-files.js";
import { registerSessionTabsRoutes } from "./session-tabs.js";
import { saveSessionAttachment } from "../services/session-attachments.js";
import { resolve } from "node:path";
import { Readable } from "node:stream";
import type { FastifyInstance } from "fastify";
import WebSocket from "ws";

interface SessionModeRouteOptions {
  origin?: string;
  attachmentRoot?: string;
  fetch?: typeof globalThis.fetch;
  projects?: () => string[];
  ensureRuntime?: () => Promise<string | undefined>;
}

function validateOrigin(origin: string): URL {
  const url = new URL(origin);
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "Session runtime origin must be a plain HTTP loopback origin",
    );
  }
  return url;
}

export function registerSessionModeRoutes(
  app: FastifyInstance,
  options: SessionModeRouteOptions = {},
): void {
  registerSessionTabsRoutes(app, {
    file: options.attachmentRoot
      ? resolve(options.attachmentRoot, "..", "followed-sessions.json")
      : undefined,
  });
  const sharedProjects = registerSessionProjectsRoutes(app, {
    file: options.attachmentRoot
      ? resolve(options.attachmentRoot, "..", "projects.json")
      : undefined,
    legacyFile: options.attachmentRoot
      ? resolve(options.attachmentRoot, "..", ".codexia", "settings.json")
      : undefined,
  });
  let origin = options.origin ? validateOrigin(options.origin).origin : null;
  const fetchUpstream = options.fetch ?? globalThis.fetch;
  const followups = registerSessionFollowupRoutes(app, {
    origin: () => origin,
    fetch: fetchUpstream,
    file: options.attachmentRoot
      ? resolve(options.attachmentRoot, "..", "codex-followups.json")
      : undefined,
    autoStart: Boolean(options.attachmentRoot),
  });
  registerSessionSubagentRoutes(app, { origin: () => origin, fetch: fetchUpstream, stop: (id, turn) => followups.stop(id, turn) });
  registerWorkspaceFileRoutes(app, {
    trashHome: options.attachmentRoot
      ? resolve(options.attachmentRoot, "..", "file-trash")
      : undefined,
    roots: async () => {
      let projects: string[] = [...(options.projects?.() ?? [])];
      if (options.attachmentRoot) {
        return [...projects, ...(await sharedProjects.getProjects())];
      }
      if (origin) {
        try {
          const response = await fetchUpstream(`${origin}/api/settings`, {
            signal: AbortSignal.timeout(2000),
          });
          if (response.ok) {
            const settings = (await response.json()) as {
              workspace?: { projects?: unknown[] };
            };
            projects = [
              ...projects,
              ...(settings.workspace?.projects ?? []).filter(
                (p): p is string =>
                  typeof p === "string" &&
                  p.startsWith("/") &&
                  !/[\\\x00-\x1f]/.test(p),
              ),
            ];
          }
        } catch {
          /* Registered terminal projects remain accessible during outages. */
        }
      }
      return projects;
    },
  });
  app.get("/api/workbench/projects", async () => {
    let sessionProjects: unknown[] = [];
    if (options.attachmentRoot)
      sessionProjects = await sharedProjects.getProjects();
    else if (origin) {
      try {
        const response = await fetchUpstream(`${origin}/api/settings`, {
          signal: AbortSignal.timeout(2000),
        });
        if (response.ok) {
          const settings = (await response.json()) as {
            workspace?: { projects?: unknown[] };
          };
          sessionProjects = settings.workspace?.projects ?? [];
        }
      } catch {
        /* Terminal project access remains available during outages. */
      }
    }
    return {
      projects: [
        ...new Set(
          [...(options.projects?.() ?? []), ...sessionProjects].filter(
            (value): value is string =>
              typeof value === "string" &&
              value.startsWith("/") &&
              !/[\x00-\x1f]/.test(value),
          ),
        ),
      ],
    };
  });
  app.post<{ Body: { name: string; data: string } }>(
    "/api/session/files/upload",
    { bodyLimit: 16 * 1024 * 1024 },
    async (request, reply) => {
      if (!options.attachmentRoot)
        return reply.code(503).send({ error: "会话附件存储不可用" });
      try {
        return {
          path: await saveSessionAttachment(
            resolve(options.attachmentRoot),
            request.body,
          ),
        };
      } catch (error) {
        return reply.code(400).send({
          error: error instanceof Error ? error.message : "Invalid attachment",
        });
      }
    },
  );
  app.route({
    method: ["GET", "POST"],
    url: "/api/session/*",
    bodyLimit: 16 * 1024 * 1024,
    async handler(request, reply) {
      if (
        request.raw.url?.split("?")[0] === "/api/session/health" &&
        options.ensureRuntime
      ) {
        try {
          const ready = await options.ensureRuntime();
          origin = ready ? validateOrigin(ready).origin : null;
        } catch {
          return reply
            .code(503)
            .send({ error: "会话运行服务暂时不可用，请稍后重试" });
        }
      }
      if (!origin)
        return reply.code(503).send({
          error: "会话服务尚未启动，请检查 session:build 和服务日志。",
        });
      const suffix = request.raw.url!.slice("/api/session".length);
      const pathname = suffix.split("?")[0];
      if (
        !pathname.startsWith("/") ||
        /[\\\x00-\x1f]/.test(pathname) ||
        /(?:^|\/)\.\.(?:\/|$)|%2e|%2f/i.test(pathname)
      ) {
        return reply.code(400).send({ error: "Invalid session API path" });
      }
      if (decodeURIComponent(pathname).startsWith("/api/internal/"))
        return reply.code(403).send({ error: "Internal session API" });
      const controller = new AbortController();
      // ACP prompts and local inference can legitimately run for several minutes.
      const longRunning = [
        "/api/acp/prompt",
        "/api/acp/install-agent",
        "/api/dictation/transcribe",
      ].includes(pathname);
      const timeout = longRunning
        ? undefined
        : setTimeout(() => controller.abort(), 120_000);
      const abort = () => controller.abort();
      request.raw.on("aborted", abort);
      try {
        const response = await fetchUpstream(`${origin}${suffix}`, {
          method: request.method,
          headers:
            request.method === "POST"
              ? { "content-type": "application/json" }
              : undefined,
          body:
            request.method === "POST"
              ? JSON.stringify(request.body ?? {})
              : undefined,
          signal: controller.signal,
          redirect: "manual",
        });
        clearTimeout(timeout);
        reply.code(response.status);
        for (const name of [
          "content-type",
          "content-disposition",
          "cache-control",
          "etag",
          "x-content-type-options",
        ]) {
          const value = response.headers.get(name);
          if (value) reply.header(name, value);
        }
        reply.header("x-content-type-options", "nosniff");
        if (
          response.ok &&
          request.method === "POST" &&
          [
            "/api/codex/thread/start",
            "/api/codex/start-thread",
            "/api/codex/thread/resume",
            "/api/codex/thread/fork",
          ].includes(pathname)
        ) {
          const result = (await response.json()) as {
            thread?: { id?: string };
          };
          // Empty native threads are not listed in the state DB until their first turn.
          if (result.thread?.id)
            await followups.observe({
              method: "thread/started",
              params: { thread: result.thread },
            });
          return reply.send(result);
        }
        if (!response.body) return reply.send();
        const stream = Readable.fromWeb(
          response.body as Parameters<typeof Readable.fromWeb>[0],
        );
        reply.raw.once("close", () => {
          if (!reply.raw.writableFinished) controller.abort();
        });
        return reply.send(stream);
      } catch (error) {
        request.log.warn(
          {
            error: error instanceof Error ? error.message : "upstream failure",
          },
          "session gateway unavailable",
        );
        return reply
          .code(503)
          .send({ error: "会话服务连接失败，请重试连接。" });
      } finally {
        clearTimeout(timeout);
        request.raw.off("aborted", abort);
      }
    },
  });
  // WebSocket routes require @fastify/websocket to be registered by the host.
  if (app.hasDecorator("websocketServer")) {
    app.get("/ws/session", { websocket: true }, (client, request) => {
      if (!origin) {
        client.close(1013, "Session service unavailable");
        return;
      }
      const upstream = new WebSocket(
        `${origin.replace(/^http/, "ws")}/ws${new URL(request.raw.url!, "http://gateway").search}`,
      );
      const pending: Array<{ data: WebSocket.RawData; binary: boolean }> = [];
      const close = () => {
        if (upstream.readyState === WebSocket.CONNECTING) upstream.terminate();
        else upstream.close();
      };
      client.on("message", (data, binary) => {
        if (upstream.readyState === WebSocket.OPEN)
          upstream.send(data, { binary });
        else if (pending.length < 32) pending.push({ data, binary });
        else client.close(1009, "Too many pending frames");
      });
      upstream.on("open", () => {
        for (const frame of pending.splice(0))
          upstream.send(frame.data, { binary: frame.binary });
      });
      upstream.on("message", (data, binary) => {
        if (client.readyState === WebSocket.OPEN) client.send(data, { binary });
      });
      upstream.on("close", () => client.close());
      upstream.on("error", () =>
        client.close(1013, "Session service unavailable"),
      );
      client.on("close", close);
      client.on("error", close);
    });
  }
}
