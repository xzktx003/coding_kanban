import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {isContainerRecoveryQuery} from '../src/container-recovery-wire.mjs';
const require=createRequire(import.meta.url);
const {isSharedThreadAuthorityFrame}=require('../src/shared-thread-authority-wire.cjs');
const {isDirectoryFrame}=require('../src/shared-directory-ipc.cjs');
const {isCatalogFrame}=require('../src/shared-catalog-ipc.cjs');
const {isSharedDesktopTransportFrame}=require('../src/native-shared-desktop-transport.cjs');
const {isSharedMcpFrame}=require('../src/shared-mcp-wire.cjs');

test('the native JSONL bridge admits MCP only for the explicit version 2 owner and exact frame scope',async()=>{
 const source=await readFile(process.env.CHATGPT_SHARED_NATIVE_TEST_SOURCE??new URL('../src/container-native.mjs',import.meta.url),'utf8');
 const start=source.indexOf('  let ready = false,'),end=source.indexOf('  // Deliberately retain the owned native and IPC;',start);assert.ok(start>=0&&end>start);
 const program=`(async()=>{${source.slice(start,end)}})()`;
 for(const kind of ['accepted','version1','disabled','foreign','extra']){
  const profileId=randomUUID(),generation=randomUUID(),frames=[],phases=[],listeners=new Map();let release;
  const waitInput=new Promise(resolve=>{release=resolve;});
  const frame={v:1,type:'shared-mcp-request',profileId,generation,streamId:randomUUID(),requestId:randomUUID(),method:'POST',headers:{'content-type':'application/json'},body:Buffer.from('{"jsonrpc":"2.0","id":1,"method":"tools/list"}').toString('base64')};
  if(kind==='foreign')frame.generation=randomUUID();if(kind==='extra')frame.url='http://127.0.0.1:1/forbidden';
  const native={pid:17,connected:true,on:(name,fn)=>listeners.set(name,fn),send(encoded,cb){frames.push(JSON.parse(encoded));cb();}};
  const result=vm.runInNewContext(program,{native,process:{pid:2,stdin:{destroy(){}},stdout:{on(){},write(_s,callback){callback?.();}}},
   lines:{async *[Symbol.asyncIterator](){yield* await waitInput;}},decodeWireValue:JSON.parse,writeFirstCause:phase=>phases.push(phase),
   isSharedThreadAuthorityFrame,isDirectoryFrame,isCatalogFrame,isSharedDesktopTransportFrame,isSharedMcpFrame,isContainerRecoveryQuery,
   profileId,generation,sharedEnabled:kind!=='disabled',sharedMcpEnabled:kind!=='version1',UUID:/^[a-f0-9-]{36}$/,MAX:8*1024*1024,Buffer});
  listeners.get('message')(JSON.stringify({v:1,type:'ready',profileId,generation,pid:17}));release([JSON.stringify(frame)]);await result;
  assert.equal(frames.length,kind==='accepted'?1:0,kind);
  assert.deepEqual(phases,kind==='accepted'?[]:['container_input_frame_invalid'],kind);
 }
});
