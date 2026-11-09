import test from 'node:test';
import assert from 'node:assert/strict';
import Module,{createRequire} from 'node:module';
import fs from 'node:fs';
const load=Module._load;
Module._load=function(request,...args){return request==='original-fs'?fs:Reflect.apply(load,this,[request,...args]);};
const require=createRequire(import.meta.url);
let createDefaultProjectDirectoryHandler, defaultProjectParent;
try{({createDefaultProjectDirectoryHandler,defaultProjectParent}=require('../src/native-bootstrap.cjs'));}finally{Module._load=load;}

test('an unset native default uses only the one fixed root without overwriting explicit values',()=>{
 const one=['/fixed/root'],key='defaultProjectParent';
 const store=(configured,effective,raw={})=>({get:k=>{assert.equal(k,key);return configured},getEffective:k=>{assert.equal(k,key);return effective},getDesktopConfig:()=>raw});
 assert.equal(defaultProjectParent(store(undefined,null),key,one),'/fixed/root');
 assert.equal(defaultProjectParent(store(undefined,undefined),key,[]),undefined);
 assert.equal(defaultProjectParent(store(undefined,null),key,['/fixed/a','/fixed/b']),null);
 for(const configured of ['/fixed/root','/outside','','relative',false])
  assert.equal(defaultProjectParent(store(configured,configured,{[key]:configured}),key,one),configured);
 assert.equal(defaultProjectParent(store(null,null,{[key]:null}),key,one),null);
 assert.equal(defaultProjectParent(store(undefined,null,{[key]:'relative'}),key,one),null);
 assert.equal(defaultProjectParent(store('/managed/root','/managed/root'),key,one),'/managed/root');
 assert.equal(defaultProjectParent({getEffective:()=>null},key,one),null);
 assert.equal(defaultProjectParent(undefined,key,one),undefined);
});

test('default project creation retains the exact scoped native sender and target',()=>{
 const sender={isDestroyed:()=>false},window={webContents:sender,isDestroyed:()=>false},calls=[];
 const handle=createDefaultProjectDirectoryHandler({selectWindow:()=>window,picker:{createDefault:(s,p)=>calls.push({s,p})}});
 handle('/fixed/root/project');assert.deepEqual(calls,[{s:sender,p:'/fixed/root/project'}]);
});
test('unscoped, retired and failed origins never reach the filesystem guard',()=>{
 let calls=0;
 for(const window of [undefined,null,{isDestroyed:()=>true},{isDestroyed:()=>false,webContents:{isDestroyed:()=>true}}]){
  const handle=createDefaultProjectDirectoryHandler({selectWindow:()=>window,picker:{createDefault:()=>calls++}});
  assert.throws(()=>handle('/fixed/root/project'));
 }
 assert.equal(calls,0);
 const handle=createDefaultProjectDirectoryHandler({selectWindow:()=>{throw Error('expired')},picker:{createDefault:()=>calls++}});
 assert.throws(()=>handle('/fixed/root/project'));assert.equal(calls,0);
});
