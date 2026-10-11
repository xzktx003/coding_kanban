import { request as httpRequest } from "node:http";
import type { IncomingMessage } from "node:http";
import type { Readable } from "node:stream";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import WebSocket, { WebSocketServer, type RawData } from "ws";
import { NativeCodexGateway } from "../services/native-codex-gateway.js";

const PREFIX = "/native-codex";
export const NATIVE_CODEX_MAX_MESSAGE_BYTES = 8 * 1024 * 1024;
export const NATIVE_CODEX_MAX_UPSTREAM_MESSAGE_BYTES = 2 * 1024 * 1024;
export const NATIVE_CODEX_MAX_OUTGOING_BYTES = 2 * 1024 * 1024;
export const NATIVE_CODEX_MAX_PENDING_BYTES = 8 * 1024 * 1024;
const HIGH_WATER_BYTES = 256 * 1024;
const HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function requestPath(request: FastifyRequest): string {
  const raw = request.raw.url ?? request.url;
  // Do not resolve against a URL: a double slash must never select a different host.
  return raw.slice(PREFIX.length) || "/";
}

function publicProtocol(request: FastifyRequest): "http" | "https" {
  const forwarded = request.headers["x-forwarded-proto"];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)
    ?.split(",")[0]
    ?.trim();
  // Vite/http-proxy uses ws/wss for upgrades and http/https for HTTP.
  if (first === "https" || first === "wss") return "https";
  if (first === "http" || first === "ws") return "http";
  return request.protocol === "https" ? "https" : "http";
}

function sameOrigin(request: FastifyRequest): boolean {
  const origin = request.headers.origin;
  if (origin === undefined) return true; // Navigation and same-origin resources can omit Origin.
  if (typeof origin !== "string" || !request.headers.host) return false;
  try {
    const browser = new URL(origin);
    const publicUrl = new URL(
      `${publicProtocol(request)}://${request.headers.host}`,
    );
    return (
      browser.origin === origin &&
      browser.protocol === publicUrl.protocol &&
      browser.host === publicUrl.host
    );
  } catch {
    return false;
  }
}

function headers(
  request: FastifyRequest,
  websocket = false,
): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};
  const connectionHeaders = new Set(
    String(request.headers.connection ?? "")
      .toLowerCase()
      .split(",")
      .map((part) => part.trim()),
  );
  for (const [key, value] of Object.entries(request.headers)) {
    if (
      value === undefined ||
      HOP_HEADERS.has(key) ||
      connectionHeaders.has(key) ||
      key.startsWith("x-forwarded-") ||
      (websocket && key.startsWith("sec-websocket-"))
    )
      continue;
    result[key] = value;
  }
  // Vite preserves the browser Host. Origin/Referer must never manufacture authority.
  result.host = request.headers.host ?? request.hostname;
  result["x-forwarded-host"] = result.host;
  result["x-forwarded-proto"] = publicProtocol(request);
  result["x-forwarded-prefix"] = PREFIX;
  result["x-forwarded-for"] = request.ip;
  return result;
}

export function rewriteNativeCodexLocation(
  location: string,
  upstream: URL,
): string {
  if (location.startsWith(`${PREFIX}/`) || location === PREFIX) return location;
  if (location.startsWith("/") && !location.startsWith("//"))
    return PREFIX + location;
  try {
    const url = location.startsWith("//")
      ? new URL(location, upstream)
      : new URL(location);
    if (url.origin === upstream.origin)
      return PREFIX + url.pathname + url.search + url.hash;
  } catch {
    /* Relative locations already resolve within the mounted prefix. */
  }
  return location;
}

function cookie(value: string): string {
  // Scope upstream cookies to this host surface and discard upstream-only domains.
  let result = value.replace(/;\s*Domain=[^;]*/gi, "");
  if (/;\s*Path=/i.test(result))
    result = result.replace(
      /(;\s*Path=)([^;]*)/i,
      (_match, key: string, path: string) =>
        `${key}${path === PREFIX || path.startsWith(`${PREFIX}/`) ? path : PREFIX + (path.startsWith("/") ? path : `/${path}`)}`,
    );
  else result += `; Path=${PREFIX}/`;
  return result;
}

