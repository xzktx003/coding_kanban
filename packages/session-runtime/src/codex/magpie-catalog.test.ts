import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readMagpieCatalog} from './magpie-catalog.js';
test('discovers configured loopback Magpie models and deduplicates bounded IDs',async()=>{
 const calls:string[]=[];
 const result=await readMagpieCatalog({model_providers:{magpie:{base_url:'http://127.0.0.1:3425/v1'}}},async(url,options)=>{
  calls.push(String(url));assert.equal(options?.redirect,'error');assert.equal(options?.headers,undefined);
  return new Response(JSON.stringify({data:[{id:'houmo/h200'},{id:'auto/sol'},{id:'houmo/h200'}]}));
 });
 assert.deepEqual(result,{provider:'magpie',models:[{id:'houmo/h200'},{id:'auto/sol'}]});assert.deepEqual(calls,['http://127.0.0.1:3425/v1/models']);
});
test('never forwards credentials or follows external endpoints; bounds responses',async()=>{
 for(const base_url of ['https://remote.example/v1','http://user:secret@127.0.0.1:3425/v1','http://127.0.0.1:3425/v1?key=SECRET'])
  await assert.rejects(readMagpieCatalog({model_providers:{magpie:{base_url}}},async()=>{throw Error('must not fetch')}));
 await assert.rejects(readMagpieCatalog({model_providers:{magpie:{base_url:'http://127.0.0.1:3425/v1'}}},async()=>new Response('x'.repeat(1024*1024+1))));
});
test('gateway compatibility route reads local config and returns no source config',async(t)=>{
 const {default:Fastify}=await import('fastify');const {mkdtemp,writeFile,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const {registerLocalMagpieCatalog}=await import('./magpie-catalog.js');
 const home=await mkdtemp(join(tmpdir(),'magpie-catalog-'));t.after(()=>rm(home,{recursive:true,force:true}));
 await writeFile(join(home,'config.toml'),'model="private-model"\n');
 const app=Fastify();registerLocalMagpieCatalog(app,{CODEX_HOME:home});t.after(()=>app.close());
 const r=await app.inject({method:'GET',url:'/api/session/model-catalog/magpie'});
 assert.equal(r.statusCode,200);assert.deepEqual(r.json(),{provider:'magpie',models:[]});assert.equal(r.headers['cache-control'],'no-store');assert.ok(!r.body.includes('private-model'));
});
