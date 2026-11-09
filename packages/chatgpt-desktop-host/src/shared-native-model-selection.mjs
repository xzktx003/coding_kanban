const catalogs = new WeakMap();
const atom = value => typeof value === "string" && value.length > 0 && value.length <= 256 && !/[\x00-\x1f\x7f]/.test(value);
const plain = value => value !== null && typeof value === "object" && !Array.isArray(value);
export const isSharedNativeModelSelection = value => catalogs.has(value);

/** Fixed daemon model choices only. The owning RPC gate records its real
 * model/list replies; this object offers no provider endpoint or config RPC. */
export function createSharedNativeModelSelection({ getAccountRevision, verifyCurrentSync } = {}) {
  if ([getAccountRevision, verifyCurrentSync].some(x => typeof x !== "function")) throw new Error("Shared model catalog unavailable");
  const state = { revision: null, models: new Map(), observation: 0, closed: false, getAccountRevision, verifyCurrentSync };
  const catalog = Object.freeze({
    resolveSelectionSync(scope, selection) {
      try {
        if (state.closed || verifyCurrentSync() !== true || !Number.isSafeInteger(scope?.accountRevision) || scope.accountRevision !== state.revision || getAccountRevision() !== state.revision ||
            !plain(selection) || Object.keys(selection).some(k => !["model", "reasoningEffort"].includes(k)) || !atom(selection.model)) return null;
        const model = state.models.get(selection.model); if (!model) return null;
        const effort = selection.reasoningEffort;
        if (effort != null && (!atom(effort) || !model.efforts.has(effort))) return null;
        return Object.freeze({ model: model.model, ...(effort == null ? {} : { reasoningEffort: effort }) });
      } catch { return null; }
    },
    verifySelectionSync(scope, selection) { return catalog.resolveSelectionSync(scope, selection) !== null; },
    close() { state.closed = true; state.models.clear(); },
  });
  catalogs.set(catalog, state); return catalog;
}

export function observeSharedNativeModelList(catalog, request, reply) {
  const state = catalogs.get(catalog);
  try {
    if (!state || state.closed || state.verifyCurrentSync() !== true || request?.method !== "model/list" || reply?.id !== request.id) return false;
    if (Object.hasOwn(reply, "error")) return true;
    const revision = state.getAccountRevision(), result = reply.result;
    if (!Number.isSafeInteger(revision) || revision < 0 || !plain(result) || !Array.isArray(result.data) || result.data.length > 100) return false;
    const additions = new Map();
    for (const entry of result.data) {
      if (!plain(entry) || !atom(entry.id) || !atom(entry.model) || !Array.isArray(entry.supportedReasoningEfforts) || entry.supportedReasoningEfforts.length > 16) return false;
      const efforts = new Set();
      for (const effort of entry.supportedReasoningEfforts) { if (!plain(effort) || !atom(effort.reasoningEffort)) return false; efforts.add(effort.reasoningEffort); }
      const value = { model: entry.model, efforts }; additions.set(entry.id, value); additions.set(entry.model, value);
    }
    if (state.revision !== revision || request.params?.cursor == null) { state.models.clear(); state.revision = revision; }
    if (state.models.size + additions.size > 512) return false;
    for (const [key, value] of additions) state.models.set(key, value);
    state.observation++;
    return true;
  } catch { return false; }
}


const modelReadFailure = phase => Object.assign(new Error("Shared model selection unavailable"), {code:"SHARED_MODEL_SELECTION_UNVERIFIED",phase});
/** Explicit-gesture fallback for desktop SDKs that keep their picker on the
 * local connection. Read only this source's already verified daemon observer;
 * never copy the local picker's catalog or change the requested selection.
 * Pages are staged until all current/signal/account checks pass, so a revoked
 * read cannot install even a partial catalog. No thread/tool/model is started.
 */
