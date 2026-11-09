import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,chmod,rm,rename,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {validateCoreReadyGrant,waitForCoreReadyGrant,createCoreReadyGrantGate} from './chatgpt-desktop-account-ready-gate.mjs';
const identity={nonce:'a'.repeat(64),scopeHash:'b'.repeat(64),projectHash:'c'.repeat(64)};
const grant=x=>Buffer.from(JSON.stringify({version:1,...x})+'\n');
test('only the exact one-time fixed-scope grant is accepted without revealing its nonce',()=>{
 assert.equal(validateCoreReadyGrant(grant(identity),identity),true);
 for(const bad of [{...identity,nonce:'d'.repeat(64)},{...identity,scopeHash:'d'.repeat(64)},{...identity,projectHash:'d'.repeat(64)},{...identity,extra:true}])assert.equal(validateCoreReadyGrant(grant(bad),identity),false);
 assert.equal(validateCoreReadyGrant(Buffer.from('{"version":1,"version":1}'),identity),false);
});
test('malformed private grant reports the original JSON error without enabling send',()=>{
 let observed;assert.equal(validateCoreReadyGrant(Buffer.from('{bad'),identity,error=>{observed=error}),false);assert.equal(observed?.name,'SyntaxError');assert.ok(typeof observed?.message==='string');assert.ok(typeof observed?.stack==='string');
});
test('missing, invalid, symlink or insecure grant never permits a send',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'core-ready-gate-'));try{
  const path=join(dir,'send-grant.json');assert.equal(await waitForCoreReadyGrant({file:path,identity,timeoutMs:20,intervalMs:5}),false);
  await writeFile(path,grant(identity),{mode:0o644});assert.equal(await waitForCoreReadyGrant({file:path,identity,timeoutMs:20,intervalMs:5}),false);
  await chmod(path,0o600);assert.equal(await waitForCoreReadyGrant({file:path,identity,timeoutMs:20,intervalMs:5}),true);
  const gate=createCoreReadyGrantGate();const results=await Promise.all([gate.wait({file:path,identity,timeoutMs:20,intervalMs:5}),gate.wait({file:path,identity,timeoutMs:20,intervalMs:5})]);assert.deepEqual(results.sort(),[false,true]);assert.equal(await gate.wait({file:path,identity,timeoutMs:20,intervalMs:5}),false);
  await rename(path,path+'.real');await symlink(path+'.real',path);assert.equal(await waitForCoreReadyGrant({file:path,identity,timeoutMs:20,intervalMs:5}),false);
 }finally{await rm(dir,{recursive:true,force:true})}
});
