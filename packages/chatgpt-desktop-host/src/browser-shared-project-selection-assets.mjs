import {createHash} from 'node:crypto';
const ARCHIVE='bb88615052255e79b5977885f9a0cc212c268589587c79d4d3b7c4b46e881a95';
const MEMBER='webview/assets/location-menu-68c55551634b.js';
const ORIGINAL='33eefa8e389cdd6bd8a8e5ebdce4060c4bc8860b4da23d37c72d0365556ef6a6';
const ADAPTED='20a634c4eee893300ad287b428d8b25cff59896e69a52d986aa7fe08c4c5396a';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=code=>Object.assign(new Error('Shared project menu unavailable'),{code});
const IMPORT='import{useSharedProjectSelection as __kanbanUseSharedProjectSelection,SharedProjectExecutionItem as __kanbanSharedProjectExecutionItem,clearSharedProjectSelection as __kanbanClearSharedProjectSelection,SHARED_PROJECT_LABEL as __kanbanSharedProjectLabel}from"../__host/browser-shared-project-selection.mjs";\n';
// Shipped components have local B/M/fe bindings. Dedicated ESM aliases avoid
// both their TDZ and accidental use after initialization. Resolve the original
// React namespace when the component runs, after the original lazy bootstrap.
const scopePrefix=()=>`let __kanbanSharedScope=__kanbanSharedUseScope(__kanbanSharedComposerScope),__kanbanSharedProject=__kanbanSharedUseAtom(__kanbanSharedProjectAtom),__kanbanSharedRoots=__kanbanSharedUseFamily(__kanbanSharedProjectRoots,__kanbanSharedProject),__kanbanSharedReact=__kanbanSharedReactFactory(),__kanbanSharedState=__kanbanUseSharedProjectSelection(__kanbanSharedScope,__kanbanSharedReact,()=>{let e=__kanbanSharedScope.get(__kanbanSharedProjectAtom),t=__kanbanSharedScope.get(__kanbanSharedProjectRoots,e);return{projectKind:e?.type,projectId:e?.projectId,cwd:t[0]}});`;
const item=(jsx,React)=>`(0,${jsx}.jsx)(__kanbanSharedProjectExecutionItem,{scope:__kanbanSharedScope,React:${React},jsx:${jsx}.jsx,MenuItem:b.Item,RightIcon:i}),`;
const clear='onClick:e=>__kanbanClearSharedProjectSelection(__kanbanSharedScope,e),onKeyDown:e=>__kanbanClearSharedProjectSelection(__kanbanSharedScope,e),';
const replacements=[
 ['(0,bn.c)(67)', '(0,bn.c)(69)'],
 ['(0,sr.c)(83)', '(0,sr.c)(85)'],
 ['t[40]!==ve?(ye=', 't[40]!==ve||t[67]!==__kanbanSharedState||t[68]!==__kanbanSharedScope?(ye='],
 ['t[40]=ve,t[41]=ye', 't[40]=ve,t[67]=__kanbanSharedState,t[68]=__kanbanSharedScope,t[41]=ye'],
 ['t[39]=pe}else pe=t[39]', 't[83]=__kanbanSharedState,t[84]=__kanbanSharedScope,t[39]=pe}else pe=t[39]'],
 ['if(t[10]!==u||', 'if(t[83]!==__kanbanSharedState||t[84]!==__kanbanSharedScope||t[10]!==u||'],
 ['let Y;t[18]!==d', 'if(__kanbanSharedState.selected)G=__kanbanSharedState.available?__kanbanSharedProjectLabel:__kanbanSharedProjectLabel+` · 请重新选择`;let Y;t[18]!==d'],
 ['zlt as _e}from"./app-shared-601019a330d7.js"','zlt as _e,oTt as __kanbanSharedUseScope,dTt as __kanbanSharedUseAtom,lTt as __kanbanSharedUseFamily,pWt as __kanbanSharedReactFactory}from"./app-shared-601019a330d7.js"'],
 ['vbt as ft,zTt as pt}from"./app-initial-18b189e867e7.js"','vbt as ft,zTt as pt,w6n as __kanbanSharedComposerScope,_Vn as __kanbanSharedProjectRoots,tEt as __kanbanSharedProjectAtom}from"./app-initial-18b189e867e7.js"'],
 ['function _n(e){let t=',`function _n(e){${scopePrefix()}let t=`],
 ['function $n(e){let t=',`function $n(e){${scopePrefix()}let t=`],
 ['o==null?null:(0,Z.jsx)(b.Item,{LeftIcon:ne,',`${item('Z','__kanbanSharedReact')}o==null?null:(0,Z.jsx)(b.Item,{${clear}LeftIcon:ne,`],
 ['o!=null&&W.toLocaleLowerCase().includes(A.trim().toLocaleLowerCase())?',`${item('$','__kanbanSharedReact')}o!=null&&W.toLocaleLowerCase().includes(A.trim().toLocaleLowerCase())?`],
 ['(0,$.jsx)(b.Item,{leftIconAsset:ue,RightIcon:r.kind===`local`?i:void 0,disabled:s!=null,tooltipText:s,onSelect:o,children:W})',`(0,$.jsx)(b.Item,{${clear}leftIconAsset:ue,RightIcon:!__kanbanSharedState.selected&&r.kind===\`local\`?i:void 0,disabled:s!=null,tooltipText:s,onSelect:o,children:W})`],
 ['LeftIcon:ne,RightIcon:r.kind===`local`?i:void 0,disabled:s!=null', 'LeftIcon:ne,RightIcon:!__kanbanSharedState.selected&&r.kind===`local`?i:void 0,disabled:s!=null'],
 ['let he=D?null:ie,ge;', 'if(__kanbanSharedState.selected)G=__kanbanSharedState.available?__kanbanSharedProjectLabel:__kanbanSharedProjectLabel+` · 请重新选择`;let he=D?null:ie,ge;'],
];
export const SHARED_PROJECT_SELECTION_REFERENCE=Object.freeze({archiveSha256:ARCHIVE,member:MEMBER,originalSha256:ORIGINAL,adaptedSha256:ADAPTED});
export function createBrowserSharedProjectSelectionAssetAdapter(options){
 if(!options||Object.keys(options).join(',')!=='archiveSha256'||options.archiveSha256!==ARCHIVE)throw fail('SHARED_PROJECT_MENU_UNSUPPORTED_ARCHIVE');
 return Object.freeze({members:Object.freeze([MEMBER]),adapt({member,body}={}){
  if(member!==MEMBER)return null;
  if(!(body instanceof Uint8Array)||body.byteLength>64*1024)throw fail('SHARED_PROJECT_MENU_RESOURCE_LIMIT');
  const originalSha256=hash(body);if(originalSha256!==ORIGINAL)throw fail('SHARED_PROJECT_MENU_DIGEST_MISMATCH');
  let source=new TextDecoder('utf-8',{fatal:true}).decode(body);
  for(const [before,after] of replacements){let at=source.indexOf(before);if(at<0||at!==source.lastIndexOf(before))throw fail('SHARED_PROJECT_MENU_PATCH_MISMATCH');source=source.slice(0,at)+after+source.slice(at+before.length)}
  const adapted=Buffer.from(IMPORT+source);if(adapted.length>64*1024||hash(adapted)!==ADAPTED)throw fail('SHARED_PROJECT_MENU_PATCH_MISMATCH');
  return {body:adapted,originalSha256,adaptedSha256:ADAPTED};
 }});
}
