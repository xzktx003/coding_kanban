"use strict";

// A single ordered, already-authenticated private transport for per-view
// authorization and daemon dispatch. The owner supplies the actual identity
// checks and the final synchronous gate; this module never opens a daemon.
const { randomUUID } = require("node:crypto");
const { performance } = require("node:perf_hooks");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_LINE = 64 * 1024,
  MAX_QUEUED = 8 * 1024 * 1024,
  MAX_PENDING = 16,
  MAX_USED = 8192,
  MAX_RPC_BYTES = 16 * 1024 * 1024,
  RPC_CHUNK_BYTES = 32 * 1024,
  TTL = 30000;
const failure = (code) =>
  Object.assign(new Error("Shared thread authority unavailable"), { code });
const denied = () => failure("SHARED_AUTHORITY_DENIED");
function createSharedAuthorityMemoryBudget() {
  let used = 0;
  return Object.freeze({
    reserveBytes(n) { if (!Number.isSafeInteger(n) || n < 0 || used + n > MAX_RPC_BYTES) return false; used += n; return true; },
    releaseBytes(n) { if (!Number.isSafeInteger(n) || n < 0 || n > used) throw denied(); used -= n; },
  });
}
// A server-owned budget may be shared with another private channel. The
// channel's existing per-kind limits still apply independently.
function memoryOwner(budget) {
  if (budget !== undefined && (!budget || typeof budget.reserveBytes !== "function" || typeof budget.releaseBytes !== "function")) throw denied();
  let held = 0;
  return {
    reserve(n) { if (n && budget && budget.reserveBytes(n) !== true) throw denied(); held += n; },
    release(n) { if (n < 0 || n > held) throw denied(); held -= n; if (n && budget) budget.releaseBytes(n); },
    clear() { const n = held; held = 0; if (n && budget) budget.releaseBytes(n); },
  };
}
const obj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const exact = (value, keys) =>
  obj(value) &&
  Object.keys(value).sort().join(",") === keys.slice().sort().join(",");
const atom = (x) =>
  typeof x === "string" &&
  x.length > 0 &&
  x.length <= 256 &&
  !/[\x00-\x1f\x7f]/.test(x);
const rpcId = (x) => atom(x) || (Number.isSafeInteger(x) && x >= 0);
const rpcKey = (x) => `${typeof x}:${x}`;
const notifications = new Set([
  "hook/started",
  "hook/completed",
  "mcpServer/startupStatus/updated",
  "thread/status/changed",
  "thread/name/updated",
  "thread/queue/changed",
  "thread/readState/changed",
  "thread/tokenUsage/updated",
  "thread/compacted",
  "thread/goal/updated",
  "thread/goal/cleared",
  "thread/prediction/updated",
  "thread/attachment/updated",
  "thread/project/updated",
  "thread/settings/updated",
  "thread/reverted",
  "thread/archived",
  "thread/unarchived",
  "thread/deleted",
  "thread/closed",
  "turn/started",
  "turn/completed",
  "turn/moderationMetadata",
  "turn/diff/updated",
  "turn/plan/updated",
  "item/started",
  "item/completed",
  "item/agentMessage/delta",
  "item/plan/delta",
  "item/commandExecution/outputDelta",
  "item/fileChange/outputDelta",
  "item/fileChange/patchUpdated",
  "item/reasoning/summaryTextDelta",
  "item/reasoning/summaryPartAdded",
  "item/reasoning/textDelta",
  "serverRequest/resolved",
]);
const serverRequests = new Set([
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
  "item/permissions/requestApproval",
  "item/tool/requestUserInput",
]);
const mono = () => Number(process.hrtime.bigint() / 1000000n);
const BINDING = [
  "hostId",
  "runtimeGeneration",
  "daemonGeneration",
  "accountRevision",
  "projectId",
  "threadId",
  "viewId",
  "clientId",
];
function checkedBinding(value) {
  if (
    !exact(value, BINDING) ||
    !atom(value.hostId) ||
    !atom(value.projectId) ||
    !Number.isSafeInteger(value.accountRevision) ||
    value.accountRevision < 0 ||
    ![
      value.runtimeGeneration,
      value.daemonGeneration,
      value.threadId,
      value.viewId,
      value.clientId,
    ].every((x) => UUID.test(x ?? ""))
  )
    throw denied();
  return Object.freeze(
    Object.fromEntries(BINDING.map((key) => [key, value[key]])),
  );
}
const bindingKey = (value) => JSON.stringify(BINDING.map((key) => value[key]));
function scoped(frame, profileId, generation) {
  return (
    frame?.v === 1 &&
    frame.profileId === profileId &&
    frame.generation === generation
  );
}

function channel(socket, onFrame, onClose) {
  if (
    !socket ||
    typeof socket.on !== "function" ||
    typeof socket.write !== "function" ||
    typeof socket.destroy !== "function"
  )
    throw denied();
  let active = true,
    buffer = Buffer.alloc(0),
    queued = 0;
  function close() {
    if (!active) return;
    active = false;
    socket.removeListener("data", data);
    socket.removeListener("error", close);
    socket.removeListener("close", close);
    try {
      socket.destroy();
    } catch {}
    try {
      onClose();
    } catch {}
  }
  function send(frame) {
    if (!active) throw denied();
    let encoded;
    try {
      encoded = Buffer.from(JSON.stringify(frame) + "\n");
    } catch {
      throw denied();
    }
    if (encoded.length > MAX_LINE + 1 || queued + encoded.length > MAX_QUEUED) {
      close();
      throw denied();
    }
    queued += encoded.length;
    try {
      socket.write(encoded, (error) => {
        queued -= encoded.length;
        if (error) close();
      });
    } catch {
      queued -= encoded.length;
      close();
      throw denied();
    }
  }
  function data(chunk) {
    try {
      if (!Buffer.isBuffer(chunk) || chunk.length > MAX_QUEUED) throw denied();
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length) {
        const index = buffer.indexOf(10);
        if (index < 0) {
          if (buffer.length > MAX_LINE) throw denied();
          return;
        }
        if (index > MAX_LINE) throw denied();
        const line = buffer.subarray(0, index);
        buffer = buffer.subarray(index + 1);
        const frame = JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(line),
        );
        if (!obj(frame)) throw denied();
        onFrame(frame);
        if (!active) return;
      }
    } catch {
      close();
    }
  }
  socket.on("data", data);
  socket.on("error", close);
  socket.on("close", close);
  return Object.freeze({
    send,
    close,
    get active() {
      return active;
    },
  });
}

