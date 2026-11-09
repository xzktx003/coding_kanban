// Fixture-only response copies. These never change the upstream package or
// production assets and accept only the already reviewed Wave B2 files.
import { createHash } from 'node:crypto';
const INPUT={bridge:'2fdf68c555c442893894f0078046308e935ba942c4ab86ef2cb189a7de3720d9',entry:'18db7ac3a8fda9b9d3d5627591d20448226c05e9babe3240c5c0c22d4101c786',nativeBootstrap:'31a414f7e4ba46dc1d2d0fc675c3bf24cb40b7329216ad7aa8ae3ad4af490628',nativeView:'066e30b7d676deac6a67a957ecfa83388ca53883ebc218625ce37aab088a1e0e'};
const sha=b=>createHash('sha256').update(b).digest('hex');
export const coreDiagnosticMayCreateProject=value=>value===false;
export function selectCoreDiagnosticAsset(url,origin,iframePath){
 try{const u=new URL(url);if(u.origin!==origin||u.search||u.hash||typeof iframePath!=='string'||!iframePath.endsWith('/index.html'))return null;const prefix=iframePath.slice(0,-'index.html'.length)+'__host/';if(u.pathname===prefix+'browser-entry.mjs')return 'entry';if(u.pathname===prefix+'browser-bridge.mjs')return 'bridge';return null}catch{return null}
}
function replaceOnce(text,needle,replacement){const at=text.indexOf(needle);if(at<0||text.indexOf(needle,at+needle.length)>=0)throw Error('diagnostic marker mismatch');return text.slice(0,at)+replacement+text.slice(at+needle.length)}
function adapt(body,kind,fn,expectedSha=INPUT[kind]){if(!/^[a-f0-9]{64}$/.test(expectedSha??'')||!Buffer.isBuffer(body)||sha(body)!==expectedSha)throw Error('diagnostic source mismatch');const originalSha256=sha(body),text=new TextDecoder('utf-8',{fatal:true}).decode(body),output=Buffer.from(fn(text));return {body:output,originalSha256,adaptedSha256:sha(output)}}

