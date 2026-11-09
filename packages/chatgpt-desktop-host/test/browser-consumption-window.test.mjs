import test from 'node:test';
import assert from 'node:assert/strict';
import {installDesktopBridge} from '../src/browser-bridge.mjs';
import {encodeWireValue,decodeWireValue} from '../src/wire-value.mjs';
const scope={profileId:'43e56e8a-de3f-40fb-8cf3-7177d17d24f1',generation:'b94128f4-288c-4c97-a5cb-891555dc8199',viewId:'9d79066f-f08f-4f00-a75e-e24cc65e5d00'};
const turn=()=>new Promise(r=>setImmediate(r));
function fixture(t,extra={}){
 const handlers=new Map(),sent=[],delivered=[],timers=new Map();let receive,sequence=0,nextTimer=0,failure,transportGate;
 const win={performance:{timeOrigin:1},addEventListener(k,f){handlers.set(k,f)},removeEventListener(k){handlers.delete(k)},setTimeout(fn,ms){const id=++nextTimer;timers.set(id,{fn,ms});return id},clearTimeout(id){timers.delete(id)}};
 const callbacks=new Map(),port={addEventListener(k,f){callbacks.set(k,f)},start(){},close(){},postMessage(data){delivered.push(data)}};
 const bridge=installDesktopBridge({...extra,window:win,scope,bootstrap:{windowType:'electron',getters:{},sharedObjects:{}},transport:{async send(encoded){sent.push(decodeWireValue(encoded));if(transportGate){const wait=transportGate;transportGate=undefined;await wait}},subscribe(f){receive=f;return()=>{}},close(){}},onFailure(e){failure=e}});t.after(()=>bridge.dispose());
 handlers.get('message')({source:win,data:{type:'connect-app-host',port}});
 const input=(frame)=>receive(encodeWireValue({v:1,scope,seq:++sequence,...frame}));
 return {win,sent,delivered,timers,bridge,input,holdNextTransport(){let resolve;transportGate=new Promise(r=>{resolve=r});return resolve},get failure(){return failure},emit(n){callbacks.get('message')({data:{request:n}})},emitData(data){callbacks.get('message')({data})},runTimer(){const first=timers.entries().next().value;assert.ok(first,'pending data timer');timers.delete(first[0]);first[1].fn();return first[1].ms}};
}
async function congest(t){const f=fixture(t);await turn();f.input({type:'return',id:f.sent[0].id,value:undefined});await turn();for(let n=0;n<48;n++)f.emit(n);await turn();assert.equal(f.sent.filter(x=>x.type==='portPost').length,32);return f}
test('SDK data waits at input congestion while real post receipts bypass that window',async t=>{
 const f=await congest(t),done=[];
 for(let n=0;n<8;n++)done.push(Promise.resolve(f.input({type:'portMessage',portId:'app-host-1',data:{reply:n}})));
 assert.equal(f.delivered.length,0,'native SDK data must not amplify a congested producer immediately');
 for(const p of f.sent.filter(x=>x.type==='portPost'))f.input({type:'return',id:p.id,value:undefined});
 await turn();assert.equal(f.sent.filter(x=>x.type==='portPost').length,48,'true native receipts must release producer capacity before data delivery');
 for(let n=0;n<8;n++){f.runTimer();await turn()}
 f.runTimer();await Promise.all(done);assert.deepEqual(f.delivered,Array.from({length:8},(_,reply)=>({reply})));assert.equal(f.failure,undefined);
});
test('eight data frames ahead of a future receipt retain paced progress without starving receipts',async t=>{
 const f=await congest(t),done=[];
 for(let n=0;n<8;n++)done.push(Promise.resolve(f.input({type:'portMessage',portId:'app-host-1',data:n})));
 assert.equal(f.delivered.length,0);
 assert.equal(f.runTimer(),8);await turn();assert.deepEqual(f.delivered,[0],'a full native output window releases only the oldest data frame');
 assert.equal(f.runTimer(),0,'the delivered frame settles independently of producer congestion');await done[0];
 assert.equal(f.timers.size,1,'seven deferred frames still leave room for a later real receipt and retain paced progress');
 assert.equal([...f.timers.values()][0].ms,8,'completion must not forward another pressured frame at zero delay');
 const posts=f.sent.filter(x=>x.type==='portPost');
 f.input({type:'return',id:posts[0].id,value:undefined});await turn();
 assert.equal(f.sent.filter(x=>x.type==='portPost').length,33);assert.equal([...f.timers.values()][0].ms,8,'one real receipt pumps input but leaves data at the pressure cadence');
 for(const post of posts.slice(1,8))f.input({type:'return',id:post.id,value:undefined});await turn();
 assert.equal(f.sent.filter(x=>x.type==='portPost').length,40,'real receipts drain waiting input to the low watermark before more SDK delivery');assert.deepEqual(f.delivered,[0]);
 for(let n=1;n<8;n++){assert.equal(f.runTimer(),0);await turn();assert.equal(f.delivered.length,n+1,'remaining data resumes in FIFO order after the input drain')}
 assert.equal(f.runTimer(),0);await Promise.all(done);assert.deepEqual(f.delivered,[0,1,2,3,4,5,6,7]);assert.equal(f.timers.size,0);assert.equal(f.failure,undefined);
});

