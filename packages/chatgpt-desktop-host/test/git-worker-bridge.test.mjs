import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter, once } from 'node:events';
import { MessageChannel } from 'node:worker_threads';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import vm from 'node:vm';
import { installDesktopBridge } from '../src/browser-bridge.mjs';
import { encodeWireValue, decodeWireValue } from '../src/wire-value.mjs';

const archivePath = process.env.CHATGPT_DESKTOP_TEST_MAC_ASAR;
const pinned = { skip: !archivePath && 'Requires explicitly supplied pinned original Mac ASAR', timeout:5000 };
const run = promisify(execFile), turn = () => new Promise(resolve => setImmediate(resolve));
const scope = { profileId:'11111111-1111-4111-8111-111111111111', generation:'22222222-2222-4222-8222-222222222222', viewId:'33333333-3333-4333-8333-333333333333' };
let originalPreload;
async function preload() {
  if (originalPreload) return originalPreload;
  const digest = createHash('sha256');
  for await (const block of createReadStream(archivePath)) digest.update(block);
  assert.equal(digest.digest('hex'), 'bb88615052255e79b5977885f9a0cc212c268589587c79d4d3b7c4b46e881a95');
  const fd = await open(archivePath, 'r');
  try {
    const prefix = Buffer.alloc(16); await fd.read(prefix, 0, 16, 0);
    const length = prefix.readUInt32LE(12); assert.ok(length < 16*1024*1024);
    const header = Buffer.alloc(length); await fd.read(header, 0, length, 16);
    const item = JSON.parse(header.toString()).files['.vite'].files.build.files['preload.js'];
    assert.equal(item.size,7027); assert.equal(item.unpacked,undefined);
    const body = Buffer.alloc(item.size);
    await fd.read(body,0,body.length,8+prefix.readUInt32LE(4)+Number(item.offset));
    assert.equal(createHash('sha256').update(body).digest('hex'),'aa8be920fd14a9b98eca16c91d97a55105b196698fda36d5063e966620a0c54a');
    originalPreload = body.toString(); return originalPreload;
  } finally { await fd.close(); }
}
function windowFixture(origin) {
  const events = new EventEmitter();
  const win = { location:{origin}, performance:{timeOrigin:1}, MessageChannel,
    addEventListener:(name,callback)=>events.on(name,callback), removeEventListener:(name,callback)=>events.off(name,callback),
    dispatchEvent:event=>events.emit(event.type,event),
    postMessage(data,target,ports=[]) {
      assert.equal(target,origin);
      queueMicrotask(()=>events.emit('message',{source:win,origin,data,ports}));
    } };
  return {win,events};
}
async function chain(t, options={}) {
  const native = windowFixture('app://-'), browser = windowFixture('https://fixture.invalid');
  const ipc = new EventEmitter(), invocations=[], nativeFrames=[], browserFrames=[];
  const endpoints=[], peers=new Map(); let command, receive, seq=0, failed;
  const ipcRenderer = {
    on:(name,callback)=>ipc.on(name,callback), removeListener:(name,callback)=>ipc.off(name,callback),
    sendSync(name) {
      if(name==='codex_desktop:get-sentry-init-options')return {appVersion:'fixture',codexAppSessionId:'fixture'};
      if(name==='codex_desktop:get-shared-object-snapshot')return {};
      return name==='codex_desktop:get-system-theme-variant'?'light':undefined;
    },
    send() {}, postMessage() {},
    async invoke(channel,...args) {
      invocations.push({channel,args});
      if(channel==='codex_desktop:connect-git-worker') {
        if(options.rejectGit)return false;
        const pair=new MessageChannel();endpoints.push(pair.port1,pair.port2);peers.set(args[0],pair.port1);
        queueMicrotask(()=>ipc.emit('codex_desktop:git-worker-port',{ports:[pair.port2]},{requestId:args[0],closed:false}));
        return true;
      }
    },
  };
  const electron = {ipcRenderer,contextBridge:{exposeInMainWorld(name,value){native.win[name]=value;}},webUtils:{getPathForFile:()=>null}};
  vm.runInNewContext(await preload(),{require(name){assert.equal(name,'electron');return electron;},window:native.win,
    document:{documentElement:{dataset:{}}},process:{platform:'linux',arch:'x64'},performance:{timeOrigin:1},
    module:{exports:{}},MessageEvent:class {constructor(type,fields){this.type=type;Object.assign(this,fields);}},Map,Set,TextEncoder,MessageChannel});
  native.win.__kanbanOwnedControl = {
    subscribe(callback){command=callback;},
    emit(frame) {
      nativeFrames.push(frame);
      if(frame.type==='overflow')throw Error('Unexpected native companion overflow');
      const completion=receive?.(encodeWireValue({v:1,scope,seq:++seq,...frame}));
      Promise.resolve(completion).then(()=>command({type:'ack'}));
    },
  };
  vm.runInNewContext(await readFile(new URL('../src/native-view-shim.js',import.meta.url),'utf8'),
    {window:native.win,MessageChannel,TextEncoder,setTimeout,clearTimeout});
  const bridge=installDesktopBridge({window:browser.win,scope,bootstrap:{windowType:'electron',getters:{},sharedObjects:{}},
    onFailure:reason=>{failed=reason;},transport:{
      async send(encoded){const frame=decodeWireValue(encoded);browserFrames.push(frame);await command(frame);},
      subscribe(callback){receive=callback;return()=>{receive=undefined;};},
      close(){void command({type:'dispose'});},
    }});
  t.after(()=>{bridge.dispose();for(const port of endpoints)port.close();});
  async function connect() {
    const requestId=randomUUID();
    const transferred=new Promise(resolve=>{
      const callback=event=>{if(event.data?.type==='codex_desktop:git-worker-port'&&event.data.requestId===requestId){
        browser.win.removeEventListener('message',callback);resolve(event);
      }};
      browser.win.addEventListener('message',callback);
    });
    const accepted=await browser.win.electronBridge.connectGitWorker(requestId);
    assert.equal(accepted,true,'the original Git client requires a truthy native result');
    const event=await transferred;assert.equal(event.source,browser.win);assert.equal(event.origin,browser.win.location.origin);
    assert.equal(event.data.closed,false);assert.equal(event.ports.length,1);endpoints.push(event.ports[0]);
    await turn();return {requestId,port:event.ports[0],nativePeer:peers.get(requestId)};
  }
  return {browser,native,ipc,invocations,nativeFrames,browserFrames,bridge,connect,endpoints,get failed(){return failed;}};
}

