// Private metadata RPC only. No user input, native RPC forwarding or retry/replay.
import { randomUUID } from "node:crypto";
export const CONTROL_BYTES = 8192;
export const exact = (value, keys) =>
  value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.keys(value).sort().join(",") === keys;
export const uuid = (value) =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
const failure = () =>
  Object.assign(Error("private refresh control unavailable"), {
    code: "CONTROL_UNAVAILABLE",
  });
const methodValid = (value) =>
  typeof value === "string" && /^[a-z][a-zA-Z]{0,31}$/.test(value);
const errorCode = (code) =>
  ["VISIBILITY_LEASE_UNAVAILABLE", "REFRESH_RESOURCES_UNAVAILABLE"].includes(
    code,
  )
    ? code
    : "CONTROL_UNAVAILABLE";
export function createControlPeer(
  socket,
  { handler, notice = () => {}, onClose = () => {}, timeoutMs = 5000 } = {},
) {
  if (
    typeof handler !== "function" ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 30000
  )
    throw Error("bounded private control peer required");
  const pending = new Map(),
    running = new Set(),
    seen = new Set();
  let ended = false,
    partial = Buffer.alloc(0),
    resolveClosed;
  const closed = new Promise((r) => (resolveClosed = r));
  const finish = () => {
    if (ended) return;
    ended = true;
    partial = Buffer.alloc(0);
    for (const item of pending.values()) {
      clearTimeout(item.timer);
      item.reject(failure());
    }
    pending.clear();
    try {
      onClose();
    } catch {
      /* Owner cleanup cannot reopen a transport. */
    }
    resolveClosed();
  };
  const close = () => {
    finish();
    socket.destroy();
  };
  const send = (value) => {
    if (ended) throw failure();
    const body = Buffer.from(JSON.stringify(value) + "\n");
    if (
      body.length > CONTROL_BYTES ||
      socket.writableLength + body.length > CONTROL_BYTES
    ) {
      close();
      throw failure();
    }
    socket.write(body, (error) => {
      if (error) close();
    });
  };
  const accept = (bytes) => {
    let value;
    try {
      value = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      );
      if (value?.type === "reply") {
        if (
          !uuid(value.id) ||
          typeof value.ok !== "boolean" ||
          !exact(value, value.ok ? "id,ok,result,type" : "code,id,ok,type")
        )
          throw failure();
        const item = pending.get(value.id);
        if (!item) throw failure();
        pending.delete(value.id);
        clearTimeout(item.timer);
        if (value.ok) item.resolve(value.result);
        else
          item.reject(
            Object.assign(failure(), {
              code: errorCode(value.code),
              operation: item.method,
            }),
          );
        return;
      }
      if (value?.type === "notice") {
        if (!exact(value, "args,method,type") || !methodValid(value.method))
          throw failure();
        notice(value.method, value.args);
        return;
      }
      if (
        !exact(value, "args,id,method,type") ||
        value.type !== "call" ||
        !uuid(value.id) ||
        !methodValid(value.method) ||
        running.size >= 64 ||
        seen.has(value.id)
      )
        throw failure();
      running.add(value.id);
      seen.add(value.id);
      if (seen.size > 256) seen.delete(seen.values().next().value);
      void Promise.resolve()
        .then(() => handler(value.method, value.args))
        .then(
          (result) => {
            if (!ended)
              send({
                type: "reply",
                id: value.id,
                ok: true,
                result: result ?? null,
              });
          },
          (error) => {
            if (!ended)
              send({
                type: "reply",
                id: value.id,
                ok: false,
                code: errorCode(error?.code),
              });
          },
        )
        .catch(close)
        .finally(() => running.delete(value.id));
    } catch {
      close();
    }
  };
  socket.on("data", (bytes) => {
    if (ended) return;
    let offset = 0;
    while (offset < bytes.length && !ended) {
      const end = bytes.indexOf(10, offset),
        boundary = end < 0 ? bytes.length : end;
      if (partial.length + boundary - offset + 1 > CONTROL_BYTES) {
        close();
        return;
      }
      const piece = bytes.subarray(offset, boundary);
      partial = partial.length
        ? Buffer.concat([partial, piece])
        : Buffer.from(piece);
      if (end < 0) return;
      const complete = partial;
      partial = Buffer.alloc(0);
      offset = end + 1;
      accept(complete);
    }
  });
  socket.on("error", close);
  socket.once("end", close);
  socket.once("close", finish);
  return {
    get open() {
      return !ended;
    },
    closed,
    close,
    request(method, args) {
      if (ended || !methodValid(method) || pending.size >= 64)
        return Promise.reject(failure());
      return new Promise((resolve, reject) => {
        const id = randomUUID(),
          timer = setTimeout(close, timeoutMs);
        timer.unref();
        pending.set(id, { resolve, reject, timer, method });
        try {
          send({ type: "call", id, method, args });
        } catch {
          close();
        }
      });
    },
    notify(method, args) {
      if (!methodValid(method)) throw failure();
      send({ type: "notice", method, args });
    },
  };
}
