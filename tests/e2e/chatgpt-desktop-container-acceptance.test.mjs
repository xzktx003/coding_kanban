import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, readFile, chmod, symlink, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir,networkInterfaces } from 'node:os';
import { generateTlsFixture } from './chatgpt-desktop-tls-fixture.mjs';
import { validateLanAddress, authorizeRequest, validateRunnerConfig, validateTlsMaterial, readPrivateTlsFile } from './chatgpt-desktop-container-acceptance.mjs';

const token='a'.repeat(64);
const network={eth0:[{address:'10.30.0.26',family:'IPv4',internal:false}],lo:[{address:'127.0.0.1',family:'IPv4',internal:true}]};

test('acceptance binds only a real, non-loopback local IPv4',()=>{
 assert.equal(validateLanAddress('10.30.0.26',network),'10.30.0.26');
 for(const address of ['127.0.0.1','0.0.0.0','10.30.0.25','::1','169.254.1.1','239.1.1.1','255.255.255.255'])assert.throws(()=>validateLanAddress(address,network));
});

test('one-use acceptance cookie and strict origin gate both HTTP and WS',()=>{
 const options={token,authority:'10.30.0.26:5678',origin:'https://10.30.0.26:5678'};
 const headers={host:options.authority,cookie:`desktop_acceptance=${token}`};
 assert.equal(authorizeRequest(headers,options),200);
 assert.equal(authorizeRequest({...headers,origin:options.origin},options),200);
 assert.equal(authorizeRequest({...headers,upgrade:'websocket',origin:options.origin},options),200);
 assert.equal(authorizeRequest({host:options.authority},options),401);
 assert.equal(authorizeRequest({...headers,cookie:`desktop_acceptance=${'b'.repeat(64)}`},options),401);
 assert.equal(authorizeRequest({...headers,cookie:`${headers.cookie}; ${headers.cookie}`},options),401);
 assert.equal(authorizeRequest({...headers,origin:'https://evil.invalid'},options),403);
 assert.equal(authorizeRequest({...headers,upgrade:'websocket'},options),403);
 assert.equal(authorizeRequest({...headers,host:'127.0.0.1:5678'},options),403);
});

test('configuration requires exact pinned fields and rejects unknown flags',()=>{
 const sha='a'.repeat(64);
 const value={protocol:'https',tlsCertPath:'/x/cert',tlsCertSha256:sha,tlsKeyPath:'/x/key',tlsKeySha256:sha,tlsCaPath:'/x/ca',tlsCaSha256:sha,certutilPath:'/x/certutil',certutilSha256:sha,imageDigest:'sha256:'+sha,browserImageDigest:'sha256:'+sha,sourceRoot:'/x/source',macAsarPath:'/x/mac.asar',macAsarSha256:sha,privateRoot:'/x/private',evidenceRoot:'/x/evidence',cpuId:0,advertiseIPv4:'10.30.0.26',dockerPath:'/x/docker',dockerSha256:sha,pythonPath:'/x/python',pythonSha256:sha,nodePath:'/x/node',nodeSha256:sha,browserCacheRoot:'/x/browser',browserSha256:sha};
 assert.deepEqual(validateRunnerConfig(value),value);
 assert.throws(()=>validateRunnerConfig({...value,protocol:'http'}));
 assert.throws(()=>validateRunnerConfig({...value,tlsCaPath:undefined}));
 assert.throws(()=>validateRunnerConfig({...value,enableLogin:true}));
 assert.throws(()=>validateRunnerConfig({...value,browserImageDigest:'latest'}));
 assert.throws(()=>validateRunnerConfig({...value,privateRoot:'relative'}));
 assert.throws(()=>validateRunnerConfig({...value,cpuId:-1}));
});