async function proxyHttp(
  request: FastifyRequest,
  reply: FastifyReply,
  gateway: NativeCodexGateway,
): Promise<void> {
  const runtime = await gateway.runtime();
  if (request.raw.aborted || reply.raw.destroyed) return;
  if (!runtime) {
    await reply.code(503).send({ error: "Native Codex host unavailable." });
    return;
  }
  const upstream = runtime.upstream;
  reply.hijack();
  let response: IncomingMessage | undefined;
  const outbound = httpRequest(
    {
      hostname: upstream.hostname.replace(/^\[|\]$/g, ""),
      port: upstream.port || "80",
      path: requestPath(request),
      method: request.method,
      headers: headers(request),
    },
    (incoming) => {
      response = incoming;
      reply.raw.statusCode = incoming.statusCode ?? 502;
      const connectionHeaders = new Set(
        String(incoming.headers.connection ?? "")
          .toLowerCase()
          .split(",")
          .map((part) => part.trim()),
      );
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (
          value === undefined ||
          HOP_HEADERS.has(name) ||
          connectionHeaders.has(name)
        )
          continue;
        if (name === "location" && typeof value === "string")
          reply.raw.setHeader(
            name,
            rewriteNativeCodexLocation(value, upstream),
          );
        else if (name === "set-cookie")
          reply.raw.setHeader(
            name,
            (Array.isArray(value) ? value : [value]).map(cookie),
          );
        else reply.raw.setHeader(name, value);
      }
      reply.raw.setHeader(
        "permissions-policy",
        "clipboard-read=(self), clipboard-write=(self)",
      );
      incoming.on("error", () => reply.raw.destroy());
      incoming.pipe(reply.raw);
    },
  );
  outbound.setTimeout(30_000, () =>
    outbound.destroy(new Error("upstream timeout")),
  );
  outbound.on("error", () => {
    if (reply.raw.destroyed) return;
    if (reply.raw.headersSent) {
      reply.raw.destroy();
      return;
    }
    reply.raw.statusCode = 502;
    reply.raw.setHeader("content-type", "application/json");
    reply.raw.end(JSON.stringify({ error: "Native Codex host proxy failed." }));
  });
  request.raw.once("aborted", () => outbound.destroy());
  reply.raw.once("close", () => {
    outbound.destroy();
    response?.destroy();
  });
  if (request.body && typeof (request.body as Readable).pipe === "function")
    (request.body as Readable).pipe(outbound);
  else request.raw.pipe(outbound);
}

function proxyWebSocket(
  client: WebSocket,
  request: FastifyRequest,
  gateway: NativeCodexGateway,
  active: Set<WebSocket>,
): void {
  active.add(client);
  let upstream: WebSocket | undefined;
  let finished = false;
  let sending = false;
  let pendingBytes = 0;
  const pending: Array<{ data: Buffer; binary: boolean }> = [];
  function finish(code = 1011, reason = "Native Codex host unavailable") {
    if (finished) return;
    finished = true;
    pending.length = 0;
    pendingBytes = 0;
    active.delete(client);
    if (upstream && upstream.readyState !== WebSocket.CLOSED)
      upstream.terminate();
    if (client.readyState === WebSocket.OPEN) client.close(code, reason);
  }
  function pump() {
    if (
      finished ||
      sending ||
      !upstream ||
      upstream.readyState !== WebSocket.OPEN
    )
      return;
    const message = pending.shift();
    if (!message) {
      client.resume();
      return;
    }
    sending = true;
    upstream.send(message.data, { binary: message.binary }, (error) => {
      sending = false;
      pendingBytes -= message.data.length;
      if (error) {
        finish();
        return;
      }
      if (pendingBytes < HIGH_WATER_BYTES / 4) client.resume();
      pump();
    });
  }
  client.on("message", (data: RawData, binary: boolean) => {
    if (finished) return;
    const buffer = Buffer.isBuffer(data)
      ? data
      : Array.isArray(data)
        ? Buffer.concat(data)
        : Buffer.from(data);
    if (pendingBytes + buffer.length > NATIVE_CODEX_MAX_PENDING_BYTES) {
      finish(1009, "Native Codex handshake queue exceeded");
      return;
    }
    pending.push({ data: buffer, binary });
    pendingBytes += buffer.length;
    if (
      upstream?.readyState === WebSocket.OPEN &&
      pendingBytes >= HIGH_WATER_BYTES
    )
      client.pause();
    pump();
  });
  client.once("close", () => finish(1000, "Client closed"));
  client.once("error", () => finish());
  void gateway
    .runtime()
    .then((runtime) => {
      if (finished) return;
      if (!runtime) {
        finish();
        return;
      }
      const path = requestPath(request);
      upstream = new WebSocket(`ws://${runtime.upstream.host}${path}`, [], {
        headers: headers(request, true),
        handshakeTimeout: 5000,
        maxPayload: NATIVE_CODEX_MAX_UPSTREAM_MESSAGE_BYTES,
      });
      upstream.on("open", pump);
      upstream.on("message", (data: RawData, binary: boolean) => {
        if (finished || client.readyState !== WebSocket.OPEN) return;
        const bytes = Array.isArray(data)
          ? data.reduce((sum, part) => sum + part.length, 0)
          : data.byteLength;
        if (client.bufferedAmount + bytes > NATIVE_CODEX_MAX_OUTGOING_BYTES) {
          finish(1009, "Native Codex receiver queue exceeded");
          return;
        }
        upstream!.pause();
        client.send(data, { binary }, (error) => {
          if (error) finish();
          else if (!finished) upstream!.resume();
        });
      });
      upstream.once("close", (code) =>
        finish(
          code === 1005 || code === 1006 || code === 1015 ? 1011 : code,
          "Native Codex upstream closed",
        ),
      );
      upstream.once("error", (error) => {
        if (
          (error as NodeJS.ErrnoException).code ===
          "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH"
        )
          finish(1009, "Native Codex upstream message exceeded");
        else finish();
      });
    })
    .catch(() => finish());
}

