// Explicit, account-authorized access diagnostic: never connect default IPC/history and
// never submit a login or model turn. Source credentials remain server-only.
// Requires owned 0600 HTTPS config with two extra fixed account paths.
// It is never part of pnpm dev or the default test suite.
import { timingSafeEqual, createHash, X509Certificate, createPrivateKey, createPublicKey } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { isIP } from 'node:net';
import { dirname, isAbsolute, resolve } from 'node:path';
import { validateAccountConfig, openAccountSourceObserver, authorizeAccountCleanup, parseDockerProcessSnapshot } from './chatgpt-desktop-account-safety.mjs';
import { adaptAccountAccessProbe } from './chatgpt-desktop-account-access-probe.mjs';
import { installPrivateAccessProbeRoute, installPrivateEntryProbeRoute } from './chatgpt-desktop-account-access-route.mjs';
import { adaptAccountEntryProbe } from './chatgpt-desktop-account-entry-probe.mjs';

const SHA=/^[a-f0-9]{64}$/;
const IMAGE=/^sha256:[a-f0-9]{64}$/;
const configKeys=['protocol','tlsCertPath','tlsCertSha256','tlsKeyPath','tlsKeySha256','tlsCaPath','tlsCaSha256','certutilPath','certutilSha256','imageDigest','browserImageDigest','sourceRoot','macAsarPath','macAsarSha256','privateRoot','evidenceRoot','cpuId','advertiseIPv4','dockerPath','dockerSha256','pythonPath','pythonSha256','nodePath','nodeSha256','browserCacheRoot','browserSha256'];
const pathKeys=['tlsCertPath','tlsKeyPath','tlsCaPath','certutilPath','sourceRoot','macAsarPath','privateRoot','evidenceRoot','dockerPath','pythonPath','nodePath','browserCacheRoot'];
const fail=code=>Object.assign(new Error(code),{code});
const pathOK=x=>typeof x==='string'&&x.length>1&&x.length<=4096&&isAbsolute(x)&&resolve(x)===x&&!/[\x00-\x1f\x7f]/.test(x);

