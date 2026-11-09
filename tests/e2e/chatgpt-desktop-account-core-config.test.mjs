import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCoreConfig, validateCoreCpuPlacement, coreBrowserTrustEnvironment } from './chatgpt-desktop-account-core.mjs';

const sha='a'.repeat(64);
const connection={httpProxy:'http://proxy.invalid:8080',httpsProxy:'http://proxy.invalid:8080',noProxy:'localhost,127.0.0.1'};
const base={protocol:'https',tlsCertPath:'/x/cert',tlsCertSha256:sha,tlsKeyPath:'/x/key',tlsKeySha256:sha,tlsCaPath:'/x/ca',tlsCaSha256:sha,certutilPath:'/x/certutil',certutilSha256:sha,imageDigest:'sha256:'+sha,browserImageDigest:'sha256:'+sha,sourceRoot:'/x/source',macAsarPath:'/x/mac.asar',macAsarSha256:sha,privateRoot:'/x/private',evidenceRoot:'/x/evidence',cpuId:0,advertiseIPv4:'10.30.0.26',dockerPath:'/x/docker',dockerSha256:sha,pythonPath:'/x/python',pythonSha256:sha,nodePath:'/x/node',nodeSha256:sha,browserCacheRoot:'/x/browser',browserSha256:sha,accountSourceFile:'/x/auth/auth.json',accountHomeRoot:'/dev/shm/fresh'};

test('browser fixture Node trusts the same fixed CA as Chromium without disabling certificate checks',()=>{
 const env=coreBrowserTrustEnvironment();assert.deepEqual(env,['--env','NODE_EXTRA_CA_CERTS=/worker/ca.pem']);assert.equal(env.some(x=>/NODE_TLS_REJECT_UNAUTHORIZED|ignore-certificate/i.test(x)),false);
});

test('core fixture accepts only explicitly fixed and validated server connection options',()=>{
 const actual=validateCoreConfig({...base,connection});
 assert.deepEqual(actual.connection,connection);
 assert.notEqual(actual.connection,connection);
 assert.equal(actual.diagnostic,false);
 assert.equal(validateCoreConfig({...base,connection,diagnostic:true}).diagnostic,true);
 for(const bad of [undefined,{}, {...connection,command:'/bin/sh'}, {...connection,httpProxy:'http://user:pass@proxy.invalid:8080'}, {...connection,httpsProxy:'http://proxy.invalid:8080/path'}, {...connection,noProxy:'localhost;--ignore-certificate-errors'}]){
  assert.throws(()=>validateCoreConfig({...base,connection:bad}));
 }
 assert.throws(()=>validateCoreConfig({...base,connection,extra:true}));
 assert.throws(()=>validateCoreConfig({...base,connection,diagnostic:'true'}));
});

test('diagnostic browser CPU is explicit, distinct, and inside manager affinity',()=>{
 const actual=validateCoreConfig({...base,cpuId:1,browserCpuId:2,connection,diagnostic:true});
 assert.equal(actual.browserCpuId,2);
 assert.deepEqual(validateCoreCpuPlacement(actual,'1-2'),{nativeCpuId:1,browserCpuId:2,separate:true});
 for(const cpu of [-1,65536,1,'2',null])assert.throws(()=>validateCoreConfig({...base,cpuId:1,browserCpuId:cpu,connection,diagnostic:true}));
 assert.throws(()=>validateCoreCpuPlacement(actual,'1,3-5'));
 assert.throws(()=>validateCoreCpuPlacement(actual,'2'));
 assert.deepEqual(validateCoreCpuPlacement(validateCoreConfig({...base,connection}),'0'),{nativeCpuId:0,browserCpuId:0,separate:false});
});

test('a future frozen source manifest requires an explicit digest and count together',()=>{
 const x=validateCoreConfig({...base,connection,snapshotManifestSha256:sha,snapshotManifestFileCount:92});
 assert.equal(x.snapshotManifestSha256,sha);assert.equal(x.snapshotManifestFileCount,92);
 assert.throws(()=>validateCoreConfig({...base,connection,snapshotManifestSha256:sha}));
 assert.throws(()=>validateCoreConfig({...base,connection,snapshotManifestFileCount:92}));
 for(const n of [0,1001,'92'])assert.throws(()=>validateCoreConfig({...base,connection,snapshotManifestSha256:sha,snapshotManifestFileCount:n}));
});

test('review-gated readiness is explicit and cannot be combined with response-copy diagnostics',()=>{
 assert.equal(validateCoreConfig({...base,connection,readyGate:true}).readyGate,true);
 assert.equal(validateCoreConfig({...base,connection}).readyGate,false);
 assert.throws(()=>validateCoreConfig({...base,connection,readyGate:'true'}));
 assert.throws(()=>validateCoreConfig({...base,connection,readyGate:true,diagnostic:true}));
});

test('native stderr category probe requires explicit review-gated readiness',()=>{
 assert.equal(validateCoreConfig({...base,connection,readyGate:true,nativeStderrProbe:true}).nativeStderrProbe,true);
 assert.throws(()=>validateCoreConfig({...base,connection,nativeStderrProbe:true}));
 assert.throws(()=>validateCoreConfig({...base,connection,readyGate:true,nativeStderrProbe:'true'}));
});

test('private native stdio observer is explicit, review gated, and cannot be mixed with launcher diagnostics',()=>{
 assert.equal(validateCoreConfig({...base,connection,readyGate:true,nativeCliObserver:true}).nativeCliObserver,true);
 assert.equal(validateCoreConfig({...base,connection}).nativeCliObserver,false);
 for(const candidate of [
  {nativeCliObserver:true},
  {readyGate:true,nativeCliObserver:'true'},
  {readyGate:true,nativeCliObserver:true,nativeStderrProbe:true},
  {diagnostic:true,nativeCliObserver:true},
 ])assert.throws(()=>validateCoreConfig({...base,connection,...candidate}));
});
test('automatic owned fixture send requires the explicit native observer and the readiness gate',()=>{
 assert.equal(validateCoreConfig({...base,connection,readyGate:true,nativeCliObserver:true,autoSend:true}).autoSend,true);
 assert.equal(validateCoreConfig({...base,connection}).autoSend,false);
 for(const x of [{autoSend:true},{readyGate:true,autoSend:true},{readyGate:true,nativeCliObserver:true,autoSend:'true'}])assert.throws(()=>validateCoreConfig({...base,connection,...x}));
});
