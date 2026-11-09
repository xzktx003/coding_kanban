import { performance } from "node:perf_hooks";
import { createRequire } from "node:module";
const { copySharedNativePermissionFields, verifySharedNativePermissionReply } = createRequire(import.meta.url)("./shared-permissions-schema.cjs");
const { copySharedRpcTrace } = createRequire(import.meta.url)("./shared-rpc-trace-schema.cjs");
import { posix } from "node:path";
import { createHash } from "node:crypto";
import { isSharedNativeModelSelection } from "./shared-native-model-selection.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_PENDING = 16, MAX_USED = 8192;
const invalid = phase => Object.assign(new Error("Shared thread creation denied"), { code: "SHARED_CREATE_DENIED", ...(phase === undefined ? {} : { phase }) });
const unknown = () => Object.assign(new Error("Shared thread creation outcome unknown"), { code: "SHARED_DAEMON_OUTCOME_UNKNOWN" });
const plain = x => x !== null && typeof x === "object" && !Array.isArray(x) && [Object.prototype, null].includes(Object.getPrototypeOf(x));
const keys = (x, names, required = names) => plain(x) && Object.keys(x).every(k => names.includes(k)) && required.every(k => Object.hasOwn(x, k));
const atom = x => typeof x === "string" && x.length > 0 && x.length <= 256 && !/[\x00-\x1f\x7f]/.test(x);
const rpcId = x => atom(x) || (Number.isSafeInteger(x) && x >= 0);
const idKey = x => `${typeof x}:${x}`;
const receiptSources = new WeakMap();
const creationAuthorities = new WeakSet();
const authorityReceipts = new WeakMap();
export const isSharedThreadCreationAuthority = value => creationAuthorities.has(value);
export function takeSharedThreadCreationReceipt(authority, requestId) {
  const receipts = authorityReceipts.get(authority), key = idKey(requestId), receipt = receipts?.get(key);
  if (!receipt) return null; receipts.delete(key); return receipt;
}
export function inspectSharedThreadCreationReceipt(receipt, authority) {
  const source = receiptSources.get(receipt);
  if (!source || source.authority !== authority || !source.current()) return null;
  return Object.freeze({ data: source.data, consumed: source.consumed, binding: source.binding ?? null, deadline: source.deadline });
}
const scopeKeys = ["hostId", "runtimeGeneration", "daemonGeneration", "accountRevision", "projectId", "cwd", "viewId", "creationNonce"];
const bindingKeys = ["hostId", "runtimeGeneration", "daemonGeneration", "accountRevision", "projectId", "threadId", "viewId", "clientId"];
const freezeData = value => {
  if (value && typeof value === "object") { for (const child of Object.values(value)) freezeData(child); Object.freeze(value); }
  return value;
};
function executionCopy(result) {
  const names = ["cwd", "model", "modelProvider", "reasoningEffort", "approvalPolicy", "approvalsReviewer", "sandbox", "activePermissionProfile", "runtimeWorkspaceRoots"];
  const json = JSON.stringify(Object.fromEntries(names.filter(k => Object.hasOwn(result, k)).map(k => [k, result[k]])));
  if (Buffer.byteLength(json) > 64 * 1024) throw unknown();
  return freezeData(JSON.parse(json));
}

/** Consume only a receipt minted by this module from the actual socket reply.
 * A serialized receipt, matching JSON, or caller-provided UUID has no brand.
 * Binding is created separately from same-daemon metadata, then consumed once.
 */
