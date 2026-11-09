import test from 'node:test';
import assert from 'node:assert/strict';
import {createDesktopFooterOwnership} from '../src/desktop-layout-core.mjs';
import {createDesktopSplitPaneRegistry} from '../src/desktop-split-pane-core.mjs';

const local=Object.freeze({hostId:'local',conversationId:null,clientThreadId:'owned-client-new-thread'});
const shared=Object.freeze({...local,hostId:'kanban-shared-cli'});
const created=Object.freeze({...shared,conversationId:'01a1b931-fa01-7661-9e61-9c5b86e73af3'});
function context(scope,text='owned unsent draft\nsecond line'){
 return{thread:{clientThreadId:scope.clientThreadId},route:{routeKind:scope.conversationId===null?'client-local-thread':'local-thread',hostId:scope.hostId,clientThreadId:scope.clientThreadId,conversationId:scope.conversationId},composer:{kind:'local',clientThreadId:scope.clientThreadId,conversationId:scope.conversationId,draft:{text,attachments:[{id:'owned-attachment-reference'}]}}};
}
function fixture(t){
 let id=0;const footer=createDesktopFooterOwnership(),claims=[];
 const registry=createDesktopSplitPaneRegistry({footerOwnership:footer,idFactory:()=>`owned-pane-${++id}`});
 t.after(()=>{for(const claim of claims)claim.close();registry.dispose();});
 function claim(owner){
  const selected=registry.getSnapshot().selected;assert.equal(selected?.owner,owner);
  const slot=footer.createSlot(),offSlot=slot.commit(selected.paneId),offTarget=footer.commitTarget({paneId:selected.paneId,tabKey:selected.tabKey,...selected.scope},selected.layoutRevision);
  const value={slot,token:slot.lease.getSnapshot(),close(){offTarget();offSlot();}};claims.push(value);return value;
 }
 return{registry,claim};
}
const errorCode=code=>error=>error?.code===code;

test('one presentation source moves a draft host, revokes old owners and activates its real created target',t=>{
 const f=fixture(t),source={},oldOwner={},newOwner={},createdOwner={};
 const original=context(local),key=f.registry.remember(local,original,{source});
 const releaseOld=f.registry.commit(oldOwner,key,local),oldClaim=f.claim(oldOwner);
 const next=context(shared),migrated=f.registry.remember(shared,next,{source});
 assert.equal(migrated,key,'host choice must retain the original tab key');
 assert.equal(f.registry.getSnapshot().entries.length,1,'one native source cannot become two same-client drafts');
 assert.equal(f.registry.getSnapshot().selected,null,'the old input owner does not acquire the new host');
 assert.equal(oldClaim.slot.lease.isCurrent(oldClaim.token,local),false);
 const retained=f.registry.getSnapshot().entries[0];
 assert.deepEqual(retained.scope,shared);assert.equal(retained.context.route.hostId,shared.hostId);
 assert.deepEqual(retained.context.composer.draft,original.composer.draft);
 assert.notEqual(retained.context,next);assert.equal(Object.isFrozen(retained.context.composer.draft),true);
 next.composer.draft.text='changed provider object after capture';
 assert.equal(retained.context.composer.draft.text,original.composer.draft.text);
 assert.throws(()=>f.registry.commit(oldOwner,key,local),errorCode('SPLIT_PANE_INVALID_SCOPE'));
 oldClaim.close();
 const releaseNew=f.registry.commit(newOwner,key,shared),newClaim=f.claim(newOwner);
 assert.equal(newClaim.slot.lease.isCurrent(newClaim.token,shared),true);
 releaseOld();assert.equal(f.registry.getSnapshot().selected.owner,newOwner);
 assert.equal(newClaim.slot.lease.isCurrent(newClaim.token,shared),true,'late old-host cleanup cannot revoke a new committed owner');
 const promoted=f.registry.remember(created,context(created),{focus:false});
 assert.equal(promoted,key);assert.equal(f.registry.getSnapshot().entries.length,1);assert.equal(f.registry.getSnapshot().selected,null);
 assert.equal(newClaim.slot.lease.isCurrent(newClaim.token,shared),false);
 assert.throws(()=>f.registry.commit(newOwner,key,shared),errorCode('SPLIT_PANE_STALE_SCOPE'));
 newClaim.close();
 const releaseCreated=f.registry.commit(createdOwner,key,created),createdClaim=f.claim(createdOwner);
 assert.equal(createdClaim.slot.lease.isCurrent(createdClaim.token,created),true);
 releaseNew();assert.equal(f.registry.getSnapshot().selected.owner,createdOwner);
 assert.throws(()=>f.registry.remember(local,context(local),{source}),errorCode('SPLIT_PANE_STALE_SCOPE'));
 assert.throws(()=>f.registry.remember(shared,context(shared),{source}),errorCode('SPLIT_PANE_STALE_SCOPE'));
 assert.equal(createdClaim.slot.lease.isCurrent(createdClaim.token,created),true,'late null drafts cannot reclaim the promoted entry');
 assert.equal(f.registry.close(key),true);
 assert.throws(()=>f.registry.attach(source,local),errorCode('SPLIT_PANE_STALE_SCOPE'));
 assert.equal(f.registry.getSnapshot().entries.length,0);releaseCreated();
});

