import { request as httpRequest } from "node:http";

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { VsCodeWebProxyDiagnosticsResponse } from "@agent-orchestrator/shared";

import { resolveVsCodeWebRequestTarget } from "./vscode-web-request-target.js";

const VSCODE_WEB_PROXY_PREFIX = "/vscode";
const DIAGNOSTIC_RATE_WINDOW_MS = 5_000;
const MAX_PENDING_WEBSOCKET_BYTES = 1024 * 1024;
const VSCODE_CLIPBOARD_PERMISSIONS_POLICY =
  "clipboard-read=(self), clipboard-write=(self)";

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

interface VsCodeWebProxyManagerLike {
  getProxyTargetUrl(): string | null;
}

interface ProxyTrafficSample {
  timestamp: number;
  bytes: number;
}

const httpRequestSamples: ProxyTrafficSample[] = [];
const httpUploadSamples: ProxyTrafficSample[] = [];
const httpDownloadSamples: ProxyTrafficSample[] = [];
const webSocketUploadSamples: ProxyTrafficSample[] = [];
const webSocketDownloadSamples: ProxyTrafficSample[] = [];

let activeHttpRequests = 0;
let totalHttpRequests = 0;
let totalHttpUploadBytes = 0;
let totalHttpDownloadBytes = 0;
let lastHttpStatusCode: number | null = null;
let activeWebSocketConnections = 0;
let totalWebSocketUploadMessages = 0;
let totalWebSocketDownloadMessages = 0;
let totalWebSocketUploadBytes = 0;
let totalWebSocketDownloadBytes = 0;

function trimProxySamples(
  samples: ProxyTrafficSample[],
  now = Date.now(),
): void {
  while (
    samples.length > 0 &&
    now - samples[0]!.timestamp > DIAGNOSTIC_RATE_WINDOW_MS
  ) {
    samples.shift();
  }
}

function recordProxySample(
  samples: ProxyTrafficSample[],
  bytes: number,
  now = Date.now(),
): void {
  samples.push({ timestamp: now, bytes });
  trimProxySamples(samples, now);
}

function calculateProxyRate(
  samples: ProxyTrafficSample[],
  now = Date.now(),
): { eventsPerSecond: number; kilobytesPerSecond: number } {
  trimProxySamples(samples, now);
  const totalBytes = samples.reduce((sum, sample) => sum + sample.bytes, 0);

  return {
    eventsPerSecond: samples.length / (DIAGNOSTIC_RATE_WINDOW_MS / 1000),
    kilobytesPerSecond: totalBytes / 1024 / (DIAGNOSTIC_RATE_WINDOW_MS / 1000),
  };
}

function toKilobytes(bytes: number): number {
  return bytes / 1024;
}

function beginVsCodeProxyHttpRequest(): (statusCode: number | null) => void {
  let finished = false;
  activeHttpRequests += 1;
  totalHttpRequests += 1;
  recordProxySample(httpRequestSamples, 0);

  return (statusCode: number | null) => {
    if (finished) {
      return;
    }

    finished = true;
    activeHttpRequests = Math.max(0, activeHttpRequests - 1);
    lastHttpStatusCode = statusCode;
  };
}

function recordVsCodeProxyHttpUpload(bytes: number): void {
  if (bytes <= 0) {
    return;
  }

  totalHttpUploadBytes += bytes;
  recordProxySample(httpUploadSamples, bytes);
}

function recordVsCodeProxyHttpDownload(bytes: number): void {
  if (bytes <= 0) {
    return;
  }

  totalHttpDownloadBytes += bytes;
  recordProxySample(httpDownloadSamples, bytes);
}

function beginVsCodeProxyWebSocket(): () => void {
  let closed = false;
  activeWebSocketConnections += 1;

  return () => {
    if (closed) {
      return;
    }

    closed = true;
    activeWebSocketConnections = Math.max(0, activeWebSocketConnections - 1);
  };
}

