import { AdmissionError, assertUsageRequest, boundedClone, classifyUsageWarning, deny, primitiveSnapshot, recordValues, REQUEST_KEYS, SYNTHETIC_STATUS_TEXT } from './admission.mjs';

const samePath=(value,path)=>Array.isArray(value)&&value.length===path.length&&value.every((part,i)=>part===path[i]);
const isUndefined=value=>Array.isArray(value)&&value.length===1&&value[0]==='undefined';
function decodeUsageRequest(encoded){
  const r=recordValues(encoded,REQUEST_KEYS),out={};
  for(const key of REQUEST_KEYS){
    const value=r[key];
    if(['body','keepalive','expectedIdentity','retry'].includes(key)){if(!isUndefined(value))deny('wire-undefined-field');out[key]=undefined;}
    else out[key]=value;
  }
  return out;
}
function operationId(value){if(!Number.isSafeInteger(value)||value<1||value>3)deny('operation-reference');return value;}

// This is an admission filter for the original Core implementation, never an RPC evaluator.
export class ClosedWirePolicy{
  #operations=new Map();#nextId=1;#servicesResolved=false;#httpExport=null;#httpReleased=false;
  #request=null;#fetchOp=null;#cancelOp=null;#warningCount=0;#stopped=false;
  #operation(id){const op=this.#operations.get(operationId(id));if(!op)deny('unknown-operation');return op;}
  #newOperation(kind){if(this.#nextId>3)deny('operation-bound');const op={id:this.#nextId++,kind,pulled:false,released:false,terminal:false};this.#operations.set(op.id,op);return op;}
  fromNative(input){
    if(this.#stopped)deny('policy-stopped');
    const f=boundedClone(input);
    if(!Array.isArray(f))deny('wire-frame');
    if(f[0]==='push'){
      if(f.length!==2||!Array.isArray(f[1]))deny('wire-push-shape');const e=f[1];
      if(e[0]!=='pipeline')deny('wire-expression-denied');
      if(e.length===3&&e[1]===0&&samePath(e[2],['services'])){
        if(this.#operations.size!==0)deny('duplicate-services-get');const op=this.#newOperation('services');return{kind:'services-get',operationId:op.id};
      }
      if(!this.#servicesResolved||e[1]!==this.#httpExport||this.#httpReleased)deny('capability-reference');
      if(e.length!==4||!Array.isArray(e[3]))deny('wire-call-shape');
      if(samePath(e[2],['fetch'])){
        if(this.#request!==null)deny('second-usage-request');
        if(e[3].length!==3||!isUndefined(e[3][2]))deny('wire-fetch-arguments');
        const value=assertUsageRequest(e[3][0],decodeUsageRequest(e[3][1]),undefined),op=this.#newOperation('fetch');
        this.#request={...value,claimed:false,cancelled:false,served:false,posted:false};this.#fetchOp=op;
        return{kind:'usage-fetch',operationId:op.id,requestId:value.requestId};
      }
      if(samePath(e[2],['cancel'])){
        if(!this.#request||this.#cancelOp||e[3].length!==1||e[3][0]!==this.#request.requestId)deny('cancel-request-identity');
        const op=this.#newOperation('cancel');this.#cancelOp=op;this.#request.cancelled=true;
        return{kind:'usage-cancel',operationId:op.id,requestId:this.#request.requestId};
      }
      deny('capability-path-denied');
    }
    if(f[0]==='pull'){
      if(f.length!==2)deny('pull-shape');const op=this.#operation(f[1]);
      if(op.pulled||op.released||op.terminal)deny('duplicate-or-late-pull');op.pulled=true;return{kind:'pull',operationId:op.id};
    }
    if(f[0]==='release'){
      if(f.length!==3||f[2]!==1)deny('release-refcount');
      if(f[1]===this.#httpExport&&this.#httpExport===-1){if(this.#httpReleased)deny('duplicate-http-release');this.#httpReleased=true;return{kind:'http-release',reference:-1};}
      const op=this.#operation(f[1]);if(op.released)deny('duplicate-release');op.released=true;return{kind:'release',operationId:op.id};
    }
    if(f[0]==='abort'){
      // Do not evaluate an abort payload. Only a primitive original Error representation is tolerated as a stop.
      const e=f[1];if(f.length!==2||!Array.isArray(e)||e[0]!=='error'||e.length<3||e.length>4||typeof e[1]!=='string'||typeof e[2]!=='string'||e[2].length>2048||e.length===4&&e[3]!==null&&typeof e[3]!=='string')deny('abort-shape');
      return{kind:'native-abort',message:e[2]};
    }
    deny('wire-command-denied');
  }
  toNative(input){
    if(this.#stopped)return{action:'drop',reason:'policy-stopped'};
    const f=boundedClone(input);
    if(!Array.isArray(f)||f.length!==3||!['resolve','reject'].includes(f[0]))deny('reverse-call-or-command');
    const op=this.#operation(f[1]);
    if(op.released||op.kind==='fetch'&&this.#request?.cancelled)return{action:'drop',reason:'released-or-cancelled',operationId:op.id};
    if(!op.pulled||op.terminal)deny('duplicate-or-unpulled-response');
    if(f[0]!=='resolve')deny('unexpected-original-reject');
    if(op.kind==='services'){
      const r=recordValues(f[2],['httpFetch']);
      if(!samePath(r.httpFetch,['export',-1]))deny('services-export-shape');
      this.#servicesResolved=true;this.#httpExport=-1;
    }else if(op.kind==='fetch'){
      if(!this.#request?.claimed)deny('response-before-callback');const r=recordValues(f[2],['response']),e=r.response;
      if(!Array.isArray(e)||e.length!==3||e[0]!=='response'||e[1]!==null)deny('response-body-shape');
      const options=recordValues(e[2],['status','statusText']);
      if(options.status!==401||options.statusText!==SYNTHETIC_STATUS_TEXT)deny('response-negative-shape');this.#request.served=true;
    }else if(op.kind==='cancel'){
      if(!isUndefined(f[2]))deny('cancel-result');
    }else deny('unknown-result');
    op.terminal=true;return{action:'deliver',kind:op.kind,operationId:op.id};
  }
  claimUsageCallback(requestId,request,signal,uploadProgress){
    if(this.#stopped||!this.#request||this.#request.requestId!==requestId||this.#request.claimed||this.#request.cancelled||this.#fetchOp.released||this.#httpReleased)deny('callback-identity-or-lifetime');
    assertUsageRequest(requestId,request,uploadProgress);
    if(typeof AbortSignal==='undefined'||!(signal instanceof AbortSignal)||signal.aborted)deny('callback-signal');
    this.#request.claimed=true;return Object.freeze({requestId,status:401});
  }
  confirmPosted(result){
    if(this.#stopped||result?.action!=='deliver')deny('post-confirmation-lifetime');
    const op=this.#operation(result.operationId);
    if(!op.terminal||op.kind!==result.kind)deny('post-confirmation-identity');
    if(op.posted)deny('duplicate-post-confirmation');
    op.posted=true;
    if(op.kind==='fetch')this.#request.posted=true;
  }
  classifyWarning(message){
    const result=classifyUsageWarning(message,{requestId:this.#request?.requestId,served:this.#request?.posted===true,warningCount:this.#warningCount});this.#warningCount++;return result;
  }
  dispose(){this.#stopped=true;}
  snapshot(){return primitiveSnapshot({stopped:this.#stopped,servicesResolved:this.#servicesResolved,httpExport:this.#httpExport,httpReleased:this.#httpReleased,operations:[...this.#operations.values()],request:this.#request,warningCount:this.#warningCount});}
}
