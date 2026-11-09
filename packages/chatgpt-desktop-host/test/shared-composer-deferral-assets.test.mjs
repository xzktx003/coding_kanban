import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openWebviewArchive} from '../src/assets.mjs';
import {createComposerCapabilityAssetAdapter,COMPOSER_CAPABILITY_REFERENCE as REF,SHARED_COMPOSER_CONTENT_REFERENCE as CONTENT} from '../src/composer-capability-asset-adapter.mjs';

const archivePath=process.env.CHATGPT_DESKTOP_TEST_MAC_ASAR;
test('pinned HG marks only its original deferred branch and leaves options and original callback intact',{skip:!archivePath&&'Requires pinned original Mac archive'},async()=>{
 const archive=await openWebviewArchive({asarPath:archivePath,sha256:REF.archiveSha256});
 try{
  const asset=await archive.acquireAsset(CONTENT.member);
  try{
   const adapted=createComposerCapabilityAssetAdapter({archiveSha256:REF.archiveSha256,sharedSubmission:true}).adapt({member:CONTENT.member,body:asset.body}).body.toString('utf8');
   const start=adapted.indexOf('u.onDeferred?.();'),end=adapted.indexOf(';return',start);
   assert.ok(start>=0&&end>start);
   const branch=adapted.slice(start,end+7);
   assert.equal(branch.split('markComposerDeferred').length-1,1);
   // Execute only this known branch with local stand-ins, not the application.
   const run=new Function('u','s','wl','globalThis',branch);
   for(const kind of ['new','local']){
    const client='client-new-thread:'+randomUUID(),thread=kind==='new'?null:randomUUID(),events=[];
    const options={onDeferred:()=>events.push('original'),untouched:{value:true}},originalOptions=options;
    const scope={value:{kind,clientThreadId:client,browserTabMentionConversationId:client}};
    run(options,scope,actual=>{assert.equal(actual,scope);return thread},{__kanbanSharedThreadNavigation:{markComposerDeferred:identity=>events.push(identity)}});
    assert.equal(options,originalOptions);assert.deepEqual(events,['original',{conversationId:thread,clientThreadId:client}]);
   }
   const failure=new Error('original deferred callback failed');let marked=false;
   assert.throws(()=>run({onDeferred:()=>{throw failure}},{value:{}},()=>null,{__kanbanSharedThreadNavigation:{markComposerDeferred:()=>{marked=true}}}),error=>error===failure);
   assert.equal(marked,false);
  }finally{asset.release()}
 }finally{await archive.close()}
});
