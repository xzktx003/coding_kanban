import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {randomBytes,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
const {createNativeSharedMcpRelay}=createRequire(import.meta.url)('../src/native-shared-mcp-relay.cjs');
const metadata={enabled:true,enabled_tools:[],omit_tools_from:['deferred'],default_tools_approval_mode:'prompt',startup_timeout_sec:10,tool_timeout_sec:3600};
const until=async fn=>{const end=Date.now()+1500;while(!fn()){if(Date.now()>end)throw Error('relay deadline');await new Promise(resolve=>setTimeout(resolve,5));}};

test('MCP relay invokes the selected original session builder and forwards its actual HTTP response without a fake tool result',async t=>{
 const profileId=randomUUID(),generation=randomUUID(),streamId=randomUUID(),token=randomBytes(32).toString('base64url'),seen=[],sent=[];
 const server=createServer((req,res)=>{const parts=[];req.on('data',part=>parts.push(part));req.on('end',()=>{seen.push({url:req.url,authorization:req.headers.authorization,body:Buffer.concat(parts).toString()});res.writeHead(403,{'content-type':'application/json','mcp-session-id':randomUUID()});res.end('{"original":"denied"}');});});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const config={...metadata,url:`http://127.0.0.1:${server.address().port}/mcp`,http_headers:{Authorization:`Bearer ${token}`}},options={hostId:'kanban-shared-cli',handlers:{callTool(){},listTools(){}}};let builds=0,disposed=0;
 const relay=createNativeSharedMcpRelay({profileId,generation,streamId,verifyRuntimeSync:()=>true,sendFrame:frame=>sent.push(frame)});t.after(()=>relay.close());
 const preparing=relay.prepare(async value=>{assert.equal(value,options);builds++;return{mcpServerConfig:config,dispose:()=>{disposed++;}};},options);
 await until(()=>sent.length===1);const registration=sent[0];assert.equal(registration.type,'shared-mcp-register');assert.deepEqual(registration.config,metadata);assert.equal(JSON.stringify(registration).includes(token),false);
 const proxy={...metadata,url:'http://127.0.0.1:12345/mcp',http_headers:{Authorization:`Bearer ${randomBytes(32).toString('base64url')}`}};
 relay.receive({...registration,type:'shared-mcp-config',config:proxy});assert.deepEqual(await preparing,proxy);assert.equal(builds,1);
 const requestId=randomUUID(),body=JSON.stringify({jsonrpc:'2.0',id:'tool',method:'tools/list'});
 relay.receive({v:1,type:'shared-mcp-request',profileId,generation,streamId,requestId,method:'POST',headers:{'content-type':'application/json'},body:Buffer.from(body).toString('base64')});
 await until(()=>sent.some(frame=>frame.type==='shared-mcp-response'));
 const response=sent.find(frame=>frame.type==='shared-mcp-response');assert.equal(response.status,403);assert.equal(Buffer.from(response.body,'base64').toString(),'{"original":"denied"}');
 assert.deepEqual(seen,[{url:'/mcp',authorization:`Bearer ${token}`,body}]);relay.close();assert.equal(disposed,1);
});


test('MCP tool HTTP is blocked when the captured account scope has changed, including before a late reply',async t=>{
 const profileId=randomUUID(),generation=randomUUID(),streamId=randomUUID(),sent=[];let live=true,requests=0,resume;
 const server=createServer((req,res)=>{requests++;resume=()=>{res.writeHead(200,{'content-type':'application/json'});res.end('{"jsonrpc":"2.0","id":1,"result":{}}');};req.resume();});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});
 const config={...metadata,url:`http://127.0.0.1:${server.address().port}/mcp`,http_headers:{Authorization:'Bearer '+'A'.repeat(43)}};
 const relay=createNativeSharedMcpRelay({profileId,generation,streamId,verifyRuntimeSync:()=>true,verifyRequestSync:()=>live,sendFrame:frame=>sent.push(frame)});t.after(()=>relay.close());
 const preparing=relay.prepare(async()=>({mcpServerConfig:config,dispose(){}}),{hostId:'kanban-shared-cli',handlers:{callTool(){},listTools(){}}});
 await until(()=>sent.length===1);relay.receive({...sent[0],type:'shared-mcp-config',config});await preparing;
 relay.receive({v:1,type:'shared-mcp-request',profileId,generation,streamId,requestId:randomUUID(),method:'POST',headers:{'content-type':'application/json'},body:Buffer.from('{"jsonrpc":"2.0","id":1,"method":"tools/list"}').toString('base64')});
 await until(()=>requests===1);live=false;resume();await new Promise(resolve=>setTimeout(resolve,30));
 assert.equal(sent.filter(frame=>frame.type==='shared-mcp-response').length,0);
 assert.throws(()=>relay.receive({v:1,type:'shared-mcp-request',profileId,generation,streamId,requestId:randomUUID(),method:'POST',headers:{},body:''}));assert.equal(requests,1);
});

test('an owned cancellation before dispatch tombstones only its nonce and cannot start a late HTTP request',async t=>{
 const profileId=randomUUID(),generation=randomUUID(),streamId=randomUUID(),sent=[];let requests=0;
 const server=createServer((req,res)=>{requests++;req.resume();res.writeHead(403);res.end();});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const config={...metadata,url:`http://127.0.0.1:${server.address().port}/mcp`,http_headers:{Authorization:'Bearer '+'A'.repeat(43)}};
 const relay=createNativeSharedMcpRelay({profileId,generation,streamId,verifyRuntimeSync:()=>true,sendFrame:frame=>sent.push(frame)});t.after(()=>relay.close());
 const preparing=relay.prepare(async()=>({mcpServerConfig:config,dispose(){}}),{hostId:'kanban-shared-cli',handlers:{callTool(){},listTools(){}}});await until(()=>sent.length===1);relay.receive({...sent[0],type:'shared-mcp-config',config});await preparing;
 const cancelled=randomUUID();assert.equal(relay.receive({v:1,type:'shared-mcp-cancel',profileId,generation,streamId,requestId:cancelled}),true);
 assert.equal(relay.receive({v:1,type:'shared-mcp-cancel',profileId,generation,streamId,requestId:cancelled}),true);assert.equal(requests,0);
 const live=randomUUID(),request={v:1,type:'shared-mcp-request',profileId,generation,streamId,requestId:live,method:'POST',headers:{'content-type':'application/json'},body:Buffer.from('{"jsonrpc":"2.0","id":1,"method":"tools/list"}').toString('base64')};
 assert.equal(relay.receive(request),true);await until(()=>sent.some(frame=>frame.type==='shared-mcp-response'));assert.equal(requests,1);
 assert.throws(()=>relay.receive({...request,requestId:cancelled}));assert.equal(requests,1);
});