function createSharedThreadAuthorityServer(options = {}, dependencies = {}) {
  const {
    socket,
    profileId,
    generation,
    resolveBinding,
    verifyViewSync,
    verifyBindingSync,
    verifyReadSync,
    verifyHistorySync,
    verifyCreatedBindingSync,
    gate,
    approvalGate,
    onCancel = () => {},
    onReplyAck = () => {},
    onRpcAck = () => {},
    onEventAck = () => {},
    memoryBudget,
  } = options;
  const { bindingNow = () => performance.now(), bindTimeoutMs = TTL } =
    dependencies;
  if (
    !UUID.test(profileId ?? "") ||
    !UUID.test(generation ?? "") ||
    [
      resolveBinding,
      verifyViewSync,
      verifyBindingSync,
      onCancel,
      onReplyAck,
      onRpcAck,
      onEventAck,
      gate?.registerConnect,
      gate?.write,
      gate?.close,
      bindingNow,
    ].some((x) => typeof x !== "function") ||
    !Number.isSafeInteger(bindTimeoutMs) ||
    (verifyReadSync !== undefined && typeof verifyReadSync !== "function") ||
    (verifyHistorySync !== undefined &&
      typeof verifyHistorySync !== "function") ||
    (verifyCreatedBindingSync !== undefined && typeof verifyCreatedBindingSync !== "function") ||
    bindTimeoutMs < 1 ||
    bindTimeoutMs > TTL
  )
    throw denied();
  const memory = memoryOwner(memoryBudget);
  const bindings = new Map(),
    attempts = new Map(),
    seen = new Set(),
    pending = new Map(),
    rpcByRequest = new Map(),
    rpcById = new Map(),
    followers = new Map(),
    createdFollows = new Map(),
    createdFollowIds = new Set(),
    eventQueue = [],
    backlog = [];
  let disposed = false,
    transport,
    rpcBytes = 0,
    eventBytes = 0,
    activeEvent = null;
  function safeView(value) {
    try {
      return !disposed && verifyViewSync(value) === true;
    } catch {
      return false;
    }
  }
  function safeBinding(value) {
    try {
      return !disposed && verifyBindingSync(value) === true;
    } catch {
      return false;
    }
  }
  function safeDelivery(value) {
    try {
      if (disposed) return false;
      if (value.attempt) {
        return (
          attempts.get(value.attemptId) === value.attempt &&
          !value.attempt.controller.signal.aborted &&
          performance.now() < value.attempt.deadline &&
          safeBinding(value.attempt.binding) &&
          verifyHistorySync?.(value.attempt.binding) === true
        );
      }
      return verifyReadSync?.(value.frame) === true;
    } catch {
      return false;
    }
  }
  function pruneBindings() {
    const now = bindingNow();
    if (!Number.isFinite(now)) throw denied();
    for (const [key, value] of bindings)
      if (value.expires <= now) bindings.delete(key);
    return now;
  }
  function reply(requestId, ok, extra = {}) {
    transport.send({
      v: 1,
      type: "shared-reply",
      profileId,
      generation,
      requestId,
      ok,
      ...extra,
    });
  }
  function dropAttempt(id) {
    const value = attempts.get(id);
    if (!value) return;
    attempts.delete(id);
    clearTimeout(value.timer);
    value.controller.abort();
    if (!followers.has(id)) approvalGate?.retire?.(id);
    if (rpcById.get(value.idKey)?.attempt === value) close();
    // Each pending resume owns its own ordered backlog. Retiring one view
    // must not remove a different view's events for the same thread.
    for (let i = backlog.length - 1; i >= 0; i--) {
      if (backlog[i].attemptId === id) {
        memory.release(backlog[i].bytes.length);
        eventBytes -= backlog[i].bytes.length;
        backlog.splice(i, 1);
      }
    }
  }
  function dropCreatedFollow(id) {
    const value = createdFollows.get(id); if (!value) return;
    createdFollows.delete(id); clearTimeout(value.timer);
    value.signal.removeEventListener("abort", value.abort);
  }
  // Server-only preparation after real created-source adoption. It grants no
  // RPC write and does not impersonate a resume attempt or fabricate history.
  function registerCreatedFollow(rawBinding, control) {
    try {
      const binding = checkedBinding(rawBinding), now = performance.now();
      if (disposed || !exact(control, ["attemptId", "signal", "deadline"]) || !UUID.test(control.attemptId ?? "") ||
          !(control.signal instanceof AbortSignal) || control.signal.aborted || !Number.isFinite(control.deadline) ||
          control.deadline <= now || control.deadline > now + TTL || createdFollows.size + attempts.size >= MAX_PENDING ||
          createdFollowIds.size >= MAX_USED || createdFollowIds.has(control.attemptId) || attempts.has(control.attemptId) || followers.has(control.attemptId) ||
          !safeBinding(binding) || verifyHistorySync?.(binding) !== true || verifyCreatedBindingSync?.(binding) !== true) return false;
      const value = { binding, signal: control.signal, deadline: control.deadline, timer: null, abort: () => dropCreatedFollow(control.attemptId) };
      createdFollowIds.add(control.attemptId); createdFollows.set(control.attemptId, value);
      value.timer = setTimeout(value.abort, Math.max(1, Math.ceil(control.deadline - now))); value.timer.unref?.();
      value.signal.addEventListener("abort", value.abort, { once: true });
      if (value.signal.aborted) { dropCreatedFollow(control.attemptId); return false; }
      return true;
    } catch { return false; }
  }
  function close() {
    if (disposed) return;
    disposed = true;
    for (const id of attempts.keys()) dropAttempt(id);
    for (const id of createdFollows.keys()) dropCreatedFollow(id);
    createdFollowIds.clear();
    bindings.clear();
    for (const value of pending.values()) {
      clearTimeout(value.timer);
      value.controller?.abort();
    }
    pending.clear();
    for (const value of rpcByRequest.values()) clearTimeout(value.timer);
    rpcByRequest.clear();
    rpcById.clear();
    followers.clear();
    eventQueue.length = 0;
    backlog.length = 0;
    if (activeEvent) clearTimeout(activeEvent.timer);
    activeEvent = null;
    memory.clear();
    eventBytes = 0;
    rpcBytes = 0;
    approvalGate?.close();
    gate.close();
    transport?.close();
  }
  function dropRpc(value) {
    if (rpcByRequest.get(value.requestId) !== value) return;
    rpcByRequest.delete(value.requestId);
    rpcById.delete(value.idKey);
    clearTimeout(value.timer);
    memory.release(value.buffer?.length ?? 0);
    rpcBytes -= value.buffer?.length ?? 0;
    value.buffer = undefined;
  }
  function nextRpcChunk(value) {
    if (!safeDelivery(value) || !value.buffer || value.awaiting !== null)
      throw denied();
    const end = Math.min(value.offset + RPC_CHUNK_BYTES, value.buffer.length);
    const data = value.buffer.subarray(value.offset, end).toString("base64");
    value.offset = end;
    value.sequence++;
    value.awaiting = value.sequence;
    transport.send({
      v: 1,
      type: "shared-rpc-chunk",
      profileId,
      generation,
      requestId: value.requestId,
      sequence: value.sequence,
      final: end === value.buffer.length,
      data,
    });
  }
  function followerLive(value) {
    try {
      return (
        !disposed &&
        followers.get(value.attemptId) === value &&
        safeView(value.binding) &&
        verifyHistorySync?.(value.binding) === true
      );
    } catch {
      return false;
    }
  }
  function queueEvent(follower, bytes, eventId, deliveryCount) {
    if (eventQueue.length + backlog.length + (activeEvent ? 1 : 0) >= 64)
      throw denied();
    eventQueue.push({
      follower,
      bytes,
      eventId,
      deliveryCount,
      requestId: randomUUID(),
      offset: 0,
      sequence: 0,
      awaiting: null,
    });
    pumpEvents();
  }
  function pumpEvents() {
    if (disposed || activeEvent) return;
    while (eventQueue.length) {
      const value = eventQueue.shift();
      if (!followerLive(value.follower)) {
        if (followers.get(value.follower.attemptId) === value.follower)
          throw denied();
        memory.release(value.bytes.length);
        eventBytes -= value.bytes.length;
        continue;
      }
      activeEvent = value;
      value.timer = setTimeout(close, TTL);
      value.timer.unref?.();
      nextEventChunk();
      return;
    }
  }
  function nextEventChunk() {
    const value = activeEvent;
    if (!value || value.awaiting !== null || !followerLive(value.follower))
      throw denied();
    const end = Math.min(value.offset + RPC_CHUNK_BYTES, value.bytes.length);
    const data = value.bytes.subarray(value.offset, end).toString("base64");
    value.offset = end;
    value.awaiting = ++value.sequence;
    transport.send({
      v: 1,
      type: "shared-event-chunk",
      profileId,
      generation,
      requestId: value.requestId,
      sequence: value.sequence,
      final: end === value.bytes.length,
      attemptId: value.follower.attemptId,
      binding: value.follower.binding,
      eventId: value.eventId,
      deliveryCount: value.deliveryCount,
      data,
    });
  }
  function receiveEvent(frame, encoded) {
    if (frame.method === "account/updated") throw denied();
    if (frame.method === "serverRequest/resolved")
      approvalGate?.observeResolved(frame);
    if (!obj(frame.params) || typeof frame.method !== "string") throw denied();
    const threadId = frame.params.threadId;
    if (!UUID.test(threadId ?? "")) return true;
    const matchingFollowers = Array.from(followers.values()).filter(
      (value) => value.binding.threadId === threadId,
    );
    if (matchingFollowers.some((value) => !followerLive(value))) throw denied();
    const pendingAttempts = Array.from(attempts.values()).filter(
      (value) =>
        !followers.has(value.attemptId) &&
        value.dispatched &&
        !value.controller.signal.aborted &&
        performance.now() < value.deadline &&
        value.binding.threadId === threadId &&
        safeBinding(value.binding) &&
        verifyHistorySync?.(value.binding) === true,
    );
    const targets = [...matchingFollowers, ...pendingAttempts];
    if (!targets.length) return true;
    const hasId = Object.hasOwn(frame, "id");
    if (
      (hasId && (!rpcId(frame.id) || !serverRequests.has(frame.method))) ||
      (!hasId && !notifications.has(frame.method)) ||
      Object.keys(frame).some(
        (key) =>
          !["id", "method", "params", "jsonrpc", "emittedAtMs"].includes(key),
      ) ||
      (frame.jsonrpc !== undefined && frame.jsonrpc !== "2.0") ||
      (frame.emittedAtMs !== undefined &&
        (!Number.isSafeInteger(frame.emittedAtMs) || frame.emittedAtMs < 0))
    )
      throw denied();
    if (
      approvalGate &&
      hasId &&
      [
        "item/commandExecution/requestApproval",
        "item/fileChange/requestApproval",
      ].includes(frame.method)
    ) {
      for (const target of targets)
        if (approvalGate.observe(target.binding, target.attemptId, frame) !== true)
          throw denied();
    }
    const bytes = Buffer.from(encoded, "utf8");
    const needed = bytes.length * targets.length;
    if (
      !bytes.length ||
      bytes.length > MAX_QUEUED ||
      !Number.isSafeInteger(needed) ||
      eventBytes + needed > MAX_QUEUED ||
      eventBytes + rpcBytes + needed > MAX_RPC_BYTES ||
      eventQueue.length + backlog.length + (activeEvent ? 1 : 0) + targets.length > 64
    )
      throw denied();
    memory.reserve(needed);
    eventBytes += needed;
    // Different owned views may follow the same daemon thread through one
    // native manager. Preserve each view's capability while letting the
    // receiver identify copies of one actual daemon event.
    const eventId = randomUUID(), deliveryCount = targets.length;
    for (const follower of matchingFollowers) queueEvent(follower, bytes, eventId, deliveryCount);
    for (const attempt of pendingAttempts) backlog.push({ attemptId: attempt.attemptId, bytes, eventId, deliveryCount });
    return true;
  }
  function receiveDaemon(encoded) {
    if (
      disposed ||
      typeof gate.receive !== "function" ||
      typeof encoded !== "string"
    )
      return false;
    try {
      if (Buffer.byteLength(encoded) > MAX_RPC_BYTES) throw denied();
      const frame = JSON.parse(encoded);
      if (obj(frame) && typeof frame.method === "string")
        return receiveEvent(frame, encoded);
      if (!obj(frame) || !rpcId(frame.id)) throw denied();
      const value = rpcById.get(rpcKey(frame.id));
      if (!value || value.buffer || !safeDelivery(value)) throw denied();
      const checked = gate.receive(encoded);
      if (checked !== encoded) throw denied();
      const bytes = Buffer.from(encoded, "utf8");
      if (!bytes.length || rpcBytes + eventBytes + bytes.length > MAX_RPC_BYTES)
        throw denied();
      memory.reserve(bytes.length);
      rpcBytes += bytes.length;
      value.buffer = bytes;
      value.success = Object.hasOwn(frame, "result");
      if (value.attempt && !value.success) value.attempt.nativeRejected = true;
      nextRpcChunk(value);
      return true;
    } catch {
      close();
      return false;
    }
  }
  function handle(frame) {
    if (disposed || !scoped(frame, profileId, generation)) throw denied();
    if (frame.type === "shared-cancel") {
      if (
        !exact(frame, ["v", "type", "profileId", "generation", "attemptId"]) ||
        !UUID.test(frame.attemptId ?? "")
      )
        throw denied();
      dropAttempt(frame.attemptId);
      try {
        onCancel(frame.attemptId);
      } catch {}
      return;
    }
    if (frame.type === "shared-cancel-binding") {
      if (
        !exact(frame, ["v", "type", "profileId", "generation", "requestId"]) ||
        !UUID.test(frame.requestId ?? "")
      )
        throw denied();
      const value = pending.get(frame.requestId);
      if (value?.controller) value.controller.abort();
      else value?.finish(false);
      return;
    }
    if (frame.type === "shared-unfollow") {
      if (
        !exact(frame, ["v", "type", "profileId", "generation", "attemptId"]) ||
        !UUID.test(frame.attemptId ?? "")
      )
        throw denied();
      const follower = followers.get(frame.attemptId);
      if (follower) {
        followers.delete(frame.attemptId);
        approvalGate?.retire?.(frame.attemptId);
        for (const value of pending.values())
          if (value.attemptId === frame.attemptId) value.controller?.abort();
        if (activeEvent?.follower === follower) {
          close();
          return;
        }
        pumpEvents();
      }
      return;
    }
    if (frame.type === "shared-reply-ack") {
      if (
        !exact(frame, ["v", "type", "profileId", "generation", "requestId"]) ||
        !UUID.test(frame.requestId ?? "")
      )
        throw denied();
      onReplyAck(frame.requestId);
      return;
    }
    if (frame.type === "shared-rpc-ack") {
      if (
        !exact(frame, [
          "v",
          "type",
          "profileId",
          "generation",
          "requestId",
          "sequence",
        ]) ||
        !UUID.test(frame.requestId ?? "") ||
        !Number.isSafeInteger(frame.sequence) ||
        frame.sequence < 1
      )
        throw denied();
      const value = rpcByRequest.get(frame.requestId);
      if (
        !value ||
        value.awaiting !== frame.sequence ||
        !value.buffer ||
        !safeDelivery(value)
      )
        throw denied();
      onRpcAck(frame.requestId, frame.sequence);
      value.awaiting = null;
      if (value.offset === value.buffer.length) {
        if (value.attempt && value.success) value.attempt.readyToFollow = true;
        dropRpc(value);
      } else nextRpcChunk(value);
      return;
    }
    if (frame.type === "shared-event-ack") {
      if (
        !exact(frame, [
          "v",
          "type",
          "profileId",
          "generation",
          "requestId",
          "sequence",
        ]) ||
        !UUID.test(frame.requestId ?? "") ||
        !Number.isSafeInteger(frame.sequence) ||
        frame.sequence < 1 ||
        !activeEvent ||
        activeEvent.requestId !== frame.requestId ||
        activeEvent.awaiting !== frame.sequence ||
        !followerLive(activeEvent.follower)
      )
        throw denied();
      onEventAck(frame.requestId, frame.sequence);
      activeEvent.awaiting = null;
      if (activeEvent.offset === activeEvent.bytes.length) {
        clearTimeout(activeEvent.timer);
        memory.release(activeEvent.bytes.length);
        eventBytes -= activeEvent.bytes.length;
        activeEvent = null;
        pumpEvents();
      } else nextEventChunk();
      return;
    }
    if (
      !UUID.test(frame.requestId ?? "") ||
      seen.has(frame.requestId) ||
      seen.size >= MAX_USED
    )
      throw denied();
    seen.add(frame.requestId);
    if (frame.type === "shared-follow") {
      if (
        !exact(frame, [
          "v",
          "type",
          "profileId",
          "generation",
          "requestId",
          "attemptId",
        ]) ||
        !UUID.test(frame.attemptId ?? "")
      )
        throw denied();
      const attempt = attempts.get(frame.attemptId);
      const created = createdFollows.get(frame.attemptId);
      if (
        (attempt ? !attempt.readyToFollow || attempt.controller.signal.aborted || performance.now() >= attempt.deadline :
          !created || created.signal.aborted || performance.now() >= created.deadline || verifyCreatedBindingSync?.(created.binding) !== true) ||
        !safeBinding((attempt ?? created).binding) ||
        verifyHistorySync?.((attempt ?? created).binding) !== true ||
        followers.size >= MAX_PENDING ||
        followers.has(frame.attemptId)
      ) {
        reply(frame.requestId, false, { code: "denied" });
        return;
      }
      const follower = { attemptId: frame.attemptId, binding: (attempt ?? created).binding };
      followers.set(frame.attemptId, follower);
      if (created) dropCreatedFollow(frame.attemptId);
      reply(frame.requestId, true);
      for (let i = 0; i < backlog.length; ) {
        if (backlog[i].attemptId === follower.attemptId) {
          const [event] = backlog.splice(i, 1);
          queueEvent(follower, event.bytes, event.eventId, event.deliveryCount);
        } else i++;
      }
      return;
    }
    if (frame.type === "shared-authorize" && frame.operation === "bind") {
      if (
        !exact(frame, [
          "v",
          "type",
          "profileId",
          "generation",
          "requestId",
          "operation",
          "viewId",
          "hostId",
          "threadId",
          ...(Object.hasOwn(frame, "sourceToken") ? ["sourceToken"] : []),
        ]) ||
        !UUID.test(frame.viewId ?? "") ||
        !UUID.test(frame.threadId ?? "") ||
        !atom(frame.hostId) ||
        (Object.hasOwn(frame, "sourceToken") && (typeof frame.sourceToken !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(frame.sourceToken))) ||
        pending.size >= MAX_PENDING ||
        !safeView(frame)
      ) {
        reply(frame.requestId, false, { code: "denied" });
        return;
      }
      const request = Object.freeze({
          viewId: frame.viewId,
          threadId: frame.threadId,
          hostId: frame.hostId,
          ...(Object.hasOwn(frame, "sourceToken") ? {sourceToken:frame.sourceToken} : {}),
        }),
        entry = { timer: null };
      const finish = (ok, binding) => {
        if (pending.get(frame.requestId) !== entry) return;
        pending.delete(frame.requestId);
        clearTimeout(entry.timer);
        if (disposed) return;
        try {
          reply(frame.requestId, ok, ok ? { binding } : { code: "denied" });
        } catch {
          close();
        }
      };
      entry.finish = finish;
      pending.set(frame.requestId, entry);
      entry.timer = setTimeout(() => finish(false), bindTimeoutMs);
      entry.timer.unref?.();
      Promise.resolve()
        .then(() => resolveBinding(request))
        .then((value) => {
          if (disposed || pending.get(frame.requestId) !== entry) return;
          const binding = checkedBinding(value);
          const now = pruneBindings(),
            key = bindingKey(binding);
          if (
            !safeView(frame) ||
            !safeBinding(binding) ||
            binding.viewId !== frame.viewId ||
            binding.threadId !== frame.threadId ||
            binding.hostId !== frame.hostId ||
            binding.runtimeGeneration !== generation ||
            (!bindings.has(key) && bindings.size >= MAX_PENDING)
          )
            throw denied();
          bindings.set(key, { binding, expires: now + TTL });
          finish(true, binding);
        })
        .catch(() => finish(false));
      return;
    }
    if (frame.type === "shared-authorize" && frame.operation === "request") {
      if (
        !exact(frame, [
          "v",
          "type",
          "profileId",
          "generation",
          "requestId",
          "operation",
          "binding",
          "attemptId",
          "frame",
          "deadlineMono",
        ]) ||
        !UUID.test(frame.attemptId ?? "") ||
        !Number.isSafeInteger(frame.deadlineMono) ||
        attempts.has(frame.attemptId) ||
        createdFollowIds.has(frame.attemptId) ||
        attempts.size + createdFollows.size >= MAX_PENDING
      ) {
        reply(frame.requestId, false, { code: "denied" });
        return;
      }
      let binding;
      try {
        binding = checkedBinding(frame.binding);
      } catch {
        reply(frame.requestId, false, { code: "denied" });
        return;
      }
      const now = pruneBindings(),
        key = bindingKey(binding),
        stored = bindings.get(key),
        remaining = frame.deadlineMono - mono();
      bindings.delete(key);
      if (
        !stored ||
        now >= stored.expires ||
        remaining <= 0 ||
        remaining > TTL ||
        !safeBinding(stored.binding)
      ) {
        reply(frame.requestId, false, { code: "denied" });
        return;
      }
      const controller = new AbortController(),
        deadline = performance.now() + remaining;
      const value = {
        controller,
        attemptId: frame.attemptId,
        binding: stored.binding,
        idKey: rpcId(frame.frame?.id) ? rpcKey(frame.frame.id) : null,
        deadline,
        timer: setTimeout(() => dropAttempt(frame.attemptId), remaining),
      };
      value.timer.unref?.();
      attempts.set(frame.attemptId, value);
      let accepted = false;
      try {
        accepted =
          gate.registerConnect(stored.binding, frame.frame, {
            attemptId: frame.attemptId,
            signal: controller.signal,
            deadline,
          }) === true;
      } catch {}
      if (!accepted) {
        dropAttempt(frame.attemptId);
        reply(frame.requestId, false, { code: "denied" });
        return;
      }
      reply(frame.requestId, true);
      return;
    }
    if (frame.type === "shared-approval") {
      const expected = [
        "v",
        "type",
        "profileId",
        "generation",
        "requestId",
        "binding",
        "attemptId",
        "actionId",
        "approvalRequestId",
        "turnId",
        "itemId",
        "method",
        "decision",
        "deadlineMono",
      ];
      const remaining = frame.deadlineMono - mono();
      const follower = followers.get(frame.attemptId);
      let binding;
      try {
        binding = checkedBinding(frame.binding);
      } catch {}
      if (
        !approvalGate ||
        !exact(frame, expected) ||
        !UUID.test(frame.actionId ?? "") ||
        !Number.isSafeInteger(frame.deadlineMono) ||
        remaining <= 0 ||
        remaining > TTL ||
        pending.size >= MAX_PENDING ||
        !follower ||
        !binding ||
        bindingKey(binding) !== bindingKey(follower.binding) ||
        !followerLive(follower) || !safeBinding(binding)
      ) {
        reply(frame.requestId, false, { code: "denied" });
        return;
      }
      const controller = new AbortController();
      const entry = { controller, attemptId: frame.attemptId, timer: null };
      const finish = (ok, code) => {
        if (pending.get(frame.requestId) !== entry) return;
        pending.delete(frame.requestId);
        clearTimeout(entry.timer);
        if (!disposed) {
          try {
            reply(frame.requestId, ok, ok ? {} : { code });
          } catch {
            close();
          }
        }
      };
      entry.finish = finish;
      pending.set(frame.requestId, entry);
      entry.timer = setTimeout(() => controller.abort(), remaining);
      entry.timer.unref?.();
      const action = {
        binding,
        attemptId: frame.attemptId,
        actionId: frame.actionId,
        requestId: frame.approvalRequestId,
        turnId: frame.turnId,
        itemId: frame.itemId,
        method: frame.method,
        decision: frame.decision,
        signal: controller.signal,
        deadline: performance.now() + remaining,
      };
      try {
        // The gate performs the last synchronous owner check and actual write.
        const promise = approvalGate.reply(action);
        Promise.resolve(promise).then(
          () => finish(true),
          (error) =>
            finish(
              false,
              error?.code === "SHARED_APPROVAL_OUTCOME_UNKNOWN"
                ? "unknown"
                : "denied",
            ),
        );
      } catch (error) {
        finish(
          false,
          error?.code === "SHARED_APPROVAL_OUTCOME_UNKNOWN"
            ? "unknown"
            : "denied",
        );
      }
      return;
    }
    if (frame.type === "shared-exchange") {
      if (
        !exact(frame, [
          "v",
          "type",
          "profileId",
          "generation",
          "requestId",
          "frame",
        ]) ||
        !obj(frame.frame) ||
        !rpcId(frame.frame.id) ||
        typeof gate.receive !== "function" ||
        rpcByRequest.size >= MAX_PENDING ||
        rpcById.has(rpcKey(frame.frame.id))
      ) {
        reply(frame.requestId, false, { code: "denied" });
        return;
      }
      const attemptEntry =
        frame.frame.method === "thread/resume"
          ? Array.from(attempts).find(
              ([, attempt]) => attempt.idKey === rpcKey(frame.frame.id),
            )
          : undefined;
      const value = {
        requestId: frame.requestId,
        idKey: rpcKey(frame.frame.id),
        frame: frame.frame,
        attemptId: attemptEntry?.[0],
        attempt: attemptEntry?.[1],
        timer: null,
        buffer: undefined,
        offset: 0,
        sequence: 0,
        awaiting: null,
      };
      value.timer = setTimeout(close, TTL);
      value.timer.unref?.();
      rpcByRequest.set(value.requestId, value);
      rpcById.set(value.idKey, value);
      try {
        if (!safeDelivery(value)) throw denied();
        if (value.attempt) value.attempt.dispatched = true;
        gate.write(JSON.stringify(frame.frame));
      } catch (error) {
        if (value.attempt) value.attempt.dispatched = false;
        dropRpc(value);
        reply(frame.requestId, false, {
          code:
            error?.code === "SHARED_DAEMON_OUTCOME_UNKNOWN"
              ? "unknown"
              : "denied",
        });
      }
      return;
    }
    if (frame.type === "shared-dispatch") {
      if (
        !exact(frame, [
          "v",
          "type",
          "profileId",
          "generation",
          "requestId",
          "frame",
        ]) ||
        !obj(frame.frame)
      ) {
        reply(frame.requestId, false, { code: "denied" });
        return;
      }
      try {
        gate.write(JSON.stringify(frame.frame));
        reply(frame.requestId, true);
      } catch (error) {
        reply(frame.requestId, false, {
          code:
            error?.code === "SHARED_DAEMON_OUTCOME_UNKNOWN"
              ? "unknown"
              : "denied",
        });
      }
      return;
    }
    throw denied();
  }
  transport = channel(socket, handle, close);
  return Object.freeze({
    close,
    receiveDaemon,
    registerCreatedFollow,
    verifyConnectedThreadSync(threadId) {
      if (disposed || !UUID.test(threadId ?? "")) return false;
      for (const follower of followers.values())
        if (follower.binding.threadId === threadId && followerLive(follower) && safeBinding(follower.binding)) return true;
      // A native task may request its tools while its explicitly requested
      // resume reply is still in flight. Only an actual guarded dispatch, not
      // a binding or catalog entry, can authorize that pending interval.
      for (const attempt of attempts.values()) {
        try {
          if (attempt.binding.threadId === threadId && attempt.dispatched === true &&
              attempt.nativeRejected !== true && !attempt.controller.signal.aborted &&
              performance.now() < attempt.deadline && safeBinding(attempt.binding) &&
              verifyHistorySync?.(attempt.binding) === true) return true;
        } catch {}
      }
      return false;
    },
    get busy() {
      return (
        pending.size > 0 ||
        attempts.size > 0 ||
        createdFollows.size > 0 ||
        rpcByRequest.size > 0 ||
        !!activeEvent ||
        eventQueue.length > 0 ||
        backlog.length > 0
      );
    },
  });
}

