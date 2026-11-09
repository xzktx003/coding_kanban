import test from 'node:test';import assert from 'node:assert/strict';
import {encodeWireValue} from '../../packages/chatgpt-desktop-host/src/wire-value.mjs';
import {classifyAccountAppHostGraph} from './chatgpt-desktop-account-wire.mjs';
const wire=value=>JSON.parse(encodeWireValue(value));
test('observes only AppHost open, close and services pipeline metadata',()=>{
 assert.equal(classifyAccountAppHostGraph(wire({type:'openPort',portId:'app-host-1',name:'app-host'})),'open');
 assert.equal(classifyAccountAppHostGraph(wire({type:'closePort',portId:'app-host-1'})),'close');
 assert.equal(classifyAccountAppHostGraph(wire({type:'portPost',portId:'app-host-1',data:['push',['pipeline',0,['services']]]})),'services');
 for(const v of [{type:'portPost',portId:'app-host-1',data:['push',['pipeline',0,['settings']]]},{type:'openPort',portId:'git-1',name:'git'},null,{}])assert.equal(classifyAccountAppHostGraph(wire(v)),'other');
});

test('tracks bounded pending ACKs and latency by phase without retaining message contents',async()=>{
 const {createAccountWireTracker}=await import('./chatgpt-desktop-account-wire.mjs');const t=createAccountWireTracker({maxPending:1});
 t.observe('sent',wire({type:'openPort',id:11,portId:'app-host-1',name:'app-host'}),'before',100);
 t.observe('sent',wire({type:'call',id:12,args:['secret']}),'before',110);
 t.observe('received',wire({type:'return',id:11,result:'sensitive'}),'after',150);
 const s=t.snapshot();assert.equal(s.pending,0);assert.equal(s.dropped,1);assert.equal(s.before.open,1);assert.equal(s.before.acked,1);assert.equal(s.before.maxAckMs,50);assert.equal(JSON.stringify(s).includes('sensitive'),false);assert.equal(JSON.stringify(s).includes('secret'),false);
});