test('pinned original preload and native companion carry actual read-only Git bytes over the existing Git MessagePort',pinned,async t=>{
  const directory=await mkdtemp(join(tmpdir(),'desktop-git-bridge-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  await run('git',['init','--quiet',directory]);
  await writeFile(join(directory,'before.txt'),'alpha\nbefore\n');await writeFile(join(directory,'after.txt'),'alpha\nafter\n');
  const status=(await run('git',['--no-optional-locks','-C',directory,'status','--porcelain=v1'])).stdout;
  let patch;
  try {await run('git',['--no-pager','diff','--no-index','--',join(directory,'before.txt'),join(directory,'after.txt')]);assert.fail('fixture must differ');}
  catch(error){assert.equal(error.code,1);patch=error.stdout;}
  assert.match(status,/\?\? after\.txt/);assert.match(patch,/-before\n\+after/);
  const f=await chain(t),link=await f.connect();
  assert.deepEqual(f.invocations[0],{channel:'codex_desktop:connect-git-worker',args:[link.requestId]});
  // These are opaque transport test vectors, not a replacement Git service.
  // Actual original-worker/Changes rendering is a separate native UI gate.
  const request=['push',['pipeline','git-fixture',['receive'],[{type:'worker-request',workerId:'git',request:{id:'read-1',method:'review-diff'}}]]];
  const nativeRead=once(link.nativePeer,'message');link.port.postMessage(request);
  assert.deepEqual((await nativeRead)[0],request);
  const reply=once(link.port,'message');link.nativePeer.postMessage({workerId:'git',type:'worker-response',response:{id:'read-1',method:'review-diff',result:{type:'ok',value:{status,patch}}}});
  assert.deepEqual((await reply)[0].response.result.value,{status,patch});
  await turn();await turn();assert.equal(f.failed,undefined);
  assert.ok(f.browserFrames.some(frame=>frame.type==='portPost'&&frame.portId==='git-1'));
  assert.ok(f.nativeFrames.some(frame=>frame.type==='portMessage'&&frame.portId==='git-1'));
  assert.equal(f.bridge.getResourceUsage().rawSnapshots,0);
});

test('the existing non-Git worker channel keeps exact original subscription, send and unsubscribe names',pinned,async t=>{
  const f=await chain(t),received=[];
  const unsubscribe=f.browser.win.electronBridge.subscribeToWorkerMessages('fixture-worker',message=>received.push(message));
  await turn();assert.equal(f.ipc.listenerCount('codex_desktop:worker:fixture-worker:for-view'),1);
  const message={type:'worker-event',workerId:'fixture-worker',event:{type:'fixture-event'}};
  f.ipc.emit('codex_desktop:worker:fixture-worker:for-view',{},message);await turn();assert.deepEqual(received,[message]);
  await f.browser.win.electronBridge.sendWorkerMessageFromView('fixture-worker',{type:'fixture-request'});
  assert.deepEqual(f.invocations.at(-1),{channel:'codex_desktop:worker:fixture-worker:from-view',args:[{type:'fixture-request'}]});
  unsubscribe();await turn();assert.equal(f.ipc.listenerCount('codex_desktop:worker:fixture-worker:for-view'),0);
  f.ipc.emit('codex_desktop:worker:fixture-worker:for-view',{},message);await turn();assert.equal(received.length,1);assert.equal(f.failed,undefined);
});

test('closing an owned document releases its Git ports and never forwards a late native payload',pinned,async t=>{
  const f=await chain(t),link=await f.connect();
  const closed=once(link.nativePeer,'close');f.bridge.dispose();await closed;
  const before=f.nativeFrames.length;link.port.postMessage(['late-document-message']);await turn();
  assert.equal(f.browserFrames.filter(frame=>frame.type==='portPost').length,0);
  assert.equal(f.nativeFrames.length,before);assert.equal(f.bridge.getResourceUsage().disposed,true);
  assert.equal(f.bridge.getResourceUsage().rawSnapshots,0);assert.equal(f.failed,undefined);
});