test('a partial document window cannot hold the shared reader behind producer congestion',async t=>{
 const f=await congest(t),done=[];
 for(let n=0;n<4;n++)done.push(Promise.resolve(f.input({type:'portMessage',portId:'app-host-1',data:n})));
 assert.equal(f.delivered.length,0);
 for(let n=0;n<4;n++){
  assert.equal(f.runTimer(),8,'a shared reader may hold other documents, so a partial document must still make paced progress');
  assert.deepEqual(f.delivered,Array.from({length:n+1},(_,i)=>i));
  assert.equal(f.runTimer(),0,'only actual MessagePort handoff followed by another turn may settle consumption');
  await done[n];
 }
 assert.equal(f.timers.size,0);
 const usage=f.bridge.getResourceUsage();
 assert.equal(usage.inFlightPortPosts,32);
 assert.ok(usage.peakHeldLogicalBytes<=8*1024*1024);
 assert.deepEqual(f.delivered,[0,1,2,3]);
 assert.equal(f.failure,undefined);
});
test('closing a document releases deferred receipts and cancels its progress timer',async t=>{
 const f=await congest(t);const receipt=Promise.resolve(f.input({type:'portMessage',portId:'app-host-1',data:'owned'}));
 assert.equal(f.delivered.length,0);f.bridge.dispose();await assert.rejects(receipt,{code:'BRIDGE_CLOSED'});assert.equal(f.timers.size,0);assert.equal(f.delivered.length,0);
});

async function ready(t,extra){const f=fixture(t,extra);await turn();f.input({type:'return',id:f.sent[0].id,value:undefined});await turn();return f}
test('deferred native bytes share the existing ceiling when a new input snapshot arrives',async t=>{
 const f=await ready(t,{maxQueuedBytes:4096});
 const receipt=Promise.resolve(f.input({type:'portMessage',portId:'app-host-1',data:{body:'n'.repeat(2200)}}));
 f.emitData({body:'o'.repeat(2200)});
 assert.equal(f.failure?.code,'BRIDGE_QUEUE_FULL');assert.equal(f.failure?.limitKind,'snapshot_bytes');
 await assert.rejects(receipt,{code:'BRIDGE_QUEUE_FULL'});
});
test('retained input snapshots share the same ceiling when native data arrives later',async t=>{
 const f=await ready(t,{maxQueuedBytes:4096});f.emitData({body:'o'.repeat(2200)});await turn();
 assert.equal(f.failure,undefined);
 f.input({type:'portMessage',portId:'app-host-1',data:{body:'n'.repeat(2200)}});
 assert.equal(f.failure?.code,'BRIDGE_QUEUE_FULL');assert.equal(f.failure?.limitKind,'native_output_bytes');
});
test('an encoded port frame and its retained snapshot consume one logical payload reservation',async t=>{
 const f=await ready(t,{maxQueuedBytes:4096});
 f.emitData({body:'o'.repeat(2600)});
 assert.equal(f.failure,undefined,'do not count both the snapshot and the encoded copy as independent payloads');
 await turn();const post=f.sent.find(x=>x.type==='portPost');assert.ok(post);f.input({type:'return',id:post.id,value:undefined});await turn();
 const receipt=Promise.resolve(f.input({type:'portMessage',portId:'app-host-1',data:{body:'n'.repeat(2600)}}));
 assert.equal(f.failure,undefined,'real native receipt releases the retained input reservation');f.runTimer();f.runTimer();await receipt;
});

test('an ordinary queued call cannot grow beside already deferred native data past the ceiling',async t=>{
 const f=await ready(t,{maxQueuedBytes:4096}),receipt=Promise.resolve(f.input({type:'portMessage',portId:'app-host-1',data:{body:'n'.repeat(2200)}}));
 await assert.rejects(f.win.electronBridge.sendMessageFromView({body:'o'.repeat(2200)}),{code:'BRIDGE_QUEUE_FULL',limitKind:'queued_bytes'});await assert.rejects(receipt,{code:'BRIDGE_QUEUE_FULL'});
});
test('native receipt before transport completion removes only the actual snapshot overlap',async t=>{
 const f=await ready(t,{maxQueuedBytes:4096}),release=f.holdNextTransport();
 f.emitData({body:'o'.repeat(2200)});const post=f.sent.find(x=>x.type==='portPost');assert.ok(post);
 f.input({type:'return',id:post.id,value:undefined});await turn();
 f.input({type:'portMessage',portId:'app-host-1',data:{body:'n'.repeat(2200)}});
 assert.equal(f.failure?.code,'BRIDGE_QUEUE_FULL');assert.equal(f.failure?.limitKind,'native_output_bytes','the still-queued encoded frame remains fully charged after the early native receipt');release();await turn();
});
