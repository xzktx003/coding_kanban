// An explicit local UI choice only; native account, project and turn authority
// remain in the host. No SDK host, project record, task or UUID is manufactured.
export const SHARED_PROJECT_HOST_ID = 'kanban-shared-cli';
export const SHARED_PROJECT_LABEL = 'Codex CLI（共享）';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CLIENT_PREFIX='client-new-thread:';
const EMPTY=Object.freeze({enabled:false,selected:false,available:false,hostId:null,canSelect:false});
const noop=()=>{};
const EMPTY_STORE=Object.freeze({subscribe:()=>noop,getSnapshot:()=>EMPTY,select:()=>false,clear:()=>false});
const fail=()=>Object.assign(new Error('Shared project selection unavailable'),{code:'SHARED_PROJECT_SELECTION_UNAVAILABLE'});
let active=null;
const selectedOwners=new WeakMap();
const originalClient=value=>typeof value==='string'&&value.startsWith(CLIENT_PREFIX)&&UUID.test(value.slice(CLIENT_PREFIX.length));
// Original hooks wrap the same composer node independently. Only the original
// node identity joins those wrappers; client strings never join composers.
function originalNode(scope){try{const node=scope?.node;return node!==null&&typeof node==='object'&&!Array.isArray(node)?node:null}catch{return null}}
function client(scope){
 const value=scope?.value;
 if(value?.kind==='new'&&value.entrypoint==='home'&&originalClient(value.browserTabMentionConversationId))return value.browserTabMentionConversationId;
 // The pinned ABt(client-local-thread) -> kBt(null, main, null, clientId)
 // contract is a pending project composer, not a started local conversation.
 if(value?.kind!=='local'||value.placement!=='main'||value.entrypoint!==undefined||value.conversationId!==null||value.routeConversationId!==null||!originalClient(value.clientThreadId)||value.browserTabMentionConversationId!==value.clientThreadId)return null;
 if(value.persistentWorkspace!=null&&(value.persistentWorkspace.allowExecutionSelection!==true||value.persistentWorkspace.session?.conversationId!==null))return null;
 return value.clientThreadId;
}
function trusted(event){const value=event?.nativeEvent??event;return value?.isTrusted===true&&(value.type==='click'||value.type==='keydown'&&(value.key==='Enter'||value.key===' '))}
function project(reader){
 try{const value=reader?.();if(value?.projectKind!=='local'||typeof value.projectId!=='string'||value.projectId.length<1||value.projectId.length>4096||/[\x00-\x1f\x7f]/.test(value.projectId)||typeof value.cwd!=='string'||!value.cwd.startsWith('/')||value.cwd==='/'||value.cwd.length>4096||/[\x00-\x1f\x7f]/.test(value.cwd))return null;return `${value.projectId}\0${value.cwd}`;}catch{return null}
}

