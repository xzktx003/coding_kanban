import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm, writeFile, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { adaptCoreBridgeDiagnostic, adaptCoreEntryDiagnostic, adaptCoreNativeBootstrapDiagnostic, adaptCoreNativeViewDiagnostic, adaptCoreNativeStderrDiagnostic, createCoreNativeStderrObserver, createCoreDiagnosticJournal, selectCoreDiagnosticAsset, wrapCoreUpstream, coreDiagnosticMayCreateProject, summarizeCoreWireGraph } from './chatgpt-desktop-core-diagnostic.mjs';
import { runInNewContext, Script } from 'node:vm';

const source=process.env.CORE_DIAGNOSTIC_SNAPSHOT;
test('diagnostic adapters require the exact frozen entry and bridge',async()=>{
 assert.ok(source,'provide CORE_DIAGNOSTIC_SNAPSHOT');
 const bridge=await readFile(join(source,'packages/chatgpt-desktop-host/src/browser-bridge.mjs'));
 const entry=await readFile(join(source,'packages/chatgpt-desktop-host/src/browser-entry.mjs'));
 for(const [adapt,input] of [[adaptCoreBridgeDiagnostic,bridge],[adaptCoreEntryDiagnostic,entry]]){
  const result=adapt(input);assert.notEqual(result.adaptedSha256,result.originalSha256);assert.ok(result.body.length>input.length);
  assert.throws(()=>adapt(Buffer.concat([input,Buffer.from('x')])));
 }
});

test('an explicitly pinned reviewed source may be adapted but unknown bytes still fail closed',async()=>{
 assert.ok(source,'provide CORE_DIAGNOSTIC_SNAPSHOT');
 const body=Buffer.concat([await readFile(join(source,'packages/chatgpt-desktop-host/src/browser-bridge.mjs')),Buffer.from('\n// fixed fixture marker\n')]);
 const {createHash}=await import('node:crypto'),sha=createHash('sha256').update(body).digest('hex');
 assert.throws(()=>adaptCoreBridgeDiagnostic(body));
 assert.equal(adaptCoreBridgeDiagnostic(body,sha).originalSha256,sha);
 assert.throws(()=>adaptCoreBridgeDiagnostic(body,'a'.repeat(64)));
});

test('intentional bridge timeout records its own frame and original reason',async()=>{
 assert.ok(source,'provide CORE_DIAGNOSTIC_SNAPSHOT');
 const base=await mkdtemp(join(tmpdir(),'core-diag-unit-'));
 try{
  const original=await readFile(join(source,'packages/chatgpt-desktop-host/src/browser-bridge.mjs'));
  await writeFile(join(base,'browser-bridge.mjs'),adaptCoreBridgeDiagnostic(original).body);
  await copyFile(join(source,'packages/chatgpt-desktop-host/src/wire-value.mjs'),join(base,'wire-value.mjs'));
  const {installDesktopBridge}=await import(pathToFileURL(join(base,'browser-bridge.mjs')).href);
  const events=[];globalThis[Symbol.for('cg.fixture.bridge.trace')]=e=>events.push(e);
  const win={performance:{timeOrigin:0},addEventListener(){},removeEventListener(){}};
  let reason;const transport={send:async()=>{},subscribe:()=>()=>{},close(){}};
  installDesktopBridge({window:win,scope:{profileId:'11111111-1111-1111-1111-111111111111',generation:'22222222-2222-2222-2222-222222222222',viewId:'33333333-3333-3333-3333-333333333333'},bootstrap:{getters:{},sharedObjects:{}},transport,onFailure:e=>{reason=e},requestTimeoutMs:15});
  await assert.rejects(win.electronBridge.sendMessageFromView({type:'test-only',content:'NEVER_LOG'}),e=>e.code==='BRIDGE_OUTCOME_UNKNOWN');
  const created=events.find(x=>x.event==='create'),timeout=events.find(x=>x.event==='timeout'),stopped=events.find(x=>x.event==='stop');
  assert.equal(reason.code,'BRIDGE_OUTCOME_UNKNOWN');assert.equal(created.type,'call');assert.equal(created.method,'sendMessageFromView');assert.equal(created.messageType,'test-only');assert.equal(timeout.id,created.id);assert.equal(stopped.code,'BRIDGE_OUTCOME_UNKNOWN');
  assert.ok(events.some(x=>x.event==='enqueue'&&x.id===created.id));assert.ok(events.some(x=>x.event==='dispatch'&&x.id===created.id));
  assert.equal(JSON.stringify(events).includes('NEVER_LOG'),false);
 }finally{delete globalThis[Symbol.for('cg.fixture.bridge.trace')];await rm(base,{recursive:true,force:true})}
});

