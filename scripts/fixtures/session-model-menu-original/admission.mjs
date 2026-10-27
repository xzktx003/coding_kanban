// Preparation only. No original module imports, fetch, SDK, host or native calls.
export const SYNTHETIC_STATUS_TEXT='Synthetic read-only fixture 401';
export const HEADER_NAMES=Object.freeze(['OAI-App-Brand','OAI-Language','x-openai-codex-pricing-chooser']);
export const REQUEST_KEYS=Object.freeze(['url','method','body','headers','keepalive','expectedIdentity','retry','returnErrorResponse']);
export const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const LIMITS=Object.freeze({maxWireBytes:16384,maxDiagnosticBytes:40960,maxNodes:512,maxDepth:12,maxEntries:64,maxLedgerBytes:131072,maxTransportFrames:48,maxQueuedFrames:8,handshakeMs:15000,totalMs:20000,oneReadMs:4000});
export class AdmissionError extends Error{constructor(code){super(code);this.name='AdmissionError';this.code=code;}}
export function deny(code){throw new AdmissionError(code);}
export function recordValues(value,required,optional=[]){
  if(value===null||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)deny('record-prototype');
  const descriptors=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(descriptors);
  if(keys.some(key=>typeof key!=='string'||!required.includes(key)&&!optional.includes(key))||required.some(key=>!Object.hasOwn(descriptors,key)))deny('record-keys');
  const out={};
  for(const key of keys){const d=descriptors[key];if(!Object.hasOwn(d,'value')||!d.enumerable)deny('record-accessor');out[key]=d.value;}
  return out;
}
export function boundedClone(value,{maxBytes=LIMITS.maxWireBytes}={}){
  let nodes=0;const seen=new Set();
  function copy(v,depth){
    if(++nodes>LIMITS.maxNodes||depth>LIMITS.maxDepth)deny('frame-structure-bound');
    if(v===null||v===undefined||typeof v==='boolean')return v;
    if(typeof v==='string'){if(v.length>maxBytes)deny('frame-string-bound');return v;}
    if(typeof v==='number'){if(!Number.isFinite(v))deny('frame-number');return v;}
    if(typeof v!=='object'||seen.has(v))deny('frame-non-data');
    seen.add(v);
    const array=Array.isArray(v),proto=Object.getPrototypeOf(v);
    if(proto!==(array?Array.prototype:Object.prototype))deny('frame-prototype');
    const descriptors=Object.getOwnPropertyDescriptors(v),keys=Reflect.ownKeys(descriptors);
    if(keys.some(k=>typeof k!=='string'))deny('frame-symbol');
    let out;
    if(array){
      const length=descriptors.length?.value;
      if(!Number.isSafeInteger(length)||length<0||length>64||keys.length!==length+1)deny('frame-array-bound');
      out=[];
      for(let i=0;i<length;i++){const d=descriptors[i];if(!d||!Object.hasOwn(d,'value')||!d.enumerable)deny('frame-array-accessor');out.push(copy(d.value,depth+1));}
    }else{
      if(keys.length>64)deny('frame-record-bound');out={};
      for(const key of keys){if(key==='__proto__'||key==='constructor'||key==='prototype'||key==='toJSON')deny('frame-dangerous-key');const d=descriptors[key];if(!Object.hasOwn(d,'value')||!d.enumerable)deny('frame-accessor');out[key]=copy(d.value,depth+1);}
    }
    seen.delete(v);return out;
  }
  const result=copy(value,0);
  if(new TextEncoder().encode(JSON.stringify(result,(_key,v)=>v===undefined?{$undefined:true}:v)).length>maxBytes)deny('frame-byte-bound');
  return result;
}
export function primitiveSnapshot(value){return JSON.parse(JSON.stringify(value,(_key,v)=>v===undefined?{$undefined:true}:v));}
export function assertUsageRequest(requestId,request,uploadProgress){
  if(typeof requestId!=='string'||!UUID.test(requestId))deny('request-id');
  const r=recordValues(request,REQUEST_KEYS);
  if(r.url!=='/wham/usage'||r.method!=='GET'||r.returnErrorResponse!==true||r.body!==undefined||r.keepalive!==undefined||r.expectedIdentity!==undefined||r.retry!==undefined||uploadProgress!==undefined)deny('usage-request-shape');
  const h=recordValues(r.headers,HEADER_NAMES);
  if(h['OAI-App-Brand']!=='codex'||h['OAI-Language']!=='en'||h['x-openai-codex-pricing-chooser']!=='1')deny('usage-headers');
  return Object.freeze({requestId,url:'/wham/usage',method:'GET',language:'en',returnErrorResponse:true});
}
export function classifyUsageWarning(message,{requestId,served,warningCount}){
  if(!served||warningCount!==0||!UUID.test(requestId??''))deny('warning-without-synthetic-response');
  const m=recordValues(message,['type','level','message','tags']);
  if(m.type!=='log-message'||m.level!=='warning'||m.message!=='sa_server_request_failed')deny('usage-warning-type');
  const tags=recordValues(m.tags,['safe','sensitive']);
  const safe=recordValues(tags.safe,['attachAuth','attachIntegrityState','hasRequestBody','method','requestHeaderNames','status'],['errorCode']);
  if(safe.attachAuth!==false||safe.attachIntegrityState!==false||safe.hasRequestBody!==false||safe.method!=='get'||safe.status!==401||safe.errorCode!==undefined||!Array.isArray(safe.requestHeaderNames)||safe.requestHeaderNames.length!==3||safe.requestHeaderNames.some((k,i)=>k!==HEADER_NAMES[i]))deny('usage-warning-safe');
  const sensitive=recordValues(tags.sensitive,['errorName','errorMessage','errorStack','routePattern','url']);
  if(sensitive.errorName!=='Error'||sensitive.errorMessage!==SYNTHETIC_STATUS_TEXT||typeof sensitive.errorStack!=='string'||sensitive.errorStack.length>32768||!sensitive.errorStack.startsWith(`Error: ${SYNTHETIC_STATUS_TEXT}`)||sensitive.routePattern!=='/wham/usage'||sensitive.url!=='/wham/usage')deny('usage-warning-sensitive');
  return Object.freeze({kind:'declared-synthetic-usage-negative',requestId,status:401,originalWarningRetained:true});
}
