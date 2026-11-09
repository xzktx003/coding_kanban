"use strict";

// Opt-in, daemon-owned tracker. Only actual daemon requests create an entry;
// a view's explicit action must match that immutable entry and its follower.
// This module never opens a socket or constructs a command.
const { createHash } = require("node:crypto");
const { isDeepStrictEqual } = require("node:util");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_USED = 8192,
  MAX_FRAME = 64 * 1024,
  MAX_TRACKED = 8 * 1024 * 1024,
  MAX_TARGETS = 16,
  TARGET_BYTES = 512,
  TTL = 30000;
const methods = new Set([
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
]);
const fields = [
  "hostId",
  "runtimeGeneration",
  "daemonGeneration",
  "accountRevision",
  "projectId",
  "threadId",
  "viewId",
  "clientId",
];
const failure = (code) =>
  Object.assign(new Error("Shared approval unavailable"), { code });
const denied = () => failure("SHARED_APPROVAL_DENIED");
const unknown = () => failure("SHARED_APPROVAL_OUTCOME_UNKNOWN");
const obj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const atom = (v) =>
  typeof v === "string" &&
  v.length > 0 &&
  v.length <= 256 &&
  !/[\x00-\x1f\x7f]/.test(v);
const id = (v) => atom(v) || (Number.isSafeInteger(v) && v >= 0);
const idKey = (v) => `${typeof v}:${v}`;
const equalBinding = (a, b) =>
  obj(a) &&
  obj(b) &&
  Object.keys(a).length === fields.length &&
  Object.keys(b).length === fields.length &&
  fields.every((name) => Object.hasOwn(a, name) && a[name] === b[name]);
const sameExecution = (a, b) =>
  obj(a) && obj(b) &&
  fields.filter((name) => name !== "viewId" && name !== "clientId")
    .every((name) => Object.hasOwn(a, name) && Object.hasOwn(b, name) && a[name] === b[name]);
const jsonCopy = (v) => JSON.parse(JSON.stringify(v));
const oneKey = (v, k) =>
  obj(v) && Object.keys(v).length === 1 && Object.hasOwn(v, k);
