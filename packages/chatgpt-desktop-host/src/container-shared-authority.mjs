import { createRequire } from "node:module";
import { createSharedDaemonRpcGate } from "./shared-daemon-rpc-gate.mjs";
const require = createRequire(import.meta.url);
const {
  createSharedThreadAuthorityWire,
  isSharedThreadAuthorityFrame,
} = require("./shared-thread-authority-wire.cjs");
const {
  createSharedThreadAuthorityServer,
} = require("./shared-thread-authority-channel.cjs");
const { createSharedApprovalGate } = require("./shared-thread-approval.cjs");
const invalid = () =>
  Object.assign(new Error("Container shared authority unavailable"), {
    code: "CONTAINER_SHARED_INVALID_CONFIG",
  });
const methods = [
  "resolveBinding",
  "verifyViewSync",
  "verifyBindingSync",
  "verifyHistorySync",
  "verifyReadSync",
  "write",
];

/** This object is constructed in trusted server code, never from HTTP or JSON. */
export function normalizeContainerSharedAuthority(sharedThread) {
  if (sharedThread === undefined) return undefined;
  if (
    !sharedThread ||
    typeof sharedThread !== "object" ||
    Array.isArray(sharedThread) ||
    Object.keys(sharedThread).sort().join(",") !==
      methods.slice().sort().join(",") ||
    methods.some((name) => {
      const d = Object.getOwnPropertyDescriptor(sharedThread, name);
      return !d || !Object.hasOwn(d, "value") || typeof d.value !== "function";
    })
  )
    throw invalid();
  return Object.freeze(
    Object.fromEntries(
      methods.map((name) => [
        name,
        Object.getOwnPropertyDescriptor(sharedThread, name).value,
      ]),
    ),
  );
}

/** Server-only callbacks must derive identity from the existing owned daemon. */
export function createContainerSharedAuthority({
  profileId,
  generation,
  verifyContainerSync,
  verifyOwnedViewSync,
  sendFrame,
  sharedThread,
  memoryBudget,
  rpcGate,
  verifyCreatedBindingSync,
} = {}) {
  sharedThread = normalizeContainerSharedAuthority(sharedThread);
  if (
    !sharedThread || (verifyCreatedBindingSync !== undefined && typeof verifyCreatedBindingSync !== "function") ||
    [verifyContainerSync, verifyOwnedViewSync, sendFrame].some(
      (value) => typeof value !== "function",
    )
  )
    throw invalid();
  let closed = false,
    wire,
    server;
  const unacked = new Set();
  const current = () => {
    try {
      return !closed && verifyContainerSync() === true;
    } catch {
      return false;
    }
  };
  const view = (id) => {
    try {
      return current() && verifyOwnedViewSync(id) === true;
    } catch {
      return false;
    }
  };
  const binding = (value) => {
    try {
      return (
        view(value.viewId) && sharedThread.verifyBindingSync(value) === true
      );
    } catch {
      return false;
    }
  };
  const history = (value) => {
    try {
      return view(value.viewId) && sharedThread.verifyHistorySync(value) === true;
    } catch {
      return false;
    }
  };
  const read = (frame) => {
    try {
      return current() && sharedThread.verifyReadSync(frame) === true;
    } catch {
      return false;
    }
  };
  if (rpcGate !== undefined && (!rpcGate || typeof rpcGate !== "object" ||
      Object.keys(rpcGate).sort().join(",") !== "close,receive,registerConnect,write" ||
      ["close", "receive", "registerConnect", "write"].some(name => {
        const field = Object.getOwnPropertyDescriptor(rpcGate, name);
        return !field || !Object.hasOwn(field, "value") || typeof field.value !== "function";
      }))) throw invalid();
  // A server-owned desktop session may supply its one already guarded gate.
  // Its native initialization and authorized resume then use the same client.
  const gate = rpcGate ?? createSharedDaemonRpcGate({
    verifyReadSync: read,
    verifyBindingSync: binding,
    verifyHistorySync: history,
    write: (encoded) => {
      if (!current()) throw invalid();
      return sharedThread.write(encoded);
    },
  });
  const approvalGate = createSharedApprovalGate({
    verifyBindingSync: binding,
    verifyHistorySync: history,
    write: (encoded) => {
      if (!current()) throw invalid();
      return sharedThread.write(encoded);
    },
  });
  try {
    wire = createSharedThreadAuthorityWire({
      side: "host",
      sendFrame: (frame) => {
        if (
          !current() ||
          !isSharedThreadAuthorityFrame(frame, {
            side: "host",
            profileId,
            generation,
          }) ||
          unacked.has(frame.requestId)
        )
          throw invalid();
        unacked.add(frame.requestId);
        try {
          return Promise.resolve(sendFrame(frame)).catch((error) => {
            unacked.delete(frame.requestId);
            close();
            throw error;
          });
        } catch (error) {
          unacked.delete(frame.requestId);
          throw error;
        }
      },
    });
    server = createSharedThreadAuthorityServer({
      memoryBudget,
      socket: wire.stream,
      profileId,
      generation,
      gate,
      approvalGate,
      verifyViewSync: (request) => {
        try {
          return (
            view(request.viewId) &&
            sharedThread.verifyViewSync(request) === true
          );
        } catch {
          return false;
        }
      },
      verifyBindingSync: binding,
      verifyReadSync: read,
      verifyHistorySync: history,
      verifyCreatedBindingSync: value => history(value) && verifyCreatedBindingSync?.(value) === true,
      onReplyAck: (id) => {
        if (!unacked.delete(id)) throw invalid();
      },
      onRpcAck: (id) => {
        if (!unacked.delete(id)) throw invalid();
      },
      onEventAck: (id) => {
        if (!unacked.delete(id)) throw invalid();
      },
      resolveBinding: async (request) => {
        if (!view(request.viewId)) throw invalid();
        const result = await sharedThread.resolveBinding(request);
        if (!view(request.viewId)) throw invalid();
        return result;
      },
    });
  } catch (error) {
    approvalGate.close();
    gate.close();
    wire?.close();
    throw error;
  }
  function close() {
    if (closed) return;
    closed = true;
    unacked.clear();
    server.close();
    wire.close();
  }
  function receive(frame) {
    if (
      !current() ||
      !isSharedThreadAuthorityFrame(frame, {
        side: "native",
        profileId,
        generation,
      })
    ) {
      close();
      throw invalid();
    }
    wire.receive(frame);
  }
  function isIdle() {
    return (
      !closed &&
      !server.busy &&
      !unacked.size &&
      wire.stream.writableLength === 0
    );
  }
  function receiveDaemon(encoded) {
    if (!current()) {
      close();
      return false;
    }
    if (!server.receiveDaemon(encoded)) {
      close();
      return false;
    }
    return true;
  }
  async function waitForIdle({ timeoutMs = 5000 } = {}) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5000)
      throw invalid();
    const deadline = performance.now() + timeoutMs;
    while (!isIdle()) {
      if (closed || performance.now() >= deadline) throw invalid();
      await new Promise((resolve) =>
        setTimeout(
          resolve,
          Math.min(10, Math.max(1, deadline - performance.now())),
        ),
      );
    }
  }
  return Object.freeze({ receive, receiveDaemon, isIdle, waitForIdle, close,
    registerCreatedFollow: (binding, control) => current() && server.registerCreatedFollow(binding, control),
    verifyConnectedThreadSync: threadId => current() && server.verifyConnectedThreadSync(threadId) === true });
}
