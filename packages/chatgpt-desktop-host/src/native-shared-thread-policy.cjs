"use strict";
const { createHash } = require("node:crypto");
const { adaptNativeAppChunk } = require("./native-app-policy.cjs");
const BASE = "0a0c317cca8e59ae237a68e2485e4697dade5589678143aa2bfb82aeae5cf782";
const ADAPTED =
  "4faa8790de76b9434e943d17fb0e5a9604a358540255d4b7f4561ef03aeb14e7";
const PATCHES = Object.freeze([
  [
    "turnId:await e.start(d,r.start,a,o,c)",
    "turnId:await globalThis.__kanbanRunSharedPreparedSend(r.start,()=>e.start(d,r.start,a,o,c))",
  ],
  [
    "async send(e,t,r,n){this.assertCurrent();try{",
    "async send(e,t,r,n){this.assertCurrent();try{let __kanbanPrepared=globalThis.__kanbanPrepareSharedThreadRequest(this.hostId,e);if(__kanbanPrepared&&typeof __kanbanPrepared.then===\"function\")__kanbanPrepared=await __kanbanPrepared;e=__kanbanPrepared.frame;this.assertCurrent();",
  ],
  [
    'let i=this.hostId===el.iwv?Rm.send(e):null,s=i?.type==="response"?i.response:await this.sendToConnection(i?.request??e,t,r,n);',
    "let i=this.hostId===el.iwv&&!__kanbanPrepared.shared?Rm.send(e):null,s=__kanbanPrepared.shared?await globalThis.__kanbanExchangeSharedThreadRequest(this.hostId,e):i?.type===\"response\"?i.response:await this.sendToConnection(i?.request??e,t,r,n);",
  ],
  [
    '}catch(e){for(let t of this.requestLifecycleListeners)t({type:"failed",hostId:this.hostId,error:e});throw e}}async sendToConnection',
    '}catch(e){if(n&&e?.code==="SHARED_DAEMON_OUTCOME_UNKNOWN"){t?.onOutcomeUnknown?.(e);for(let t of this.requestLifecycleListeners)t({type:"outcome-unknown",hostId:this.hostId,error:e})}for(let t of this.requestLifecycleListeners)t({type:"failed",hostId:this.hostId,error:e});throw e}}async sendToConnection',
  ],
  [
    "this.cleanup.push(this.connection.registerHostEventHandler({getBackgroundTurnMetadata:",
    "this.cleanup.push(globalThis.__kanbanRegisterSharedHostEvents(this,e,{getBackgroundTurnMetadata:",
  ],
  [
    "async sendResponse(e,t){let r=this.requests.get(t.id);",
    'async sendResponse(e,t){if(globalThis.__kanbanIsSharedServerResponse(this,t))throw Object.assign(Error("Shared approval response unavailable"),{code:"SHARED_APPROVAL_UNAVAILABLE"});let r=this.requests.get(t.id);',
  ],
  [
    'case"kanban-project-folder-lifecycle":',
    'case"kanban-shared-connect-lifecycle":if(!globalThis.__kanbanSharedConnectLifecycle(e,t))throw Error("Shared connect lifecycle unavailable");break;case"kanban-shared-connect-intent":void globalThis.__kanbanSharedConnectIntent(e,t).catch(()=>{});break;case"kanban-shared-create-intent":void globalThis.__kanbanSharedCreateIntent(e,t).catch(()=>{});break;case"kanban-shared-send-intent":void globalThis.__kanbanSharedSendIntent(e,t).catch(()=>{});break;case"kanban-shared-approval-intent":void globalThis.__kanbanSharedApprovalIntent(e,t).catch(()=>{});break;case"kanban-shared-catalog-request":if(!globalThis.__kanbanSharedCatalogRequest(e,t))throw Error("Shared catalog unavailable");break;case"kanban-shared-catalog-ack":if(!globalThis.__kanbanSharedCatalogAck(e,t))throw Error("Shared catalog unavailable");break;case"kanban-shared-catalog-cancel":globalThis.__kanbanSharedCatalogCancel(e,t);break;case"kanban-project-folder-lifecycle":',
  ],
]);
const fail = () =>
  Object.assign(new Error("Shared thread native policy unavailable"), {
    code: "SHARED_NAV_NATIVE_PATCH_MISMATCH",
  });
const hash = (value) => createHash("sha256").update(value).digest("hex");
function adaptNativeSharedThreadChunk({ body } = {}) {
  const base = adaptNativeAppChunk({ body });
  if (base.adaptedSha256 !== BASE) throw fail();
  let source = base.body.toString("utf8");
  for (const [before, after] of PATCHES) {
    const at = source.indexOf(before);
    if (at < 0 || at !== source.lastIndexOf(before)) throw fail();
    source = source.slice(0, at) + after + source.slice(at + before.length);
  }
  const adapted = Buffer.from(source, "utf8");
  if (hash(adapted) !== ADAPTED) throw fail();
  return {
    ...base,
    body: adapted,
    nativeAppSha256: BASE,
    adaptedSha256: ADAPTED,
  };
}
module.exports = { adaptNativeSharedThreadChunk };
