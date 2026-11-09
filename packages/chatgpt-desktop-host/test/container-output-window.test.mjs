import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {consumeContainerOutput} from '../src/container-service.mjs';
import * as container from '../src/container-service.mjs';
import {encodeWireValue} from '../src/wire-value.mjs';

const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}};

test('native output decodes each bounded wire frame once and recognizes only the owned exit marker', () => {
  assert.equal(typeof container.decodeContainerOutput, 'function');
  const original={v:1,type:'portMessage',data:{body:'x'.repeat(1024*1024)}};
  const encoded=encodeWireValue(original), parse=JSON.parse;let parses=0, decoded;
  JSON.parse=function (...args) { parses++; return parse.apply(this,args); };
  try { decoded=container.decodeContainerOutput(encoded); }
  finally { JSON.parse=parse; }
  assert.deepEqual(decoded,original);
  assert.equal(parses,1,'large frames must not build the same JSON graph twice');
  assert.equal(container.decodeContainerOutput('{"type":"nativeExit"}'),null);
  assert.throws(()=>container.decodeContainerOutput('{"type":"nativeExit","extra":true}'));
  assert.throws(()=>container.decodeContainerOutput('{'));
  assert.throws(()=>container.decodeContainerOutput(encodeWireValue({v:1,type:'ready'})));
});

test('native exit follows preceding frames and ends the output stream', async () => {
  const messages=[1,2,3].map(id=>encodeWireValue({v:1,type:'return',id})), seen=[];
  async function* source(){yield messages[0];yield messages[1];yield '{"type":"nativeExit"}';yield messages[2];}
  await consumeContainerOutput(source(), encoded=>{
    const frame=container.decodeContainerOutput(encoded);
    if (frame===null) { seen.push('exit');return false; }
    seen.push(frame.id);
  });
  assert.deepEqual(seen,[1,2,'exit']);
});

test('an early slow receipt does not hold seven free output slots', async () => {
  const gate=deferred(),seen=[];let active=0,peak=0;
  async function* source(){for(let i=0;i<24;i++)yield i;}
  const run=consumeContainerOutput(source(),value=>{
    seen.push(value);active++;peak=Math.max(peak,active);
    const receipt=value===7?gate.promise:Promise.resolve();
    return receipt.finally(()=>active--);
  });
  try {
    for(let n=0;n<20&&seen.length<24;n++)await delay(2);
    assert.deepEqual(seen,Array.from({length:24},(_,i)=>i));
    assert.ok(peak<=8,`peak ${peak} exceeds the existing window`);
    assert.equal(active,1);
  } finally {gate.resolve();await run;}
});

test('an asynchronous failed receipt stops a blocked source without replaying frames', async () => {
  const gate=deferred(),nextGate=deferred(),seen=[];let returned=0,pulls=0;
  const source={ [Symbol.asyncIterator](){return this}, next(){pulls++;return pulls===1?Promise.resolve({value:1,done:false}):nextGate.promise}, return(){returned++;nextGate.resolve({done:true});return Promise.resolve({done:true})} };
  const run=consumeContainerOutput(source,value=>{seen.push(value);return gate.promise});
  await delay(2);gate.reject(new Error('receipt rejected'));
  try {
    const outcome=await Promise.race([run.then(()=>false,e=>e.message==='receipt rejected'),delay(100).then(()=>false)]);
    assert.equal(outcome,true,'failure must not wait on the next native read');
    assert.deepEqual(seen,[1]);assert.equal(returned,1);
  } finally {nextGate.resolve({done:true});await run.catch(()=>{});}
});

test('explicit downstream stop retains order and waits for already-owned receipts', async () => {
  const gate=deferred(),seen=[];let returned=0;
  const source={i:0,[Symbol.asyncIterator](){return this},next(){return Promise.resolve({value:this.i++,done:false})},return(){returned++;return Promise.resolve({done:true})}};
  let settled=false;
  const run=consumeContainerOutput(source,value=>{seen.push(value);return value===0?gate.promise:value===2?false:Promise.resolve()}).finally(()=>{settled=true});
  await delay(5);assert.deepEqual(seen,[0,1,2]);assert.equal(returned,1);assert.equal(settled,false);
  gate.resolve();await run;assert.equal(settled,true);
});

test('exactly eight unfinished writes stop reads and one completion admits one next frame', async () => {
  const gates=Array.from({length:10},deferred),seen=[];let pulled=0,active=0,peak=0;
  async function* source(){for(let i=0;i<10;i++){pulled++;yield i;}}
  const run=consumeContainerOutput(source(),i=>{seen.push(i);active++;peak=Math.max(peak,active);return gates[i].promise.finally(()=>active--)});
  try {
    for(let n=0;n<20&&pulled<8;n++)await delay(2);
    assert.equal(pulled,8);assert.equal(active,8);
    gates[5].resolve();for(let n=0;n<20&&pulled<9;n++)await delay(2);
    assert.equal(pulled,9);assert.equal(active,8);assert.equal(peak,8);
    assert.deepEqual(seen,Array.from({length:9},(_,i)=>i));
  } finally {for(const gate of gates)gate.resolve();await run;}
});

test('a failed source closes promptly while any previously owned receipt is safely observed', async () => {
  const gate=deferred(), seen=[];let returned=0;
  const source={i:0,[Symbol.asyncIterator](){return this},next(){if(this.i++===0)return Promise.resolve({done:false,value:4});return Promise.reject(new Error('source failed'))},return(){returned++;return Promise.resolve({done:true})}};
  const run=consumeContainerOutput(source,value=>{seen.push(value);return gate.promise});
  await assert.rejects(run,{message:'source failed'});assert.deepEqual(seen,[4]);assert.equal(returned,1);
  gate.reject(new Error('late receipt'));await delay(5);
});
