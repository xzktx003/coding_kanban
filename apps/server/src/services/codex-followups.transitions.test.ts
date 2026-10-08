import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CodexFollowups} from './codex-followups.js';
function setup(){
 const calls:any[]=[]; const states:any={a:'active'};
 const q=new CodexFollowups({statuses:async()=>({...states}),call:async(method,params)=>{calls.push({method,params});return {turn:{id:'new',status:'inProgress'}}}});
 const input:any={id:'message',threadId:'a',text:'next',images:[],mode:'queue',parameters:{}};
 return {q,calls,states,input};
}
test('B1 late error from old turn must not pause a new active turn',async()=>{
 const {q,input}=setup(); await q.submit(input);
 await q.observe({method:'turn/started',params:{threadId:'a',turn:{id:'new'}}});
 await q.observe({method:'error',params:{threadId:'a',turnId:'old',willRetry:false,error:{message:'old failure'}}});
 assert.equal((await q.get('a')).paused,null);
});
test('B2 systemError-only transition must not automatically dispatch pending messages',async()=>{
 const {q,calls,states,input}=setup();await q.submit(input);
 await q.observe({method:'turn/started',params:{threadId:'a',turn:{id:'old'}}});
 await q.observe({method:'thread/status/changed',params:{threadId:'a',status:{type:'systemError'}}});
 states.a='systemError';await q.tick();assert.equal(calls.length,0);
});
test('control: active thread does not dispatch queued work',async()=>{
 const {q,calls,input}=setup();await q.submit(input);await q.tick();assert.equal(calls.length,0);
});
test('explicit post-error input can start fresh but cannot release older queued work',async()=>{
 const f=setup();f.states.a='systemError';
 await f.q.submit({...f.input,recoverAfterError:true});await f.q.tick();
 assert.equal(f.calls[0]?.method,'turn/start');
 const g=setup();await g.q.submit(g.input);
 await g.q.observe({method:'thread/status/changed',params:{threadId:'a',status:{type:'systemError'}}});g.states.a='systemError';
 await g.q.submit({...g.input,id:'next',recoverAfterError:true});await g.q.tick();
 assert.equal(g.calls.length,0);
 const state=await g.q.get('a');await g.q.change('a',state.revision,{type:'resume'});await g.q.tick();
 assert.equal(g.calls[0]?.params.clientUserMessageId,'message');
});