function createSharedThreadAuthorityClient(options = {}) {
  const { socket, profileId, generation, onEvent = () => {}, memoryBudget } = options;
  if (
    !UUID.test(profileId ?? "") ||
    !UUID.test(generation ?? "") ||
    typeof onEvent !== "function"
  )
    throw denied();
  const memory = memoryOwner(memoryBudget);
  const pending = new Map(),
    attempts = new Map(),
    incomingEvents = new Map();
  let disposed = false,
    transport,
    rpcBuffered = 0;
  function close() {
    if (disposed) return;
    disposed = true;
    for (const value of pending.values()) {
      clearTimeout(value.timer);
      value.signal?.removeEventListener("abort", value.abort);
      value.parts = undefined;
      value.reject(
        value.exchange || value.approval
          ? failure("SHARED_DAEMON_OUTCOME_UNKNOWN")
          : denied(),
      );
    }
    pending.clear();
    for (const value of incomingEvents.values()) clearTimeout(value.timer);
    incomingEvents.clear();
    memory.clear();
    rpcBuffered = 0;
    for (const value of attempts.values())
      value.signal.removeEventListener("abort", value.abort);
    attempts.clear();
    transport?.close();
  }
  function handle(frame) {
    if (
      obj(frame) &&
      scoped(frame, profileId, generation) &&
      frame.type === "shared-event-chunk"
    ) {
      if (
        !exact(frame, [
          "v",
          "type",
          "profileId",
          "generation",
          "requestId",
          "sequence",
          "final",
          "data",
          "attemptId",
          "binding",
          "eventId",
          "deliveryCount",
        ]) ||
        !UUID.test(frame.requestId ?? "") ||
        !UUID.test(frame.attemptId ?? "") ||
        !UUID.test(frame.eventId ?? "") ||
        !Number.isSafeInteger(frame.deliveryCount) || frame.deliveryCount < 1 || frame.deliveryCount > 32 ||
        !Number.isSafeInteger(frame.sequence) ||
        frame.sequence < 1 ||
        typeof frame.final !== "boolean" ||
        typeof frame.data !== "string"
      )
        throw denied();
      const binding = checkedBinding(frame.binding);
      let value = incomingEvents.get(frame.requestId);
      if (!value) {
        if (frame.sequence !== 1 || incomingEvents.size >= MAX_PENDING)
          throw denied();
        value = {
          binding,
          attemptId: frame.attemptId,
          eventId: frame.eventId,
          deliveryCount: frame.deliveryCount,
          next: 1,
          bytes: 0,
          parts: [],
          timer: setTimeout(close, TTL),
        };
        value.timer.unref?.();
        incomingEvents.set(frame.requestId, value);
      }
      if (
        frame.sequence !== value.next ||
        frame.attemptId !== value.attemptId ||
        frame.eventId !== value.eventId ||
        frame.deliveryCount !== value.deliveryCount ||
        bindingKey(binding) !== bindingKey(value.binding)
      )
        throw denied();
      const bytes = Buffer.from(frame.data, "base64");
      if (
        !bytes.length ||
        bytes.length > RPC_CHUNK_BYTES ||
        bytes.toString("base64") !== frame.data ||
        value.bytes + bytes.length > MAX_QUEUED ||
        rpcBuffered + bytes.length > MAX_RPC_BYTES
      )
        throw denied();
      memory.reserve(bytes.length);
      value.parts.push(bytes);
      value.bytes += bytes.length;
      rpcBuffered += bytes.length;
      value.next++;
      if (frame.final) {
        const encoded = new TextDecoder("utf-8", { fatal: true }).decode(
          Buffer.concat(value.parts, value.bytes),
        );
        const event = JSON.parse(encoded);
        if (
          !obj(event) ||
          typeof event.method !== "string" ||
          !obj(event.params) ||
          event.params.threadId !== binding.threadId
        )
          throw denied();
        const result = onEvent(binding, frame.attemptId, event, frame.eventId, frame.deliveryCount);
        if (result && typeof result.then === "function") throw denied();
      }
      transport.send({
        v: 1,
        type: "shared-event-ack",
        profileId,
        generation,
        requestId: frame.requestId,
        sequence: frame.sequence,
      });
      if (frame.final) {
        incomingEvents.delete(frame.requestId);
        clearTimeout(value.timer);
        memory.release(value.bytes);
        rpcBuffered -= value.bytes;
        value.parts = undefined;
      }
      return;
    }
    if (
      obj(frame) &&
      scoped(frame, profileId, generation) &&
      frame.type === "shared-rpc-chunk"
    ) {
      if (
        !exact(frame, [
          "v",
          "type",
          "profileId",
          "generation",
          "requestId",
          "sequence",
          "final",
          "data",
        ]) ||
        !UUID.test(frame.requestId ?? "") ||
        !Number.isSafeInteger(frame.sequence) ||
        frame.sequence < 1 ||
        typeof frame.final !== "boolean" ||
        typeof frame.data !== "string"
      )
        throw denied();
      const value = pending.get(frame.requestId);
      if (!value?.exchange || frame.sequence !== value.nextSequence)
        throw denied();
      const bytes = Buffer.from(frame.data, "base64");
      if (
        !bytes.length ||
        bytes.length > RPC_CHUNK_BYTES ||
        bytes.toString("base64") !== frame.data ||
        value.bytes + bytes.length > MAX_RPC_BYTES ||
        rpcBuffered + bytes.length > MAX_RPC_BYTES
      )
        throw denied();
      memory.reserve(bytes.length);
      value.parts.push(bytes);
      value.bytes += bytes.length;
      rpcBuffered += bytes.length;
      value.nextSequence++;
      let encoded;
      if (frame.final) {
        encoded = new TextDecoder("utf-8", { fatal: true }).decode(
          Buffer.concat(value.parts, value.bytes),
        );
        const response = JSON.parse(encoded);
        if (
          !obj(response) ||
          response.id !== value.expectedId ||
          Object.hasOwn(response, "result") === Object.hasOwn(response, "error")
        )
          throw denied();
      }
      transport.send({
        v: 1,
        type: "shared-rpc-ack",
        profileId,
        generation,
        requestId: frame.requestId,
        sequence: frame.sequence,
      });
      if (frame.final) {
        pending.delete(frame.requestId);
        clearTimeout(value.timer);
        memory.release(value.bytes);
        rpcBuffered -= value.bytes;
        value.parts = undefined;
        value.resolve({ ok: true, encoded });
      }
      return;
    }
    if (
      !obj(frame) ||
      !scoped(frame, profileId, generation) ||
      frame.type !== "shared-reply" ||
      !UUID.test(frame.requestId ?? "") ||
      typeof frame.ok !== "boolean"
    )
      throw denied();
    const value = pending.get(frame.requestId);
    if (!value) throw denied();
    if (value.exchange && frame.ok) throw denied();
    const fields = frame.ok
      ? value.binding
        ? ["v", "type", "profileId", "generation", "requestId", "ok", "binding"]
        : ["v", "type", "profileId", "generation", "requestId", "ok"]
      : ["v", "type", "profileId", "generation", "requestId", "ok", "code"];
    if (
      !exact(frame, fields) ||
      (!frame.ok && !["denied", "unknown"].includes(frame.code))
    )
      throw denied();
    pending.delete(frame.requestId);
    clearTimeout(value.timer);
    value.signal?.removeEventListener("abort", value.abort);
    if (value.exchange) {
      memory.release(value.bytes);
      rpcBuffered -= value.bytes;
      value.parts = undefined;
    }
    value.resolve(frame);
  }
  function request(
    type,
    details,
    {
      binding = false,
      timeout = TTL,
      signal,
      exchange = false,
      approval = false,
      expectedId,
    } = {},
  ) {
    if (
      disposed ||
      pending.size >= MAX_PENDING ||
      !Number.isFinite(timeout) ||
      timeout <= 0 ||
      timeout > TTL ||
      (signal !== undefined &&
        (!(signal instanceof AbortSignal) ||
          signal.aborted ||
          (!binding && !approval)))
    )
      throw denied();
    const requestId = randomUUID();
    let resolve, reject;
    const result = new Promise((a, b) => {
      resolve = a;
      reject = b;
    });
    const timer = setTimeout(
      () => {
        const value = pending.get(requestId);
        if (value && pending.delete(requestId)) {
          value.signal?.removeEventListener("abort", value.abort);
          reject(
            value.exchange || value.approval
              ? failure("SHARED_DAEMON_OUTCOME_UNKNOWN")
              : denied(),
          );
          close();
        }
      },
      Math.max(1, Math.ceil(timeout)),
    );
    timer.unref?.();
    const abort = () => {
      try {
        transport.send({
          v: 1,
          type: "shared-cancel-binding",
          profileId,
          generation,
          requestId,
        });
      } catch {
        close();
      }
    };
    pending.set(requestId, {
      resolve,
      reject,
      timer,
      binding,
      signal,
      abort,
      exchange,
      approval,
      expectedId,
      nextSequence: 1,
      bytes: 0,
      parts: exchange ? [] : undefined,
    });
    try {
      transport.send({
        v: 1,
        type,
        profileId,
        generation,
        requestId,
        ...details,
      });
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
    } catch (error) {
      pending.delete(requestId);
      signal?.removeEventListener("abort", abort);
      clearTimeout(timer);
      reject(error);
      close();
    }
    return result;
  }
  async function resolveBinding(
    { viewId, hostId, threadId, sourceToken } = {},
    control = {},
  ) {
    if (!UUID.test(viewId ?? "") || !UUID.test(threadId ?? "") || !atom(hostId) ||
        (sourceToken !== undefined && (typeof sourceToken !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(sourceToken))))
      throw denied();
    const timeout =
      control.deadline === undefined
        ? TTL
        : control.deadline - performance.now();
    const response = await request(
      "shared-authorize",
      { operation: "bind", viewId, hostId, threadId, ...(sourceToken === undefined ? {} : {sourceToken}) },
      { binding: true, timeout, signal: control.signal },
    );
    if (control.signal?.aborted) throw denied();
    if (!response.ok) throw denied();
    const binding = checkedBinding(response.binding);
    if (
      binding.viewId !== viewId ||
      binding.hostId !== hostId ||
      binding.threadId !== threadId ||
      binding.runtimeGeneration !== generation
    )
      throw denied();
    return binding;
  }
  async function authorizeRequest(binding, frame, control) {
    const checked = checkedBinding(binding),
      signal = control?.signal,
      deadline = control?.deadline,
      attemptId = control?.attemptId;
    if (
      disposed ||
      !UUID.test(attemptId ?? "") ||
      !(signal instanceof AbortSignal) ||
      signal.aborted ||
      attempts.has(attemptId) ||
      attempts.size >= MAX_PENDING ||
      !Number.isFinite(deadline) ||
      deadline <= performance.now() ||
      deadline - performance.now() > TTL ||
      !obj(frame)
    )
      return false;
    const remaining = deadline - performance.now(),
      deadlineMono = Math.floor(mono() + remaining);
    const abort = () => {
      const value = attempts.get(attemptId);
      if (!value) return;
      attempts.delete(attemptId);
      signal.removeEventListener("abort", abort);
      try {
        transport.send({
          v: 1,
          type: "shared-cancel",
          profileId,
          generation,
          attemptId,
        });
      } catch {
        close();
      }
    };
    attempts.set(attemptId, { signal, abort });
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) {
      abort();
      return false;
    }
    let response;
    try {
      response = await request(
        "shared-authorize",
        {
          operation: "request",
          binding: checked,
          attemptId,
          frame,
          deadlineMono,
        },
        { timeout: remaining },
      );
    } catch {
      abort();
      return false;
    }
    if (signal.aborted || performance.now() >= deadline) {
      abort();
      return false;
    }
    if (!response.ok) {
      const value = attempts.get(attemptId);
      if (value) {
        attempts.delete(attemptId);
        signal.removeEventListener("abort", abort);
      }
      return false;
    }
    return true;
  }
  async function replyApproval(action, control = {}) {
    const checked = checkedBinding(action?.binding);
    const remaining = control.deadline - performance.now();
    if (
      !UUID.test(action?.attemptId ?? "") ||
      !UUID.test(action?.actionId ?? "") ||
      !(control.signal instanceof AbortSignal) ||
      control.signal.aborted ||
      !Number.isFinite(remaining) ||
      remaining <= 0 ||
      remaining > TTL
    )
      throw denied();
    const response = await request(
      "shared-approval",
      {
        binding: checked,
        attemptId: action.attemptId,
        actionId: action.actionId,
        approvalRequestId: action.requestId,
        turnId: action.turnId,
        itemId: action.itemId,
        method: action.method,
        decision: action.decision,
        deadlineMono: Math.floor(mono() + remaining),
      },
      { approval: true, timeout: remaining, signal: control.signal },
    );
    if (!response.ok)
      throw response.code === "unknown"
        ? failure("SHARED_DAEMON_OUTCOME_UNKNOWN")
        : denied();
    return Object.freeze({ state: "resolved" });
  }
  async function dispatchRequest(frame) {
    if (!obj(frame)) throw denied();
    const response = await request("shared-dispatch", { frame });
    if (!response.ok && response.code === "unknown")
      throw failure("SHARED_DAEMON_OUTCOME_UNKNOWN");
    return response.ok;
  }
  async function exchangeRequest(frame) {
    if (!obj(frame) || !rpcId(frame.id)) throw denied();
    const response = await request(
      "shared-exchange",
      { frame },
      { exchange: true, expectedId: frame.id },
    );
    if (!response.ok)
      throw response.code === "unknown"
        ? failure("SHARED_DAEMON_OUTCOME_UNKNOWN")
        : denied();
    return response.encoded;
  }
  async function follow(_binding, control = {}) {
    if (
      !UUID.test(control.attemptId ?? "") ||
      !(control.signal instanceof AbortSignal) ||
      control.signal.aborted ||
      !Number.isFinite(control.deadline)
    )
      return false;
    const remaining = control.deadline - performance.now();
    if (remaining <= 0 || remaining > TTL) return false;
    const response = await request(
      "shared-follow",
      { attemptId: control.attemptId },
      { timeout: remaining },
    );
    return (
      response.ok === true &&
      !control.signal.aborted &&
      performance.now() < control.deadline
    );
  }
  function unfollow(attemptId) {
    if (disposed || !UUID.test(attemptId ?? "")) return;
    try {
      transport.send({
        v: 1,
        type: "shared-unfollow",
        profileId,
        generation,
        attemptId,
      });
    } catch {
      close();
    }
  }
  transport = channel(socket, handle, close);
  return Object.freeze({
    resolveBinding,
    authorizeRequest,
    replyApproval,
    dispatchRequest,
    exchangeRequest,
    follow,
    unfollow,
    close,
    get active() {
      return !disposed && transport.active;
    },
  });
}
module.exports = {
  createSharedThreadAuthorityServer,
  createSharedThreadAuthorityClient,
  createSharedAuthorityMemoryBudget,
};
