import { createServer, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

function ownProcessIdentity() {
  // Runtime factory/cleanup only: never import-time work or scans of other processes.
  if (process.platform !== "linux") throw Error("Feedback SSE fixture requires Linux process identity metadata");
  const stat = readFileSync("/proc/self/stat", "utf8");
  const left = stat.indexOf("("), right = stat.lastIndexOf(")");
  const pid = Number(stat.slice(0, left).trim());
  const fields = stat.slice(right + 1).trim().split(/\s+/);
  const startTicks = fields[19];
  if (left < 1 || right <= left || pid !== process.pid || !/^[1-9]\d*$/.test(startTicks ?? ""))
    throw Error("Feedback SSE own process identity is unavailable");
  return Object.freeze({ pid, startTicks });
}

export async function createFeedbackEventStream(frontendOrigin: string) {
  const frontend = new URL(frontendOrigin);
  if (frontend.origin !== frontendOrigin || frontend.username || frontend.password || !["http:", "https:"].includes(frontend.protocol))
    throw Error("Feedback SSE requires an exact HTTP(S) frontend origin");
  const processIdentity = ownProcessIdentity();
  const serverId = randomUUID(), startedAt = new Date().toISOString();
  const startedMonotonicMs = performance.now();
  const sockets = new Set<Socket>();
  const clients = new Map<ServerResponse, number>();
  const requests: Array<{ ordinal: number; method: string; accepted: boolean; result: string; atMs: number }> = [];
  const connections: Array<{ id: number; openedAtMs: number; closedAtMs: number | null; finishedAtMs: number | null; ownerEndedAtMs: number | null; writeErrors: number }> = [];
  let accepting = true, port = 0, closed = false, requestOverflow = false;
  let serverErrorCount = 0, heartbeatWrites = 0;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let closeWork: Promise<ReturnType<typeof snapshot> & { errors: string[] }> | undefined;
  const server = createServer((request, response) => {
    // Intentionally do not retain/log any URL query, auth/cookie/header value or request object.
    const path = (request.url ?? "").split("?", 1)[0];
    const method = request.method === "GET" ? "GET" : "non-GET";
    const allowedOrigin = request.headers.origin === undefined || request.headers.origin === frontendOrigin;
    let result = !accepting ? "closing" : method !== "GET" ? "method-denied" : path !== "/events" ? "path-denied" : !allowedOrigin ? "origin-denied" : clients.size >= 8 ? "connection-limit" : "accepted";
    if (requests.length >= 64) { requestOverflow = true; result = "request-limit"; }
    else requests.push({ ordinal: requests.length + 1, method, accepted: result === "accepted", result, atMs: performance.now() - startedMonotonicMs });
    if (result !== "accepted") {
      response.writeHead(result === "method-denied" ? 405 : result === "origin-denied" ? 403 : result === "path-denied" ? 404 : 503, { "Content-Type": "text/plain", "Connection": "close" });
      response.end("Fixture SSE request refused"); return;
    }
    const record = { id: connections.length + 1, openedAtMs: performance.now() - startedMonotonicMs, closedAtMs: null as number | null, finishedAtMs: null as number | null, ownerEndedAtMs: null as number | null, writeErrors: 0 };
    connections.push(record); clients.set(response, record.id);
    response.once("close", () => { record.closedAtMs = performance.now() - startedMonotonicMs; clients.delete(response); });
    response.once("finish", () => { record.finishedAtMs = performance.now() - startedMonotonicMs; });
    response.on("error", () => { record.writeErrors++; clients.delete(response); });
    response.writeHead(200, {
      "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform",
      "Access-Control-Allow-Origin": frontendOrigin, "Vary": "Origin",
      "Connection": "keep-alive", "X-Content-Type-Options": "nosniff",
    });
    response.flushHeaders(); response.write(": feedback fixture connected\n\n");
  });
  server.on("connection", (socket) => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); if (!accepting) socket.destroy(); });
  server.on("error", () => { serverErrorCount++; });
  function snapshot() {
    return {
      serverId, processIdentity, startedAt, frontendOrigin,
      bindHost: "127.0.0.1", port, url: port ? `http://127.0.0.1:${port}/events` : null,
      accepting, closed, listening: server.listening, addressCleared: server.address() === null,
      activeResponses: clients.size, activeSockets: sockets.size,
      requests: requests.map((r) => ({ ...r })), requestOverflow,
      connections: connections.map((r) => ({ ...r })),
      acceptedRequests: requests.filter((r) => r.accepted).length,
      responseFinishCount: connections.filter((r) => r.finishedAtMs !== null).length,
      responseCloseCount: connections.filter((r) => r.closedAtMs !== null).length,
      ownerEofCount: connections.filter((r) => r.ownerEndedAtMs !== null).length,
      serverErrorCount, heartbeatWrites,
    };
  }
  async function close() {
    if (closeWork) return closeWork;
    closeWork = (async () => {
      accepting = false; clearInterval(heartbeat);
      const errors: string[] = [];
      for (const [response, id] of clients) {
        const record = connections[id - 1]; record.ownerEndedAtMs = performance.now() - startedMonotonicMs;
        try { response.end(); } catch { record.writeErrors++; response.destroy(); }
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      const closedListener = new Promise<void>((resolve) => {
        timer = setTimeout(() => { errors.push("Owned SSE listener close deadline exceeded"); resolve(); }, 1000);
        timer.unref();
        server.close((error?: Error) => { clearTimeout(timer); if (error && (error as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING") errors.push("Owned SSE close failed"); resolve(); });
        server.closeIdleConnections();
        // Only sockets emitted by this exact owned server are ended/destroyed.
        for (const socket of sockets) socket.destroy();
      });
      await closedListener;
      const until = performance.now() + 100;
      while ((sockets.size || clients.size) && performance.now() < until)
        await new Promise<void>((resolve) => setTimeout(resolve, 5));
      if (server.listening || server.address() !== null || sockets.size || clients.size)
        errors.push("Owned SSE cleanup has unconfirmed listener or connection closure");
      try {
        const current = ownProcessIdentity();
        if (current.pid !== processIdentity.pid || current.startTicks !== processIdentity.startTicks) errors.push("Own process identity changed");
      } catch { errors.push("Own process identity could not be rechecked"); }
      closed = errors.length === 0;
      return { ...snapshot(), errors };
    })();
    return closeWork;
  }
  try {
    await new Promise<void>((resolve, reject) => {
      const fail = (error: Error) => { server.off("listening", ready); reject(error); };
      const ready = () => { server.off("error", fail); resolve(); };
      server.once("error", fail); server.once("listening", ready);
      server.listen(0, "127.0.0.1");
    });
    const address = server.address();
    if (!address || typeof address === "string" || address.address !== "127.0.0.1" || address.port <= 0)
      throw Error("Owned SSE listener identity unavailable");
    port = address.port;
    heartbeat = setInterval(() => {
      for (const [response, id] of clients) {
        if (response.destroyed || response.writableEnded) continue;
        try { response.write(": heartbeat\n\n"); heartbeatWrites++; }
        catch { connections[id - 1].writeErrors++; response.destroy(); }
      }
    }, 250);
    heartbeat.unref();
    return { url: `http://127.0.0.1:${port}/events`, snapshot, close };
  } catch (error) {
    await close(); throw error;
  }
}