for(const kind of ['different object','missing source','proxy source','clone source'])test(`same client across hosts stays ambiguous with ${kind}`,t=>{
 const f=fixture(t),source={presentation:'owned'},first=f.registry.remember(local,context(local),{source});
 const other=kind==='missing source'?{}:{source:kind==='proxy source'?new Proxy(source,{}):kind==='clone source'?{...source}:{}};
 const second=f.registry.remember(shared,context(shared),other);
 assert.notEqual(second,first);assert.equal(f.registry.getSnapshot().entries.length,2);
 f.registry.commit({},second,shared);
 assert.throws(()=>f.registry.remember(created,context(created)),errorCode('SPLIT_PANE_AMBIGUOUS_CLIENT'));
 assert.equal(f.registry.getSnapshot().selected,null);assert.equal(f.registry.getSnapshot().entries.length,2);
 assert.equal(f.registry.getSnapshot().entries.every(entry=>entry.scope.conversationId===null),true);
});

test('a source associated with more than one draft cannot choose which host entry to migrate',t=>{
 const f=fixture(t),source={},other={};
 const first=f.registry.remember(local,context(local),{source});
 const second=f.registry.remember(shared,context(shared),{source:other});
 assert.notEqual(first,second);
 // Public committed owners are retained as draft sources. Reusing this owner
 // across the two existing drafts must not turn identity equality into authority.
 f.registry.commit(source,second,shared);const before=f.claim(source);
 const third={...shared,hostId:'another-owned-host'};
 assert.throws(()=>f.registry.remember(third,context(third),{source}),errorCode('SPLIT_PANE_AMBIGUOUS_CLIENT'));
 assert.equal(f.registry.getSnapshot().entries.length,2);assert.equal(f.registry.getSnapshot().selected,null);
 assert.equal(before.slot.lease.isCurrent(before.token,shared),false);
});

test('host migration still validates the full detached capture without getters or implicit host repair',t=>{
 const f=fixture(t),source={},owner={},key=f.registry.remember(local,context(local),{source});
 f.registry.commit(owner,key,local);const old=f.claim(owner);
 assert.throws(()=>f.registry.remember(shared,context(local),{source}),errorCode('SPLIT_PANE_INVALID_CONTEXT'));
 assert.deepEqual(f.registry.getSnapshot().entries[0].scope,local);
 assert.equal(old.slot.lease.isCurrent(old.token,local),false);assert.equal(f.registry.getSnapshot().selected,null);
 let reads=0;const accessor=context(shared);
 Object.defineProperty(accessor.route,'hostId',{enumerable:true,get(){reads++;return shared.hostId;}});
 assert.throws(()=>f.registry.remember(shared,accessor,{source}),errorCode('SPLIT_PANE_INVALID_CONTEXT'));
 assert.equal(reads,0);assert.equal(f.registry.getSnapshot().entries.length,1);
 const oversized=context(shared,'x'.repeat(65536));
 assert.throws(()=>f.registry.remember(shared,oversized,{source}),errorCode('SPLIT_PANE_INVALID_CONTEXT'));
 assert.deepEqual(f.registry.getSnapshot().entries[0].scope,local);
 assert.equal(f.registry.remember(shared,undefined,{source,discardContext:true}),key);
 assert.equal(f.registry.getSnapshot().entries[0].context,undefined,'an uncaptured new host must not borrow the former host capture');
 const differentClient={...shared,clientThreadId:'another-owned-client'};
 assert.notEqual(f.registry.remember(differentClient,context(differentClient),{source}),key);
 assert.equal(f.registry.getSnapshot().entries.length,2);
});
