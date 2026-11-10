import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {State} from '../state.mjs';
import {createTransport,completionCard} from '../transport.mjs';
test('private state survives reopen and refuses a second owner and public directory',()=>{
 const dir=mkdtempSync(join(tmpdir(),'harness-feishu-'));
 try{
  const state=new State(dir);state.put('card:om_a',{sessionId:'s',chatId:'oc_a',expiresAt:Date.now()+10000});
  assert.throws(()=>new State(dir));state.close();
  const reopened=new State(dir);assert.equal(reopened.get('card:om_a').sessionId,'s');reopened.close();
  chmodSync(dir,0o755);assert.throws(()=>new State(dir));
 }finally{rmSync(dir,{recursive:true,force:true})}
});
test('CLI transport uses bot argv without shell, reads receipt, bounds card UTF8 size',async()=>{
 let args;
 const t=createTransport({allowedUserId:'ou_test',execute:async(bin,argv,opts)=>{args=argv;assert.equal(opts.shell,undefined);return {stdout:JSON.stringify({ok:true,data:{message_id:'om_test',chat_id:'oc_test'}})}}});
 assert.deepEqual(await t.send({text:'done',key:'test'}),{messageId:'om_test',chatId:'oc_test'});
 assert.ok(args.includes('bot'));assert.ok(args.includes('interactive'));
 const c=completionCard('汉'.repeat(12000));assert.equal(c.schema,'2.0');assert.ok(Buffer.byteLength(JSON.stringify(c))<30000);assert.match(c.body.elements[1].content,/完整回复/);
 t.close();
});
test('failed and ambiguous CLI sends reject without retries',async()=>{
 let count=0;const t=createTransport({allowedUserId:'ou_test',execute:async()=>{count++;return {stdout:'{"ok":false}'}}});
 await assert.rejects(t.send({text:'x',key:'x'}));assert.equal(count,1);t.close();
});
