import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {createBrowserSharedThreadDirectory} from '../src/browser-shared-thread-directory.mjs';
const require=createRequire(new URL('../../../apps/web/package.json',import.meta.url));
const {JSDOM}=require('jsdom');
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));

function fixture({loadPage,navigateSource=()=>true}={}){
  const dom=new JSDOM(`<!doctype html><div data-app-action-sidebar-scroll><div data-app-action-sidebar-section data-app-action-sidebar-section-heading="Projects"><div id="private">Private original</div></div></div>`,{url:'https://localhost/'});
  const win=dom.window,records=[],errors=[],listeners=new Set();let leaseToken={},calls=[];
  const scopeLease={getSnapshot:()=>leaseToken,isCurrent:x=>x!==null&&x===leaseToken,subscribe:fn=>(listeners.add(fn),()=>listeners.delete(fn))};
  const navigation={activateExplicit:args=>{calls.push(args);return Promise.resolve(true)}};
  const controller=createBrowserSharedThreadDirectory({window:win,scopeLease,navigation,loadPage,navigateSource:navigateSource===false?undefined:navigateSource,onFailure:x=>errors.push(x)});
  return {win,controller,records,errors,calls,privateNode:win.document.querySelector('#private'),
    revoke(){leaseToken=null;for(const fn of listeners)fn()},notifySame(){for(const fn of listeners)fn()},close(){controller.dispose();dom.window.close()}};
}

test('host pages appear as a separate original-sidebar partition without changing private rows or cursors',async()=>{
  const threadId=randomUUID(),token='A'.repeat(43),secondId=randomUUID(),secondToken='B'.repeat(43),cursors=[];
  const page1={data:[{id:threadId,name:'Shared title',cwd:'/project',status:{type:'active'},custom:{preserved:true}}],nextCursor:'cursor:unmodified',backwardsCursor:'back'},
    page2={data:[{id:secondId,name:'Second',cwd:'/project',extra:'kept'}],nextCursor:null,backwardsCursor:'cursor:unmodified'};
  const f=fixture({loadPage:async ({cursor,limit})=>{cursors.push([cursor,limit]);return cursor===null?{page:page1,tokens:[{threadId,token}]}:{page:page2,tokens:[{threadId:secondId,token:secondToken}]}}});
  try {
    f.privateNode.setAttribute('data-app-action-sidebar-thread-row','');
    f.privateNode.setAttribute('data-app-action-sidebar-thread-kind','local');
    f.privateNode.setAttribute('data-app-action-sidebar-thread-id',threadId);
    await tick();
    const section=f.win.document.querySelector('[data-kanban-shared-directory]');assert.ok(section);
    assert.equal(section.previousElementSibling.getAttribute('data-app-action-sidebar-section-heading'),'Projects');
    assert.equal(f.privateNode.textContent,'Private original');assert.equal(f.privateNode.isConnected,true);
    assert.match(section.textContent,/Shared title/);assert.doesNotMatch(section.textContent,/running|idle/i);
    assert.deepEqual(f.controller.getSnapshot().pages[0].page,page1);
    assert.deepEqual(f.controller.getSnapshot().pages[0].page.data[0],page1.data[0]);
    assert.equal(f.controller.getSnapshot().pages[0].page.backwardsCursor,'back');
    f.win.document.querySelector('[data-kanban-shared-more]').click();await tick();
    assert.deepEqual(cursors,[[null,50],['cursor:unmodified',50]]);
    assert.match(section.textContent,/Second/);
    assert.deepEqual(f.controller.getSnapshot().pages[1].page,page2);
    assert.equal(f.controller.getSnapshot().nextCursor,null);
    f.win.document.querySelector('[data-kanban-shared-thread]').click();
    assert.equal(f.calls.length,0,'untrusted DOM click must not request a connection');
  } finally {f.close()}
});

test('forged, mismatched and stale source data never makes a shared row actionable',async()=>{
  const threadId=randomUUID(),f=fixture({loadPage:async()=>({page:{data:[{id:threadId,name:'untrusted'}],nextCursor:null},tokens:[{threadId:randomUUID(),token:'A'.repeat(43)}]})});
  try{await tick();assert.equal(f.win.document.querySelector('[data-kanban-shared-thread]'),null);assert.equal(f.calls.length,0);assert.ok(f.errors.length);f.revoke();assert.equal(f.calls.length,0)}finally{f.close()}
});

test('late pages cannot repopulate a retired account/view',async()=>{
  let resolve;const threadId=randomUUID(),f=fixture({loadPage:()=>new Promise(done=>{resolve=done})});
  try {await tick();assert.equal(typeof resolve,'function');f.revoke();resolve({page:{data:[{id:threadId,name:'late'}],nextCursor:null},tokens:[{threadId,token:'A'.repeat(43)}]});await tick();assert.doesNotMatch(f.win.document.body.textContent,/late/);assert.equal(f.calls.length,0)} finally {f.close()}
});

test('fixed Mac resources prove the original sidebar selectors used by the partition',{skip:!process.env.CHATGPT_DESKTOP_ORIGINAL_PRIMARY||!process.env.CHATGPT_DESKTOP_ORIGINAL_INITIAL},async()=>{
  const primary=await readFile(process.env.CHATGPT_DESKTOP_ORIGINAL_PRIMARY),initial=await readFile(process.env.CHATGPT_DESKTOP_ORIGINAL_INITIAL),sha=x=>createHash('sha256').update(x).digest('hex');
  assert.equal(sha(primary),'ebaecd54561e7e3da76c08b0d900e056424d57b1b23675afad4d7d235599f80b');
  assert.equal(sha(initial),'244653d55e434b27618a848bef14d6d6781569bf58e8656cf644445113ffc032');
  assert.match(primary.toString(),/xS\.sidebarSection\(\{collapsed:_,heading:d\?`Connections`:`Projects`\}\)/);
  assert.match(initial.toString(),/sidebarScroll:`data-app-action-sidebar-scroll`/);
  assert.match(initial.toString(),/sidebarSectionHeading:`data-app-action-sidebar-section-heading`/);
});


test('same-value scope notifications revoke the displayed source until a new lease',async()=>{
  let loads=0;const threadId=randomUUID();
  const f=fixture({loadPage:async()=>{loads++;return {page:{data:[{id:threadId,name:'stale'}],nextCursor:null},tokens:[{threadId,token:'A'.repeat(43)}]}}});
  try{await tick();assert.match(f.win.document.body.textContent,/stale/);f.notifySame();await tick();
    assert.doesNotMatch(f.win.document.body.textContent,/stale/);assert.equal(loads,1);assert.equal(f.calls.length,0);
  }finally{f.close()}
});


test('without source-isolated navigation, listed sessions remain visibly unavailable',async()=>{
  const threadId=randomUUID(),f=fixture({navigateSource:false,loadPage:async()=>({page:{data:[{id:threadId,name:'listed'}],nextCursor:null},tokens:[{threadId,token:'A'.repeat(43)}]})});
  try{await tick();const button=f.win.document.querySelector('[data-kanban-shared-thread]');assert.ok(button);assert.equal(button.disabled,true);assert.match(f.win.document.body.textContent,/暂时无法打开/);button.click();assert.equal(f.calls.length,0)}finally{f.close()}
});
