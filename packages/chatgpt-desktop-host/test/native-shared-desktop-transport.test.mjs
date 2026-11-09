import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {createNativeSharedDesktopTransport,isSharedDesktopTransportFrame}=require('../src/native-shared-desktop-transport.cjs');
const profileId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',generation='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function fixture(){
 const sent=[],state={current:true};
 const transport=createNativeSharedDesktopTransport({profileId,generation,verifyRuntimeSync:()=>state.current,sendFrame:frame=>sent.push(frame)});
 const host=(type,fields={})=>({v:1,type,profileId,generation,streamId:transport.streamId,...fields});
 return{sent,state,transport,host};
}

test('owned transport opens only its authenticated stream and carries actual RPC bytes without replying for the peer',async()=>{
 const f=fixture();
 try{
  const connecting=f.transport.connect();
  assert.equal(f.sent[0].type,'shared-desktop-open');
  assert.equal(f.sent.length,1);
  assert.equal(f.transport.receive(f.host('shared-desktop-ready')),true);
  const connection=await connecting;
  assert.equal(connection.readyState,1);
  assert.equal(f.transport.kind,'websocket');
  assert.equal(f.transport.supportsReconnect(),false);
  const request=JSON.stringify({id:'original-init',method:'initialize',params:{clientInfo:{name:'codex_desktop',version:'1'}}});
  connection.send(request);
  assert.equal(f.sent[1].text,request);
  assert.equal(f.sent[1].sequence,1);
  f.transport.receive(f.host('shared-desktop-written',{sequence:1}));
  const messages=[];connection.onmessage=event=>messages.push(event.data);
  const response=JSON.stringify({id:'original-init',error:{code:-32000,message:'real peer error'}});
  f.transport.receive(f.host('shared-desktop-message',{sequence:1,text:response}));
  assert.deepEqual(messages,[response]);
  assert.equal(f.sent.at(-1).type,'shared-desktop-received');
  assert.equal(f.sent.at(-1).sequence,1);
  assert.equal(f.sent.filter(frame=>frame.type==='shared-desktop-write').length,1);
 }finally{f.transport.close();}
});

test('stale scope, missing consumption, write queues and revoked runtime cannot become another connection',async()=>{
 for(const variant of ['scope','duplicate','runtime','queue']){
  const f=fixture();
  try{
   const pending=f.transport.connect();f.transport.receive(f.host('shared-desktop-ready'));const connection=await pending;
   if(variant==='scope')assert.throws(()=>f.transport.receive({...f.host('shared-desktop-message',{sequence:1,text:'{}'}),generation:profileId}));
   if(variant==='duplicate'){
    connection.onmessage=()=>{};
    f.transport.receive(f.host('shared-desktop-message',{sequence:1,text:'{}'}));
    assert.throws(()=>f.transport.receive(f.host('shared-desktop-message',{sequence:1,text:'{}'})));
   }
   if(variant==='runtime'){f.state.current=false;assert.throws(()=>connection.send('{}'));}
   if(variant==='queue'){
    for(let i=0;i<64;i++)connection.send('{}');
    assert.throws(()=>connection.send('{}'));
   }
   assert.throws(()=>connection.send('{}'));
   assert.equal(connection.readyState,3);
   assert.throws(()=>f.transport.receive(f.host('shared-desktop-ready')));
  }finally{f.transport.close();}
 }
});

test('unknown fields and accessors never select transport destinations',()=>{
 const f=fixture();
 try{
  assert.equal(isSharedDesktopTransportFrame(f.host('shared-desktop-ready'),{side:'host',profileId,generation}),true);
  assert.equal(isSharedDesktopTransportFrame({...f.host('shared-desktop-ready'),socketPath:'/not-authority'},{side:'host',profileId,generation}),false);
  let accessed=false;
  const frame={...f.host('shared-desktop-ready')};Object.defineProperty(frame,'type',{get(){accessed=true;return'shared-desktop-ready'},enumerable:true});
  assert.equal(isSharedDesktopTransportFrame(frame,{side:'host',profileId,generation}),false);
  assert.equal(accessed,false);
 }finally{f.transport.close();}
});
