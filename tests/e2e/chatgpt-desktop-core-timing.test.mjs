import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { encodeWireValue } from '../../packages/chatgpt-desktop-host/src/wire-value.mjs';
import { extractCoreWireHeader, createCoreNetworkTrace, classifyCoreLedgerFrame } from './chatgpt-desktop-core-diagnostic.mjs';

test('bounded wire header reads only root type, id and seq, not payload',()=>{
 const text=encodeWireValue({v:1,scope:{hidden:'SECRET'},seq:23,type:'return',id:396,value:{content:'DO_NOT_LOG'}});
 assert.deepEqual(extractCoreWireHeader(text),{status:'complete',type:'return',id:396,seq:23});
 assert.equal(JSON.stringify(extractCoreWireHeader(text)).includes('SECRET'),false);
 assert.equal(JSON.stringify(extractCoreWireHeader(text)).includes('DO_NOT_LOG'),false);
 const spoof=encodeWireValue({v:1,scope:{type:'return',id:77},seq:4,type:'portMessage',data:{id:396}});
 assert.deepEqual(extractCoreWireHeader(spoof),{status:'complete',type:'portMessage',seq:4});
});

test('wire header scanner has strict bounded work and never guesses past oversized content',()=>{
 const text=encodeWireValue({v:1,scope:{},seq:7,value:'x'.repeat(70000),type:'return',id:396});
 const result=extractCoreWireHeader(text);
 assert.equal(result.status,'too-large');assert.equal(result.type,undefined);assert.equal(result.id,undefined);
 assert.equal(extractCoreWireHeader('{"fake":true}').status,'unrecognized');
});

test('readiness can classify a large unrelated port frame without decoding its body',()=>{
 const scope={profileId:'11111111-1111-1111-1111-111111111111',generation:'22222222-2222-2222-2222-222222222222',viewId:'33333333-3333-3333-3333-333333333333'};
 const text=encodeWireValue({v:1,scope,seq:9,type:'portMessage',data:'x'.repeat(70000)});
 const out=extractCoreWireHeader(text,{allowLargeHeader:true});assert.equal(out.type,'portMessage');assert.equal(out.seq,9);
 assert.doesNotMatch(JSON.stringify(out),/xxxxxxxx/);
});

test('CDP trace scopes the socket, records native timestamps and excludes body/url',()=>{
 const trace=createCoreNetworkTrace({origin:'https://10.1.2.3:8443',bridgePath:'/fixed/bridge'});
 trace.calibrate({timestamp:100,wallTime:1000,request:{url:'https://10.1.2.3:8443/'}});
 trace.created({requestId:'local-1',url:'wss://10.1.2.3:8443/fixed/bridge'});
 trace.created({requestId:'other',url:'wss://other.invalid/fixed/bridge'});
 const payload=encodeWireValue({v:1,scope:{private:'SECRET'},seq:12,type:'return',id:396,value:'TOKEN'});
 trace.frame('received',{requestId:'other',timestamp:101,response:{opcode:1,payloadData:payload}});
 trace.frame('received',{requestId:'local-1',timestamp:101.25,response:{opcode:1,payloadData:payload}});
 trace.longTask({startTime:200,duration:75,timeOrigin:1000000,private:'NEVER_LOG'});
 const snapshot=trace.snapshot(),frame=snapshot.events.find(x=>x.kind==='frame'),task=snapshot.events.find(x=>x.kind==='longtask');
 assert.equal(snapshot.sockets,1);assert.equal(frame.timestamp,101.25);assert.equal(frame.wallMsApprox,1001250);assert.equal(frame.id,396);assert.equal(frame.seq,12);assert.equal(frame.type,'return');
 assert.equal(task.startWallMs,1000200);assert.equal(task.duration,75);
 assert.doesNotMatch(JSON.stringify(snapshot),/SECRET|TOKEN|NEVER_LOG|10\.1\.2\.3|fixed\/bridge/);
});

