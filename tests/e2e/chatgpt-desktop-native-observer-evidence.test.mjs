import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {summarizeNativeObservation,verifyNativeObserverProcesses,readNativeObserverDirectory} from './chatgpt-desktop-native-observer-evidence.mjs';

const hash=x=>createHash('sha256').update(x).digest('hex'),profile='profile',generation='generation',thread=hash('thread'),turn=hash('turn'),one=hash('1'),two=hash('2');
const scope={profileHash:hash(profile),generationHash:hash(generation),viewExpectedHash:null,binding:'fixture-configured',viewAttestation:'unverified'};
const start={event:'start',sourceCoverage:'single-child-stdio-only',invocation:'app-server',argvContainsAppServer:true,wrapperPid:11,wrapperStartTicks:'111',childPid:12,childStartTicks:'112',cliSha256:'6253fb59fc4c21a9134b2f73237650eaec4a3d9380e5af12f3f1e9040dc24c14',scope};
const healthy={state:'complete',classification:'complete',bytes:100,lines:10,gaps:0,ended:false};
const records=()=>[start,
 {event:'rpc',sequence:1,source:'stdin',kind:'request',method:'thread/start',idHash:one,projectMatch:true},
 {event:'rpc',sequence:2,source:'stdout',kind:'response',requestMethod:'thread/start',idHash:one,threadHash:thread,matched:true,projectMatch:true},
 {event:'rpc',sequence:3,source:'stdin',kind:'request',method:'turn/start',idHash:two,threadHash:thread,promptMatch:true,approvalPolicy:'on-request',sandboxPolicy:'readOnly'},
 {event:'rpc',sequence:4,source:'stdout',kind:'response',requestMethod:'turn/start',idHash:two,threadHash:thread,turnHash:turn,matched:true},
 {event:'rpc',sequence:5,source:'stdout',kind:'notification',method:'item/completed',threadHash:thread,turnHash:turn,itemType:'agentMessage',replyMarkerMatch:true},
 {event:'rpc',sequence:6,source:'stdout',kind:'notification',method:'turn/completed',threadHash:thread,turnHash:turn,turnStatus:'completed'},
 {event:'checkpoint',sequence:7,timeMs:100000,prefixOnly:true,scope,stdin:healthy,stdout:healthy,sink:{state:'complete'},correlation:{state:'complete'}}];
const summarize=(r,extra={})=>summarizeNativeObservation({records:r,profileId:profile,generation,now:100100,threadHash:thread,...extra});

