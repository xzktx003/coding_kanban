import { lstatSync } from "node:fs";
import {
  link,
  lstat,
  mkdtemp,
  readFile,
  realpath,
  rmdir,
} from "node:fs/promises";
import { fork } from "node:child_process";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseJsonLines, readBoundedChunks } from "./json-lines.mjs";
import { decodeWireValue, encodeWireValue } from "./wire-value.mjs";

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const TICKS = /^(?:0|[1-9][0-9]{0,29})$/;
const MAX_FRAME = 8 * 1024 * 1024;
const MAX_TOTAL = 32 * 1024 * 1024;
const MAX_CLIENTS = 16;
const MAX_PENDING = 64;
const MAX_PORTS = 16;
const MAX_VIEW_IDS = 8192;
const MAX_CHUNK = 64 * 1024;
const CLIENT_TYPES = new Set(["call", "openPort", "portPost", "closePort"]);
const HOST_TYPES = new Set([
  "return",
  "throw",
  "portMessage",
  "portClosed",
  "viewMessage",
  "theme",
  "workerMessage",
  "gitPort",
]);
const CALLS = new Set([
  "sendMessageFromView",
  "startLinkDrag",
  "acknowledgeChunkedMessage",
  "connectGitWorker",
  "sendWorkerMessageFromView",
  "showContextMenu",
  "getFastModeRolloutMetrics",
  "workerSubscribe",
  "workerUnsubscribe",
]);
const failure = (code, message = "Desktop control unavailable") =>
  Object.assign(new Error(message), { code });
const exact = (value, names) =>
  value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.keys(value).length === names.length &&
  names.every((name) => Object.hasOwn(value, name));
const integer = (n) => Number.isSafeInteger(n) && n > 0;
const validPort = (value) =>
  typeof value === "string" &&
  /^(?:app-host|git)-[1-9][0-9]{0,15}$/.test(value);
const sameScope = (a, b) =>
  exact(a, ["profileId", "generation", "viewId"]) &&
  a.profileId === b.profileId &&
  a.generation === b.generation &&
  a.viewId === b.viewId;
const pathOK = (value) =>
  typeof value === "string" &&
  value.length > 1 &&
  value.length <= 4096 &&
  isAbsolute(value) &&
  resolve(value) === value &&
  !/[\x00-\x1f\x7f]/.test(value);
const sameNode = (a, b) =>
  a.dev === b.dev && a.ino === b.ino && a.mode === b.mode && a.uid === b.uid;
function limit(value, cap) {
  if (!Number.isSafeInteger(value) || value < 1 || value > cap)
    throw failure("CONTROL_INVALID_CONFIG");
  return value;
}
async function withTimeout(promise, ms) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(failure("CONTROL_OUTCOME_UNKNOWN")),
          ms,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function privateDirectory(path, uid) {
  const info = await lstat(path, { bigint: true });
  if (
    (await realpath(path)) !== path ||
    !info.isDirectory() ||
    info.uid !== BigInt(uid) ||
    (info.mode & 0o7777n) !== 0o700n
  )
    throw failure("CONTROL_UNSAFE_DIRECTORY");
  return info;
}
async function processIdentity(pid, uid) {
  const [info, stat] = await Promise.all([
    lstat(`/proc/${pid}`, { bigint: true }),
    readFile(`/proc/${pid}/stat`, "utf8"),
  ]);
  const close = stat.lastIndexOf(")");
  const fields = stat.slice(close + 2).split(" ");
  if (info.uid !== BigInt(uid) || close < 0 || !TICKS.test(fields[19] ?? ""))
    throw failure("CONTROL_UNAVAILABLE");
  return fields[19];
}
function waitForHelper(child, expected, message) {
  let cleanup = () => {};
  const promise = new Promise((resolveMessage, rejectMessage) => {
    const done = (error, value) => {
      cleanup();
      if (error) rejectMessage(error);
      else resolveMessage(value);
    };
    const onMessage = (encoded, handle) => {
      try {
        const frame = decodeWireValue(encoded, {
          maxEncodedBytes: 8192,
          maxDecodedBytes: 8192,
          maxNodes: 64,
        });
        if (
          exact(frame, ["v", "type", "code"]) &&
          frame.v === 1 &&
          frame.type === "error"
        ) {
          if (handle?.close) handle.close();
          return done(
            failure(
              frame.code === "CONTROL_SOCKET_REPLACED"
                ? frame.code
                : "CONTROL_UNAVAILABLE",
            ),
          );
        }
        if (
          !exact(frame, ["v", "type"]) ||
          frame.v !== 1 ||
          frame.type !== expected
        ) {
          if (handle?.close) handle.close();
          return done(failure("CONTROL_UNAVAILABLE"));
        }
        if (
          (expected === "bound" &&
            (!handle?.listening || typeof handle.close !== "function")) ||
          (expected !== "bound" && handle)
        ) {
          if (handle?.close) handle.close();
          return done(failure("CONTROL_UNAVAILABLE"));
        }
        done(null, handle);
      } catch {
        if (handle?.close) handle.close();
        done(failure("CONTROL_UNAVAILABLE"));
      }
    };
    const onExit = () => done(failure("CONTROL_UNAVAILABLE"));
    cleanup = () => {
      child.off("message", onMessage);
      child.off("exit", onExit);
      child.off("error", onExit);
    };
    child.on("message", onMessage);
    child.once("exit", onExit);
    child.once("error", onExit);
    if (!child.connected) return done(failure("CONTROL_UNAVAILABLE"));
    try {
      child.send(encodeWireValue(message), (error) => {
        if (error) done(failure("CONTROL_UNAVAILABLE"));
      });
    } catch {
      done(failure("CONTROL_UNAVAILABLE"));
    }
  });
  return { promise, cleanup: () => cleanup() };
}
function privateDirectorySync(path, expected, uid) {
  const info = lstatSync(path, { bigint: true });
  return (
    info.isDirectory() &&
    info.uid === BigInt(uid) &&
    (info.mode & 0o7777n) === 0o700n &&
    sameNode(info, expected)
  );
}

