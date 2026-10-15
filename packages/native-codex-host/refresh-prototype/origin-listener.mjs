// Explicit isolation prototype. Reuse the owned frontend without another proxy hop.
import { createServer } from "node:https";
import { createSecureServer } from "node:http2";
import { Server } from "node:tls";
import { isIP } from "node:net";

export async function createOriginListener({
  parent,
  tls,
  host,
  port,
  maxConnections = 32,
  closeTimeoutMs = 1000,
}) {
  if (!(parent instanceof Server) || !parent.listening)
    throw new Error("A listening owned HTTPS frontend is required");
  if (!isIP(host) || !Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error("Explicit frontend bind address and port required");
  if (
    !Number.isInteger(maxConnections) ||
    maxConnections < 1 ||
    maxConnections > 1024 ||
    !Number.isInteger(closeTimeoutMs) ||
    closeTimeoutMs < 1 ||
    closeTimeoutMs > 10000
  )
    throw new Error("Bounded frontend connection limits required");
  const requests = parent.listeners("request");
  const upgrades = parent.listeners("upgrade");
  if (requests.length !== 1 || upgrades.length > 8)
    throw new Error("Unsupported frontend request/upgrade handler set");
  const sockets = new Set();
  const lifetime = new AbortController();
  const handleRequest = (request, response) => {
    Reflect.apply(requests[0], parent, [request, response]);
  };
  const server =
    typeof parent.updateSettings === "function"
      ? createSecureServer({ ...tls, allowHTTP1: true }, handleRequest)
      : createServer(tls, handleRequest);
  server.maxConnections = maxConnections;
  if (upgrades.length)
    server.on("upgrade", (request, socket, head) => {
      for (const handler of upgrades)
        Reflect.apply(handler, parent, [request, socket, head]);
    });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  let closing, rejectStartup;
  const close = () => {
    if (closing) return closing;
    parent.off("close", parentClosed);
    lifetime.abort();
    closing = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        for (const socket of sockets) socket.destroy();
      }, closeTimeoutMs);
      timer.unref();
      server.close((error) => {
        clearTimeout(timer);
        if (error && error.code !== "ERR_SERVER_NOT_RUNNING") reject(error);
        else resolve();
      });
      for (const socket of sockets) socket.end();
    });
    return closing;
  };
  const parentClosed = () => {
    rejectStartup?.(
      new Error("Parent frontend closed during listener startup"),
    );
    void close().catch(() => {});
  };
  parent.once("close", parentClosed);
  try {
    await new Promise((resolve, reject) => {
      rejectStartup = reject;
      const failed = (error) => {
        server.off("listening", ready);
        reject(error);
      };
      const ready = () => {
        server.off("error", failed);
        resolve();
      };
      server.once("error", failed);
      server.once("listening", ready);
      server.listen({ host, port, signal: lifetime.signal });
    });
    rejectStartup = undefined;
    if (closing || !parent.listening)
      throw new Error("Parent frontend closed during listener startup");
  } catch (error) {
    rejectStartup = undefined;
    await close();
    throw error;
  }
  return { port: server.address().port, close };
}
