"use strict";
const { randomUUID } = require("node:crypto");
const { performance } = require("node:perf_hooks");
const { posix } = require("node:path");
const {copySharedNativePermissionFields} = require("./shared-permissions-schema.cjs");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const plain = x => x !== null && typeof x === "object" && !Array.isArray(x);
const exact = (x, keys) => plain(x) && Object.keys(x).sort().join(",") === [...keys].sort().join(",");
const atom = x => typeof x === "string" && x.length > 0 && x.length <= 256 && !/[\x00-\x1f\x7f]/.test(x);
const cwd = x => typeof x === "string" && x.length <= 4096 && !/[\x00-\x1f\x7f]/.test(x) && posix.isAbsolute(x) && posix.normalize(x) === x;
const targetValid = x => exact(x, ["hostId", "projectId", "cwd", "viewId"]) && x.hostId === "kanban-shared-cli" && atom(x.projectId) && cwd(x.cwd) && UUID.test(x.viewId ?? "");
const scopeValid = x => exact(x, ["hostId", "runtimeGeneration", "daemonGeneration", "accountRevision", "projectId", "cwd", "viewId", "creationNonce"]) &&
  x.hostId === "kanban-shared-cli" && atom(x.projectId) && cwd(x.cwd) && Number.isSafeInteger(x.accountRevision) && x.accountRevision >= 0 &&
  [x.runtimeGeneration, x.daemonGeneration, x.viewId, x.creationNonce].every(v => UUID.test(v ?? ""));
const requestValid = x => {
 try {
  if (!plain(x) || !Object.keys(x).every(k=>["id","method","params","jsonrpc"].includes(k)) || !(atom(x.id) || Number.isSafeInteger(x.id)&&x.id>=0) || x.method!=="thread/start" || !plain(x.params) || !cwd(x.params.cwd) || !Object.keys(x.params).every(k=>["cwd","model","config","approvalPolicy","approvalsReviewer","permissions","sandbox","runtimeWorkspaceRoots"].includes(k)) || x.jsonrpc!==undefined&&x.jsonrpc!=="2.0") return false;
  const fields=copySharedNativePermissionFields(x.params,{cwd:x.params.cwd,kind:"start"}),config=x.params.config;
  if (x.params.model!==undefined&&!atom(x.params.model)) return false;
  if (config!==undefined&&(!plain(config)||!Object.keys(config).length||!Object.keys(config).every(k=>k==="model_reasoning_effort"||Object.hasOwn(fields.config??{},k))||config.model_reasoning_effort!==undefined&&(!atom(x.params.model)||!atom(config.model_reasoning_effort)))) return false;
  return true;
 } catch { return false; }
};
const bindingValid = x => exact(x, ["hostId", "runtimeGeneration", "daemonGeneration", "accountRevision", "projectId", "threadId", "viewId", "clientId"]) &&
  x.hostId === "kanban-shared-cli" && atom(x.projectId) && Number.isSafeInteger(x.accountRevision) && x.accountRevision >= 0 &&
  [x.runtimeGeneration, x.daemonGeneration, x.threadId, x.viewId, x.clientId].every(v => UUID.test(v ?? ""));
const fail = code => Object.assign(new Error("Shared creation control unavailable"), { code });
const denied = () => fail("SHARED_CREATE_DENIED"), unknown = () => fail("SHARED_DAEMON_OUTCOME_UNKNOWN");
// Fixed negative phases only: never include native parameters or host errors.
const failureCodes = new Set(["SHARED_CREATE_DENIED", "SHARED_DAEMON_OUTCOME_UNKNOWN",
  "SHARED_CREATE_NATIVE_REQUEST_INVALID", "SHARED_CREATE_NATIVE_CONTROL_INVALID",
  "SHARED_CREATE_HOST_SCOPE_DENIED", "SHARED_CREATE_HOST_AUTHORIZE_DENIED", "SHARED_CREATE_HOST_RESULT_INVALID"]);
