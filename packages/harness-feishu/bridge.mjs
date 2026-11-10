import {createHash} from 'node:crypto';
const valid=(v,p)=>typeof v==='string'&&p.test(v);
export class Bridge {
 #options; #turns=new Map(); #tail=Promise.resolve(); #stopped=false; #pending=0;
 constructor(options){this.#options=options}
 close(){this.#stopped=true;this.#turns.clear()}
 drain(){return this.#tail}
 event(session,event){
  if(this.#stopped)return Promise.resolve('ignored');
  try{return Promise.resolve(this.#event(session,event))}catch(error){return Promise.reject(error)}
 }
 reply(event){return this.#enqueue(()=>this.#reply(event))}
 #enqueue(work){
  if(this.#stopped)return Promise.resolve('ignored');
  if(this.#pending>=128)return Promise.reject(Error('Notification queue capacity reached'));
  this.#pending++;
  const next=this.#tail.then(()=>this.#stopped?'ignored':work()).finally(()=>this.#pending--);
  this.#tail=next.catch(()=>{});return next;
 }
 #event(session,event){
  if(session.header?.origin==='subagent')return;
  const d=event.data??{};const id=session.id;
  if(event.type==='turn/start'){
   if(this.#turns.size>=256&&!this.#turns.has(id))return;
   this.#turns.set(id,{turn:d.turn,text:''});return;
  }
  const current=this.#turns.get(id);if(!current||current.turn!==d.turn)return;
  if(event.type==='assistant/message'){
   current.text=(d.message?.content??[]).filter(p=>p.type==='text'&&typeof p.text==='string').map(p=>p.text.slice(0,12000)).join('\n').slice(0,12000);return;
  }
  if(event.type!=='turn/end')return;
  this.#turns.delete(id);
  if(d.reason?.kind!=='completed'||!current.text.trim())return;
  const key=`completion:${createHash('sha256').update(`${id}:${event.seq}`).digest('hex')}`;
  if(this.#options.store.get(key))return;
  // Intent before side effect. Ambiguous receipts remain unknown, never replayed.
  this.#options.store.put(key,{status:'pending',expiresAt:Date.now()+7*86400000});
  return this.#enqueue(async()=>{
  const receipt=await this.#options.send({text:current.text,sessionId:id,key:key.slice(-40)});
  if(!valid(receipt?.messageId,/^om_[\w-]+$/)||!valid(receipt?.chatId,/^oc_[\w-]+$/))throw Error('Invalid Feishu receipt');
  this.#options.store.put(`card:${receipt.messageId}`,{sessionId:id,chatId:receipt.chatId,expiresAt:Date.now()+7*86400000});
  this.#options.store.put(key,{status:'sent',expiresAt:Date.now()+7*86400000});
  });
 }
 async #reply(event){
  if(event.type!=='im.message.receive_v1'||event.chat_type!=='p2p'||event.sender_type!=='user'||event.sender_id!==this.#options.allowedUserId||event.message_type!=='text'||!valid(event.message_id,/^om_[\w-]+$/))return 'ignored';
  const binding=this.#options.store.get(`card:${event.reply_to??event.root_id}`)??this.#options.store.get(`card:${event.root_id}`);
  if(!binding||binding.expiresAt<Date.now()||binding.chatId!==event.chat_id)return 'ignored';
  const parent=this.#options.store.get(`card:${event.reply_to}`);
  const root=this.#options.store.get(`card:${event.root_id}`);
  if(parent&&root&&(parent.sessionId!==root.sessionId||parent.chatId!==root.chatId))return 'ignored';
  let text=event.content;
  if(typeof text==='string'&&text.startsWith('{')){try{const parsed=JSON.parse(text);if(typeof parsed.text==='string')text=parsed.text}catch{}}

  if(typeof text!=='string'||!text.trim()||text.length>8000||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text))return 'ignored';
  const key=`reply:${event.message_id}`;if(this.#options.store.get(key))return 'duplicate';
  this.#options.store.put(key,{status:'pending',expiresAt:Date.now()+7*86400000});
  try{
   const result=await this.#options.submit({sessionId:binding.sessionId,requestId:event.message_id,text});
   if(result?.accepted!==true)return 'unknown';
   this.#options.store.put(key,{status:'accepted',expiresAt:Date.now()+7*86400000});
   return 'accepted';
  }catch{return 'unknown'}
 }
}