function recordVsCodeProxyWebSocketUpload(bytes: number): void {
  totalWebSocketUploadMessages += 1;
  totalWebSocketUploadBytes += bytes;
  recordProxySample(webSocketUploadSamples, bytes);
}

function recordVsCodeProxyWebSocketDownload(bytes: number): void {
  totalWebSocketDownloadMessages += 1;
  totalWebSocketDownloadBytes += bytes;
  recordProxySample(webSocketDownloadSamples, bytes);
}

function proxyDataByteLength(data: unknown): number {
  if (typeof data === "string") {
    return Buffer.byteLength(data);
  }

  if (data instanceof ArrayBuffer) {
    return data.byteLength;
  }

  if (ArrayBuffer.isView(data)) {
    return data.byteLength;
  }

  if (data instanceof Blob) {
    return data.size;
  }

  return 0;
}

export function getVsCodeWebProxyDiagnosticsSnapshot(
  now = Date.now(),
): VsCodeWebProxyDiagnosticsResponse {
  const httpRequestRate = calculateProxyRate(httpRequestSamples, now);
  const httpUploadRate = calculateProxyRate(httpUploadSamples, now);
  const httpDownloadRate = calculateProxyRate(httpDownloadSamples, now);
  const webSocketUploadRate = calculateProxyRate(webSocketUploadSamples, now);
  const webSocketDownloadRate = calculateProxyRate(
    webSocketDownloadSamples,
    now,
  );

  return {
    timestamp: new Date(now).toISOString(),
    http: {
      activeRequests: activeHttpRequests,
      downloadKilobytesPerSecond: httpDownloadRate.kilobytesPerSecond,
      lastStatusCode: lastHttpStatusCode,
      requestsPerSecond: httpRequestRate.eventsPerSecond,
      totalDownloadKilobytes: toKilobytes(totalHttpDownloadBytes),
      totalRequests: totalHttpRequests,
      totalUploadKilobytes: toKilobytes(totalHttpUploadBytes),
      uploadKilobytesPerSecond: httpUploadRate.kilobytesPerSecond,
    },
    websocket: {
      activeConnections: activeWebSocketConnections,
      downloadKilobytesPerSecond: webSocketDownloadRate.kilobytesPerSecond,
      messagesPerSecond:
        webSocketUploadRate.eventsPerSecond +
        webSocketDownloadRate.eventsPerSecond,
      totalDownloadKilobytes: toKilobytes(totalWebSocketDownloadBytes),
      totalDownloadMessages: totalWebSocketDownloadMessages,
      totalUploadKilobytes: toKilobytes(totalWebSocketUploadBytes),
      totalUploadMessages: totalWebSocketUploadMessages,
      uploadKilobytesPerSecond: webSocketUploadRate.kilobytesPerSecond,
    },
  };
}

export function resetVsCodeWebProxyDiagnosticsForTest(): void {
  httpRequestSamples.length = 0;
  httpUploadSamples.length = 0;
  httpDownloadSamples.length = 0;
  webSocketUploadSamples.length = 0;
  webSocketDownloadSamples.length = 0;
  activeHttpRequests = 0;
  totalHttpRequests = 0;
  totalHttpUploadBytes = 0;
  totalHttpDownloadBytes = 0;
  lastHttpStatusCode = null;
  activeWebSocketConnections = 0;
  totalWebSocketUploadMessages = 0;
  totalWebSocketDownloadMessages = 0;
  totalWebSocketUploadBytes = 0;
  totalWebSocketDownloadBytes = 0;
}

function firstHeaderValue(
  value: string | string[] | undefined,
): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

