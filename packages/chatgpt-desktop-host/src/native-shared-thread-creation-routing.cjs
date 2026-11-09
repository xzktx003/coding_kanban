"use strict";
const { AsyncLocalStorage } = require("node:async_hooks");
const { performance } = require("node:perf_hooks");
const {copySharedDesktopPermissionConfig,copySharedNativePermissionFields}=require('./shared-permissions-schema.cjs');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const denied = () => Object.assign(new Error("Shared creation intent denied"), { code: "SHARED_CREATE_INTENT_DENIED" });
const unsupported = fields => Object.assign(new Error(`Shared CLI inherits the daemon's model, permissions and instructions. Explicit desktop options are not supported yet: ${fields.join(", ")}`),
  { code: "SHARED_CREATE_EXPLICIT_OPTIONS_UNSUPPORTED", fields: Object.freeze([...fields]) });
const plain = x => x !== null && typeof x === "object" && !Array.isArray(x);
const exact = (x, names) => plain(x) && Object.keys(x).sort().join(",") === [...names].sort().join(",");
const atom = x => typeof x === "string" && x.length > 0 && x.length <= 256 && !/[\x00-\x1f\x7f]/.test(x);
const scopeKeys = ["hostId", "runtimeGeneration", "daemonGeneration", "accountRevision", "projectId", "cwd", "viewId", "creationNonce"];
// Pinned 0.166.0-alpha.5.1 ThreadStartParams schema. Unknown future fields fail
// closed; known native defaults are deliberately projected, not forwarded.
const startKeys = new Set(["allowProviderModelFallback", "approvalPolicy", "approvalsReviewer", "baseInstructions", "config", "cwd", "daybreakEnabled", "developerInstructions", "dynamicTools", "environments", "ephemeral", "experimentalRawEvents", "historyMode", "mockExperimentalField", "model", "modelProvider", "multiAgentMode", "permissions", "personality", "projectId", "runtimeWorkspaceRoots", "sandbox", "selectedCapabilityRoots", "serviceName", "serviceTier", "sessionStartSource", "threadSource"]);
// ID/IM pass these original caller values into xA/xR/xE. They are not the
// later host defaults produced by IO/k9/k7. Until explicit overrides have their
// own bounded support, reject them before running the original manager.
const callerOverrides = ["modelProvider", "permissionSelection", "permissions", "approvalPolicy", "sandbox", "baseInstructions", "additionalDeveloperInstructions", "developerInstructions", "config", "memoryPreferences", "realtimeVoiceDynamicTools", "serviceTier", "serviceName", "daybreakEnabled", "disabledPluginIds", "environments", "dynamicTools", "dynamicToolFeatureOverrides", "personality", "runtimeWorkspaceRoots", "selectedCapabilityRoots", "historyMode", "allowProviderModelFallback", "sessionStartSource"];
const meaningful = value => value !== undefined && value !== null && !(plain(value) && Object.keys(value).length === 0) && !(Array.isArray(value) && value.length === 0);
const canonicalValue=value=>Array.isArray(value)?value.map(canonicalValue):plain(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonicalValue(value[key])])):value;
const sameValue=(a,b)=>JSON.stringify(canonicalValue(a))===JSON.stringify(canonicalValue(b));
function selectedPermissions(params,cwd){
  let value=null;
  if(meaningful(params.permissionsConfig)){try{value=copySharedDesktopPermissionConfig(params.permissionsConfig,{cwd})}catch{throw unsupported(['permissionsConfig'])}}
  if(meaningful(params.approvalsReviewer)&&(!value||params.approvalsReviewer!==value.approvalsReviewer))throw unsupported(['approvalsReviewer']);
  if(![undefined,null,true,false].includes(params.useAppServerPermissionDefault))throw unsupported(['useAppServerPermissionDefault']);
  if(meaningful(params.multiAgentMode)&&params.multiAgentMode!=='explicitRequestOnly')throw unsupported(['multiAgentMode']);
  return params.useAppServerPermissionDefault===true?null:value;
}
function verifyRequestedPermissions(selected,actual){
  if(!selected)return;
  if(!sameValue(actual.approvalPolicy,selected.approvalPolicy)||actual.approvalsReviewer!==selected.approvalsReviewer)throw unsupported(['permissionsConfig']);
  const profile=selected.activePermissionProfile;
  if(profile!=null){if(actual.permissions!==profile.id||meaningful(actual.sandbox))throw unsupported(['permissionsConfig']);return}
  const mode={dangerFullAccess:'danger-full-access',readOnly:'read-only',workspaceWrite:'workspace-write',externalSandbox:null}[selected.sandboxPolicy.type];
  if(actual.sandbox!==mode||meaningful(actual.permissions))throw unsupported(['permissionsConfig']);
}
function selectedModel(params) {
  let model = params.model, effort = params.reasoningEffort;
  if (params.collaborationMode != null) {
    const mode = params.collaborationMode, settings = mode.settings;
    if (!exact(mode, ["mode", "settings"]) || mode.mode !== "default" || !plain(settings) ||
        Object.keys(settings).some(k => !["model", "reasoning_effort", "developer_instructions"].includes(k)) ||
        !atom(settings.model) || settings.developer_instructions != null ||
        (settings.reasoning_effort != null && !atom(settings.reasoning_effort)) ||
        (model != null && model !== settings.model) || (effort != null && effort !== settings.reasoning_effort)) throw unsupported(["collaborationMode"]);
    model = settings.model; effort = settings.reasoning_effort;
  }
  if (model == null && effort == null) return null;
  if (!atom(model) || (effort != null && !atom(effort))) throw unsupported(["model", "reasoningEffort"]);
  return Object.freeze({ model, ...(effort == null ? {} : { reasoningEffort: effort }) });
}
const createdContexts = new WeakMap();
const firstTurnContexts = new WeakMap();
function sameBinding(a, b) { const names = ["hostId", "runtimeGeneration", "daemonGeneration", "accountRevision", "projectId", "threadId", "viewId", "clientId"]; return plain(a) && plain(b) && Object.keys(a).length === 8 && Object.keys(b).length === 8 && names.every(k => a[k] === b[k]); }
function firstInput(value) {
  if (value == null || (Array.isArray(value) && value.length === 0)) return null;
  if (!Array.isArray(value) || value.length !== 1 || !plain(value[0])) throw denied();
  const input = value[0];
  for (const name of Reflect.ownKeys(input)) {
    const descriptor = Object.getOwnPropertyDescriptor(input, name);
    if (typeof name !== 'string' || !['type', 'text', 'text_elements'].includes(name) || !descriptor || !Object.hasOwn(descriptor, 'value')) throw denied();
  }
  if (input.type !== 'text' || typeof input.text !== 'string' || input.text.length === 0 || Buffer.byteLength(input.text) > 32 * 1024 ||
      (input.text_elements !== undefined && (!Array.isArray(input.text_elements) || input.text_elements.length !== 0))) throw denied();
  return Object.freeze([Object.freeze({ type: 'text', text: input.text, text_elements: Object.freeze([]) })]);
}
function firstSelectionMatches(value, frame) {
  const params = frame?.params;
  if (!plain(params) || !sameValue(firstInput(params.input), value.firstInput)) return false;
  if (value.firstClientUserMessageId != null && params.clientUserMessageId !== value.firstClientUserMessageId) return false;
  const selected = value.selection, settings = params.collaborationMode?.settings;
  if (selected && ((params.model != null && params.model !== selected.model) || (settings?.model != null && settings.model !== selected.model) ||
      (selected.reasoningEffort != null && ((params.effort != null && params.effort !== selected.reasoningEffort) ||
       (settings?.reasoning_effort != null && settings.reasoning_effort !== selected.reasoningEffort))))) return false;
  if (value.permissions) {
    const expected = value.permissions, actual = copySharedNativePermissionFields(params, { kind: 'turn' });
    if (!sameValue(actual.approvalPolicy, expected.approvalPolicy) || actual.approvalsReviewer !== expected.approvalsReviewer) return false;
    if (expected.activePermissionProfile != null) return actual.permissions === expected.activePermissionProfile.id && actual.sandboxPolicy == null;
    if (actual.permissions != null || !plain(actual.sandboxPolicy)) return false;
    const wanted = expected.sandboxPolicy, policy = actual.sandboxPolicy;
    if (wanted.type !== policy.type) return false;
    if (wanted.type !== 'workspaceWrite') return sameValue(policy, wanted);
    // The server's existing branded artifact proof authorizes any derived root;
    // the captured picker policy and its original roots must remain unchanged.
    const { writableRoots: roots, ...policyFields } = policy, { writableRoots: originalRoots, ...expectedFields } = wanted;
    if (!sameValue(policyFields, expectedFields) || !Array.isArray(roots) || !Array.isArray(originalRoots) ||
        originalRoots.some((root, index) => roots[index] !== root)) return false;
  }
  return true;
}
function readNativeSharedFirstTurnControl(binding, token, frame) {
  const value = firstTurnContexts.get(token);
  if (!value || value.used || !sameBinding(value.binding, binding) || frame?.params?.threadId !== binding.threadId || !value.current()) return null;
  try { if (!value.matches(frame)) return null; } catch { return null; }
  if (!value.current()) return null;
  value.used = true;
  return Object.freeze({ signal: value.signal, deadline: value.now() + 30_000 });
}
function consumeNativeSharedCreationContext(token, binding) {
  const value = createdContexts.get(token);
  if (!value || value.used || !value.current() || !sameBinding(value.binding, binding)) return null;
  value.used = true; return value.data;
}

