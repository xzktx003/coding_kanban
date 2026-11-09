import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { validateCoreSurfaceOptions, readCoreSurfaceManifest, createCoreSurfaceParent, verifyCoreSurfaceAsset } from './chatgpt-desktop-account-core-fixture.mjs';
import { createHash } from 'node:crypto';

const snapshot=process.env.CORE_DIAGNOSTIC_SNAPSHOT;
const profileId='11111111-1111-1111-1111-111111111111',generation='22222222-2222-2222-2222-222222222222';
test('fixture uses the frozen product surface factory and requires manifest version 2 plus four recipes',async()=>{
 assert.ok(snapshot,'provide CORE_DIAGNOSTIC_SNAPSHOT');
 const {createChatGptDesktopSurfaceOptions}=await import(pathToFileURL(join(snapshot,'apps/server/src/routes/chatgpt-desktop-surface-config.ts')).href);
 const options=validateCoreSurfaceOptions(createChatGptDesktopSurfaceOptions());assert.equal(options.assetAdapter.members.length,4);
 const original=Buffer.from('<html><head><script type="module" crossorigin src="./assets/index-aabbcc.js"></script></head><body><div id="root"></div></body></html>');
 const document=options.entryAdapter({body:original,profileId,generation});assert.deepEqual(readCoreSurfaceManifest(document.body,{profileId,generation}),{version:2,scopeMatches:true});
 assert.throws(()=>readCoreSurfaceManifest(Buffer.from(document.body.toString().replace('"version":2','"version":1')),{profileId,generation}));
 assert.throws(()=>validateCoreSurfaceOptions({entryAdapter:options.entryAdapter,assetAdapter:{members:options.assetAdapter.members.slice(0,1),adapt(){}}}));
});

test('fixture parent owns the same iframe and activates the real surface host',()=>{
 const result=createCoreSurfaceParent({profileId,generation});assert.match(result,/installDesktopSurfaceHost/);assert.match(result,/confirmActive\(true\)/);assert.match(result,/checkDocument\(\)/);assert.match(result,/id="desktop"/);assert.ok(result.includes(`/chatgpt-desktop/${profileId}/${generation}/webview/index.html`));
 assert.throws(()=>createCoreSurfaceParent({profileId:'invalid',generation}));
});

test('served surface recipe must match both original and adapted SHA',()=>{
 const body=Buffer.from('fixture'),adapted=createHash('sha256').update(body).digest('hex'),original='a'.repeat(64),input={body,status:200,originalHeader:original,etag:`"${adapted}"`,expected:{original,adapted}};
 assert.equal(verifyCoreSurfaceAsset(input),true);for(const delta of [{status:404},{originalHeader:'b'.repeat(64)},{etag:'"wrong"'},{body:Buffer.from('changed')}])assert.equal(verifyCoreSurfaceAsset({...input,...delta}),false);
});
