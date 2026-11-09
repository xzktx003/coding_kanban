import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { mkdtemp, readFile, rm, symlink, chmod, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import {isContainerRecoveryQuery} from '../src/container-recovery-wire.mjs';

for (const file of ['container-native.mjs', 'native-bootstrap.cjs']) {
  test(`${file} first-cause journal is fixed, private, exclusive and optional`, async t => {
    const root = await mkdtemp(join(tmpdir(), 'desktop-first-cause-'));
    t.after(() => rm(root, { recursive:true, force:true }));
    const source = await readFile(new URL(`../src/${file}`, import.meta.url), 'utf8');
    const match = source.match(/function writeFirstCause\(phase, enabled\) \{[\s\S]*?\n\}/);
    assert.ok(match, 'the actual source provides the fixed first-cause writer');
    const translate = value => value === '/bridge' ? root : value === '/bridge/first-cause.json' ? join(root, 'first-cause.json') : value;
    const sandboxFs = {...fs,
      lstatSync: value => fs.lstatSync(translate(value)),
      realpathSync: value => value === '/bridge' && fs.realpathSync(root) === root ? '/bridge' : fs.realpathSync(translate(value)),
      openSync: (value, flags, mode) => fs.openSync(translate(value), flags, mode),
    };
    const write = vm.runInNewContext(`(${match[0]})`, {fs:sandboxFs, process, JSON});
    write('renderer_unsupported_value', false);
    assert.equal(fs.existsSync(join(root, 'first-cause.json')), false);
    write('PRIVATE_VALUE_SENTINEL', true);
    assert.equal(fs.existsSync(join(root, 'first-cause.json')), false);
    write('renderer_unsupported_value', true);
    const first = await readFile(join(root, 'first-cause.json'), 'utf8');
    assert.deepEqual(JSON.parse(first), {v:1,phase:'renderer_unsupported_value'});
    assert.equal((fs.statSync(join(root, 'first-cause.json')).mode & 0o777), 0o600);
    write('container_stdout_error', true);
    assert.equal(await readFile(join(root, 'first-cause.json'), 'utf8'), first);
    await rm(join(root, 'first-cause.json'));
    const target = join(root, 'unrelated');
    await writeFile(target, 'preserve');
    await symlink(target, join(root, 'first-cause.json'));
    write('container_stdout_error', true);
    assert.equal(await readFile(target, 'utf8'), 'preserve');
    await rm(join(root, 'first-cause.json'));
    await chmod(root, 0o755);
    write('container_stdout_error', true);
    assert.equal(fs.existsSync(join(root, 'first-cause.json')), false);
  });
}

test('native renderer overflow records only a fixed own kind before the existing failure path', async () => {
  const source = await readFile(new URL('../src/native-bootstrap.cjs', import.meta.url), 'utf8');
  const match = source.match(/electron\.ipcMain\.on\("kanban-owned:event", \(event, frame\) => \{[\s\S]*?\n    \}\);/);
  assert.ok(match, 'the actual renderer event handler can be exercised independently');
  for (const scenario of ['awaiting_count', 'awaiting_bytes', 'unsupported_value', 'value_budget', 'unexpected_ack', 'private', 'getter']) {
    let handler, getterCalls = 0;
    const phases = [], sent = [], sender = {mainFrame:{},send(){}};
    const record = {viewId:'fixture',failed:false,window:{webContents:sender}};
    const electron = {ipcMain:{on(name,callback){assert.equal(name,'kanban-owned:event');handler=callback;}}};
    const writeFirstCause = phase => { phases.push(phase); };
    vm.runInNewContext(match[0], {electron, bySender:new Map([[7,record]]), registry:{destroy:async()=>{}},
      writeFirstCause, firstCauseEnabled:true, send:frame=>sent.push(frame), scope:()=>({}), output(){}});
    sender.id = 7;
    const frame = {type:'overflow'};
    if (scenario === 'getter') Object.defineProperty(frame, 'kind', {get(){getterCalls++;return 'awaiting_count';}});
    else frame.kind = scenario;
    handler({sender,senderFrame:sender.mainFrame}, frame);
    const expected = ['private','getter'].includes(scenario) ? 'overflow_unknown' : scenario;
    assert.equal(phases[0], `renderer_${expected}`);
    assert.equal(record.failed,true);
    assert.equal(sent[0].code,'PRIVATE_FRAME_ERROR');
    assert.equal(getterCalls,0);
  }
});

test('container native poison reports the bounded origin without payload or exception data', async () => {
  const source = await readFile(new URL('../src/container-native.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('  let ready = false,');
  const end = source.indexOf('  // Deliberately retain the owned native and IPC;', start);
  assert.ok(start >= 0 && end > start);
  const program = `(async () => { ${source.slice(start, end)} })()`;
  const id = '43e56e8a-de3f-40fb-8cf3-7177d17d24f1';
  for (const scenario of ['native_frame_bytes','native_wire_error','output_queue_bytes','input_send_error','input_jsonl_bytes']) {
    let resume;
    const phases = [], listeners = new Map(), stdoutListeners = new Map();
    const input = new Promise(resolve => {resume=resolve;});
    const native = {pid:17,connected:true,on(type,callback){listeners.set(type,callback);},
      send(_encoded,callback){callback(Error('PRIVATE_VALUE_SENTINEL'));}};
    const processStub = {pid:2,stdin:{destroy(){}},stdout:{on:(type,callback)=>stdoutListeners.set(type,callback),write(){}}};
    const lines = {async *[Symbol.asyncIterator](){
      const value = await input;
      if (value instanceof Error) throw value;
      yield* value;
    }};
    const decodeWireValue = value => {
      if (value === 'bad') throw Error('PRIVATE_VALUE_SENTINEL');
      if (value === 'ready') return {v:1,type:'ready',profileId:id,generation:id,pid:17};
      if (value === 'request') return {v:1,type:'createView',viewId:id};
      return {v:1,type:'return'};
    };
    const promise = vm.runInNewContext(program,{native,process:processStub,lines,decodeWireValue,
      writeFirstCause:phase=>phases.push(phase),isSharedThreadAuthorityFrame:()=>false,
      profileId:id,generation:id,sharedEnabled:false,isContainerRecoveryQuery,UUID:/^[a-f0-9-]{36}$/,MAX:8*1024*1024,Buffer});
    if (scenario === 'native_frame_bytes') listeners.get('message')('x'.repeat(8*1024*1024+1));
    else if (scenario === 'native_wire_error') listeners.get('message')('bad');
    else {
      listeners.get('message')('ready');
      if (scenario === 'output_queue_bytes') {
        listeners.get('message')('x'.repeat(4_300_000));
        listeners.get('message')('x'.repeat(4_300_000));
      }
    }
    if (scenario === 'input_send_error') resume(['request']);
    else if (scenario === 'input_jsonl_bytes') resume(Object.assign(Error('PRIVATE_VALUE_SENTINEL'),{code:'JSONL_CHUNK_TOO_LARGE'}));
    else resume([]);
    await promise;
    assert.equal(phases[0], `container_${scenario}`);
    assert.equal(JSON.stringify(phases).includes('PRIVATE_VALUE_SENTINEL'), false);
  }
});

test('failed view creation only destroys its captured window and preserves another owned view', async () => {
  const source = await readFile(new URL('../src/native-bootstrap.cjs', import.meta.url), 'utf8');
  const match = source.match(/process\.on\("message", async encoded => \{[\s\S]*?\n    \}\);/);
  assert.ok(match);
  const id = '43e56e8a-de3f-40fb-8cf3-7177d17d24f1';
  for (const scenario of ['reused','missing','factory','bootstrap']) {
    let handler, destroyed = 0, foreignDestroyed = 0;
    const phases = [], sent = [], provisional = new Map(), ownedSenders = new WeakMap();
    const foreign = {webContents:{},isDestroyed:()=>false,destroy(){foreignDestroyed++;}};
    if (scenario === 'reused') ownedSenders.set(foreign.webContents,{viewId:'another'});
    const fresh = {webContents:{id:1,getURL:()=> 'app://owned',executeJavaScript:async()=>{throw Error('PRIVATE_VALUE_SENTINEL');}},
      isDestroyed:()=>false,destroy(){destroyed++;}};
    const sandbox = {process:{on(type,fn){assert.equal(type,'message');handler=fn;}},wire:{decodeWireValue:()=>({v:1,type:'createView',viewId:id})},
      UUID:/^[a-f0-9-]{36}$/,manager:null,creatingId:null,provisional,ownedSenders,bySender:new Map(),
      sharedThread:null,projectPicker:{retire(){}},VIEW_URL:'app://owned',BOOTSTRAP_SCRIPT:'fixture',firstCauseEnabled:true,
      registry:{create:async(_id,make)=>make(),destroy:async()=>{},forget(){}},scope:()=>({}),
      send:frame=>sent.push(frame),writeFirstCause:phase=>phases.push(phase)};
    sandbox.manager = {createPrimaryWindow(){
      if (scenario === 'factory' || scenario === 'bootstrap') {
        provisional.set(sandbox.creatingId,{viewId:id,window:fresh,senderId:1});
        if (scenario === 'factory') throw Error('PRIVATE_VALUE_SENTINEL');
        return Promise.resolve(fresh);
      }
      return Promise.resolve(foreign);
    }};
    vm.runInNewContext(match[0],sandbox);
    await handler('fixture');
    assert.equal(foreignDestroyed,0);
    assert.equal(destroyed,['factory','bootstrap'].includes(scenario)?1:0);
    assert.equal(sent.at(-1).code,'PRIVATE_CONTROL_ERROR');
    assert.equal(phases[0],{reused:'native_create_reused',missing:'native_create_missing',factory:'native_create_factory',bootstrap:'native_create_bootstrap'}[scenario]);
    assert.equal(JSON.stringify(phases).includes('PRIVATE_VALUE_SENTINEL'),false);
  }
});
