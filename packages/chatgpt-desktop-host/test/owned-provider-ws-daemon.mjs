import {createServer} from 'node:http';
import {chmodSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {WebSocketServer} from 'ws';
// Isolated protocol peer, not the native CLI or a model provider.
const [socketPath,codexHome,cwd,mode]=process.argv.slice(3);
const claims={exp:Math.floor(Date.now()/1000)+3600,'https://api.openai.com/auth':{chatgpt_account_id:'fixture-account',user_id:'fixture-user'}};
const token=[{alg:'none'},claims,'fixture'].map(x=>Buffer.from(typeof x==='string'?x:JSON.stringify(x)).toString('base64url')).join('.');
const server=createServer(),wss=new WebSocketServer({noServer:true});
server.on('upgrade',(req,socket,head)=>wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws)));
wss.on('connection',ws=>{ws.on('error',()=>{});ws.on('message',data=>{
 const frame=JSON.parse(data.toString());process.send?.({method:frame.method,params:frame.params});if(!frame.method&&Object.hasOwn(frame,'result'))process.send?.({approvalReplyId:frame.id});
 const reply=result=>ws.send(JSON.stringify({id:frame.id,result}));
 if(frame.method==='initialize'){reply({userAgent:'codex-cli/0.166.0',codexHome});ws.send(JSON.stringify({method:'account/updated',params:{},emittedAtMs:Date.now()}));return;}
 if(frame.method==='initialized')return;
 if(frame.method==='account/read')return reply({requiresOpenaiAuth:true,account:{type:'chatgpt'},workspaceRouting:{chatgptAccountId:'fixture-account',backendOrigin:'https://fixture.invalid',accountRoutingOverride:'NO_CONSTRAINT'}});
 if(frame.method==='getAuthStatus')return reply({authMethod:'chatgpt',authToken:token});
 if(mode==='preserve'&&frame.method==='config/read'){
  const file=join(codexHome,'config.toml'),version=createHash('sha256').update(readFileSync(file)).digest('hex'),name={type:'user',file,profile:null};
  return reply({config:{mcp_servers:{},fixtureVersion:version},origins:{fixtureVersion:{name,version}},layers:[{name,version,config:{fixtureVersion:version}}]});
 }
 if(mode==='preserve'&&frame.method==='configRequirements/read')return reply({requirements:null});
 if(frame.method==='thread/read')return reply({thread:{id:frame.params.threadId,cwd,turns:[]}});
 if(frame.method==='thread/list')return reply({data:[{id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',cwd,turns:[]}],nextCursor:null});
 if(frame.method==='thread/readState/update')return frame.params.expectedRevision==='native-conflict'?ws.send(JSON.stringify({id:frame.id,error:{code:-32009,message:'original owned read-state conflict',data:{readState:{revision:'native-current-revision',firstUnread:null}}}})):reply({readState:{revision:'native-next-revision',firstUnread:null}});
 if(frame.method==='thread/queue/list')return frame.params.cursor==='native-error-page'?ws.send(JSON.stringify({id:frame.id,error:{code:-32000,message:'original owned queue error'}})):reply({data:[{id:'owned-queue',clientUserMessageId:'owned-message',input:[{type:'text',text:'owned fixture queue',text_elements:[]}]}],nextCursor:'native-opaque-next-page'});
 if(frame.method==='thread/attachment/list')return frame.params.cursor==='native-error-page'?ws.send(JSON.stringify({id:frame.id,error:{code:-32000,message:'original owned attachment error'}})):reply({data:[{id:'owned-attachment',attachmentType:'owned-native-type',identityKey:'owned-identity',createdAt:0,payload:{text:'owned fixture attachment',nested:[null,true]}}],nextCursor:'native-opaque-next-page'});
 if(frame.method==='thread/resume')return reply({thread:{id:frame.params.threadId,historyMode:'paginated',turns:[],...(mode==='preserve'?{cwd}:{})},turnsBackwardsCursor:null,itemsBackwardsCursor:null,...(mode==='preserve'?{cwd,model:'fixture-model',modelProvider:'fixture-provider',approvalPolicy:'never',approvalsReviewer:'user',sandbox:{type:'readOnly'}}:{})});
 return ws.send(JSON.stringify({id:frame.id,error:{code:-32601,message:'unsupported fixture method'}}));
});});
process.on('message',value=>{if(value?.type==='revoke')for(const ws of wss.clients)ws.send(JSON.stringify({method:'account/updated',params:{}}));if(value?.type==='emit-events'&&Array.isArray(value.frames))for(const frame of value.frames)for(const ws of wss.clients)ws.send(JSON.stringify(frame));});
server.listen(socketPath,()=>{chmodSync(socketPath,0o600);process.send?.({ready:true});});
process.on('SIGTERM',()=>{for(const ws of wss.clients)ws.terminate();server.close(()=>process.exit(0));});
