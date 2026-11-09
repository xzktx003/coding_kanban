import test from 'node:test';
import assert from 'node:assert/strict';
import {installDesktopBridge} from '../src/browser-bridge.mjs';
import {encodeWireValue,decodeWireValue} from '../src/wire-value.mjs';
const scope={profileId:'43e56e8a-de3f-40fb-8cf3-7177d17d24f1',generation:'b94128f4-288c-4c97-a5cb-891555dc8199',viewId:'9d79066f-f08f-4f00-a75e-e24cc65e5d00'};
const turn=()=>new Promise(r=>setImmediate(r));
function fixture(t){
 const handlers=new Map(),sent=[],delivered=[],timers=new Map();let receive,seq=0,timerId=0,failure;
 const win={performance:{timeOrigin:1},addEventListener(k,f){handlers.set(k,f)},removeEventListener(k){handlers.delete(k)},setTimeout(fn,ms){const id=++timerId;timers.set(id,{fn,ms});return id},clearTimeout(id){timers.delete(id)}};
 const bridge=installDesktopBridge({window:win,scope,bootstrap:{windowType:'electron',getters:{},sharedObjects:{}},transport:{async send(encoded){sent.push(decodeWireValue(encoded))},subscribe(fn){receive=fn;return()=>{}},close(){}},onFailure(error){failure=error}});t.after(()=>bridge.dispose());
 const input=(value)=>receive(encodeWireValue({v:1,scope,seq:++seq,...value}));
 const port=()=>{const events=new Map(),p={addEventListener(k,f){events.set(k,f)},start(){},close(){},postMessage(data){delivered.push(data)}};handlers.get('message')({source:win,data:{type:'connect-app-host',port:p}});return{emit(n){events.get('message')({data:{request:n}})}}};
 const first=port();
 return{bridge,first,port,sent,delivered,timers,input,get failure(){return failure},run(){const entry=timers.entries().next().value;assert.ok(entry,'scheduled delivery or settlement');timers.delete(entry[0]);entry[1].fn();return entry[1].ms},data(n,id='app-host-1'){return Promise.resolve(input({type:'portMessage',portId:id,data:{reply:n}}))},ackMany(count){for(const frame of sent.filter(x=>x.type==='portPost').slice(0,count))input({type:'return',id:frame.id,value:undefined})}};
}
async function ready(t){const f=fixture(t);await turn();f.input({type:'return',id:f.sent[0].id,value:undefined});await turn();return f}
async function congest(t){const f=await ready(t);for(let n=0;n<48;n++)f.first.emit(n);await turn();assert.equal(f.sent.filter(x=>x.type==='portPost').length,32);return f}
async function finish(f,receipts){for(let n=0;n<30&&f.timers.size;n++){f.run();await turn()}await Promise.all(receipts);assert.equal(f.failure,undefined)}
test('six deferred SDK frames leave room for true receipts which drain input first',async t=>{
 const f=await congest(t),receipts=Array.from({length:6},(_,n)=>f.data(n));
 assert.equal(f.timers.size,0,'no escape timer while two native output slots remain free');assert.equal(f.delivered.length,0);
 f.ackMany(8);await turn();assert.equal(f.sent.filter(x=>x.type==='portPost').length,40);assert.equal(f.delivered.length,0,'true receipt-driven draining precedes SDK delivery');assert.equal(f.timers.size,1);
 await finish(f,receipts);assert.deepEqual(f.delivered,Array.from({length:6},(_,reply)=>({reply})));
});
test('only a full eight-data window uses one escape and then waits for the later receipts',async t=>{
 const f=await congest(t),receipts=Array.from({length:8},(_,n)=>f.data(n));
 assert.equal(f.timers.size,1);assert.equal(f.run(),8);assert.deepEqual(f.delivered,[{reply:0}]);assert.equal(f.run(),0,'settle the already delivered frame on a separate turn');await receipts[0];assert.equal(f.timers.size,0,'seven queued data frames cannot keep triggering escape');assert.equal(f.delivered.length,1);
 f.ackMany(8);await turn();await finish(f,receipts);assert.deepEqual(f.delivered,Array.from({length:8},(_,reply)=>({reply})));
});
test('a second port opens without waiting for another port deferred data',async t=>{
 const f=await congest(t),receipts=Array.from({length:6},(_,n)=>f.data(n));assert.equal(f.timers.size,0);
 const second=f.port();await turn();const opened=f.sent.filter(x=>x.type==='openPort').at(-1);assert.equal(opened.portId,'app-host-2');second.emit(100);second.emit(101);
 f.input({type:'return',id:opened.id,value:undefined});await turn();assert.equal(f.delivered.length,0,'opening remains independent of SDK data delivery');
 f.ackMany(18);await turn();assert.equal(f.sent.filter(x=>x.type==='portPost'&&x.portId==='app-host-2').length,2);await finish(f,receipts);
});
test('new input congestion cancels an already armed noncongested data timer',async t=>{
 const f=await ready(t),receipts=Array.from({length:6},(_,n)=>f.data(n));assert.equal(f.timers.size,1);
 for(let n=0;n<48;n++)f.first.emit(n);await turn();assert.equal(f.timers.size,0,'new congestion must prevent a stale delivery callback');assert.equal(f.delivered.length,0);
 f.ackMany(8);await turn();await finish(f,receipts);
});
