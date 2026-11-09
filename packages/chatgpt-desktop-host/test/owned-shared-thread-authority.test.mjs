import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {mkdtemp,mkdir,rm,rename,chmod,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {startOwnedSharedThreadAuthority} from '../src/owned-shared-thread-authority.mjs';
import {createSharedDaemonRpcGate} from '../src/shared-daemon-rpc-gate.mjs';
const fixture=fileURLToPath(new URL('./owned-provider-ws-daemon.mjs',import.meta.url));
const sha=createHash('sha256').update(readFileSync(process.execPath)).digest('hex');
const tick=()=>new Promise(r=>setImmediate(r));
async function until(fn){const end=Date.now()+2000;while(!fn()){if(Date.now()>end)throw Error('isolated fixture deadline');await tick();}}
async function setup(t,{preserve=false}={}){
 const root=await mkdtemp(join(tmpdir(),'owned-shared-provider-'));const home=join(root,'home'),cwd=join(root,'project');await mkdir(home,{mode:0o700});await mkdir(cwd,{mode:0o775});await chmod(cwd,0o775);
 if(preserve)await writeFile(join(home,'config.toml'),'model = "fixture-a"\n',{mode:0o600});
 const seen=[],child=spawn(process.execPath,[fixture,'app-server',join(root,'daemon.sock'),home,cwd,...preserve?['preserve']:[]],{stdio:['ignore','ignore','pipe','ipc']});const stderr=[];child.stderr.on('data',x=>stderr.push(x.toString()));child.on('message',x=>seen.push(x));await until(()=>seen.some(x=>x.ready));
 const s=readFileSync(`/proc/${child.pid}/stat`,'utf8');const daemon={pid:child.pid,startTicks:s.slice(s.lastIndexOf(')')+2).trim().split(/\s+/)[19],socketPath:join(root,'daemon.sock'),daemonGeneration:randomUUID(),exeSha256:sha};
 t.after(async()=>{if(child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));}await rm(root,{recursive:true,force:true});});
 const runtimeGeneration=randomUUID(),viewId=randomUUID(),view={viewId};let revision=1,domain=true,owned=view;
 const options={daemon,codexHome:home,runtimeGeneration,getOwnedView:id=>id===viewId?owned:null,getAccountRevision:()=>revision,verifyExecutionDomainSync:value=>domain&&value.runtimeGeneration===runtimeGeneration&&value.daemonGeneration===daemon.daemonGeneration&&value.accountRevision===revision,projects:[{projectId:'fixture-project',cwd}],timeoutMs:1000};
 return{options,seen,child,viewId,cwd,home,root,revision:x=>{revision=x},domain:x=>{domain=x},view:x=>{owned=x}};
}
test('owned actual Unix observer binds metadata and one exact gate-registered resume without startup writes',async t=>{
 const f=await setup(t),p=await startOwnedSharedThreadAuthority(f.options);t.after(()=>p.close());
 assert.equal(f.seen.some(x=>x.method==='thread/resume'),false);
 const threadId=randomUUID(),binding=await p.sharedThread.resolveBinding({viewId:f.viewId,hostId:'kanban-shared-cli',threadId,source:{executionDomain:'daemon',generation:f.options.daemon.daemonGeneration,accountRevision:1}});
 assert.equal(binding.projectId,'fixture-project');assert.equal(p.sharedThread.verifyBindingSync(binding),true);assert.equal(p.sharedThread.verifyHistorySync(binding),true);
 const replies=[],gate=createSharedDaemonRpcGate({...p.sharedThread,write:p.sharedThread.write});t.after(()=>gate.close());p.daemon.attachGateReceiver(encoded=>{replies.push(JSON.parse(gate.receive(encoded)));return true;});
 const frame={id:91,method:'thread/resume',params:{threadId,excludeTurns:true}};assert.throws(()=>gate.write(JSON.stringify(frame)),{code:'SHARED_DAEMON_DENIED'});
 assert.equal(gate.registerConnect(binding,frame,{attemptId:randomUUID(),signal:new AbortController().signal,deadline:performance.now()+1000}),true);gate.write(JSON.stringify(frame));await until(()=>replies.length===1);
 assert.deepEqual(f.seen.filter(x=>x.method==='thread/resume'),[{method:'thread/resume',params:{threadId,excludeTurns:true}}]);assert.equal(replies[0].result.thread.id,threadId);assert.throws(()=>gate.write(JSON.stringify(frame)));assert.equal(f.seen.filter(x=>x.method==='initialize').length,1);
});
test('changed account revision, owned view or project inode rejects the old binding at final dispatch',async t=>{
 const f=await setup(t),p=await startOwnedSharedThreadAuthority(f.options);t.after(()=>p.close());const request={viewId:f.viewId,hostId:'kanban-shared-cli',threadId:randomUUID()};
 const a=await p.sharedThread.resolveBinding(request);f.revision(2);assert.equal(p.sharedThread.verifyBindingSync(a),false);assert.equal(p.sharedThread.verifyHistorySync(a),false);
 const b=await p.sharedThread.resolveBinding(request);f.view({viewId:f.viewId});assert.equal(p.sharedThread.verifyBindingSync(b),false);
 const c=await p.sharedThread.resolveBinding(request);await rename(f.cwd,f.cwd+'-retired');await mkdir(f.cwd,{mode:0o775});assert.equal(p.sharedThread.verifyBindingSync(c),false);assert.throws(()=>p.sharedThread.write('{"id":1,"method":"thread/read","params":{}}'));
 assert.equal(f.seen.some(x=>x.method==='thread/resume'),false);
});
test('execution-domain/config proof, account and view absence deny binding rather than auto-approve',async t=>{
 const f=await setup(t);await assert.rejects(startOwnedSharedThreadAuthority({...f.options,verifyExecutionDomainSync:undefined}));const p=await startOwnedSharedThreadAuthority(f.options);t.after(()=>p.close());const req={viewId:f.viewId,hostId:'kanban-shared-cli',threadId:randomUUID()};
 f.domain(false);await assert.rejects(p.sharedThread.resolveBinding(req));assert.equal(p.sharedThread.verifyViewSync(req),false);f.domain(true);f.revision(null);await assert.rejects(p.sharedThread.resolveBinding(req));f.revision(3);f.view(null);await assert.rejects(p.sharedThread.resolveBinding(req));assert.equal(f.seen.some(x=>x.method==='thread/resume'),false);
});
test('same-value account notification aborts the actual observer and revokes writes',async t=>{
 const f=await setup(t),p=await startOwnedSharedThreadAuthority(f.options);t.after(()=>p.close());const b=await p.sharedThread.resolveBinding({viewId:f.viewId,hostId:'kanban-shared-cli',threadId:randomUUID()});f.child.send({type:'revoke'});await until(()=>p.daemon.signal.aborted);assert.equal(p.sharedThread.verifyBindingSync(b),false);assert.throws(()=>p.sharedThread.write('{}'));
});
test('project registration cannot overlap the account home or use an unregistered metadata cwd',async t=>{
 const f=await setup(t);await assert.rejects(startOwnedSharedThreadAuthority({...f.options,projects:[{projectId:'bad',cwd:f.home}]}));const outside=join(f.root,'other');await mkdir(outside,{mode:0o700});const p=await startOwnedSharedThreadAuthority({...f.options,projects:[{projectId:'other',cwd:outside}]});t.after(()=>p.close());await assert.rejects(p.sharedThread.resolveBinding({viewId:f.viewId,hostId:'kanban-shared-cli',threadId:randomUUID()}));assert.equal(f.seen.some(x=>x.method==='thread/resume'),false);
});

