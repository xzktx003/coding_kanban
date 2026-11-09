import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';
import {insertAccountEntryProbe,adaptAccountEntryProbe,normalizeAccountEntryObservation} from './chatgpt-desktop-account-entry-probe.mjs';
const callback="onFailure: () => fail('ENTRY_BRIDGE_FAILED')",marker="} catch (error) {\n          const code = ['ENTRY_FRAME_LIMIT', 'ENTRY_INVALID_FRAME', 'ENTRY_INVALID_BOOTSTRAP', 'ENTRY_CONNECTION_LOST', 'ENTRY_BRIDGE_FAILED'].includes(error?.code)";
test('instrumentation is exact, preserves failure and exposes only fixed enums',()=>{
 const source=`function test(fail){return {${callback}}} function second(){try{throw {code:'ENTRY_INVALID_FRAME'}${marker} ? error.code : 'ENTRY_BRIDGE_FAILED';return code}}`;
 const reports=[],fails=[],ctx={__fixtureEntryStatus:x=>reports.push(x)};vm.runInNewContext(insertAccountEntryProbe(source),ctx);ctx.test(code=>fails.push(code)).onFailure({code:'BRIDGE_OUTCOME_UNKNOWN',secret:'never'});assert.equal(ctx.second(),'ENTRY_INVALID_FRAME');
 assert.deepEqual(JSON.parse(JSON.stringify(reports)),[{stage:'bridge-callback',code:'BRIDGE_OUTCOME_UNKNOWN'},{stage:'message-catch',code:'ENTRY_INVALID_FRAME'}]);assert.deepEqual(fails,['ENTRY_BRIDGE_FAILED']);
});
test('unknown input/duplicate anchors and untrusted events are rejected',()=>{
 assert.throws(()=>adaptAccountEntryProbe(Buffer.from('unexpected')));assert.throws(()=>insertAccountEntryProbe('bad'));assert.throws(()=>insertAccountEntryProbe(callback+callback+marker));
 assert.deepEqual(normalizeAccountEntryObservation({stage:'bridge-callback',code:'BRIDGE_OUTCOME_UNKNOWN'},true),{stage:'bridge-callback',code:'BRIDGE_OUTCOME_UNKNOWN'});
 for(const value of [{stage:'other',code:'ENTRY_INVALID_FRAME'},{stage:'bridge-callback',code:'private'},{stage:'bridge-callback',code:'other',secret:'never'}])assert.equal(normalizeAccountEntryObservation(value,true),null);
 assert.equal(normalizeAccountEntryObservation({stage:'bridge-callback',code:'other'},false),null);
});