export async function ensureSharedNativeModelSelection(catalog, scope, selection, {source,signal,deadline,verifyCurrentSync}={}) {
  const state=catalogs.get(catalog), accountRevision=scope?.accountRevision, observation=state?.observation;
  if(!state || !(signal instanceof AbortSignal) || !Number.isFinite(deadline) || deadline>performance.now()+30000 ||
     !source || typeof source.assertCurrent!=="function" || typeof source.readModelPage!=="function" || typeof verifyCurrentSync!=="function") throw modelReadFailure("control-invalid");
  function current(){try{source.assertCurrent();return !state.closed && !signal.aborted && performance.now()<deadline && verifyCurrentSync()===true && state.verifyCurrentSync()===true && Number.isSafeInteger(accountRevision) && accountRevision>=0 && state.getAccountRevision()===accountRevision;}catch{return false;}}
  if(!current())throw modelReadFailure("source-not-current");
  if(catalog.verifySelectionSync(scope,selection))return true;
  const staged=createSharedNativeModelSelection({getAccountRevision:state.getAccountRevision,verifyCurrentSync:current});
  let bytes=0,cursor=null,timer,abortListener;
  const cursors=new Set();
  async function readPage(){
    if(!current())throw modelReadFailure("source-not-current");
    const stop=new Promise((_,reject)=>{abortListener=()=>reject(modelReadFailure("cancelled"));signal.addEventListener("abort",abortListener,{once:true});timer=setTimeout(()=>reject(modelReadFailure("deadline")),Math.max(1,deadline-performance.now()));if(signal.aborted)abortListener();});
    try{return await Promise.race([Promise.resolve().then(()=>{if(!current())throw modelReadFailure("source-not-current");return source.readModelPage(cursor);}),stop]);}
    finally{clearTimeout(timer);signal.removeEventListener("abort",abortListener);}
  }
  try{
    for(let page=0;page<5;page++){
      const result=await readPage();if(!current())throw modelReadFailure("source-not-current");
      const text=JSON.stringify(result);bytes+=typeof text==="string"?new TextEncoder().encode(text).byteLength:Infinity;
      if(bytes>2*1024*1024 || !plain(result) || !Array.isArray(result.data) || result.data.length>100 ||
         result.nextCursor!=null && (typeof result.nextCursor!=="string" || result.nextCursor.length<1 || result.nextCursor.length>4096 || /[\x00-\x1f\x7f]/.test(result.nextCursor)))throw modelReadFailure("page-invalid");
      // readModelPage already pairs its own actual RPC result internally. This
      // separate catalog ingestion does not forge an SDK request/reply envelope.
      const staging=catalogs.get(staged), additions=new Map();
      for(const entry of result.data){
        if(!plain(entry)||!atom(entry.id)||!atom(entry.model)||!Array.isArray(entry.supportedReasoningEfforts)||entry.supportedReasoningEfforts.length>16)throw modelReadFailure("page-invalid");
        const efforts=new Set();for(const effort of entry.supportedReasoningEfforts){if(!plain(effort)||!atom(effort.reasoningEffort))throw modelReadFailure("page-invalid");efforts.add(effort.reasoningEffort);}
        const value={model:entry.model,efforts};additions.set(entry.id,value);additions.set(entry.model,value);
      }
      if(staging.models.size+additions.size>512)throw modelReadFailure("catalog-budget");
      staging.revision=accountRevision;for(const[key,value]of additions)staging.models.set(key,value);
      if(staged.verifySelectionSync(scope,selection)){
        if(!current())throw modelReadFailure("source-not-current");
        // Do not replace a newer SDK observation with this asynchronous read.
        if(state.observation!==observation){if(catalog.verifySelectionSync(scope,selection)&&current())return true;throw modelReadFailure("catalog-changed");}
        state.revision=accountRevision;state.models=new Map(staging.models);state.observation++;
        return true;
      }
      if(result.nextCursor==null)throw modelReadFailure("selection-not-advertised");
      if(cursors.has(result.nextCursor))throw modelReadFailure("cursor-repeated");
      cursors.add(result.nextCursor);cursor=result.nextCursor;
    }
    throw modelReadFailure("page-budget");
  }catch(cause){if(cause?.code==="SHARED_MODEL_SELECTION_UNVERIFIED")throw cause;throw modelReadFailure("read-failed");}
  finally{staged.close();}
}