function withVsCodeClipboardPermissions(
  value: string | string[] | undefined,
): string {
  const existingDirectives = (
    Array.isArray(value) ? value.join(",") : (value ?? "")
  )
    .split(",")
    .map((directive) => directive.trim())
    .filter(
      (directive) =>
        directive.length > 0 &&
        !/^clipboard-(?:read|write)\s*=/i.test(directive),
    );

  return [...existingDirectives, VSCODE_CLIPBOARD_PERMISSIONS_POLICY].join(
    ", ",
  );
}

function appendForwardedFor(
  existing: string | string[] | undefined,
  remoteAddress?: string,
): string | undefined {
  const nextAddress = remoteAddress?.trim();
  const current = Array.isArray(existing) ? existing.join(", ") : existing;
  if (!current) {
    return nextAddress;
  }

  if (!nextAddress) {
    return current;
  }

  return `${current}, ${nextAddress}`;
}

function rewriteProxyPath(input: string): string {
  const url = new URL(input, "http://vscode-web-proxy.local");
  if (url.pathname === VSCODE_WEB_PROXY_PREFIX) {
    url.pathname = "/";
  } else if (url.pathname.startsWith(`${VSCODE_WEB_PROXY_PREFIX}/`)) {
    url.pathname = url.pathname.slice(VSCODE_WEB_PROXY_PREFIX.length);
  }

  return `${url.pathname}${url.search}`;
}

function resolveProxyTarget(
  vsCodeWebManager: VsCodeWebProxyManagerLike,
): URL | null {
  const targetUrl = vsCodeWebManager.getProxyTargetUrl();
  if (!targetUrl) {
    return null;
  }

  const parsed = new URL(targetUrl);
  return parsed.protocol === "http:" ? parsed : null;
}

function serializeProxyBody(body: unknown): Buffer | null {
  if (body === undefined || body === null) {
    return null;
  }

  if (Buffer.isBuffer(body)) {
    return body;
  }

  if (body instanceof Uint8Array) {
    return Buffer.from(body);
  }

  if (typeof body === "string") {
    return Buffer.from(body);
  }

  return Buffer.from(JSON.stringify(body));
}

function buildProxyRequestHeaders(
  request: FastifyRequest,
  overrideContentLength?: number,
): Record<string, string | string[]> {
  const headers: Record<string, string | string[]> = {};
  const { requestHost, requestProtocol } =
    resolveVsCodeWebRequestTarget(request);

  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined || HOP_BY_HOP_HEADERS.has(name.toLowerCase())) {
      continue;
    }

    headers[name] = value;
  }

  if (requestHost) {
    headers.host = requestHost;
    headers["x-forwarded-host"] = requestHost;
  } else if (request.headers.host) {
    headers.host = request.headers.host;
    headers["x-forwarded-host"] = request.headers.host;
  }

  headers["x-forwarded-proto"] = requestProtocol;

  const forwardedFor = appendForwardedFor(
    request.headers["x-forwarded-for"],
    request.ip,
  );
  if (forwardedFor) {
    headers["x-forwarded-for"] = forwardedFor;
  }

  if (overrideContentLength !== undefined) {
    headers["content-length"] = String(overrideContentLength);
  }

  return headers;
}

