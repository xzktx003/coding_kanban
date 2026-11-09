import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {createHash} from 'node:crypto';
import {installPrivateAccessProbeRoute} from './chatgpt-desktop-account-access-route.mjs';
const require=createRequire(new URL('../../apps/server/package.json',import.meta.url)),Fastify=require('fastify');
const hash=x=>createHash('sha256').update(x).digest('hex');const profile={id:'00000000-0000-0000-0000-000000000001',generation:'00000000-0000-0000-0000-000000000002',pid:1,startTicks:'1',uid:1,controlSocketPath:'/s',macAsarPath:'/m',macAsarSha256:'a'.repeat(64),linuxAsarPath:'/l',linuxAsarSha256:'b'.repeat(64)};
const member='webview/assets/app-primary-75d53eef2374.js';const path=`/chatgpt-desktop/${profile.id}/${profile.generation}/${member}`;
test('diagnostic response has exact path, identity, bounded output and original/adapted hashes',async()=>{
 const app=Fastify(),source=Buffer.from('original'),output=Buffer.from('instrumented');let release=0,close=0;let current=profile;
 app.addHook('onRequest',async(req,reply)=>{if(req.headers.authorization!=='test')return reply.code(401).send('denied')});
 installPrivateAccessProbeRoute(app,{profileId:profile.id,generation:profile.generation,profileService:{readValidated:async()=>({status:{state:'ready'},profile:current})},openArchive:async()=>({acquireAsset:async()=>({body:source,release(){release++}}),close:async()=>{close++}}),adapt:body=>({body:output,originalSha256:hash(body),adaptedSha256:hash(output)})});
 app.get('*',async()=>({fallback:true}));
 const noAuth=await app.inject({method:'GET',url:path});assert.equal(noAuth.statusCode,401);
 const ok=await app.inject({method:'GET',url:path,headers:{authorization:'test'}});assert.equal(ok.statusCode,200);assert.equal(ok.body,'instrumented');assert.equal(ok.headers['x-original-content-sha256'],hash(source));assert.equal(ok.headers.etag,'"'+hash(output)+'"');assert.equal(release,1);assert.equal(close,1);
 const other=await app.inject({method:'GET',url:path.replace('app-primary','other'),headers:{authorization:'test'}});assert.deepEqual(other.json(),{fallback:true});
 current={...profile,generation:'00000000-0000-0000-0000-000000000003'};const bad=await app.inject({method:'GET',url:path,headers:{authorization:'test'}});assert.equal(bad.statusCode,503);await app.close();
});

test('diagnostic response is revoked if profile changes before send',async()=>{
 const app=Fastify(),body=Buffer.from('source');let reads=0;
 installPrivateAccessProbeRoute(app,{profileId:profile.id,generation:profile.generation,profileService:{readValidated:async()=>({status:{state:'ready'},profile:++reads>=3?{...profile,pid:2}:profile})},openArchive:async()=>({acquireAsset:async()=>({body,release(){}}),close:async()=>{}}),adapt:b=>({body:b,originalSha256:hash(b),adaptedSha256:hash(b)})});
 app.get('*',async()=>({fallback:true}));const response=await app.inject({url:path});assert.equal(response.statusCode,503);assert.notEqual(response.body,'source');assert.equal(response.headers['etag'],undefined);await app.close();
});

test('entry diagnostic only serves its fixed host member under same profile guard',async()=>{
 const {installPrivateEntryProbeRoute}=await import('./chatgpt-desktop-account-access-route.mjs');const app=Fastify(),source=Buffer.from('entry'),output=Buffer.from('entry-probed');
 installPrivateEntryProbeRoute(app,{profileId:profile.id,generation:profile.generation,profileService:{readValidated:async()=>({status:{state:'ready'},profile})},readSource:async()=>source,adapt:b=>({body:output,originalSha256:hash(b),adaptedSha256:hash(output)})});app.get('*',async()=>({fallback:true}));
 const target=`/chatgpt-desktop/${profile.id}/${profile.generation}/webview/__host/browser-entry.mjs`,ok=await app.inject({url:target});assert.equal(ok.statusCode,200);assert.equal(ok.body,'entry-probed');assert.equal(ok.headers['x-original-content-sha256'],hash(source));
 const other=await app.inject({url:target.replace('browser-entry','browser-bridge')});assert.deepEqual(other.json(),{fallback:true});await app.close();
});
