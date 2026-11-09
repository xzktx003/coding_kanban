// Controlled acceptance fixture only. Uses the production factory, launcher,
// daemon transport, RPC gate and native writer, with no task authorization.
// It never supplies a synthetic account, native response, tool list or model.
import {openSync,closeSync,lstatSync,fstatSync,readFileSync,constants} from 'node:fs';
import {dirname,join,isAbsolute,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {createOwnedSharedDesktopSourceFactory} from '../../src/owned-shared-desktop-source.mjs';
import {createSharedDesktopDaemonSession} from '../../src/shared-desktop-daemon-session.mjs';
import {createContainerSharedAuthority} from '../../src/container-shared-authority.mjs';
import {encodeWireValue} from '../../src/wire-value.mjs';
import {createSharedMcpProxy} from '../../src/shared-mcp-proxy.mjs';
import {createRequire} from 'node:module';
const {createSharedAuthorityMemoryBudget}=createRequire(import.meta.url)('../../src/shared-thread-authority-channel.cjs');
const {isSharedMcpFrame}=createRequire(import.meta.url)('../../src/shared-mcp-wire.cjs');
const allowed=new Set(['initialize','initialized','account/read','getAuthStatus','config/read','configRequirements/read','model/list','collaborationMode/list','account/rateLimits/read','thread/list','thread/read','thread/turns/list','thread/items/list','configWarning','remoteControl/status/changed']);
const denied=()=>Object.assign(new Error('Read-only SDK fixture unavailable'),{code:'READONLY_SDK_FIXTURE_UNAVAILABLE'});
const same=(a,b)=>['dev','ino','size','uid','gid','mode','mtimeNs','ctimeNs'].every(key=>a[key]===b[key]);
function capture(path){
 if(typeof path!=='string'||!isAbsolute(path)||resolve(path)!==path)throw denied();
 const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{
  const info=fstatSync(fd,{bigint:true});if(!info.isFile()||info.uid!==BigInt(process.getuid())||(info.mode&0o7777n)!==0o600n||info.size>64n*1024n)throw denied();
  const bytes=readFileSync(fd);if(!same(info,fstatSync(fd,{bigint:true}))||!same(info,lstatSync(path,{bigint:true})))throw denied();
  return{path,fd,info,sha:createHash('sha256').update(bytes).digest('hex'),value:JSON.parse(bytes.toString())};
 }catch(cause){closeSync(fd);throw cause;}
}

export function createReadOnlySdkProbeFactory({recordFile,appTools=false}={}){
 if(typeof appTools!=='boolean')throw denied();
 const record=capture(recordFile),proof=capture(join(dirname(recordFile),'real-read-result.json')),registered=record.value,verified=proof.value;
 let closed=false,appToolsRegistered=0;
 if(registered.noLoginFiles!==true||registered.realDaemonReadVerified!==true||verified.codexHome!==registered.codexHome||
    verified.accountNull!==true||verified.authMethodNull!==true||verified.authTokenNull!==true||verified.threadCount!==0||verified.modelTurnRequests!==0){closeSync(record.fd);closeSync(proof.fd);throw denied();}
 function unchanged(file){return same(file.info,fstatSync(file.fd,{bigint:true}))&&same(file.info,lstatSync(file.path,{bigint:true}))&&createHash('sha256').update(readFileSync(file.path)).digest('hex')===file.sha;}
 function metadataCurrent(){
  try{if(closed||!unchanged(record)||!unchanged(proof))return false;
   try{lstatSync(join(registered.codexHome,'auth.json'));return false;}catch(cause){if(cause.code!=='ENOENT')return false;}
   return true;
  }catch{return false;}
 }
 const factory=createOwnedSharedDesktopSourceFactory({daemon:registered.daemon,codexHome:registered.codexHome,daemonVersion:registered.daemonVersion,
  projects:[{projectId:'readonly-sdk-probe',cwd:registered.projectDir}],verifyExecutionDomainSync:()=>metadataCurrent()},
  {nativeAppTools:appTools,sourceConstructor:async options=>{
   let session,authority,mcp,mcpStarting,mcpStreamId,retired=false;const methods=new Map(),memoryBudget=createSharedAuthorityMemoryBudget();
   const live=()=>!retired&&metadataCurrent()&&options.verifyContainerSync()===true;
   const isRead=frame=>live()&&allowed.has(frame?.method)&&!(frame.method==='getAuthStatus'&&frame.params?.includeToken!==false);
   function track(frame){if(frame&&Object.hasOwn(frame,'id')&&typeof frame.method==='string'){if(methods.size>=64)throw denied();methods.set(`${typeof frame.id}:${frame.id}`,frame.method);}}
   function checkReply(text){
    const frame=JSON.parse(text);if(frame.method)return;
    const key=`${typeof frame.id}:${frame.id}`,method=methods.get(key);methods.delete(key);
    if(!method||!Object.hasOwn(frame,'result'))return;
    if((method==='account/read'&&frame.result?.account!==null)||
       (method==='getAuthStatus'&&(frame.result?.authMethod!=null||frame.result?.authToken!=null))||
       (method==='thread/list'&&(!Array.isArray(frame.result?.data)||frame.result.data.length!==0)))throw denied();
   }
   function sendFrame(frame){if(!live())throw denied();if(frame.type==='shared-desktop-message')checkReply(frame.text);return options.writeNative(encodeWireValue(frame));}
   function close(){if(retired)return;retired=true;methods.clear();mcp?.close();authority?.close();session?.close();}
   session=createSharedDesktopDaemonSession({...options,memoryBudget,verifyContainerSync:live,verifySessionSync:live,verifyReadSync:isRead,
    verifyBindingSync:()=>false,verifyHistorySync:()=>false,verifyInitializeSync:result=>live()&&result.codexHome===registered.codexHome,
    verifyInitialAccountNotificationSync:()=>false,verifyStartupNotificationSync:()=>live(),verifyServerEventSync:()=>live(),authorizeServerReplySync:()=>false,
    sendFrame,receiveAuthority:encoded=>{checkReply(encoded);return authority.receiveDaemon(encoded);},onFailure:close});
   authority=createContainerSharedAuthority({profileId:options.profileId,generation:options.generation,memoryBudget,verifyContainerSync:live,
    verifyOwnedViewSync:options.verifyOwnedViewSync,sendFrame,rpcGate:session.authorityGate,
    sharedThread:{resolveBinding:async()=>{throw denied();},verifyViewSync:()=>false,verifyBindingSync:()=>false,verifyHistorySync:()=>false,verifyReadSync:isRead,write:encoded=>session.authorityGate.write(encoded)}});
   return Object.freeze({accountRevision:()=>{if(!live())throw denied();return null;},signal:session.signal,retireView(){},close,
    receiveNative(frame){
     if(!live())throw denied();
     if(frame.type.startsWith('shared-mcp-')){
      if(!appTools||!isSharedMcpFrame(frame,{side:'native',profileId:options.profileId,generation:options.generation}))throw denied();
      if(frame.type==='shared-mcp-register'){
       if(mcp||mcpStarting)throw denied();mcpStreamId=frame.streamId;
       mcpStarting=createSharedMcpProxy({profileId:options.profileId,generation:options.generation,streamId:mcpStreamId,
        verifyRuntimeSync:live,verifyScopeSync:()=>false,verifyThreadSync:()=>false,memoryBudget,onFailure:close,
        sendFrame:(value,verifyRequestSync)=>{
         if(!live()||typeof verifyRequestSync!=='function'||verifyRequestSync()!==true)throw denied();
         return options.writeNative(encodeWireValue(value),()=>live()&&verifyRequestSync()===true);
        },
       }).then(value=>{if(!live()){value.close();throw denied();}mcp=value;if(value.receive(frame)!==true)throw denied();appToolsRegistered++;}).catch(close);return true;
      }
      if(!mcp||frame.streamId!==mcpStreamId)throw denied();return mcp.receive(frame);
     }
     if(frame.type==='shared-desktop-open'&&appTools&&(!mcp?.config||frame.streamId!==mcpStreamId))throw denied();
     if(frame.type.startsWith('shared-desktop-')){if(frame.type==='shared-desktop-write')track(JSON.parse(frame.text));return session.receiveNative(frame);}
     if(frame.type==='shared-exchange'||frame.type==='shared-dispatch')track(frame.frame);
     if(frame.type==='shared-account-observation'||frame.type==='shared-account-revoked')throw denied();
     authority.receive(frame);return true;
    },
   });
  }});
 return Object.freeze({factory,record:Object.freeze({...registered}),appToolsStatus:()=>Object.freeze({enabled:appTools,registered:appToolsRegistered,toolAuthorization:false}),close(){if(closed)return;closed=true;closeSync(record.fd);closeSync(proof.fd);}});
}
