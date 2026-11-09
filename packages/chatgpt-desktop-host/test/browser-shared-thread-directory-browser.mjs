// Own loopback-only, no-account fixture. Host page and ACKs are synthetic.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
const require=createRequire(process.cwd()+'/package.json');
const {chromium}=require('playwright');
const files=new Map();
for(const name of ['browser-shared-thread-directory','browser-shared-thread-navigation','browser-sidebar-navigation-probe','browser-react-root-probe'])
  files.set(`/${name}.mjs`,await readFile(new URL(`../src/${name}.mjs`,import.meta.url)));
const html=`<!doctype html><meta charset="utf-8"><div data-app-action-sidebar-scroll><div data-app-action-sidebar-section data-app-action-sidebar-section-heading="Projects"><div id="private">Private original</div></div></div><script type="module">
import {createBrowserSharedThreadNavigation} from '/browser-shared-thread-navigation.mjs';
import {createBrowserSharedThreadDirectory} from '/browser-shared-thread-directory.mjs';
const scope={profileId:crypto.randomUUID(),generation:crypto.randomUUID(),viewId:crypto.randomUUID()},threadId=crypto.randomUUID(),hostToken='A'.repeat(43),listeners=new Set();
let lease={},defer=false,acks=[],intents=[],routes=[],loads=[];
const scopeLease={getSnapshot:()=>lease,isCurrent:x=>x!==null&&x===lease,subscribe:fn=>(listeners.add(fn),()=>listeners.delete(fn))};
const ack=frame=>dispatchEvent(new MessageEvent('message',{data:frame}));
const nav=createBrowserSharedThreadNavigation({window,documentScope:scope,scopeLease,sendMessage:frame=>{
 if(frame.type==='kanban-shared-connect-lifecycle')queueMicrotask(()=>ack({type:'kanban-shared-connect-lifecycle-ack',sequence:frame.sequence,epoch:frame.epoch}));
 if(frame.type==='kanban-shared-connect-intent'){
   intents.push(frame);const value={type:'kanban-shared-connect-intent-ack',attemptId:frame.attemptId,sequence:frame.sequence,epoch:frame.epoch,accepted:frame.sourceToken===hostToken&&frame.threadId===threadId};
   if(defer)acks.push(value);else queueMicrotask(()=>ack(value));
 }
}});
document.querySelector('#private').setAttribute('data-app-action-sidebar-thread-id',threadId);
nav.wrapNavigation((threadId,hostId,options)=>{routes.push({threadId,hostId,options});return true});
const directory=createBrowserSharedThreadDirectory({window,scopeLease,navigation:nav,loadPage:async request=>{loads.push(request);return {page:{data:[{id:threadId,name:'CLI record',cwd:'/project',status:{type:'active'},extra:'retained'}],nextCursor:null,backwardsCursor:'origin'},tokens:[{threadId,token:hostToken}]}},navigateSource:args=>nav.navigateSharedThread(args)});
window.fixture={threadId,hostToken,intents,routes,loads,navigateSource:nav.navigateSharedThread,ready:()=>nav.ready(),defer(){defer=true},flush(){for(const value of acks.splice(0))ack(value)},revoke(){lease=null;for(const fn of listeners)fn()},dispose(){directory.dispose();nav.dispose()}};
</script>`;
const server=createServer((req,res)=>{if(req.method!=='GET')return res.writeHead(405).end();if(req.url==='/')return res.writeHead(200,{'content-type':'text/html; charset=utf-8'}).end(html);const body=files.get(req.url);return body?res.writeHead(200,{'content-type':'text/javascript; charset=utf-8'}).end(body):res.writeHead(404).end()});
await new Promise((resolve,reject)=>server.listen(0,'127.0.0.1',resolve).once('error',reject));let browser;
try{
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage','--disable-background-networking']});
  const context=await browser.newContext();const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(String(error)));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.waitForFunction(()=>window.fixture);await page.evaluate(()=>fixture.ready());
  assert.equal(await page.evaluate(()=>typeof fixture.navigateSource),'function');
  assert.equal(await page.evaluate(()=>fixture.navigateSource({threadId:fixture.threadId,hostId:'kanban-shared-cli',sourceToken:fixture.hostToken,options:{state:{__chatgptDesktopConnectAttempt:crypto.randomUUID()}}})),false);
  await page.locator('[data-kanban-shared-thread]').waitFor();
  await page.evaluate(()=>document.querySelector('[data-kanban-shared-thread]').click());
  assert.equal(await page.evaluate(()=>fixture.intents.length),0);
  await page.locator('[data-kanban-shared-thread]').click();
  await page.waitForFunction(()=>fixture.routes.length===1);
  const first=await page.evaluate(()=>({intent:fixture.intents[0],route:fixture.routes[0],threadId:fixture.threadId,token:fixture.hostToken,privateText:document.querySelector('#private').textContent,pages:fixture.loads}));
  assert.equal(first.intent.sourceToken,first.token);assert.equal(first.intent.threadId,first.threadId);
  assert.equal(first.route.sourceToken,undefined);assert.equal(first.route.threadId,first.threadId);
  assert.equal(first.intent.hostId,'kanban-shared-cli');assert.equal(first.route.hostId,'kanban-shared-cli');
  assert.ok(first.route.options.state.__chatgptDesktopConnectAttempt);assert.equal(JSON.stringify(first.route.options.state).includes(first.token),false);assert.equal(await page.evaluate(()=>document.body.innerHTML.includes(fixture.hostToken)),false);assert.equal(first.privateText,'Private original');
  assert.deepEqual(first.pages,[{cursor:null,limit:50}]);
  await page.evaluate(()=>fixture.defer());await page.locator('[data-kanban-shared-thread]').click();
  await page.waitForFunction(()=>fixture.intents.length===2);
  await page.evaluate(()=>{fixture.revoke();fixture.flush()});
  await page.waitForTimeout(25);assert.equal(await page.evaluate(()=>fixture.routes.length),1);
  assert.deepEqual(errors,[]);await page.evaluate(()=>fixture.dispose());await context.close();
  console.log(JSON.stringify({passed:true,boundary:'own Chromium; source page, ACK and isolated navigateSource are fixtures; no Electron, real daemon or model',checks:['trusted-click','untrusted-blocked','token-after-ack','duplicate-private-row','revocation-blocks-late-ack']}));
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve))}