const helper=`
const __fixtureTrace = x => { try { const f = globalThis[Symbol.for('cg.fixture.bridge.trace')]; if (typeof f === 'function') { const r = f({...x, at: performance.now(), timeOrigin:performance.timeOrigin}); if (r && typeof r.catch === 'function') r.catch(() => {}); } } catch {} };
const __fixtureMeta = frame => {
  const types = ['call','openPort','closePort','portPost'];
  const methods = ['sendMessageFromView','startLinkDrag','acknowledgeChunkedMessage','connectGitWorker','sendWorkerMessageFromView','showContextMenu','getFastModeRolloutMetrics','workerSubscribe','workerUnsubscribe'];
  const operations = ['services','read','readAll','write','open','getState','getStableId','fetch','cancel','dispose','subscribe','get','set','list','initialize'];
  const d = Array.isArray(frame.data) ? frame.data : null;
  const rpcKind = d && ['push','pull','resolve','reject'].includes(d[0]) ? d[0] : null;
  const op = rpcKind === 'push' && Array.isArray(d[1]) && d[1][0] === 'pipeline' && Array.isArray(d[1][2]) ? d[1][2][0] : null;
  const rawType=frame.method==='sendMessageFromView'&&Array.isArray(frame.args)?frame.args[0]?.type:null;
  const messageType=typeof rawType==='string'&&/^[a-z][a-z0-9-]{0,79}$/.test(rawType)?rawType:null;
  return {type:types.includes(frame.type)?frame.type:'other',method:methods.includes(frame.method)?frame.method:null,messageType,port:typeof frame.portId==='string'&&/^(?:app-host|git-worker)-[0-9]{1,8}$/.test(frame.portId)?frame.portId:null,rpcKind,operation:operations.includes(op)?op:null};
};
`;
export function adaptCoreBridgeDiagnostic(body,expectedSha){return adapt(body,'bridge',source=>{
 let s=replaceOnce(source,"const error = (code, message) => Object.assign(new Error(message), { code });","const error = (code, message) => Object.assign(new Error(message), { code });\n"+helper);
 s=replaceOnce(s,"  scope = Object.freeze({ ...scope });","  scope = Object.freeze({ ...scope });\n  __fixtureTrace({event:'scope',scope});");
 s=replaceOnce(s,"    disposed = true; unsubscribe(); win.removeEventListener('message', connectPort);","    __fixtureTrace({event:'stop',code:reason?.code??null,message:reason?.message??null,report,pending:pending.size,queue:queue.length,waiting:waitingPortPosts.length,queuedBytes,retainedPortBytes,inFlightPortPosts});\n    disposed = true; unsubscribe(); win.removeEventListener('message', connectPort);");
 s=replaceOnce(s,"        const entry = queue.shift();\n        await transport.send(entry.encoded);","        const entry = queue.shift();\n        __fixtureTrace({event:'dispatch',id:entry.traceId,seq:entry.traceSeq,...entry.traceMeta,pending:pending.size,queue:queue.length,queuedBytes});\n        await transport.send(entry.encoded);\n        __fixtureTrace({event:'dispatched',id:entry.traceId,seq:entry.traceSeq,...entry.traceMeta,pending:pending.size,queue:queue.length,queuedBytes});");
 s=replaceOnce(s,"    queuedBytes += bytes; queue.push({ encoded, bytes }); void drain();","    queuedBytes += bytes; queue.push({ encoded, bytes, traceId:frame.id, traceSeq:outgoingSequence, traceMeta:__fixtureMeta(frame) }); __fixtureTrace({event:'enqueue',id:frame.id,seq:outgoingSequence,...__fixtureMeta(frame),pending:pending.size,queue:queue.length,queuedBytes}); void drain();");
 s=replaceOnce(s,"    const id = ++nextId;\n    return new Promise((resolve, reject) => {","    const id = ++nextId;\n    __fixtureTrace({event:'create',id,...__fixtureMeta(frame),pending:pending.size,queue:queue.length,waiting:waitingPortPosts.length,queuedBytes,retainedPortBytes,inFlightPortPosts});\n    return new Promise((resolve, reject) => {");
 s=replaceOnce(s,"      const timer = setTimeout(() => stop(error('BRIDGE_OUTCOME_UNKNOWN', 'Desktop reply timed out; reconcile the original operation before retrying'), true), requestTimeoutMs);","      const timer = setTimeout(() => { __fixtureTrace({event:'timeout',id,...__fixtureMeta(frame),pending:pending.size,queue:queue.length,waiting:waitingPortPosts.length,queuedBytes,retainedPortBytes,inFlightPortPosts}); stop(error('BRIDGE_OUTCOME_UNKNOWN', 'Desktop reply timed out; reconcile the original operation before retrying'), true); }, requestTimeoutMs);");
 s=replaceOnce(s,"          const entry = pending.get(frame.id);","          __fixtureTrace({event:frame.type,id:frame.id,seq:frame.seq,pending:pending.size,queue:queue.length,waiting:waitingPortPosts.length,queuedBytes,inFlightPortPosts});\n          const entry = pending.get(frame.id);");
 return s;
},expectedSha)}

export function adaptCoreEntryDiagnostic(body,expectedSha){return adapt(body,'entry',source=>{
 const trace="try { const f=globalThis[Symbol.for('cg.fixture.bridge.trace')]; if(typeof f==='function'){const p=f({event:'entry',stage,code:e?.code??null,message:e?.message??null,at:performance.now(),timeOrigin:performance.timeOrigin});if(p&&typeof p.catch==='function')p.catch(()=>{});} } catch {}";
 let s=replaceOnce(source,'const UUID =',`const __fixtureEntryTrace=(stage,e)=>{${trace}};\nconst UUID =`);
 s=replaceOnce(s,'onFailure: () => fail("ENTRY_BRIDGE_FAILED"),','onFailure: reason => { __fixtureEntryTrace("bridge-callback",reason); fail("ENTRY_BRIDGE_FAILED"); },');
 s=replaceOnce(s,'          } catch (error) {\n            const code = [','          } catch (error) {\n            __fixtureEntryTrace("message-catch",error);\n            const code = [');
 return s;
},expectedSha)}

