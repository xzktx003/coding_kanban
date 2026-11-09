import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createSharedThreadSendAuthority} from '../src/shared-thread-send.mjs';
const require=createRequire(import.meta.url),{copySharedRpcTrace}=require('../src/shared-rpc-trace-schema.cjs'),{copySharedThreadSendFrame}=require('../src/shared-thread-send-schema.cjs');
const sample={traceparent:'00-1234567890abcdef1234567890abcdef-1234567890abcdef-01',tracestate:'vendor=value'};
test('diagnostic trace is validated separately from exact turn authorization and raw wire stays intact',()=>{
 const binding={hostId:'kanban-shared-cli',runtimeGeneration:randomUUID(),daemonGeneration:randomUUID(),accountRevision:1,projectId:'p',threadId:randomUUID(),viewId:randomUUID(),clientId:randomUUID()},view={viewId:binding.viewId};
 const authority=createSharedThreadSendAuthority({verifyBindingSync:()=>true,getOwnedView:()=>view,verifyOwnedViewSync:()=>true,verifyExplicitIntentSync:()=>true});
 const frame={id:'native-request',method:'turn/start',params:{threadId:binding.threadId,input:[{type:'text',text:'captured text'}]}},control={attemptId:randomUUID(),signal:new AbortController().signal,deadline:performance.now()+30000};
 try{authority.registerSend(binding,frame,control);const wire={...frame,trace:sample},before=JSON.stringify(wire);assert.deepEqual(copySharedThreadSendFrame(wire,binding),copySharedThreadSendFrame(frame,binding));assert.equal(authority.beforeWriteSync(wire),true);assert.equal(JSON.stringify(wire),before);assert.deepEqual(wire.trace,sample);assert.throws(()=>authority.beforeWriteSync(wire));}finally{authority.close()}
 for(const trace of [undefined,null])assert.equal(copySharedRpcTrace(trace),trace);
 for(const trace of [{...sample,extra:true},{traceparent:'00-'+ '0'.repeat(32)+'-1234567890abcdef-01'},{...sample,tracestate:'x'.repeat(513)},{...sample,tracestate:'key=value\nsecret'}])assert.throws(()=>copySharedRpcTrace(trace),{code:'SHARED_RPC_TRACE_UNSUPPORTED'});
 let getters=0;assert.throws(()=>copySharedRpcTrace({get traceparent(){getters++;return sample.traceparent}}),{code:'SHARED_RPC_TRACE_UNSUPPORTED'});assert.equal(getters,0);
});
const chunkPath=process.env.CHATGPT_TRACE_PRODUCER_CHUNK;
test('fixed original OTel injector and getActiveTraceContext produce the supported two-field trace',{skip:!chunkPath&&'Requires pinned original tracing chunk'},async()=>{
 const source=await readFile(chunkPath,'utf8');assert.equal(createHash('sha256').update(source).digest('hex'),'f717cf6c18dd50ef4adce39ccf532f4e3e740211ce8c276363175b6a5e883c22');
 const start=source.indexOf('let eL=new class{inject('),end=source.indexOf('extract(',start);assert.ok(start>=0&&end>start);const inject=source.slice(start+'let eL=new class{'.length,end);
 const marker='getActiveTraceContext:',g=source.indexOf(marker,start),h=source.indexOf(',runWithTraceContext:',g);assert.ok(g>start&&h>g);const producer=source.slice(g+marker.length,h);
 let span={traceId:'1234567890abcdef1234567890abcdef',spanId:'1234567890abcdef',traceFlags:1,traceState:{serialize:()=> 'vendor=value'}};
 const d={uP:{getSpanContext:()=>span},YA:()=>true,XV:{NONE:0},_O:{active:()=>({})},U:{set:(target,key,value)=>{target[key]=value}}};
 const eL=new Function('d','h','y','A','return ({'+inject+'});')(d,()=>false,'traceparent','tracestate'),getTrace=new Function('eL','d','return ('+producer+');')(eL,d),trace=getTrace();
 assert.deepEqual(trace,sample);assert.deepEqual(copySharedRpcTrace(trace),sample);span.traceState.serialize=()=>'';const empty=getTrace();assert.equal(empty.tracestate,'');assert.deepEqual(copySharedRpcTrace(empty),empty);span=null;assert.equal(getTrace(),null);
});
