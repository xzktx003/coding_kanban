import { PassThrough } from "node:stream";
import { createInterface } from "node:readline";
import { connectStdio } from "./cli-bridge.mjs";
import { isAuthorizationBoundary } from "./authorization-boundary.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const copyText = (text, limit) =>
  Buffer.from(text.slice(0, limit)).toString("utf8");
const identity = (value) =>
  typeof value === "string" && UUID.test(value) ? copyText(value, 36) : null;
const opaqueIdentity = (value) =>
  typeof value === "string" && value.length <= 256
    ? copyText(value, 256)
    : null;
const requestId = (value) =>
  typeof value === "string"
    ? opaqueIdentity(value)
    : Number.isSafeInteger(value)
      ? value
      : null;

/** One private native connection; no history cache and no automatic RPC replay. */
export function createNativeClient({
  socketPath,
  name = "kanban_refresh_manager",
  timeoutMs = 15000,
  maxPending = 64,
  onLifecycle,
  signal,
  beforeReady,
  beforeSend,
}) {
  if (typeof name !== "string" || !/^[a-z0-9_]{1,64}$/.test(name))
    throw new Error("invalid native client name");
  if (beforeSend !== undefined && typeof beforeSend !== "function")
    throw Error("synchronous native lifetime guard required");
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 60000 ||
    !Number.isSafeInteger(maxPending) ||
    maxPending < 1 ||
    maxPending > 256
  )
    throw new Error("invalid native request limits");
  const input = new PassThrough(),
    output = new PassThrough();
  const pending = new Map();
  const lines = createInterface({ input: output });
  const connection = connectStdio({
    socketPath,
    input,
    output,
    signal,
    beforeReady,
    beforeSend(message) {
      const check = (guard) => {
        const result = guard?.();
        if (result !== undefined) {
          if (typeof result?.then === "function")
            void Promise.resolve(result).catch(() => {});
          throw Error("Native send guard must finish synchronously");
        }
      };
      try {
        check(beforeSend);
      } catch {
        // A lifetime failure always closes the transport, even if a caller
        // accidentally reused the per-request veto code.
        throw Error("Native lifetime authorization unavailable");
      }
      if (message.method && message.id !== null && message.id !== undefined) {
        const waiter = pending.get(message.id);
        if (!waiter)
          throw Object.assign(
            Error("Native request no longer pending; no late send"),
            { code: "NATIVE_NOT_SENT" },
          );
        try {
          check(waiter.beforeSend);
        } catch (error) {
          pending.delete(message.id);
          clearTimeout(waiter.timer);
          const veto = Object.assign(
            Error(
              typeof error?.message === "string"
                ? copyText(error.message, 256)
                : "Native request vetoed before send",
            ),
            { code: "NATIVE_NOT_SENT" },
          );
          waiter.reject(veto);
          throw veto;
        }
      }
    },
  });
  let sequence = 0;
  let revision = 0;
  let ended = false;
  const rejectPending = () => {
    ended = true;
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(
        Object.assign(
          new Error("Native connection lost; no automatic replay"),
          { code: "NATIVE_CONNECTION_LOST" },
        ),
      );
    }
    pending.clear();
    lines.close();
    input.destroy();
    output.destroy();
  };
  connection.done.then(rejectPending, rejectPending);
  lines.on("line", (line) => {
    const message = JSON.parse(line);
    const waiter = pending.get(message.id);
    if (waiter && !message.method) {
      pending.delete(message.id);
      clearTimeout(waiter.timer);
      if (message.error)
        waiter.reject(
          Object.assign(new Error("Native request failed"), {
            code: message.error.code,
            nativeMessage:
              typeof message.error.message === "string"
                ? copyText(message.error.message, 256)
                : null,
          }),
        );
      else waiter.resolve(message.result);
      return;
    }
    if (typeof message.method !== "string") return;
    const params = message.params;
    // Only lifecycle metadata crosses into the manager. In particular, tool
    // commands, prompts, approval payloads and completed turns never enter it.
    const event = {
      method: copyText(message.method, 128),
      requestId: requestId(
        message.id ??
          (message.method === "serverRequest/resolved"
            ? params?.requestId
            : undefined),
      ),
      threadId: identity(params?.threadId ?? params?.thread?.id),
      turnId: opaqueIdentity(params?.turnId ?? params?.turn?.id),
      itemId: opaqueIdentity(params?.itemId),
      status:
        typeof params?.status?.type === "string"
          ? copyText(params.status.type, 64)
          : typeof params?.thread?.status?.type === "string"
            ? copyText(params.thread.status.type, 64)
            : null,
    };
    if (
      typeof params?.thread?.cwd === "string" &&
      params.thread.cwd.length <= 4096 &&
      !/[\x00-\x1f\x7f]/.test(params.thread.cwd)
    )
      event.cwd = copyText(params.thread.cwd, 4096);
    if (
      /^(thread\/(started|status\/changed|closed|archived|unarchived)|turn\/(started|completed)|serverRequest\/resolved)$/.test(
        message.method,
      ) ||
      /requestApproval|requestUserInput|elicitation/.test(message.method) ||
      isAuthorizationBoundary(message.method)
    )
      revision++;
    try {
      onLifecycle?.(event);
    } catch {
      connection.close();
    }
  });
  const write = (message) => {
    if (ended) throw new Error("Native connection already closed");
    const line = JSON.stringify(message) + "\n";
    if (
      Buffer.byteLength(line) > 8 * 1024 * 1024 ||
      input.writableLength + Buffer.byteLength(line) > 8 * 1024 * 1024
    )
      throw new Error("Native request pending byte limit exceeded");
    input.write(line);
  };
  const request = async (method, params, { beforeSend } = {}) => {
    await connection.ready;
    if (ended) throw new Error("Native connection already closed");
    if (
      typeof method !== "string" ||
      !/^[A-Za-z][A-Za-z0-9_/]{0,127}$/.test(method)
    )
      throw new Error("invalid native method");
    if (pending.size >= maxPending)
      throw new Error("Native pending request limit exceeded");
    if (beforeSend !== undefined && typeof beforeSend !== "function")
      throw Error("synchronous native request guard required");
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(
          Object.assign(
            new Error("Native request timed out; receipt unknown"),
            { code: "NATIVE_RECEIPT_UNKNOWN" },
          ),
        );
      }, timeoutMs);
      timer.unref();
      pending.set(id, { resolve, reject, timer, beforeSend });
      try {
        write({ id, method, params });
      } catch (error) {
        clearTimeout(timer);
        pending.delete(id);
        reject(error);
      }
    });
  };
  const ready = request("initialize", {
    clientInfo: { name, version: "0.1.0" },
    capabilities: { experimentalApi: true },
  })
    .then((result) => {
      write({ method: "initialized" });
      return result;
    })
    .catch((error) => {
      connection.close();
      throw error;
    });
  ready.catch(() => {});
  return {
    ready,
    closed: connection.done,
    get revision() {
      return revision;
    },
    async request(method, params, options) {
      await ready;
      return request(method, params, options);
    },
    reply(id, result) {
      if (requestId(id) === null)
        throw new Error("exact native request id required");
      write({ id, result });
    },
    async close() {
      connection.close();
      // Cleanup is idempotent even after a failed transport. `closed` and every
      // pending request keep their rejection; no receipt is changed or replayed.
      await connection.done.catch(() => {});
    },
  };
}
