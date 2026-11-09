import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSharedDaemonRpcGate} from '../src/shared-daemon-rpc-gate.mjs';
// Capabilities reconstructed from the pinned shipped SDK; no target is run.
const pinned=JSON.parse(readFileSync(new URL('./fixtures/pinned-desktop-sdk-initialize.json',import.meta.url),'utf8'));
const encode=JSON.stringify;
function fixture(initial,proof){const writes=[];let live=true,calls=0;
 const desktop={daemonVersion:'0.166.0',verifyInitializeSync:value=>value.codexHome==='/owned/home',verifyServerEventSync:()=>live};
 if(initial!==undefined)desktop.verifyInitialAccountNotificationSync=frame=>{calls++;return proof?proof(frame):initial;};
 const gate=createSharedDaemonRpcGate({verifyReadSync:()=>live,verifyBindingSync:()=>false,verifyHistorySync:()=>false,write:frame=>writes.push(frame),desktop});
 return{gate,writes,calls:()=>calls,revoke:()=>{live=false;}};
}
function ready(f,frame=pinned){f.gate.write(encode(frame));f.gate.receive(encode({id:frame.id,result:{userAgent:'codex-cli/0.166.0',codexHome:'/owned/home'}}));f.gate.write(encode({method:'initialized'}));}
const account={method:'account/updated',params:{authMode:'chatgpt'}};
const read={id:201,method:'account/read',params:{refreshToken:false}};
test('the fixed shipped SDK initialize shape passes with exact MCP UI and optional form capabilities',()=>{
 for(const dil of [false,true])for(const form of [false,true]){const f=fixture();try{const frame=structuredClone(pinned),c=frame.params.capabilities;if(!dil)c.extensions['io.modelcontextprotocol/ui'].mimeTypes.pop();if(!form)delete c.extensions['openai/elicitation'];c.mcpServerOpenaiFormElicitation=form;c.explicitGatewayOauth=dil;ready(f,frame);assert.equal(f.writes[0],encode(frame));assert.equal(f.writes.length,2);}finally{f.gate.close();}}
});
test('the fixed SDK 75-notification vector is admitted without raising ordinary list limits',()=>{
 const f=fixture();try{const frame=structuredClone(pinned);frame.params.capabilities={experimentalApi:true,optOutNotificationMethods:frame.params.capabilities.optOutNotificationMethods};assert.equal(frame.params.capabilities.optOutNotificationMethods.length,75);ready(f,frame);assert.equal(f.writes.length,2);}finally{f.gate.close();}
 const bad=structuredClone(pinned);bad.params.capabilities.optOutNotificationMethods[0]='unknown/notification';const denied=fixture();try{assert.throws(()=>denied.gate.write(encode(bad)),{code:'SHARED_DAEMON_DENIED'});assert.equal(denied.writes.length,0);}finally{denied.gate.close();}
});
test('new capability fields accept only the recorded keys, MIME sequences and empty form descriptor',()=>{
 const mutations=[c=>{c.anything=true},c=>{c.explicitGatewayOauth='true'},c=>{c.mcpServerOpenaiFormElicitation='true'},c=>{c.extensions['unknown/extension']={}},c=>{delete c.extensions['io.modelcontextprotocol/ui']},c=>{c.extensions['io.modelcontextprotocol/ui'].mimeTypes.push('application/javascript')},c=>{c.extensions['io.modelcontextprotocol/ui'].mimeTypes.reverse()},c=>{c.extensions['io.modelcontextprotocol/ui'].anything=true},c=>{c.extensions['openai/elicitation']={form:{anything:true}}},c=>{c.extensions['openai/elicitation']={form:{},url:{}}},c=>{c.mcpServerOpenaiFormElicitation=false},c=>{c.optOutNotificationMethods.push('extra/notification')}];
 for(const mutate of mutations){const frame=structuredClone(pinned);mutate(frame.params.capabilities);const f=fixture();try{assert.throws(()=>f.gate.write(encode(frame)),{code:'SHARED_DAEMON_DENIED'});assert.equal(f.writes.length,0);}finally{f.gate.close();}}
});
test('one initial account notification requires independent synchronous proof; its identical repeat revokes',()=>{
 const f=fixture(true);try{ready(f);assert.equal(f.gate.receive(encode(account)),encode(account));f.gate.write(encode(read));assert.equal(f.calls(),1);assert.equal(f.gate.receive(encode(account)),encode(account));assert.equal(f.calls(),1);assert.throws(()=>f.gate.write(encode({...read,id:202})),{code:'SHARED_DAEMON_DENIED'});}finally{f.gate.close();}
});
test('missing, false, asynchronous or revoked initial account proof keeps the original revoke behavior',()=>{
 for(const proof of [undefined,false,Promise.resolve(true)]){const f=fixture(proof);try{ready(f);assert.equal(f.gate.receive(encode(account)),encode(account));assert.throws(()=>f.gate.write(encode(read)),{code:'SHARED_DAEMON_DENIED'});}finally{f.gate.close();}}
 let f;f=fixture(true,()=>{f.revoke();return true;});try{ready(f);assert.equal(f.gate.receive(encode(account)),encode(account));assert.throws(()=>f.gate.write(encode(read)),{code:'SHARED_DAEMON_DENIED'});}finally{f.gate.close();}
});
test('account proof is never consulted before initialize/initialized, and task writes remain denied',()=>{
 const f=fixture(true);try{assert.throws(()=>f.gate.receive(encode(account)),{code:'SHARED_DAEMON_DENIED'});assert.equal(f.calls(),0);ready(f);f.gate.receive(encode(account));assert.throws(()=>f.gate.write(encode({id:202,method:'turn/start',params:{threadId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}})),{code:'SHARED_DAEMON_DENIED'});assert.equal(f.writes.length,2);}finally{f.gate.close();}
});
