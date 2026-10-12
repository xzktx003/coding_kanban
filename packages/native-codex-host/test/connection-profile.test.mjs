import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,lstat,rm,chmod,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {importConnectionProfile} from '../connection-profile.mjs';
import {buildChildEnv} from '../host.mjs';
async function fixture(config='model = "gpt-test"\nmodel_reasoning_effort = "high"\n') {
 const base=await mkdtemp(join(tmpdir(),'native-profile-'));const source=join(base,'source');const target=join(base,'target');
 await mkdir(source,{mode:0o700});await mkdir(target,{mode:0o700});
 const auth=JSON.stringify({auth_mode:'chatgpt',tokens:{access_token:'test-access-private',refresh_token:'test-refresh-private',id_token:'test-id-private'},last_refresh:'test'});
 await writeFile(join(source,'auth.json'),auth,{mode:0o600});await writeFile(join(source,'config.toml'),config,{mode:0o600});
 return{base,source,target,auth,options:{connectionProfileHome:source,codexHome:target,runtimeRoot:base,processHome:join(base,'process')}};
}
test('profile import is explicitly opt-in and never follows default HOME',async()=>{
 assert.deepEqual(await importConnectionProfile({codexHome:'/unused'},{CODEX_HOME:'/private/default'}),{enabled:false});
});
test('copies only authentication and selected model connection into private fresh home without modifying source',async()=>{
 const f=await fixture('model = "gpt-test"\nmodel_reasoning_effort = "high"\n[features]\nsecret_flag = true\n[mcp_servers.private]\nurl = "https://secret-server"\n');
 try{
  const result=await importConnectionProfile(f.options,{});assert.equal(result.enabled,true);assert.equal(result.authMode,'chatgpt');
  assert.equal(await readFile(join(f.target,'auth.json'),'utf8'),f.auth);assert.equal(await readFile(join(f.source,'auth.json'),'utf8'),f.auth);
  const config=await readFile(join(f.target,'config.toml'),'utf8');assert.match(config,/gpt-test/);assert.doesNotMatch(config,/features|mcp_servers|secret-server/);
  for(const name of ['auth.json','config.toml'])assert.equal((await lstat(join(f.target,name))).mode&0o777,0o600);
  assert.equal(JSON.stringify(result).includes('test-access-private'),false);
 }finally{await rm(f.base,{recursive:true,force:true})}
});
test('only selected provider env keys enter child process and unrelated secrets stay excluded',async()=>{
 const f=await fixture('model = "gpt-test"\nmodel_provider = "proxy"\n[model_providers.proxy]\nname = "proxy"\nbase_url = "http://127.0.0.1:12345/v1"\nwire_api = "responses"\nrequires_openai_auth = false\nenv_key = "TEST_PROVIDER_KEY"\n[model_providers.unused]\nname = "unused"\nenv_key = "OTHER_SECRET"\n');
 try{
  const inherited={TEST_PROVIDER_KEY:'test-api-private',OTHER_SECRET:'other-private'};
  await importConnectionProfile(f.options,inherited);const env=buildChildEnv(f.options,inherited);
  assert.equal(env.TEST_PROVIDER_KEY,'test-api-private');assert.equal(env.OTHER_SECRET,undefined);
  assert.doesNotMatch(await readFile(join(f.target,'config.toml'),'utf8'),/unused|OTHER_SECRET|test-api-private/);
 }finally{await rm(f.base,{recursive:true,force:true})}
});
test('missing selected provider environment fails before writing login files',async()=>{
 const f=await fixture('model_provider = "proxy"\n[model_providers.proxy]\nname = "proxy"\nenv_key = "TEST_PROVIDER_KEY"\n');
 try{await assert.rejects(importConnectionProfile(f.options,{}),/provider environment unavailable/);await assert.rejects(lstat(join(f.target,'auth.json')),{code:'ENOENT'});}finally{await rm(f.base,{recursive:true,force:true})}
});
test('rejects source symlinks and permissions, never overwrites an existing destination',async()=>{
 const f=await fixture();try{
  await chmod(join(f.source,'auth.json'),0o644);await assert.rejects(importConnectionProfile(f.options,{}),/private/);
  await chmod(join(f.source,'auth.json'),0o600);await writeFile(join(f.target,'auth.json'),'existing-private',{mode:0o600});
  await assert.rejects(importConnectionProfile(f.options,{}),/fresh/);assert.equal(await readFile(join(f.target,'auth.json'),'utf8'),'existing-private');
  const alias=join(f.base,'alias');await symlink(f.source,alias);await assert.rejects(importConnectionProfile({...f.options,connectionProfileHome:alias},{}),/symlink/);
 }finally{await rm(f.base,{recursive:true,force:true})}
});
test('parse failures never include credential content',async()=>{
 const f=await fixture();try{
  await writeFile(join(f.source,'auth.json'),'{"test-access-private":broken',{mode:0o600});
  await assert.rejects(importConnectionProfile(f.options,{}),error=>!error.message.includes('test-access-private')&&/invalid/.test(error.message));
 }finally{await rm(f.base,{recursive:true,force:true})}
});

test('rejects unrecognized authentication mode without publishing private values',async()=>{
 const f=await fixture();try{
  await writeFile(join(f.source,'auth.json'),JSON.stringify({auth_mode:{unexpected:'test-private-mode-sentinel'},tokens:{access_token:'test-access-private'}}),{mode:0o600});
  await assert.rejects(importConnectionProfile(f.options,{}),error=>/invalid/.test(error.message)&&!error.message.includes('test-private-mode-sentinel'));
  await assert.rejects(lstat(join(f.target,'auth.json')),{code:'ENOENT'});
 }finally{await rm(f.base,{recursive:true,force:true})}
});

for(const name of ['ZDOTDIR','BASH_ENV','ENV'])for(const field of ['env_key','env_http_headers'])test(`provider ${field} cannot override shell initialization via ${name}`,async()=>{
 const declaration=field==='env_key'?`env_key="${name}"`:`env_http_headers={Authorization="${name}"}`;
 const f=await fixture(`model_provider="proxy"\n[model_providers.proxy]\nname="proxy"\n${declaration}\n`);
 try{await assert.rejects(importConnectionProfile(f.options,{[name]:'/outside/private-source'}),/environment name invalid/);await assert.rejects(lstat(join(f.target,'auth.json')),{code:'ENOENT'});}
 finally{await rm(f.base,{recursive:true,force:true})}
});