test('matches exactly one UI thread to the app-server start, turn, response and completion',()=>{
 const v=summarize(records());assert.equal(v.prefix,'complete');assert.equal(v.target.state,'completed');assert.equal(v.target.threadProject,true);assert.equal(v.target.promptMatches,true);assert.equal(v.target.turnStatus,'completed');assert.equal(v.target.replyMarkerSeen,true);assert.equal(v.target.toolItems,0);assert.equal(v.target.unknownItems,0);assert.equal(v.nativeCoverage,'single-child-observed-prefix-only');assert.doesNotMatch(JSON.stringify(v),/profile|generation|thread\"|turn\"/);
});
test('rejects stale checkpoints, gaps, changed scope, duplicate target events and startup config',()=>{
 const base=records();for(const r of [
  base.map(x=>x.event==='start'?{...x,invocation:'startup-config',argvContainsAppServer:false}:x),
  base.map(x=>x.event==='start'?{...x,scope:{...scope,profileHash:hash('other')}}:x),
  base.map(x=>x.event==='checkpoint'?{...x,timeMs:1}:x),
  base.map(x=>x.event==='checkpoint'?{...x,sink:{state:'unknown'}}:x),
  base.map(x=>x.sequence===4?{...x,sequence:9}:x),
 ])assert.equal(summarize(r).prefix,'unknown');
 const dupe=records();dupe.splice(4,0,{...dupe[3],sequence:4});dupe.forEach((x,i)=>{if(i>0)x.sequence=i});assert.equal(summarize(dupe).target.state,'unknown');
});
test('does not treat other thread activity or browser projection as global zero',()=>{
 const r=records();r.splice(6,0,{event:'rpc',sequence:6,source:'stdout',kind:'notification',method:'item/started',threadHash:hash('other'),turnHash:hash('other-turn'),itemType:'commandExecution'});r.forEach((x,i)=>{if(i>0)x.sequence=i});const v=summarize(r);assert.equal(v.target.state,'completed');assert.equal(v.target.toolItems,0);assert.equal(v.otherStreams,'unknown');assert.equal(v.viewAttestation,'independent-ui-observer-required');
});
test('a completed-only tool or unclassified target item is not reported as no tool activity',()=>{
 for(const type of ['commandExecution','other']){const r=records();r.splice(6,0,{event:'rpc',sequence:6,source:'stdout',kind:'notification',method:'item/completed',threadHash:thread,turnHash:turn,itemType:type});r.forEach((x,i)=>{if(i>0)x.sequence=i});const v=summarize(r);assert.equal(v.target.state,'completed');if(type==='other')assert.equal(v.target.unknownItems,1);else assert.equal(v.target.toolItems,1)}
});
test('native process identity requires exact owned container namespace, executable inode, parent and start ticks',async()=>{
 const entries={101:{nsPid:10,ppid:99,ticks:'110',exe:'app'},102:{nsPid:11,ppid:101,ticks:'111',exe:'node'},103:{nsPid:12,ppid:102,ticks:'112',exe:'cli'}};
 const check=override=>verifyNativeObserverProcesses({start,top:'PID PPID\n101 99\n102 101\n103 102\n',readIdentity:async pid=>({...entries[pid],...override?.[pid]}),executables:{app:'app',node:'node',cli:'cli'}});
 assert.equal(await check(),true);for(const change of [{102:{ticks:'wrong'}},{103:{ppid:101}},{103:{exe:'other'}},{102:{nsPid:99}},{101:{exe:'other'}}])assert.equal(await check(change),false);
 assert.equal(await verifyNativeObserverProcesses({start,top:'PID PPID\n102 101\n103 102\n',readIdentity:async pid=>entries[pid],executables:{app:'app',node:'node',cli:'cli'}}),false);
});
test('reads only fixed private observation files, ignores other invocation types, and rechecks process identity',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'native-observation-'));try{
  const file=join(dir,'observation-11111111-1111-4111-8111-111111111111.jsonl'),extra=join(dir,'observation-22222222-2222-4222-8222-222222222222.jsonl');
  await writeFile(file,records().map(x=>JSON.stringify(x)+'\n').join(''),{mode:0o600});await writeFile(extra,JSON.stringify({...start,invocation:'startup-config',argvContainsAppServer:false})+'\n',{mode:0o600});
  const opts={directory:dir,profileId:profile,generation,now:100100,threadHash:thread,verifyProcess:async()=>true};
  let v=await readNativeObserverDirectory(opts);assert.equal(v.state,'ready');assert.equal(v.healthyCandidates,1);assert.equal(v.target.state,'completed');assert.equal(v.otherStreams,'unknown');
  v=await readNativeObserverDirectory({...opts,verifyProcess:async()=>false});assert.equal(v.state,'unknown');
  await symlink(file,join(dir,'observation-33333333-3333-4333-8333-333333333333.jsonl'));assert.equal((await readNativeObserverDirectory(opts)).state,'unknown');
 }finally{await rm(dir,{recursive:true,force:true})}
});
test('links exactly one follow-up turn on the same original thread after the first completes',()=>{
 const r=records(),three=hash('3'),follow=hash('follow'),checkpoint=r.pop();r.push(
  {event:'rpc',sequence:7,source:'stdin',kind:'request',method:'turn/start',idHash:three,threadHash:thread,promptMatch:false,followupPromptMatch:true},
  {event:'rpc',sequence:8,source:'stdout',kind:'response',requestMethod:'turn/start',idHash:three,threadHash:thread,turnHash:follow,matched:true},
  {event:'rpc',sequence:9,source:'stdout',kind:'notification',method:'item/completed',threadHash:thread,turnHash:follow,itemType:'agentMessage',replyMarkerMatch:false,followupReplyMarkerMatch:true},
  {event:'rpc',sequence:10,source:'stdout',kind:'notification',method:'turn/completed',threadHash:thread,turnHash:follow,turnStatus:'completed'},
  {...checkpoint,sequence:11});
 const result=summarize(r);assert.equal(result.target.state,'completed');assert.equal(result.followup.state,'completed');assert.equal(result.followup.promptMatches,true);assert.equal(result.followup.replyMarkerSeen,true);assert.equal(result.followup.sameThread,true);
 const ambiguous=r.slice();ambiguous.splice(-1,0,{...ambiguous[7],sequence:11});ambiguous.at(-1).sequence=12;assert.equal(summarize(ambiguous).followup.state,'unknown');
});