test('an already registered resume is denied after revision change, before any actual socket write',async t=>{
 const f=await setup(t),p=await startOwnedSharedThreadAuthority(f.options);t.after(()=>p.close());const threadId=randomUUID();const binding=await p.sharedThread.resolveBinding({viewId:f.viewId,hostId:'kanban-shared-cli',threadId});const gate=createSharedDaemonRpcGate({...p.sharedThread,write:p.sharedThread.write});t.after(()=>gate.close());p.daemon.attachGateReceiver(encoded=>{gate.receive(encoded);return true;});const frame={id:93,method:'thread/resume',params:{threadId,excludeTurns:true}};assert.equal(gate.registerConnect(binding,frame,{attemptId:randomUUID(),signal:new AbortController().signal,deadline:performance.now()+1000}),true);f.revision(2);assert.throws(()=>gate.write(JSON.stringify(frame)),{code:'SHARED_DAEMON_DENIED'});await tick();assert.equal(f.seen.some(x=>x.method==='thread/resume'),false);p.retireView(f.viewId);assert.equal(p.sharedThread.verifyBindingSync(binding),false);
});

test('replacement of the registered account directory inode revokes existing authority',async t=>{
 const f=await setup(t),p=await startOwnedSharedThreadAuthority(f.options);t.after(()=>p.close());const b=await p.sharedThread.resolveBinding({viewId:f.viewId,hostId:'kanban-shared-cli',threadId:randomUUID()});await rename(f.home,f.home+'-retired');await mkdir(f.home,{mode:0o700});assert.equal(p.sharedThread.verifyBindingSync(b),false);assert.equal(p.sharedThread.verifyReadSync({}),false);assert.throws(()=>p.sharedThread.write('{}'));assert.equal(f.seen.some(x=>x.method==='thread/resume'),false);
});

