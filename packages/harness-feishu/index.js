import {readFileSync,lstatSync} from 'node:fs';
import {isAbsolute} from 'node:path';
import {Bridge} from './bridge.mjs';
import {State} from './state.mjs';
import {createTransport} from './transport.mjs';
import {createNativeTransport} from './native-transport.mjs';
export const name='harness-feishu';
export const inject=['sessionController','sessions','dshIm','botharness','credentials'];
export function apply(ctx,config){
 if(config?.configFile){
  if(!isAbsolute(config.configFile))throw Error('Absolute private configFile required');
  const stat=lstatSync(config.configFile);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.uid!==process.getuid()||(stat.mode&0o077)||stat.size>16384)throw Error('configFile must be an owner-private bounded file');
  config=JSON.parse(readFileSync(config.configFile,'utf8'));
 }
 if(config?.enabled!==true)return;
 if(!/^ou_[\w-]+$/.test(config.allowedUserId??''))throw Error('Configure explicit allowedUserId');
 if(config.profile!==undefined&&!/^[\w-]{1,64}$/.test(config.profile))throw Error('Invalid CLI profile');
 return start(ctx,config);
}
async function start(ctx,config){
 const state=new State(config.dataDir);
 let bridge;let transport;let stop;
 try{
  const reply=async event=>{
   const result=await bridge.reply(event);
   if(result==='unknown')ctx.logger('harness-feishu').warn('Reply admission outcome unknown; automatic resend blocked');
  };
  transport=config.transport==='harness-native'
   ?await createNativeTransport({ctx,config,store:state,reply})
   :createTransport({allowedUserId:config.allowedUserId,profile:config.profile,cliHome:config.cliHome,onError:message=>ctx.logger('harness-feishu').warn(message)});
  bridge=new Bridge({store:state,allowedUserId:config.allowedUserId,send:input=>transport.send(input),submit:({sessionId,requestId,text})=>ctx.sessionController.prompt({sessionId,requestId,mode:'queue',content:[{type:'text',text}]},new AbortController().signal)});
  stop=ctx.on('session/event',(session,event)=>{void bridge.event(session,event).catch(()=>ctx.logger('harness-feishu').warn('Completion notification failed; receipt retained for inspection'))});
  transport.listen(reply);
  ctx.on('dispose',async()=>{stop();bridge.close();await bridge.drain();transport.close();state.close()});
 }catch(error){stop?.();transport?.close();state.close();throw error}
}