test('journal pins first error and retains only a bounded tail',()=>{
 const journal=createCoreDiagnosticJournal();journal.record('pageerror',{message:'first error',stack:'first stack'});
 for(let i=0;i<300;i++)journal.record('console',{text:'x'.repeat(4000)});
 const result=journal.snapshot();assert.equal(result.firstError.value.message,'first error');assert.ok(result.dropped>0);assert.ok(Buffer.byteLength(JSON.stringify(result))<=128*1024);
});

test('private launch journal retains a bounded fixed error code alongside the first message',()=>{
 const journal=createCoreDiagnosticJournal();journal.record('launch',{message:'cleanup-native: unavailable',stack:'test stack',code:'CONTAINER_HOST_UNAVAILABLE'});
 assert.equal(journal.snapshot().firstError.value.code,'CONTAINER_HOST_UNAVAILABLE');
});

test('private exception journal retains the first bounded original name, message and stack per phase',()=>{
 const journal=createCoreDiagnosticJournal();journal.record('pageerror',{message:'earlier unrelated page error',stack:'page'});
 for(const phase of ['json','rpc','project','readback']){const error=new TypeError(phase+' initial '+ 'x'.repeat(5000));error.stack=phase+' stack '+ 'y'.repeat(5000);assert.equal(journal.recordException(phase,error),true);assert.equal(journal.recordException(phase,new Error('later')),false);}
 journal.recordException('unexpected',new Error('not accepted'));
 for(const phase of ['json','rpc','project','readback']){const first=journal.snapshot().firstExceptions[phase];assert.equal(first.name,'TypeError');assert.match(first.message,new RegExp('^'+phase+' initial'));assert.match(first.stack,new RegExp('^'+phase+' stack'));assert.ok(first.message.length<=1024);assert.ok(first.stack.length<=2048);}
 assert.equal(journal.snapshot().firstExceptions.unexpected,undefined);assert.ok(Buffer.byteLength(JSON.stringify(journal.snapshot()))<128*1024);
});

test('private journal stays bounded even when error strings need JSON escaping',()=>{
 const journal=createCoreDiagnosticJournal();journal.record('pageerror',{name:'Error',message:'\u0000'.repeat(12000),stack:'\u0000'.repeat(12000)});
 for(const phase of ['json','rpc','project','readback'])journal.recordException(phase,{name:'Error',message:'\u0000'.repeat(12000),stack:'\u0000'.repeat(12000)});
 for(let i=0;i<200;i++)journal.record('console',{text:'\u0000'.repeat(8000)});
 assert.ok(Buffer.byteLength(JSON.stringify(journal.snapshot()))<=128*1024);
});

test('diagnostic response copies match only the exact fixture origin and view',()=>{
 const origin='https://10.1.2.3:8443',view='/chatgpt-desktop/profile/generation/webview/index.html';
 assert.equal(selectCoreDiagnosticAsset(origin+'/chatgpt-desktop/profile/generation/webview/__host/browser-entry.mjs',origin,view),'entry');
 assert.equal(selectCoreDiagnosticAsset(origin+'/chatgpt-desktop/profile/generation/webview/__host/browser-bridge.mjs',origin,view),'bridge');
 for(const url of ['https://else.invalid/chatgpt-desktop/profile/generation/webview/__host/browser-entry.mjs',origin+'/chatgpt-desktop/other/generation/webview/__host/browser-entry.mjs',origin+'/chatgpt-desktop/profile/generation/webview/__host/browser-entry.mjs?other=1'])assert.equal(selectCoreDiagnosticAsset(url,origin,view),null);
});

test('diagnostic account observation cannot create a project or send a model turn',()=>{
 assert.equal(coreDiagnosticMayCreateProject(true),false);assert.equal(coreDiagnosticMayCreateProject(false),true);
 for(const value of [undefined,null,1,'false',{}])assert.equal(coreDiagnosticMayCreateProject(value),false);
});

test('native diagnostic copies are fixed-hash gated',async()=>{
 for(const [name,adapt] of [['native-bootstrap.cjs',adaptCoreNativeBootstrapDiagnostic],['native-view-shim.js',adaptCoreNativeViewDiagnostic]]){
  const input=await readFile(join(source,'packages/chatgpt-desktop-host/src',name)),out=adapt(input);assert.notEqual(out.originalSha256,out.adaptedSha256);new Script(out.body.toString('utf8'));assert.throws(()=>adapt(Buffer.concat([input,Buffer.from('x')])));
 }
});