/** Owned native causal adapter. No RPC is dispatched by this module itself.
 * lifecycle receives the same monotonic message already used by shared resume;
 * intent must originate in the original committed composer's explicit submit.
 * withStart wraps the original manager.startConversation and retains its input.
 * invoke(cleanParams, settleCreated) MUST install settleCreated in the original
 * afterConversationCreated callback, before ID starts its first native turn.
 */
function createNativeSharedThreadCreationRouter({ profileId, generation,
  getRecord, getOwnedRecord, verifyRuntimeSync, sendToView,
  resolveCreateScope, authorizeCreate, resolveCreatedBinding, onBound,
  onProjection = () => {}, now = () => performance.now(),
} = {}) {
  if (![profileId, generation].every(x => UUID.test(x ?? "")) ||
      [getRecord, getOwnedRecord, verifyRuntimeSync, sendToView, resolveCreateScope, authorizeCreate, resolveCreatedBinding, onBound, onProjection, now].some(x => typeof x !== "function")) throw denied();
  const lives = new WeakMap(), pending = new Map(), used = new Set(), contexts = new Set(), local = new AsyncLocalStorage();
  let disposed = false;
  function owned(sender, record) {
    try { return !disposed && verifyRuntimeSync() === true && getOwnedRecord(sender) === record &&
      getRecord(record.senderId) === record && record.window?.webContents === sender &&
      record.failed !== true && !record.window.isDestroyed() && !sender.isDestroyed(); }
    catch { return false; }
  }
  function current(v) { return owned(v.sender, v.record) && lives.get(v.record) === v.life && v.life.epoch !== null && !v.controller.signal.aborted && now() < v.deadline; }
  function invocationCurrent(v) { return v.boundReady === true && v.invoking === true && owned(v.sender, v.record) && lives.get(v.record) === v.life && v.life.epoch !== null && !v.controller.signal.aborted; }
  function revoke(v) { clearTimeout(v.timer); v.controller.abort(); pending.delete(v.attemptId); }
  function retireRecord(record) {
    for (const v of pending.values()) if (v.record === record) revoke(v);
    for (const v of contexts) if (v.record === record) revoke(v);
  }
  function lifecycle(sender, message) {
    const record = getOwnedRecord(sender);
    if (!record || !owned(sender, record) || !exact(message, ["type", "sequence", "epoch"]) ||
        message.type !== "kanban-shared-connect-lifecycle" || !Number.isSafeInteger(message.sequence) || message.sequence < 1 ||
        (message.epoch !== null && !UUID.test(message.epoch ?? ""))) return false;
    const prior = lives.get(record), seen = prior?.seen ?? new Set();
    if ((prior && message.sequence <= prior.sequence) || (message.epoch !== null && (seen.has(message.epoch) || seen.size >= 4096))) return false;
    retireRecord(record); if (message.epoch !== null) seen.add(message.epoch);
    lives.set(record, { sequence: message.sequence, epoch: message.epoch, seen }); return true;
  }
  function bounded(promise, v) {
    return new Promise((resolve, reject) => {
      const abort = () => reject(denied());
      const timer = setTimeout(abort, Math.max(1, v.deadline - now())); timer.unref?.();
      v.controller.signal.addEventListener("abort", abort, { once: true });
      Promise.resolve(promise).then(resolve, reject).finally(() => { clearTimeout(timer); v.controller.signal.removeEventListener("abort", abort); });
      if (v.controller.signal.aborted) abort();
    });
  }
  async function intent(sender, message) {
    const names = ["type", "v", "action", "profileId", "generation", "viewId", "hostId", "projectId", "cwd", "clientThreadId", "attemptId", "sequence", "epoch"];
    const record = getOwnedRecord(sender), life = record && lives.get(record);
    if (!record || !owned(sender, record) || !life?.epoch || !exact(message, names) || message.type !== "kanban-shared-create-intent" ||
        message.v !== 1 || message.action !== "create" || message.profileId !== profileId || message.generation !== generation ||
        message.viewId !== record.viewId || message.hostId !== "kanban-shared-cli" || !atom(message.projectId) ||
        !UUID.test(message.attemptId ?? "") || !atom(message.clientThreadId) || typeof message.cwd !== "string" ||
        message.cwd.length > 4096 || /[\x00-\x1f\x7f]/.test(message.cwd) || message.sequence !== life.sequence || message.epoch !== life.epoch ||
        used.has(message.attemptId) || used.size >= 8192 || pending.size + contexts.size >= 16) return false;
    used.add(message.attemptId);
    const v = { record, sender, life, attemptId: message.attemptId, clientThreadId: message.clientThreadId, appProjectId: message.projectId,
      deadline: now() + 30_000, controller: new AbortController(), ready: false, claimed: false, binding: null, scope: null, timer: null };
    pending.set(v.attemptId, v); v.timer = setTimeout(() => revoke(v), 30_000); v.timer.unref?.();
    let accepted = false;
    try {
      const value = await bounded(resolveCreateScope(record, { hostId: message.hostId, projectId: message.projectId, cwd: message.cwd, viewId: record.viewId }, { attemptId: v.attemptId, signal: v.controller.signal, deadline: v.deadline }), v);
      if (!current(v) || !exact(value, scopeKeys) || value.hostId !== message.hostId || !atom(value.projectId) || value.cwd !== message.cwd || value.viewId !== record.viewId ||
          value.runtimeGeneration !== generation || !UUID.test(value.daemonGeneration ?? "") || !UUID.test(value.creationNonce ?? "") || !Number.isSafeInteger(value.accountRevision) || value.accountRevision < 0) throw denied();
      v.scope = Object.freeze({ ...value }); v.ready = true; accepted = true;
    } catch {}
    if (current(v)) {
      try { sendToView(record, { type: "kanban-shared-create-intent-ack", attemptId: v.attemptId, sequence: life.sequence, epoch: life.epoch, accepted }); }
      catch { accepted = false; }
    } else accepted = false;
    if (!accepted || !current(v)) { revoke(v); return false; }
    return true;
  }
  async function withStart(sender, hostId, params, invoke) {
    if (!plain(params) || typeof invoke !== "function") throw denied();
    const clean = { ...params }, attemptId = clean.__kanbanSharedCreateAttempt, clientThreadId = clean.__kanbanSharedCreateClient;
    delete clean.__kanbanSharedCreateAttempt; delete clean.__kanbanSharedCreateClient;
    const v = pending.get(attemptId);
    if (!v || !v.ready || v.sender !== sender || hostId !== "kanban-shared-cli" || clientThreadId !== v.clientThreadId ||
        ![undefined, null, "default"].includes(clean.mode) || ![undefined, null, "project"].includes(clean.workspaceKind) ||
        ![undefined, null, "default"].includes(clean.threadStartKind) || clean.cloudThreadPrototype != null || clean.cloudEnvironment != null || clean.sideConversation != null ||
        clean.cwd !== v.scope.cwd || (clean.workspaceRoots !== undefined && (!Array.isArray(clean.workspaceRoots) || clean.workspaceRoots.length !== 1 || clean.workspaceRoots[0] !== v.scope.cwd)) || !current(v)) throw denied();
    // Fixed Mac composer cR builds this local AppHost assignment. Its project
    // ID stays in the original UI callback; daemon authorization has a separate
    // server project ID selected only by the owned canonical cwd.
    if (clean.projectAssignment != null && (!exact(clean.projectAssignment, ["projectKind", "projectId"]) ||
        clean.projectAssignment.projectKind !== "local" || clean.projectAssignment.projectId !== v.appProjectId)) throw denied();
    const explicit = callerOverrides.filter(k => meaningful(clean[k]));
    if (clean.usePermissionSelection === true) explicit.push("usePermissionSelection");
    if (clean.threadSource != null && clean.threadSource !== "user") explicit.push("threadSource");
    if (explicit.length) throw unsupported(explicit);
    v.selection = selectedModel(clean);
    v.permissions = selectedPermissions(clean,v.scope.cwd);
    v.firstInput = firstInput(clean.input);
    v.firstClientUserMessageId = clean.clientUserMessageId;
    pending.delete(attemptId); contexts.add(v);
    // Preserve the original permission settings and inheritance flags. IM/xR
    // apply the shipped requirements and permission-profile conversion; the
    // final native fields are validated below and by the same writer authority.
    v.invoking = true;
    try { return await local.run(v, () => invoke(clean, threadId => settleCreated(v, threadId))); }
    finally { v.invoking = false; contexts.delete(v); revoke(v); }
  }
  async function prepareRequest(hostId, frame) {
    if (hostId !== "kanban-shared-cli" || frame?.method !== "thread/start") return Object.freeze({ frame, shared: false });
    const v = local.getStore();
    if (!v || !current(v) || v.claimed || !plain(frame) || !plain(frame.params) || !atom(frame.id) ||
        Object.keys(frame.params).some(k => !startKeys.has(k)) ||
        frame.params.cwd !== v.scope.cwd || Object.keys(frame).some(k => !["id", "method", "params", "trace", "jsonrpc"].includes(k))) throw denied();
    const unclassified = ["allowProviderModelFallback", "selectedCapabilityRoots", "sessionStartSource", "multiAgentMode", "daybreakEnabled", "environments"].filter(k => meaningful(frame.params[k]));
    if(frame.params.mockExperimentalField!==undefined&&frame.params.mockExperimentalField!==null)unclassified.push('mockExperimentalField');
    if (frame.params.projectId != null && frame.params.projectId !== v.appProjectId) unclassified.push("projectId");
    if (frame.params.ephemeral === true) unclassified.push("ephemeral");
    if (frame.params.experimentalRawEvents === true) unclassified.push("experimentalRawEvents");
    if (frame.params.threadSource != null && frame.params.threadSource !== "user") unclassified.push("threadSource");
    if (frame.params.runtimeWorkspaceRoots != null && (!Array.isArray(frame.params.runtimeWorkspaceRoots) || frame.params.runtimeWorkspaceRoots.length !== 1 || frame.params.runtimeWorkspaceRoots[0] !== v.scope.cwd)) unclassified.push("runtimeWorkspaceRoots");
    if (unclassified.length) throw unsupported(unclassified);
    let nativePermissions;
    try{nativePermissions=copySharedNativePermissionFields(frame.params,{cwd:v.scope.cwd,kind:'start'})}catch{throw unsupported(['permissionsConfig'])}
    verifyRequestedPermissions(v.permissions,nativePermissions);
    v.claimed = true;
    // Preserve the original per-thread permissions and selected model. Other
    // generated desktop configuration/personality/tools retain the existing
    // projection to registered CLI defaults and are recorded below.
    const retainedPermissionKeys=Object.keys(nativePermissions);
    const dropped = Object.keys(frame.params).filter(k => k !== "cwd" && k !== "config" && !retainedPermissionKeys.includes(k) && !(k === "model" && v.selection));
    if (frame.params.config !== undefined) {
      if(plain(frame.params.config)){for(const key of Object.keys(frame.params.config))if(!(key==='model_reasoning_effort'&&v.selection?.reasoningEffort)&&!Object.hasOwn(nativePermissions.config??{},key))dropped.push(`config.${key}`)}else dropped.push('config');
    }
    dropped.sort();
    onProjection(Object.freeze({ attemptId: v.attemptId, droppedKeys: Object.freeze(dropped) }));
    const config={...(nativePermissions.config??{}),...(v.selection?.reasoningEffort?{model_reasoning_effort:v.selection.reasoningEffort}:{})};
    const canonical = Object.freeze({ id: frame.id, method: "thread/start", params: Object.freeze({ cwd: v.scope.cwd,...nativePermissions,
      ...(v.selection ? { model: v.selection.model } : {}),...(Object.keys(config).length?{config:Object.freeze(config)}:{}),
    }), ...(frame.jsonrpc === undefined ? {} : { jsonrpc: frame.jsonrpc }) });
    if (await bounded(authorizeCreate(v.scope, canonical, { signal: v.controller.signal, deadline: v.deadline }), v) !== true || !current(v)) throw denied();
    // The fixed shared-host original SDK transport uses the same registered
    // daemon session. It must not be replaced by the existing resume exchange.
    return Object.freeze({ frame: canonical, shared: false });
  }
  async function settleCreated(v, threadId) {
    if (!v.claimed || v.binding || !UUID.test(threadId ?? "") || !current(v)) throw denied();
    const control = { signal: v.controller.signal, deadline: v.deadline, attemptId: v.attemptId };
    const binding = await bounded(resolveCreatedBinding(v.scope, threadId, control), v);
    if (!binding || binding.hostId !== v.scope.hostId || binding.threadId !== threadId || binding.viewId !== v.scope.viewId ||
        binding.projectId !== v.scope.projectId || binding.runtimeGeneration !== v.scope.runtimeGeneration ||
        binding.daemonGeneration !== v.scope.daemonGeneration || binding.accountRevision !== v.scope.accountRevision ||
        !UUID.test(binding.clientId ?? "") || !current(v)) throw denied();
    v.binding = Object.freeze({ ...binding });
    const token = Object.freeze({});
    createdContexts.set(token, { used: false, binding: v.binding, current: () => current(v), data: Object.freeze({
      sender: v.sender, record: v.record, attemptId: v.attemptId, sequence: v.life.sequence, epoch: v.life.epoch,
      signal: v.controller.signal, deadline: v.deadline,
    }) });
    if (await bounded(onBound(v.binding, control, token), v) !== true || !current(v)) throw denied();
    // The creation nonce and its control retain their original 30-second limit.
    // Only a timely bound original invocation can retain its captured first
    // input during preprocessing; no create ticket is renewed or reused.
    clearTimeout(v.timer); v.timer = null; v.boundReady = true;
    if (v.firstInput) {
      v.firstTurnToken = Object.freeze({});
      firstTurnContexts.set(v.firstTurnToken, { binding: v.binding, used: false, current: () => invocationCurrent(v),
        matches: frame => firstSelectionMatches(v, frame), signal: v.controller.signal, now });
    }
    return v.binding;
  }
  function getFirstTurnContext(hostId, frame) {
    const value = local.getStore();
    if (hostId !== "kanban-shared-cli" || frame?.method !== "turn/start" || !value?.firstTurnToken || !value.binding || !invocationCurrent(value) || frame.params?.threadId !== value.binding.threadId) return null;
    return Object.freeze({ binding: value.binding, token: value.firstTurnToken });
  }
  function retire(sender) { const record = getOwnedRecord(sender); if (record) { retireRecord(record); lives.delete(record); } }
  function dispose() { disposed = true; for (const v of pending.values()) revoke(v); for (const v of contexts) revoke(v); }
  return Object.freeze({ lifecycle, intent, withStart, prepareRequest, getFirstTurnContext, retire, dispose });
}
module.exports = { createNativeSharedThreadCreationRouter, consumeNativeSharedCreationContext, readNativeSharedFirstTurnControl };
