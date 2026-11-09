// Optional, per-document source partition. Pages and opaque tokens come from
// the owned host; they are never inferred from DOM attributes or thread IDs.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TOKEN=/^[A-Za-z0-9_-]{43}$/;
const MAX_BYTES=16*1024*1024, MAX_NODES=200000, MAX_DEPTH=64, LIMIT=50;
const unavailable=()=>Object.assign(new Error('Shared directory unavailable'),{code:'SHARED_DIRECTORY_UNAVAILABLE'});
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const valueOf=(value,key)=>{const d=Object.getOwnPropertyDescriptor(value,key);if(!d||!Object.hasOwn(d,'value')||!d.enumerable)throw unavailable();return d.value};

// Host responses are JSON data. Copy the complete tree without invoking getters
// so later mutation cannot replace the record associated with a source token.
function copyJson(input,budget,depth=0,seen=new WeakSet()){
  if(++budget.nodes>MAX_NODES||depth>MAX_DEPTH)throw unavailable();
  if(input===null||typeof input==='boolean'||(typeof input==='number'&&Number.isFinite(input))){budget.bytes+=String(input).length;return input}
  if(typeof input==='string'){budget.bytes+=new TextEncoder().encode(JSON.stringify(input)).byteLength;if(budget.bytes>MAX_BYTES)throw unavailable();return input}
  if(typeof input!=='object'||seen.has(input))throw unavailable();
  seen.add(input);let copy;
  if(Array.isArray(input)){
    const length=Object.getOwnPropertyDescriptor(input,'length')?.value;
    if(!Number.isSafeInteger(length)||length<0||Reflect.ownKeys(input).length!==length+1)throw unavailable();
    copy=[];budget.bytes+=2+Math.max(0,length-1);
    for(let i=0;i<length;i++)copy.push(copyJson(valueOf(input,String(i)),budget,depth+1,seen));
  }else{
    const prototype=Object.getPrototypeOf(input);if(prototype!==Object.prototype&&prototype!==null)throw unavailable();
    copy={};const keys=Reflect.ownKeys(input);budget.bytes+=2+Math.max(0,keys.length-1);
    for(const key of keys){if(typeof key!=='string')throw unavailable();budget.bytes+=new TextEncoder().encode(JSON.stringify(key)).byteLength+1;
      Object.defineProperty(copy,key,{value:copyJson(valueOf(input,key),budget,depth+1,seen),enumerable:true,writable:false,configurable:false})}
  }
  if(budget.bytes>MAX_BYTES)throw unavailable();
  return Object.freeze(copy);
}

/** loadPage({cursor,limit}) is a server-owned IPC adapter returning {page,tokens}.
 * navigateSource must route to a separately owned source store; omit it until
 * that contract exists. The host must revalidate every token at final dispatch.
 */