test('TLS requires private files, a matching key, trusted CA and exact LAN IP SAN',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'chatgpt-tls-test-'));
 try{
  const run=args=>execFileSync('/usr/bin/openssl',args,{stdio:'ignore',timeout:15000});
  const p=name=>join(dir,name);
  run(['req','-x509','-newkey','ec','-pkeyopt','ec_paramgen_curve:prime256v1','-nodes','-keyout',p('ca.key'),'-out',p('ca.pem'),'-days','1','-subj','/CN=E2E CA','-addext','basicConstraints=critical,CA:TRUE','-addext','keyUsage=critical,keyCertSign,cRLSign']);
  run(['req','-new','-newkey','ec','-pkeyopt','ec_paramgen_curve:prime256v1','-nodes','-keyout',p('server.key'),'-out',p('server.csr'),'-subj','/CN=E2E']);
  await writeFile(p('ext.cnf'),'[v3]\nsubjectAltName=IP:10.30.0.26\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=serverAuth\n');
  run(['x509','-req','-in',p('server.csr'),'-CA',p('ca.pem'),'-CAkey',p('ca.key'),'-CAcreateserial','-out',p('server.pem'),'-days','1','-extfile',p('ext.cnf'),'-extensions','v3']);
  for(const name of ['ca.pem','server.pem','server.key'])await chmod(p(name),0o600);
  const [ca,cert,key]=await Promise.all(['ca.pem','server.pem','server.key'].map(x=>readFile(p(x))));
  assert.doesNotThrow(()=>validateTlsMaterial({ca,cert,key,ip:'10.30.0.26'}));
  assert.throws(()=>validateTlsMaterial({ca,cert,key,ip:'10.30.0.27'}));
  const wrongKey=await readFile(p('ca.key'));assert.throws(()=>validateTlsMaterial({ca,cert,key:wrongKey,ip:'10.30.0.26'}));
  const sha=createHash('sha256').update(key).digest('hex');
  assert.deepEqual(await readPrivateTlsFile(p('server.key'),sha),key);
  await assert.rejects(readPrivateTlsFile(p('server.key'),'0'.repeat(64)));
  await chmod(p('server.key'),0o644);await assert.rejects(readPrivateTlsFile(p('server.key'),sha));
  await chmod(p('server.key'),0o600);await symlink(p('server.key'),p('link.key'));await assert.rejects(readPrivateTlsFile(p('link.key'),sha));
 }finally{await rm(dir,{recursive:true,force:true})}
});


test('fixture creates one owned CA and IP-SAN pair without retaining its CA key',async t=>{
 const ip=Object.values(networkInterfaces()).flat().find(x=>x?.family==='IPv4'&&!x.internal&&!x.address.startsWith('169.254.')&&Number(x.address.split('.')[0])<224)?.address;
 if(!ip){t.skip('no local non-loopback IPv4');return}
 const evidenceRoot=await mkdtemp(join(tmpdir(),'chatgpt-tls-generator-'));
 try{
  const opensslPath='/usr/bin/openssl';let binary;try{binary=await readFile(opensslPath)}catch{t.skip('openssl unavailable');return}
  const fixture=await generateTlsFixture({evidenceRoot,ip,opensslPath,opensslSha256:createHash('sha256').update(binary).digest('hex')});
  const [ca,cert,key]=await Promise.all([[fixture.tlsCaPath,fixture.tlsCaSha256],[fixture.tlsCertPath,fixture.tlsCertSha256],[fixture.tlsKeyPath,fixture.tlsKeySha256]].map(([path,sha])=>readPrivateTlsFile(path,sha)));
  assert.equal(validateTlsMaterial({ca,cert,key,ip}),true);
  assert.deepEqual((await (await import('node:fs/promises')).readdir(join(evidenceRoot,'tls'))).sort(),['ca.pem','server.key','server.pem']);
  await assert.rejects(generateTlsFixture({evidenceRoot,ip,opensslPath,opensslSha256:createHash('sha256').update(binary).digest('hex')}));
 }finally{await rm(evidenceRoot,{recursive:true,force:true})}
});
