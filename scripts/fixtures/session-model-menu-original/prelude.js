(() => {
  const audit=window.hcaAudit={messages:[],errors:[],denied:[],ledger:[],mode:'synthetic-existing-thread-no-auth-no-native-IPC'};
  const queue=[];let handler=null;const fixture=window.hcaFixture={initial:new URLSearchParams(location.search).get('from')??'gpt-5.6-sol',effort:new URLSearchParams(location.search).get('effort')??'medium',selectionMode:new URLSearchParams(location.search).get('selectionMode')??'default',gateMode:new URLSearchParams(location.search).get('gate')??'absent',turnCount:Number(new URLSearchParams(location.search).get('count')??1),latestTurnId:new URLSearchParams(location.search).get('latest')==='none'?null:'turn-1',observeHistory:new URLSearchParams(location.search).get('history')!=='unmounted'};const persisted={'composer-model-picker-selection-mode-v1':fixture.selectionMode,'composer-recent-model-configurations-v1':[{model:new URLSearchParams(location.search).get('recentModel')??'gpt-5.5',reasoningEffort:'medium',serviceTier:null}]};
  const models=['gpt-5.5','gpt-6-sol','gpt-6-luna','gpt-5.6-terra','gpt-5.6-sol'].map((model,i)=>({id:model,model,displayName:model,description:'Declared synthetic model',isDefault:i===1,hidden:false,supportedReasoningEfforts:['low','medium','high'].map(reasoningEffort=>({reasoningEffort,description:reasoningEffort})),defaultReasoningEffort:'medium',inputModalities:['text'],supportsPersonality:false}));
  const deliver=(kind,message,response)=>{queue.push({kind,message,response});queueMicrotask(window.hcaFlush)};
  window.hcaFlush=()=>{if(!window.hcaReceive)return;for(let task;task=queue.shift();)window.hcaReceive(task.kind,task.message,task.response)};
  window.hcaRegisterHandler=h=>{if(handler)throw Error('Second owned RPC handler');handler=h;return()=>{handler=null}};
  const deny=message=>{audit.denied.push(message);throw Error('Synthetic host denied '+JSON.stringify(message).slice(0,500))};
  const requestPayload=request=>{
    switch(request.method){
      case 'thread/settings/update': {
        const p=request.params;if(p?.threadId!=='00000000-0000-4000-8000-000000000003'||!models.some(m=>m.model===p.model)||!['low','medium','high'].includes(p.effort)||Object.keys(p).some(k=>!['threadId','model','effort','multiAgentMode','serviceTier'].includes(k))||p.serviceTier!=null||p.multiAgentMode!=='explicitRequestOnly')return deny(request);
        (audit.syntheticSettingsWrites??=[]).push(p);return {};
      }
      case 'model/list':return {data:models,nextCursor:null};
      case 'config/read':return {config:{model:fixture.initial,model_provider:'openai',model_reasoning_effort:fixture.effort,approval_policy:'never',sandbox_mode:'danger-full-access'},origins:{},layers:[]};
      case 'configRequirements/read':return {requirements:null};
      case 'permissionProfile/list':return {data:[],nextCursor:null};
      case 'account/read':return {account:null,requiresOpenaiAuth:true};
      case 'getAuthStatus':return {authMethod:null};
      case 'remoteControl/status/read':return {status:'disabled',serverName:'Owned model notice fixture',installationId:'00000000-0000-4000-8000-000000000001',environmentId:null};
      default:return deny(request);
    }
  };
  window.acquireVsCodeApi=()=>({getState:()=>({}),setState:value=>deny({type:'setState',value}),postMessage(message){
    if(audit.messages.length>500)return deny({type:'message-budget'});
    audit.messages.push(message);
    if(handler?.claims(message)){handler.accept(message,{origin:location.origin,source:window});return}
    if(['log-message','shared-object-unsubscribe','cancel-fetch','mcp-request-abandon'].includes(message.type))return;
    if(message.type==='persisted-atom-update' && message.key==='composer-model-picker-selection-mode-v1'){
      if(message.deleted!==false || !['default','model'].includes(message.value) || message.recordUpdate!==undefined)return deny(message);
      persisted[message.key]=message.value;(audit.preferenceWrites??=[]).push({key:message.key,value:message.value});
      deliver('host',message,{type:'persisted-atom-updated',key:message.key,value:message.value,deleted:false});return;
    }
    if(message.type==='persisted-atom-sync-request'){deliver('host',message,{type:'persisted-atom-sync',state:persisted,canWritePrimaryWindowTabPersistence:false});return}
    if(message.type==='shared-object-subscribe'){
      if(!['statsig_evaluations','host_config','remote_ssh_connections','remote_wsl_connections','remote_control_connections','api_key_daybreak_preference','statsig_default_enable_features'].includes(message.key))return deny(message);
      deliver('host',message,{type:'shared-object-updated',key:message.key});return;
    }
    if(message.type==='fetch'){
      let body;const path=message.url;
      if(path==='vscode://codex/os-info')body={platform:'linux',isVsCodeRunningInsideWsl:false};
      else if(path==='vscode://codex/is-copilot-api-available')body={available:false};
      else if(path==='vscode://codex/get-settings')body={values:{},configuredValues:{}};
      else if(path==='vscode://codex/get-global-state'){
        const key=JSON.parse(message.body??'{}').key;
        if(!['queued-follow-ups','local-projects','selected-project','selected-remote-host-id','use-copilot-auth-if-available','copilot-default-model','thread-project-assignments','projectless-thread-ids'].includes(key))return deny(message);
        body=['queued-follow-ups','local-projects'].includes(key)?{value:{}}:{};
      }else return deny(message);
      deliver('host',message,{type:'fetch-response',responseType:'success',requestId:message.requestId,status:200,headers:{},bodyJsonString:JSON.stringify(body)});return;
    }
    if(message.type==='mcp-request'){
      if(message.hostId!=='local')return deny(message);
      deliver('rpc',message,requestPayload(message.request));return;
    }
    return deny(message);
  }});
  addEventListener('error',e=>audit.errors.push(String(e.error?.stack||e.message)));
  addEventListener('unhandledrejection',e=>audit.errors.push(String(e.reason?.stack||e.reason)));
})();