export function createBrowserSharedThreadDirectory({window:win,scopeLease,navigation,loadPage,navigateSource,isSourceReady=()=>true,subscribeSource=()=>()=>{},onFailure=()=>{}}={}){
  if(!win?.document?.documentElement||typeof win.MutationObserver!=='function'||!scopeLease||
     typeof scopeLease.getSnapshot!=='function'||typeof scopeLease.isCurrent!=='function'||typeof scopeLease.subscribe!=='function'||
     typeof navigation?.activateExplicit!=='function'||typeof loadPage!=='function'||
     (navigateSource!==undefined&&typeof navigateSource!=='function')||typeof isSourceReady!=='function'||typeof subscribeSource!=='function'||typeof onFailure!=='function')throw unavailable();
  const doc=win.document, root=doc.createElement('section');
  root.setAttribute('data-kanban-shared-directory','');
  root.setAttribute('aria-label','Codex CLI');
  const style=doc.createElement('style');
  style.textContent='[data-kanban-shared-directory]{padding:8px 10px;color:inherit}[data-kanban-shared-heading]{font-size:12px;opacity:.62;padding:4px 6px}[data-kanban-shared-thread],[data-kanban-shared-more]{display:block;width:100%;border:0;border-radius:8px;background:transparent;color:inherit;text-align:left;font:inherit;padding:7px 8px;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}[data-kanban-shared-thread]:hover,[data-kanban-shared-more]:hover{background:rgba(128,128,128,.12)}[data-kanban-shared-thread]:disabled{opacity:.5;cursor:default}[data-kanban-shared-message]{font-size:12px;opacity:.7;padding:6px 8px}';
  let disposed=false,scope=null,epoch=0,pending=false,bytes=0,items=[],pages=[],nextCursor=null,status='idle',unsubscribe,unsubscribeSource,started=false;
  const retired=new WeakSet(),isToken=value=>value!==null&&(typeof value==='object'||typeof value==='function');
  const current=expected=>{try{return !disposed&&isToken(expected)&&!retired.has(expected)&&scope===expected&&scopeLease.getSnapshot()===expected&&scopeLease.isCurrent(expected)===true}catch{return false}};
  const sourceReady=()=>{try{return isSourceReady()===true}catch{return false}};
  function snapshot(){return Object.freeze({pages:Object.freeze(pages.slice()),nextCursor,status})}
  function notifyFailure(code){try{onFailure({code})}catch{}}
  function render(){
    root.replaceChildren(style);const title=doc.createElement('div');title.setAttribute('data-kanban-shared-heading','');title.textContent='Codex CLI';root.append(title);
    for(const item of items){
      const button=doc.createElement('button');button.type='button';button.setAttribute('data-kanban-shared-thread','');button.disabled=!navigateSource||!current(scope)||!sourceReady();
      const name=typeof item.row.name==='string'&&item.row.name.trim()?item.row.name:typeof item.row.preview==='string'&&item.row.preview.trim()?item.row.preview:item.threadId;
      button.textContent=name;if(typeof item.row.cwd==='string')button.title=item.row.cwd;
      button.addEventListener('click',event=>{
        if(event.isTrusted!==true||!navigateSource||!current(item.scope)||!items.includes(item)||!sourceReady())return;
        const isCurrent=()=>current(item.scope)&&items.includes(item)&&sourceReady();
        try {Promise.resolve(navigation.activateExplicit({event,hostId:'kanban-shared-cli',threadId:item.threadId,sourceToken:item.token,isCurrent,
          navigate:(threadId,hostId,options)=>navigateSource({threadId,hostId,sourceToken:item.token,options})})).catch(()=>notifyFailure('SHARED_DIRECTORY_NAVIGATION_FAILED'))}catch{notifyFailure('SHARED_DIRECTORY_NAVIGATION_FAILED')}
      });root.append(button);
    }
    if(status==='loading'||status==='error'||((!navigateSource||!sourceReady())&&items.length)){
      const message=doc.createElement('div');message.setAttribute('data-kanban-shared-message','');
      message.textContent=status==='loading'?'正在加载…':status==='error'?'无法加载 CLI 会话': '暂时无法打开 CLI 会话';root.append(message);
    }
    if(nextCursor!==null&&!pending&&status!=='error'){
      const more=doc.createElement('button');more.type='button';more.setAttribute('data-kanban-shared-more','');more.textContent='显示更多';
      more.addEventListener('click',()=>{void load(nextCursor)});root.append(more);
    }
    if(status==='error'&&!pending){const retry=doc.createElement('button');retry.type='button';retry.setAttribute('data-kanban-shared-retry','');retry.textContent='重试';retry.addEventListener('click',()=>{void load(pages.length?nextCursor:null)});root.append(retry)}
  }
  function validMount(element){return element?.isConnected&&!element.closest('[data-app-shell-active-page="false"]')}
  function reconcile(){
    if(disposed)return;
    if(!current(scope)){root.remove();return}
    const sections=[...doc.querySelectorAll('[data-app-action-sidebar-section][data-app-action-sidebar-section-heading="Projects"]')].filter(element=>validMount(element)&&element.closest('[data-app-action-sidebar-scroll]'));
    const scrolls=[...doc.querySelectorAll('[data-app-action-sidebar-scroll]')].filter(validMount);
    let parent=null,anchor=null;
    if(sections.length===1){anchor=sections[0];parent=anchor.parentElement}
    else if(sections.length===0&&scrolls.length===1)parent=scrolls[0];
    if(!parent){root.remove();return}
    if(anchor){if(root.parentElement!==parent||anchor.nextElementSibling!==root)parent.insertBefore(root,anchor.nextSibling)}
    else if(root.parentElement!==parent)parent.append(root);
    if(current(scope)&&!started){started=true;void load(null)}
  }
  function invalid(){notifyFailure('SHARED_DIRECTORY_INVALID_PAGE');status='error';render()}
  async function load(cursor){
    const captured=scope,capturedEpoch=epoch;
    if(!current(captured)||pending||(cursor!==null&&(typeof cursor!=='string'||cursor.length>4096)))return false;
    pending=true;status='loading';render();
    try{
      const response=await loadPage({cursor,limit:LIMIT});
      if(!current(captured)||capturedEpoch!==epoch)return false;
      if(!object(response))throw unavailable();
      const budget={nodes:0,bytes},page=copyJson(valueOf(response,'page'),budget),tokens=copyJson(valueOf(response,'tokens'),budget);
      if(!object(page)||!Array.isArray(page.data)||page.data.length>LIMIT||!Array.isArray(tokens)||tokens.length!==page.data.length||
         !(page.nextCursor===null||(typeof page.nextCursor==='string'&&page.nextCursor.length<=4096&&!/[\x00-\x1f\x7f]/.test(page.nextCursor))))throw unavailable();
      const byId=new Map();
      for(const token of tokens){if(!object(token)||Object.keys(token).sort().join(',')!=='threadId,token'||!UUID.test(token.threadId??'')||typeof token.token!=='string'||!TOKEN.test(token.token)||byId.has(token.threadId))throw unavailable();byId.set(token.threadId,token.token)}
      const incoming=[];for(const row of page.data){if(!object(row)||!UUID.test(row.id??'')||!byId.has(row.id))throw unavailable();incoming.push(Object.freeze({row,threadId:row.id,token:byId.get(row.id),scope:captured}));byId.delete(row.id)}
      if(byId.size)throw unavailable();
      bytes=budget.bytes;pages=[...pages,Object.freeze({page,tokens})];items=[...items,...incoming];nextCursor=page.nextCursor;status='ready';return true;
    }catch{if(current(captured)&&capturedEpoch===epoch)invalid();return false}
    finally{if(capturedEpoch===epoch){pending=false;if(current(captured))render()}}
  }
  function onScope(){
    epoch++;if(isToken(scope))retired.add(scope);scope=null;pending=false;bytes=0;pages=[];items=[];nextCursor=null;status='idle';started=false;
    try{const candidate=scopeLease.getSnapshot();if(isToken(candidate)&&!retired.has(candidate)&&scopeLease.isCurrent(candidate)===true)scope=candidate}catch{}
    render();reconcile();
  }
  const observer=new win.MutationObserver(reconcile);
  observer.observe(doc.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['data-app-shell-active-page','data-app-action-sidebar-section-heading']});
  try{unsubscribe=scopeLease.subscribe(onScope);unsubscribeSource=subscribeSource(()=>{if(!disposed)render()});if(typeof unsubscribe!=='function'||typeof unsubscribeSource!=='function')throw unavailable();onScope()}catch{observer.disconnect();root.remove();try{unsubscribe?.()}catch{}throw unavailable()}
  return Object.freeze({getSnapshot:snapshot,dispose(){if(disposed)return;disposed=true;epoch++;observer.disconnect();root.remove();items=[];pages=[];try{unsubscribe()}catch{}try{unsubscribeSource()}catch{}}});
}
