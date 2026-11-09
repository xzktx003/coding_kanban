import test from 'node:test';
import assert from 'node:assert/strict';
import Module, { createRequire } from 'node:module';
import fs from 'node:fs';
const load=Module._load;
Module._load=function(request,...args){return request==='original-fs'?fs:Reflect.apply(load,this,[request,...args]);};
const require=createRequire(import.meta.url);
let installPrivateWindowBroadcast;
try{({installPrivateWindowBroadcast}=require('../src/native-bootstrap.cjs'));}finally{Module._load=load;}

function view(id){
 const contents={id,dead:false,isDestroyed(){return this.dead;}};
 const window={webContents:contents,dead:false,registered:true,ready:true,isDestroyed(){return this.dead;},isVisible(){return false;}};
 return {viewId:`view-${id}`,senderId:id,window,failed:false};
}
function fixture({base=[]}={}){
 let originalCalls=0;
 const records=new Map(),owners=new WeakMap(),live=new Map(),sent=[],queued=[];
 const manager={
  sendMessageToAllWindows(message){originalCalls++;for(const window of base)if(window.registered&&!window.dead)this.sendMessageToWindow(window,message);return 'original-result';},
  isAppServiceWindow(window){return window.registered;},
  isAvatarOverlayWindow(){return false;},
  sendMessageToWindow(window,message){(window.ready?sent:queued).push({window,message});},
 };
 function add(record){records.set(record.senderId,record);owners.set(record.window.webContents,record);live.set(record.viewId,record);return record;}
 return {manager,records,owners,live,sent,queued,add,base,get originalCalls(){return originalCalls;}};
}
function install(f){return installPrivateWindowBroadcast(f.manager,{getNativeWindows:()=>f.base,records:f.records,owners:f.owners,registry:{get:id=>f.live.get(id)}});}

test('original broadcast is preserved and missing registered owned views get exactly one native delivery',()=>{
 const f=fixture(),a=f.add(view(1)),b=f.add(view(2)),baseOnly=view(3);f.base.push(a.window,baseOnly.window);install(f);
 const message={type:'global-state-updated'};
 assert.equal(f.manager.sendMessageToAllWindows(message),'original-result');
 assert.equal(f.originalCalls,1);assert.deepEqual(f.sent.map(x=>x.window),[a.window,baseOnly.window,b.window]);
 assert.ok(f.sent.every(x=>x.message===message));
});

test('retired, failed, provisional, foreign and mismatched views receive no supplemental broadcast',()=>{
 const f=fixture(),good=f.add(view(1)),failed=f.add(view(2)),closed=f.add(view(3)),retired=f.add(view(4)),unregistered=f.add(view(5)),foreign=f.add(view(6)),wrongOwner=f.add(view(7));
 failed.failed=true;closed.window.dead=true;f.live.delete(retired.viewId);unregistered.window.registered=false;
 f.live.set(foreign.viewId,view(60));f.owners.set(wrongOwner.window.webContents,{});
 install(f);f.manager.sendMessageToAllWindows({type:'test'});
 assert.deepEqual(f.sent.map(x=>x.window),[good.window]);
 f.records.delete(good.senderId);f.manager.sendMessageToAllWindows({type:'test2'});
 assert.equal(f.sent.length,1);
});

test('delivery uses the original ready queue and a failed enumeration never guesses a recipient',()=>{
 const f=fixture(),a=f.add(view(1));a.window.ready=false;install(f);
 f.manager.sendMessageToAllWindows({type:'queued'});
 assert.equal(f.sent.length,0);assert.equal(f.queued.length,1);assert.equal(f.queued[0].window,a.window);
 a.window.ready=true;f.manager.sendMessageToAllWindows({type:'next'});assert.equal(f.sent.length,1);
 const g=fixture();g.add(view(2));installPrivateWindowBroadcast(g.manager,{getNativeWindows:()=>{throw Error('unknown')},records:g.records,owners:g.owners,registry:{get:id=>g.live.get(id)}});
 g.manager.sendMessageToAllWindows({type:'unknown'});assert.equal(g.originalCalls,1);assert.equal(g.sent.length,0);
});

test('a native window destroyed during iteration cannot block the other live view',()=>{
 const f=fixture(),broken=f.add(view(1)),good=f.add(view(2));broken.window.isDestroyed=()=>{throw Error('retiring')};install(f);
 f.manager.sendMessageToAllWindows({type:'test'});assert.deepEqual(f.sent.map(x=>x.window),[good.window]);
});
