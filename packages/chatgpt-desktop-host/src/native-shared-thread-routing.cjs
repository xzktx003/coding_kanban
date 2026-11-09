"use strict";

const { AsyncLocalStorage } = require("node:async_hooks");
const { performance } = require("node:perf_hooks");

// These controls establish a per-view causal binding. The separately owned
// daemon adapter must still default-deny unrelated methods and recheck this
// exact authorization at its final socket write; an ACK is not a write receipt.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TTL = 30000,
  MAX_PENDING = 16,
  MAX_USED = 8192;
const denied = () =>
  Object.assign(new Error("Shared thread connection denied"), {
    code: "SHARED_NAV_INTENT_DENIED",
  });
const plain = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const exact = (value, keys) =>
  plain(value) &&
  Object.keys(value).sort().join(",") === keys.slice().sort().join(",");
const atom = (value) =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= 256 &&
  !/[\x00-\x1f\x7f]/.test(value);
const rpcId = (value) =>
  (typeof value === "string" && atom(value)) ||
  (Number.isSafeInteger(value) && value >= 0);
const copyData = (value) => {
  if (
    !plain(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw denied();
  const output = {};
  for (const key of Reflect.ownKeys(value)) {
    if (
      typeof key !== "string" ||
      key === "__proto__" ||
      key === "prototype" ||
      key === "constructor"
    )
      throw denied();
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      !descriptor ||
      !Object.hasOwn(descriptor, "value") ||
      !descriptor.enumerable
    )
      throw denied();
    Object.defineProperty(output, key, {
      value: descriptor.value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return output;
};

function createNativeSharedThreadRouter(options = {}) {
  const {
    profileId,
    generation,
    getRecord,
    getOwnedRecord,
    verifyRuntimeSync,
    resolveBinding,
    verifyBinding,
    verifyBindingSync,
    authorizeRequest,
    sendToView,
    onConnected = async () => true,
    onRetired = () => {},
    requireSourceToken = false,
  } = options;
  if (
    !UUID.test(profileId ?? "") ||
    !UUID.test(generation ?? "") ||
    typeof requireSourceToken !== 'boolean' ||
    [
      getRecord,
      getOwnedRecord,
      verifyRuntimeSync,
      resolveBinding,
      verifyBinding,
      verifyBindingSync,
      authorizeRequest,
      sendToView,
      onConnected,
      onRetired,
    ].some((x) => typeof x !== "function")
  )
    throw denied();
  const lifecycle = new WeakMap(),
    attempts = new Map(),
    contexts = new Set(),
    followers = new Map(),
    seenAttempts = new Set(),
    usedIds = new Set(),
    scope = new AsyncLocalStorage();
  let disposed = false;
  function live(sender, record) {
    try {
      return (
        !disposed &&
        getOwnedRecord(sender) === record &&
        getRecord(record.senderId) === record &&
        record.window?.webContents === sender &&
        record.failed !== true &&
        !record.window.isDestroyed() &&
        !sender.isDestroyed() &&
        verifyRuntimeSync() === true
      );
    } catch {
      return false;
    }
  }
  function sameState(value) {
    return (
      live(value.sender, value.record) &&
      lifecycle.get(value.record) === value.life &&
      value.life.epoch !== null &&
      performance.now() < value.deadline
    );
  }
  function clearAttempt(value) {
    if (attempts.get(value.attemptId) !== value) return;
    attempts.delete(value.attemptId);
    clearTimeout(value.timer);
    value.controller.abort();
  }
  // Cancellation revokes authority immediately, but an unresolved original
  // manager call continues to occupy its budget until it actually settles.
  function abortContext(value) {
    if (value.closed) return;
    value.closed = true;
    clearTimeout(value.timer);
    value.controller.abort();
  }
  function retireRecord(record) {
    for (const value of attempts.values())
      if (value.record === record) clearAttempt(value);
    for (const value of contexts)
      if (value.record === record) abortContext(value);
    for (const value of followers.values())
      if (value.record === record) retireFollower(value);
  }
  function retireFollower(value) {
    if (followers.get(value.attemptId) !== value) return;
    followers.delete(value.attemptId);
    try {
      Promise.resolve(onRetired(value.attemptId)).catch(() => {});
    } catch {}
  }
  function isFollowing(binding, attemptId) {
    const value = followers.get(attemptId);
    return (
      !!value &&
      live(value.sender, value.record) &&
      lifecycle.get(value.record) === value.life &&
      value.life.epoch !== null &&
      JSON.stringify(value.binding) === JSON.stringify(binding)
    );
  }
  function findFollower(sender, target) {
    if (!plain(target)) return null;
    let result = null;
    for (const value of followers.values()) {
      if (
        value.sender !== sender ||
        value.binding.hostId !== target.hostId ||
        value.binding.threadId !== target.threadId ||
        value.binding.viewId !== target.viewId ||
        value.life.sequence !== target.sequence ||
        value.life.epoch !== target.epoch ||
        !isFollowing(value.binding, value.attemptId)
      )
        continue;
      if (result) return null;
      result = Object.freeze({
        binding: value.binding,
        attemptId: value.attemptId,
      });
    }
    return result;
  }
  function state(sender, message) {
    let record;
    try {
      record = getOwnedRecord(sender);
    } catch {
      return false;
    }
    if (
      !record ||
      !live(sender, record) ||
      !exact(message, ["type", "sequence", "epoch"]) ||
      message.type !== "kanban-shared-connect-lifecycle" ||
      !Number.isSafeInteger(message.sequence) ||
      message.sequence < 1 ||
      (message.epoch !== null && !UUID.test(message.epoch ?? ""))
    )
      return false;
    const old = lifecycle.get(record),
      seen = old?.seen ?? new Set();
    if (
      (old && message.sequence <= old.sequence) ||
      (message.epoch !== null && (seen.has(message.epoch) || seen.size >= 4096))
    )
      return false;
    if (message.epoch !== null) seen.add(message.epoch);
    retireRecord(record);
    const current = { sequence: message.sequence, epoch: message.epoch, seen };
    lifecycle.set(record, current);
    try {
      sendToView(record, {
        type: "kanban-shared-connect-lifecycle-ack",
        sequence: current.sequence,
        epoch: current.epoch,
      });
      return true;
    } catch {
      return false;
    }
  }
  function bindingCopy(value, record, hostId, threadId) {
    const keys = [
      "hostId",
      "runtimeGeneration",
      "daemonGeneration",
      "accountRevision",
      "projectId",
      "threadId",
      "viewId",
      "clientId",
    ];
    if (
      !exact(value, keys) ||
      value.hostId !== hostId ||
      value.threadId !== threadId ||
      value.viewId !== record.viewId ||
      !atom(value.projectId) ||
      ![
        value.runtimeGeneration,
        value.daemonGeneration,
        value.threadId,
        value.viewId,
        value.clientId,
      ].every((x) => UUID.test(x ?? "")) ||
      !Number.isSafeInteger(value.accountRevision) ||
      value.accountRevision < 0
    )
      throw denied();
    return Object.freeze(
      Object.fromEntries(keys.map((key) => [key, value[key]])),
    );
  }
  function verify(value) {
    try {
      return (
        sameState(value) &&
        value.binding &&
        verifyBindingSync(value.binding) === true
      );
    } catch {
      return false;
    }
  }
  function bounded(promise, controller, deadline) {
    Promise.resolve(promise).catch(() => {});
    if (controller.signal.aborted || performance.now() >= deadline)
      return Promise.reject(denied());
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (error, value) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        controller.signal.removeEventListener("abort", onAbort);
        error ? reject(error) : resolve(value);
      };
      const onAbort = () => finish(denied());
      const timer = setTimeout(
        onAbort,
        Math.max(1, Math.ceil(deadline - performance.now())),
      );
      controller.signal.addEventListener("abort", onAbort, { once: true });
      if (controller.signal.aborted) return onAbort();
      Promise.resolve(promise).then(
        (value) => finish(null, value),
        () => finish(denied()),
      );
    });
  }
  async function intent(sender, message) {
    let record;
    try {
      record = getOwnedRecord(sender);
    } catch {
      return false;
    }
    const life = record && lifecycle.get(record);
    const keys = [
      "type",
      "v",
      "action",
      "attemptId",
      "profileId",
      "generation",
      "viewId",
      "hostId",
      "threadId",
      "sequence",
      "epoch",
      ...(requireSourceToken ? ["sourceToken"] : []),
    ];
    if (
      !record ||
      !live(sender, record) ||
      !life ||
      life.epoch === null ||
      !exact(message, keys) ||
      message.type !== "kanban-shared-connect-intent" ||
      message.v !== 1 ||
      message.action !== "connect" ||
      message.profileId !== profileId ||
      message.generation !== generation ||
      message.viewId !== record.viewId ||
      !atom(message.hostId) ||
      !UUID.test(message.threadId ?? "") ||
      !UUID.test(message.attemptId ?? "") ||
      (requireSourceToken && (typeof message.sourceToken !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(message.sourceToken))) ||
      message.sequence !== life.sequence ||
      message.epoch !== life.epoch ||
      attempts.size + contexts.size >= MAX_PENDING ||
      seenAttempts.size >= MAX_USED ||
      seenAttempts.has(message.attemptId)
    )
      return false;
    seenAttempts.add(message.attemptId);
    const value = {
      record,
      sender,
      life,
      attemptId: message.attemptId,
      hostId: message.hostId,
      threadId: message.threadId,
      ...(requireSourceToken ? {sourceToken: message.sourceToken} : {}),
      deadline: performance.now() + TTL,
      controller: new AbortController(),
      binding: null,
      ready: false,
      timer: null,
    };
    attempts.set(value.attemptId, value);
    value.timer = setTimeout(() => clearAttempt(value), TTL);
    value.timer.unref?.();
    let accepted = false;
    try {
      const binding = await bounded(
        Promise.resolve().then(() =>
          resolveBinding(
            record,
            { hostId: value.hostId, threadId: value.threadId, ...(requireSourceToken ? {sourceToken:value.sourceToken} : {}) },
            { signal: value.controller.signal, deadline: value.deadline },
          ),
        ),
        value.controller,
        value.deadline,
      );
      value.binding = bindingCopy(
        binding,
        record,
        value.hostId,
        value.threadId,
      );
      if (
        !verify(value) ||
        (await bounded(
          Promise.resolve().then(() => verifyBinding(value.binding)),
          value.controller,
          value.deadline,
        )) !== true ||
        !verify(value)
      )
        throw denied();
      value.ready = true;
      accepted = true;
    } catch {}
    if (sameState(value))
      try {
        sendToView(record, {
          type: "kanban-shared-connect-intent-ack",
          attemptId: value.attemptId,
          sequence: life.sequence,
          epoch: life.epoch,
          accepted,
        });
      } catch {
        accepted = false;
      }
    else accepted = false;
    if (!accepted || !verify(value)) {
      clearAttempt(value);
      return false;
    }
    return true;
  }
  async function withResume(sender, hostId, params, invoke) {
    let clean;
    let follower;
    try {
      clean = copyData(params);
    } catch {
      throw denied();
    }
    const attemptId = clean.__kanbanSharedConnectAttempt;
    delete clean.__kanbanSharedConnectAttempt;
    const value = attempts.get(attemptId);
    if (
      typeof invoke !== "function" ||
      !value ||
      !value.ready ||
      value.sender !== sender ||
      value.hostId !== hostId ||
      clean.conversationId !== value.threadId ||
      !verify(value)
    )
      throw denied();
    attempts.delete(attemptId);
    clearTimeout(value.timer);
    const context = {
      ...value,
      controller: new AbortController(),
      closed: false,
      claimed: false,
      timer: null,
    };
    context.timer = setTimeout(
      () => abortContext(context),
      Math.max(1, Math.ceil(context.deadline - performance.now())),
    );
    context.timer.unref?.();
    contexts.add(context);
    try {
      if (
        (await bounded(
          Promise.resolve().then(() => verifyBinding(context.binding)),
          context.controller,
          context.deadline,
        )) !== true ||
        !verify(context)
      )
        throw denied();
      const result = await scope.run(context, () => invoke(clean));
      if (
        context.closed ||
        context.controller.signal.aborted ||
        !verify(context)
      )
        throw denied();
      if (context.claimed) {
        if (followers.size >= MAX_PENDING || followers.has(context.attemptId))
          throw denied();
        follower = {
          attemptId: context.attemptId,
          record: context.record,
          sender: context.sender,
          life: context.life,
          binding: context.binding,
        };
        followers.set(follower.attemptId, follower);
        const accepted = await bounded(
          onConnected(context.binding, {
            attemptId: context.attemptId,
            signal: context.controller.signal,
            deadline: context.deadline,
          }),
          context.controller,
          context.deadline,
        );
        if (accepted !== true || !verify(context)) throw denied();
      }
      return result;
    } catch (error) {
      if (follower) retireFollower(follower);
      throw error;
    } finally {
      abortContext(context);
      contexts.delete(context);
    }
  }
  async function guardRequest(hostId, frame) {
    if (!plain(frame) || frame.method !== "thread/resume") return frame;
    const value = scope.getStore();
    let request;
    try {
      request = copyData(frame);
    } catch {
      throw denied();
    }
    if (
      !value ||
      value.closed ||
      value.claimed ||
      !verify(value) ||
      hostId !== value.hostId ||
      !rpcId(request.id) ||
      !plain(request.params) ||
      request.params.threadId !== value.threadId ||
      Object.keys(request).some(
        (key) => !["id", "method", "params", "trace"].includes(key),
      )
    )
      throw denied();
    const idKey = `${typeof request.id}:${request.id}`;
    if (usedIds.size >= MAX_USED || usedIds.has(idKey)) throw denied();
    usedIds.add(idKey);
    value.claimed = true;
    const canonical = {
      ...request,
      params: { threadId: value.threadId, excludeTurns: true },
    };
    const control = Object.freeze({
      attemptId: value.attemptId,
      signal: value.controller.signal,
      deadline: value.deadline,
    });
    try {
      const accepted = await bounded(
        Promise.resolve().then(() =>
          authorizeRequest(value.binding, canonical, control),
        ),
        value.controller,
        value.deadline,
      );
      if (
        accepted !== true ||
        !verify(value) ||
        value.controller.signal.aborted ||
        performance.now() >= value.deadline
      )
        throw denied();
      return canonical;
    } catch {
      throw denied();
    }
  }
  // Only the verified explicit resume scope can choose the shared transport.
  // Other traffic keeps the exact original local/remote transport. No thread ID
  // alone is sufficient to authorize a shared request.
  function prepareRequest(hostId, frame) {
    if (!scope.getStore() || !plain(frame) || frame.method !== "thread/resume")
      return Object.freeze({ frame, shared: false });
    return guardRequest(hostId, frame).then((guarded) =>
      Object.freeze({ frame: guarded, shared: true }),
    );
  }
  // Creation has a distinct explicit gesture and real start receipt. It does
  // not resume an empty thread, synthesize a page token, or reuse a connect
  // approval. Only the creation router can mint this one-use causal context.
  async function adoptCreatedBinding(rawBinding, token) {
    const { consumeNativeSharedCreationContext } = require("./native-shared-thread-creation-routing.cjs");
    const source = consumeNativeSharedCreationContext(token, rawBinding);
    if (!source || !UUID.test(source.attemptId ?? "") || seenAttempts.has(source.attemptId) ||
        seenAttempts.size >= MAX_USED || followers.size >= MAX_PENDING || source.signal.aborted ||
        performance.now() >= source.deadline) throw denied();
    const record = getOwnedRecord(source.sender), life = record && lifecycle.get(record);
    if (record !== source.record || !live(source.sender, record) || !life || !life.epoch ||
        life.sequence !== source.sequence || life.epoch !== source.epoch) throw denied();
    const binding = bindingCopy(rawBinding, record, "kanban-shared-cli", rawBinding?.threadId);
    const value = { record, sender: source.sender, life, binding, deadline: source.deadline };
    if (!verify(value)) throw denied();
    seenAttempts.add(source.attemptId);
    const controller = { signal: source.signal };
    if (await bounded(verifyBinding(binding), controller, source.deadline) !== true || !verify(value)) throw denied();
    const follower = { attemptId: source.attemptId, record, sender: source.sender, life, binding };
    followers.set(source.attemptId, follower);
    try {
      if (await bounded(onConnected(binding, { attemptId: source.attemptId, signal: source.signal, deadline: source.deadline }), controller, source.deadline) !== true ||
          !verify(value)) throw denied();
      return true;
    } catch (error) { retireFollower(follower); throw error; }
  }
  function retire(sender) {
    let record;
    try {
      record = getOwnedRecord(sender);
    } catch {}
    if (record) {
      retireRecord(record);
      const value = lifecycle.get(record);
      if (value) lifecycle.set(record, { ...value, epoch: null });
    }
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const value of attempts.values()) clearAttempt(value);
    for (const value of contexts) abortContext(value);
    for (const value of followers.values()) retireFollower(value);
  }
  return Object.freeze({
    lifecycle: state,
    intent,
    withResume,
    guardRequest,
    prepareRequest,
    adoptCreatedBinding,
    isFollowing,
    findFollower,
    retire,
    dispose,
  });
}
module.exports = { createNativeSharedThreadRouter };