const nativeHelper=`
    const __fixtureRecords = []; let __fixtureBytes = 0, __fixtureDropped = 0, __fixtureFd;
    try { __fixtureFd=fs.openSync(path.join(config.home,'.bridge-chain-diagnostic.jsonl'),fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600); } catch {}
    const __fixtureFlush = () => { try { if(__fixtureFd===undefined)return; const data=Buffer.from(__fixtureRecords.join('')); fs.ftruncateSync(__fixtureFd,0); for(let n=0;n<data.length;){const written=fs.writeSync(__fixtureFd,data,n,data.length-n,n);if(written<=0)break;n+=written;} } catch {} };
    const __fixture = (stage,frame={},extra={}) => { try {
      const allowedType=x=>typeof x==='string'&&/^[A-Za-z][A-Za-z0-9-]{0,79}$/.test(x)?x:null;
      const rawType=frame.method==='sendMessageFromView'&&Array.isArray(frame.args)?frame.args[0]?.type:frame.messageType;
      const s=extra.scope??frame.scope, scopeHash=s&&[s.profileId,s.generation,s.viewId].every(x=>typeof x==='string'&&UUID.test(x))?hashBytes([s.profileId,s.generation,s.viewId].join('\\0')):null;
      const row={stage,wallMs:Date.now(),clockMs:performance.now(),timeOrigin:performance.timeOrigin,scopeHash,type:allowedType(frame.type),method:allowedType(frame.method),messageType:allowedType(rawType),id:Number.isSafeInteger(frame.id)?frame.id:null,seq:Number.isSafeInteger(extra.seq??frame.seq)?(extra.seq??frame.seq):null,dropped:__fixtureDropped};
      for(const k of ['bytes','pending','queuedBytes','awaiting','awaitingBytes'])if(Number.isFinite(extra[k]))row[k]=extra[k];
      if(Number.isFinite(extra.clockMs))row.sourceClockMs=extra.clockMs;if(Number.isFinite(extra.timeOrigin))row.sourceTimeOrigin=extra.timeOrigin;
      const line=JSON.stringify(row)+'\\n',size=Buffer.byteLength(line);while(__fixtureRecords.length&&(__fixtureRecords.length>=2048||__fixtureBytes+size>120*1024)){__fixtureBytes-=Buffer.byteLength(__fixtureRecords.shift());__fixtureDropped++}if(size<=120*1024){__fixtureRecords.push(line);__fixtureBytes+=size;}
    } catch {} };
    const __fixtureTimer=setInterval(__fixtureFlush,750); __fixtureTimer.unref?.(); process.once('exit',__fixtureFlush);
`;
export function adaptCoreNativeBootstrapDiagnostic(body,expectedSha){return adapt(body,'nativeBootstrap',source=>{
 let s=replaceOnce(source,'    privateDirectory(config.home);','    privateDirectory(config.home);\n'+nativeHelper);
 s=replaceOnce(s,'          const contents = this.webContents, load = contents.loadURL.bind(contents);','          const contents = this.webContents, load = contents.loadURL.bind(contents);\n          contents.on("console-message",(_event,a,b)=>{try{const text=typeof a==="object"&&a!==null?a.message:b;if(typeof text!=="string"||!text.startsWith("@@CGTRACE:"))return;const row=JSON.parse(text.slice(10)),own=bySender.get(contents.id);if(typeof row.event!=="string"||!/^[a-z-]{1,40}$/.test(row.event))return;__fixture("shim-"+row.event,row,{...row,scope:own?scope(own.viewId):null})}catch{}});');
 s=replaceOnce(s,'    function output(record, frame) {','    function output(record, frame) {\n      __fixture("native-output",frame,{scope:scope(record.viewId),pending:record.pending.size,queuedBytes:record.queuedBytes});');
 s=replaceOnce(s,'      send({v:1,scope:scope(record.viewId),seq:++record.outSeq,...frame});','      __fixture("native-wire-output",frame,{scope:scope(record.viewId),seq:record.outSeq+1});\n      send({v:1,scope:scope(record.viewId),seq:++record.outSeq,...frame});');
 s=replaceOnce(s,'      if (!record || record.failed || event.senderFrame !== event.sender.mainFrame || !frame || typeof frame !== "object") return;\n      try {','      if (!record || record.failed || event.senderFrame !== event.sender.mainFrame || !frame || typeof frame !== "object") return;\n      __fixture("native-ipc-event",frame,{scope:scope(record.viewId),pending:record.pending.size,queuedBytes:record.queuedBytes});\n      try {');
 s=replaceOnce(s,'      } catch {\n        record.failed = true;','      } catch {\n        __fixture("native-frame-error",frame,{pending:record.pending.size});\n        record.failed = true;');
 s=replaceOnce(s,'        message = wire.decodeWireValue(encoded);','        message = wire.decodeWireValue(encoded);\n        __fixture("native-control",message,{bytes:Buffer.byteLength(encoded),pending:record?.pending?.size??0});');
 s=replaceOnce(s,'          record.window.webContents.send("kanban-owned:command",command);','          __fixture("native-dispatch",command,{scope:scope(record.viewId),seq:message.seq,pending:record.pending.size});\n          record.window.webContents.send("kanban-owned:command",command);');
 s=replaceOnce(s,'      } catch (error) {\n        if (record?.viewId) void registry.destroy(record.viewId);','      } catch (error) {\n        __fixture("native-control-error",message??{},{});\n        if (record?.viewId) void registry.destroy(record.viewId);');
 return s;
},expectedSha)}

