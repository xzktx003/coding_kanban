import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAccountConfig, classifyWorkState, authorizeAccountCleanup } from './chatgpt-desktop-account-safety.mjs';

const sha='a'.repeat(64);
const base={protocol:'https',tlsCertPath:'/x/cert',tlsCertSha256:sha,tlsKeyPath:'/x/key',tlsKeySha256:sha,tlsCaPath:'/x/ca',tlsCaSha256:sha,certutilPath:'/x/certutil',certutilSha256:sha,imageDigest:'sha256:'+sha,browserImageDigest:'sha256:'+sha,sourceRoot:'/x/source',macAsarPath:'/x/mac.asar',macAsarSha256:sha,privateRoot:'/x/private',evidenceRoot:'/x/evidence',cpuId:0,advertiseIPv4:'10.30.0.26',dockerPath:'/x/docker',dockerSha256:sha,pythonPath:'/x/python',pythonSha256:sha,nodePath:'/x/node',nodeSha256:sha,browserCacheRoot:'/x/browser',browserSha256:sha,accountSourceFile:'/x/auth/auth.json',accountHomeRoot:'/dev/shm/fresh'};

test('account acceptance only accepts fixed HTTPS config with explicit private account paths',()=>{
 assert.deepEqual(validateAccountConfig(base),base);
 for(const bad of [{...base,protocol:'http'},{...base,accountSourceFile:'relative'},{...base,accountHomeRoot:'/'},{...base,accountHomeRoot:undefined},{...base,accountSourceFile:'/x/private/auth.json'},{...base,accountHomeRoot:'/x/evidence/home'},{...base,allowTask:true}])assert.throws(()=>validateAccountConfig(bad));
});

test('Work verifier rejects missing, enabled or uncertain state',()=>{
 assert.equal(classifyWorkState({enabled:false,ready:false,environmentId:null}),'disabled');
 for(const bad of [null,{}, {enabled:true,ready:false,environmentId:null},{enabled:false,ready:true,environmentId:null},{enabled:false,ready:false},{enabled:false,ready:false,environmentId:'x'}])assert.notEqual(classifyWorkState(bad),'disabled');
});

test('unknown tasks and incomplete monitoring always retain native fixture',()=>{
 const known={work:'disabled',execServerPeak:0,processSamplingErrors:0,processSamples:3,workload:'no-tasks-proven',viewClosed:true,sourceUnchanged:true};
 assert.equal(authorizeAccountCleanup(known),true);
 for(const patch of [{work:'unknown'},{execServerPeak:1},{processSamplingErrors:1},{processSamples:0},{workload:'unknown'},{viewClosed:false},{sourceUnchanged:false},{}]){
  const item=Object.keys(patch).length?{...known,...patch}:{...known,workload:undefined};
  assert.equal(authorizeAccountCleanup(item),false);
 }
});

test('source observer keeps credential bytes and hashes in memory and detects content or identity changes',async()=>{
 const {mkdtemp,writeFile,rename,rm,chmod}=await import('node:fs/promises');
 const {join}=await import('node:path');const {tmpdir}=await import('node:os');
 const {openAccountSourceObserver}=await import('./chatgpt-desktop-account-safety.mjs');
 const dir=await mkdtemp(join(tmpdir(),'account-observer-'));
 try{
  const path=join(dir,'auth.json');await writeFile(path,'{"fixture":"local"}\n',{mode:0o600});
  let o=await openAccountSourceObserver(path);assert.equal((await o.verify()).same,true);assert.deepEqual(Object.keys((await o.inventory())[0]).sort(),['mode','name','size','type']);
  await writeFile(path,'{"fixture":"changed"}\n');assert.equal((await o.verify()).same,false);await o.close();
  o=await openAccountSourceObserver(path);await rename(path,join(dir,'old'));await writeFile(path,'{"fixture":"changed"}\n',{mode:0o600});assert.equal((await o.verify()).same,false);await o.close();
  await chmod(path,0o644);await assert.rejects(openAccountSourceObserver(path));
 }finally{await rm(dir,{recursive:true,force:true})}
});

test('process metadata counts only actual codex exec-server executable invocations',async()=>{
 const {countExecServerProcesses}=await import('./chatgpt-desktop-account-safety.mjs');
 assert.equal(countExecServerProcesses(['COMMAND','/opt/codex app-server','/opt/codex exec-server --remote','/usr/bin/codex-exec-server --remote','node /work/script.js exec-server','/opt/codex exec --something']),2);
 assert.throws(()=>countExecServerProcesses(null));
});

test('Docker ps sampling requires PID header and validates each process row',async()=>{
 const {parseDockerProcessSnapshot}=await import('./chatgpt-desktop-account-safety.mjs');
 assert.deepEqual(parseDockerProcessSnapshot('PID COMMAND\n100 /opt/codex app-server\n101 /opt/codex exec-server --remote\n'),{processes:2,execServers:1});
 for(const bad of ['COMMAND\n/opt/codex exec-server\n','PID COMMAND\nbad-row\n','',null])assert.throws(()=>parseDockerProcessSnapshot(bad));
});
