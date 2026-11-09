// Private acceptance metadata only: one selected app-server stdio prefix.
// Browser view ownership is established separately by the original UI observer.
import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {lstat,open,readdir,realpath} from 'node:fs/promises';
import {join} from 'node:path';

const sha=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const hash=value=>createHash('sha256').update(value).digest('hex');
const cliSha='6253fb59fc4c21a9134b2f73237650eaec4a3d9380e5af12f3f1e9040dc24c14';
const tools=new Set(['commandExecution','fileChange','mcpToolCall','dynamicToolCall','webSearch','imageView','collabAgentToolCall']);
const benign=new Set(['agentMessage','userMessage','reasoning','plan','enteredReviewMode','exitedReviewMode']);
const unknown=()=>({prefix:'unknown',nativeCoverage:'single-child-observed-prefix-only',viewAttestation:'independent-ui-observer-required',otherStreams:'unknown',target:{state:'unknown'},followup:{state:'unknown'}});

// Docker top is obtained for this fixture's captured container ID. PID namespace
// numbers from the observer are matched against /proc, then identity is checked
// again after the caller has revalidated the owned container generation.
export async function verifyNativeObserverProcesses({start,top,readIdentity,executables}={}){
 try{
  if(typeof top!=='string'||top.length>131072||typeof readIdentity!=='function'||!executables||!['app','node','cli'].every(k=>typeof executables[k]==='string'&&executables[k]))return false;
  const lines=top.trim().split('\n');if(lines.shift()?.trim().replace(/\s+/g,' ')!=='PID PPID'||lines.length<2||lines.length>1024)return false;
  const topProcesses=new Map();for(const line of lines){const m=/^\s*(\d+)\s+(\d+)\s*$/.exec(line);if(!m)return false;const pid=Number(m[1]),ppid=Number(m[2]);if(!Number.isSafeInteger(pid)||pid<1||!Number.isSafeInteger(ppid)||topProcesses.has(pid))return false;topProcesses.set(pid,ppid)}
  const processes=[];for(const [pid,ppid] of topProcesses){try{const p=await readIdentity(pid);if(p&&p.ppid===ppid)processes.push({pid,...p})}catch{}}
  const wrappers=processes.filter(p=>p.nsPid===start?.wrapperPid&&p.ticks===start?.wrapperStartTicks&&p.exe===executables.node),children=processes.filter(p=>p.nsPid===start?.childPid&&p.ticks===start?.childStartTicks&&p.exe===executables.cli);if(wrappers.length!==1||children.length!==1)return false;
  const wrapper=wrappers[0],child=children[0];return child.ppid===wrapper.pid&&processes.some(p=>p.pid===wrapper.ppid&&p.exe===executables.app);
 }catch{return false}
}

export async function readNativeObserverDirectory({directory,profileId,generation,threadHash,now=Date.now(),verifyProcess}={}){
 const unknownState=()=>({state:'unknown',healthyCandidates:0,otherStreams:'unknown',nativeCoverage:'single-child-observed-prefix-only',target:{state:'unknown'}});
 try{
  if(typeof directory!=='string'||!directory.startsWith('/')||await realpath(directory)!==directory||typeof verifyProcess!=='function')return unknownState();
  const uid=process.getuid(),d=await lstat(directory,{bigint:true});if(!d.isDirectory()||d.uid!==BigInt(uid)||(d.mode&0o7777n)!==0o700n)return unknownState();
  const names=await readdir(directory);if(names.length>32||names.some(n=>!/^observation-[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.jsonl$/.test(n)))return unknownState();
  let total=0;const candidates=[];
  for(const name of names.sort()){
   const path=join(directory,name),fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);let bytes;
   try{
    const a=await fd.stat({bigint:true});if(!a.isFile()||a.uid!==BigInt(uid)||(a.mode&0o7777n)!==0o600n||a.nlink!==1n||a.size>8n*1024n*1024n)return unknownState();total+=Number(a.size);if(total>16*1024*1024)return unknownState();
    bytes=Buffer.alloc(Number(a.size));let offset=0;while(offset<bytes.length){const {bytesRead}=await fd.read(bytes,offset,bytes.length-offset,offset);if(!bytesRead)return unknownState();offset+=bytesRead}
    const b=await fd.stat({bigint:true}),named=await lstat(path,{bigint:true});if(!['dev','ino','uid','mode','nlink'].every(k=>a[k]===b[k]&&a[k]===named[k])||b.size<a.size||named.size<a.size)return unknownState();
   }finally{await fd.close()}
   const text=bytes.toString('utf8'),last=text.lastIndexOf('\n');if(last<0)continue;const lines=text.slice(0,last).split('\n');if(lines.length>100000||lines.some(line=>Buffer.byteLength(line)>65536))return unknownState();const records=lines.map(line=>JSON.parse(line));
   if(records[0]?.invocation!=='app-server')continue;
   const summary=summarizeNativeObservation({records,profileId,generation,threadHash,now});if(summary.prefix==='complete'&&await verifyProcess(records[0])===true)candidates.push({summary,identity:hash([records[0].wrapperPid,records[0].wrapperStartTicks,records[0].childPid,records[0].childStartTicks].join(':'))});
  }
  if(!candidates.length)return unknownState();const targets=candidates.filter(x=>x.summary.target.state==='completed');return {state:'ready',healthyCandidates:candidates.length,processIdentities:candidates.map(x=>x.identity).sort(),targetProcessIdentity:targets.length===1?targets[0].identity:null,otherStreams:'unknown',nativeCoverage:'single-child-observed-prefix-only',target:targets.length===1?targets[0].summary.target:{state:'unknown'},followup:targets.length===1?targets[0].summary.followup:{state:'unknown'}};
 }catch{return unknownState()}
}