export function validateRunnerConfig(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join('\0')!==[...configKeys].sort().join('\0'))throw fail('ACCEPTANCE_CONFIG_INVALID');
 if(value.protocol!=='https'||!IMAGE.test(value.imageDigest)||!IMAGE.test(value.browserImageDigest)||!['tlsCertSha256','tlsKeySha256','tlsCaSha256','certutilSha256','macAsarSha256','dockerSha256','pythonSha256','nodeSha256','browserSha256'].every(k=>SHA.test(value[k]))||!pathKeys.every(k=>pathOK(value[k]))||!Number.isSafeInteger(value.cpuId)||value.cpuId<0||isIP(value.advertiseIPv4)!==4)throw fail('ACCEPTANCE_CONFIG_INVALID');
 return value;
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
 const [{constants,createReadStream},{lstat,open,readFile,readdir,realpath,mkdir,writeFile,unlink},{createHash,randomBytes},{execFile},{promisify},{fileURLToPath},{dirname,join,relative},{networkInterfaces},{setTimeout:delay}]=await Promise.all([
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
 const configBytes=await readPrivate(configFile);const config=validateAccountConfig(JSON.parse(configBytes.toString('utf8')));
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
 const includesCpu=allowed?.split(',').some(part=>{const x=part.split('-').map(Number);return x.length<=2&&x.every(Number.isSafeInteger)&&config.cpuId>=x[0]&&config.cpuId<=(x[1]??x[0])});
 if(!includesCpu)throw fail('ACCEPTANCE_CPU_INVALID');
 const bridgeRoot=join(config.privateRoot,'bridge'),stateRoot=join(config.privateRoot,'state'),runtimeRoot=join(config.privateRoot,'runtime');
 await mkdir(bridgeRoot,{mode:0o700});await mkdir(stateRoot,{mode:0o700});
 const profileFile=join(stateRoot,'profile.json'),controlSocketPath=join(stateRoot,'control.sock');
 const dockerEnv={HOME:bridgeRoot,PATH:'/usr/bin:/bin',DOCKER_CONFIG:join(bridgeRoot,'docker-config')};
 async function docker(args,timeout=20000){const value=await exec(config.dockerPath,args,{cwd:config.privateRoot,env:dockerEnv,timeout,maxBuffer:1024*1024,shell:false});return value.stdout.trim();}
 for(const image of [config.imageDigest,config.browserImageDigest])if(await docker(['image','inspect','--format','{{.Id}}',image])!==image)throw fail('ACCEPTANCE_IMAGE_MISMATCH');
 const sources=[
  'package.json','apps/server/package.json','apps/server/src/routes/chatgpt-desktop.ts','apps/server/src/routes/chatgpt-desktop-bridge.ts','apps/server/src/services/chatgpt-desktop-profile.ts',
  'packages/chatgpt-desktop-host/package.json',...['assets.mjs','json-lines.mjs','wire-value.mjs','browser-document.mjs','browser-entry.mjs','browser-bridge.mjs','surface-host-bridge.mjs','surface-activation.mjs','control-client.mjs','control-service.mjs','control-bind-helper.cjs','private-runtime.mjs','native-bootstrap.cjs','native-view-shim.js','native-view-registry.cjs','codex-surface-policy.cjs','project-consent-routing.cjs','renderer-policy.mjs','profile-publisher.mjs','container-service.mjs','container-host-service.mjs','account-snapshot.mjs','container-write-guard.mjs','container-native.mjs','container-bridge.py','container-peer-helper.py'].map(x=>'packages/chatgpt-desktop-host/src/'+x),
  'tests/e2e/chatgpt-desktop-container-acceptance.mjs','tests/e2e/chatgpt-desktop-account-acceptance.mjs','tests/e2e/chatgpt-desktop-account-worker.mjs','tests/e2e/chatgpt-desktop-account-access-diagnostic.mjs','tests/e2e/chatgpt-desktop-account-access-worker.mjs','tests/e2e/chatgpt-desktop-account-access-probe.mjs','tests/e2e/chatgpt-desktop-account-access-route.mjs','tests/e2e/chatgpt-desktop-account-entry-probe.mjs','tests/e2e/chatgpt-desktop-account-safety.mjs','tests/e2e/chatgpt-desktop-account-network.mjs','tests/e2e/chatgpt-desktop-account-wire.mjs','tests/e2e/chatgpt-desktop-account-apphost-probe.mjs','tests/e2e/chatgpt-desktop-account-ui-policy.mjs','tests/e2e/chatgpt-desktop-tls-fixture.mjs','node_modules/playwright/package.json','node_modules/playwright/index.mjs','node_modules/.pnpm/playwright-core@1.58.2/node_modules/playwright-core/package.json'];
 async function treeDigest(base){const h=createHash('sha256');let entries=0,total=0;async function visit(dir,rel=''){for(const entry of (await readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name,'en'))){if(++entries>10000)throw fail('ACCEPTANCE_SOURCE_UNAVAILABLE');const path=join(dir,entry.name),name=rel+entry.name,info=await lstat(path,{bigint:true});if(info.isSymbolicLink())throw fail('ACCEPTANCE_SOURCE_UNAVAILABLE');if(info.isDirectory())await visit(path,name+'/');else if(info.isFile()){total+=Number(info.size);if(total>1024*1024*1024)throw fail('ACCEPTANCE_SOURCE_UNAVAILABLE');const hash=await digest(path);if(!same(info,await lstat(path,{bigint:true})))throw fail('ACCEPTANCE_SOURCE_CHANGED');h.update(name+'\0'+hash+'\n')}else throw fail('ACCEPTANCE_SOURCE_UNAVAILABLE')}}await visit(base);return h.digest('hex')}
 async function sourceHashes(){const x={};for(const name of sources)x[name]=await digest(join(root,name));x['@playwright-tree']=await treeDigest(join(root,'node_modules/.pnpm/playwright@1.58.2/node_modules/playwright'));x['@playwright-core-tree']=await treeDigest(join(root,'node_modules/.pnpm/playwright-core@1.58.2/node_modules/playwright-core'));x['@browser-cache-tree']=await treeDigest(config.browserCacheRoot);return x;}
 let hashesBefore;try{hashesBefore=await sourceHashes()}catch{throw fail('ACCEPTANCE_SOURCE_UNAVAILABLE')}
 const evidence={version:1,artifacts:{configSha256:createHash('sha256').update(configBytes).digest('hex'),nativeImage:config.imageDigest,browserImage:config.browserImageDigest,macAsarSha256:config.macAsarSha256,linuxBinarySha256:'45751964e5d517169752c50748fca162c4eb156e2e362749e57447bf1489859b',linuxAsarSha256:'1588e6a0e1dcfc615060152ef264d4adf2c3ff6bb7496986c72163b5853e2a2e',nodeSha256:config.nodeSha256,browserBinarySha256:config.browserSha256,certutilSha256:config.certutilSha256,tlsCaSha256:config.tlsCaSha256,tlsCertSha256:config.tlsCertSha256},scope:{network:'native container bridge; browser bridge with exact pinned-CSP first-party origin routing (not OS firewall)',account:true,accountCopy:'id/access only; refresh empty; isolated tmpfs HOME',history:false,defaultIpc:false,modelTurns:0,fullWorkbench:false,verifier:'fixed read-only AppHost metadata plus instrumented original renderer response; diagnostic not formal UI evidence',rendererProbe:'private fixed app-primary (5 MiB) and browser-entry (128 KiB) response hooks; ASAR and product route budgets unchanged'},
  sourceHashesBefore:hashesBefore,sourceHashesAfter:null,sourceUnchanged:false,worker:null,profile:null,cleanup:{},result:'starting'};
 const evidencePath=join(config.evidenceRoot,'acceptance.json');
 const save=async()=>{await writeFile(evidencePath,JSON.stringify(evidence,null,2)+'\n',{mode:0o600})};
 await save();
 let service,app,browserId,workerConfigPath,sourceObserver,processTimer,processInFlight,token=randomBytes(32).toString('hex'),failureCode,createdService=false,stage='imports';
 const monitorEpoch=Date.now();const workMonitor={coverage:'after container service returned; startup interval not observed',samples:0,errors:0,firstMs:null,lastMs:null,execServerPeak:null};
 const ownedUpgrades=new Set();
 const keepAlive=setInterval(()=>{},1000);evidence.authCounts={httpDenied:0,websocketDenied:0};
 const browserLabel=randomBytes(16).toString('hex');
 try{
  const [{startContainerDesktopService},{openWebviewArchive},{createBrowserDocument},{adaptCodexRendererAsset},serverRoutes,bridgeRoutes,profileModule,{createRequire}]=await Promise.all([
   import('../../packages/chatgpt-desktop-host/src/container-host-service.mjs'),import('../../packages/chatgpt-desktop-host/src/assets.mjs'),import('../../packages/chatgpt-desktop-host/src/browser-document.mjs'),import('../../packages/chatgpt-desktop-host/src/renderer-policy.mjs'),import('../../apps/server/src/routes/chatgpt-desktop.ts'),import('../../apps/server/src/routes/chatgpt-desktop-bridge.ts'),import('../../apps/server/src/services/chatgpt-desktop-profile.ts'),import('node:module')]);
  const requireServer=createRequire(join(root,'apps/server/package.json')),Fastify=requireServer('fastify'),websocket=requireServer('@fastify/websocket');
  stage='source-observer';sourceObserver=await openAccountSourceObserver(config.accountSourceFile);evidence.accountSource={before:await sourceObserver.inventory(),after:null,same:null};
  stage='start-service';service=await startContainerDesktopService({imageDigest:config.imageDigest,sourceRoot:config.sourceRoot,runtimeRoot,bridgeRoot,cpuId:config.cpuId,macAsarPath:config.macAsarPath,macAsarSha256:config.macAsarSha256,profileFile,controlSocketPath,dockerPath:config.dockerPath,dockerSha256:config.dockerSha256,pythonPath:config.pythonPath,pythonSha256:config.pythonSha256,nodePath:config.nodePath,nodeSha256:config.nodeSha256,networkMode:'bridge',accountSnapshot:{sourceFile:config.accountSourceFile,homeRoot:config.accountHomeRoot},startupTimeoutMs:90000});
  createdService=true;
  async function sampleNative(){if(processInFlight)return processInFlight;processInFlight=(async()=>{try{const inspected=JSON.parse(await docker(['inspect','--format','{\"id\":{{json .Id}},\"image\":{{json .Image}},\"running\":{{json .State.Running}}}',service.containerId]));if(inspected.id!==service.containerId||inspected.image!==config.imageDigest||!inspected.running)throw Error();const raw=await docker(['top',service.containerId,'-eo','pid,args'],10000);const matches=parseDockerProcessSnapshot(raw).execServers;workMonitor.samples++;workMonitor.firstMs??=Date.now()-monitorEpoch;workMonitor.lastMs=Date.now()-monitorEpoch;workMonitor.execServerPeak=Math.max(workMonitor.execServerPeak??0,matches)}catch{workMonitor.errors++}})();try{await processInFlight}finally{processInFlight=null}}
  await sampleNative();processTimer=setInterval(()=>{void sampleNative()},1000);processTimer.unref();
  stage='asset-expectations';const archive=await openWebviewArchive({asarPath:config.macAsarPath,sha256:config.macAsarSha256});let expected={};
  try{for(const member of ['webview/index.html','webview/assets/app-runtime-b179428fcc1e.js','webview/assets/app-primary-75d53eef2374.js']){const asset=await archive.acquireAsset(member);try{const adapted=member==='webview/index.html'?createBrowserDocument({body:asset.body,profileId:service.profileId,generation:service.generation}):member==='webview/assets/app-primary-75d53eef2374.js'?adaptAccountAccessProbe(asset.body):adaptCodexRendererAsset({member,body:asset.body});if(!adapted||adapted.originalSha256!==createHash('sha256').update(asset.body).digest('hex'))throw fail('ACCEPTANCE_ASSET_EXPECTATION_FAILED');expected[member]={original:adapted.originalSha256,adapted:adapted.adaptedSha256};}finally{asset.release()}}}finally{await archive.close()}
  {const source=await readFile(join(root,'packages/chatgpt-desktop-host/src/browser-entry.mjs')),adapted=adaptAccountEntryProbe(source);expected['host/browser-entry.mjs']={original:adapted.originalSha256,adapted:adapted.adaptedSha256}}
  stage='build-gateway';const profileService=profileModule.createChatGptDesktopProfileService({profileFile});
  app=Fastify({logger:false,https:{key:tlsKey,cert:tlsCert}});let authority='',origin='',admission=true;
  app.server.on('upgrade',(_request,socket)=>{if(ownedUpgrades.size>=64){socket.destroy();return}ownedUpgrades.add(socket);socket.once('close',()=>ownedUpgrades.delete(socket))});
  app.addHook('onRequest',async(request,reply)=>{const status=admission?authorizeRequest(request.headers,{token,authority,origin}):403;if(status!==200){const key=String(request.headers.upgrade??'').toLowerCase()==='websocket'?'websocketDenied':'httpDenied';evidence.authCounts[key]++;return reply.code(status).send({error:'unavailable'})}});
  installPrivateAccessProbeRoute(app,{profileId:service.profileId,generation:service.generation,profileService,openArchive:openWebviewArchive,adapt:adaptAccountAccessProbe});
  installPrivateEntryProbeRoute(app,{profileId:service.profileId,generation:service.generation,profileService,readSource:()=>readFile(join(root,'packages/chatgpt-desktop-host/src/browser-entry.mjs')),adapt:adaptAccountEntryProbe});
  await app.register(websocket);
  await app.register(serverRoutes.registerChatGptDesktopRoutes,{profileService,entryAdapter:createBrowserDocument,assetAdapter:{members:['webview/assets/app-runtime-b179428fcc1e.js'],adapt:adaptCodexRendererAsset}});
  await app.register(bridgeRoutes.registerChatGptDesktopBridgeRoutes,{profileService});
  const iframePath=`/chatgpt-desktop/${service.profileId}/${service.generation}/webview/index.html`;
  app.get('/',async(_request,reply)=>reply.type('text/html').header('cache-control','no-store').send(`<!doctype html><html><body style="margin:0"><iframe id="desktop" src="${iframePath}" style="border:0;width:100vw;height:100vh"></iframe></body></html>`));
  stage='listen';const bound=await app.listen({host:'0.0.0.0',port:0});const port=Number(new URL(bound).port);authority=`${config.advertiseIPv4}:${port}`;origin=`https://${authority}`;
  const bridgePath=`/chatgpt-desktop/${service.profileId}/${service.generation}/bridge`;
  stage='worker-config';workerConfigPath=join(config.privateRoot,'worker.json');
  await writeFile(workerConfigPath,JSON.stringify({origin,token,iframePath,bridgePath,expected,tlsCaSha256:config.tlsCaSha256,serverFingerprint:new X509Certificate(tlsCert).fingerprint256.replaceAll(':','').toLowerCase()})+'\n',{mode:0o600,flag:'wx'});
  const workerPath=join(root,'tests/e2e/chatgpt-desktop-account-access-worker.mjs'),probePath=join(root,'tests/e2e/chatgpt-desktop-account-access-probe.mjs'),entryProbePath=join(root,'tests/e2e/chatgpt-desktop-account-entry-probe.mjs'),networkPath=join(root,'tests/e2e/chatgpt-desktop-account-network.mjs'),uiPolicyPath=join(root,'tests/e2e/chatgpt-desktop-account-ui-policy.mjs'),wirePath=join(root,'tests/e2e/chatgpt-desktop-account-wire.mjs'),appHostProbePath=join(root,'tests/e2e/chatgpt-desktop-account-apphost-probe.mjs'),nodeModules=join(root,'node_modules');
  const args=['create','--init','--network','bridge','--ipc','private','--cgroupns','private','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','512','--memory','2g','--cpus','1','--cpuset-cpus',String(config.cpuId),'--shm-size','256m','--user',`${uid}:${gid}`,'--label',`agent.chatgpt.e2e=${browserLabel}`,'--tmpfs',`/tmp:rw,nosuid,nodev,exec,size=512m,uid=${uid},gid=${gid},mode=0700`,'--env','HOME=/tmp','--env','NODE_OPTIONS=','--env','NODE_PATH=','--env','LD_PRELOAD=','--env','LD_LIBRARY_PATH=',
   '--mount',`type=bind,src=${workerPath},dst=/work/tests/e2e/chatgpt-desktop-account-access-worker.mjs,readonly`,'--mount',`type=bind,src=${probePath},dst=/work/tests/e2e/chatgpt-desktop-account-access-probe.mjs,readonly`,'--mount',`type=bind,src=${entryProbePath},dst=/work/tests/e2e/chatgpt-desktop-account-entry-probe.mjs,readonly`,'--mount',`type=bind,src=${networkPath},dst=/work/tests/e2e/chatgpt-desktop-account-network.mjs,readonly`,'--mount',`type=bind,src=${uiPolicyPath},dst=/work/tests/e2e/chatgpt-desktop-account-ui-policy.mjs,readonly`,'--mount',`type=bind,src=${wirePath},dst=/work/tests/e2e/chatgpt-desktop-account-wire.mjs,readonly`,'--mount',`type=bind,src=${appHostProbePath},dst=/work/tests/e2e/chatgpt-desktop-account-apphost-probe.mjs,readonly`,'--mount',`type=bind,src=${nodeModules},dst=/work/node_modules,readonly`,'--mount',`type=bind,src=${config.nodePath},dst=/opt/private-node,readonly`,'--mount',`type=bind,src=${config.certutilPath},dst=/opt/certutil,readonly`,'--mount',`type=bind,src=${config.tlsCaPath},dst=/worker/ca.pem,readonly`,'--mount',`type=bind,src=${config.browserCacheRoot},dst=/playwright,readonly`,'--mount',`type=bind,src=${workerConfigPath},dst=/worker/config.json,readonly`,'--mount',`type=bind,src=${config.evidenceRoot},dst=/results`,
   '--entrypoint','/opt/private-node',config.browserImageDigest,'/work/tests/e2e/chatgpt-desktop-account-access-worker.mjs'];
  stage='browser-create';browserId=await docker(args);if(!/^[a-f0-9]{64}$/.test(browserId))throw fail('ACCEPTANCE_BROWSER_ID_INVALID');
  stage='browser-inspect';const browserInspect=JSON.parse(await docker(['inspect','--format','{"id":{{json .Id}},"image":{{json .Image}},"label":{{json (index .Config.Labels "agent.chatgpt.e2e")}},"host":{{json .HostConfig}}}',browserId]));const bh=browserInspect.host;if(browserInspect.id!==browserId||browserInspect.image!==config.browserImageDigest||browserInspect.label!==browserLabel||!bh||bh.NetworkMode!=='bridge'||bh.IpcMode!=='private'||!['','private'].includes(bh.PidMode)||bh.CgroupnsMode!=='private'||bh.ReadonlyRootfs!==true||bh.Privileged!==false||bh.Init!==true||bh.PidsLimit!==512||bh.Memory!==2147483648||bh.CpusetCpus!==String(config.cpuId)||!bh.CapDrop?.includes('ALL')||!bh.SecurityOpt?.some(x=>x==='no-new-privileges'||x==='no-new-privileges:true'))throw fail('ACCEPTANCE_BROWSER_SANDBOX_INVALID');
  stage='browser-start';await docker(['start',browserId]);
  process.stdout.write(`Acceptance URL: ${origin}/\n`);
  stage='browser-wait';const exit=await docker(['wait',browserId],340000);if(!/^\d+$/.test(exit))throw fail('ACCEPTANCE_BROWSER_EXIT_UNKNOWN');
  stage='worker-result';const raw=await readFile(join(config.evidenceRoot,'worker-result.json'),'utf8');if(Buffer.byteLength(raw)>65536)throw fail('ACCEPTANCE_WORKER_RESULT_INVALID');
  evidence.worker=JSON.parse(raw);evidence.workerExit=Number(exit);
  if(Number(exit)!==0||evidence.worker?.passed!==true)throw fail('ACCEPTANCE_BROWSER_FAILED');
  if(workMonitor.errors!==0||workMonitor.samples===0||workMonitor.execServerPeak!==0)throw fail('ACCEPTANCE_WORK_PROCESS_UNCONFIRMED');
  evidence.result='browser-passed';
  admission=false;
 }catch(error){evidence.failureStage=stage;evidence.failureClass=typeof error?.code==='string'&&/^[A-Z][A-Z0-9_]{1,60}$/.test(error.code)?error.code:(typeof error?.name==='string'&&/^[A-Za-z]{1,40}$/.test(error.name)?error.name:'unknown');failureCode=typeof error?.code==='string'&&/^ACCEPTANCE_[A-Z_]+$/.test(error.code)?error.code:'ACCEPTANCE_FAILED';if(!service&&error?.retainedOwner)service=error.retainedOwner;}
 finally{
  token='';
  clearInterval(processTimer);if(processInFlight)await processInFlight.catch(()=>{});evidence.workMonitor=workMonitor;
  if(browserId){try{const info=JSON.parse(await docker(['inspect','--format','{"id":{{json .Id}},"image":{{json .Image}},"label":{{json (index .Config.Labels "agent.chatgpt.e2e")}},"running":{{json .State.Running}}}',browserId]));if(info.id!==browserId||info.image!==config.browserImageDigest||info.label!==browserLabel)throw fail('ACCEPTANCE_BROWSER_ID_INVALID');if(info.running)await docker(['stop','--time','2',browserId]);await docker(['rm',browserId]);evidence.cleanup.browser='removed-owned';}catch{evidence.cleanup.browser='unconfirmed';evidence.cleanup.retainedBrowserContainerId=browserId;failureCode??='ACCEPTANCE_CLEANUP_UNCONFIRMED'}}
  if(workerConfigPath)await unlink(workerConfigPath).catch(()=>{});
  if(sourceObserver){try{evidence.accountSource.after=await sourceObserver.inventory();evidence.accountSource.same=(await sourceObserver.verify()).same;if(!evidence.accountSource.same)failureCode??='ACCEPTANCE_ACCOUNT_SOURCE_CHANGED'}catch{if(evidence.accountSource)evidence.accountSource.same=false;failureCode??='ACCEPTANCE_ACCOUNT_SOURCE_CHANGED'}finally{await sourceObserver.close()}}
  if(service&&createdService){
   try{await service.close();const p=JSON.parse(await readFile(profileFile,'utf8'));if(p.state!=='revoked')throw fail('ACCEPTANCE_REVOCATION_FAILED');
    const stillAlive=await Promise.race([service.nativeExited.then(()=>false),delay(350).then(()=>true)]);if(!stillAlive)throw fail('ACCEPTANCE_NATIVE_NOT_ALIVE');
    const running=await docker(['inspect','--format','{{.State.Running}}',service.containerId]);if(running!=='true')throw fail('ACCEPTANCE_NATIVE_NOT_ALIVE');
    evidence.profile={revoked:true,brokerCloseConfirmed:true,viewClosedConfirmed:evidence.worker?.bridge?.receivedTypes?.bootstrap===1,nativeAliveAfterClose:true};
    // getState and zero observed exec-server processes are not an authoritative
    // inventory of remote leases or live tasks. Until a versioned proof exists,
    // workload stays unknown and this account fixture is deliberately retained.
    const proof={work:evidence.worker?.diagnostics?.workAfter?.enabled===false&&evidence.worker?.diagnostics?.workAfter?.ready===false&&evidence.worker?.diagnostics?.workAfter?.environmentPresent===false?'disabled':'unknown',execServerPeak:workMonitor.execServerPeak,processSamplingErrors:workMonitor.errors,processSamples:workMonitor.samples,workload:'unknown',viewClosed:evidence.profile.viewClosedConfirmed,sourceUnchanged:evidence.accountSource?.same===true};
    evidence.cleanup.taskProof=proof;
    if(authorizeAccountCleanup(proof)){
      await docker(['stop','--time','2',service.containerId]);await docker(['rm',service.containerId]);const native=await Promise.race([service.nativeExited,delay(5000).then(()=>({state:'timeout'}))]);if(native.state!=='exited')throw fail('ACCEPTANCE_NATIVE_EXIT_UNCONFIRMED');evidence.cleanup.native='removed-owned-and-exited';
    }else{evidence.cleanup.native='retained-unknown-task-status';evidence.cleanup.retainedNativeContainerId=service.containerId;failureCode??='ACCEPTANCE_TASK_STATE_UNKNOWN'}
   }catch{evidence.cleanup.native='retained-or-unconfirmed';if(/^[a-f0-9]{64}$/.test(service.containerId??''))evidence.cleanup.retainedNativeContainerId=service.containerId;failureCode??='ACCEPTANCE_CLEANUP_UNCONFIRMED'}
  }else if(service){evidence.cleanup.native='retained-startup-failure';if(/^[a-f0-9]{64}$/.test(service.containerId??''))evidence.cleanup.retainedNativeContainerId=service.containerId;failureCode??='ACCEPTANCE_CLEANUP_UNCONFIRMED'}
  if(app)try{await delay(200);evidence.cleanup.gatewayOpenConnections=await new Promise(resolveCount=>app.server.getConnections((error,count)=>resolveCount(error?null:count)));const leaked=[...ownedUpgrades].filter(x=>!x.destroyed);evidence.cleanup.gatewayForcedOwnedUpgradeCloses=leaked.length;if(leaked.length)failureCode??='ACCEPTANCE_GATEWAY_UPGRADE_LEAK';for(const socket of leaked)socket.destroy();app.server.closeAllConnections?.();await deadline(app.close(),10000,'ACCEPTANCE_GATEWAY_CLOSE_TIMEOUT');evidence.cleanup.gateway='closed'}catch{evidence.cleanup.gateway='unconfirmed';failureCode??='ACCEPTANCE_CLEANUP_UNCONFIRMED'}
  try{await Promise.all([[config.tlsCaPath,config.tlsCaSha256],[config.tlsCertPath,config.tlsCertSha256],[config.tlsKeyPath,config.tlsKeySha256]].map(([path,sha])=>readPrivateTlsFile(path,sha)));evidence.tlsIntegrityUnchanged=true}catch{evidence.tlsIntegrityUnchanged=false;failureCode??='ACCEPTANCE_TLS_CHANGED'}
  try{await verifyFixedArtifacts();evidence.fixedArtifactsUnchanged=true}catch{evidence.fixedArtifactsUnchanged=false;failureCode??='ACCEPTANCE_ARTIFACT_CHANGED'}
  try{evidence.sourceHashesAfter=await sourceHashes();evidence.sourceUnchanged=JSON.stringify(evidence.sourceHashesBefore)===JSON.stringify(evidence.sourceHashesAfter);if(!evidence.sourceUnchanged)failureCode??='ACCEPTANCE_SOURCE_CHANGED'}catch{failureCode??='ACCEPTANCE_SOURCE_CHANGED'}
  evidence.result=failureCode?'failed':'passed';if(failureCode)evidence.failureCode=failureCode;
  await save();try{const files=['acceptance.json','tls/ca.pem','tls/server.pem',...(await readdir(config.evidenceRoot)).filter(x=>['worker-result.json','account-ui-diagnostic.png'].includes(x)).sort()];const lines=[];for(const name of files)lines.push(`${await digest(join(config.evidenceRoot,name))}  ${name}`);await writeFile(join(config.evidenceRoot,'SHA256SUMS'),lines.join('\n')+'\n',{mode:0o600,flag:'wx'})}catch{failureCode??='ACCEPTANCE_EVIDENCE_FAILED';evidence.result='failed';evidence.failureCode=failureCode;await save().catch(()=>{})}clearInterval(keepAlive);
 }
 if(failureCode)throw fail(failureCode);
 return evidence;
}

async function main(){
 if(process.argv.length!==4||process.argv[2]!=='--config'||!pathOK(process.argv[3]))throw fail('ACCEPTANCE_USAGE');
 await runAcceptance(process.argv[3]);process.stdout.write('Diagnostic passed.\n');
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(new URL(import.meta.url).pathname))main().catch(error=>{process.stderr.write((typeof error?.code==='string'&&/^ACCEPTANCE_[A-Z_]+$/.test(error.code)?error.code:'ACCEPTANCE_FAILED')+'\n');process.exitCode=1});