const viewHelper=`
  const __fixtureTrace=(event,frame={},extra={})=>{try{
    const safe=x=>typeof x==='string'&&/^[A-Za-z][A-Za-z0-9-]{0,79}$/.test(x)?x:null;
    const raw=frame.method==='sendMessageFromView'&&Array.isArray(frame.args)?frame.args[0]?.type:frame.messageType;
    const row={event,type:safe(frame.type),method:safe(frame.method),messageType:safe(raw),id:Number.isSafeInteger(frame.id)?frame.id:null,clockMs:performance.now(),timeOrigin:performance.timeOrigin};
    for(const k of ['bytes','awaiting','awaitingBytes'])if(Number.isFinite(extra[k]))row[k]=extra[k];
    console.debug('@@CGTRACE:'+JSON.stringify(row));
  }catch{}};
`;
export function adaptCoreNativeViewDiagnostic(body,expectedSha){return adapt(body,'nativeView',source=>{
 let s=replaceOnce(source,"  const control = window.__kanbanOwnedControl;",viewHelper+"  const control = window.__kanbanOwnedControl;");
 s=replaceOnce(s,"  function overflow() {\n    if (disposed) return;","  function overflow() {\n    __fixtureTrace('overflow',{}, {awaiting:awaiting.length,awaitingBytes});\n    if (disposed) return;");
 s=replaceOnce(s,"  const emit = frame => {\n    if (disposed) return;","  const emit = frame => {\n    __fixtureTrace('emit-start',frame,{awaiting:awaiting.length,awaitingBytes});\n    if (disposed) return;");
 s=replaceOnce(s,"      awaiting.push(bytes); awaitingBytes += bytes; control.emit(frame);","      awaiting.push(bytes); awaitingBytes += bytes; control.emit(frame); __fixtureTrace('emit-sent',frame,{bytes,awaiting:awaiting.length,awaitingBytes});");
 s=replaceOnce(s,"  control.subscribe(async frame => {\n    if (disposed) return;","  control.subscribe(async frame => {\n    if (frame?.type !== 'ack') __fixtureTrace('command',frame,{awaiting:awaiting.length,awaitingBytes});\n    if (disposed) return;");
 s=replaceOnce(s,"          value = await bridge[frame.method](...frame.args);","          __fixtureTrace('await-start',frame,{awaiting:awaiting.length,awaitingBytes});\n          try { value = await bridge[frame.method](...frame.args); __fixtureTrace('await-resolved',frame,{awaiting:awaiting.length,awaitingBytes}); } catch (error) { __fixtureTrace('await-rejected',frame,{awaiting:awaiting.length,awaitingBytes}); throw error; }");
 return s;
},expectedSha)}