const envelope = ["v", "type", "profileId", "generation", "id"];
function dataValid(op, data) {
  if (op === "scope") return exact(data, ["target", "attemptId"]) && targetValid(data.target) && UUID.test(data.attemptId ?? "");
  if (op === "authorize") return exact(data, ["scope", "frame"]) && scopeValid(data.scope) && requestValid(data.frame) && data.frame.params.cwd === data.scope.cwd;
  return op === "binding" && exact(data, ["scope", "threadId"]) && scopeValid(data.scope) && UUID.test(data.threadId ?? "");
}
function resultValid(op, data) { return op === "scope" ? scopeValid(data) : op === "authorize" ? data === true : op === "binding" && bindingValid(data); }
function isSharedThreadCreationFrame(frame, { side, profileId, generation } = {}) {
  try {
    if (!plain(frame) || frame.v !== 1 || frame.profileId !== profileId || frame.generation !== generation || !UUID.test(frame.id ?? "") || Buffer.byteLength(JSON.stringify(frame)) > 64 * 1024) return false;
    if (side === "host") {
      if (frame.type === "shared-create-cancel") return exact(frame, envelope);
      return frame.type === "shared-create-request" && exact(frame, [...envelope, "op", "data"]) && dataValid(frame.op, frame.data);
    }
    return side === "native" && frame.type === "shared-create-reply" && exact(frame, [...envelope, "op", "ok", ...(frame.ok === true ? ["data"] : ["code"])]) &&
      ["scope", "authorize", "binding"].includes(frame.op) && typeof frame.ok === "boolean" &&
      (frame.ok ? resultValid(frame.op, frame.data) : failureCodes.has(frame.code));
  } catch { return false; }
}
function common(options) {
  if (![options.profileId, options.generation].every(x => UUID.test(x ?? "")) ||
      [options.verifyCurrentSync, options.sendFrame].some(x => typeof x !== "function")) throw denied();
}

// Only the already-owned native <-> host channel may carry these frames.
// There are three fixed operations, no arbitrary RPC, URL, port or config path.
function createNativeSharedThreadCreationClient(options = {}) {
  common(options);
  const { profileId, generation, verifyCurrentSync, sendFrame } = options, pending = new Map(), leases = new Map();
  let closed = false;
  const current = () => { try { return !closed && verifyCurrentSync() === true; } catch { return false; } };
  function finish(id, error, data) {
    const value = pending.get(id) ?? leases.get(id); if (!value) return;
    if (!error && value.op === "authorize" && data === true && pending.has(id)) { pending.delete(id); leases.set(id, value); value.resolve(data); return; }
    pending.delete(id); leases.delete(id); clearTimeout(value.timer); value.signal.removeEventListener("abort", value.abort);
    error ? value.reject(error) : value.resolve(data);
  }
  function request(op, data, control) {
    if (!current()) return Promise.reject(denied());
    if (!dataValid(op, data)) return Promise.reject(fail("SHARED_CREATE_NATIVE_REQUEST_INVALID"));
    if (!control || !(control.signal instanceof AbortSignal) || control.signal.aborted ||
        !Number.isFinite(control.deadline) || control.deadline <= performance.now() || control.deadline - performance.now() > 30_000) return Promise.reject(fail("SHARED_CREATE_NATIVE_CONTROL_INVALID"));
    if (pending.size + leases.size >= 16) return Promise.reject(denied());
    const id = randomUUID(), frame = { v: 1, type: "shared-create-request", profileId, generation, id, op, data: JSON.parse(JSON.stringify(data)) };
    return new Promise((resolve, reject) => {
      const abort = () => {
        try { if (current()) void Promise.resolve(sendFrame({ v: 1, type: "shared-create-cancel", profileId, generation, id })).catch(() => {}); } catch {}
        finish(id, op === "binding" ? unknown() : denied());
      };
      const value = { op, data: frame.data, signal: control.signal, resolve, reject, abort, timer: setTimeout(abort, Math.max(1, Math.ceil(control.deadline - performance.now()))) };
      value.timer.unref?.(); pending.set(id, value); control.signal.addEventListener("abort", abort, { once: true });
      try { Promise.resolve(sendFrame(frame)).catch(() => finish(id, op === "binding" ? unknown() : denied())); } catch { finish(id, op === "binding" ? unknown() : denied()); }
    });
  }
  function receive(frame) {
    if (!current() || !isSharedThreadCreationFrame(frame, { side: "native", profileId, generation })) return false;
    const value = pending.get(frame.id); if (!value || value.op !== frame.op) return false;
    if (frame.ok) {
      const before = value.data.scope ?? value.data.target, after = frame.data;
      // AppHost project records and server authorization projects have distinct
      // IDs. Only scope establishment maps the exact owned cwd to its fixed
      // server project. Every later operation retains that canonical ID.
      if (value.op !== "authorize" && ["hostId", "viewId", ...(value.op === "scope" ? ["cwd"] : ["projectId", "runtimeGeneration", "daemonGeneration", "accountRevision"])].some(k => before[k] !== after[k])) return false;
      if (value.op === "binding" && after.threadId !== value.data.threadId) return false;
      finish(frame.id, null, JSON.parse(JSON.stringify(after)));
    } else finish(frame.id, fail(frame.code));
    return true;
  }
  function close() { for (const value of leases.values()) value.abort(); closed = true; for (const [id, v] of pending) finish(id, v.op === "binding" ? unknown() : denied()); }
  return Object.freeze({ resolveCreateScope: (target, control) => request("scope", { target, attemptId: control?.attemptId }, control),
    authorizeCreate: (scope, frame, control) => request("authorize", { scope, frame }, control),
    resolveCreatedBinding: (scope, threadId, control) => request("binding", { scope, threadId }, control), receive, close });
}