test('an observed loss of view authority never revives an old binding when the same record returns',async t=>{
 const f=await setup(t),p=await startOwnedSharedThreadAuthority(f.options);t.after(()=>p.close());const view=f.options.getOwnedView(f.viewId);const b=await p.sharedThread.resolveBinding({viewId:f.viewId,hostId:'kanban-shared-cli',threadId:randomUUID()});f.view(null);assert.equal(p.sharedThread.verifyViewSync({viewId:f.viewId,hostId:'kanban-shared-cli',threadId:b.threadId}),false);f.view(view);assert.equal(p.sharedThread.verifyBindingSync(b),false);const next=await p.sharedThread.resolveBinding({viewId:f.viewId,hostId:'kanban-shared-cli',threadId:b.threadId});assert.notEqual(next.clientId,b.clientId);assert.equal(p.sharedThread.verifyBindingSync(next),true);
});

test('configuration drift preserves guarded metadata reads; an explicit bind revalidates proof without reviving old writers',async t=>{
 const f=await setup(t,{preserve:true}),options={...f.options,verifyExecutionDomainSync:undefined,executionDomainPolicy:'preserve-native-cli'};
 const p=await startOwnedSharedThreadAuthority(options);t.after(()=>p.close());const request={viewId:f.viewId,hostId:'kanban-shared-cli',threadId:randomUUID()};
 const old=await p.sharedThread.resolveBinding(request);assert.equal(p.sharedThread.verifyBindingSync(old),true);
 const configBefore=f.seen.filter(frame=>frame.method==='config/read').length;
 await writeFile(join(f.home,'config.toml'),'model = "fixture-b"\n');
 assert.equal(p.sharedThread.verifyReadSync({method:'config/read'}),true);
 assert.equal(p.sharedThread.verifyViewSync(request),true);assert.equal(p.executionProof.verifyCurrentSync(),false);
 await tick();assert.equal(f.seen.filter(frame=>frame.method==='config/read').length,configBefore);
 assert.equal(p.sharedThread.verifyBindingSync(old),false);assert.throws(()=>p.sharedThread.write('{"method":"thread/resume"}'));
 const fresh=await p.sharedThread.resolveBinding(request);assert.notEqual(fresh.clientId,old.clientId);assert.equal(p.sharedThread.verifyBindingSync(fresh),true);assert.equal(p.sharedThread.verifyBindingSync(old),false);
 assert.ok(f.seen.filter(frame=>frame.method==='config/read').length>=configBefore+4);
 assert.equal(p.daemon.signal.aborted,false);assert.equal(f.seen.some(frame=>['thread/resume','thread/start','turn/start'].includes(frame.method)),false);
 f.revision(null);assert.equal(p.sharedThread.verifyReadSync({}),false);assert.equal(p.sharedThread.verifyBindingSync(fresh),false);
});


