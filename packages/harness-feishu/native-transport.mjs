import {readFileSync} from 'node:fs';
import {completionCard} from './transport.mjs';

/** Filter only this plugin's bound replies; preserve the existing BotHarness ingress. */
export function routeProvider(provider, {botId, matches, reply}) {
 return {...provider, consume(input) {
  return provider.consume({...input,onEvent:async(event,signal)=>{
   if(input.accountRef===botId&&matches(event)) {
    await reply({type:'im.message.receive_v1',chat_type:event.conversation.kind==='dm'?'p2p':'group',
     sender_type:event.actor.kind,sender_id:event.actor.id,chat_id:event.conversation.id,
     message_id:event.messageId,root_id:event.reply?.rootId,reply_to:event.reply?.parentId,
     message_type:event.attachments?.length?'file':'text',content:event.text});
    return {accepted:true};
   }
   return input.onEvent(event,signal);
  }});
 }};
}

/** Reuse the configured Harness bot and its credential provider; never start a second websocket. */
export async function createNativeTransport({ctx,config,store,reply}) {
 const {createDshImProvider}=await import(config.providerModule);
 const provider=createDshImProvider(ctx.dshIm,'feishu');
 if(!provider?.consume)throw Error('Configured IM provider lacks native ingress');
 const bot=()=>{
  const rows=JSON.parse(readFileSync(config.botConfigFile,'utf8')).bots;
  const row=rows.find(b=>b.id===config.botId);
  if(!row||row.deletionPending||!row.ownerOpenIds?.some(id=>id==='*'||id===config.allowedUserId))throw Error('Harness bot identity or owner changed');
  return row;
 };
 bot();
 const matches=event=>{
  if(event.botId!==config.botId||event.channel!=='feishu')return false;
  return !!(store.get(`card:${event.reply?.parentId}`)||store.get(`card:${event.reply?.rootId}`));
 };
 let dispose;let closed=false;
 async function api(path,body,params={}) {
  if(closed)throw Error('Transport closed');
  const b=bot();const secret=await ctx.credentials.resolve(b.secretRef);
  if(!secret?.value)throw Error('Existing Harness bot credential unavailable');
  const origin=b.domain==='lark'?'https://open.larksuite.com':'https://open.feishu.cn';
  const authResponse=await fetch(origin+'/open-apis/auth/v3/tenant_access_token/internal',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({app_id:b.appId,app_secret:secret.value}),signal:AbortSignal.timeout(15000)});
  const auth=await authResponse.json();
  if(auth.code!==0||!auth.tenant_access_token)throw Error('Harness bot authentication failed');
  const url=new URL(origin+path);for(const [k,v] of Object.entries(params))url.searchParams.set(k,v);
  const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${auth.tenant_access_token}`},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
  const result=await response.json();if(result.code!==0)throw Error(`Feishu request failed (${Number(result.code)||'unknown'})`);
  return result.data;
 }
 return {
  async send({text,key}) {
   const data=await api('/open-apis/im/v1/messages',{receive_id:config.allowedUserId,msg_type:'interactive',content:JSON.stringify(completionCard(text)),uuid:key},{receive_id_type:'open_id'});
   return {messageId:data?.message_id,chatId:data?.chat_id};
  },
  listen(){
   dispose=ctx.botharness.externalMessaging.register(routeProvider(provider,{botId:config.botId,matches,reply}));
  },
  close(){
   closed=true;
   if(dispose){dispose();dispose=undefined;ctx.botharness.externalMessaging.register(provider)}
  }
 };
}
