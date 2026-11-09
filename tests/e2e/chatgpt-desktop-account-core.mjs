// Explicit, account-authorized acceptance: never connect default IPC/history or
// submit a login. One fixed model turn is allowed after the guarded setup.
// Requires owned 0600 HTTPS config with two extra fixed account paths.
// It is never part of pnpm dev or the default test suite.
import { timingSafeEqual, createHash, X509Certificate, createPrivateKey, createPublicKey } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { isIP } from 'node:net';
import { dirname, isAbsolute, resolve } from 'node:path';
import { validateAccountConfig, openAccountSourceObserver, authorizeAccountCleanup, parseDockerProcessSnapshot } from './chatgpt-desktop-account-safety.mjs';
import { readCoreFixtureState, parseFrozenSourceManifest, coreViewCloseEvidence, validateCoreSurfaceOptions, readCoreSurfaceManifest, createCoreSurfaceParent, verifyCoreSurfaceAsset } from './chatgpt-desktop-account-core-fixture.mjs';
import { adaptCoreNativeBootstrapDiagnostic, adaptCoreNativeViewDiagnostic, adaptCoreNativeStderrDiagnostic, adaptCoreNativeStderrServiceDiagnostic, createCoreDiagnosticJournal, wrapCoreUpstream } from './chatgpt-desktop-core-diagnostic.mjs';
import {adaptCoreNativeObserverBootstrap,CORE_NATIVE_OBSERVER_PINS} from './chatgpt-desktop-native-observer-bootstrap.mjs';
import {readNativeObserverDirectory,verifyNativeObserverProcesses} from './chatgpt-desktop-native-observer-evidence.mjs';
import { normalizeDesktopConnection } from '../../packages/chatgpt-desktop-host/src/connection-policy.mjs';

const SHA=/^[a-f0-9]{64}$/;
const IMAGE=/^sha256:[a-f0-9]{64}$/;
const configKeys=['protocol','tlsCertPath','tlsCertSha256','tlsKeyPath','tlsKeySha256','tlsCaPath','tlsCaSha256','certutilPath','certutilSha256','imageDigest','browserImageDigest','sourceRoot','macAsarPath','macAsarSha256','privateRoot','evidenceRoot','cpuId','advertiseIPv4','dockerPath','dockerSha256','pythonPath','pythonSha256','nodePath','nodeSha256','browserCacheRoot','browserSha256'];
const pathKeys=['tlsCertPath','tlsKeyPath','tlsCaPath','certutilPath','sourceRoot','macAsarPath','privateRoot','evidenceRoot','dockerPath','pythonPath','nodePath','browserCacheRoot'];
const fail=code=>Object.assign(new Error(code),{code});
const pathOK=x=>typeof x==='string'&&x.length>1&&x.length<=4096&&isAbsolute(x)&&resolve(x)===x&&!/[\x00-\x1f\x7f]/.test(x);
export function coreBrowserTrustEnvironment(){return ['--env','NODE_EXTRA_CA_CERTS=/worker/ca.pem']}

export function validateRunnerConfig(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join('\0')!==[...configKeys].sort().join('\0'))throw fail('ACCEPTANCE_CONFIG_INVALID');
 if(value.protocol!=='https'||!IMAGE.test(value.imageDigest)||!IMAGE.test(value.browserImageDigest)||!['tlsCertSha256','tlsKeySha256','tlsCaSha256','certutilSha256','macAsarSha256','dockerSha256','pythonSha256','nodeSha256','browserSha256'].every(k=>SHA.test(value[k]))||!pathKeys.every(k=>pathOK(value[k]))||!Number.isSafeInteger(value.cpuId)||value.cpuId<0||isIP(value.advertiseIPv4)!==4)throw fail('ACCEPTANCE_CONFIG_INVALID');
 return value;
}
export function validateCoreConfig(value){
 if(!value||typeof value!=='object'||Array.isArray(value))throw fail('ACCEPTANCE_CONFIG_INVALID');
 const {connection,diagnostic=false,readyGate=false,nativeStderrProbe=false,nativeCliObserver=false,autoSend=false,browserCpuId,snapshotManifestSha256,snapshotManifestFileCount,...account}=value;
 if(typeof diagnostic!=='boolean'||typeof readyGate!=='boolean'||typeof nativeStderrProbe!=='boolean'||typeof nativeCliObserver!=='boolean'||typeof autoSend!=='boolean'||(diagnostic&&readyGate)||(nativeStderrProbe&&!readyGate)||(nativeCliObserver&&(!readyGate||nativeStderrProbe))||(autoSend&&(!readyGate||!nativeCliObserver)))throw fail('ACCEPTANCE_CONFIG_INVALID');
 const fixed=normalizeDesktopConnection(connection);
 if(fixed===undefined)throw fail('ACCEPTANCE_CONFIG_INVALID');
 const validated=validateAccountConfig(account);
 if(browserCpuId!==undefined&&(!Number.isSafeInteger(browserCpuId)||browserCpuId<0||browserCpuId>65535||browserCpuId===validated.cpuId))throw fail('ACCEPTANCE_CONFIG_INVALID');
 const supplied=snapshotManifestSha256!==undefined||snapshotManifestFileCount!==undefined;
 if(supplied&&(!SHA.test(snapshotManifestSha256??'')||!Number.isSafeInteger(snapshotManifestFileCount)||snapshotManifestFileCount<1||snapshotManifestFileCount>1000))throw fail('ACCEPTANCE_CONFIG_INVALID');
 return {...validated,connection:fixed,diagnostic,readyGate,nativeStderrProbe,nativeCliObserver,autoSend,browserCpuId:browserCpuId??validated.cpuId,snapshotManifestSha256:supplied?snapshotManifestSha256:'5b2a5505f654b994039957071c70ed3ad52090dd0140b01bba5757ebe9eb8a86',snapshotManifestFileCount:supplied?snapshotManifestFileCount:81};
}
/** The fixture manager must itself be permitted to use both explicitly chosen CPUs. */
export function validateCoreCpuPlacement(config,allowed){
 if(typeof allowed!=='string'||!/^\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*$/.test(allowed))throw fail('ACCEPTANCE_CPU_INVALID');
 const ranges=allowed.split(',').map(part=>part.split('-').map(Number));
 if(ranges.some(x=>x.some(n=>!Number.isSafeInteger(n)||n>65535)||(x.length===2&&x[0]>x[1])))throw fail('ACCEPTANCE_CPU_INVALID');
 const includes=n=>ranges.some(([a,b=a])=>n>=a&&n<=b);
 if(!Number.isSafeInteger(config?.cpuId)||!Number.isSafeInteger(config?.browserCpuId)||!includes(config.cpuId)||!includes(config.browserCpuId))throw fail('ACCEPTANCE_CPU_INVALID');
 return {nativeCpuId:config.cpuId,browserCpuId:config.browserCpuId,separate:config.cpuId!==config.browserCpuId};
}
/** Check the private file identity before and after reading, without following links. */
export async function readPrivateTlsFile(path,expectedSha){
 const uid=process.getuid?.();if(uid===undefined||!pathOK(path)||!SHA.test(expectedSha??'')||await realpath(path)!==path)throw fail('ACCEPTANCE_TLS_UNSAFE');
 const parent=dirname(path);if(await realpath(parent)!==parent)throw fail('ACCEPTANCE_TLS_UNSAFE');const ps=await lstat(parent,{bigint:true});if(!ps.isDirectory()||ps.uid!==BigInt(uid)||(ps.mode&0o7777n)!==0o700n)throw fail('ACCEPTANCE_TLS_UNSAFE');
 const fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);const equal=(a,b)=>['dev','ino','uid','gid','mode','size','mtimeNs','ctimeNs'].every(k=>a[k]===b[k]);
 try{const before=await fd.stat({bigint:true});if(!before.isFile()||before.uid!==BigInt(uid)||(before.mode&0o7777n)!==0o600n||before.size<1n||before.size>65536n)throw fail('ACCEPTANCE_TLS_UNSAFE');const bytes=await fd.readFile();if(createHash('sha256').update(bytes).digest('hex')!==expectedSha||!equal(before,await fd.stat({bigint:true}))||!equal(before,await lstat(path,{bigint:true})))throw fail('ACCEPTANCE_TLS_UNSAFE');return bytes;}finally{await fd.close()}
}
/** Require exactly the supplied CA, matching private key and IP SAN. */
export function validateTlsMaterial({ca,cert,key,ip}={}){
 try{if(isIP(ip)!==4||![ca,cert,key].every(Buffer.isBuffer))throw Error();for(const pem of [ca,cert])if((pem.toString('utf8').match(/-----BEGIN CERTIFICATE-----/g)??[]).length!==1)throw Error();
  const authority=new X509Certificate(ca),server=new X509Certificate(cert),now=Date.now();
  if(!authority.ca||server.ca||!authority.checkIssued(authority)||!authority.verify(authority.publicKey)||!server.checkIssued(authority)||!server.verify(authority.publicKey)||!server.checkIP(ip)||!server.keyUsage?.includes('1.3.6.1.5.5.7.3.1'))throw Error();
  for(const cert of [authority,server])if(!(Date.parse(cert.validFrom)<=now&&now<Date.parse(cert.validTo)))throw Error();
  const a=server.publicKey.export({type:'spki',format:'der'}),b=createPublicKey(createPrivateKey(key)).export({type:'spki',format:'der'});if(!a.equals(b))throw Error();return true;
 }catch{throw fail('ACCEPTANCE_TLS_INVALID')}
}
export function validateLanAddress(address,interfaces){
 const first=Number(String(address).split('.')[0]);
 if(isIP(address)!==4||first===0||first>=224||address.startsWith('127.')||address.startsWith('169.254.'))throw fail('ACCEPTANCE_LAN_INVALID');
 if(!Object.values(interfaces??{}).flat().some(x=>x&&x.family==='IPv4'&&!x.internal&&x.address===address))throw fail('ACCEPTANCE_LAN_INVALID');
 return address;
}
export function authorizeRequest(headers,{token,authority,origin}){
 if(typeof token!=='string'||!SHA.test(token)||typeof authority!=='string'||typeof origin!=='string')return 403;
 if(headers.host!==authority)return 403;
 const upgrade=typeof headers.upgrade==='string'&&headers.upgrade.toLowerCase()==='websocket';
 if((upgrade&&headers.origin!==origin)||(!upgrade&&headers.origin!==undefined&&headers.origin!==origin))return 403;
 if(typeof headers.cookie!=='string')return 401;
 const entries=headers.cookie.split(';').map(x=>x.trim()).filter(x=>x.startsWith('desktop_acceptance='));
 if(entries.length!==1)return 401;
 const candidate=entries[0].slice('desktop_acceptance='.length);
 if(!SHA.test(candidate)||!timingSafeEqual(Buffer.from(candidate,'hex'),Buffer.from(token,'hex')))return 401;
 return 200;
}