function writeProxyError(
  response: NodeJS.WritableStream & {
    end: (chunk?: string | Buffer) => void;
    headersSent?: boolean;
    setHeader?: (name: string, value: string) => void;
    statusCode?: number;
  },
  statusCode: number,
  message: string,
): void {
  if (response.headersSent) {
    response.end();
    return;
  }

  response.statusCode = statusCode;
  response.setHeader?.("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify({ error: message }));
}

async function forwardUpstreamMessage(
  clientSocket: {
    send: (data: string | Buffer, options?: { binary?: boolean }) => void;
  },
  data: unknown,
): Promise<void> {
  if (typeof data === "string") {
    clientSocket.send(data);
    return;
  }

  if (data instanceof ArrayBuffer) {
    clientSocket.send(Buffer.from(data), { binary: true });
    return;
  }

  if (ArrayBuffer.isView(data)) {
    clientSocket.send(
      Buffer.from(data.buffer, data.byteOffset, data.byteLength),
      {
        binary: true,
      },
    );
    return;
  }

  if (data instanceof Blob) {
    clientSocket.send(Buffer.from(await data.arrayBuffer()), { binary: true });
  }
}

async function proxyHttpRequest(
  request: FastifyRequest,
  reply: FastifyReply,
  vsCodeWebManager: VsCodeWebProxyManagerLike,
): Promise<void> {
  const targetBaseUrl = resolveProxyTarget(vsCodeWebManager);
  if (!targetBaseUrl) {
    reply.code(503);
    await reply.send({ error: "VS Code Web 当前未启动，无法代理请求。" });
    return;
  }

  const targetUrl = new URL(
    rewriteProxyPath(request.raw.url ?? request.url),
    `${targetBaseUrl.origin}/`,
  );
  const serializedBody = serializeProxyBody(request.body);
  const finishDiagnostics = beginVsCodeProxyHttpRequest();
  reply.hijack();
  const proxyRequest = httpRequest(
    targetUrl,
    {
      headers: buildProxyRequestHeaders(request, serializedBody?.byteLength),
      method: request.method,
    },
    (proxyResponse) => {
      const statusCode = proxyResponse.statusCode ?? 502;
      reply.raw.statusCode = statusCode;

      for (const [name, value] of Object.entries(proxyResponse.headers)) {
        if (value === undefined || HOP_BY_HOP_HEADERS.has(name.toLowerCase())) {
          continue;
        }

        reply.raw.setHeader(name, value);
      }
      reply.raw.setHeader(
        "permissions-policy",
        withVsCodeClipboardPermissions(
          proxyResponse.headers["permissions-policy"],
        ),
      );

      proxyResponse.on("data", (chunk: Buffer) => {
        recordVsCodeProxyHttpDownload(chunk.byteLength);
      });
      proxyResponse.on("end", () => {
        finishDiagnostics(statusCode);
      });
      proxyResponse.on("close", () => {
        finishDiagnostics(statusCode);
      });
      proxyResponse.pipe(reply.raw);
    },
  );

  proxyRequest.on("error", (error) => {
    finishDiagnostics(502);
    writeProxyError(reply.raw, 502, `VS Code Web 代理失败: ${error.message}`);
  });

  if (serializedBody) {
    recordVsCodeProxyHttpUpload(serializedBody.byteLength);
    proxyRequest.end(serializedBody);
    return;
  }

  request.raw.on("data", (chunk: Buffer) => {
    recordVsCodeProxyHttpUpload(chunk.byteLength);
  });
  request.raw.pipe(proxyRequest);
}

function proxyWebSocketConnection(
  clientSocket: {
    close: (code?: number, data?: Buffer) => void;
    on: (event: string, listener: (...args: any[]) => void) => void;
    send: (data: string | Buffer, options?: { binary?: boolean }) => void;
  },
  request: FastifyRequest,
  vsCodeWebManager: VsCodeWebProxyManagerLike,
): void {
  const targetBaseUrl = resolveProxyTarget(vsCodeWebManager);
  if (!targetBaseUrl) {
    clientSocket.close(1011, Buffer.from("VS Code Web unavailable"));
    return;
  }

  const finishDiagnostics = beginVsCodeProxyWebSocket();
  const upstream = new WebSocket(
    `ws://${targetBaseUrl.host}${rewriteProxyPath(
      request.raw.url ?? request.url,
    )}`,
  );
  const pendingMessages: Array<{ data: Buffer; isBinary: boolean }> = [];
  let pendingBytes = 0;
  let clientClosed = false;
  upstream.binaryType = "arraybuffer";

  clientSocket.on("message", (data: Buffer, isBinary: boolean) => {
    if (upstream.readyState === WebSocket.OPEN) {
      recordVsCodeProxyWebSocketUpload(data.byteLength);
      upstream.send(isBinary ? data : data.toString("utf8"));
      return;
    }

    if (upstream.readyState !== WebSocket.CONNECTING) {
      return;
    }

    if (pendingBytes + data.byteLength > MAX_PENDING_WEBSOCKET_BYTES) {
      pendingMessages.length = 0;
      pendingBytes = 0;
      clientSocket.close(
        1009,
        Buffer.from("VS Code Web upstream handshake queue exceeded"),
      );
      upstream.close();
      return;
    }

    // code-server sends its handshake as soon as the browser-side socket opens.
    // Preserve it until the proxy's independent upstream handshake completes.
    pendingMessages.push({ data: Buffer.from(data), isBinary });
    pendingBytes += data.byteLength;
  });

  clientSocket.on("close", () => {
    clientClosed = true;
    pendingMessages.length = 0;
    pendingBytes = 0;
    finishDiagnostics();
    if (
      upstream.readyState === WebSocket.OPEN ||
      upstream.readyState === WebSocket.CONNECTING
    ) {
      upstream.close();
    }
  });

  clientSocket.on("error", () => {
    clientClosed = true;
    pendingMessages.length = 0;
    pendingBytes = 0;
    finishDiagnostics();
    if (
      upstream.readyState === WebSocket.OPEN ||
      upstream.readyState === WebSocket.CONNECTING
    ) {
      upstream.close();
    }
  });

  upstream.addEventListener("open", () => {
    if (clientClosed) {
      upstream.close();
      return;
    }

    for (const message of pendingMessages) {
      recordVsCodeProxyWebSocketUpload(message.data.byteLength);
      upstream.send(
        message.isBinary ? message.data : message.data.toString("utf8"),
      );
    }
    pendingMessages.length = 0;
    pendingBytes = 0;
  });
  upstream.addEventListener("message", (event) => {
    recordVsCodeProxyWebSocketDownload(proxyDataByteLength(event.data));
    void forwardUpstreamMessage(clientSocket, event.data);
  });
  upstream.addEventListener("close", () => {
    pendingMessages.length = 0;
    pendingBytes = 0;
    finishDiagnostics();
    clientSocket.close();
  });
  upstream.addEventListener("error", () => {
    pendingMessages.length = 0;
    pendingBytes = 0;
    finishDiagnostics();
    clientSocket.close(1011, Buffer.from("VS Code Web upstream failed"));
  });
}

export async function registerVsCodeWebProxyRoutes(
  fastify: FastifyInstance,
  options: { vsCodeWebManager: VsCodeWebProxyManagerLike },
): Promise<void> {
  const { vsCodeWebManager } = options;
  const proxyHandler = async (request: FastifyRequest, reply: FastifyReply) =>
    proxyHttpRequest(request, reply, vsCodeWebManager);

  fastify.get("/api/diagnostics/vscode-web-proxy", async () =>
    getVsCodeWebProxyDiagnosticsSnapshot(),
  );
  fastify.route({
    handler: proxyHandler,
    method: ["DELETE", "GET", "OPTIONS", "PATCH", "POST", "PUT"],
    url: `${VSCODE_WEB_PROXY_PREFIX}`,
  });
  fastify.route({
    handler: proxyHandler,
    method: ["DELETE", "GET", "OPTIONS", "PATCH", "POST", "PUT"],
    url: `${VSCODE_WEB_PROXY_PREFIX}/`,
  });
  fastify.route({
    handler: proxyHandler,
    method: "GET",
    url: `${VSCODE_WEB_PROXY_PREFIX}/*`,
    wsHandler: (socket, request) => {
      proxyWebSocketConnection(socket as never, request, vsCodeWebManager);
    },
  });
  fastify.route({
    handler: proxyHandler,
    method: ["DELETE", "OPTIONS", "PATCH", "POST", "PUT"],
    url: `${VSCODE_WEB_PROXY_PREFIX}/*`,
  });
}