function allowedDecision(record, decision) {
  if (["accept", "acceptForSession", "decline", "cancel"].includes(decision))
    return true; // Original reject callback sends decline even when options list cancel.
  if (record.method !== "item/commandExecution/requestApproval") return false;
  if (
    oneKey(decision, "acceptWithExecpolicyAmendment") &&
    oneKey(decision.acceptWithExecpolicyAmendment, "execpolicy_amendment") &&
    record.exec != null &&
    isDeepStrictEqual(
      decision.acceptWithExecpolicyAmendment.execpolicy_amendment,
      record.exec,
    )
  )
    return true;
  if (
    oneKey(decision, "applyNetworkPolicyAmendment") &&
    oneKey(decision.applyNetworkPolicyAmendment, "network_policy_amendment") &&
    Array.isArray(record.network) &&
    record.network.some((x) =>
      isDeepStrictEqual(
        decision.applyNetworkPolicyAmendment.network_policy_amendment,
        x,
      ),
    )
  )
    return true;
  return false;
}
function createSharedApprovalGate({
  verifyBindingSync,
  verifyHistorySync,
  write,
} = {}) {
  if (
    [verifyBindingSync, verifyHistorySync, write].some(
      (f) => typeof f !== "function",
    )
  )
    throw denied();
  const requests = new Map(),
    usedActions = new Set();
  let closed = false,
    trackedBytes = 0;
  function readable(binding) {
    try { return !closed && verifyHistorySync(binding) === true; } catch { return false; }
  }
  function live(binding) {
    try { return readable(binding) && verifyBindingSync(binding) === true && readable(binding); } catch { return false; }
  }
  function finish(record, error) {
    if (!record.pending) return;
    const value = record.pending;
    record.pending = null;
    clearTimeout(value.timer);
    value.signal.removeEventListener("abort", value.abort);
    if (error) value.reject(error);
    else value.resolve(Object.freeze({ state: "resolved" }));
  }
  function observe(binding, attemptId, frame) {
    if (
      closed ||
      !UUID.test(attemptId ?? "") ||
      !readable(binding) ||
      !obj(frame) ||
      !methods.has(frame.method) ||
      !id(frame.id) ||
      !obj(frame.params) ||
      frame.params.threadId !== binding.threadId ||
      !atom(frame.params.turnId) ||
      !atom(frame.params.itemId)
    )
      return false;
    let encoded, metadata, cost;
    try {
      encoded = JSON.stringify(frame);
      if (Buffer.byteLength(encoded) > MAX_TRACKED) return false;
      const text = JSON.stringify({
        exec: frame.params.proposedExecpolicyAmendment,
        network: frame.params.proposedNetworkPolicyAmendments,
      });
      cost = Buffer.byteLength(text) + 1024;
      if (cost > MAX_FRAME) return false;
      metadata = JSON.parse(text);
    } catch {
      return false;
    }
    const key = idKey(frame.id),
      hash = createHash("sha256").update(encoded).digest("hex"),
      prior = requests.get(key);
    if (prior) {
      if (prior.fingerprint !== hash || !sameExecution(prior.binding, binding)) return false;
      const target = prior.targets.get(attemptId);
      if (target) return equalBinding(target.binding, binding);
      if (prior.state !== "pending" || prior.targets.size >= MAX_TARGETS ||
          trackedBytes + TARGET_BYTES > MAX_TRACKED) return false;
      prior.targets.set(attemptId, { binding: Object.freeze({ ...binding }), charged: TARGET_BYTES });
      trackedBytes += TARGET_BYTES;
      return true;
    }
    if (requests.size >= MAX_USED || trackedBytes + cost > MAX_TRACKED)
      return false;
    trackedBytes += cost;
    requests.set(key, {
      binding: Object.freeze({ ...binding }),
      targets: new Map([[attemptId, { binding: Object.freeze({ ...binding }), charged: 0 }]]),
      requestId: frame.id,
      threadId: frame.params.threadId,
      turnId: frame.params.turnId,
      itemId: frame.params.itemId,
      method: frame.method,
      fingerprint: hash,
      exec: metadata.exec,
      network: metadata.network,
      state: "pending",
      pending: null,
    });
    return true;
  }
  function observeResolved(frame) {
    if (
      closed ||
      frame?.method !== "serverRequest/resolved" ||
      !obj(frame.params) ||
      !id(frame.params.requestId)
    )
      return false;
    const record = requests.get(idKey(frame.params.requestId));
    if (
      !record ||
      record.threadId !== frame.params.threadId ||
      record.state === "resolved"
    )
      return false;
    const pending = record.state === "dispatched" && record.pending;
    if (
      pending &&
      (!live(record.binding) ||
        pending.signal.aborted ||
        performance.now() >= pending.deadline)
    ) {
      record.state = "unknown";
      finish(record, unknown());
      return true;
    }
    record.state = "resolved";
    if (pending && !record.writing) finish(record);
    return true;
  }
  async function reply(action) {
    if (
      !obj(action) ||
      !UUID.test(action.attemptId ?? "") ||
      !UUID.test(action.actionId ?? "") ||
      !id(action.requestId) ||
      !atom(action.turnId) ||
      !atom(action.itemId) ||
      !(action.signal instanceof AbortSignal) ||
      action.signal.aborted ||
      !Number.isFinite(action.deadline) ||
      action.deadline <= performance.now() ||
      action.deadline - performance.now() > TTL ||
      usedActions.has(action.actionId) ||
      usedActions.size >= MAX_USED
    )
      throw denied();
    const record = requests.get(idKey(action.requestId));
    let decision;
    try {
      decision = jsonCopy(action.decision);
    } catch {
      throw denied();
    }
    if (
      !record ||
      record.state !== "pending" ||
      !equalBinding(record.targets.get(action.attemptId)?.binding, action.binding) ||
      record.turnId !== action.turnId ||
      record.itemId !== action.itemId ||
      record.method !== action.method ||
      !live(action.binding) ||
      !allowedDecision(record, decision)
    )
      throw denied();
    let encoded;
    try {
      encoded = JSON.stringify({ id: record.requestId, result: { decision } });
    } catch {
      throw denied();
    }
    if (Buffer.byteLength(encoded) > MAX_FRAME) throw denied();
    usedActions.add(action.actionId);
    // The view that actually takes the one-use action owns the pending write;
    // later checks and the resolved event must follow this exact identity.
    record.binding = record.targets.get(action.attemptId).binding;
    record.state = "dispatched";
    return await new Promise((resolve, reject) => {
      const abort = () => {
        if (record.pending) record.state = "unknown";
        finish(record, unknown());
      };
      const timer = setTimeout(
        abort,
        Math.max(1, Math.ceil(action.deadline - performance.now())),
      );
      timer.unref?.();
      record.pending = {
        resolve,
        reject,
        signal: action.signal,
        deadline: action.deadline,
        abort,
        timer,
      };
      action.signal.addEventListener("abort", abort, { once: true });
      if (
        action.signal.aborted ||
        performance.now() >= action.deadline ||
        !live(record.binding)
      ) {
        record.state = "pending";
        usedActions.delete(action.actionId);
        finish(record, denied());
        return;
      }
      try {
        // There is no await between the final identity check and socket write.
        record.writing = true;
        const result = write(encoded);
        record.writing = false;
        if (result && typeof result.then === "function") {
          Promise.resolve(result).catch(() => {});
          throw unknown();
        }
        if (
          !live(record.binding) ||
          action.signal.aborted ||
          performance.now() >= action.deadline
        )
          throw unknown();
        if (record.state === "resolved") finish(record);
      } catch {
        record.writing = false;
        if (record.pending) record.state = "unknown";
        finish(record, unknown());
      }
    });
  }
  function retire(attemptId) {
    if (!UUID.test(attemptId ?? "")) return false;
    for (const record of requests.values()) {
      const target = record.targets.get(attemptId);
      if (!target) continue;
      record.targets.delete(attemptId);
      trackedBytes -= target.charged;
    }
    return true;
  }
  function close() {
    if (closed) return;
    closed = true;
    for (const r of requests.values()) {
      if (r.state === "dispatched") r.state = "unknown";
      finish(r, unknown());
    }
    requests.clear();
    usedActions.clear();
    trackedBytes = 0;
  }
  return Object.freeze({ observe, observeResolved, reply, retire, close });
}
module.exports = { createSharedApprovalGate };