export function summarizeNativeObservation({records,profileId,generation,now=Date.now(),threadHash,maxAgeMs=10000}={}){
 const result=unknown();
 try{
  if(!Array.isArray(records)||records.length<2||records.length>100000||typeof profileId!=='string'||!profileId||typeof generation!=='string'||!generation||!Number.isFinite(now)||!Number.isSafeInteger(maxAgeMs)||maxAgeMs<1||maxAgeMs>30000)return result;
  const start=records[0],scope=start?.scope;if(start?.event!=='start'||start.sourceCoverage!=='single-child-stdio-only'||start.invocation!=='app-server'||start.argvContainsAppServer!==true||start.cliSha256!==cliSha||!Number.isSafeInteger(start.wrapperPid)||start.wrapperPid<1||!Number.isSafeInteger(start.childPid)||start.childPid<1||!/^\d+$/.test(start.wrapperStartTicks??'')||!/^\d+$/.test(start.childStartTicks??'')||scope?.profileHash!==hash(profileId)||scope?.generationHash!==hash(generation)||scope?.viewExpectedHash!==null||scope?.binding!=='fixture-configured'||scope?.viewAttestation!=='unverified')return result;
  let checkpointIndex=-1,previous=0;
  for(let i=1;i<records.length;i++){const r=records[i];if(!r||!Number.isSafeInteger(r.sequence)||r.sequence!==previous+1)return result;previous=r.sequence;if(r.event==='gap')return result;if(r.event==='checkpoint')checkpointIndex=i}
  if(checkpointIndex<1)return result;const checkpoint=records[checkpointIndex],stream=x=>x?.state==='complete'&&x.gaps===0&&['complete','partial'].includes(x.classification);
  if(checkpoint.prefixOnly!==true||checkpoint.scope?.profileHash!==scope.profileHash||checkpoint.scope?.generationHash!==scope.generationHash||checkpoint.scope?.viewAttestation!=='unverified'||!Number.isFinite(checkpoint.timeMs)||now-checkpoint.timeMs< -1000||now-checkpoint.timeMs>maxAgeMs||!stream(checkpoint.stdin)||!stream(checkpoint.stdout)||checkpoint.sink?.state!=='complete'||checkpoint.correlation?.state!=='complete')return result;
  result.prefix='complete';result.partialClassification=checkpoint.stdin.classification==='partial'||checkpoint.stdout.classification==='partial';
  if(!sha(threadHash))return result;
  const events=records.slice(1,checkpointIndex).filter(r=>r.event==='rpc'),starts=events.filter(r=>r.source==='stdout'&&r.kind==='response'&&r.requestMethod==='thread/start'&&r.matched===true&&r.threadHash===threadHash);
  if(starts.length!==1||!sha(starts[0].idHash))return result;const startRequests=events.filter(r=>r.source==='stdin'&&r.kind==='request'&&r.method==='thread/start'&&r.idHash===starts[0].idHash);if(startRequests.length!==1)return result;
  const turns=events.filter(r=>r.source==='stdin'&&r.kind==='request'&&r.method==='turn/start'&&r.threadHash===threadHash),first=turns.filter(r=>r.promptMatch===true),next=turns.filter(r=>r.followupPromptMatch===true);if(first.length!==1||next.length>1||turns.length!==first.length+next.length||!sha(first[0].idHash))return result;
  const turnEvidence=(request,isFollowup)=>{
   const responses=events.filter(r=>r.source==='stdout'&&r.kind==='response'&&r.requestMethod==='turn/start'&&r.matched===true&&r.idHash===request.idHash&&r.threadHash===threadHash&&sha(r.turnHash));if(responses.length!==1)return null;const turnHash=responses[0].turnHash;
   const completed=events.filter(r=>r.source==='stdout'&&r.kind==='notification'&&r.method==='turn/completed'&&r.threadHash===threadHash&&r.turnHash===turnHash),items=events.filter(r=>r.source==='stdout'&&r.kind==='notification'&&['item/started','item/completed'].includes(r.method)&&r.threadHash===threadHash&&r.turnHash===turnHash),replies=items.filter(r=>r.method==='item/completed'&&r.itemType==='agentMessage'&&(isFollowup?r.followupReplyMarkerMatch===true:r.replyMarkerMatch===true));if(completed.length!==1||replies.length!==1)return null;
   const comparison=isFollowup?request.followupPromptMatch:request.promptMatch,evidence={state:'completed',promptMatches:typeof comparison==='boolean'?comparison:null,turnStatus:completed[0].turnStatus,replyMarkerSeen:true,toolItems:items.filter(r=>tools.has(r.itemType)).length,unknownItems:items.filter(r=>!tools.has(r.itemType)&&!benign.has(r.itemType)).length,approvalPolicy:['untrusted','on-failure','on-request','never'].includes(request.approvalPolicy)?request.approvalPolicy:'unknown',sandboxPolicy:['readOnly','workspaceWrite','dangerFullAccess','externalSandbox'].includes(request.sandboxPolicy)?request.sandboxPolicy:'unknown'};return {evidence,completionSequence:completed[0].sequence,turnHash};
  };
  const initial=turnEvidence(first[0],false);if(!initial)return result;const projectChecks=[startRequests[0].projectMatch,starts[0].projectMatch];result.target={...initial.evidence,threadProject:projectChecks.includes(false)?false:projectChecks.every(x=>x===true)?true:null};
  if(next.length===1&&sha(next[0].idHash)&&next[0].sequence>initial.completionSequence){const follow=turnEvidence(next[0],true);if(follow&&follow.turnHash!==initial.turnHash)result.followup={...follow.evidence,sameThread:true}}
  return result;
 }catch{return unknown()}
}
