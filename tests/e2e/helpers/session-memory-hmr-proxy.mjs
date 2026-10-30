import { createRequire } from "node:module";

const require = createRequire(
  new URL("../../../packages/session-runtime/package.json", import.meta.url),
);
const WebSocket = require("ws");
const { WebSocketServer } = WebSocket;
const frameTypes = [
  "connected",
  "ping",
  "pong",
  "update",
  "custom",
  "error",
  "other",
];

function reject(socket, status = 403, message = "Forbidden") {
  if (!socket.destroyed)
    socket.end(
      `HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
    );
}
function classify(data) {
  if (data.length > 512) return "other";
  try {
    const type = JSON.parse(data.toString())?.type;
    return frameTypes.includes(type) ? type : "other";
  } catch {
    return "other";
  }
}
function counts() {
  return Object.fromEntries(frameTypes.map((type) => [type, 0]));
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function attachSessionMemoryHmrProxy({
  server,
  sourceOrigin,
  proxyOrigin,
  verifySource,
  rejectUnauthorized = false,
  maxConnections = 2,
  maxFrameBytes = 1024 * 1024,
  maxBufferedBytes = 2 * 1024 * 1024,
  handshakeTimeoutMs = 5000,
  closeTimeoutMs = 300,
}) {
  const source = new URL(sourceOrigin),
    proxy = new URL(proxyOrigin);
  if (
    !["http:", "https:"].includes(source.protocol) ||
    source.username ||
    source.password ||
    source.pathname !== "/" ||
    source.search ||
    source.hash
  )
    throw new Error("HMR source must be a fixed HTTP(S) origin");
  if (
    proxy.protocol !== "http:" ||
    proxy.username ||
    proxy.password ||
    proxy.pathname !== "/" ||
    proxy.search ||
    proxy.hash
  )
    throw new Error("HMR proxy must be a fixed HTTP origin");
  if (typeof verifySource !== "function")
    throw new Error("Owned source identity verifier required");
  const upstreamOrigin = `${source.protocol === "https:" ? "wss:" : "ws:"}//${source.host}`;
  const downstream = new WebSocketServer({
    noServer: true,
    maxPayload: maxFrameBytes,
    perMessageDeflate: false,
    handleProtocols: (protocols) =>
      protocols.has("vite-hmr") ? "vite-hmr" : false,
  });
  const bridges = new Set(),
    upstreamSockets = new Set(),
    rawSockets = new Set();
  const stats = {
    attempts: 0,
    connected: 0,
    closed: 0,
    rejected: 0,
    closeCodes: { client: {}, upstream: {} },
    frames: counts(),
    fromSource: counts(),
    fromClient: counts(),
  };
  let disposed = false;

  const onUpgrade = (req, socket, head) => {
    stats.attempts++;
    const rawTarget = typeof req.url === "string" ? req.url : "";
    let target;
    try {
      target = new URL(rawTarget, "http://proxy.invalid");
    } catch {
      stats.rejected++;
      return reject(socket, 400, "Bad Request");
    }
    const protocols = String(req.headers["sec-websocket-protocol"] || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    const params = [...target.searchParams.entries()];
    const token = params[0]?.[1];
    const validTarget =
      rawTarget.startsWith("/") &&
      !rawTarget.startsWith("//") &&
      !rawTarget.includes("#") &&
      rawTarget.length <= 2048 &&
      target.origin === "http://proxy.invalid" &&
      target.pathname === "/";
    const validQuery =
      params.length === 1 &&
      params[0][0] === "token" &&
      token.length > 0 &&
      token.length <= 1024;
    if (
      disposed ||
      !validTarget ||
      !validQuery ||
      protocols.length !== 1 ||
      protocols[0] !== "vite-hmr" ||
      req.headers.host !== proxy.host ||
      req.headers.origin !== proxyOrigin ||
      bridges.size >= maxConnections
    ) {
      stats.rejected++;
      return reject(socket, bridges.size >= maxConnections ? 503 : 403);
    }

    const controller = new AbortController();
    const queued = [];
    const bridge = {
      upstream: null,
      downstream: null,
      raw: socket,
      timer: null,
      controller,
      counted: false,
      settled: false,
      queuedBytes: 0,
      cleanup: null,
    };
    bridges.add(bridge);
    rawSockets.add(socket);
    let upstream, peer;
    const cleanup = (code = 1011, reason = "bridge closed") => {
      if (bridge.settled) return;
      bridge.settled = true;
      clearTimeout(bridge.timer);
      controller.abort();
      bridges.delete(bridge);
      queued.length = 0;
      bridge.queuedBytes = 0;
      if (upstream) {
        if (upstream.readyState === WebSocket.OPEN)
          upstream.close(code, reason.slice(0, 100));
        else upstream.terminate();
      }
      if (peer) {
        if (peer.readyState === WebSocket.OPEN)
          peer.close(code, reason.slice(0, 100));
        else peer.terminate();
      } else if (!socket.destroyed) socket.destroy();
      if (bridge.counted) stats.closed++;
    };
    bridge.cleanup = cleanup;
    bridge.timer = setTimeout(
      () => cleanup(1008, "handshake timeout"),
      handshakeTimeoutMs,
    );
    socket.once("close", () => {
      rawSockets.delete(socket);
      cleanup(1001, "client cancelled");
    });
    socket.once("error", () => cleanup(1001, "client socket error"));

    const verify = async () => {
      let abortListener;
      const aborted = new Promise((_, rejectAbort) => {
        abortListener = () =>
          rejectAbort(new Error("source verification aborted"));
        controller.signal.addEventListener("abort", abortListener, {
          once: true,
        });
      });
      let result;
      try {
        result = await Promise.race([
          Promise.resolve().then(() => verifySource(controller.signal)),
          aborted,
        ]);
      } finally {
        controller.signal.removeEventListener("abort", abortListener);
      }
      if (controller.signal.aborted || bridge.settled)
        throw new Error("source verification cancelled");
      if (result === false) throw new Error("source identity rejected");
    };
    (async () => {
      try {
        await verify();
        upstream = new WebSocket(
          `${upstreamOrigin}/${target.search}`,
          "vite-hmr",
          {
            rejectUnauthorized,
            perMessageDeflate: false,
            maxPayload: maxFrameBytes,
            handshakeTimeout: handshakeTimeoutMs,
            maxBufferedAmount: maxBufferedBytes,
          },
        );
        bridge.upstream = upstream;
        upstreamSockets.add(upstream);
        upstream.on("close", (code) => {
          upstreamSockets.delete(upstream);
          stats.closeCodes.upstream[String(code)] =
            (stats.closeCodes.upstream[String(code)] || 0) + 1;
          cleanup(1011, "upstream closed");
        });
        upstream.on("message", (data, isBinary) => {
          const bytes = Buffer.isBuffer(data)
            ? data.length
            : Buffer.byteLength(String(data));
          const type = classify(
            Buffer.isBuffer(data) ? data : Buffer.from(String(data)),
          );
          stats.frames[type]++;
          stats.fromSource[type]++;
          if (!peer) {
            if (bridge.queuedBytes + bytes > maxBufferedBytes)
              return cleanup(1009, "buffer budget exceeded");
            queued.push([data, isBinary]);
            bridge.queuedBytes += bytes;
            return;
          }
          if (
            peer.readyState !== WebSocket.OPEN ||
            peer.bufferedAmount + bytes > maxBufferedBytes
          )
            return cleanup(1009, "buffer budget exceeded");
          peer.send(data, { binary: isBinary }, (error) => {
            if (error) cleanup();
          });
        });
        upstream.on("error", () => cleanup(1011, "upstream error"));
        await new Promise((resolve, rejectHandshake) => {
          upstream.once("open", resolve);
          upstream.once("error", rejectHandshake);
        });
        await verify();
        if (disposed || bridge.settled || socket.destroyed)
          return cleanup(1001, "client cancelled");
        clearTimeout(bridge.timer);
        downstream.handleUpgrade(req, socket, head, (ws) => {
          peer = ws;
          bridge.downstream = ws;
          bridge.counted = true;
          stats.connected++;
          ws.on("message", (data, isBinary) => {
            const bytes = Buffer.isBuffer(data)
              ? data.length
              : Buffer.byteLength(String(data));
            const type = classify(
              Buffer.isBuffer(data) ? data : Buffer.from(String(data)),
            );
            stats.frames[type]++;
            stats.fromClient[type]++;
            if (
              upstream.readyState !== WebSocket.OPEN ||
              upstream.bufferedAmount + bytes > maxBufferedBytes
            )
              return cleanup(1009, "buffer budget exceeded");
            upstream.send(data, { binary: isBinary }, (error) => {
              if (error) cleanup();
            });
          });
          ws.on("error", () => cleanup());
          ws.on("close", (code) => {
            stats.closeCodes.client[String(code)] =
              (stats.closeCodes.client[String(code)] || 0) + 1;
            cleanup(1000, "client closed");
          });
          for (const [data, binary] of queued.splice(0))
            ws.send(data, { binary });
          bridge.queuedBytes = 0;
        });
      } catch {
        stats.rejected++;
        cleanup(1011, "source identity or handshake failed");
        reject(socket, 502, "Bad Gateway");
      }
    })();
  };
  server.on("upgrade", onUpgrade);
  return {
    snapshot() {
      return {
        ...stats,
        closeCodes: {
          client: { ...stats.closeCodes.client },
          upstream: { ...stats.closeCodes.upstream },
        },
        frames: { ...stats.frames },
        fromSource: { ...stats.fromSource },
        fromClient: { ...stats.fromClient },
        active: bridges.size,
        upstreamActive: upstreamSockets.size,
        rawActive: rawSockets.size,
      };
    },
    async close() {
      disposed = true;
      server.off("upgrade", onUpgrade);
      for (const bridge of [...bridges]) bridge.cleanup(1001, "proxy closed");
      const deadline = Date.now() + closeTimeoutMs;
      while (
        (bridges.size ||
          upstreamSockets.size ||
          rawSockets.size ||
          downstream.clients.size) &&
        Date.now() < deadline
      )
        await sleep(10);
      for (const bridge of [...bridges])
        bridge.cleanup(1001, "proxy close timeout");
      for (const socket of rawSockets) socket.destroy();
      for (const ws of upstreamSockets) ws.terminate();
      for (const ws of downstream.clients) ws.terminate();
      const forcedDeadline = Date.now() + closeTimeoutMs;
      while (
        (upstreamSockets.size || rawSockets.size || downstream.clients.size) &&
        Date.now() < forcedDeadline
      )
        await sleep(10);
      await Promise.race([
        new Promise((resolve) => downstream.close(() => resolve())),
        sleep(closeTimeoutMs),
      ]);
    },
  };
}