test('same request id from distinct views remains distinguishable by scope hash and sequence',()=>{
 const profileId='11111111-1111-1111-1111-111111111111',generation='22222222-2222-2222-2222-222222222222';
 const scope={profileId,generation,viewId:'33333333-3333-3333-3333-333333333333'};
 const payload=encodeWireValue({v:1,scope,seq:24,type:'return',id:396,value:null});
 const out=extractCoreWireHeader(payload),expected=createHash('sha256').update(Object.values(scope).join('\0')).digest('hex');
 assert.equal(out.scopeHash,expected);assert.equal(out.seq,24);assert.equal(out.id,396);
 const other=extractCoreWireHeader(encodeWireValue({v:1,scope:{...scope,viewId:'44444444-4444-4444-4444-444444444444'},seq:24,type:'return',id:396,value:null}));
 assert.notEqual(out.scopeHash,other.scopeHash);assert.doesNotMatch(JSON.stringify(out),/11111111|22222222|33333333/);
});

test('a readiness trace requires one unambiguous view scope and bounded storage',()=>{
 const trace=createCoreNetworkTrace({origin:'https://10.1.2.3:8443',bridgePath:'/fixed/bridge',maxRecords:2,maxBytes:2048}),scope={profileId:'11111111-1111-1111-1111-111111111111',generation:'22222222-2222-2222-2222-222222222222',viewId:'33333333-3333-3333-3333-333333333333'};
 trace.created({requestId:'s',url:'wss://10.1.2.3:8443/fixed/bridge'});
 for(let n=0;n<3;n++)trace.frame('sent',{requestId:'s',timestamp:n+1,response:{opcode:1,payloadData:encodeWireValue({v:1,scope,seq:n,type:'call',id:n})}});
 assert.match(trace.activeScopeHash(),/^[a-f0-9]{64}$/);assert.equal(trace.snapshot().events.length,2);assert.ok(trace.snapshot().dropped>0);
 trace.frame('sent',{requestId:'s',timestamp:5,response:{opcode:1,payloadData:encodeWireValue({v:1,scope:{...scope,viewId:'44444444-4444-4444-4444-444444444444'},seq:4,type:'call',id:4})}});
 assert.equal(trace.activeScopeHash(),null);
});

test('readiness scope must belong to the configured profile and generation',()=>{
 const scope={profileId:'11111111-1111-1111-1111-111111111111',generation:'22222222-2222-2222-2222-222222222222',viewId:'33333333-3333-3333-3333-333333333333'};
 const parent=createHash('sha256').update([scope.profileId,scope.generation].join('\0')).digest('hex');
 const trace=createCoreNetworkTrace({origin:'https://10.1.2.3:8443',bridgePath:'/fixed/bridge',expectedParentHash:parent});trace.created({requestId:'s',url:'wss://10.1.2.3:8443/fixed/bridge'});
 trace.frame('sent',{requestId:'s',timestamp:1,response:{opcode:1,payloadData:encodeWireValue({v:1,scope,seq:1,type:'call',id:1})}});assert.match(trace.activeScopeHash(),/^[a-f0-9]{64}$/);
 trace.frame('sent',{requestId:'s',timestamp:2,response:{opcode:1,payloadData:encodeWireValue({v:1,scope:{...scope,generation:'44444444-4444-4444-4444-444444444444'},seq:2,type:'call',id:2})}});assert.equal(trace.activeScopeHash(),null);
 const foreign=createCoreNetworkTrace({origin:'https://10.1.2.3:8443',bridgePath:'/fixed/bridge',expectedParentHash:parent});foreign.created({requestId:'s',url:'wss://10.1.2.3:8443/fixed/bridge'});foreign.frame('sent',{requestId:'s',timestamp:1,response:{opcode:1,payloadData:encodeWireValue({v:1,scope:{...scope,generation:'44444444-4444-4444-4444-444444444444'},seq:1,type:'call',id:1})}});assert.equal(foreign.activeScopeHash(),null);
});

test('readiness ignores unrelated large port data and only decodes targeted native events',()=>{
 assert.deepEqual(classifyCoreLedgerFrame(encodeWireValue({type:'portMessage',data:'x'.repeat(70000)})),{kind:'ignore'});
 assert.deepEqual(classifyCoreLedgerFrame(encodeWireValue({type:'call',method:'sendMessageFromView',args:[{type:'mcp-request',request:{method:'turn/start'}}]})),{kind:'target',mcp:true,activity:false});
 assert.deepEqual(classifyCoreLedgerFrame(encodeWireValue({type:'call',method:'sendMessageFromView',args:[{type:'local-thread-activity-changed'}]})),{kind:'target',mcp:false,activity:true});
 assert.deepEqual(classifyCoreLedgerFrame('{broken'),{kind:'unknown'});
});