export function consumeSharedThreadCreationReceipt(receipt, binding) {
  const source = receiptSources.get(receipt);
  if (!source || source.consumed || !source.current() || !keys(binding, bindingKeys) ||
      !UUID.test(binding.clientId ?? "") || binding.threadId !== source.data.threadId ||
      ["hostId", "runtimeGeneration", "daemonGeneration", "accountRevision", "projectId", "viewId"].some(k => binding[k] !== source.data.scope[k])) return null;
  source.consumed = true;
  source.binding = Object.freeze(Object.fromEntries(bindingKeys.map(k => [k, binding[k]])));
  return source.data;
}
function copyScope(value) {
  if (!keys(value, scopeKeys) || value.hostId !== "kanban-shared-cli" || !atom(value.projectId) ||
      ![value.runtimeGeneration, value.daemonGeneration, value.viewId, value.creationNonce].every(x => UUID.test(x ?? "")) ||
      !Number.isSafeInteger(value.accountRevision) || value.accountRevision < 0 ||
      typeof value.cwd !== "string" || value.cwd.length > 4096 || /[\x00-\x1f\x7f]/.test(value.cwd) ||
      !posix.isAbsolute(value.cwd) || posix.normalize(value.cwd) !== value.cwd) throw invalid();
  return Object.freeze(Object.fromEntries(scopeKeys.map(k => [k, value[k]])));
}
function copyRequest(frame, cwd, modelSelection, scope, verifyPermissionSelectionSync) {
  if (!keys(frame, ["id", "method", "params", "jsonrpc", "trace"], ["id", "method", "params"]) ||
      !rpcId(frame.id) || frame.method !== "thread/start" ||
      (frame.jsonrpc !== undefined && frame.jsonrpc !== "2.0")) throw invalid("request-envelope");
  // The original SDK adds OTel metadata after create authorization. Validate
  // its fixed shape independently; it cannot alter the authorized business
  // frame. The daemon gate continues forwarding the original encoded frame.
  const trace = Object.getOwnPropertyDescriptor(frame, "trace");
  try { if (trace && !Object.hasOwn(trace, "value")) throw invalid(); copySharedRpcTrace(trace?.value); }
  catch { throw invalid("request-trace"); }
  if (!keys(frame.params, ["cwd", "model", "config", "approvalPolicy", "approvalsReviewer", "permissions", "sandbox", "runtimeWorkspaceRoots", "daybreakProgramPropagationEnrolled"], ["cwd"]) || frame.params.cwd !== cwd) throw invalid("request-params");
  // The pinned SDK's installed provider emits false while propagation is
  // unconfirmed/unenrolled. Stable 0.166.0 has no such business option: only
  // this literal disabled default is excluded from authorization equality.
  // Keep the raw wire unchanged; true and all other supplied values fail.
  const enrolled = Object.getOwnPropertyDescriptor(frame.params, "daybreakProgramPropagationEnrolled");
  if (enrolled && (!Object.hasOwn(enrolled, "value") || enrolled.value !== false)) throw invalid("request-params");
  let permissions;try { permissions = copySharedNativePermissionFields(frame.params, { cwd, kind: "start" }); } catch { throw invalid("permission-shape"); }
  if (Object.keys(permissions).length && (typeof verifyPermissionSelectionSync !== "function" || verifyPermissionSelectionSync(scope, Object.freeze({ cwd, ...permissions })) !== true)) throw invalid("permission-proof");
  const config = { ...(permissions.config ?? {}) }, params = { cwd, ...permissions };
  if (Object.hasOwn(frame.params, "config") && (!Object.keys(frame.params.config ?? {}).length || !keys(frame.params.config, [...Object.keys(permissions.config ?? {}), "model_reasoning_effort"], []))) throw invalid("config-shape");
  if (Object.hasOwn(frame.params, "model")) {
    if (!atom(frame.params.model) || !modelSelection) throw invalid("model-shape");
    const effort = frame.params.config?.model_reasoning_effort;
    if (effort !== undefined && !atom(effort)) throw invalid("model-shape");
    if (!modelSelection.resolveSelectionSync(scope, { model: frame.params.model, ...(effort === undefined ? {} : { reasoningEffort: effort }) })) throw invalid("model-proof");
    params.model = frame.params.model;
    if (effort !== undefined) config.model_reasoning_effort = effort;
  } else if (Object.hasOwn(frame.params.config ?? {}, "model_reasoning_effort")) throw invalid("model-shape");
  if (Object.keys(config).length) params.config = Object.freeze(config);
  return Object.freeze({ id: frame.id, method: "thread/start", params: Object.freeze(params),
    ...(frame.jsonrpc === undefined ? {} : { jsonrpc: "2.0" }) });
}
function parseReply(frame, reply, cwd) {
  if (!keys(reply, ["id", "result", "error", "jsonrpc"], ["id"]) || reply.id !== frame.id ||
      (reply.jsonrpc !== undefined && reply.jsonrpc !== "2.0") ||
      Object.hasOwn(reply, "result") === Object.hasOwn(reply, "error")) throw unknown();
  if (Object.hasOwn(reply, "error")) {
    if (!keys(reply.error, ["code", "message", "data"], ["code", "message"]) ||
        !Number.isInteger(reply.error.code) || typeof reply.error.message !== "string") throw unknown();
    return null;
  }
  const r = reply.result;
  // Validate the actual pinned ThreadStartResponse, including the effective cwd.
  // A thread/started notification or caller-supplied UUID is never a receipt.
  if (!plain(r) || !["thread", "model", "modelProvider", "cwd", "approvalPolicy", "approvalsReviewer", "sandbox"].every(k => Object.hasOwn(r, k)) ||
      r.cwd !== cwd || !atom(r.model) || !atom(r.modelProvider) || !["user", "auto_review", "guardian_subagent"].includes(r.approvalsReviewer) ||
      !( ["untrusted", "on-request", "never"].includes(r.approvalPolicy) || (plain(r.approvalPolicy) && plain(r.approvalPolicy.granular)) ) ||
      !plain(r.sandbox) || !["readOnly", "workspaceWrite", "dangerFullAccess", "externalSandbox"].includes(r.sandbox.type) ||
      !plain(r.thread) || !UUID.test(r.thread.id ?? "") || r.thread.cwd !== cwd ||
      !Array.isArray(r.thread.turns) || r.thread.turns.length !== 0) throw unknown();
  return r.thread.id;
}

