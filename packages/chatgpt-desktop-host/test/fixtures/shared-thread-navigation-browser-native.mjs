import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createSharedThreadNavigationAssetAdapter } from '../../src/shared-thread-navigation-assets.mjs';

const sha = (value) => createHash('sha256').update(value).digest('hex');
const archive = 'bb88615052255e79b5977885f9a0cc212c268589587c79d4d3b7c4b46e881a95';
const files = {
  'app-initial-18b189e867e7.js': '244653d55e434b27618a848bef14d6d6781569bf58e8656cf644445113ffc032',
  'app-shared-601019a330d7.js': '02dd01d1e7c076ec44f10bb8446976f07be9eb007d1c32445adf5cda13221116',
  'rolldown-runtime-428824ca0286.js': 'f85e715d54a11fa37b7774ad77b536896ed01bfdfc98f485b678c81859fc8e2e',
};
const extract = (source, from, to) => {
  const start = source.indexOf(from), end = source.indexOf(to, start + from.length);
  assert.ok(start >= 0 && end > start && source.indexOf(from, start + 1) < 0, `original marker ${from}`);
  return source.slice(start, end);
};

/** Fixed original row/provider/resume code, real browser events, private transport. */
export async function openSharedNavigationBrowser({ scope, threadId, onMessage, onResume, setDelivery }) {
  if (process.env.CHATGPT_SHARED_NAV_ISOLATED !== '1') throw Error('isolated fixture required');
  await access('/.dockerenv');
  const procStatus = await readFile('/proc/self/status', 'utf8');
  const routes = await readFile('/proc/net/route', 'utf8');
  if (!/^NoNewPrivs:\s*1$/m.test(procStatus) || !/^Seccomp:\s*2$/m.test(procStatus) || /\s00000000\s/.test(routes))
    throw Error('network-none isolated fixture required');
  const assetDir = process.env.CHATGPT_SHARED_NAV_ASSET_DIR;
  const chromiumPath = process.env.CHATGPT_SHARED_NAV_CHROMIUM;
  if (!assetDir || !chromiumPath || !scope || typeof onMessage !== 'function' || typeof onResume !== 'function' || typeof setDelivery !== 'function')
    throw Error('fixture configuration required');
  const assets = new Map();
  for (const [name, digest] of Object.entries(files)) {
    const data = await readFile(join(assetDir, name));
    assert.equal(sha(data), digest, `fixed asset ${name}`); assets.set(name, data);
  }
  const adapter = createSharedThreadNavigationAssetAdapter({ archiveSha256: archive });
  const adapted = new Map();
  for (const member of adapter.members.slice(0, 3)) {
    const body = await readFile(join(assetDir, member.split('/').at(-1)));
    adapted.set(member.split('/').at(-1), adapter.adapt({ member, body }).body.toString('utf8'));
  }
  const initial = assets.get('app-initial-18b189e867e7.js').toString('utf8');
  const rowBehavior = extract(initial, 'function xja(', 'function Sja(');
  const clickCheck = extract(initial, 'function Cja(', 'function wja(');
  const row = extract(initial, 'function Tja(', 'var Eja,Dja;');
  const provider = extract(adapted.get('initialize-app-host-services-a3479e215e83.js'), 'function R_(){', 'function z_(');
  const resume = adapted.get('use-resume-conversation-if-needed-2ee16336bda8.js');
  const begin = resume.indexOf('r=o.get(ye,e);let __kanbanConnectAttempt');
  const end = resume.indexOf(');a?.(p.status', begin);
  assert.ok(begin >= 0 && end > begin);
  const resumeExpression = resume.slice(begin, end + 2);
  assert.ok(adapted.get('app-main-efa2926f393b.js').includes('__kanbanSharedThreadNavigation.createRoot'));

  const html = `<!doctype html><meta charset="utf-8"><div id="root"></div><script type="module">
import {createBrowserSharedThreadNavigation} from '/navigation.mjs';
import {GFt} from '/assets/app-shared-601019a330d7.js';
const scope=${JSON.stringify(scope)},threadId=${JSON.stringify(threadId)},hostId='local',token={},subscribers=new Set(),calls=[];
const lease={getSnapshot:()=>token,isCurrent:t=>t===token,subscribe(f){subscribers.add(f);return ()=>subscribers.delete(f)}};
const nav=createBrowserSharedThreadNavigation({window,documentScope:scope,scopeLease:lease,sendMessage:m=>window.__fixtureNativeMessage(m)});
window.__kanbanSharedThreadNavigation=nav;
await nav.ready();
const navKey={},otherKey={},store={set(k,v){if(k===navKey)window.provider=v},get(){return {cancel(){}}}};
const hooks={c:n=>Array(n).fill(Symbol.for('react.memo_cache_sentinel'))}, react={useRef:()=>({current:undefined}),useLayoutEffect:f=>f()};
const underlying=(...args)=>{calls.push(args)};
new Function('H_','Y','J','ge','Ln','wt','Oo','U_','x','V_','zp','Jd','z_','$c', 'return ('+${JSON.stringify(provider)}+')')
  (hooks,()=>store,{},()=>({pathname:'/',search:'',hash:'',state:null}),()=> '/',()=>()=>{},()=>underlying,react,x=>x,()=>true,{},otherKey,()=>{},navKey)();
const elem=(type,props)=>({$$typeof:Symbol.for('react.transitional.element'),type,key:null,props,_owner:null});
const originalRow=new Function('Eja','Dja','Ui',${JSON.stringify(`${rowBehavior};${clickCheck};${row};return Tja`)})
  (hooks,{jsx:elem},(...values)=>values.filter(Boolean).join(' '));
const root=document.getElementById('root');
nav.createRoot(GFt().createRoot,root).render(elem(originalRow,{id:'original-row',
  'data-app-action-sidebar-thread-row':'','data-app-action-sidebar-thread-kind':'local',
  'data-app-action-sidebar-thread-id':'forged-dom-id','data-app-action-sidebar-thread-host-id':'forged-dom-host',
  onPress:()=>window.provider.navigateToLocalConversation(threadId,hostId,{state:{original:'kept'}}),children:'Private original row'}));
const run=new Function('context',${JSON.stringify(`return (async()=>{let {globalThis,o,e,ye,__kanbanSharedLocation,w,_e,me,n,i,t,ne,u,d,te,c,De,ve,Pe}=context;let r,a;${resumeExpression};return p})()`)});
window.fixture={calls,threadId,nav,
  navigateAutomatically(){window.provider.navigateToLocalConversation(threadId,hostId,{state:{}})},
  async resume(id=threadId){const ye={},location={},enabled={},catalog={},state=calls.at(-1)?.[2]?.state ?? {};
    return await run({globalThis:window,o:{get:key=>key===ye?hostId:key===location?{state}:key===enabled?true:key===catalog?null:null},
      e:id,ye,__kanbanSharedLocation:location,w:{current:id},_e:enabled,me:catalog,n:null,i:{},t:'local',ne:[],u:false,d:null,te:null,c:false,
      De:()=>({resumeConversation:async(params)=>await window.__fixtureNativeResume(params)}),ve:()=>null,Pe:()=>null});
  }
};
</script>`;
  const sources = new Map([
    ['/navigation.mjs', await readFile(new URL('../../src/browser-shared-thread-navigation.mjs', import.meta.url))],
    ['/browser-sidebar-navigation-probe.mjs', await readFile(new URL('../../src/browser-sidebar-navigation-probe.mjs', import.meta.url))],
    ['/browser-react-root-probe.mjs', await readFile(new URL('../../src/browser-react-root-probe.mjs', import.meta.url))],
    ['/assets/app-shared-601019a330d7.js', assets.get('app-shared-601019a330d7.js')],
    ['/assets/rolldown-runtime-428824ca0286.js', assets.get('rolldown-runtime-428824ca0286.js')],
  ]);
  const server = createServer((request, response) => {
    if (request.method !== 'GET') return response.writeHead(405).end();
    if (request.url === '/') return response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(html);
    const source = sources.get(request.url);
    if (!source) return response.writeHead(404).end();
    return response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' }).end(source);
  });
  let browser, page;
  try {
    await new Promise((resolve, reject) => server.listen(0, '0.0.0.0', resolve).once('error', reject));
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ headless: true, executablePath: chromiumPath, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking'] });
    page = await browser.newPage();
    const failures = [];
    page.on('pageerror', (error) => failures.push(String(error)));
    await page.exposeFunction('__fixtureNativeMessage', onMessage);
    await page.exposeFunction('__fixtureNativeResume', onResume);
    setDelivery((frame) => { void page.evaluate((data) => window.dispatchEvent(new MessageEvent('message', { data })), frame).catch((error) => failures.push(String(error))); });
    await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'load' });
    await page.waitForFunction(() => Boolean(window.fixture));
    await page.locator('#original-row').waitFor();
    return Object.freeze({
      async rejectAutomatic() {
        await page.evaluate(() => window.fixture.navigateAutomatically());
        assert.equal(await page.evaluate(() => window.fixture.resume()), undefined);
      },
      async click() { await page.locator('#original-row').click(); },
      async rejectWrongThread(wrongThread) { assert.equal(await page.evaluate((id) => window.fixture.resume(id), wrongThread), undefined); },
      async resume() { return await page.evaluate(() => window.fixture.resume()); },
      async assertClean() { assert.deepEqual(failures, []); },
      async close() { setDelivery(() => {}); await browser.close(); await new Promise((resolve) => server.close(resolve)); },
    });
  } catch (error) {
    setDelivery(() => {}); await browser?.close(); await new Promise((resolve) => server.close(resolve)); throw error;
  }
}