test('configuration drift retains old exact history scopes across explicit proof refresh while old writes stay revoked',async t=>{
 const f=await setup(t,{preserve:true}),p=await startOwnedSharedThreadAuthority({...f.options,verifyExecutionDomainSync:undefined,executionDomainPolicy:'preserve-native-cli'});t.after(()=>p.close());
 const request={viewId:f.viewId,hostId:'kanban-shared-cli',threadId:randomUUID()},old=await p.sharedThread.resolveBinding(request);
 assert.equal(p.sharedThread.verifyHistorySync(old),true);await writeFile(join(f.home,'config.toml'),'model = "fixture-history-b"\n');
 assert.equal(p.sharedThread.verifyBindingSync(old),false);assert.equal(p.sharedThread.verifyReadSync({method:'thread/turns/list'}),true);
 assert.equal(p.sharedThread.verifyHistorySync(old),true);assert.equal(p.daemon.signal.aborted,false);
 const before=f.seen.filter(frame=>frame.method==='config/read').length;
 assert.equal(p.sharedThread.verifyHistorySync({...old,threadId:randomUUID()}),false);assert.equal(p.sharedThread.verifyHistorySync({...old,viewId:randomUUID()}),false);
 assert.equal(p.sharedThread.verifyHistorySync({...old,runtimeGeneration:randomUUID()}),false);assert.equal(p.sharedThread.verifyHistorySync({...old,extra:true}),false);
 let getterCalls=0;assert.equal(p.sharedThread.verifyHistorySync(Object.defineProperty({...old},'clientId',{get(){getterCalls++;return old.clientId;}})),false);assert.equal(getterCalls,0);
 assert.equal(p.sharedThread.verifyHistorySync(old),true);await tick();assert.equal(f.seen.filter(frame=>frame.method==='config/read').length,before);
 const fresh=await p.sharedThread.resolveBinding(request);assert.equal(p.sharedThread.verifyBindingSync(fresh),true);assert.equal(p.sharedThread.verifyBindingSync(old),false);
 assert.equal(p.sharedThread.verifyHistorySync(old),true);assert.equal(p.sharedThread.verifyHistorySync(fresh),true);
 p.retireView(f.viewId);assert.equal(p.sharedThread.verifyHistorySync(old),false);assert.equal(p.sharedThread.verifyHistorySync(fresh),false);
 assert.equal(f.seen.some(frame=>['thread/resume','thread/start','turn/start'].includes(frame.method)),false);
});
test('observed account revision change permanently retires read scopes even if the prior numeric revision returns',async t=>{
 const f=await setup(t,{preserve:true}),p=await startOwnedSharedThreadAuthority({...f.options,verifyExecutionDomainSync:undefined,executionDomainPolicy:'preserve-native-cli'});t.after(()=>p.close());
 const old=await p.sharedThread.resolveBinding({viewId:f.viewId,hostId:'kanban-shared-cli',threadId:randomUUID()});
 f.revision(2);assert.equal(p.sharedThread.verifyReadSync({}),true);f.revision(1);
 assert.equal(p.sharedThread.verifyHistorySync(old),false);assert.equal(p.sharedThread.verifyBindingSync(old),false);
});
test('read scopes are permanently retired by view loss and held project replacement after proof-only failure',async t=>{
 const f=await setup(t,{preserve:true}),p=await startOwnedSharedThreadAuthority({...f.options,verifyExecutionDomainSync:undefined,executionDomainPolicy:'preserve-native-cli'});t.after(()=>p.close());
 const request={viewId:f.viewId,hostId:'kanban-shared-cli',threadId:randomUUID()},view=f.options.getOwnedView(f.viewId),old=await p.sharedThread.resolveBinding(request);
 await writeFile(join(f.home,'config.toml'),'model = "fixture-history-c"\n');assert.equal(p.sharedThread.verifyBindingSync(old),false);assert.equal(p.sharedThread.verifyHistorySync(old),true);
 f.view(null);assert.equal(p.sharedThread.verifyHistorySync(old),false);f.view(view);assert.equal(p.sharedThread.verifyHistorySync(old),false);
 const fresh=await p.sharedThread.resolveBinding(request);await rename(f.cwd,f.cwd+'-retired');await mkdir(f.cwd,{mode:0o775});
 assert.equal(p.sharedThread.verifyHistorySync(fresh),false);await rm(f.cwd,{recursive:true});await rename(f.cwd+'-retired',f.cwd);
 assert.equal(p.sharedThread.verifyReadSync({}),true);assert.equal(p.sharedThread.verifyHistorySync(fresh),false);assert.equal(p.sharedThread.verifyBindingSync(fresh),false);
});
test('legacy external execution equivalence loss still revokes both read and write scopes',async t=>{
 const f=await setup(t),p=await startOwnedSharedThreadAuthority(f.options);t.after(()=>p.close());const old=await p.sharedThread.resolveBinding({viewId:f.viewId,hostId:'kanban-shared-cli',threadId:randomUUID()});
 f.domain(false);assert.equal(p.sharedThread.verifyReadSync({}),false);assert.equal(p.sharedThread.verifyHistorySync(old),false);f.domain(true);
 assert.equal(p.sharedThread.verifyHistorySync(old),false);assert.equal(p.sharedThread.verifyBindingSync(old),false);
});
