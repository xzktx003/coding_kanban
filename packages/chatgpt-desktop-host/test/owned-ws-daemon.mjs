import {createServer} from 'node:http';
import {chmodSync} from 'node:fs';
import {WebSocketServer} from 'ws';
const socketPath=process.argv[3],cwd=process.argv[4],mode=process.argv[5];
const claims={exp:Math.floor(Date.now()/1000)+(mode==='expired-token'?-10:3600),'https://api.openai.com/auth':{
 ...(mode==='fallback-account'?{account_id:'fixture-account'}:{chatgpt_account_id:mode==='wrong-account'?'another-account':'fixture-account'}),
 ...(mode==='missing-user'?{}:{chatgpt_user_id:'fixture-user'}),
 ...(mode==='preferred-user'?{user_id:'preferred-user'}:{}),
 ...(mode==='opaque-user'?{user_id:'opaque|user+值'}:{}),
}};
const token=[{alg:'none'},claims,'fixture'].map((x)=>typeof x==='string'?Buffer.from(x).toString('base64url'):Buffer.from(JSON.stringify(x)).toString('base64url')).join('.');
const server=createServer(),wss=new WebSocketServer({noServer:true});let lastObserverId;
server.on('upgrade',(request,socket,head)=>wss.handleUpgrade(request,socket,head,ws=>wss.emit('connection',ws)));
wss.on('connection',ws=>{
 ws.on('error',()=>{});
 ws.on('message',data=>{
  const request=JSON.parse(data.toString());process.send?.({method:request.method??'response',id:request.id,params:request.params});
  if(!request.method)return;
  if(request.method==='initialize'){ws.send(JSON.stringify({id:request.id,result:{userAgent:'codex-cli/0.166.0',codexHome:cwd}}));ws.send(JSON.stringify({method:'account/updated',params:{},emittedAtMs:Date.now()}));return;}
  if(request.method==='initialized')return;
  if(request.method==='account/read')return ws.send(JSON.stringify({id:request.id,result:{requiresOpenaiAuth:true,account:{type:'chatgpt',email:'fixture@example.invalid'},workspaceRouting:{chatgptAccountId:'fixture-account',backendOrigin:'https://fixture.invalid',accountRoutingOverride:'NO_CONSTRAINT'}}}));
  if(request.method==='getAuthStatus'){lastObserverId=request.id;return ws.send(JSON.stringify({id:request.id,result:{authMethod:'chatgpt',authToken:token}}));}
  if(request.method==='model/list')return ws.send(JSON.stringify({id:request.id,result:{data:[{id:'fixture-model',model:'fixture-model',supportedReasoningEfforts:[{reasoningEffort:'high',description:'High'}]}],nextCursor:null}}));
  if(request.method==='thread/start'){
   const threadId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
   ws._socket.cork();
   ws.send(JSON.stringify({id:request.id,result:{thread:{id:threadId,cwd,turns:[]},cwd,model:'fixture-model',modelProvider:'openai',approvalPolicy:'on-request',approvalsReviewer:'user',sandbox:{type:'readOnly'}}}));
   for(let index=0;index<(mode==='startup-burst'?13:1);index++)
    ws.send(JSON.stringify({method:'mcpServer/startupStatus/updated',params:{threadId,name:mode==='startup-burst'?'owned-server-'+index:'owned-server',status:'failed',error:'owned original startup failure',failureReason:null},emittedAtMs:Date.now()}));
   ws._socket.uncork();return;
  }
  if(request.method==='thread/read'){
   if(mode==='hold-all')return;
   if(request.params.threadId==='cccccccc-cccc-4ccc-8ccc-cccccccccccc')return ws.send(JSON.stringify({id:request.id,error:{code:-32000,message:'fixture unavailable'}}));
   return ws.send(JSON.stringify({id:request.id,result:{thread:{id:request.params.threadId,cwd,name:'fixture thread',turns:[],opaque:{source:'cli'}},metadata:'preserved'}}));
  }
  if(request.method==='thread/list'){
   const after=request.params.cursor==='fixture-page-2';
   const threadId=after?'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb':'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
   return ws.send(JSON.stringify({id:request.id,result:{data:[{id:threadId,cwd,name:after?'second':'first',unknownMetadata:{value:17},...(mode==='oversize-frame'?{padding:'x'.repeat(16*1024*1024)}:{})}],nextCursor:after?null:'fixture-page-2',backwardsCursor:after?'fixture-page-1':null,unknownResultField:'preserved'}}));
  }
  if(request.method==='thread/name/set'){
   if(typeof request.params.name!=='string'||request.params.name.trim()==='')return ws.send(JSON.stringify({id:request.id,error:{code:-32600,message:'Thread name cannot be empty'}}));
   ws.send(JSON.stringify({id:request.id,result:{}}));
   return ws.send(JSON.stringify({method:'thread/name/updated',params:{threadId:request.params.threadId,threadName:request.params.name}}));
  }
  if(request.method==='thread/resume')return ws.send(JSON.stringify({id:request.id,result:{thread:{id:request.params.threadId,historyMode:'paginated',turns:[]},turnsBackwardsCursor:null,itemsBackwardsCursor:null}}));
  ws.send(JSON.stringify({id:request.id,error:{code:-32601,message:'unsupported fixture method'}}));
 });
});
process.on('message',msg=>{
 if(msg?.type==='ordinary-startup-burst')for(const ws of wss.clients){
  ws._socket.cork();
  for(let index=0;index<(Number.isSafeInteger(msg.count)&&msg.count>0&&msg.count<=65?msg.count:13);index++){
   if(index===msg.accountAfter)ws.send(JSON.stringify({method:'account/updated',params:{}}));
   if(index===msg.revocationAfter)ws.send(JSON.stringify({method:msg.revocationMethod,params:{}}));
   ws.send(JSON.stringify({method:'mcpServer/startupStatus/updated',params:{threadId:msg.threadId,name:'ordinary-server-'+index,status:'failed',error:'owned original startup failure',failureReason:null},emittedAtMs:Date.now()}));
  }
  ws._socket.uncork();
 }
 if(msg?.type==='created-drain-jsonl-probe')process.stdout.write(JSON.stringify({type:'created-drain-jsonl-probe'})+'\n');
 if(msg?.type==='concurrent-thread-metadata')for(const ws of wss.clients){
  ws.send(JSON.stringify({method:'thread/started',params:{thread:{id:msg.otherThreadId,cwd,turns:[]}}}));
  ws.send(JSON.stringify({method:'thread/goal/updated',params:{threadId:msg.otherThreadId,goal:{objective:'unrelated private goal'},turnId:null}}));
  ws.send(JSON.stringify({method:'item/agentMessage/delta',params:{threadId:msg.otherThreadId,turnId:'other-turn',itemId:'other-item',delta:'unrelated private delta'}}));
  ws.send(JSON.stringify({method:'item/agentMessage/delta',params:{threadId:msg.ownedThreadId,turnId:'owned-turn',itemId:'owned-item',delta:'owned exact follower delta'}}));
 }
 if(msg?.type==='unknown-thread-notification')for(const ws of wss.clients)ws.send(JSON.stringify({method:'thread/unknownFixture',params:{threadId:msg.threadId}}));
 if(msg?.type==='revoke')for(const ws of wss.clients)ws.send(JSON.stringify({method:'account/updated',params:{}}));
 if(msg?.type==='duplicate')for(const ws of wss.clients)ws.send(JSON.stringify({id:lastObserverId,result:{}}));
 if(msg?.type==='server-request')for(const ws of wss.clients)ws.send(JSON.stringify({id:lastObserverId,method:'item/tool/requestUserInput',params:{threadId:msg.threadId}}));
});
server.listen(socketPath,()=>{chmodSync(socketPath,0o600);process.send?.({ready:true});});
process.on('SIGTERM',()=>{for(const ws of wss.clients)ws.terminate();server.close(()=>process.exit(0));});
