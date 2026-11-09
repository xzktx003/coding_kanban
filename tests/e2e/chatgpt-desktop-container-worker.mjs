// Executed only inside the explicitly created no-login browser container.
// The host supplies a short-lived 0600 config; never echo its cookie or URL.
import { chromium } from 'playwright';
import { createHash,randomBytes,X509Certificate } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir,readFile,readdir,symlink,writeFile } from 'node:fs/promises';
import https from 'node:https';
import { checkServerIdentity } from 'node:tls';
process.umask(0o077);
const startedAt=Date.now();

const result={version:1,scope:{loginSubmitted:false,apiKeyEntered:false,modelTurn:false,history:false,browserNetwork:'Playwright same-origin HTTP and WebSocket routing; not an OS firewall',trust:'fresh NSS DB contains only fixture CA; Chromium builtin roots remain'},
 auth:{untrustedCertificateRejected:false,caInstalled:false,nssOnlyFixtureCa:false,gatewayCertificatePinnedByNode:false,noCookieDenied:false,wrongOriginDenied:false,webSocketNoCookieDenied:false,webSocketWrongOriginDenied:false,cookieFlags:false,httpOnly:false},
 bridge:{observed:false,connected:false,sent:0,received:0,errors:0,sentTypes:{},receivedTypes:{},errorCodes:{}},browserErrors:{page:{},console:{}},ui:{signIn:false,alternate:false,apiKey:false,cancel:false},assets:{},requests:{sameOrigin:0,externalBlocked:0,websocketsBlocked:0,sameOriginFailed:0,externalFailed:0},memory:{scope:'browser iframe JS heap and isolated container renderer RSS; no duration or native RSS claim',heapSamples:0,heapPeakBytes:null,rendererRssSamples:0,rendererRssPeakKiB:null},stage:'start',passed:false};
let browser,context,page,monitor;
const save=async()=>writeFile('/results/worker-result.json',JSON.stringify(result,null,2)+'\n',{mode:0o600});
const digest=body=>createHash('sha256').update(body).digest('hex');
function count(o,k){o[k]=(o[k]??0)+1}
function wireMetadata(direction,payload){try{const text=typeof payload==='string'?payload:payload.toString('utf8');if(Buffer.byteLength(text)>1048576){count(result.bridge[direction+'Types'],'large');return}const v=JSON.parse(text),root=Array.isArray(v.root)&&v.root[0]==='r'?v.nodes?.[v.root[1]]:null,props=Array.isArray(root)&&root[0]==='object'?root[2]:[];const get=k=>props?.find(x=>x[0]===k)?.[1],type=get('type'),allowed=new Set(['bootstrap','createView','destroyView','viewClosed','openPort','closePort','portPost','portMessage','portClosed','call','return','throw','viewMessage','theme','workerMessage','gitPort','error']);count(result.bridge[direction+'Types'],allowed.has(type)?type:'other');const code=get('code');if(typeof code==='string'&&/^(?:ENTRY|BRIDGE|CONTROL|CONTAINER)_[A-Z_]+$/.test(code))count(result.bridge.errorCodes,code)}catch{count(result.bridge[direction+'Types'],'invalid')}}
function requireIt(value,code){if(!value)throw Object.assign(new Error(code),{code})}
function probe(url,ca,fingerprint,headers={},upgrade=false){return new Promise((resolve,reject)=>{
 const parsed=new URL(url),request=https.request({ca,checkServerIdentity:(host,cert)=>checkServerIdentity(host,cert)??(digest(cert.raw)===fingerprint?undefined:Error('certificate mismatch')),hostname:parsed.hostname,port:Number(parsed.port),path:parsed.pathname,method:'GET',agent:false,headers:{...headers,...(upgrade?{connection:'Upgrade',upgrade:'websocket','sec-websocket-version':'13','sec-websocket-key':randomBytes(16).toString('base64')}:{})}},response=>{response.on('end',()=>resolve(response.statusCode));response.resume()});
 request.on('upgrade',(_response,socket)=>{socket.destroy();resolve(101)});request.on('error',error=>reject(Object.assign(Error('probe failed'),{code:/^E[A-Z]+$/.test(error?.code??'')?error.code:'PROBE_FAILED'})));request.setTimeout(5000,()=>request.destroy(Error('probe timeout')));request.end();
});}
async function sampleRss(){try{let total=0,n=0;for(const pid of (await readdir('/proc')).filter(x=>/^\d+$/.test(x)).slice(0,1024)){try{const cmd=(await readFile(`/proc/${pid}/cmdline`,'utf8')).split('\0');if(cmd.some(x=>x.includes('chrome-headless-shell'))&&cmd.includes('--type=renderer')){const m=/^VmRSS:\s+(\d+)\s+kB$/m.exec(await readFile(`/proc/${pid}/status`,'utf8'));if(m){total+=Number(m[1]);n++}}}catch{}}if(n){result.memory.rendererRssSamples++;result.memory.rendererRssPeakKiB=Math.max(result.memory.rendererRssPeakKiB??0,total)}}catch{}}

