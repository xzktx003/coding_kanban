import * as Core from '/assets/app-initial-c4ebaa710049.js';
import * as Native from '/assets/app-initial-41ab338a184f.js';
import * as Main from '/assets/app-initial-fee819fe4f22.js';
import {activateOriginalRpcPeer} from './activate-original-rpc.mjs';
const audit=window.hcaAudit,initial=window.hcaFixture.initial;audit.phase='imports-loaded';
try{
 Core.ict();Core.Elt();Core.wlt();Core.Pbt();Core.aut();Native.wu();Native.Yu();
 Native.G9t();Native.a4t();Native.P2t();Native.f2t();Native.C();Native.J();
 Main.lft();Main.u();Main.lb();Main.ep();Main.__referenceInitHCa();Main.Jk();Native.hht();Main.oH();Main.__referenceInitRecent();Main.__referenceInitSuggestions();
 const R=Core.nLt(),client=new Core.iut({defaultOptions:{queries:{retry:false}}});
 const report=e=>audit.errors.push(String(e?.stack||e));
 const root=Core.XAt().createRoot(document.getElementById('root'),{onUncaughtError:report,onCaughtError:report,onRecoverableError:report});
 const threadId='00000000-0000-4000-8000-000000000003';
 const thread={clientThreadId:null,routeConversationId:threadId,hostId:'local'};
 const route={...thread,routeKind:'local-thread',conversationId:threadId,pathname:'/local/'+threadId,search:''};
 const composer=Native.t2t(route,null,null);audit.scope={thread,route,composer};
 window.hcaReceive=(kind,message,response)=>{
   if(kind==='host'){Native.X9t.dispatchHostMessage(response);return}
   if(!window.hcaScope)throw Error('Missing original AppScope for RPC reply');
   window.hcaScope.get(Main.Fdt,message.hostId).onResult(Main.A0t(message.request.id),response);
 };
 const peer=await activateOriginalRpcPeer({Core,Native,ownerWindow:window,origin:location.origin,
  executionPermit:{kind:'closed-original-rpc-synthetic-negative',runAuthorized:true,originalPackagesMayExecute:true,authorizationId:'parent-model-menu-keyboard-20261027'},
  originalAssetHashes:{core:'50e2af3d8c3d0e3c52612beb2d95940cc818dfe979d6d85a9fa61af5526640bc',native:'c755dbca916c0f830a554fe2e3057f8642b32394bea7701338e5d506f692ad56',host:'a8069de80c8f8141481d033f94c3a95e1b59f399143cb2554d3f68469dfbe5b8'},
  registerNativeEnvelopeHandler:window.hcaRegisterHandler,emit:entry=>{audit.ledger.push(entry)},
  postToNative:(envelope,origin)=>window.postMessage(envelope,origin),onStop:detail=>{audit.rpcStop=detail}
 });await peer.handshake;
 const overlayAnchorRef=R.createRef();
 function Register({controller}){Main.__referenceRegisterComposer(controller,true,true,false,false,false);return null}
 function Body(){
  const scope=Core._lt(Native.W9t);window.hcaScope=scope;
  if(window.hcaFixture.observeHistory) audit.observedTurnCount=Main.__noticeUseKeyedAtom(Main.__noticeTurnCount,threadId);
  const [ready,setReady]=R.useState(false);
  R.useLayoutEffect(()=>{
   try{
    const fixture=window.hcaFixture;
    if(fixture.gateMode!=='absent'){
      const SDK=Main.__noticeSdk();
      const sdk=new SDK.StatsigClient('client-owned-model-notice-fixture',{userID:'owned-synthetic-fixture',customIDs:{stableID:'00000000-0000-4000-8000-000000000004'}},{disableStorage:true,loggingEnabled:'disabled',networkConfig:{preventAllNetworkTraffic:true}});
      sdk.dataAdapter.setData(JSON.stringify({time:1,has_updates:true,hash_used:'none',user:sdk.getContext().user,feature_gates:{'3727129412':{name:'3727129412',value:fixture.gateMode==='true',rule_id:'declared-synthetic',secondary_exposures:[]}},dynamic_configs:{},layer_configs:{},sdkParams:{}}));
      const result=sdk.initializeSync({disableBackgroundCacheRefresh:true});scope.set(Main.__noticeGateClient,sdk);window.hcaSdk=sdk;
      audit.sdk={result,loadingStatus:sdk.loadingStatus,evaluation:sdk.getFeatureGate('3727129412',{disableExposureLog:true}),gate:Main.__noticeReadGate(scope,'3727129412')};
      if(audit.sdk.gate!==(fixture.gateMode==='true'))throw Error('Original SDK bootstrap gate did not match declared input');
    }
    const manager=scope.get(Main.__noticeManagerAtom,'local');window.hcaManager=manager;
    audit.managerMethods=Object.getOwnPropertyNames(Object.getPrototypeOf(manager));
    const conversation={id:threadId,hostId:'local',cwd:'/fixture',title:'Synthetic existing thread',createdAt:1,updatedAt:1,resumeState:'resumed',requests:[],mode:'local',modelProvider:'openai',latestModel:initial,latestReasoningEffort:fixture.effort,latestCollaborationMode:{mode:'default',settings:{model:initial,reasoning_effort:fixture.effort,developer_instructions:null}},turns:Array.from({length:fixture.turnCount},(_,index)=>({turnId:index===fixture.turnCount-1?fixture.latestTurnId:'earlier-'+index,status:'completed',items:[],params:{cwd:'/fixture',input:[],model:initial},turnStartedAtMs:1,durationMs:1})),ephemeral:false};
    manager.setConversation(conversation);manager.notifyConversationUpdated(threadId);
    audit.modelSnapshot={latestTurn:scope.get(Main.__noticeLatestTurn,threadId),count:scope.get(Main.__noticeTurnCount,threadId),gate:Main.__noticeReadGate(scope,'3727129412')};
    setReady(true);window.hcaFlush();
   }catch(e){report(e)}
  },[scope]);
  return ready?R.createElement(R.Fragment,null,R.createElement(Main.l),R.createElement(Main.iH,null,R.createElement(Main.cb,{defaultText:new URLSearchParams(location.search).has('recent')?'':'Owned original composer',children:controller=>{
    window.hcaController=controller;
    return R.createElement('section',{'data-full-hca':true,ref:overlayAnchorRef,style:{marginTop:new URLSearchParams(location.search).has('recent')?'400px':0}},R.createElement(Register,{controller}),R.createElement(Main.$f,{composerController:controller,allowRemoteImages:false,submitReady:false,onSubmit:()=>{throw Error('Task submission forbidden')},ariaLabel:'Original composer fixture'}),R.createElement(Main.__referenceHCa,{conversationId:threadId,permissionsHostId:'local',hideLabel:false}),
      new URLSearchParams(location.search).has('recent')?R.createElement(R.Fragment,null,
        R.createElement('div',{'data-above-composer-portal':'','data-above-composer-conversation-id':Main.__noticePortalKey(composer),style:{position:'relative',marginTop:'350px'}}),
        R.createElement(Main.__referenceRecent,{conversationId:threadId,permissionsHostId:'local'}),
        R.createElement(Main.dp,{placement:'top',overlayAnchorRef})
      ):null);
  }}))):null;
 }
 const element=R.createElement(Core.rct,{client},R.createElement(Core.Tlt,{queryClient:client},R.createElement(Core.Clt,{scope:Native.W9t,value:{}},R.createElement(Core.Clt,{scope:Native.K2t,value:thread},R.createElement(Core.Clt,{scope:Native.D2t,value:route},R.createElement(Core.Clt,{scope:Native.e2t,value:composer},R.createElement(Core.Nbt,{locale:'en-US',defaultLocale:'en-US',messages:{},onError:report},R.createElement(Native.S,null,R.createElement(Native.q,null,R.createElement(Main.qk,{initialEntries:[route.pathname]},R.createElement(Body)))))))))));
 window.hcaModules={Core,Native,Main,R,client,root,peer};root.render(element);window.hcaFlush();audit.bootstrap=true;
 window.hcaDispose=()=>{root.unmount();peer.dispose('owned-fixture-end');client.clear()};
}catch(e){audit.errors.push(String(e?.stack||e))}
