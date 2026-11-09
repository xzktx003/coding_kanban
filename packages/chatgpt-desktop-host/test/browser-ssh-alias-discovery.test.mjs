import assert from 'node:assert/strict';
import test from 'node:test';
import {discoverServerSshAliases} from '../src/browser-ssh-alias-discovery.mjs';

const manifest={version:4,profileId:'00000000-0000-4000-8000-000000000000',generation:'00000000-0000-4000-8000-000000000001'};
const url=`/api/chatgpt-desktop/${manifest.profileId}/${manifest.generation}/ssh/discover`;
function setup(t,fetch,raw=JSON.stringify(manifest)) {
  const previous=globalThis.window;globalThis.window={document:{getElementById(id){assert.equal(id,'chatgpt-host-manifest');return {textContent:raw}}},fetch};
  t.after(()=>{if(previous===undefined)delete globalThis.window;else globalThis.window=previous;});
}
test('the original query issues only the fixed current-profile read and retains unknown aliases',async t=>{
  let calls=0;setup(t,async(path,options)=>{calls++;assert.equal(path,url);assert.deepEqual(options,{method:'GET',credentials:'same-origin',cache:'no-store',redirect:'error',headers:{accept:'application/json'}});return new Response(JSON.stringify({sshAliases:['fixture','主机','odd:name']}));});
  assert.deepEqual(await discoverServerSshAliases(),{sshAliases:['fixture','主机','odd:name']});assert.equal(calls,1);
  await assert.rejects(discoverServerSshAliases({host:'arbitrary'}),{code:'SSH_ALIAS_DISCOVERY_UNAVAILABLE'});assert.equal(calls,1);
});
test('invalid manifest never reads a caller-selected path or profile',async t=>{
  setup(t,()=>{throw Error('must not fetch')},JSON.stringify({...manifest,profileId:'../elsewhere'}));
  await assert.rejects(discoverServerSshAliases(),{code:'SSH_ALIAS_DISCOVERY_UNAVAILABLE'});
});
test('unavailable, oversized or malformed responses are not converted to an empty successful list',async t=>{
  let response;setup(t,async()=>response);
  for(const value of [new Response('{}',{status:503}),new Response('x'.repeat(65537)),new Response('{bad'),new Response(JSON.stringify({sshAliases:[1]})),new Response(JSON.stringify({sshAliases:[],sshHost:'invented'}))]){
    response=value;await assert.rejects(discoverServerSshAliases(),{code:'SSH_ALIAS_DISCOVERY_UNAVAILABLE'});
  }
});