function createHostSharedThreadCreationEndpoint(options = {}) {
  common(options);
  const { profileId, generation, verifyCurrentSync, sendFrame, onScope, onAuthorize, onBinding } = options;
  if ([onScope, onAuthorize, onBinding].some(x => typeof x !== "function")) throw denied();
  const pending = new Map(), used = new Set(); let closed = false;
  const current = () => { try { return !closed && verifyCurrentSync() === true; } catch { return false; } };
  function retire(value, abort = true) { if (pending.get(value.id) === value) pending.delete(value.id); clearTimeout(value.timer); if (abort) value.controller.abort(); }
  function receive(frame) {
    if (!current() || !isSharedThreadCreationFrame(frame, { side: "host", profileId, generation })) return false;
    if (frame.type === "shared-create-cancel") { const value = pending.get(frame.id); if (!value) return false; retire(value); return true; }
    if (pending.size >= 16 || used.size >= 8192 || used.has(frame.id)) return false;
    used.add(frame.id);
    const input = JSON.parse(JSON.stringify(frame)), controller = new AbortController();
    const value = { id: frame.id, viewId: input.data.scope?.viewId ?? input.data.target.viewId, controller, deadline: performance.now() + 30_000, timer: null };
    pending.set(value.id, value); value.timer = setTimeout(() => retire(value), 30_000); value.timer.unref?.();
    void (async () => {
      let reply, returned = false;
      const control = Object.freeze({ signal: controller.signal, deadline: value.deadline, ...(input.op === "scope" ? { attemptId: input.data.attemptId } : {}) });
      try {
        const data = input.op === "scope" ? await onScope(input.data.target, control) : input.op === "authorize" ? await onAuthorize(input.data.scope, input.data.frame, control) : await onBinding(input.data.scope, input.data.threadId, control);
        returned = true;
        if (!resultValid(input.op, data)) throw denied();
        reply = { v: 1, type: "shared-create-reply", profileId, generation, id: input.id, op: input.op, ok: true, data };
      } catch (error) {
        reply = { v: 1, type: "shared-create-reply", profileId, generation, id: input.id, op: input.op, ok: false,
          code: input.op === "binding" || error?.code === "SHARED_DAEMON_OUTCOME_UNKNOWN" ? "SHARED_DAEMON_OUTCOME_UNKNOWN" :
            returned ? "SHARED_CREATE_HOST_RESULT_INVALID" : input.op === "scope" ? "SHARED_CREATE_HOST_SCOPE_DENIED" : "SHARED_CREATE_HOST_AUTHORIZE_DENIED" };
      }
      if (!current() || pending.get(value.id) !== value || controller.signal.aborted || performance.now() >= value.deadline) return;
      if (!isSharedThreadCreationFrame(reply, { side: "native", profileId, generation })) { retire(value); return; }
      try { await sendFrame(reply); } catch {} finally { if (!(input.op === "authorize" && reply.ok)) retire(value, false); }
    })();
    return true;
  }
  function retireView(viewId) { for (const value of pending.values()) if (value.viewId === viewId) retire(value); }
  function close() { closed = true; for (const value of pending.values()) retire(value); }
  return Object.freeze({ receive, retireView, close });
}
module.exports = { isSharedThreadCreationFrame, createNativeSharedThreadCreationClient, createHostSharedThreadCreationEndpoint };