export function createBrowserSharedProjectSelection({window:win,scopeLease,isSourceReady,subscribeSource}={}){
 if(!win||!scopeLease||['getSnapshot','isCurrent','subscribe'].some(key=>typeof scopeLease[key]!=='function')||typeof isSourceReady!=='function'||typeof subscribeSource!=='function'||active)throw fail();
 const records=new WeakMap(),mounted=new Set();let disposed=false,epoch=0,releaseScope,releaseSource;
 const available=()=>{try{const token=scopeLease.getSnapshot();return !disposed&&token!==null&&scopeLease.isCurrent(token)===true&&isSourceReady()===true?token:null}catch{return null}};
 function observe(scope,readProject){
  const node=originalNode(scope);if(node===null)return EMPTY_STORE;
  let record=records.get(node);
  if(!record){
   let selected=false,approval=null,snapshot=EMPTY,reader=null,currentScope=scope;const listeners=new Set();
   const currentClient=()=>originalNode(currentScope)===node?client(currentScope):null;
   const publish=()=>{for(const fn of [...listeners])fn()};
   function getSnapshot(){
    const id=currentClient(),token=available(),target=project(reader),enabled=id!==null;
    const valid=enabled&&selected&&approval?.client===id&&approval.target===target&&target!==null&&approval.token===token&&approval.epoch===epoch&&token!==null;
    if(selected&&!valid)approval=null;
    const next={enabled,selected:enabled&&selected,available:enabled&&target!==null&&token!==null&&(!selected||valid),hostId:enabled&&selected?SHARED_PROJECT_HOST_ID:null,canSelect:enabled&&target!==null&&token!==null};
    if(Object.keys(next).some(key=>next[key]!==snapshot[key]))snapshot=Object.freeze(next);
    return snapshot;
   }
   record={
    getSnapshot,
    subscribe(fn){if(typeof fn!=='function')throw fail();if(!listeners.size){if(mounted.size>=16)throw fail();mounted.add(record)}listeners.add(fn);return()=>{listeners.delete(fn);if(!listeners.size)mounted.delete(record)}},
    select(event){const id=currentClient(),token=available(),target=project(reader);if(!trusted(event)||!id||!token||target===null)return false;selected=true;selectedOwners.set(node,controller);approval={client:id,target,token,epoch};publish();return true},
    clear(event){if(!trusted(event)||!available())return false;selected=false;selectedOwners.delete(node);approval=null;publish();return true},
    resolve(originalHostId,conversationId){if(conversationId!==null&&conversationId!==undefined||!selected)return originalHostId;if(!getSnapshot().available)throw fail();return SHARED_PROJECT_HOST_ID},
    update(scope,value){const previous=currentClient();currentScope=scope;if(currentClient()!==previous)approval=null;if(typeof value==='function')reader=value},
    invalidate(){approval=null;publish()},
   };
   records.set(node,record);
  }
  record.update(scope,readProject);return record;
 }
 function invalidate(){epoch++;for(const record of [...mounted])record.invalidate()}
 const controller=Object.freeze({observe,resolve:(scope,original,conversationId)=>observe(scope).resolve?.(original,conversationId)??original,dispose(){if(disposed)return;disposed=true;invalidate();releaseScope?.();releaseSource?.();mounted.clear();if(active===controller)active=null}});
 active=controller;
 try{releaseScope=scopeLease.subscribe(invalidate);releaseSource=subscribeSource(invalidate);if(typeof releaseScope!=='function'||typeof releaseSource!=='function')throw fail()}catch(error){controller.dispose();throw error}
 return controller;
}

// Hooks execute in the original ComposerScope and original React renderer.
// The readProject callback reads the original AppHost project/root atoms.
export function useSharedProjectSelection(scope,React,readProject){
 const store=active?.observe(scope,readProject)??EMPTY_STORE;
 return React.useSyncExternalStore(store.subscribe,store.getSnapshot,store.getSnapshot);
}
// Rendering retains the explicit host intent even after its local approval is
// revoked. The menu can show "reselect" and recover without an error boundary.
// This getter never grants submission: use resolveSharedProjectHost at the
// trusted submit and final request boundaries, and the host still revalidates.
export function resolveSharedProjectRenderHost(scope,originalHostId,conversationId){
 if(conversationId!==null&&conversationId!==undefined)return originalHostId;
 const node=originalNode(scope);return node!==null&&selectedOwners.has(node)?SHARED_PROJECT_HOST_ID:originalHostId;
}
export function resolveSharedProjectHost(scope,originalHostId,conversationId){if(conversationId!==null&&conversationId!==undefined)return originalHostId;const node=originalNode(scope);if(node===null||selectedOwners.has(node)&&selectedOwners.get(node)!==active)throw fail();return active?.resolve(scope,originalHostId,conversationId)??originalHostId}
export function clearSharedProjectSelection(scope,event){return active?.observe(scope).clear(event)??false}
export function SharedProjectExecutionItem({scope,React,jsx,MenuItem,RightIcon}){
 const value=useSharedProjectSelection(scope,React);if(!value.enabled)return null;
 const store=active?.observe(scope)??EMPTY_STORE;
 return jsx(MenuItem,{disabled:!value.canSelect,RightIcon:value.selected?RightIcon:undefined,
  onSelect:noop,onClick:event=>store.select(event),onKeyDown:event=>store.select(event),
  children:value.selected&&!value.available?`${SHARED_PROJECT_LABEL} · 请重新选择`:SHARED_PROJECT_LABEL});
}