/** Fixed categories only: no native log line, path, identity or message retained. */
export function createCoreNativeStderrObserver(emit){
 let tail='',emitted=0,truncated=false;
 const line=value=>{const emfile=/\bEMFILE\b|too many open files/i.test(value),inotify=/\binotify(?:_init1?)?\b/i.test(value),errno24=/\berrno\s*[:=]?\s*24\b|\berror\s*[:=]?\s*24\b/i.test(value);if(!emfile&&!inotify&&!errno24)return;if(emitted>=128){if(!truncated){truncated=true;emit({event:'truncated'})}return}emitted++;emit({event:'resource-error',emfile,inotify,errno24})};
 return Object.freeze({push(chunk){try{tail+=(typeof chunk==='string'?chunk:Buffer.from(chunk).toString('utf8'));let at;while((at=tail.indexOf('\n'))>=0){line(tail.slice(0,at));tail=tail.slice(at+1)}if(tail.length>8192){tail=tail.slice(-8192);if(!truncated){truncated=true;emit({event:'truncated'})}}}catch{}},flush(){try{if(tail)line(tail);tail=''}catch{}}});
}
export function adaptCoreNativeStderrDiagnostic(body,expectedSha){return adapt(body,'nativeStderr',source=>{
 let s=replaceOnce(source,'import { existsSync, lstatSync, readFileSync } from "node:fs";','import { existsSync, lstatSync, readFileSync, openSync, writeSync, constants } from "node:fs";');
 const inject=`  let __stderrFd;try{__stderrFd=openSync(join(home,'.native-inotify-probe.jsonl'),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);writeSync(__stderrFd,JSON.stringify({event:'installed',wallMs:Date.now()})+'\\n')}catch{}\n  const __stderrProbe=(${createCoreNativeStderrObserver.toString()})(row=>{try{if(__stderrFd!==undefined)writeSync(__stderrFd,JSON.stringify({...row,wallMs:Date.now()})+'\\n')}catch{}});\n  native.stderr?.on('data',chunk=>__stderrProbe.push(chunk));native.on('exit',()=>__stderrProbe.flush());\n`;
 return replaceOnce(s,'  native.stdout?.resume();\n  native.stderr?.resume();',inject+'  native.stdout?.resume();\n  native.stderr?.resume();');
},expectedSha)}

// A fixture-only service copy keeps its artifact verification enabled while
// pinning the one observed launcher copy. No runtime skip or wildcard exists.
export function adaptCoreNativeStderrServiceDiagnostic(body,expectedSha,originalLauncherSha,observedLauncherSha){
 if(!/^[a-f0-9]{64}$/.test(originalLauncherSha??'')||!/^[a-f0-9]{64}$/.test(observedLauncherSha??'')||originalLauncherSha===observedLauncherSha)throw Error('diagnostic source mismatch');
 return adapt(body,'nativeStderrService',source=>replaceOnce(source,'"container-native.mjs":\n    "'+originalLauncherSha+'"','"container-native.mjs":\n    "'+observedLauncherSha+'"'),expectedSha);
}

export function summarizeCoreWireGraph(x){
 const out={};try{const field=(ref,key)=>{if(!Array.isArray(ref)||ref[0]!=='r'||!Array.isArray(x?.nodes?.[ref[1]]))return undefined;return x.nodes[ref[1]][2]?.find(e=>e[0]===key)?.[1]},safe=v=>typeof v==='string'&&/^[A-Za-z][A-Za-z0-9-]{0,79}$/.test(v)?v:undefined,type=field(x.root,'type'),id=field(x.root,'id'),method=field(x.root,'method');if(safe(type))out.type=type;if(Number.isSafeInteger(id))out.id=id;if(safe(method))out.method=method;if(method==='sendMessageFromView'){const first=field(field(x.root,'args'),'0'),messageType=field(first,'type');if(safe(messageType))out.messageType=messageType}}catch{}return out;
}

