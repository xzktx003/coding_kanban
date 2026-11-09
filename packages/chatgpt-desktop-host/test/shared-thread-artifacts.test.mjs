import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync,renameSync,symlinkSync,statSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createSharedDaemonRpcGate} from '../src/shared-daemon-rpc-gate.mjs';
import {createSharedThreadArtifactAuthority,deriveSharedThreadArtifactRoot,
  consumeSharedThreadArtifactReceipt,verifySharedThreadArtifactDirectorySync} from '../src/shared-thread-artifacts.mjs';

const threadId='0193f2fe-241f-7b32-9abc-0123456789ab';
function fixture(t) {
  const root=mkdtempSync(join(tmpdir(),'shared-artifact-')),codexHome=join(root,'home'),cwd=join(root,'project');
  mkdirSync(codexHome,{mode:0o700});mkdirSync(cwd,{mode:0o775});
  const binding=Object.freeze({hostId:'kanban-shared-cli',runtimeGeneration:randomUUID(),daemonGeneration:randomUUID(),accountRevision:1,
    projectId:'owned-project',threadId,viewId:randomUUID(),clientId:randomUUID()});
  const directory=deriveSharedThreadArtifactRoot(codexHome,threadId),writes=[],received=[],policyErrors=[],state={live:true,bound:true};
  const authority=createSharedThreadArtifactAuthority({codexHome,projects:[{projectId:binding.projectId,cwd}],
    verifyCurrentSync:()=>state.live,verifyReadSync:()=>state.live,
    verifyBindingSync:value=>state.bound&&value.clientId===binding.clientId,verifyHistorySync:()=>state.bound,
    authorizeDirectorySync:(value,path)=>state.bound&&value.threadId===binding.threadId&&path===directory,
    onReceipt:(value,receipt)=>{received.push({binding:value,receipt});return true;}});
  authority.registerBinding(binding);
  let initReceipt;
  const gate=createSharedDaemonRpcGate({verifyReadSync:()=>state.live,verifyBindingSync:()=>state.bound,
    verifyHistorySync:()=>state.bound,write:frame=>writes.push(frame),artifacts:authority,
    desktop:{daemonVersion:'0.166.0',verifyInitializeSync:()=>state.live,registerInitializeConsumptionSync:value=>{initReceipt=value;},
      deliverUnsupportedReadSync:reply=>policyErrors.push(reply),deliverUnsupportedCapabilitySync:reply=>policyErrors.push(reply)}});
  gate.write(JSON.stringify({id:'init',method:'initialize',params:{clientInfo:{name:'owned-artifact-fixture',version:'1'}}}));
  gate.receive(JSON.stringify({id:'init',result:{userAgent:'codex-cli/0.166.0'}}));assert.equal(initReceipt.consumeSync(),true);
  t.after(()=>{gate.close();authority.close();rmSync(root,{recursive:true,force:true});});
  return {root,codexHome,cwd,binding,directory,authority,gate,writes,received,policyErrors,state};
}

test('owned gate dispatches the exact native project metadata and mkdir; only the real reply mints an artifact receipt',t=>{
  const f=fixture(t),meta={id:'metadata',method:'fs/getMetadata',params:{path:f.cwd}};
  f.gate.write(JSON.stringify(meta));assert.equal(f.writes.at(-1),JSON.stringify(meta));
  const stat=statSync(f.cwd),metadata={id:meta.id,result:{isDirectory:true,isFile:false,isSymlink:false,createdAtMs:Math.trunc(stat.birthtimeMs),modifiedAtMs:Math.trunc(stat.mtimeMs)}};
  assert.equal(f.gate.receive(JSON.stringify(metadata)),JSON.stringify(metadata));
  const request={id:'mkdir-one',method:'fs/createDirectory',params:{path:f.directory,recursive:true}};
  f.gate.write(JSON.stringify(request));assert.equal(f.writes.at(-1),JSON.stringify(request));
  assert.equal(existsSync(f.directory),false);assert.equal(f.received.length,0);
  // This isolated protocol peer executes the requested filesystem action. It
  // is not native CLI/model acceptance and never reports an invented success.
  mkdirSync(f.directory,{recursive:true});const reply={id:request.id,result:{}};
  assert.equal(f.gate.receive(JSON.stringify(reply)),JSON.stringify(reply));assert.equal(f.received.length,1);
  const {receipt}=f.received[0];
  assert.equal(verifySharedThreadArtifactDirectorySync(receipt,f.binding),true);
  assert.throws(()=>consumeSharedThreadArtifactReceipt({},f.binding,{operation:'directory'}),{code:'SHARED_THREAD_ARTIFACT_DENIED'});
  assert.throws(()=>consumeSharedThreadArtifactReceipt(receipt,{...f.binding,viewId:randomUUID()},{operation:'directory'}),{code:'SHARED_THREAD_ARTIFACT_DENIED'});
  const evidence=consumeSharedThreadArtifactReceipt(receipt,f.binding,{operation:'directory'});
  assert.deepEqual(evidence.request,request);assert.deepEqual(evidence.response,reply);assert.equal(evidence.directoryPath,f.directory);
  assert.equal(Object.isFrozen(evidence.binding),true);
  assert.throws(()=>consumeSharedThreadArtifactReceipt(receipt,f.binding,{operation:'directory'}),{code:'SHARED_THREAD_ARTIFACT_DENIED'});
  assert.throws(()=>f.gate.write(JSON.stringify(request)),{code:'SHARED_DAEMON_DENIED'});
});