/**
 * A private, single-generation broker for a previously authorized native child.
 * Native and client messages are versioned wire strings. This service does not
 * launch, signal, restart or connect to native processes; upstream is injected.
 * The 8 MiB/32 MiB budgets count encoded JSONL payload bytes held in queues.
 *
 * A dedicated short-lived helper binds a hidden socket and transfers its listener
 * over Node IPC. The parent publishes a hard link, then the helper removes its
 * own bind name and exits normally. The transferred listener has no unlink path.
 * The public name remains for the owner to remove with its old generation.
 */
export async function createDesktopControlService(options = {}) {
  const {
    socketPath,
    profileId,
    generation,
    pid,
    startTicks,
    upstream,
    verifyIdentity,
    getProjectPersistenceStatus,
  } = options;
  const maxClients = limit(options.maxClients ?? MAX_CLIENTS, MAX_CLIENTS);
  const maxFrameBytes = limit(options.maxFrameBytes ?? MAX_FRAME, MAX_FRAME);
  const maxClientBytes = limit(options.maxClientBytes ?? MAX_FRAME, MAX_FRAME);
  const maxTotalBytes = limit(options.maxTotalBytes ?? MAX_TOTAL, MAX_TOTAL);
  const timeoutMs = limit(options.writeTimeoutMs ?? 10000, 30000);
  const handshakeTimeoutMs = limit(options.handshakeTimeoutMs ?? 10000, 30000);
  const handoffTimeoutMs = limit(options.handoffTimeoutMs ?? 10000, 30000);
  const signal = options.signal;
  const deadline = Date.now() + handoffTimeoutMs;
  async function startupWait(promise) {
    if (signal?.aborted) throw failure("CONTROL_START_ABORTED");
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw failure("CONTROL_START_TIMEOUT");
    let timer, onAbort;
    try {
      return await Promise.race([
        promise,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(failure("CONTROL_START_TIMEOUT")),
            remaining,
          );
          onAbort = () => reject(failure("CONTROL_START_ABORTED"));
          signal?.addEventListener("abort", onAbort, { once: true });
        }),
      ]);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  }
  const uid = process.getuid?.();
  if (
    !pathOK(socketPath) ||
    !UUID.test(profileId ?? "") ||
    !UUID.test(generation ?? "") ||
    !Number.isSafeInteger(pid) ||
    pid <= 1 ||
    typeof startTicks !== "string" ||
    !TICKS.test(startTicks) ||
    uid === undefined ||
    typeof verifyIdentity !== "function" ||
    (getProjectPersistenceStatus !== undefined && typeof getProjectPersistenceStatus !== "function") ||
    (signal !== undefined && !(signal instanceof AbortSignal)) ||
    typeof upstream?.send !== "function" ||
    typeof upstream?.subscribe !== "function" ||
    maxFrameBytes > maxClientBytes
  )
    throw failure("CONTROL_INVALID_CONFIG");
  const parent = dirname(socketPath);
  let parentInfo;
  try {
    parentInfo = await privateDirectory(parent, uid);
    try {
      await lstat(socketPath);
      throw failure("CONTROL_SOCKET_EXISTS");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    if (Buffer.byteLength(join(parent, ".desktop-control-XXXXXX", "s")) > 107)
      throw failure("CONTROL_INVALID_CONFIG");
    if ((await startupWait(Promise.resolve().then(verifyIdentity))) !== true)
      throw failure("CONTROL_IDENTITY_CHANGED");
  } catch (error) {
    if (typeof error?.code === "string" && error.code.startsWith("CONTROL_"))
      throw error;
    throw failure("CONTROL_UNAVAILABLE");
  }

  let retired = false,
    upstreamBroken = false,
    published = false,
    closePromise,
    totalBytes = 0;
  let unsubscribe = () => {},
    subscribed = false,
    upstreamChain = Promise.resolve();
  const clients = new Set(),
    owners = new Map(),
    usedIds = new Set(),
    budgetWaiters = new Set(),
    cleanupJobs = new Set(),
    destroyReceipts = new Map(),
    activeWrites = new Set();
  let cleanupUnconfirmed = false;
  let server, bindDir, bindingPath, bindDirInfo, bindingInfo;
  let helper,
    helperExit,
    helperTicks,
    helperExited = false,
    expectingHandle = false;

  async function stopHelper() {
    if (!helper || helperExited) return;
    if (helper.connected) {
      try {
        helper.send(encodeWireValue({ v: 1, type: "cancel" }), () => {});
      } catch {}
    }
    try {
      await withTimeout(helperExit, Math.min(timeoutMs, 2000));
      return;
    } catch {}
    try {
      if (
        helperTicks &&
        !helperExited &&
        helper.exitCode === null &&
        helper.signalCode === null &&
        (await processIdentity(helper.pid, uid)) === helperTicks &&
        !helperExited
      )
        helper.kill("SIGTERM");
    } catch {}
    try {
      await withTimeout(helperExit, 2000);
    } catch {
      try {
        helper.disconnect();
      } catch {}
      helper.unref();
    }
  }

  function release(state, bytes) {
    if (!bytes) return;
    state.held -= bytes;
    totalBytes -= bytes;
    for (const wake of budgetWaiters) wake();
  }
  function reserve(state, bytes) {
    if (
      !Number.isSafeInteger(bytes) ||
      bytes < 0 ||
      state.held + bytes > maxClientBytes ||
      totalBytes + bytes > maxTotalBytes
    )
      return false;
    state.held += bytes;
    totalBytes += bytes;
    return true;
  }
  function clearSubscription() {
    if (!subscribed) return;
    subscribed = false;
    try {
      unsubscribe();
    } catch {}
  }
  function revoke() {
    upstreamBroken = true;
    for (const write of activeWrites) write.cancel("identity");
    for (const wake of budgetWaiters) wake();
    for (const receipt of destroyReceipts.values())
      receipt.reject(failure("CONTROL_OUTCOME_UNKNOWN"));
    destroyReceipts.clear();
    void shutdown(false).catch(() => {});
  }
  async function checkIdentity(allowRetired = false) {
    if (upstreamBroken || (retired && !allowRetired))
      throw failure("CONTROL_IDENTITY_CHANGED");
    let valid = false;
    try {
      valid =
        (await withTimeout(
          Promise.resolve().then(verifyIdentity),
          timeoutMs,
        )) === true;
    } catch {}
    if (!valid) {
      revoke();
      throw failure("CONTROL_IDENTITY_CHANGED");
    }
    if (upstreamBroken || (retired && !allowRetired))
      throw failure("CONTROL_IDENTITY_CHANGED");
  }
  async function reserveCleanup(bytes) {
    const end = Date.now() + timeoutMs;
    while (totalBytes + bytes > maxTotalBytes) {
      if (upstreamBroken || Date.now() >= end)
        throw failure("CONTROL_QUEUE_FULL");
      let wake;
      try {
        await withTimeout(
          new Promise((resolveWake) => {
            wake = () => {
              budgetWaiters.delete(wake);
              resolveWake();
            };
            budgetWaiters.add(wake);
          }),
          Math.max(1, end - Date.now()),
        );
      } finally {
        budgetWaiters.delete(wake);
      }
    }
    totalBytes += bytes;
  }
  function enqueueUpstream(encoded, state, cleanup = false, onDispatch) {
    const task = upstreamChain.then(async () => {
      if (upstreamBroken || (!cleanup && (retired || state.closed)))
        throw failure("CONTROL_CLOSED");
      const size = Buffer.byteLength(encoded, "utf8");
      if (cleanup) await reserveCleanup(size);
      const controller = new AbortController();
      let dispatched = false,
        rejectCancelled,
        timer;
      const cancelled = new Promise((_, reject) => {
        rejectCancelled = reject;
      });
      const write = {
        state,
        cleanup,
        cancel(reason) {
          if (!controller.signal.aborted) controller.abort();
          // After dispatch, disconnect is not evidence that the write failed:
          // retain the existing bounded wait so its owned view can be closed.
          if (reason !== "client" || !dispatched)
            rejectCancelled(failure("CONTROL_CLOSED"));
        },
      };
      activeWrites.add(write);
      try {
        await Promise.race([checkIdentity(cleanup), cancelled]);
        if (!cleanup && state.closed) throw failure("CONTROL_CLOSED");
        const deadline = performance.now() + timeoutMs;
        timer = setTimeout(() => write.cancel("timeout"), timeoutMs);
        timer.unref?.();
        const markDispatched = () => {
          if (
            dispatched ||
            controller.signal.aborted ||
            performance.now() >= deadline
          )
            throw failure("CONTROL_CLOSED");
          onDispatch?.();
          dispatched = true;
        };
        try {
          await Promise.race([
            Promise.resolve().then(() => {
              if (controller.signal.aborted || performance.now() >= deadline)
                throw failure("CONTROL_CLOSED");
              if (upstream.explicitDispatch !== true) markDispatched();
              return upstream.send(encoded, {
                signal: controller.signal,
                deadline,
                onDispatch: markDispatched,
              });
            }),
            cancelled,
          ]);
          if (!dispatched) throw failure("CONTROL_OUTCOME_UNKNOWN");
        } catch {
          if (
            upstream.explicitDispatch === true &&
            !dispatched &&
            controller.signal.aborted
          )
            throw failure("CONTROL_CLOSED");
          revoke();
          throw failure("CONTROL_OUTCOME_UNKNOWN");
        }
      } finally {
        clearTimeout(timer);
        activeWrites.delete(write);
        if (cleanup) {
          totalBytes -= size;
          for (const wake of budgetWaiters) wake();
        }
      }
    });
    upstreamChain = task.catch(() => {});
    return task;
  }
  function enqueueBrowserFrame(state, encoded, frame, pending) {
    if (
      upstream.explicitDispatch !== true ||
      typeof upstream.sendBatch !== "function"
    )
      return enqueueUpstream(encoded, state, false, () => {
        pending.dispatched = true;
        state.dispatchedSeq = frame.seq;
      });
    const task = new Promise((resolve, reject) => {
      state.inputQueue.push({ encoded, frame, pending, resolve, reject });
    });
    if (!state.inputRunning) {
      state.inputRunning = true;
      // Capture only the current burst. A batch never grows after verification.
      setImmediate(() => void flushBrowserInput(state));
    }
    return task;
  }
  async function dispatchBrowserBatch(state, batch) {
    if (upstreamBroken || retired || state.closed)
      throw failure("CONTROL_CLOSED");
    let rejectCancelled,
      sendStarted = false;
    const cancelled = new Promise((_, reject) => {
      rejectCancelled = reject;
    });
    const entries = batch.map((item) => {
      const controller = new AbortController();
      const entry = {
        ...item,
        controller,
        dispatched: false,
        timer: undefined,
        deadline: 0,
        state,
        cleanup: false,
        cancel(reason) {
          if (!controller.signal.aborted) controller.abort();
          if (reason !== "client" || !entry.dispatched)
            rejectCancelled(failure("CONTROL_CLOSED"));
        },
      };
      activeWrites.add(entry);
      return entry;
    });
    try {
      await Promise.race([checkIdentity(), cancelled]);
      if (
        state.closed ||
        retired ||
        upstreamBroken ||
        owners.get(state.viewId) !== state
      )
        throw failure("CONTROL_CLOSED");
      for (const entry of entries) {
        entry.deadline = performance.now() + timeoutMs;
        entry.timer = setTimeout(() => entry.cancel("timeout"), timeoutMs);
        entry.timer.unref?.();
      }
      const controls = entries.map((entry) =>
        Object.freeze({
          encoded: entry.encoded,
          signal: entry.controller.signal,
          deadline: entry.deadline,
          onDispatch() {
            if (
              entry.dispatched ||
              entry.controller.signal.aborted ||
              performance.now() >= entry.deadline ||
              state.closed ||
              retired ||
              upstreamBroken ||
              owners.get(state.viewId) !== state ||
              state.phase !== "ready" ||
              !sameScope(entry.frame.scope, state.scope) ||
              entry.frame.seq !== state.dispatchedSeq + 1 ||
              state.pending.get(entry.frame.id) !== entry.pending
            )
              throw failure("CONTROL_CLOSED");
            entry.pending.dispatched = true;
            state.dispatchedSeq = entry.frame.seq;
            entry.dispatched = true;
          },
        }),
      );
      sendStarted = true;
      await Promise.race([
        upstream.sendBatch(Object.freeze(controls)),
        cancelled,
      ]);
      if (entries.some((entry) => !entry.dispatched))
        throw failure("CONTROL_OUTCOME_UNKNOWN");
    } catch (cause) {
      const anyDispatched = entries.some((entry) => entry.dispatched);
      if (
        sendStarted &&
        (anyDispatched ||
          !entries.some((entry) => entry.controller.signal.aborted))
      ) {
        revoke();
        throw failure("CONTROL_OUTCOME_UNKNOWN");
      }
      throw cause;
    } finally {
      for (const entry of entries) {
        clearTimeout(entry.timer);
        activeWrites.delete(entry);
      }
    }
  }
  async function flushBrowserInput(state) {
    try {
      while (state.inputQueue.length) {
        const batch = state.inputQueue.splice(0, 8);
        const task = upstreamChain.then(() =>
          dispatchBrowserBatch(state, batch),
        );
        upstreamChain = task.catch(() => {});
        try {
          await task;
          for (const entry of batch) entry.resolve();
        } catch (error) {
          for (const entry of batch) entry.reject(error);
        }
      }
    } finally {
      state.inputRunning = false;
    }
  }
  function closeClient(state, cleanup = true, publicError) {
    if (state.closed) return null;
    state.closed = true;
    for (const write of activeWrites)
      if (write.state === state && !write.cleanup) write.cancel("client");
    clearTimeout(state.handshakeTimer);
    clients.delete(state);
    if (state.viewId && owners.get(state.viewId) === state)
      owners.delete(state.viewId);
    state.pending.clear();
    state.ports.clear();
    if (state.outputScheduled) { clearImmediate(state.outputScheduled); state.outputScheduled = undefined; }
    for (const entry of [...state.outputOwned]) settleClientOutput(state, entry, failure("CONTROL_CLOSED"));
    state.outputQueue.length = 0;
    if (publicError && state.socket.writable && !state.socket.destroyed) {
      const encoded = encodeWireValue({
        v: 1,
        type: "error",
        code: publicError,
      });
      const bytes = Buffer.byteLength(encoded, "utf8");
      if (bytes <= maxFrameBytes && reserve(state, bytes)) {
        let done = false,
          timer;
        const finish = () => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          release(state, bytes);
          state.socket.destroy();
        };
        state.socket.once("close", finish);
        state.socket.end(encoded + "\n", finish);
        timer = setTimeout(finish, 1000);
        timer.unref?.();
      } else state.socket.destroy();
    } else state.socket.destroy();
    if (
      cleanup &&
      state.viewId &&
      state.createDispatched &&
      !state.viewClosed &&
      !upstreamBroken
    ) {
      const encoded = encodeWireValue({
        v: 1,
        type: "destroyView",
        viewId: state.viewId,
      });
      let resolveReceipt, rejectReceipt;
      const promise = new Promise((resolveAck, rejectAck) => {
        resolveReceipt = resolveAck;
        rejectReceipt = rejectAck;
      });
      void promise.catch(() => {});
      const receipt = {
        scope: state.scope,
        dispatched: false,
        resolve: resolveReceipt,
        reject: rejectReceipt,
      };
      destroyReceipts.set(state.viewId, receipt);
      const job = (async () => {
        try {
          await enqueueUpstream(encoded, state, true, () => {
            receipt.dispatched = true;
          });
          await withTimeout(promise, timeoutMs);
          await checkIdentity(true);
        } finally {
          if (destroyReceipts.get(state.viewId) === receipt)
            destroyReceipts.delete(state.viewId);
        }
      })();
      cleanupJobs.add(job);
      void job.then(
        () => cleanupJobs.delete(job),
        () => {
          cleanupJobs.delete(job);
          cleanupUnconfirmed = true;
          if (!upstreamBroken) revoke();
        },
      );
      return job;
    }
    if (state.viewId && state.createDispatched && !state.viewClosed)
      cleanupUnconfirmed = true;
    return null;
  }
  function settleClientOutput(state, entry, cause) {
    if (!state.outputOwned.delete(entry)) return;
    state.outputActive.delete(entry);
    clearTimeout(entry.timer);
    state.outputCount--;
    release(state, entry.bytes);
    entry.encoded = undefined;
    if (cause) entry.reject(cause); else entry.resolve();
    scheduleClientOutput(state);
  }
  function scheduleClientOutput(state) {
    if (state.closed || state.outputRunning || state.outputScheduled ||
        !state.outputQueue.length || state.outputActive.size >= 8) return;
    state.outputScheduled = setImmediate(() => {
      state.outputScheduled = undefined;
      void flushClientOutput(state);
    });
  }
  async function flushClientOutput(state) {
    if (state.closed || state.outputRunning || !state.outputQueue.length || state.outputActive.size >= 8) return;
    state.outputRunning = true;
    // Fix membership before verification. Existing in-flight and verifying
    // writes share the original eight-slot window; later arrivals receive a
    // separate, fresh identity check before their own ordered socket writes.
    const batch = state.outputQueue.splice(0, 8 - state.outputActive.size), socket = state.socket;
    for (const entry of batch) state.outputActive.add(entry);
    try {
      let onClose;
      try {
        const closed = new Promise((_, reject) => {
          onClose = () => reject(failure("CONTROL_CLOSED"));
          socket.once("close", onClose);
        });
        await Promise.race([checkIdentity(), closed]);
      } finally {
        if (onClose) socket.removeListener("close", onClose);
      }
      if (state.closed || retired || upstreamBroken || state.socket !== socket || socket.destroyed || !socket.writable)
        throw failure("CONTROL_CLOSED");
      for (const entry of batch) {
        if (state.closed || !state.outputOwned.has(entry) || state.socket !== socket || socket.destroyed || !socket.writable)
          throw failure("CONTROL_CLOSED");
        entry.timer = setTimeout(() => {
          settleClientOutput(state, entry, failure("CONTROL_OUTCOME_UNKNOWN"));
          closeClient(state);
        }, timeoutMs);
        entry.timer.unref?.();
        socket.write(entry.encoded + "\n", "utf8", (cause) => {
          if (cause) {
            settleClientOutput(state, entry, failure("CONTROL_OUTCOME_UNKNOWN"));
            closeClient(state);
          } else settleClientOutput(state, entry);
        });
      }
    } catch (cause) {
      closeClient(state);
      for (const entry of batch) settleClientOutput(state, entry, cause);
    } finally {
      state.outputRunning = false;
      scheduleClientOutput(state);
    }
  }
  function clientWrite(state, encoded) {
    const bytes = Buffer.byteLength(encoded, "utf8");
    if (state.closed || state.outputCount >= MAX_PENDING || bytes > maxFrameBytes || !reserve(state, bytes)) {
      closeClient(state, true, "CONTROL_QUEUE_FULL");
      return Promise.reject(failure("CONTROL_QUEUE_FULL"));
    }
    state.outputCount++;
    const operation = new Promise((resolve, reject) => {
      const entry = { encoded, bytes, resolve, reject, timer: undefined };
      state.outputOwned.add(entry);
      state.outputQueue.push(entry);
    });
    scheduleClientOutput(state);
    return operation;
  }
  async function* boundedInput(state) {
    try {
      for await (const chunk of readBoundedChunks(state.socket, MAX_CHUNK)) {
        if (
          !(chunk instanceof Uint8Array) ||
          chunk.byteLength > MAX_CHUNK ||
          chunk.includes(13)
        )
          throw failure("CONTROL_PROTOCOL_ERROR");
        let size = chunk.byteLength;
        for (const byte of chunk) if (byte === 10) size--;
        if (!reserve(state, size)) throw failure("CONTROL_QUEUE_FULL");
        state.inputHeld += size;
        yield chunk;
      }
    } finally {
      release(state, state.inputHeld);
      state.inputHeld = 0;
    }
  }
  function validClientFrame(frame, state) {
    if (
      !frame ||
      frame.v !== 1 ||
      !CLIENT_TYPES.has(frame.type) ||
      !sameScope(frame.scope, state.scope) ||
      !integer(frame.seq) ||
      frame.seq !== state.inSeq + 1 ||
      !integer(frame.id) ||
      frame.id <= state.lastId ||
      state.pending.has(frame.id) ||
      state.pending.size >= MAX_PENDING
    )
      return false;
    if (frame.type === "call")
      return (
        exact(frame, ["v", "type", "scope", "seq", "id", "method", "args"]) &&
        CALLS.has(frame.method) &&
        Array.isArray(frame.args) &&
        frame.args.length <= 8
      );
    if (frame.type === "openPort")
      return (
        exact(frame, ["v", "type", "scope", "seq", "id", "portId", "name"]) &&
        frame.name === "app-host" &&
        /^app-host-[1-9][0-9]{0,15}$/.test(frame.portId ?? "") &&
        !state.ports.has(frame.portId) &&
        state.ports.size < MAX_PORTS
      );
    if (frame.type === "portPost")
      return (
        exact(frame, ["v", "type", "scope", "seq", "id", "portId", "data"]) &&
        validPort(frame.portId) &&
        state.ports.get(frame.portId) === "open"
      );
    return (
      exact(frame, ["v", "type", "scope", "seq", "id", "portId"]) &&
      validPort(frame.portId) &&
      state.ports.get(frame.portId) === "open"
    );
  }
  async function receiveClient(state, encoded) {
    let frame;
    try {
      frame = decodeWireValue(encoded);
    } catch {
      throw failure("CONTROL_PROTOCOL_ERROR");
    }
    if (state.phase === "new") {
      if (
        !exact(frame, ["v", "type", "profileId", "generation"]) ||
        frame.v !== 1 ||
        frame.type !== "hello" ||
        frame.profileId !== profileId ||
        frame.generation !== generation
      )
        throw failure("CONTROL_PROTOCOL_ERROR");
      await checkIdentity();
      state.phase = "hello";
      await clientWrite(
        state,
        encodeWireValue({
          v: 1,
          type: "hello",
          profileId,
          generation,
          pid,
          startTicks,
        }),
      );
      return;
    }
    if (state.phase === "hello") {
      if (exact(frame, ["v", "type"]) && frame.v === 1 && frame.type === "projectPersistenceStatus") {
        await checkIdentity();
        let value = "unknown";
        try {
          const current = getProjectPersistenceStatus?.();
          if (["disabled", "waiting", "active", "unsupported", "error"].includes(current)) value = current;
        } catch {}
        state.phase = "metadata";
        await clientWrite(state, encodeWireValue({ v: 1, type: "projectPersistenceStatus", state: value }));
        return;
      }
      if (
        !exact(frame, ["v", "type", "viewId"]) ||
        frame.v !== 1 ||
        frame.type !== "createView" ||
        !UUID.test(frame.viewId ?? "") ||
        usedIds.has(frame.viewId) ||
        owners.has(frame.viewId) ||
        usedIds.size >= MAX_VIEW_IDS ||
        owners.size + destroyReceipts.size >= maxClients
      )
        throw failure("CONTROL_PROTOCOL_ERROR");
      await checkIdentity();
      if (
        state.closed ||
        usedIds.has(frame.viewId) ||
        owners.has(frame.viewId) ||
        owners.size + destroyReceipts.size >= maxClients
      )
        throw failure("CONTROL_PROTOCOL_ERROR");
      state.viewId = frame.viewId;
      state.scope = Object.freeze({
        profileId,
        generation,
        viewId: frame.viewId,
      });
      state.createRequested = true;
      state.phase = "creating";
      owners.set(frame.viewId, state);
      await enqueueUpstream(encoded, state, false, () => {
        if (usedIds.has(frame.viewId) || usedIds.size >= MAX_VIEW_IDS)
          throw failure("CONTROL_PROTOCOL_ERROR");
        usedIds.add(frame.viewId);
        state.createDispatched = true;
      });
      return;
    }
    if (state.phase !== "ready" || !validClientFrame(frame, state))
      throw failure("CONTROL_PROTOCOL_ERROR");
    state.inSeq = frame.seq;
    state.lastId = frame.id;
    const pending = {
      type: frame.type,
      portId: frame.portId,
      dispatched: false,
    };
    state.pending.set(frame.id, pending);
    if (frame.type === "openPort") state.ports.set(frame.portId, "opening");
    if (frame.type === "closePort") state.ports.set(frame.portId, "closing");
    await enqueueBrowserFrame(state, encoded, frame, pending);
  }
  function receiveHost(encoded) {
    if (upstreamBroken) return;
    if (
      typeof encoded !== "string" ||
      Buffer.byteLength(encoded, "utf8") > maxFrameBytes
    ) {
      revoke();
      return;
    }
    let frame;
    try {
      frame = decodeWireValue(encoded);
    } catch {
      revoke();
      return;
    }
    if (!frame || frame.v !== 1 || typeof frame.type !== "string") {
      revoke();
      return;
    }
    if (frame.type === "ready") {
      if (
        frame.profileId !== profileId ||
        frame.generation !== generation ||
        frame.pid !== pid
      )
        revoke();
      return;
    }
    if (frame.type === "error") {
      const receipt = destroyReceipts.get(frame.viewId);
      if (receipt) {
        if (receipt.dispatched) {
          destroyReceipts.delete(frame.viewId);
          receipt.reject(failure("CONTROL_OUTCOME_UNKNOWN"));
        }
        return;
      }
      if (retired) return;
      const state = owners.get(frame.viewId);
      if (state) closeClient(state, true, "CONTROL_UPSTREAM_ERROR");
      return;
    }
    if (
      !frame.scope ||
      frame.scope.profileId !== profileId ||
      frame.scope.generation !== generation ||
      !UUID.test(frame.scope.viewId ?? "")
    ) {
      revoke();
      return;
    }
    if (frame.type === "viewClosed") {
      const receipt = destroyReceipts.get(frame.scope.viewId);
      if (receipt) {
        if (!sameScope(frame.scope, receipt.scope)) {
          revoke();
          return;
        }
        if (!receipt.dispatched) return;
        destroyReceipts.delete(frame.scope.viewId);
        receipt.resolve();
        return;
      }
    }
    if (retired) return;
    const state = owners.get(frame.scope.viewId);
    if (!state || state.closed) return;
    if (!sameScope(frame.scope, state.scope)) {
      closeClient(state);
      return;
    }
    if (frame.type === "viewClosed") {
      state.viewClosed = true;
      closeClient(state, false);
      return;
    }
    if (frame.type === "bootstrap") {
      if (
        state.phase !== "creating" ||
        !state.createDispatched ||
        !frame.bootstrap ||
        frame.bootstrap.windowType !== "electron" ||
        !frame.bootstrap.getters ||
        !frame.bootstrap.sharedObjects
      ) {
        closeClient(state);
        return;
      }
      state.phase = "ready";
      clearTimeout(state.handshakeTimer);
      return clientWrite(state, encoded).catch(() => {});
    }
    if (
      state.phase !== "ready" ||
      !HOST_TYPES.has(frame.type) ||
      !integer(frame.seq) ||
      frame.seq !== state.outSeq + 1
    ) {
      closeClient(state);
      return;
    }
    if (frame.type === "return" || frame.type === "throw") {
      const pending = state.pending.get(frame.id);
      if (!pending?.dispatched) {
        closeClient(state);
        return;
      }
      state.pending.delete(frame.id);
      if (pending.type === "openPort") {
        if (frame.type === "return") state.ports.set(pending.portId, "open");
        else state.ports.delete(pending.portId);
      }
      if (pending.type === "closePort") {
        if (frame.type === "return") state.ports.delete(pending.portId);
        else state.ports.set(pending.portId, "open");
      }
    } else if (frame.type === "portMessage" || frame.type === "portClosed") {
      if (!validPort(frame.portId) || !state.ports.has(frame.portId)) {
        closeClient(state);
        return;
      }
      if (
        state.ports.get(frame.portId) === "opening" &&
        ![...state.pending.values()].some(
          (pending) =>
            pending.type === "openPort" &&
            pending.portId === frame.portId &&
            pending.dispatched,
        )
      ) {
        closeClient(state);
        return;
      }
      if (frame.type === "portClosed") state.ports.delete(frame.portId);
    } else if (frame.type === "gitPort" && frame.closed === false) {
      if (
        !validPort(frame.portId) ||
        !frame.portId.startsWith("git-") ||
        state.ports.has(frame.portId) ||
        state.ports.size >= MAX_PORTS
      ) {
        closeClient(state);
        return;
      }
      state.ports.set(frame.portId, "open");
    } else if (
      (frame.type === "gitPort" && frame.closed !== true) ||
      (frame.type === "theme" &&
        frame.value !== "light" &&
        frame.value !== "dark") ||
      (frame.type === "workerMessage" &&
        (typeof frame.workerId !== "string" ||
          frame.workerId.length < 1 ||
          frame.workerId.length > 128 ||
          /[\x00-\x1f\x7f]/.test(frame.workerId)))
    ) {
      closeClient(state);
      return;
    }
    state.outSeq = frame.seq;
    // Return completion to the native reader. A closed view already owns its
    // cleanup; releasing its receipt must not poison other native views.
    return clientWrite(state, encoded).catch(() => {});
  }
  function accept(socket) {
    socket.on("error", () => {});
    if (!published || retired || upstreamBroken || clients.size >= maxClients) {
      socket.destroy();
      return;
    }
    const state = {
      socket,
      phase: "new",
      closed: false,
      held: 0,
      inputHeld: 0,
      inputQueue: [],
      inputRunning: false,
      outputQueue: [],
      outputOwned: new Set(),
      outputActive: new Set(),
      outputRunning: false,
      outputScheduled: undefined,
      outputCount: 0,
      inSeq: 0,
      dispatchedSeq: 0,
      outSeq: 0,
      lastId: 0,
      pending: new Map(),
      ports: new Map(),
      viewId: null,
      scope: null,
      createRequested: false,
      createDispatched: false,
      viewClosed: false,
    };
    state.socketClosed = new Promise((resolveClose) =>
      socket.once("close", resolveClose),
    );
    state.handshakeTimer = setTimeout(
      () => closeClient(state, true, "CONTROL_HANDSHAKE_TIMEOUT"),
      handshakeTimeoutMs,
    );
    state.handshakeTimer.unref?.();
    clients.add(state);
    socket.once("close", () => closeClient(state));
    void (async () => {
      try {
        for await (const line of parseJsonLines(boundedInput(state), {
          maxLineBytes: maxFrameBytes,
          maxChunkBytes: MAX_CHUNK,
        })) {
          const bytes = Buffer.byteLength(line, "utf8");
          if (
            state.phase === "ready" &&
            upstream.explicitDispatch === true &&
            typeof upstream.sendBatch === "function"
          ) {
            // The original input reservation stays charged until the fixed
            // batch settles, but is no longer owned by the parser's buffer.
            state.inputHeld -= bytes;
            void receiveClient(state, line)
              .catch((error) => {
                const code =
                  error?.code === "CONTROL_QUEUE_FULL"
                    ? "CONTROL_QUEUE_FULL"
                    : "CONTROL_PROTOCOL_ERROR";
                closeClient(state, true, code);
              })
              .finally(() => release(state, bytes));
            continue;
          }
          try {
            await receiveClient(state, line);
          } catch (error) {
            const code =
              error?.code === "CONTROL_QUEUE_FULL"
                ? "CONTROL_QUEUE_FULL"
                : "CONTROL_PROTOCOL_ERROR";
            closeClient(state, true, code);
            // Let the fixed error flush before unwinding the JSONL iterator,
            // whose return() otherwise destroys the underlying socket.
            await state.socketClosed;
            return;
          } finally {
            state.inputHeld -= bytes;
            release(state, bytes);
          }
        }
      } catch (error) {
        const code =
          error?.code === "CONTROL_QUEUE_FULL" ||
          error?.code === "JSONL_FRAME_TOO_LARGE" ||
          error?.code === "JSONL_CHUNK_TOO_LARGE"
            ? "CONTROL_QUEUE_FULL"
            : "CONTROL_PROTOCOL_ERROR";
        closeClient(state, true, code);
      } finally {
        closeClient(state);
      }
    })();
  }
  async function closeListener() {
    if (!server?.listening) return;
    let replaced = false,
      parentCurrent = false;
    try {
      parentCurrent = privateDirectorySync(bindDir, bindDirInfo, uid);
      try {
        lstatSync(bindingPath);
        replaced = true;
      } catch (error) {
        if (error.code !== "ENOENT") replaced = true;
      }
    } catch {
      replaced = true;
    }
    if (!parentCurrent) replaced = true;
    // The transferred handle has no libuv bind name; close is safe even when a
    // foreign entry appears at either the hidden or public pathname.
    await new Promise((resolveClose, rejectClose) =>
      server.close((error) =>
        error ? rejectClose(failure("CONTROL_UNAVAILABLE")) : resolveClose(),
      ),
    );
    if (parentCurrent) await rmdir(bindDir).catch(() => {});
    if (replaced) throw failure("CONTROL_SOCKET_REPLACED");
  }
  function shutdown(cleanup = true) {
    if (closePromise) return closePromise;
    retired = true;
    for (const state of [...clients]) closeClient(state, cleanup);
    const jobs = [...cleanupJobs];
    const listener = closeListener().then(
      () => null,
      (error) => error,
    );
    closePromise = (async () => {
      try {
        const outcomes = await Promise.allSettled(jobs);
        const error = await listener;
        if (error) throw error;
        if (
          cleanupUnconfirmed ||
          outcomes.some((outcome) => outcome.status === "rejected")
        )
          throw failure("CONTROL_OUTCOME_UNKNOWN");
      } finally {
        clearSubscription();
      }
    })();
    return closePromise;
  }

  try {
    bindDir = await mkdtemp(join(parent, ".desktop-control-"));
    bindDirInfo = await privateDirectory(bindDir, uid);
    bindingPath = join(bindDir, "s");
    helper = fork(
      fileURLToPath(new URL("./control-bind-helper.cjs", import.meta.url)),
      [],
      {
        execArgv: [],
        env: {},
        stdio: ["ignore", "ignore", "ignore", "ipc"],
      },
    );
    helper.on("error", () => {});
    helper.on("message", (_, handle) => {
      // A timed-out/cancelled transfer can arrive after its waiter was removed.
      // Close this pathless descriptor rather than leave an unowned listener.
      if (handle?.close && !expectingHandle) {
        try {
          handle.close();
        } catch {}
      }
    });
    helperExit = new Promise((resolveExit) => {
      helper.once("exit", (code, signalCode) => {
        helperExited = true;
        resolveExit({ code, signalCode });
      });
      helper.once("error", () => {
        // An IPC error can occur while a successfully spawned child is still
        // alive. Only spawn failure implies there is no process to wait for.
        if (!helper.pid) {
          helperExited = true;
          resolveExit({ code: null, signalCode: null });
        }
      });
    });
    helperTicks = await startupWait(processIdentity(helper.pid, uid));
    expectingHandle = true;
    const bind = waitForHelper(helper, "bound", {
      v: 1,
      type: "bind",
      path: bindingPath,
    });
    try {
      server = await startupWait(bind.promise);
    } finally {
      expectingHandle = false;
      bind.cleanup();
    }
    server.maxConnections = maxClients;
    server.on("connection", accept);
    server.on("error", revoke);
    bindingInfo = await lstat(bindingPath, { bigint: true });
    if (
      !bindingInfo.isSocket() ||
      bindingInfo.uid !== BigInt(uid) ||
      (bindingInfo.mode & 0o7777n) !== 0o600n
    )
      throw failure("CONTROL_SOCKET_REPLACED");
    if ((await startupWait(Promise.resolve().then(verifyIdentity))) !== true)
      throw failure("CONTROL_IDENTITY_CHANGED");
    try {
      await link(bindingPath, socketPath);
    } catch (error) {
      throw failure(
        error?.code === "EEXIST"
          ? "CONTROL_SOCKET_EXISTS"
          : "CONTROL_PUBLISH_FAILED",
      );
    }
    const publicInfo = await lstat(socketPath, { bigint: true });
    if (
      !publicInfo.isSocket() ||
      !sameNode(publicInfo, bindingInfo) ||
      !sameNode(parentInfo, await privateDirectory(parent, uid)) ||
      !sameNode(bindDirInfo, await privateDirectory(bindDir, uid))
    )
      throw failure("CONTROL_SOCKET_REPLACED");
    if ((await startupWait(Promise.resolve().then(verifyIdentity))) !== true)
      throw failure("CONTROL_IDENTITY_CHANGED");
    const release = waitForHelper(helper, "released", {
      v: 1,
      type: "release",
    });
    try {
      await startupWait(release.promise);
    } finally {
      release.cleanup();
    }
    const helperResult = await startupWait(helperExit);
    if (helperResult.code !== 0 || helperResult.signalCode !== null)
      throw failure("CONTROL_UNAVAILABLE");
    try {
      await lstat(bindingPath);
      throw failure("CONTROL_SOCKET_REPLACED");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    const publishedInfo = await lstat(socketPath, { bigint: true });
    if (
      !sameNode(publishedInfo, bindingInfo) ||
      !sameNode(parentInfo, await privateDirectory(parent, uid)) ||
      !sameNode(bindDirInfo, await privateDirectory(bindDir, uid))
    )
      throw failure("CONTROL_SOCKET_REPLACED");
    if ((await startupWait(Promise.resolve().then(verifyIdentity))) !== true)
      throw failure("CONTROL_IDENTITY_CHANGED");
    const returned = upstream.subscribe(receiveHost);
    if (typeof returned !== "function") throw failure("CONTROL_INVALID_CONFIG");
    unsubscribe = returned;
    subscribed = true;
    if (retired || upstreamBroken) throw failure("CONTROL_IDENTITY_CHANGED");
    published = true;
    return Object.freeze({
      close: () => shutdown(true),
      dispose: () => shutdown(true),
    });
  } catch (error) {
    retired = true;
    clearSubscription();
    await stopHelper();
    if (closePromise) {
      try {
        await closePromise;
      } catch {}
    } else if (server?.listening) {
      // Parent's received listener does not carry an unlink pathname.
      try {
        await new Promise((resolveClose) => server.close(resolveClose));
      } catch {}
    }
    if (bindDir && bindDirInfo) {
      try {
        if (privateDirectorySync(bindDir, bindDirInfo, uid))
          await rmdir(bindDir).catch(() => {});
      } catch {}
    }
    if (typeof error?.code === "string" && error.code.startsWith("CONTROL_"))
      throw error;
    throw failure("CONTROL_UNAVAILABLE");
  }
}