// Inspect only the encoder's fixed root-node header. Do not decode the graph,
// retain payload data, or scan unbounded content in a CDP frame.
export function extractCoreWireHeader(payload,{allowLargeHeader=false}={}){
 if(typeof payload!=='string')return {status:'unrecognized'};
 if(payload.length>65536&&!allowLargeHeader)return {status:'too-large'};
 const prefix='{"format":"chatgpt-apphost-wire","version":1,"root":["r",0],"nodes":[["object",';
 if(!payload.startsWith(prefix))return {status:'unrecognized'};
 const limit=Math.min(payload.length,4096);let i=prefix.length;
 if(payload.startsWith('false,[',i))i+=7;else if(payload.startsWith('true,[',i))i+=6;else return {status:'unrecognized'};
 const out={status:'truncated'},types=new Set(['bootstrap','createView','destroyView','viewClosed','openPort','closePort','portPost','portMessage','portClosed','call','return','throw','viewMessage','theme','workerMessage','gitPort','error']);let scopeRef=false;
 const finish=()=>{out.status='complete';if(scopeRef){const tail=payload.slice(i,Math.min(limit,i+400)),u='([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})',pattern=new RegExp('^\\]\\],\\["object",false,\\[\\["profileId","'+u+'"\\],\\["generation","'+u+'"\\],\\["viewId","'+u+'"\\]\\]\\]'),m=pattern.exec(tail);if(m){out.scopeHash=createHash('sha256').update([m[1],m[2],m[3]].join('\0')).digest('hex');out.parentHash=createHash('sha256').update([m[1],m[2]].join('\0')).digest('hex')}}return out};
 const skipString=()=>{if(payload[i++]!=='"')return false;while(i<limit){const c=payload[i++];if(c==='"')return true;if(c==='\\'){if(i>=limit)return false;i++}}return false};
 const skipValue=()=>{
  if(payload[i]==='"')return skipString();
  if(payload[i]==='['){let depth=0;while(i<limit){const c=payload[i];if(c==='"'){if(!skipString())return false;continue}i++;if(c==='['&&++depth>32)return false;if(c===']'&&--depth===0)return true}return false}
  const start=i;while(i<limit&&payload[i]!==','&&payload[i]!==']')i++;return i>start;
 };
 while(i<limit){
  if(payload[i]===']')return finish();
  if(payload[i++]!=='['||payload[i]!=='"')return {status:'unrecognized'};
  const start=i+1;if(!skipString())return out;const end=i-1;
  const key=end-start<=40?payload.slice(start,end):'';
  if(payload[i++]!==',')return {status:'unrecognized'};
  const valueStart=i;if(!skipValue())return out;const valueEnd=i;
  if(key==='type'&&valueEnd-valueStart<=82){const v=payload.slice(valueStart,valueEnd);if(/^"[A-Za-z][A-Za-z0-9-]*"$/.test(v)&&types.has(v.slice(1,-1)))out.type=v.slice(1,-1)}
  if(key==='method'&&valueEnd-valueStart<=82){const v=payload.slice(valueStart,valueEnd);if(/^"[A-Za-z][A-Za-z0-9-]*"$/.test(v))out.method=v.slice(1,-1)}
  if(key==='scope'&&payload.slice(valueStart,valueEnd)==='["r",1]')scopeRef=true;
  if((key==='id'||key==='seq')&&valueEnd-valueStart<=16){const v=payload.slice(valueStart,valueEnd);if(/^(?:0|[1-9][0-9]*)$/.test(v)&&Number.isSafeInteger(Number(v)))out[key]=Number(v)}
  if(payload[i++]!==']')return {status:'unrecognized'};
  if(payload[i]===','){i++;continue}if(payload[i]===']')return finish();return {status:'unrecognized'};
 }
 return out;
}

/** Decide whether a frame can contain the fixture's native request ledger. */
export function classifyCoreLedgerFrame(payload){
 if(typeof payload!=='string')return {kind:'unknown'};
 const header=extractCoreWireHeader(payload,{allowLargeHeader:true});
 if(!header.type)return {kind:'unknown'};
 if(header.type==='call'&&!header.method)return {kind:'unknown'};
 if(header.type!=='viewMessage'&&(header.type!=='call'||header.method!=='sendMessageFromView'))return {kind:'ignore'};
 if(payload.length>1024*1024)return {kind:'unknown'};
 const mcp=['"mcp-request"','"mcp-response"','"mcp-notification"'].some(x=>payload.includes(x)),activity=payload.includes('"local-thread-activity-changed"');
 return mcp||activity?{kind:'target',mcp,activity}:{kind:'ignore'};
}

