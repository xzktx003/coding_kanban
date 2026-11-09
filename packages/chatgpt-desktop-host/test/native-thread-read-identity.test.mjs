import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {createNativeThreadReadIdentityGuard}=createRequire(import.meta.url)('../src/native-thread-read-identity.cjs');

test('missing-thread classification cannot get a CLI pin from a renderer value, unrelated process or retired runtime',()=>{
 const state={live:true},guard=createNativeThreadReadIdentityGuard({verifyRuntimeSync:()=>state.live});
 try{
  for(const value of [null,{}, {pid:process.pid}, {getLocalProcessId:()=>process.pid,getConnectionState:()=> 'disconnected'},
   {getLocalProcessId:()=>process.pid,getConnectionState:()=> 'connected'}])assert.equal(guard.verify(value),false);
  state.live=false;assert.equal(guard.verify({getLocalProcessId:()=>process.pid,getConnectionState:()=> 'connected'}),false);
 }finally{guard.close();}
 assert.equal(guard.verify({getLocalProcessId:()=>process.pid,getConnectionState:()=> 'connected'}),false);
});
