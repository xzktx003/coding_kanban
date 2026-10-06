import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import WebSocket from "ws";

interface PreviewTarget {
  origin: string;
  expires: number;
}
interface Options {
  fetch?: typeof globalThis.fetch;
}
export function registerSessionPreviewRoutes(
  app: FastifyInstance,
  options: Options = {},
) {
  const targets = new Map<string, PreviewTarget>();
  const fetch = options.fetch ?? globalThis.fetch;
  app.post<{ Body: { url: string } }>(
    "/api/session-previews",
    async (request, reply) => {
      try {
        const url = new URL(request.body?.url);
        if (
          url.protocol !== "http:" ||
          !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
          url.username ||
          url.password ||
          Number(url.port) < 1024 ||
          Number(url.port) > 65535
        )
          throw new Error("请选择服务器上 1024–65535 端口的本地 HTTP 开发服务");
        const address = app.server.address();
        if (
          address &&
          typeof address !== "string" &&
          address.port === Number(url.port)
        )
          throw new Error("预览目标不能是工作台后端自身");
        url.hostname = "127.0.0.1";
        url.hash = "";
        for (const [id, target] of targets)
          if (target.expires < Date.now()) targets.delete(id);
        if (targets.size >= 32) targets.delete(targets.keys().next().value!);
        const id = randomUUID();
        targets.set(id, {
          origin: url.origin,
          expires: Date.now() + 24 * 60 * 60 * 1000,
        });
        return {
          path: `/api/session-previews/${id}${url.pathname}${url.search}`,
        };
      } catch (error) {
        return reply
          .code(400)
          .send({
            error:
              error instanceof Error ? error.message : "Invalid preview target",
          });
      }
    },
  );
  function targetFor(request: FastifyRequest) {
    const id = (request.params as { id: string }).id;
    const target = targets.get(id);
    if (!target || target.expires < Date.now()) return null;
    const prefix = `/api/session-previews/${id}`;
    const suffix = request.raw.url!.slice(prefix.length) || "/";
    if (
      !suffix.startsWith("/") ||
      suffix.startsWith("//") ||
      /[\\\x00-\x1f]/.test(suffix)
    )
      return null;
    target.expires = Date.now() + 24 * 60 * 60 * 1000;
    return { target, prefix, suffix };
  }
  async function handler(request: FastifyRequest, reply: FastifyReply) {
    const found = targetFor(request);
    if (!found)
      return reply
        .code(404)
        .send({ error: "预览已失效，请重新输入开发服务地址" });
    const { target, prefix, suffix } = found;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    reply.raw.once("close", () => {
      if (!reply.raw.writableFinished) controller.abort();
    });
    try {
      const headers: Record<string, string> = {};
      if (request.headers["content-type"])
        headers["content-type"] = request.headers["content-type"];
      const response = await fetch(target.origin + suffix, {
        method: request.method,
        headers,
        signal: controller.signal,
        redirect: "manual",
        body: ["GET", "HEAD"].includes(request.method)
          ? undefined
          : typeof request.body === "string"
            ? request.body
            : JSON.stringify(request.body ?? {}),
      });
      reply.code(response.status).header("cache-control", "no-store");
      const location = response.headers.get("location");
      if (location) {
        const next = new URL(location, target.origin + suffix);
        if (next.origin !== target.origin)
          return reply.code(502).send({ error: "预览服务重定向到了其他主机" });
        reply.header("location", prefix + next.pathname + next.search);
      }
      const type =
        response.headers.get("content-type") ?? "application/octet-stream";
      reply.type(type);
      if (/text\/html|javascript|text\/css/.test(type)) {
        let body = await response.text();
        if (body.length > 8 * 1024 * 1024)
          return reply.code(413).send({ error: "预览文本资源超过大小限制" });
        body = body
          .replace(
            /(["'`])\/(?!\/)([^"'`\s]*)/g,
            (_match, quote, path) => `${quote}${prefix}/${path}`,
          )
          .replace(/url\(\/(?!\/)/g, `url(${prefix}/`);
        if (/\/\@vite\/client(?:\?|$)/.test(suffix)) {
          body = body
            .replace(
              /const socketHost = [^;]+;/,
              `const socketHost = window.location.host + ${JSON.stringify(prefix + "/")};`,
            )
            .replace(
              /const directSocketHost = [^;]+;/,
              "const directSocketHost = socketHost;",
            );
        }
        if (/text\/html/.test(type))
          body = body.replace(
            /<head([^>]*)>/i,
            `<head$1><base href="${prefix}/">`,
          );
        return reply.send(body);
      }
      return reply.send(
        response.body
          ? Readable.fromWeb(
              response.body as Parameters<typeof Readable.fromWeb>[0],
            )
          : undefined,
      );
    } catch {
      return reply
        .code(502)
        .type("text/html")
        .send("<p>无法连接项目开发服务。请启动服务后刷新预览。</p>");
    } finally {
      clearTimeout(timeout);
    }
  }
  app.route({
    method: "GET",
    url: "/api/session-previews/:id/*",
    handler,
    ...(app.hasDecorator("websocketServer")
      ? {
          wsHandler: (client: WebSocket, request: FastifyRequest) => {
            const found = targetFor(request);
            if (!found) {
              client.close(1008, "Unknown preview");
              return;
            }
            const protocol = request.headers["sec-websocket-protocol"];
            const upstream = new WebSocket(
              found.target.origin.replace(/^http/, "ws") + found.suffix,
              protocol?.split(",").map((value) => value.trim()),
            );
            const pending: Array<{ data: WebSocket.RawData; binary: boolean }> =
              [];
            client.on("message", (data, binary) => {
              if (upstream.readyState === WebSocket.OPEN)
                upstream.send(data, { binary });
              else if (pending.length < 32) pending.push({ data, binary });
              else client.close(1009);
            });
            upstream.on("open", () => {
              for (const frame of pending.splice(0))
                upstream.send(frame.data, { binary: frame.binary });
            });
            upstream.on("message", (data, binary) => {
              if (client.readyState === WebSocket.OPEN)
                client.send(data, { binary });
            });
            upstream.on("error", () => client.close(1013));
            upstream.on("close", () => client.close());
            client.on("close", () => {
              if (upstream.readyState === WebSocket.CONNECTING)
                upstream.terminate();
              else upstream.close();
            });
          },
        }
      : {}),
  });
  app.route({
    method: ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    url: "/api/session-previews/:id/*",
    handler,
  });
}
