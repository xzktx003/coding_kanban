import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';
import { insertAccountAccessProbe, adaptAccountAccessProbe } from './chatgpt-desktop-account-access-probe.mjs';
const prefix='function MP(e,{codexLocalAccessStatus:t,currentMode:n,navigate:r,nextMode:i,openHome:a=!1,restoreNavigation:o=!0,startNewConversation:s}){let c=e.get(km);if(i===`codex`){';
const original=prefix+'switch(t){case `error`:return 7;default:return 8}}return 9}';
test('fixed probe preserves existing branch and exposes only whitelisted status and source',()=>{
 const reports=[],ctx={km:'km',qD:'qD',__fixtureCodexAccess:x=>reports.push(x)};
 const fn=vm.runInNewContext('('+insertAccountAccessProbe(original)+')',ctx);
 const state={get(atom){return atom==='qD'?{status:'error',source:'account-info',accountId:'synthetic'}:null}};
 assert.equal(fn(state,{codexLocalAccessStatus:'error',nextMode:'codex'}),7);assert.deepEqual(JSON.parse(JSON.stringify(reports)),[{status:'error',source:'account-info'}]);
 assert.equal(fn(state,{codexLocalAccessStatus:'loading',nextMode:'chatgpt'}),9);assert.equal(reports.length,1);
});
test('unknown sources, wrong hashes and ambiguous markers fail closed',()=>{
 assert.throws(()=>adaptAccountAccessProbe(Buffer.from(original)));assert.throws(()=>insertAccountAccessProbe('none'));assert.throws(()=>insertAccountAccessProbe(original+original));
 const reports=[],ctx={km:'km',qD:'qD',__fixtureCodexAccess:x=>reports.push(x)};const fn=vm.runInNewContext('('+insertAccountAccessProbe(original)+')',ctx);
 fn({get(atom){return atom==='qD'?{status:'error',source:'private-sensitive'}:null}},{codexLocalAccessStatus:'error',nextMode:'codex'});
 assert.deepEqual(JSON.parse(JSON.stringify(reports)),[{status:'error',source:null}]);
});

test('observer accepts only exact fixed enums from the owned renderer frame',async()=>{
 const {normalizeAccountAccessObservation}=await import('./chatgpt-desktop-account-access-probe.mjs');
 assert.deepEqual(normalizeAccountAccessObservation({status:'error',source:'workspace-settings'},true),{status:'error',source:'workspace-settings'});
 assert.deepEqual(normalizeAccountAccessObservation({status:'allowed',source:null},true),{status:'allowed',source:null});
 for(const value of [{status:'error',source:'private'},{status:'allowed',source:'account-info'},{status:'error',source:'account-info',secret:'value'},null])assert.equal(normalizeAccountAccessObservation(value,true),null);
 assert.equal(normalizeAccountAccessObservation({status:'allowed',source:null},false),null);
});
