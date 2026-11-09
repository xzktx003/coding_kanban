// Explicit network-none Chromium fixture. No Electron, daemon, account or task.
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import {createServer} from "node:http";
import {chromium} from "playwright";

const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
const files={
  navigation:await readFile("/work/packages/chatgpt-desktop-host/src/browser-isolated-pane-navigation.mjs"),
  provider:await readFile("/fixture/initialize-app-host-services.js"),
  shared:await readFile("/fixture/app-shared.js"),
  runtime:await readFile("/fixture/rolldown-runtime.js"),
  initial:await readFile("/fixture/app-initial.js"),
};
assert.equal(sha(files.provider),"3212418ea362dbd6ca22a4f02319511dbeee19a3482ae45f40923d9a9ce856eb");
assert.equal(sha(files.shared),"02dd01d1e7c076ec44f10bb8446976f07be9eb007d1c32445adf5cda13221116");
assert.equal(sha(files.runtime),"f85e715d54a11fa37b7774ad77b536896ed01bfdfc98f485b678c81859fc8e2e");
assert.equal(sha(files.initial),"244653d55e434b27618a848bef14d6d6781569bf58e8656cf644445113ffc032");
function extract(text,start,end){const a=text.indexOf(start),b=text.indexOf(end,a);assert.ok(a>=0&&b>a);return text.slice(a,b)}
const provider=extract(files.provider.toString(),"function R_(){","function z_(");
const initial=files.initial.toString(),bEn=extract(initial,"function M8n(","function N8n("),jyo=extract(initial,"function jyo(){","function Myo()");
const html=`<!doctype html><meta charset="utf-8"><div id="root"></div><script type="module">
import {createBrowserIsolatedPaneNavigation} from '/navigation.mjs';
import {GFt} from '/assets/app-shared-601019a330d7.js';
const scope={profileId:crypto.randomUUID(),generation:crypto.randomUUID(),viewId:crypto.randomUUID()},token={};
let active=true,selection=1,inHandler=false,providerValue;
const scopeLease={getSnapshot:()=>active?token:null,isCurrent:x=>active&&x===token};
const navigation=createBrowserIsolatedPaneNavigation({window,documentScope:scope,scopeLease});
const threadId=crypto.randomUUID(),routerCalls=[],attempts=[],navKey={};
const store={get(key){if(key===navKey)return providerValue;return {cancel(){}}},set(key,value){if(key===navKey)providerValue=value}};
const fakeRouter=(path,options)=>routerCalls.push({path,options,inHandler});
const initJyo=new Function('Nyo','gr','ca','ka','Si','Ayo','Yi','Myo','_vi','wt','return ('+${JSON.stringify(jyo)}+')');
const originalRouterHook=initJyo({c:n=>Array(n).fill(Symbol.for('react.memo_cache_sentinel'))},()=>({pathname:'/',search:'',hash:'',state:null}),
 ()=>fakeRouter,x=>x,x=>'/conversation/'+x,(path,host)=>path+'?host='+host,{},()=>{}, {start(){}},x=>x);
const hooks={c:n=>Array(n).fill(Symbol.for('react.memo_cache_sentinel'))},react={useRef:()=>({current:undefined}),useLayoutEffect:f=>f()};
const buildProvider=new Function('H_','Y','J','ge','Ln','wt','Oo','U_','x','V_','zp','Jd','z_','$c','return ('+${JSON.stringify(provider)}+')');
buildProvider(hooks,()=>store,{},()=>({pathname:'/',search:'',hash:'',state:null}),()=> '/',()=>()=>{},()=>originalRouterHook(),
 react,x=>x,()=>true,{}, {},()=>{},navKey)();
const originalBEn=new Function('qM','return ('+${JSON.stringify(bEn)}+')')(navKey);
function activate(event){
  const native=event.nativeEvent,nonce=crypto.randomUUID(),capture=selection;
  inHandler=true;
  try{
    const result=navigation.activateExplicit({event:native,hostId:'local',threadId,state:{__chatgptDesktopPaneNavigation:nonce},
      isCurrent:()=>selection===capture,navigate:(thread,host,options)=>originalBEn(store,thread,host==='local'?undefined:host,options)});
    attempts.push({phase:native.eventPhase,trusted:native.isTrusted,prevented:native.defaultPrevented,nonce,selection:capture});
    Promise.resolve(result).then(value=>attempts.at(-1).result=value);
  }finally{inHandler=false;}
}
const elem=(type,props)=>({$$typeof:Symbol.for('react.transitional.element'),type,key:null,props,_owner:null});
GFt().createRoot(document.getElementById('root')).render(elem('div',{children:[
  elem('button',{id:'tab',onClick:activate,children:'tab'}),
  elem('div',{id:'passive',role:'button',tabIndex:0,onClickCapture:e=>{e.stopPropagation();activate(e);e.preventDefault()},
    onKeyDownCapture:e=>{e.stopPropagation();if(!['Enter',' '].includes(e.key))return;e.preventDefault();activate(e)},children:'passive'}),
]}));
window.fixture={threadId,routerCalls,attempts,reset(){routerCalls.length=0;attempts.length=0},
  setActive(value){active=value},changeSelection(){selection++},
  acceptRoute(index){const call=routerCalls[index],attempt=attempts.find(x=>x.nonce===call?.options?.state?.__chatgptDesktopPaneNavigation);
    return !!attempt&&attempt.selection===selection&&active}};
</script>`;
const server=createServer((request,response)=>{
  const table={"/navigation.mjs":files.navigation,"/assets/app-shared-601019a330d7.js":files.shared,"/assets/rolldown-runtime-428824ca0286.js":files.runtime};
  if(request.method!=="GET")return response.writeHead(405).end();
  if(request.url==="/")return response.writeHead(200,{"content-type":"text/html; charset=utf-8"}).end(html);
  if(table[request.url])return response.writeHead(200,{"content-type":"text/javascript; charset=utf-8"}).end(table[request.url]);
  return response.writeHead(404).end();
});
await new Promise((resolve,reject)=>server.listen(0,"0.0.0.0",resolve).once("error",reject));
let browser;
try{
  browser=await chromium.launch({headless:true,executablePath:"/playwright/chrome-headless-shell-linux64/chrome-headless-shell",
    args:["--no-sandbox","--disable-dev-shm-usage","--disable-background-networking"]});
  const page=await browser.newPage(),errors=[];page.on("pageerror",error=>errors.push(String(error)));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.waitForFunction(()=>Boolean(window.fixture));
  const snapshot=()=>page.evaluate(()=>({calls:fixture.routerCalls,attempts:fixture.attempts,threadId:fixture.threadId}));
  async function expectOne(label){const value=await snapshot();assert.equal(value.calls.length,1,`${label} ${JSON.stringify({value,errors})}`);
    assert.equal(value.attempts.length,1);assert.equal(value.attempts[0].trusted,true);assert.equal(value.attempts[0].result,true);
    assert.equal(value.calls[0].inHandler,true);assert.equal(value.calls[0].path,`/conversation/${value.threadId}`);
    assert.equal(value.calls[0].options.state.__chatgptDesktopPaneNavigation,value.attempts[0].nonce);}
  await page.locator("#tab").click();await expectOne("trusted tab click");
  await page.evaluate(()=>fixture.reset());await page.locator("#passive").click();await expectOne("trusted capture click");
  for(const key of ["Enter","Space"]){await page.evaluate(()=>fixture.reset());await page.locator("#passive").focus();await page.keyboard.press(key);await expectOne(`trusted capture ${key}`);
    const data=await snapshot();assert.equal(data.attempts[0].prevented,true);assert.equal(data.attempts[0].phase,1);}
  await page.evaluate(()=>fixture.reset());await page.evaluate(()=>document.querySelector('#tab').click());assert.equal((await snapshot()).calls.length,0);
  await page.evaluate(()=>{fixture.reset();fixture.setActive(false)});await page.locator("#tab").click();assert.equal((await snapshot()).calls.length,0);
  await page.evaluate(()=>{fixture.setActive(true);fixture.reset()});await page.locator("#tab").click();await expectOne("route before selection change");
  assert.equal(await page.evaluate(()=>fixture.acceptRoute(0)),true);await page.evaluate(()=>fixture.changeSelection());
  assert.equal(await page.evaluate(()=>fixture.acceptRoute(0)),false);assert.equal((await snapshot()).calls.length,1);
  assert.deepEqual(errors,[]);assert.equal(sha(await readFile("/work/packages/chatgpt-desktop-host/src/browser-isolated-pane-navigation.mjs")),sha(files.navigation));
  console.log(JSON.stringify({passed:true,checks:["trusted-click","capture-click","prevented-capture-enter","prevented-capture-space","untrusted","inactive","late-route-selection"],
    navigationSha256:sha(files.navigation),boundary:"Chromium with original React and extracted original M8n/R_/jyo; router sink and late-route selection check are synthetic; no native GUI, daemon, account or RPC"}));
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve))}
