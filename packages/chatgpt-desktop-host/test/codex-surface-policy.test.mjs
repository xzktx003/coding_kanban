import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const { adaptCodexNativeChunk, assertCodexOnlyEnvironment } = require('../src/codex-surface-policy.cjs');
const original = 'c23f63f8ff156b2a92a81ee2870d80ab959ced6ce6232d6fe7e54bbefe11d333';
const readNative = () => readFile(process.env.CHATGPT_DESKTOP_TEST_NATIVE_CHUNK);
const opt = { skip: !process.env.CHATGPT_DESKTOP_TEST_NATIVE_CHUNK && 'Set CHATGPT_DESKTOP_TEST_NATIVE_CHUNK to the exact reviewed Linux member' };

test('rejects the upstream Work executor opt-in before launch', () => {
  assert.throws(() => assertCodexOnlyEnvironment({ CODEX_TPP_LOCAL_EXECUTOR_ENABLED: '1' }), { code: 'WORK_EXECUTOR_UNSUPPORTED' });
  assert.doesNotThrow(() => assertCodexOnlyEnvironment({}));
  assert.doesNotThrow(() => assertCodexOnlyEnvironment({ CODEX_TPP_LOCAL_EXECUTOR_ENABLED: '0' }));
});

test('native policy refuses an unrecognized chunk instead of applying a partial patch', () => {
  assert.throws(() => adaptCodexNativeChunk({ body: Buffer.from('unrecognized') }), { code: 'CODEX_POLICY_DIGEST_MISMATCH' });
});

test('the reviewed native chunk guards authorization, enable, direct start and restart', opt, async () => {
  const bytes = await readNative();
  const adapted = adaptCodexNativeChunk({ body: bytes });
  assert.equal(adapted.originalSha256, original);
  assert.equal(adapted.adaptedSha256, 'f8fa2affe8e3ddfc04e36548afb9a7fd9c2bf5c851959904f3231aedfd90815e');
  const source = adapted.body.toString('utf8');
  assert.doesNotThrow(() => new vm.Script(source));
  const guarded = 'throw Object.assign(new Error("Work executor is unsupported in this Codex surface"),{code:"WORK_EXECUTOR_UNSUPPORTED"});';
  let restored = source;
  for (const methodName of ['async clearRegistrations(){', 'setDisplayName(e){']) {
    const insertion = methodName + guarded;
    assert.equal(restored.split(insertion).length,2);
    restored = restored.replace(insertion,methodName);
  }
  for (const prefix of ['if(e?.enabled)', 'if(e)', 'if(this.enabled)', '']) {
    const insertion = prefix + guarded;
    const index = restored.indexOf(insertion);
    assert.notEqual(index, -1);
    assert.equal(restored.indexOf(insertion,index+insertion.length),-1);
    restored = restored.slice(0,index) + restored.slice(index+insertion.length);
  }
  assert.equal(restored, bytes.toString('utf8'));
  // Execute the real adapted method prefixes. A fall-through sentinel verifies
  // that the original false/disabled path remains reachable without side effects.
  const method = (start, end) => {
    const from = source.indexOf(start);
    assert.notEqual(from, -1);
    const until = source.indexOf(end, from);
    assert.notEqual(until, -1);
    return vm.runInNewContext(`({${source.slice(from, until)}return 'fallthrough';}})`);
  };
  const authorization = method('async setAuthorization(e){', 'let t,r=this.authorizationRevision;');
  await assert.rejects(authorization.setAuthorization({enabled:true}), {code:'WORK_EXECUTOR_UNSUPPORTED'});
  assert.equal(await authorization.setAuthorization({enabled:false}), 'fallthrough');
  const enabling = method('setEnabled(e,t="disabled"){', 'return e?this.start():');
  assert.throws(() => enabling.setEnabled(true), {code:'WORK_EXECUTOR_UNSUPPORTED'});
  assert.equal(enabling.setEnabled(false), 'fallthrough');
  const start = method('start(){throw', 'if(this.clearingRegistrations');
  assert.throws(() => start.start(), {code:'WORK_EXECUTOR_UNSUPPORTED'});
  const restart = method('restart(){if(this.enabled)', 'return this.disposed||');
  assert.throws(() => restart.restart.call({enabled:true}), {code:'WORK_EXECUTOR_UNSUPPORTED'});
  assert.equal(restart.restart.call({enabled:false}), 'fallthrough');
});


test('real adapted methods reject before authorization or worker access and preserve the false path', opt, async () => {
  const bytes = await readNative();
  const source = adaptCodexNativeChunk({body:bytes}).body.toString('utf8');
  const extract = (begin, next) => {
    const first = source.indexOf(begin);
    assert.notEqual(first,-1);
    const last = source.indexOf(next,first);
    assert.notEqual(last,-1);
    return vm.runInNewContext(`({${source.slice(first,last+1)}})`);
  };
  const auth = extract('async setAuthorization(e){', '}setEnabled(e,t="disabled"){');
  let reads = 0;
  const protectedReceiver = new Proxy({}, {get(){reads++;throw Error('must not inspect or start worker');}});
  await assert.rejects(auth.setAuthorization.call(protectedReceiver,{enabled:true}), {code:'WORK_EXECUTOR_UNSUPPORTED'});
  assert.equal(reads,0);
  const calls = [];
  const owner = {authenticatedPrincipal:{accountId:'a',userId:'u'},setEnabled(value){calls.push(value);}};
  await auth.setAuthorization.call(owner,{enabled:false,accountId:'a',userId:'u'});
  assert.deepEqual(calls,[false]);
  const enabled = extract('setEnabled(e,t="disabled"){', '}start(){throw');
  assert.throws(() => enabled.setEnabled.call(protectedReceiver,true),{code:'WORK_EXECUTOR_UNSUPPORTED'});
  assert.equal(reads,0);
  const falseOwner = {authorizationRevision:0,enabled:true,stop(reason){calls.push(reason);}};
  await enabled.setEnabled.call(falseOwner,false,'fixture');
  assert.equal(falseOwner.enabled,false);
  assert.equal(falseOwner.authorizationRevision,1);
  assert.equal(calls.at(-1),'fixture');
});

test('Work registration deletion and rename are unsupported before any state or network access', opt, async () => {
  const bytes = await readNative();
  const source = adaptCodexNativeChunk({body:bytes}).body.toString('utf8');
  const extract = (begin, next) => {
    const first = source.indexOf(begin), last = source.indexOf(next,first);
    assert.notEqual(first,-1); assert.notEqual(last,-1);
    return vm.runInNewContext(`({${source.slice(first,last+1)}})`);
  };
  let reads = 0;
  const inaccessible = new Proxy({}, {get(){reads++;throw Error('Work state and network must not be accessed');},set(){reads++;throw Error('Work state must not change');}});
  const clearing = extract('async clearRegistrations(){', '}setDisplayName(e){');
  await assert.rejects(clearing.clearRegistrations.call(inaccessible), {code:'WORK_EXECUTOR_UNSUPPORTED'});
  const rename = extract('setDisplayName(e){', '}getFeedbackLogEntries(){');
  assert.throws(() => rename.setDisplayName.call(inaccessible,'fixture'),{code:'WORK_EXECUTOR_UNSUPPORTED'});
  assert.equal(reads,0);
});
