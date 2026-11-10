import {test} from 'node:test';
import assert from 'node:assert/strict';
import {apply} from '../index.js';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
test('disabled bundle has no services, state, listeners or network side effects',()=>{
 const ctx=new Proxy({},{get(){throw Error('No service should be accessed')}});
 assert.doesNotThrow(()=>apply(ctx,{enabled:false}));
});
test('private config must be owner private and validates enabled recipient before state creation',()=>{
 const dir=mkdtempSync(join(tmpdir(),'harness-feishu-config-'));const file=join(dir,'config.json');
 try{
  writeFileSync(file,JSON.stringify({enabled:false}),{mode:0o600});assert.doesNotThrow(()=>apply({}, {configFile:file}));
  writeFileSync(file,JSON.stringify({enabled:true,allowedUserId:'invalid'}));assert.throws(()=>apply({}, {configFile:file}),/allowedUserId/);
 }finally{rmSync(dir,{recursive:true,force:true})}
});