test('native stderr probe preserves the drain and records only bounded fixed error categories',async()=>{
 const input=await readFile(join(source,'packages/chatgpt-desktop-host/src/container-native.mjs')),{createHash}=await import('node:crypto'),pin=createHash('sha256').update(input).digest('hex'),out=adaptCoreNativeStderrDiagnostic(input,pin);
 assert.notEqual(out.originalSha256,out.adaptedSha256);assert.match(out.body.toString(),/native\.stderr\?\.resume\(\)/);assert.throws(()=>adaptCoreNativeStderrDiagnostic(input,'a'.repeat(64)));
 const rows=[],probe=createCoreNativeStderrObserver(x=>rows.push(x));probe.push(Buffer.from('private SECRET inotify_init1 errno '));probe.push(Buffer.from('24 EMFILE\nregular message\n'));probe.flush();
 assert.equal(rows.length,1);assert.deepEqual(rows[0],{event:'resource-error',emfile:true,inotify:true,errno24:true});assert.doesNotMatch(JSON.stringify(rows),/SECRET|private/);
});

test('fixture service accepts only the pinned observed launcher via one exact SHA substitution',async()=>{
 const mod=await import('./chatgpt-desktop-core-diagnostic.mjs');
 const {createHash}=await import('node:crypto');const h=b=>createHash('sha256').update(b).digest('hex');
 const service=await readFile(join(source,'packages/chatgpt-desktop-host/src/container-service.mjs'));
 const native=await readFile(join(source,'packages/chatgpt-desktop-host/src/container-native.mjs'));
 const observed=adaptCoreNativeStderrDiagnostic(native,h(native));
 const result=mod.adaptCoreNativeStderrServiceDiagnostic(service,h(service),h(native),observed.adaptedSha256);
 const expected=service.toString().replace('"container-native.mjs":\n    "'+h(native)+'"','"container-native.mjs":\n    "'+observed.adaptedSha256+'"');
 assert.equal(result.body.toString(),expected);assert.notEqual(result.originalSha256,result.adaptedSha256);
 assert.throws(()=>mod.adaptCoreNativeStderrServiceDiagnostic(service,'a'.repeat(64),h(native),observed.adaptedSha256));
 assert.throws(()=>mod.adaptCoreNativeStderrServiceDiagnostic(service,h(service),'b'.repeat(64),observed.adaptedSha256));
});

test('synthetic lost shim call records start without a false settle or return',async()=>{
 const input=await readFile(join(source,'packages/chatgpt-desktop-host/src/native-view-shim.js')),script=adaptCoreNativeViewDiagnostic(input).body.toString('utf8');let receiver;const logs=[],emits=[];
 const window={__kanbanOwnedControl:{emit:x=>emits.push(x),subscribe:f=>{receiver=f}},electronBridge:{sendMessageFromView:()=>new Promise(()=>{})},addEventListener(){},location:{origin:'app://-'}};
 runInNewContext(script,{window,TextEncoder,console:{debug:x=>logs.push(x)},performance});
 void receiver({type:'call',id:321,method:'sendMessageFromView',args:[{type:'local-thread-activity-changed',privateText:'NEVER_LOG'}]});await new Promise(resolve=>setTimeout(resolve,5));
 const rows=logs.map(x=>JSON.parse(x.slice('@@CGTRACE:'.length)));assert.ok(rows.some(x=>x.event==='await-start'&&x.id===321&&x.messageType==='local-thread-activity-changed'));assert.equal(rows.some(x=>x.event==='await-resolved'&&x.id===321),false);assert.equal(emits.some(x=>x.id===321),false);assert.equal(JSON.stringify(rows).includes('NEVER_LOG'),false);
});

test('observing a resolved shim call preserves the original return value',async()=>{
 const input=await readFile(join(source,'packages/chatgpt-desktop-host/src/native-view-shim.js')),script=adaptCoreNativeViewDiagnostic(input).body.toString('utf8');let receiver;const logs=[],emits=[];
 const window={__kanbanOwnedControl:{emit:x=>emits.push(x),subscribe:f=>{receiver=f}},electronBridge:{sendMessageFromView:async()=>({secret:'RETURN_VALUE'})},addEventListener(){},location:{origin:'app://-'}};
 runInNewContext(script,{window,TextEncoder,console:{debug:x=>logs.push(x)},performance});
 await receiver({type:'call',id:322,method:'sendMessageFromView',args:[{type:'local-thread-activity-changed'}]});
 const rows=logs.map(x=>JSON.parse(x.slice('@@CGTRACE:'.length)));assert.ok(rows.some(x=>x.event==='await-resolved'&&x.id===322));assert.ok(rows.some(x=>x.event==='emit-sent'&&x.id===322));assert.equal(emits[0].value.secret,'RETURN_VALUE');assert.equal(JSON.stringify(rows).includes('RETURN_VALUE'),false);
});