async function runAcceptance(configFile){
 const [{constants,createReadStream},{lstat,stat,open,readFile,readdir,realpath,mkdir,writeFile,unlink},{createHash,randomBytes},{execFile},{promisify},{fileURLToPath},{dirname,join,relative},{networkInterfaces},{setTimeout:delay}]=await Promise.all([
  import('node:fs'),import('node:fs/promises'),import('node:crypto'),import('node:child_process'),import('node:util'),import('node:url'),import('node:path'),import('node:os'),import('node:timers/promises')]);
 const deadline=(promise,ms,code)=>{let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(fail(code)),ms)})]).finally(()=>clearTimeout(timer))};
 const exec=promisify(execFile), root=resolve(dirname(fileURLToPath(import.meta.url)),'../..'), uid=process.getuid?.(),gid=process.getgid?.();
 if(uid===undefined||gid===undefined||uid===0)throw fail('ACCEPTANCE_IDENTITY_INVALID');
 const same=(a,b)=>['dev','ino','uid','gid','mode','size','mtimeNs','ctimeNs'].every(k=>a[k]===b[k]);
 async function privateDirectory(path,empty=false){
  if(!pathOK(path)||await realpath(path)!==path)throw fail('ACCEPTANCE_PRIVATE_PATH_INVALID');
  const s=await lstat(path,{bigint:true});
  if(!s.isDirectory()||s.uid!==BigInt(uid)||(s.mode&0o7777n)!==0o700n||(empty&&(await readdir(path)).length!==0))throw fail('ACCEPTANCE_PRIVATE_PATH_INVALID');
 }
 async function readPrivate(path,max=16384){
  if(!pathOK(path)||await realpath(path)!==path)throw fail('ACCEPTANCE_CONFIG_UNSAFE');
  await privateDirectory(dirname(path));
  const fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{const before=await fd.stat({bigint:true});if(!before.isFile()||before.uid!==BigInt(uid)||(before.mode&0o7777n)!==0o600n||before.size>BigInt(max))throw fail('ACCEPTANCE_CONFIG_UNSAFE');
   const bytes=await fd.readFile();if(!same(before,await fd.stat({bigint:true}))||!same(before,await lstat(path,{bigint:true})))throw fail('ACCEPTANCE_CONFIG_UNSAFE');return bytes;
  }finally{await fd.close();}
 }
 const configBytes=await readPrivate(configFile);const config=validateCoreConfig(JSON.parse(configBytes.toString('utf8')));
 validateLanAddress(config.advertiseIPv4,networkInterfaces());
 await Promise.all([privateDirectory(config.privateRoot,true),privateDirectory(config.evidenceRoot)]);
 const tlsDir=join(config.evidenceRoot,'tls');await privateDirectory(tlsDir);
 if((await readdir(config.evidenceRoot)).sort().join('\0')!=='tls'||(await readdir(tlsDir)).sort().join('\0')!==['ca.pem','server.key','server.pem'].join('\0')||config.tlsCaPath!==join(tlsDir,'ca.pem')||config.tlsCertPath!==join(tlsDir,'server.pem')||config.tlsKeyPath!==join(tlsDir,'server.key'))throw fail('ACCEPTANCE_TLS_UNSAFE');
 const [tlsCa,tlsCert,tlsKey]=await Promise.all([[config.tlsCaPath,config.tlsCaSha256],[config.tlsCertPath,config.tlsCertSha256],[config.tlsKeyPath,config.tlsKeySha256]].map(([path,sha])=>readPrivateTlsFile(path,sha)));validateTlsMaterial({ca:tlsCa,cert:tlsCert,key:tlsKey,ip:config.advertiseIPv4});
 const inside=(p,c)=>{const part=relative(p,c);return part===''||(!part.startsWith('../')&&part!=='..'&&!isAbsolute(part))};
 for(const [a,b] of [[config.privateRoot,config.evidenceRoot],[config.privateRoot,config.sourceRoot],[config.privateRoot,config.macAsarPath],[config.privateRoot,root],[config.privateRoot,config.browserCacheRoot],[config.evidenceRoot,config.sourceRoot],[config.evidenceRoot,config.macAsarPath]])if(inside(a,b)||inside(b,a))throw fail('ACCEPTANCE_PATH_OVERLAP');
 for(const p of [config.sourceRoot,config.macAsarPath,config.browserCacheRoot,config.dockerPath,config.pythonPath,config.nodePath,config.certutilPath])if(await realpath(p)!==p)throw fail('ACCEPTANCE_SOURCE_UNSAFE');
 async function digest(path){const h=createHash('sha256');for await(const b of createReadStream(path,{flags:constants.O_RDONLY|constants.O_NOFOLLOW}))h.update(b);return h.digest('hex')}
 async function verifiedFile(path,want){const before=await lstat(path,{bigint:true});if(!before.isFile()||![0n,BigInt(uid)].includes(before.uid)||(before.mode&0o022n)!==0n||await digest(path)!==want||!same(before,await lstat(path,{bigint:true})))throw fail('ACCEPTANCE_ARTIFACT_CHANGED')}
 const browserExe=join(config.browserCacheRoot,'chrome-headless-shell-linux64','chrome-headless-shell');
 const verifyFixedArtifacts=()=>Promise.all([verifiedFile(config.dockerPath,config.dockerSha256),verifiedFile(config.certutilPath,config.certutilSha256),verifiedFile(config.pythonPath,config.pythonSha256),verifiedFile(config.nodePath,config.nodeSha256),verifiedFile(browserExe,config.browserSha256),verifiedFile(config.macAsarPath,config.macAsarSha256),verifiedFile(join(config.sourceRoot,'ChatGPT'),'45751964e5d517169752c50748fca162c4eb156e2e362749e57447bf1489859b'),verifiedFile(join(config.sourceRoot,'resources/app.asar'),'1588e6a0e1dcfc615060152ef264d4adf2c3ff6bb7496986c72163b5853e2a2e')]);
 await verifyFixedArtifacts();
 const status=await readFile('/proc/self/status','utf8'),allowed=/^Cpus_allowed_list:\s*([0-9,-]+)\s*$/m.exec(status)?.[1];
 const cpuPlacement=validateCoreCpuPlacement(config,allowed);
 const bridgeRoot=join(config.privateRoot,'bridge'),stateRoot=join(config.privateRoot,'state'),runtimeRoot=join(config.privateRoot,'runtime');
 await mkdir(bridgeRoot,{mode:0o700});await mkdir(stateRoot,{mode:0o700});
 const profileFile=join(stateRoot,'profile.json'),controlSocketPath=join(stateRoot,'control.sock');
 const dockerEnv={HOME:bridgeRoot,PATH:'/usr/bin:/bin',DOCKER_CONFIG:join(bridgeRoot,'docker-config')};
 async function docker(args,timeout=20000){const value=await exec(config.dockerPath,args,{cwd:config.privateRoot,env:dockerEnv,timeout,maxBuffer:1024*1024,shell:false});return value.stdout.trim();}
 for(const image of [config.imageDigest,config.browserImageDigest])if(await docker(['image','inspect','--format','{{.Id}}',image])!==image)throw fail('ACCEPTANCE_IMAGE_MISMATCH');
 const waveSha=config.snapshotManifestSha256;
 const waveManifest=parseFrozenSourceManifest(await readFile(join(root,'SHA256SUMS')),waveSha,config.snapshotManifestFileCount),waveExpected=new Map(waveManifest.map(x=>[x.path,x.sha256]));
 const diagnosticSources=new Map();
 if(config.diagnostic){for(const [name,adapt] of [['packages/chatgpt-desktop-host/src/native-bootstrap.cjs',adaptCoreNativeBootstrapDiagnostic],['packages/chatgpt-desktop-host/src/native-view-shim.js',adaptCoreNativeViewDiagnostic]]){const body=await readFile(join(root,'diagnostic-original',name)),pin=waveExpected.get(name);if(!pin)throw fail('ACCEPTANCE_SOURCE_CHANGED');const converted=adapt(body,pin);if(converted.originalSha256!==pin)throw fail('ACCEPTANCE_SOURCE_CHANGED');diagnosticSources.set(name,converted.adaptedSha256)}}
 if(config.nativeStderrProbe){const name='packages/chatgpt-desktop-host/src/container-native.mjs',pin=waveExpected.get(name),body=await readFile(join(root,'diagnostic-original',name));if(!pin)throw fail('ACCEPTANCE_SOURCE_CHANGED');const converted=adaptCoreNativeStderrDiagnostic(body,pin);diagnosticSources.set(name,converted.adaptedSha256);const service='packages/chatgpt-desktop-host/src/container-service.mjs',servicePin=waveExpected.get(service),serviceBody=await readFile(join(root,'diagnostic-original',service));if(!servicePin)throw fail('ACCEPTANCE_SOURCE_CHANGED');const serviceConverted=adaptCoreNativeStderrServiceDiagnostic(serviceBody,servicePin,pin,converted.adaptedSha256);diagnosticSources.set(service,serviceConverted.adaptedSha256)}
 if(config.nativeCliObserver){
  const files={};for(const [name,pin] of Object.entries(CORE_NATIVE_OBSERVER_PINS)){const path=join(root,'fixture-observer',name),body=await readFile(path);if(createHash('sha256').update(body).digest('hex')!==pin)throw fail('ACCEPTANCE_SOURCE_CHANGED');files[name]={body,sha256:pin}}
  const name='packages/chatgpt-desktop-host/src/container-native.mjs',pin=waveExpected.get(name),body=await readFile(join(root,'diagnostic-original',name)),cliRealPath=await realpath(join(config.sourceRoot,'resources/codex'));await verifiedFile(cliRealPath,'6253fb59fc4c21a9134b2f73237650eaec4a3d9380e5af12f3f1e9040dc24c14');
  const converted=adaptCoreNativeObserverBootstrap({body,files,cliRealPath});if(converted.originalSha256!==pin)throw fail('ACCEPTANCE_SOURCE_CHANGED');diagnosticSources.set(name,converted.adaptedSha256);
  const service='packages/chatgpt-desktop-host/src/container-service.mjs',servicePin=waveExpected.get(service),serviceBody=await readFile(join(root,'diagnostic-original',service));if(!servicePin)throw fail('ACCEPTANCE_SOURCE_CHANGED');diagnosticSources.set(service,adaptCoreNativeStderrServiceDiagnostic(serviceBody,servicePin,pin,converted.adaptedSha256).adaptedSha256);
 }
 const sources=[...new Set([...waveManifest.map(x=>x.path),'SHA256SUMS','package.json',
  'tests/e2e/chatgpt-desktop-container-acceptance.mjs','tests/e2e/chatgpt-desktop-account-core.mjs','tests/e2e/chatgpt-desktop-account-core-worker.mjs','tests/e2e/chatgpt-desktop-account-core-ledger.mjs','tests/e2e/chatgpt-desktop-account-core-fixture.mjs','tests/e2e/chatgpt-desktop-account-local-config-observer.mjs','tests/e2e/chatgpt-desktop-account-ready-gate.mjs','tests/e2e/chatgpt-desktop-native-observer-bootstrap.mjs','tests/e2e/chatgpt-desktop-native-observer-evidence.mjs','tests/e2e/chatgpt-desktop-core-diagnostic.mjs','tests/e2e/chatgpt-desktop-account-apphost-probe.mjs','tests/e2e/chatgpt-desktop-account-safety.mjs','tests/e2e/chatgpt-desktop-account-network.mjs','tests/e2e/chatgpt-desktop-account-wire.mjs','tests/e2e/chatgpt-desktop-account-ui-policy.mjs','tests/e2e/chatgpt-desktop-tls-fixture.mjs',...(config.nativeCliObserver?Object.keys(CORE_NATIVE_OBSERVER_PINS).map(n=>'fixture-observer/'+n):[]),'node_modules/playwright/package.json','node_modules/playwright/index.mjs','node_modules/.pnpm/playwright-core@1.58.2/node_modules/playwright-core/package.json'])];
 async function treeDigest(base){const h=createHash('sha256');let entries=0,total=0;async function visit(dir,rel=''){for(const entry of (await readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name,'en'))){if(++entries>10000)throw fail('ACCEPTANCE_SOURCE_UNAVAILABLE');const path=join(dir,entry.name),name=rel+entry.name,info=await lstat(path,{bigint:true});if(info.isSymbolicLink())throw fail('ACCEPTANCE_SOURCE_UNAVAILABLE');if(info.isDirectory())await visit(path,name+'/');else if(info.isFile()){total+=Number(info.size);if(total>1024*1024*1024)throw fail('ACCEPTANCE_SOURCE_UNAVAILABLE');const hash=await digest(path);if(!same(info,await lstat(path,{bigint:true})))throw fail('ACCEPTANCE_SOURCE_CHANGED');h.update(name+'\0'+hash+'\n')}else throw fail('ACCEPTANCE_SOURCE_UNAVAILABLE')}}await visit(base);return h.digest('hex')}
 async function sourceHashes(){const x={};for(const name of sources){x[name]=await digest(join(root,name));if(waveExpected.has(name)&&x[name]!==(diagnosticSources.get(name)??waveExpected.get(name)))throw fail('ACCEPTANCE_SOURCE_CHANGED');if(name.startsWith('fixture-observer/')&&x[name]!==CORE_NATIVE_OBSERVER_PINS[name.slice('fixture-observer/'.length)])throw fail('ACCEPTANCE_SOURCE_CHANGED')}for(const name of diagnosticSources.keys()){x['diagnostic-original/'+name]=await digest(join(root,'diagnostic-original',name));if(x['diagnostic-original/'+name]!==waveExpected.get(name))throw fail('ACCEPTANCE_SOURCE_CHANGED')}if(x.SHA256SUMS!==waveSha)throw fail('ACCEPTANCE_SOURCE_CHANGED');x['@playwright-tree']=await treeDigest(join(root,'node_modules/.pnpm/playwright@1.58.2/node_modules/playwright'));x['@playwright-core-tree']=await treeDigest(join(root,'node_modules/.pnpm/playwright-core@1.58.2/node_modules/playwright-core'));x['@browser-cache-tree']=await treeDigest(config.browserCacheRoot);return x;}
 let hashesBefore;try{hashesBefore=await sourceHashes()}catch{throw fail('ACCEPTANCE_SOURCE_UNAVAILABLE')}
 const evidence={version:1,artifacts:{configSha256:createHash('sha256').update(configBytes).digest('hex'),nativeImage:config.imageDigest,browserImage:config.browserImageDigest,macAsarSha256:config.macAsarSha256,linuxBinarySha256:'45751964e5d517169752c50748fca162c4eb156e2e362749e57447bf1489859b',linuxAsarSha256:'1588e6a0e1dcfc615060152ef264d4adf2c3ff6bb7496986c72163b5853e2a2e',nodeSha256:config.nodeSha256,browserBinarySha256:config.browserSha256,certutilSha256:config.certutilSha256,tlsCaSha256:config.tlsCaSha256,tlsCertSha256:config.tlsCertSha256},scope:{network:'native container bridge; browser bridge with exact pinned-CSP first-party origin routing (not OS firewall)',account:true,accountCopy:'id/access only; refresh empty; isolated tmpfs HOME',history:false,defaultIpc:false,modelTurnLimit:config.diagnostic||config.readyGate?0:1,fullWorkbench:false,diagnosticResponseCopies:config.diagnostic||config.readyGate,rendererObservation:config.readyGate?'four fixture-only response copies for synchronous scoped config and afterCreated observation':'none',nativeObservation:config.nativeCliObserver?'single-child stdio diagnostic; view and other native streams not attested':'none',verifier:config.diagnostic?'observe only; no project creation or model turn':'fixed project setup plus original UI; observed native metadata'},
  sourceHashesBefore:hashesBefore,sourceHashesAfter:null,sourceUnchanged:false,worker:null,profile:null,cleanup:{},cpuPlacement,reviewGate:config.readyGate?'explicit same-view grant required before one send':'not enabled',nativeStderrProbeMode:config.nativeStderrProbe?'fixture-only launcher response copy; official binary and ASAR unchanged':'disabled',result:'starting'};
 const evidencePath=join(config.evidenceRoot,'acceptance.json');
 const save=async()=>{await writeFile(evidencePath,JSON.stringify(evidence,null,2)+'\n',{mode:0o600})};
 await save();
 let service,ownedUpstream,app,browserId,workerConfigPath,controlRoot,readyNonce,sourceObserver,projectPath,projectIdentity,homeIdentity,processTimer,processInFlight,token=randomBytes(32).toString('hex'),failureCode,createdService=false,stage='imports';
 const launchJournal=createCoreDiagnosticJournal(),recordLaunchError=(location,error)=>{if(config.diagnostic||config.readyGate){launchJournal.record('launch',{name:error?.name,message:location+': '+String(error?.message??error),stack:error?.stack,code:error?.code});if(error instanceof SyntaxError)launchJournal.recordException('json',error)}};
 const monitorEpoch=Date.now();const workMonitor={coverage:'after container service returned; startup interval not observed',intervalMs:config.diagnostic||config.readyGate?5000:1000,samples:0,errors:0,firstMs:null,lastMs:null,execServerPeak:null};
 const ownedUpgrades=new Set();
 const keepAlive=setInterval(()=>{},1000);evidence.authCounts={httpDenied:0,websocketDenied:0};
 const browserLabel=randomBytes(16).toString('hex');
 try{
  const [{startContainerDesktopService},{startContainerDesktopUpstream},{openWebviewArchive},serverRoutes,bridgeRoutes,profileModule,surfaceConfig,{createRequire}]=await Promise.all([
   import('../../packages/chatgpt-desktop-host/src/container-host-service.mjs'),import('../../packages/chatgpt-desktop-host/src/container-service.mjs'),import('../../packages/chatgpt-desktop-host/src/assets.mjs'),import('../../apps/server/src/routes/chatgpt-desktop.ts'),import('../../apps/server/src/routes/chatgpt-desktop-bridge.ts'),import('../../apps/server/src/services/chatgpt-desktop-profile.ts'),import('../../apps/server/src/routes/chatgpt-desktop-surface-config.ts'),import('node:module')]);
  const surfaceOptions=validateCoreSurfaceOptions(surfaceConfig.createChatGptDesktopSurfaceOptions());
  const requireServer=createRequire(join(root,'apps/server/package.json')),Fastify=requireServer('fastify'),websocket=requireServer('@fastify/websocket');
  stage='source-observer';sourceObserver=await openAccountSourceObserver(config.accountSourceFile);evidence.accountSource={before:await sourceObserver.inventory(),after:null,same:null};
  stage='start-service';const serviceDependencies=config.diagnostic||config.nativeCliObserver?{startUpstream:async options=>{ownedUpstream=await startContainerDesktopUpstream(options);return config.diagnostic?wrapCoreUpstream(ownedUpstream,event=>launchJournal.record('upstream',event)):ownedUpstream}}:{};service=await startContainerDesktopService({imageDigest:config.imageDigest,sourceRoot:config.sourceRoot,runtimeRoot,bridgeRoot,cpuId:config.cpuId,macAsarPath:config.macAsarPath,macAsarSha256:config.macAsarSha256,profileFile,controlSocketPath,dockerPath:config.dockerPath,dockerSha256:config.dockerSha256,pythonPath:config.pythonPath,pythonSha256:config.pythonSha256,nodePath:config.nodePath,nodeSha256:config.nodeSha256,networkMode:'bridge',initialMode:'codex',accountSnapshot:{sourceFile:config.accountSourceFile,homeRoot:config.accountHomeRoot},connection:config.connection,startupTimeoutMs:90000},serviceDependencies);
  createdService=true;
  evidence.runtimePublication={profileFile,profileId:service.profileId,generation:service.generation,containerId:service.containerId,state:'published'};await save();
  stage='project-fixture';projectPath=join(config.accountHomeRoot,'fixture-project');await mkdir(projectPath,{mode:0o700});projectIdentity=await lstat(projectPath,{bigint:true});homeIdentity=await lstat(config.accountHomeRoot,{bigint:true});
  if(!projectIdentity.isDirectory()||projectIdentity.uid!==BigInt(uid)||(projectIdentity.mode&0o7777n)!==0o700n||await realpath(projectPath)!==projectPath||(await readdir(projectPath)).length!==0)throw fail('ACCEPTANCE_PROJECT_INVALID');
  evidence.projectFixture={owned:true,emptyBefore:true,sameIdentityAfter:null,entriesAfter:null};
  const nativeProjectPath=join(runtimeRoot,'home','fixture-project');
  async function sampleNative(){if(processInFlight)return processInFlight;processInFlight=(async()=>{try{const inspected=JSON.parse(await docker(['inspect','--format','{\"id\":{{json .Id}},\"image\":{{json .Image}},\"running\":{{json .State.Running}}}',service.containerId]));if(inspected.id!==service.containerId||inspected.image!==config.imageDigest||!inspected.running)throw Error();const raw=await docker(['top',service.containerId,'-eo','pid,args'],10000);const matches=parseDockerProcessSnapshot(raw).execServers;workMonitor.samples++;workMonitor.firstMs??=Date.now()-monitorEpoch;workMonitor.lastMs=Date.now()-monitorEpoch;workMonitor.execServerPeak=Math.max(workMonitor.execServerPeak??0,matches)}catch{workMonitor.errors++}})();try{await processInFlight}finally{processInFlight=null}}
  await sampleNative();processTimer=setInterval(()=>{void sampleNative()},workMonitor.intervalMs);processTimer.unref();
  stage='asset-expectations';const archive=await openWebviewArchive({asarPath:config.macAsarPath,sha256:config.macAsarSha256});let expected={};
  try{for(const member of ['webview/index.html',...surfaceOptions.assetAdapter.members,'webview/assets/app-primary-75d53eef2374.js']){const asset=await archive.acquireAsset(member);try{const original=createHash('sha256').update(asset.body).digest('hex'),adapted=member==='webview/index.html'?surfaceOptions.entryAdapter({body:asset.body,profileId:service.profileId,generation:service.generation}):surfaceOptions.assetAdapter.members.includes(member)?surfaceOptions.assetAdapter.adapt({member,body:asset.body}):{originalSha256:original,adaptedSha256:original};if(!adapted||adapted.originalSha256!==original)throw fail('ACCEPTANCE_ASSET_EXPECTATION_FAILED');if(member==='webview/index.html')readCoreSurfaceManifest(adapted.body,{profileId:service.profileId,generation:service.generation});expected[member]={original:adapted.originalSha256,adapted:adapted.adaptedSha256};}finally{asset.release()}}}finally{await archive.close()}
  stage='build-gateway';const profileService=profileModule.createChatGptDesktopProfileService({profileFile});
  app=Fastify({logger:false,https:{key:tlsKey,cert:tlsCert}});let authority='',origin='',admission=true;
  app.server.on('upgrade',(_request,socket)=>{if(ownedUpgrades.size>=64){socket.destroy();return}ownedUpgrades.add(socket);socket.once('close',()=>ownedUpgrades.delete(socket))});
  app.addHook('onRequest',async(request,reply)=>{const status=admission?authorizeRequest(request.headers,{token,authority,origin}):403;if(status!==200){const key=String(request.headers.upgrade??'').toLowerCase()==='websocket'?'websocketDenied':'httpDenied';evidence.authCounts[key]++;return reply.code(status).send({error:'unavailable'})}});
  app.get('/fixture-project-state',async(_request,reply)=>reply.header('cache-control','no-store').send(await readCoreFixtureState({home:config.accountHomeRoot,project:projectPath,homeIdentity,projectIdentity,uid,profileId:service.profileId,generation:service.generation,profileService})));
  if(config.nativeCliObserver)app.get('/fixture-native-observer',async(request,reply)=>{
   const none={state:'unknown',otherStreams:'unknown',target:{state:'unknown'},followup:{state:'unknown'}};
   try{
    const query=request.query??{},keys=Object.keys(query);if(keys.some(k=>k!=='thread')||keys.length>1||(query.thread!==undefined&&!SHA.test(query.thread)))return reply.code(400).send(none);
    if(await ownedUpstream?.verifyIdentity()!==true)return reply.send(none);
    const top=await docker(['top',service.containerId,'-eo','pid,ppid'],10000),inode=async path=>{const x=await stat(path,{bigint:true});return `${x.dev}:${x.ino}`},executables={app:await inode(join(runtimeRoot,'ChatGPT')),node:await inode(config.nodePath),cli:await inode(join(config.sourceRoot,'resources/codex'))};
    const readIdentity=async pid=>{const [raw,status]=await Promise.all([readFile(`/proc/${pid}/stat`,'utf8'),readFile(`/proc/${pid}/status`,'utf8')]),end=raw.lastIndexOf(')'),parts=raw.slice(end+2).trim().split(/\s+/),ns=/^NSpid:\s*([0-9\s]+)$/m.exec(status)?.[1]?.trim().split(/\s+/).at(-1);if(end<0||!/^\d+$/.test(parts[1]??'')||!/^\d+$/.test(parts[19]??'')||!/^\d+$/.test(ns??''))return null;return {ppid:Number(parts[1]),ticks:parts[19],nsPid:Number(ns),exe:await inode(`/proc/${pid}/exe`)}};
    const value=await readNativeObserverDirectory({directory:join(bridgeRoot,'observer-events'),profileId:service.profileId,generation:service.generation,threadHash:query.thread,verifyProcess:start=>verifyNativeObserverProcesses({start,top,readIdentity,executables})});
    if(await ownedUpstream?.verifyIdentity()!==true)return reply.send(none);return reply.header('cache-control','no-store').send(value);
   }catch(error){recordLaunchError('native-observer',error);return reply.header('cache-control','no-store').send(none)}
  });
  await app.register(websocket);
  await app.register(serverRoutes.registerChatGptDesktopRoutes,{profileService,...surfaceOptions});
  await app.register(bridgeRoutes.registerChatGptDesktopBridgeRoutes,{profileService});
  const iframePath=`/chatgpt-desktop/${service.profileId}/${service.generation}/webview/index.html`;
  app.get('/',async(_request,reply)=>reply.type('text/html').header('cache-control','no-store').send(createCoreSurfaceParent({profileId:service.profileId,generation:service.generation})));
  stage='listen';const bound=await app.listen({host:'0.0.0.0',port:0});const port=Number(new URL(bound).port);authority=`${config.advertiseIPv4}:${port}`;origin=`https://${authority}`;
  stage='surface-proof';const https=await import('node:https'),{checkServerIdentity}=await import('node:tls'),fingerprint=new X509Certificate(tlsCert).fingerprint256.replaceAll(':','').toLowerCase();
  const getSurfaceAsset=path=>new Promise((resolveResponse,reject)=>{const req=https.request({hostname:config.advertiseIPv4,port,path,method:'GET',ca:tlsCa,agent:false,headers:{cookie:`desktop_acceptance=${token}`},checkServerIdentity:(host,cert)=>checkServerIdentity(host,cert)??(createHash('sha256').update(cert.raw).digest('hex')===fingerprint?undefined:Error('certificate mismatch'))},response=>{(async()=>{const parts=[];let length=0;for await(const chunk of response){length+=chunk.length;if(length>512*1024)throw fail('ACCEPTANCE_ASSET_LIMIT');parts.push(chunk)}return {body:Buffer.concat(parts),status:response.statusCode,originalHeader:response.headers['x-original-content-sha256'],etag:response.headers.etag}})().then(resolveResponse,reject)});req.on('error',reject);req.setTimeout(10000,()=>req.destroy(fail('ACCEPTANCE_ASSET_TIMEOUT')));req.end()});
  evidence.surfaceRecipes={};for(const member of ['webview/index.html',...surfaceOptions.assetAdapter.members]){const path=iframePath.slice(0,-'index.html'.length)+member.slice('webview/'.length),response=await getSurfaceAsset(path);if(!verifyCoreSurfaceAsset({...response,expected:expected[member]}))throw fail('ACCEPTANCE_ASSET_MISMATCH');if(member==='webview/index.html')evidence.surfaceManifest=readCoreSurfaceManifest(response.body,{profileId:service.profileId,generation:service.generation});else evidence.surfaceRecipes[member]={...expected[member],servedAndVerified:true};}await save();
  const bridgePath=`/chatgpt-desktop/${service.profileId}/${service.generation}/bridge`;
  stage='worker-config';workerConfigPath=join(config.privateRoot,'worker.json');
  if(config.readyGate){controlRoot=join(config.privateRoot,'review-control');await mkdir(controlRoot,{mode:0o700});readyNonce=randomBytes(32).toString('hex');await writeFile(join(controlRoot,'expected.json'),JSON.stringify({version:1,nonce:readyNonce})+'\n',{mode:0o600,flag:'wx'});}
  const diagnosticPins={entry:waveExpected.get('packages/chatgpt-desktop-host/src/browser-entry.mjs'),bridge:waveExpected.get('packages/chatgpt-desktop-host/src/browser-bridge.mjs')};if(config.diagnostic&&!Object.values(diagnosticPins).every(x=>SHA.test(x??'')))throw fail('ACCEPTANCE_SOURCE_CHANGED');
  await writeFile(workerConfigPath,JSON.stringify({origin,token,iframePath,bridgePath,expected,nativeProjectPath,diagnostic:config.diagnostic,diagnosticPins,readyGate:config.readyGate,nativeCliObserver:config.nativeCliObserver,autoSend:config.autoSend,readyNonce,tlsCaSha256:config.tlsCaSha256,serverFingerprint:new X509Certificate(tlsCert).fingerprint256.replaceAll(':','').toLowerCase()})+'\n',{mode:0o600,flag:'wx'});
  const workerPath=join(root,'tests/e2e/chatgpt-desktop-account-core-worker.mjs'),fixturePath=join(root,'tests/e2e/chatgpt-desktop-account-core-fixture.mjs'),localConfigObserverPath=join(root,'tests/e2e/chatgpt-desktop-account-local-config-observer.mjs'),ledgerPath=join(root,'tests/e2e/chatgpt-desktop-account-core-ledger.mjs'),readyGatePath=join(root,'tests/e2e/chatgpt-desktop-account-ready-gate.mjs'),diagnosticPath=join(root,'tests/e2e/chatgpt-desktop-core-diagnostic.mjs'),entrySourcePath=join(root,'packages/chatgpt-desktop-host/src/browser-entry.mjs'),bridgeSourcePath=join(root,'packages/chatgpt-desktop-host/src/browser-bridge.mjs'),appHostProbePath=join(root,'tests/e2e/chatgpt-desktop-account-apphost-probe.mjs'),wireValuePath=join(root,'packages/chatgpt-desktop-host/src/wire-value.mjs'),networkPath=join(root,'tests/e2e/chatgpt-desktop-account-network.mjs'),uiPolicyPath=join(root,'tests/e2e/chatgpt-desktop-account-ui-policy.mjs'),wirePath=join(root,'tests/e2e/chatgpt-desktop-account-wire.mjs'),nodeModules=await realpath(join(root,'node_modules'));
  const args=['create','--init','--network','bridge','--ipc','private','--cgroupns','private','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','512','--memory','2g','--cpus','1','--cpuset-cpus',String(config.browserCpuId),'--shm-size','256m','--user',`${uid}:${gid}`,'--label',`agent.chatgpt.e2e=${browserLabel}`,'--tmpfs',`/tmp:rw,nosuid,nodev,exec,size=512m,uid=${uid},gid=${gid},mode=0700`,'--env','HOME=/tmp','--env','NODE_OPTIONS=','--env','NODE_PATH=','--env','LD_PRELOAD=','--env','LD_LIBRARY_PATH=',...coreBrowserTrustEnvironment(),
   '--mount',`type=bind,src=${workerPath},dst=/work/tests/e2e/chatgpt-desktop-account-core-worker.mjs,readonly`,'--mount',`type=bind,src=${fixturePath},dst=/work/tests/e2e/chatgpt-desktop-account-core-fixture.mjs,readonly`,'--mount',`type=bind,src=${localConfigObserverPath},dst=/work/tests/e2e/chatgpt-desktop-account-local-config-observer.mjs,readonly`,'--mount',`type=bind,src=${ledgerPath},dst=/work/tests/e2e/chatgpt-desktop-account-core-ledger.mjs,readonly`,'--mount',`type=bind,src=${readyGatePath},dst=/work/tests/e2e/chatgpt-desktop-account-ready-gate.mjs,readonly`,'--mount',`type=bind,src=${diagnosticPath},dst=/work/tests/e2e/chatgpt-desktop-core-diagnostic.mjs,readonly`,'--mount',`type=bind,src=${entrySourcePath},dst=/work/frozen/browser-entry.mjs,readonly`,'--mount',`type=bind,src=${bridgeSourcePath},dst=/work/frozen/browser-bridge.mjs,readonly`,'--mount',`type=bind,src=${appHostProbePath},dst=/work/tests/e2e/chatgpt-desktop-account-apphost-probe.mjs,readonly`,'--mount',`type=bind,src=${wireValuePath},dst=/work/packages/chatgpt-desktop-host/src/wire-value.mjs,readonly`,'--mount',`type=bind,src=${networkPath},dst=/work/tests/e2e/chatgpt-desktop-account-network.mjs,readonly`,'--mount',`type=bind,src=${uiPolicyPath},dst=/work/tests/e2e/chatgpt-desktop-account-ui-policy.mjs,readonly`,'--mount',`type=bind,src=${wirePath},dst=/work/tests/e2e/chatgpt-desktop-account-wire.mjs,readonly`,'--mount',`type=bind,src=${nodeModules},dst=/work/node_modules,readonly`,'--mount',`type=bind,src=${config.nodePath},dst=/opt/private-node,readonly`,'--mount',`type=bind,src=${config.certutilPath},dst=/opt/certutil,readonly`,'--mount',`type=bind,src=${config.tlsCaPath},dst=/worker/ca.pem,readonly`,'--mount',`type=bind,src=${config.browserCacheRoot},dst=/playwright,readonly`,'--mount',`type=bind,src=${workerConfigPath},dst=/worker/config.json,readonly`,'--mount',`type=bind,src=${config.evidenceRoot},dst=/results`,...(config.readyGate?['--mount',`type=bind,src=${controlRoot},dst=/control,readonly`]:[]),
   '--entrypoint','/opt/private-node',config.browserImageDigest,'/work/tests/e2e/chatgpt-desktop-account-core-worker.mjs'];
  stage='browser-create';browserId=await docker(args);if(!/^[a-f0-9]{64}$/.test(browserId))throw fail('ACCEPTANCE_BROWSER_ID_INVALID');
  stage='browser-inspect';const browserInspect=JSON.parse(await docker(['inspect','--format','{"id":{{json .Id}},"image":{{json .Image}},"label":{{json (index .Config.Labels "agent.chatgpt.e2e")}},"host":{{json .HostConfig}}}',browserId]));const bh=browserInspect.host;if(browserInspect.id!==browserId||browserInspect.image!==config.browserImageDigest||browserInspect.label!==browserLabel||!bh||bh.NetworkMode!=='bridge'||bh.IpcMode!=='private'||!['','private'].includes(bh.PidMode)||bh.CgroupnsMode!=='private'||bh.ReadonlyRootfs!==true||bh.Privileged!==false||bh.Init!==true||bh.PidsLimit!==512||bh.Memory!==2147483648||bh.NanoCpus!==1000000000||bh.CpusetCpus!==String(config.browserCpuId)||!bh.CapDrop?.includes('ALL')||!bh.SecurityOpt?.some(x=>x==='no-new-privileges'||x==='no-new-privileges:true'))throw fail('ACCEPTANCE_BROWSER_SANDBOX_INVALID');
  stage='browser-start';await docker(['start',browserId]);
  process.stdout.write(`Acceptance URL: ${origin}/\n`);
  stage='browser-wait';let exit;
  if(config.autoSend){
   const browserExited=docker(['wait',browserId],0).then(value=>({exited:true,value}));
   for(;;){const status=await Promise.race([browserExited,delay(1500).then(()=>({exited:false}))]);if(status.exited){exit=status.value;break}try{const bytes=await readFile(join(config.evidenceRoot,'worker-result.json'));if(bytes.length>65536)throw fail('ACCEPTANCE_WORKER_RESULT_INVALID');const current=JSON.parse(bytes.toString('utf8'));if(current?.passed===true&&current.stage==='holding-complete'&&current.outcomes?.model==='two-turns-completed'){evidence.worker=current;evidence.scope.modelTurnLimit=2;evidence.result='holding';evidence.sourceHashesAfter=await sourceHashes();evidence.sourceUnchanged=JSON.stringify(evidence.sourceHashesBefore)===JSON.stringify(evidence.sourceHashesAfter);if(!evidence.sourceUnchanged)throw fail('ACCEPTANCE_SOURCE_CHANGED');await save();const ended=await browserExited;exit=ended.value;throw fail('ACCEPTANCE_HELD_BROWSER_EXITED')}}catch(error){if(error?.code==='ENOENT'||error instanceof SyntaxError)continue;throw error}}
  }else exit=await docker(['wait',browserId],340000);
  if(!/^\d+$/.test(exit))throw fail('ACCEPTANCE_BROWSER_EXIT_UNKNOWN');
  stage='worker-result';const raw=await readFile(join(config.evidenceRoot,'worker-result.json'),'utf8');if(Buffer.byteLength(raw)>65536)throw fail('ACCEPTANCE_WORKER_RESULT_INVALID');
  evidence.worker=JSON.parse(raw);evidence.workerExit=Number(exit);
  if(config.readyGate&&evidence.worker?.scope?.modelTurnLimit===1)evidence.scope.modelTurnLimit=1;
  if(Number(exit)!==0||evidence.worker?.passed!==true)throw fail('ACCEPTANCE_BROWSER_FAILED');
  if(workMonitor.errors!==0||workMonitor.samples===0||workMonitor.execServerPeak!==0)throw fail('ACCEPTANCE_WORK_PROCESS_UNCONFIRMED');
  evidence.result='browser-passed';
  admission=false;
 }catch(error){recordLaunchError(stage,error);evidence.failureStage=stage;evidence.failureClass=typeof error?.code==='string'&&/^[A-Z][A-Z0-9_]{1,60}$/.test(error.code)?error.code:(typeof error?.name==='string'&&/^[A-Za-z]{1,40}$/.test(error.name)?error.name:'unknown');failureCode=typeof error?.code==='string'&&/^ACCEPTANCE_[A-Z_]+$/.test(error.code)?error.code:'ACCEPTANCE_FAILED';if(!service&&error?.retainedOwner)service=error.retainedOwner;if(config.readyGate)try{await writeFile(join(config.evidenceRoot,'launch-first-error.json'),JSON.stringify(launchJournal.snapshot())+'\n',{mode:0o600,flag:'wx'})}catch{failureCode='ACCEPTANCE_EVIDENCE_FAILED'}}
 finally{
  token='';
  clearInterval(processTimer);if(processInFlight)await processInFlight.catch(()=>{});evidence.workMonitor=workMonitor;
  if(browserId){try{const info=JSON.parse(await docker(['inspect','--format','{"id":{{json .Id}},"image":{{json .Image}},"label":{{json (index .Config.Labels "agent.chatgpt.e2e")}},"running":{{json .State.Running}}}',browserId]));if(info.id!==browserId||info.image!==config.browserImageDigest||info.label!==browserLabel)throw fail('ACCEPTANCE_BROWSER_ID_INVALID');if(info.running)await docker(['stop','--time','2',browserId]);await docker(['rm',browserId]);evidence.cleanup.browser='removed-owned';}catch(error){recordLaunchError('cleanup-browser',error);evidence.cleanup.browser='unconfirmed';evidence.cleanup.retainedBrowserContainerId=browserId;failureCode??='ACCEPTANCE_CLEANUP_UNCONFIRMED'}}
  if(workerConfigPath)await unlink(workerConfigPath).catch(()=>{});
  if(projectPath&&projectIdentity){try{const info=await lstat(projectPath,{bigint:true});evidence.projectFixture.sameIdentityAfter=info.isDirectory()&&info.dev===projectIdentity.dev&&info.ino===projectIdentity.ino&&info.uid===projectIdentity.uid&&await realpath(projectPath)===projectPath;evidence.projectFixture.entriesAfter=(await readdir(projectPath)).length;if(!evidence.projectFixture.sameIdentityAfter||evidence.projectFixture.entriesAfter!==0)failureCode??='ACCEPTANCE_PROJECT_CHANGED'}catch{evidence.projectFixture.sameIdentityAfter=false;evidence.projectFixture.entriesAfter=null;failureCode??='ACCEPTANCE_PROJECT_CHANGED'}}
  if(sourceObserver){try{evidence.accountSource.after=await sourceObserver.inventory();evidence.accountSource.same=(await sourceObserver.verify()).same;if(!evidence.accountSource.same)failureCode??='ACCEPTANCE_ACCOUNT_SOURCE_CHANGED'}catch{if(evidence.accountSource)evidence.accountSource.same=false;failureCode??='ACCEPTANCE_ACCOUNT_SOURCE_CHANGED'}finally{await sourceObserver.close()}}
  if(service&&createdService){
   try{await service.close();const p=JSON.parse(await readFile(profileFile,'utf8'));if(p.state!=='revoked')throw fail('ACCEPTANCE_REVOCATION_FAILED');
    const stillAlive=await Promise.race([service.nativeExited.then(()=>false),delay(350).then(()=>true)]);if(!stillAlive)throw fail('ACCEPTANCE_NATIVE_NOT_ALIVE');
    const running=await docker(['inspect','--format','{{.State.Running}}',service.containerId]);if(running!=='true')throw fail('ACCEPTANCE_NATIVE_NOT_ALIVE');
    evidence.profile={revoked:true,...coreViewCloseEvidence({brokerClosed:true,bootstrapCount:evidence.worker?.bridge?.receivedTypes?.bootstrap??0,viewClosedCount:evidence.worker?.bridge?.receivedTypes?.viewClosed??0}),nativeAliveAfterClose:true};
    // getState and zero observed exec-server processes are not an authoritative
    // inventory of remote leases or live tasks. Until a versioned proof exists,
    // workload stays unknown and this account fixture is deliberately retained.
    const proof={work:evidence.worker?.diagnostics?.workAfter?.enabled===false&&evidence.worker?.diagnostics?.workAfter?.ready===false&&evidence.worker?.diagnostics?.workAfter?.environmentPresent===false?'disabled':'unknown',execServerPeak:workMonitor.execServerPeak,processSamplingErrors:workMonitor.errors,processSamples:workMonitor.samples,workload:'unknown',viewClosed:evidence.profile.viewClosedConfirmed,sourceUnchanged:evidence.accountSource?.same===true};
    evidence.cleanup.taskProof=proof;
    if(authorizeAccountCleanup(proof)){
      await docker(['stop','--time','2',service.containerId]);await docker(['rm',service.containerId]);const native=await Promise.race([service.nativeExited,delay(5000).then(()=>({state:'timeout'}))]);if(native.state!=='exited')throw fail('ACCEPTANCE_NATIVE_EXIT_UNCONFIRMED');evidence.cleanup.native='removed-owned-and-exited';
    }else{evidence.cleanup.native='retained-unknown-task-status';evidence.cleanup.retainedNativeContainerId=service.containerId;failureCode??='ACCEPTANCE_TASK_STATE_UNKNOWN'}
   }catch(error){recordLaunchError('cleanup-native',error);evidence.cleanup.native='retained-or-unconfirmed';if(/^[a-f0-9]{64}$/.test(service.containerId??''))evidence.cleanup.retainedNativeContainerId=service.containerId;failureCode??='ACCEPTANCE_CLEANUP_UNCONFIRMED'}
  }else if(service){evidence.cleanup.native='retained-startup-failure';if(/^[a-f0-9]{64}$/.test(service.containerId??''))evidence.cleanup.retainedNativeContainerId=service.containerId;failureCode??='ACCEPTANCE_CLEANUP_UNCONFIRMED'}
  if(app)try{await delay(200);evidence.cleanup.gatewayOpenConnections=await new Promise(resolveCount=>app.server.getConnections((error,count)=>resolveCount(error?null:count)));const leaked=[...ownedUpgrades].filter(x=>!x.destroyed);evidence.cleanup.gatewayForcedOwnedUpgradeCloses=leaked.length;if(leaked.length)failureCode??='ACCEPTANCE_GATEWAY_UPGRADE_LEAK';for(const socket of leaked)socket.destroy();app.server.closeAllConnections?.();await deadline(app.close(),10000,'ACCEPTANCE_GATEWAY_CLOSE_TIMEOUT');evidence.cleanup.gateway='closed'}catch(error){recordLaunchError('cleanup-gateway',error);evidence.cleanup.gateway='unconfirmed';failureCode??='ACCEPTANCE_CLEANUP_UNCONFIRMED'}
  if(config.diagnostic)try{const bytes=await readPrivate(join(config.accountHomeRoot,'.bridge-chain-diagnostic.jsonl'),128*1024);await writeFile(join(config.evidenceRoot,'native-chain-diagnostic.jsonl'),bytes,{mode:0o600,flag:'wx'});evidence.nativeDiagnosticJournal='captured'}catch(error){recordLaunchError('native-journal',error);evidence.nativeDiagnosticJournal='unavailable'}
  if(config.nativeStderrProbe)try{const bytes=await readPrivate(join(config.accountHomeRoot,'.native-inotify-probe.jsonl'),64*1024);await writeFile(join(config.evidenceRoot,'native-inotify-probe.jsonl'),bytes,{mode:0o600,flag:'wx'});evidence.nativeStderrProbe='captured-fixed-categories-only'}catch(error){recordLaunchError('native-stderr-probe',error);evidence.nativeStderrProbe='unavailable'}
  try{await Promise.all([[config.tlsCaPath,config.tlsCaSha256],[config.tlsCertPath,config.tlsCertSha256],[config.tlsKeyPath,config.tlsKeySha256]].map(([path,sha])=>readPrivateTlsFile(path,sha)));evidence.tlsIntegrityUnchanged=true}catch{evidence.tlsIntegrityUnchanged=false;failureCode??='ACCEPTANCE_TLS_CHANGED'}
  try{await verifyFixedArtifacts();evidence.fixedArtifactsUnchanged=true}catch{evidence.fixedArtifactsUnchanged=false;failureCode??='ACCEPTANCE_ARTIFACT_CHANGED'}
  try{evidence.sourceHashesAfter=await sourceHashes();evidence.sourceUnchanged=JSON.stringify(evidence.sourceHashesBefore)===JSON.stringify(evidence.sourceHashesAfter);if(!evidence.sourceUnchanged)failureCode??='ACCEPTANCE_SOURCE_CHANGED'}catch{failureCode??='ACCEPTANCE_SOURCE_CHANGED'}
  evidence.result=failureCode?'failed':'passed';if(failureCode)evidence.failureCode=failureCode;
  if(config.diagnostic||config.readyGate)try{await writeFile(join(config.evidenceRoot,'launch-diagnostic.json'),JSON.stringify(launchJournal.snapshot())+'\n',{mode:0o600,flag:'wx'})}catch{failureCode??='ACCEPTANCE_EVIDENCE_FAILED';evidence.result='failed';evidence.failureCode=failureCode}
  await save();try{const files=['acceptance.json','tls/ca.pem','tls/server.pem',...(await readdir(config.evidenceRoot)).filter(x=>['worker-result.json','account-ui-diagnostic.png','bridge-diagnostic.json','network-diagnostic.json','launch-first-error.json','launch-diagnostic.json','native-chain-diagnostic.jsonl','native-inotify-probe.jsonl','first-json-exception.json','first-rpc-exception.json','first-project-exception.json','first-readback-exception.json'].includes(x)).sort()];const lines=[];for(const name of files)lines.push(`${await digest(join(config.evidenceRoot,name))}  ${name}`);await writeFile(join(config.evidenceRoot,'SHA256SUMS'),lines.join('\n')+'\n',{mode:0o600,flag:'wx'})}catch{failureCode??='ACCEPTANCE_EVIDENCE_FAILED';evidence.result='failed';evidence.failureCode=failureCode;await save().catch(()=>{})}clearInterval(keepAlive);
 }
 if(failureCode)throw fail(failureCode);
 return evidence;
}

async function main(){
 if(process.argv.length!==4||process.argv[2]!=='--config'||!pathOK(process.argv[3]))throw fail('ACCEPTANCE_USAGE');
 await runAcceptance(process.argv[3]);process.stdout.write('Acceptance passed.\n');
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(new URL(import.meta.url).pathname))main().catch(error=>{process.stderr.write((typeof error?.code==='string'&&/^ACCEPTANCE_[A-Z_]+$/.test(error.code)?error.code:'ACCEPTANCE_FAILED')+'\n');process.exitCode=1});