test('same-thread continuation reuses the native directory capability; replaced directory or binding revokes it',t=>{
  const f=fixture(t);
  for(const [id,recursive] of [['first',true],['continuation',null]]) {
    const request={id,method:'fs/createDirectory',params:{path:f.directory,recursive}};
    f.gate.write(JSON.stringify(request));mkdirSync(f.directory,{recursive:true});
    assert.equal(f.gate.receive(JSON.stringify({id,result:{}})),JSON.stringify({id,result:{}}));
  }
  assert.equal(f.received.length,2);assert.equal(f.writes.length,3);
  const original=f.received[0].receipt;renameSync(f.directory,f.directory+'-old');mkdirSync(f.directory);
  assert.equal(verifySharedThreadArtifactDirectorySync(original,f.binding),false);
  assert.throws(()=>f.gate.write(JSON.stringify({id:'after-replacement',method:'fs/createDirectory',params:{path:f.directory}})),{code:'SHARED_DAEMON_DENIED'});
  assert.equal(f.writes.length,3);
});

test('an actual native filesystem failure stays an error and cannot authorize turn roots',t=>{
  const f=fixture(t),request={id:'native-permission-error',method:'fs/createDirectory',params:{path:f.directory,recursive:true}};
  f.gate.write(JSON.stringify(request));const reply={id:request.id,error:{code:-32603,message:'Permission denied (os error 13)'}};
  assert.equal(f.gate.receive(JSON.stringify(reply)),JSON.stringify(reply));assert.equal(f.received.length,0);
  assert.equal(existsSync(f.directory),false);
});

test('filesystem scope rejects sibling threads, general HOME, traversal, symlink parents and late account changes',t=>{
  const f=fixture(t),request=path=>({id:randomUUID(),method:'fs/createDirectory',params:{path,recursive:true}});
  for(const path of [f.codexHome,dirname(f.directory),f.directory+'-other',join(f.codexHome,'config.toml'),f.directory+'/child',f.cwd+'/../outside'])
    assert.throws(()=>f.gate.write(JSON.stringify(request(path))),{code:'SHARED_DAEMON_DENIED'});
  assert.equal(f.writes.length,1);
  const outside=join(f.root,'outside');mkdirSync(outside);symlinkSync(outside,join(f.codexHome,'visualizations'));
  assert.throws(()=>f.gate.write(JSON.stringify(request(f.directory))),{code:'SHARED_DAEMON_DENIED'});assert.equal(f.writes.length,1);
  rmSync(join(f.codexHome,'visualizations'));
  const pending=request(f.directory);f.gate.write(JSON.stringify(pending));mkdirSync(f.directory,{recursive:true});f.state.bound=false;
  assert.throws(()=>f.gate.receive(JSON.stringify({id:pending.id,result:{}})),{code:'SHARED_DAEMON_OUTCOME_UNKNOWN'});
  assert.equal(f.received.length,0);
});

test('artifact date and native trace follow the fixed original contracts',t=>{
  const f=fixture(t);
  assert.equal(f.directory,join(f.codexHome,'visualizations','2024','12','23',threadId));
  assert.equal(deriveSharedThreadArtifactRoot(f.codexHome,randomUUID()),null);
  const trace={traceparent:'00-1234567890abcdef1234567890abcdef-1234567890abcdef-01',tracestate:''};
  const request={id:'native-trace',method:'fs/createDirectory',params:{path:f.directory},trace};
  f.gate.write(JSON.stringify(request));assert.equal(f.writes.at(-1),JSON.stringify(request));
});

test('startup metadata outside the fixed native project scope keeps its explicit policy error and the read connection',t=>{
  const f=fixture(t),request={id:'startup-unowned-metadata',method:'fs/getMetadata',params:{path:join(f.codexHome,'unregistered-root')}};
  f.gate.write(JSON.stringify(request));
  assert.equal(f.writes.length,1);assert.equal(f.received.length,0);
  assert.equal(f.policyErrors.length,1);assert.equal(f.policyErrors[0].id,request.id);
  assert.equal(f.policyErrors[0].error.code,-32601);
  assert.equal(f.policyErrors[0].error.data.source,'kanban-shared-policy');
  assert.equal(Object.hasOwn(f.policyErrors[0],'result'),false);
  const next={id:'project-after-startup-policy-error',method:'fs/getMetadata',params:{path:f.cwd}};
  f.gate.write(JSON.stringify(next));assert.equal(f.writes.at(-1),JSON.stringify(next));
  const result={id:next.id,result:{createdAtMs:0,modifiedAtMs:0,isDirectory:true,isFile:false,isSymlink:false}};
  assert.equal(f.gate.receive(JSON.stringify(result)),JSON.stringify(result));
  assert.throws(()=>f.gate.write(JSON.stringify({id:'still-no-home-write',method:'fs/createDirectory',params:{path:f.codexHome,recursive:true}})),{code:'SHARED_DAEMON_DENIED'});
});