test('upstream wrapper identifies a dispatched write whose peer never replies',async()=>{
 const rows=[];let receiver;const target={upstream:{explicitDispatch:true,async send(_encoded,control){control.onDispatch();return new Promise(()=>{})},subscribe(fn){receiver=fn;return ()=>{}}},containerId:'fixture',verifyIdentity:async()=>true};
 const wrapper=wrapCoreUpstream(target,x=>rows.push(x));const controller=new AbortController();void wrapper.upstream.send('{"v":1}',{signal:controller.signal,deadline:performance.now()+1000,onDispatch(){}});await new Promise(resolve=>setTimeout(resolve,5));
 assert.ok(rows.some(x=>x.event==='upstream-send'));assert.ok(rows.some(x=>x.event==='upstream-dispatch'));assert.equal(rows.some(x=>x.event==='upstream-resolved'),false);
 wrapper.upstream.subscribe(()=>{});receiver('{"v":1}');assert.ok(rows.some(x=>x.event==='upstream-frame'));
});

test('upstream observation preserves the original control, values and nonenumerable identity',async()=>{
 const rows=[],controller=new AbortController(),deadline=performance.now()+1000;let dispatched=0,subscribed;
 const target={upstream:{explicitDispatch:true,async send(value,control){assert.equal(value,'encoded');assert.equal(control.signal,controller.signal);assert.equal(control.deadline,deadline);control.onDispatch();return 'original-result'},subscribe(fn){subscribed=fn;return ()=>{}}}};
 Object.defineProperty(target,'containerId',{value:'same-owned-container'});Object.freeze(target);
 const wrapper=wrapCoreUpstream(target,x=>rows.push(x));assert.equal(wrapper.containerId,'same-owned-container');assert.equal(Object.keys(wrapper).includes('containerId'),false);
 assert.equal(await wrapper.upstream.send('encoded',{signal:controller.signal,deadline,onDispatch(){dispatched++}}),'original-result');assert.equal(dispatched,1);
 let value;wrapper.upstream.subscribe(x=>{value=x});subscribed('incoming');assert.equal(value,'incoming');assert.ok(rows.some(x=>x.event==='upstream-resolved'));
});

test('combined fixture localizes a delivered request to an unresolved native bridge call',async()=>{
 const input=await readFile(join(source,'packages/chatgpt-desktop-host/src/native-view-shim.js')),script=adaptCoreNativeViewDiagnostic(input).body.toString('utf8');const {encodeWireValue}=await import(pathToFileURL(join(source,'packages/chatgpt-desktop-host/src/wire-value.mjs')).href);
 let receiver;const shim=[],transport=[],emitted=[];const frame={type:'call',id:321,method:'sendMessageFromView',args:[{type:'local-thread-activity-changed',text:'NEVER_LOG'}]};
 const window={__kanbanOwnedControl:{emit:x=>emitted.push(x),subscribe:f=>{receiver=f}},electronBridge:{sendMessageFromView:()=>new Promise(()=>{})},addEventListener(){},location:{origin:'app://-'}};
 runInNewContext(script,{window,TextEncoder,console:{debug:x=>shim.push(JSON.parse(x.slice('@@CGTRACE:'.length)))},performance});
 const target={upstream:{explicitDispatch:true,async send(_encoded,control){control.onDispatch();void receiver(frame)},subscribe(){return ()=>{}}}};const observed=wrapCoreUpstream(target,x=>transport.push(x));
 await observed.upstream.send(encodeWireValue({v:1,...frame}),{signal:new AbortController().signal,deadline:performance.now()+1000,onDispatch(){}});await new Promise(resolve=>setTimeout(resolve,5));
 assert.ok(transport.some(x=>x.event==='upstream-dispatch'&&x.id===321&&x.type==='call'));assert.ok(transport.some(x=>x.event==='upstream-resolved'&&x.id===321));assert.ok(shim.some(x=>x.event==='await-start'&&x.id===321&&x.messageType==='local-thread-activity-changed'));assert.equal(shim.some(x=>x.event==='await-resolved'&&x.id===321),false);assert.equal(emitted.some(x=>x.id===321),false);assert.equal(JSON.stringify({shim,transport}).includes('NEVER_LOG'),false);
});

test('transport observation records frame id and safe type without content',async()=>{
 const {encodeWireValue}=await import(pathToFileURL(join(source,'packages/chatgpt-desktop-host/src/wire-value.mjs')).href),input=JSON.parse(encodeWireValue({v:1,type:'call',id:396,method:'sendMessageFromView',args:[{type:'keyboard-layout-map-changed',content:'NEVER_LOG'}]}));
 const meta=summarizeCoreWireGraph(input);assert.deepEqual(meta,{type:'call',id:396,method:'sendMessageFromView',messageType:'keyboard-layout-map-changed'});assert.equal(JSON.stringify(meta).includes('NEVER_LOG'),false);
});