export async function registerNativeCodexRoutes(
  app: FastifyInstance,
  options: { gateway?: NativeCodexGateway },
): Promise<void> {
  const gateway = options.gateway ?? new NativeCodexGateway();
  const active = new Set<WebSocket>();
  // The shared Fastify WS plugin has no per-route receiver budget. Keep native
  // upgrades on a dedicated server, after the normal Fastify request hooks.
  const nativeWss = new WebSocketServer({
    noServer: true,
    maxPayload: NATIVE_CODEX_MAX_MESSAGE_BYTES,
    perMessageDeflate: false,
  });
  const upgradeHeads = new WeakMap<IncomingMessage, Buffer>();
  const captureUpgradeHead = (
    request: IncomingMessage,
    _socket: unknown,
    head: Buffer,
  ) => {
    const path = request.url?.split("?", 1)[0];
    if (path === PREFIX || path?.startsWith(`${PREFIX}/`))
      upgradeHeads.set(request, head);
  };
  app.server.prependListener("upgrade", captureUpgradeHead);
  app.addHook("preClose", async () => {
    for (const client of nativeWss.clients) client.terminate();
  });
  app.get("/api/native-codex/status", async (_request, reply) => {
    reply.header("cache-control", "no-store");
    return gateway.status();
  });
  app.addHook("onClose", async () => {
    for (const client of active) client.terminate();
    active.clear();
    app.server.removeListener("upgrade", captureUpgradeHead);
    await new Promise<void>((resolve) => nativeWss.close(() => resolve()));
  });
  await app.register(async (proxy) => {
    proxy.addHook("onRequest", async (request, reply) => {
      if (!sameOrigin(request)) {
        await reply
          .code(403)
          .send({ error: "Native Codex requires same-origin requests." });
        return;
      }
      if (request.ws && request.headers["sec-websocket-protocol"] !== undefined)
        await reply.code(400).send({
          error: "Native Codex WebSocket subprotocols are unsupported.",
        });
    });
    // This hook runs after the inherited websocket plugin hook, replacing only
    // native GET upgrades; ordinary HTTP still uses the inherited handler.
    proxy.addHook("onRoute", (route) => {
      if (route.method !== "GET") return;
      const ordinaryHandler = route.handler;
      route.handler = function (request, reply) {
        if (!request.ws) return ordinaryHandler.call(this, request, reply);
        reply.hijack();
        const head = upgradeHeads.get(request.raw) ?? Buffer.alloc(0);
        upgradeHeads.delete(request.raw);
        nativeWss.handleUpgrade(
          request.raw,
          request.raw.socket,
          head,
          (client) => proxyWebSocket(client, request, gateway, active),
        );
      };
    });
    // Hand the raw request stream through without collecting IDE uploads in application memory.
    proxy.removeAllContentTypeParsers();
    proxy.addContentTypeParser("*", (_request, payload, done) =>
      done(null, payload),
    );
    proxy.all(PREFIX, async (request, reply) =>
      reply.redirect(
        `${PREFIX}/${request.url.includes("?") ? request.url.slice(request.url.indexOf("?")) : ""}`,
      ),
    );
    const handler = (request: FastifyRequest, reply: FastifyReply) =>
      proxyHttp(request, reply, gateway);
    for (const url of [`${PREFIX}/`, `${PREFIX}/*`]) {
      proxy.route({
        url,
        method: "GET",
        handler,
      });
      proxy.route({
        url,
        method: ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        handler,
      });
    }
  });
}
