import {spawn,execFile} from 'node:child_process';
import {isAbsolute} from 'node:path';
import {promisify} from 'node:util';
const exec=promisify(execFile);
export function createTransport({binary='lark-cli',profile,cliHome,allowedUserId,onError=()=>{},execute=exec}){
 if(cliHome!==undefined&&!isAbsolute(cliHome))throw Error('Absolute CLI home required');
 const prefix=profile?['--profile',profile]:[];let child;let timer;let stopped=false;let callback;
 const env={...process.env,...(cliHome?{HOME:cliHome}:{}),LARKSUITE_CLI_NO_UPDATE_NOTIFIER:'1',LARKSUITE_CLI_NO_SKILLS_NOTIFIER:'1'};
 return {
  async send({text,key}){
   const card=completionCard(text);
   const {stdout}=await execute(binary,[...prefix,'im','+messages-send','--as','bot','--user-id',allowedUserId,'--msg-type','interactive','--content',JSON.stringify(card),'--idempotency-key',key],{env,timeout:20000,maxBuffer:65536});
   const result=JSON.parse(stdout);if(result.ok!==true)throw Error('Feishu send failed');
   const data=result.data?.data??result.data;return {messageId:data?.message_id,chatId:data?.chat_id};
  },
  listen(handler){callback=handler;const start=()=>{
   if(stopped)return;
   child=spawn(binary,[...prefix,'event','consume','im.message.receive_v1','--as','bot'],{env,stdio:['pipe','pipe','pipe']});
   let buffer='';let pending=0;let ready=false;let stderr='';const process=child;
   child.stderr.on('data',data=>{stderr=(stderr+data.toString()).slice(-2048);if(stderr.includes('[event] ready event_key=im.message.receive_v1'))ready=true});
   child.stdout.on('data',data=>{
    buffer+=data.toString();if(buffer.length>1024*1024){process.kill();return}
    let index;while((index=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,index);buffer=buffer.slice(index+1);if(!line.trim())continue;
     if(pending>=128){onError('Feishu event backlog exceeded');process.kill();return}
     try{const value=JSON.parse(line);pending++;Promise.resolve(callback(value)).catch(()=>onError('Feishu reply failed')).finally(()=>pending--)}catch{onError('Invalid Feishu event')}
    }
   });
   child.on('error',()=>onError('Feishu listener unavailable'));
   child.on('close',()=>{if(!ready)onError('Feishu listener did not become ready');if(!stopped){timer=setTimeout(start,5000);timer.unref()}});
  };start()},
  close(){stopped=true;clearTimeout(timer);child?.stdin.end();child?.kill('SIGTERM')}
 };
}

export function completionCard(text){
 // UTF-8 budget leaves room below the 30 KB serialized card limit.
 const bounded=Array.from(text).reduce((a,c)=>{const n=Buffer.byteLength(c);if(a.bytes+n<=20000){a.text+=c;a.bytes+=n}else a.truncated=true;return a},{text:'',bytes:0,truncated:false});
 return {schema:'2.0',config:{width_mode:'default',enable_forward:false},header:{title:{tag:'plain_text',content:'DeepSeek Harness · 任务完成'},template:'green'},body:{elements:[
  {tag:'column_set',background_style:'green-50',columns:[{tag:'column',width:'weighted',weight:1,elements:[{tag:'markdown',content:'**本轮已完成**'}]}]},
  {tag:'markdown',content:bounded.text+(bounded.truncated?'\n\n（内容较长，请在 Harness 查看完整回复）':'')},
  {tag:'markdown',text_size:'notation',content:'在飞书中引用回复此消息，可在原会话排队继续。仅接收已配置用户的文字回复；绑定保留 7 天。'}
 ]}};
}