/** Server-only, opt-in create capability for one already registered daemon.
 * registerCreate MUST only be called by the owned native explicit-gesture path.
 * It does not discover/start daemons, accept paths from HTTP, or perform writes.
 * The final gate invokes beforeWriteSync immediately before its synchronous
 * socket write and observeReplySync before releasing the original SDK reply.
 */
export function createSharedThreadCreationAuthority({
  verifyProjectSync, getOwnedView, verifyOwnedViewSync,
  verifyExplicitIntentSync, verifyPermissionSelectionSync, modelSelection, onCreated = () => {}, now = () => performance.now(),
} = {}) {
  if ([verifyProjectSync, getOwnedView, verifyOwnedViewSync, verifyExplicitIntentSync, onCreated, now].some(x => typeof x !== "function")) throw invalid();
  if (modelSelection !== undefined && !isSharedNativeModelSelection(modelSelection) || verifyPermissionSelectionSync !== undefined && typeof verifyPermissionSelectionSync !== "function") throw invalid();
  const pending = new Map(), nonces = new Set(), ids = new Set(), retiredRecords = new WeakSet();
  let closed = false;
  function valid(value) {
    try {
      return !closed && !value.signal.aborted && now() < value.deadline && !retiredRecords.has(value.record) &&
        getOwnedView(value.scope.viewId) === value.record && value.record.viewId === value.scope.viewId &&
        verifyOwnedViewSync(value.scope.viewId) === true && verifyProjectSync(value.scope) === true;
    } catch { return false; }
  }
  function registerCreate(rawScope, rawFrame, control) {
    const scope = copyScope(rawScope), frame = copyRequest(rawFrame, scope.cwd, modelSelection, scope, verifyPermissionSelectionSync), key = idKey(frame.id);
    if (!keys(control, ["signal", "deadline"]) || !(control.signal instanceof AbortSignal) ||
        !Number.isFinite(control.deadline) || control.deadline <= now() || control.deadline > now() + 30_000 ||
        pending.size >= MAX_PENDING || nonces.size >= MAX_USED || ids.size >= MAX_USED ||
        nonces.has(scope.creationNonce) || ids.has(key)) throw invalid();
    const record = getOwnedView(scope.viewId);
    const value = { scope, frame, record, signal: control.signal, deadline: control.deadline, state: "registered" };
    if (!record || !valid(value) || verifyExplicitIntentSync(scope, frame, control) !== true || !valid(value)) throw invalid();
    nonces.add(scope.creationNonce); ids.add(key); pending.set(key, value);
    return true;
  }
  function beforeWriteSync(rawFrame) {
    const key = idKey(rawFrame?.id), value = pending.get(key);
    if (!value || value.state !== "registered") throw invalid("creation-not-registered");
    const frame = copyRequest(rawFrame, value.scope.cwd, modelSelection, value.scope, verifyPermissionSelectionSync);
    if (JSON.stringify(frame) !== JSON.stringify(value.frame)) {
      pending.delete(key); throw invalid("frame-mismatch");
    }
    if (!valid(value)) { pending.delete(key); throw invalid("scope-not-current"); }
    // Burn before dispatch. Callback failure or missing reply is not retryable.
    value.state = "dispatched";
    return true;
  }
  function observeReplySync(rawFrame, reply) {
    const key = idKey(rawFrame?.id), value = pending.get(key);
    if (!value || value.state !== "dispatched") throw invalid();
    pending.delete(key);
    if (!valid(value)) throw unknown();
    const threadId = parseReply(value.frame, reply, value.scope.cwd);
    if (threadId === null) return Object.freeze({ status: "rejected" });
    if (value.frame.params.model !== undefined) {
      const selected = modelSelection.resolveSelectionSync(value.scope, { model: value.frame.params.model,
        ...(value.frame.params.config ? { reasoningEffort: value.frame.params.config.model_reasoning_effort } : {}) });
      if (!selected || selected.model !== reply.result.model || (selected.reasoningEffort !== undefined && selected.reasoningEffort !== reply.result.reasoningEffort)) throw unknown();
    }
    const permissionRequest = freezeData({ cwd: value.scope.cwd, ...copySharedNativePermissionFields(value.frame.params, { cwd: value.scope.cwd, kind: "start" }) });
    if (Object.keys(permissionRequest).length > 1 && !verifySharedNativePermissionReply(permissionRequest, reply.result)) throw unknown();
    const receipt = Object.freeze({ status: "created", ...value.scope, threadId });
    const data = Object.freeze({ origin: "native-start-response", scope: value.scope, threadId, requestId: value.frame.id, execution: executionCopy(reply.result), permissionRequest,
      permissionRequestSha256: createHash("sha256").update(JSON.stringify(permissionRequest)).digest("hex"),
      replySha256: createHash("sha256").update(JSON.stringify(reply)).digest("hex"), replyDigestEncoding: "json-stringify-utf8" });
    const receipts = authorityReceipts.get(authority);
    if (receipts.size >= MAX_PENDING) throw unknown();
    receiptSources.set(receipt, { authority, consumed: false, data, deadline: value.deadline, current: () => valid(value) });
    // This is the first place a real UUID may enter the binding path. The
    // callback must still resolve metadata from the same daemon, never mint it.
    let result;
    try { result = onCreated(receipt); } catch { receiptSources.delete(receipt); throw unknown(); }
    if (result && typeof result.then === "function") { receiptSources.delete(receipt); void Promise.resolve(result).catch(() => {}); throw unknown(); }
    if (!valid(value)) throw unknown();
    receipts.set(idKey(value.frame.id), receipt);
    return receipt;
  }
  function retireView(viewId) {
    const record = getOwnedView(viewId); if (record && typeof record === "object") retiredRecords.add(record);
    for (const [key, value] of pending) if (value.scope.viewId === viewId) { retiredRecords.add(value.record); pending.delete(key); }
  }
  function close() { closed = true; pending.clear(); authorityReceipts.get(authority)?.clear(); }
  const authority = Object.freeze({ registerCreate, beforeWriteSync, observeReplySync, retireView, close });
  creationAuthorities.add(authority); authorityReceipts.set(authority, new Map()); return authority;
}