try{
 const c=JSON.parse(await readFile('/worker/config.json','utf8'));
 requireIt(c&&typeof c.origin==='string'&&/^https:\/\/[0-9.]+:\d+$/.test(c.origin)&&/^[a-f0-9]{64}$/.test(c.token??'')&&/^\/chatgpt-desktop\/[a-f0-9-]{36}\/[a-f0-9-]{36}\/webview\/index\.html$/.test(c.iframePath??'')&&/^\/chatgpt-desktop\/[a-f0-9-]{36}\/[a-f0-9-]{36}\/bridge$/.test(c.bridgePath??''),'CONFIG_INVALID');
 result.stage='tls-preflight';const ca=await readFile('/worker/ca.pem');requireIt(digest(ca)===c.tlsCaSha256&&/^[a-f0-9]{64}$/.test(c.serverFingerprint??''),'TLS_CONFIG_INVALID');
 const execute=promisify(execFile),db='/tmp/.pki/nssdb',certutil=async args=>execute('/opt/certutil',args,{env:{HOME:'/tmp',PATH:'/usr/bin:/bin',LANG:'C'},timeout:10000,maxBuffer:16384});
 await mkdir(db,{recursive:true,mode:0o700});await mkdir('/tmp/.local/share/pki',{recursive:true,mode:0o700});await symlink(db,'/tmp/.local/share/pki/nssdb');await certutil(['-N','-d','sql:'+db,'--empty-password']);
 const browserArgs=['--no-sandbox','--disable-dev-shm-usage','--disable-background-networking','--disable-sync','--no-first-run','--disable-default-apps','--enable-precise-memory-info'];
 const beforeTrust=await chromium.launch({headless:true,executablePath:'/playwright/chrome-headless-shell-linux64/chrome-headless-shell',args:browserArgs});
 try{const isolated=await beforeTrust.newContext({serviceWorkers:'block'});const tab=await isolated.newPage();try{await tab.goto(c.origin+'/',{waitUntil:'domcontentloaded',timeout:15000})}catch(e){result.auth.untrustedCertificateRejected=/ERR_CERT_AUTHORITY_INVALID/.test(String(e?.message??''))}await isolated.close()}finally{await beforeTrust.close()}
 requireIt(result.auth.untrustedCertificateRejected,'TLS_UNTRUSTED_NOT_REJECTED');
 await certutil(['-A','-t','C,,','-n','Desktop Acceptance CA','-d','sql:'+db,'-i','/worker/ca.pem']);const installed=await certutil(['-L','-d','sql:'+db,'-n','Desktop Acceptance CA','-a']);result.auth.caInstalled=new X509Certificate(installed.stdout).fingerprint256===new X509Certificate(ca).fingerprint256;const listing=(await certutil(['-L','-d','sql:'+db])).stdout.split('\n').filter(line=>/^.+?\s+[A-Za-z]*,[A-Za-z]*,[A-Za-z]*\s*$/.test(line));result.auth.nssOnlyFixtureCa=listing.length===1&&/^Desktop Acceptance CA\s+C,,\s*$/.test(listing[0]);requireIt(result.auth.caInstalled&&result.auth.nssOnlyFixtureCa,'TLS_CA_IMPORT_FAILED');
 result.stage='authorization';
 result.authProbeCodes={};result.authProbeCodes.noCookie=await probe(c.origin+'/',ca,c.serverFingerprint);result.auth.noCookieDenied=result.authProbeCodes.noCookie===401;result.auth.gatewayCertificatePinnedByNode=result.auth.noCookieDenied;
 result.authProbeCodes.wrongOrigin=await probe(c.origin+'/',ca,c.serverFingerprint,{cookie:`desktop_acceptance=${c.token}`,origin:'http://other.invalid'});result.auth.wrongOriginDenied=result.authProbeCodes.wrongOrigin===403;
 result.authProbeCodes.webSocketNoCookie=await probe(c.origin+c.bridgePath,ca,c.serverFingerprint,{origin:c.origin},true);result.auth.webSocketNoCookieDenied=result.authProbeCodes.webSocketNoCookie===401;
 result.stage='authorization-websocket-wrong-origin';result.authProbeCodes.webSocketWrongOrigin=await probe(c.origin+c.bridgePath,ca,c.serverFingerprint,{cookie:`desktop_acceptance=${c.token}`,origin:'http://other.invalid'},true);result.auth.webSocketWrongOriginDenied=result.authProbeCodes.webSocketWrongOrigin===403;
 requireIt(result.auth.noCookieDenied&&result.auth.wrongOriginDenied&&result.auth.webSocketNoCookieDenied&&result.auth.webSocketWrongOriginDenied,'AUTH_NEGATIVE_FAILED');
 result.stage='launch';
 browser=await chromium.launch({headless:true,executablePath:'/playwright/chrome-headless-shell-linux64/chrome-headless-shell',args:browserArgs});
 context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1,serviceWorkers:'block'});
 await context.addCookies([{name:'desktop_acceptance',value:c.token,url:c.origin,httpOnly:true,secure:true,sameSite:'Strict'}]);const cookies=await context.cookies(c.origin);result.auth.cookieFlags=cookies.length===1&&cookies[0].name==='desktop_acceptance'&&cookies[0].httpOnly===true&&cookies[0].secure===true&&cookies[0].sameSite==='Strict';requireIt(result.auth.cookieFlags,'COOKIE_FLAGS_INVALID');
 await context.route('**/*',async route=>{try{const u=new URL(route.request().url());if(u.origin===c.origin){result.requests.sameOrigin++;await route.continue()}else{result.requests.externalBlocked++;await route.abort()}}catch{await route.abort().catch(()=>{})}});
 const wsOrigin=c.origin.replace(/^https:/,'wss:');
 await context.routeWebSocket(url=>url.origin!==wsOrigin,async ws=>{result.requests.websocketsBlocked++;await ws.close()});
 page=await context.newPage();const assetTasks=[];let resolveFatal;const fatalPageError=new Promise(resolve=>{resolveFatal=resolve});
 page.on('websocket',ws=>{try{const u=new URL(ws.url());if(u.origin!==wsOrigin||u.pathname!==c.bridgePath)return;result.bridge.observed=true;ws.on('framesent',e=>{result.bridge.sent++;wireMetadata('sent',e.payload)});ws.on('framereceived',e=>{result.bridge.received++;wireMetadata('received',e.payload)});ws.on('socketerror',()=>result.bridge.errors++);}catch{}});
 page.on('pageerror',e=>{count(result.browserErrors.page,['Error','TypeError','RangeError','SyntaxError'].includes(e.name)?e.name:'other');const m=String(e.message??'');const kind=/randomUUID/i.test(m)?'randomUUID':/crypto|subtle/i.test(m)?'crypto':/clipboard/i.test(m)?'clipboard':/is not a function/i.test(m)?'function-unavailable':/undefined|null/i.test(m)?'undefined-or-null':'other';result.browserErrors.pageCategory??={};count(result.browserErrors.pageCategory,kind);if(kind==='randomUUID')resolveFatal('RUNTIME_RANDOMUUID_FAILED');const at=/\/(index-[a-f0-9]+\.js):(\d+):(\d+)/.exec(String(e.stack??''));if(at)result.browserErrors.pageLocation={member:at[1],line:Number(at[2]),column:Number(at[3])};void save().catch(()=>{})});
 page.on('console',m=>{if(m.type()==='error')count(result.browserErrors.console,/sentry/i.test(m.text())?'sentry':/statsig/i.test(m.text())?'statsig':'other')});
 page.on('requestfailed',request=>{try{const u=new URL(request.url());result.requests[u.origin===c.origin?'sameOriginFailed':'externalFailed']++}catch{}});
 page.on('response',response=>{try{const u=new URL(response.url());if(u.origin!==c.origin)return;let member;if(u.pathname===c.iframePath)member='webview/index.html';else if(u.pathname.endsWith('/webview/assets/app-runtime-b179428fcc1e.js'))member='webview/assets/app-runtime-b179428fcc1e.js';else return;
  assetTasks.push((async()=>{const headers=response.headers(),body=await response.body(),actual=digest(body),expected=c.expected?.[member];result.assets[member]={status:response.status(),bytes:body.length,original:headers['x-original-content-sha256']??null,adapted:actual,etag:(headers.etag??'').replace(/^W\//,'').replace(/^"|"$/g,''),valid:response.status()===200&&body.length<=524288&&headers['x-original-content-sha256']===expected?.original&&actual===expected?.adapted&&(headers.etag??'').replace(/^W\//,'').replace(/^"|"$/g,'')===actual}})().catch(()=>{result.assets[member]={valid:false}}));
 }catch{}});
 monitor=setInterval(()=>void sampleRss(),500);monitor.unref();
 result.stage='navigation';await page.goto(c.origin+'/',{waitUntil:'domcontentloaded',timeout:30000});
 result.auth.httpOnly=!(await page.evaluate(()=>document.cookie.includes('desktop_acceptance=')));
 const frame=page.frameLocator('#desktop'),alternate=frame.getByRole('button',{name:'Sign in another way',exact:true});
 await Promise.race([alternate.waitFor({state:'visible',timeout:90000}),fatalPageError.then(code=>{throw Object.assign(Error(code),{code})})]);
 result.ui.signIn=await frame.getByText('Sign in to ChatGPT',{exact:true}).isVisible();
 result.bridge.connected=await frame.locator('body').evaluate(()=>!!window.electronBridge&&typeof window.electronBridge.sendMessageFromView==='function'&&typeof window.electronBridge.getInitialSidebarBootstrap==='function');
 result.stage='alternate';await alternate.click();
 result.ui.alternate=await frame.getByText('OpenAI API key',{exact:true}).isVisible();
 result.ui.apiKey=await frame.locator('input[placeholder="sk-…"]').isVisible();
 await frame.getByRole('button',{name:'Cancel',exact:true}).click();await alternate.waitFor({state:'visible',timeout:10000});result.ui.cancel=true;
 await Promise.allSettled(assetTasks);await sampleRss();
 const heap=await frame.locator('body').evaluate(()=>performance.memory?.usedJSHeapSize??null);if(Number.isFinite(heap)){result.memory.heapSamples++;result.memory.heapPeakBytes=heap}
 requireIt(Object.values(result.auth).every(Boolean)&&Object.values(result.ui).every(Boolean)&&result.bridge.observed&&result.bridge.connected&&result.bridge.sent>0&&result.bridge.received>0&&result.bridge.errors===0&&Object.values(c.expected).length===2&&Object.keys(c.expected).every(x=>result.assets[x]?.valid===true),'VERIFICATION_FAILED');
 result.stage='finished';result.passed=true;
}catch(error){result.errorKind=['TimeoutError','TypeError','Error'].includes(error?.name)?error.name:'other';result.errorCode=typeof error?.code==='string'&&/^[A-Z_]+$/.test(error.code)?error.code:'WORKER_FAILED';}
finally{result.elapsedMs=Date.now()-startedAt;clearInterval(monitor);try{await sampleRss();const frame=page?.frames().find(x=>x.url().includes('/webview/index.html'));if(frame){result.finalDocument=await frame.evaluate(()=>({readyState:document.readyState,bodyChildren:document.body?.childElementCount??0,rootChildren:document.querySelector('#root')?.childElementCount??0,bridgePresent:!!window.electronBridge,entryFailure:document.querySelector('#chatgpt-host-connection-status')?.getAttribute('data-error-code')??null,secureContext:window.isSecureContext,randomUUID:typeof crypto.randomUUID==='function',subtle:!!crypto.subtle,clipboard:!!navigator.clipboard,heap:performance.memory?.usedJSHeapSize??null}));if(Number.isFinite(result.finalDocument.heap)){result.memory.heapSamples++;result.memory.heapPeakBytes=Math.max(result.memory.heapPeakBytes??0,result.finalDocument.heap);delete result.finalDocument.heap}}}catch{}if(!result.passed&&page)try{await page.screenshot({path:'/results/failure.png',timeout:3000})}catch{}try{await context?.close()}catch{}try{await browser?.close()}catch{}await save().catch(()=>{});if(!result.passed)process.exitCode=1}
