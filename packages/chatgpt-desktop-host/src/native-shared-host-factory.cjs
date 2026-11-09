'use strict';
const {createNativeSharedDesktopTransport}=require('./native-shared-desktop-transport.cjs');
const {createNativeSharedMcpRelay}=require('./native-shared-mcp-relay.cjs');
const {HOST_ID,createSharedHostRegistration}=require('./shared-host-registration.cjs');
const {posix}=require('node:path');
const denied=()=>Object.assign(new Error('Shared desktop host unavailable'),{code:'SHARED_DESKTOP_HOST_UNAVAILABLE'});

/**
 * Uses the shipped owner's createAppServerConnection method. The returned
 * object is the original AppServerConnection, used unchanged for both original
 * registries; this module does not manufacture an SDK host or its services.
 * The sole factory adaptation replaces transport selection for this exact
 * private host/config object. Ordinary local/remote connections are untouched.
 */
function createNativeSharedHostFactory({profileId,generation,verifyRuntimeSync,sendFrame,enableAppTools=false,verifyAppToolsSync,onState=()=>{},onFailure=()=>{}}={}){
 if([verifyRuntimeSync,sendFrame,onState,onFailure].some(fn=>typeof fn!=='function')||typeof enableAppTools!=='boolean'||
    (enableAppTools&&typeof verifyAppToolsSync!=='function')||(verifyAppToolsSync!==undefined&&typeof verifyAppToolsSync!=='function'))throw denied();
 const config=Object.freeze({id:HOST_ID,kind:'local'}),listeners=new Set();
 let closed=false,activated=false,starting=false,owner=null,connection=null,source=null,releaseRegistration=null,releaseState=null,selected=false,desktopAppTools=null,createOriginalMcpSession=null,mcp=null;
 const current=()=>{try{return !closed&&verifyRuntimeSync()===true;}catch{return false;}};
 const transport=createNativeSharedDesktopTransport({profileId,generation,verifyRuntimeSync:current,sendFrame,
  ...(enableAppTools?{beforeConnect:()=>mcp.prepare(createOriginalMcpSession,desktopAppTools),getDesktopMcpServerConfig:()=>mcp.config}:{})});
 if(enableAppTools)mcp=createNativeSharedMcpRelay({profileId,generation,streamId:transport.streamId,verifyRuntimeSync:current,
  verifyRequestSync:()=>current()&&verifyAppToolsSync()===true,sendFrame,onFailure:()=>{report();close();}});
 const report=()=>{try{onFailure(denied());}catch{}};
 const notify=()=>{for(const fn of [...listeners]){try{fn();}catch{report();}}};
 const install=createSharedHostRegistration({
  getVerifiedSourceSync:()=>current()?source:null,
  subscribeSource:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},
  onState,onFailure,
 });
 function selectTransport(hostId,hostConfig,tools,createSession){
  if(!current()||!owner||selected||hostId!==HOST_ID||hostConfig!==config)throw denied();
  // These references are supplied at the pinned original eTw call, after its
  // actual desktop handlers have been built by the original owner factory.
  if(enableAppTools){if(tools?.hostId!==HOST_ID||typeof tools.handlers?.callTool!=='function'||typeof tools.handlers?.listTools!=='function'||typeof createSession!=='function')throw denied();desktopAppTools=tools;createOriginalMcpSession=createSession;}
  selected=true;return transport;
 }
 function ownsHomeSource(value,executionHost){
  try{
   return current()&&!!value&&source===value&&connection===executionHost&&
    value.connection===executionHost&&value.executionHost===executionHost&&value.isCurrent()===true&&
    executionHost.hostConfig===config&&typeof executionHost.codexHome==='function'&&
    owner.appServerConnectionRegistry.getMaybeConnection(HOST_ID)===executionHost&&
    owner.executionHostRegistry.getMaybe(HOST_ID)===executionHost;
  }catch{return false;}
 }
 async function readCodexHome(executionHost){
  const value=source;
  if(!ownsHomeSource(value,executionHost))throw denied();
  // The original SDK getter reads its real initialize response. This local-kind
  // host must not take ExecutionPathsService's process-local home shortcut.
  const home=await executionHost.codexHome();
  if(!ownsHomeSource(value,executionHost)||typeof home!=='string'||Buffer.byteLength(home)>4096||
     /[\u0000-\u001f\u007f]/.test(home)||!posix.isAbsolute(home)||posix.resolve(home)!==home)throw denied();
  return home;
 }
 function close(){
  if(closed)return;closed=true;source=null;notify();
  try{releaseRegistration?.();}catch{report();}releaseRegistration=null;
  try{releaseState?.();}catch{report();}releaseState=null;
  listeners.clear();transport.close();mcp?.close();desktopAppTools=null;createOriginalMcpSession=null;
  const original=connection;connection=null;
  try{original?.dispose();}catch{report();}
 }
 async function start(){
  try{
   if(!current()||!owner)throw denied();
   // This exact call goes through the unmodified native connection constructor
   // and all its original request, notification, auth and lifecycle handlers.
   const value=owner.createAppServerConnection(HOST_ID,config,false,owner.getLocalAppServerClient());
   connection=value;
   if(!selected||!value||value.hostId!==HOST_ID||value.id!==HOST_ID||value.hostConfig!==config||
      ['connect','dispose','registerWebviewWindow','registerInternalConnectionStateHandler'].some(name=>typeof value[name]!=='function'))throw denied();
   await value.connect();
   if(!current()||connection!==value||value.getConnectionState()!=='connected')throw denied();
   if(enableAppTools&&(!mcp.config||value.desktopMcpServerConfig!==mcp.config))throw denied();
   for(const window of owner.registeredWindows.values()){
    if(!current())throw denied();value.registerWebviewWindow(window);
   }
   source=Object.freeze({hostId:HOST_ID,connection:value,executionHost:value,isCurrent:()=>current()&&connection===value&&value.getConnectionState()==='connected'});
   releaseState=value.registerInternalConnectionStateHandler(()=>{
    if(!source?.isCurrent()){source=null;notify();close();}
   });
   if(typeof releaseState!=='function')throw denied();notify();
  }catch{report();close();}
 }
 function registerOwner(value){
  if(closed||owner||!value||typeof value.createAppServerConnection!=='function'||typeof value.getLocalAppServerClient!=='function'||
     typeof value.registeredWindows?.values!=='function'||typeof value.disposables?.add!=='function')throw denied();
  owner=value;
  try{
   releaseRegistration=install(value);value.disposables.add(close);
   // The injection point is in the original constructor. Its remaining fields
   // must finish initialization before the original factory is called.
   schedule();
  }catch(error){close();throw error;}
 }
 function schedule(){if(!closed&&activated&&owner&&!starting){starting=true;queueMicrotask(()=>{if(current())void start();else close();});}}
 function activate(){if(!current())throw denied();if(activated)return;activated=true;schedule();}
 return Object.freeze({registerOwner,activate,selectTransport,readCodexHome,receive:frame=>frame?.type?.startsWith('shared-mcp-')&&mcp?mcp.receive(frame):transport.receive(frame),close});
}
module.exports={createNativeSharedHostFactory};