/** Fixture-only CDP/long-task metadata, independently bounded and scoped. */
export function createCoreNetworkTrace({origin,bridgePath,maxRecords=1536,maxBytes=192*1024,expectedParentHash}={}){
 if(typeof origin!=='string'||typeof bridgePath!=='string'||(expectedParentHash!==undefined&&!/^[a-f0-9]{64}$/.test(expectedParentHash))||!Number.isSafeInteger(maxRecords)||maxRecords<1||maxRecords>1536||!Number.isSafeInteger(maxBytes)||maxBytes<256||maxBytes>192*1024)throw Error('invalid trace scope');
 const sockets=new Map(),scopeHashes=new Set();let nextSocket=0,calibration=null,rows=[],bytes=0,dropped=0,seq=0,longTaskState='unknown',scopeMismatch=false;
 const push=row=>{const record={sequence:++seq,...row},size=Buffer.byteLength(JSON.stringify(record));if(size>maxBytes){dropped++;return}while(rows.length&&(rows.length>=maxRecords||bytes+size>maxBytes)){bytes-=Buffer.byteLength(JSON.stringify(rows.shift()));dropped++}rows.push(record);bytes+=size};
 const calibrate=e=>{try{if(new URL(e?.request?.url).origin===origin&&Number.isFinite(e.timestamp)&&Number.isFinite(e.wallTime)&&calibration===null)calibration={timestamp:e.timestamp,wallTime:e.wallTime}}catch{}};
 const created=e=>{try{const u=new URL(e?.url);if(u.origin!==origin.replace(/^https:/,'wss:')||u.pathname!==bridgePath||u.search||u.hash||typeof e.requestId!=='string'||sockets.has(e.requestId))return;if(sockets.size>=16){nextSocket=17;return}sockets.set(e.requestId,++nextSocket);push({kind:'socket',socket:nextSocket,event:'created',observedWallMs:Date.now()})}catch{}};
 const frame=(direction,e)=>{try{const socket=sockets.get(e?.requestId);if(!socket||!['sent','received'].includes(direction)||!Number.isFinite(e?.timestamp))return;const response=e.response??{},row={kind:'frame',socket,direction,timestamp:e.timestamp,observedWallMs:Date.now(),opcode:response.opcode};if(calibration)row.wallMsApprox=Math.round((calibration.wallTime+e.timestamp-calibration.timestamp)*1000);if(response.opcode===1){const h=extractCoreWireHeader(response.payloadData);row.headerStatus=h.status;for(const k of ['type','id','seq','scopeHash'])if(h[k]!==undefined)row[k]=h[k];if(h.scopeHash&&expectedParentHash&&h.parentHash!==expectedParentHash)scopeMismatch=true;else if(h.scopeHash&&scopeHashes.size<2)scopeHashes.add(h.scopeHash);row.payloadUnits=typeof response.payloadData==='string'?response.payloadData.length:null}else row.headerStatus='non-text';push(row)}catch{}};
 const closed=e=>{const socket=sockets.get(e?.requestId);if(socket)push({kind:'socket',socket,event:'closed',timestamp:Number.isFinite(e.timestamp)?e.timestamp:null,observedWallMs:Date.now()})};
 const longTask=e=>{if(!Number.isFinite(e?.startTime)||e.startTime<0||!Number.isFinite(e?.duration)||e.duration<50||!Number.isFinite(e?.timeOrigin)||e.timeOrigin<=0)return;push({kind:'longtask',startWallMs:e.timeOrigin+e.startTime,duration:e.duration,observedWallMs:Date.now()})};
 const setLongTaskState=state=>{if(['installed','unsupported','error'].includes(state))longTaskState=state};
 return Object.freeze({calibrate,created,frame,closed,longTask,setLongTaskState,activeScopeHash:()=>nextSocket===1&&!scopeMismatch&&scopeHashes.size===1?[...scopeHashes][0]:null,snapshot:()=>({version:1,sockets:nextSocket,calibrated:!!calibration,clockCalibration:calibration?{...calibration}:null,longTaskState,scopeMismatch,dropped,events:structuredClone(rows)})});
}
function wireMetadata(encoded){
 const out={bytes:typeof encoded==='string'&&encoded.length<=65536?Buffer.byteLength(encoded):null};
 try{if(typeof encoded!=='string')return out;Object.assign(out,extractCoreWireHeader(encoded));if(out.type==='call'&&out.method==='sendMessageFromView'&&encoded.length<=8192)Object.assign(out,summarizeCoreWireGraph(JSON.parse(encoded)))}catch{}return out;
}
export function wrapCoreUpstream(original,emit){
 if(!original?.upstream||typeof original.upstream.send!=='function'||typeof original.upstream.subscribe!=='function'||typeof emit!=='function')throw Error('invalid upstream');
 const log=value=>{try{emit({...value,at:performance.now()})}catch{}};const inner=original.upstream;
 const upstream=Object.freeze({explicitDispatch:inner.explicitDispatch,
  async send(encoded,control){const meta=wireMetadata(encoded);log({event:'upstream-send',...meta});const wrapped={...control,onDispatch(...args){log({event:'upstream-dispatch',...meta});return Reflect.apply(control.onDispatch,control,args)}};try{const value=await Reflect.apply(inner.send,inner,[encoded,wrapped]);log({event:'upstream-resolved',...meta});return value}catch(error){log({event:'upstream-rejected',...meta});throw error}},
  subscribe(fn){return Reflect.apply(inner.subscribe,inner,[encoded=>{log({event:'upstream-frame',...wireMetadata(encoded)});fn(encoded)}])}
 });
 const descriptors=Object.getOwnPropertyDescriptors(original);delete descriptors.upstream;const result=Object.defineProperties({},descriptors);Object.defineProperty(result,'upstream',{value:upstream,enumerable:true});return Object.freeze(result);
}

