'use strict';
const denied=()=>Object.assign(new Error('Shared RPC trace unavailable'),{code:'SHARED_RPC_TRACE_UNSUPPORTED'});
// The pinned OTel producer emits only traceparent and optional tracestate.
// This is diagnostic context, never account, task or permission authority.
function copySharedRpcTrace(value){
 if(value===undefined||value===null)return value;
 if(typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw denied();
 const names=Reflect.ownKeys(value),descriptors=Object.getOwnPropertyDescriptors(value);
 if(!names.includes('traceparent')||names.some(k=>typeof k!=='string'||!['traceparent','tracestate'].includes(k)||!Object.hasOwn(descriptors[k]??{},'value')))throw denied();
 const parent=descriptors.traceparent.value,state=descriptors.tracestate?.value;
 if(typeof parent!=='string'||!/^00-[0-9a-f]{32}-[0-9a-f]{16}-0[0-9a-f]$/.test(parent)||parent.slice(3,35)==='0'.repeat(32)||parent.slice(36,52)==='0'.repeat(16))throw denied();
 if(names.includes('tracestate')&&(typeof state!=='string'||state.length>512||!/^[\x20-\x7e]*$/.test(state)||state.trim()!==state))throw denied();
 return Object.freeze({traceparent:parent,...(names.includes('tracestate')?{tracestate:state}:{})});
}
module.exports={copySharedRpcTrace};
