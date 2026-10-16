// Read-only fixture harness: official original assets are imported byte-for-byte via a symlink.
import * as Core from './assets/app-initial-c4ebaa710049.js';
import * as Native from './assets/app-initial-41ab338a184f.js';
import messages from './assets/zh-CN-b05cfd55c534.js';
try {
  Core.ict(); Core.Elt(); Core.wlt(); Core.Pbt(); Core.aut(); Native.wu(); Native.Yu();
  const R = Core.nLt();
  const client = new Core.iut({defaultOptions:{queries:{retry:false}}});
  const root=Core.XAt().createRoot(document.getElementById('root'), {onUncaughtError:e=>{window.nativeErrors.push(String(e.stack||e));document.getElementById('root').textContent=String(e)}});
  const thread={clientThreadId:'local:fixture',routeConversationId:'fixture',hostId:'local'};
  const route={...thread,routeKind:'client-local-thread',conversationId:'fixture',pathname:'/fixture',search:''};
  const wrap=element=>R.createElement(Core.rct,{client},R.createElement(Core.Tlt,{queryClient:client},R.createElement(Core.Clt,{scope:Native.W9t,value:{}},R.createElement(Core.Clt,{scope:Native.K2t,value:thread},R.createElement(Core.Clt,{scope:Native.D2t,value:route},R.createElement(Core.Nbt,{locale:'zh-CN',messages,onError:()=>{}},element))))));
  window.renderNativeGoal=(goal={})=>{window.nativeGoal={status:'active',objective:'复刻会话 Goal 行为与 UI',tokensUsed:1200,tokenBudget:null,timeUsedSeconds:65,createdAt:Math.floor(Date.now()/1000)-65,updatedAt:Math.floor(Date.now()/1000),...goal};root.render(wrap(R.createElement(Native.Cu,{conversationId:'fixture',hostId:'local',goal:window.nativeGoal})));};
  window.renderNativeGoalConfirmation=(kind,props)=>{root.render(wrap(R.createElement(kind==='replace'?Native.qu:Native.Ju,props)));};
  window.renderNativeGoalStatus=status=>root.render(wrap(R.createElement(Native.Tu,{status})));
  window.nativeGoalCore={Core,Native,R,wrap,root,client};
  window.nativeLoaded=true;
  window.renderNativeGoal();
} catch(e) {window.nativeErrors.push(String(e.stack||e));document.getElementById('root').textContent=String(e);}