// This journal is written only into the fixture's owned 0600 evidence file.
// It may contain private page errors; it is never sent to the UI or stdout.
export function createCoreDiagnosticJournal(){
 let rows=[],bytes=0,dropped=0,firstError=null,firstBridgeError=null,sequence=0;const budget=90*1024,firstExceptions=Object.create(null);
 const clip=(s,max)=>{let value=String(s??'').slice(0,max);if(Buffer.byteLength(JSON.stringify(value))<=max+2)return value;let lo=0,hi=value.length;while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(Buffer.byteLength(JSON.stringify(value.slice(0,mid)))<=max+2)lo=mid;else hi=mid-1}return value.slice(0,lo)};
 function recordException(phase,error){
  if(!['json','rpc','project','readback'].includes(phase)||Object.hasOwn(firstExceptions,phase))return false;
  const field=(name,max)=>{try{return clip(error?.[name],max)}catch{return ''}};
  firstExceptions[phase]={name:field('name',128),message:field('message',1024),stack:field('stack',2048)};return true;
 }
 function record(kind,value){
  if(!['bridge','upstream','transport','pageerror','console','route','launch'].includes(kind))return;
  let v;
  if(['pageerror','route','launch'].includes(kind)){v={name:clip(value?.name,128),message:clip(value?.message,4096),stack:clip(value?.stack,4096)};if(/^[A-Z][A-Z0-9_]{1,60}$/.test(value?.code??''))v.code=value.code;}
  else if(kind==='console')v={text:clip(value?.text,4096),location:clip(value?.location,512)};
  else if(value&&typeof value==='object'&&!Array.isArray(value)){
   v={};for(const k of ['event','stage','type','method','messageType','port','rpcKind','operation','code','message'])if(typeof value[k]==='string')v[k]=clip(value[k],512);
   if(/^[a-f0-9]{64}$/.test(value.scopeHash??''))v.scopeHash=value.scopeHash;
   for(const k of ['id','seq','at','timeOrigin','bytes','pending','queue','waiting','queuedBytes','retainedPortBytes','inFlightPortPosts'])if(Number.isFinite(value[k]))v[k]=value[k];
   if(typeof value.report==='boolean')v.report=value.report;
  }else return;
  const row={sequence:++sequence,wallMs:Date.now(),kind,value:v};
  if(!firstError&&(['pageerror','route','launch'].includes(kind)||kind==='bridge'&&['stop','entry'].includes(v.event)))firstError=structuredClone(row);
  if(!firstBridgeError&&kind==='bridge'&&['stop','entry'].includes(v.event))firstBridgeError=structuredClone(row);
  const size=Buffer.byteLength(JSON.stringify(row));if(size>budget){dropped++;return}
  while(rows.length&&(rows.length>=1024||bytes+size>budget)){bytes-=Buffer.byteLength(JSON.stringify(rows.shift()));dropped++}
  rows.push(row);bytes+=size;
 }
 return Object.freeze({record,recordException,snapshot(){return {version:1,firstError,firstBridgeError,firstExceptions:structuredClone(firstExceptions),dropped,events:structuredClone(rows)}}});
}
