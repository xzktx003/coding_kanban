import {test} from 'node:test';
import assert from 'node:assert/strict';
import {routeProvider} from '../native-transport.mjs';
test('existing provider receives ordinary messages; plugin consumes only its bound card replies',async()=>{
 let receive;let ordinary=0;let replies=[];
 const original={id:'dsh-im/feishu',consume(input){receive=input.onEvent;return ()=>{}},other:'preserved'};
 const decorated=routeProvider(original,{botId:'bot',matches:e=>e.reply?.parentId==='om_card',reply:async e=>replies.push(e)});
 decorated.consume({accountRef:'bot',onEvent:async()=>{ordinary++;return {accepted:true}}});
 const e={channel:'feishu',botId:'bot',actor:{kind:'user',id:'ou_owner'},conversation:{kind:'dm',id:'oc_chat'},messageId:'om_reply',text:'continue',reply:{parentId:'om_card'}};
 await receive({...e,reply:{}},new AbortController().signal);assert.equal(ordinary,1);
 await receive(e,new AbortController().signal);assert.equal(ordinary,1);assert.equal(replies.length,1);assert.equal(replies[0].reply_to,'om_card');assert.equal(replies[0].chat_type,'p2p');assert.equal(decorated.other,'preserved');
});
test('reply from a different bot is delegated to its existing receiver',async()=>{
 let receive;let ordinary=0;
 const original={consume(input){receive=input.onEvent}};
 const decorated=routeProvider(original,{botId:'chosen',matches:()=>true,reply:()=>{throw Error('Wrong bot')}});
 decorated.consume({accountRef:'other',onEvent:async()=>{ordinary++;return {accepted:true}}});
 await receive({reply:{}},new AbortController().signal);assert.equal(ordinary,1);
});
