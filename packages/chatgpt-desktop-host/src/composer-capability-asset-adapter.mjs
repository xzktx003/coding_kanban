import { createHash } from "node:crypto";

// Narrow version-gated adaptation; the packaged ASAR and original bytes stay
// untouched. The synthetic browser entry and footer lease must be installed by
// the document host before these resources may be enabled in a product route.
export const COMPOSER_CAPABILITY_REFERENCE = Object.freeze({
  archiveSha256:
    "bb88615052255e79b5977885f9a0cc212c268589587c79d4d3b7c4b46e881a95",
  threadMember: "webview/assets/local-conversation-thread-2f594f841b07.js",
  threadSha256:
    "af8e8ab2e97566d25d69249ef8adf5a86d0bf0bbf4c306e4fbc50c80e8837263",
  composerMember: "webview/assets/codex-composer-adapter-d1ca952732ea.js",
  composerSha256:
    "01cd3bef59262b3aa010e6be80e2b120aaf428711d4cb6712556768aa67eeac2",
});
export const SHARED_COMPOSER_CONTENT_REFERENCE = Object.freeze({member:"webview/assets/composer-content-b926d24ef280.js",sha256:"cf56f37714e14488239f4eb715b845067e75f8c2e98851c768c4110d3eb6fd08",originalBytes:541834,maxAdaptedBytes:550026,adaptedSha256:"f79841a01e44aa8077bf17d4cdd2049f5ec97e222b47d117532bbcf4f65fc40f"});
const SHARED_PROJECT_IMPORT = 'import{useSharedProjectSelection as __kanbanUseSharedProjectSelection,resolveSharedProjectHost as __kanbanResolveSharedProjectHost,resolveSharedProjectRenderHost as __kanbanResolveSharedProjectRenderHost}from"../__host/browser-shared-project-selection.mjs";\n';
const MAX_RESOURCE_BYTES = 512 * 1024;
const PROP = "__chatgptDesktopComposerScope";
const REGISTRAR = "__chatgptDesktopComposerRegistrar";
const IMPORT = `import{OriginalComposerRegistrar as ${REGISTRAR}}from"../__host/browser-composer-capability-entry.mjs";\n`;
const FAILURE = (code) =>
  Object.assign(new Error("Desktop composer asset unsupported"), { code });
const hash = (value) => createHash("sha256").update(value).digest("hex");

function replaceUnique(source, marker, replacement) {
  const at = source.indexOf(marker);
  if (at < 0 || at !== source.lastIndexOf(marker))
    throw FAILURE("COMPOSER_CAPABILITY_PATCH_MISMATCH");
  return source.slice(0, at) + replacement + source.slice(at + marker.length);
}

export function createComposerCapabilityAssetAdapter(options) {
  if (
    !options ||
    typeof options !== "object" ||
    options.archiveSha256 !== COMPOSER_CAPABILITY_REFERENCE.archiveSha256 || (Object.hasOwn(options,"sharedSubmission")&&typeof options.sharedSubmission!=="boolean")
  )
    throw FAILURE("COMPOSER_CAPABILITY_UNSUPPORTED_ARCHIVE");
  const members = Object.freeze([
    COMPOSER_CAPABILITY_REFERENCE.threadMember,
    COMPOSER_CAPABILITY_REFERENCE.composerMember,
    ...(options.sharedSubmission===true?[SHARED_COMPOSER_CONTENT_REFERENCE.member]:[]),
  ]);
  return Object.freeze({
    members,
    adapt({ member, body } = {}) {
      if (typeof member !== "string")
        throw FAILURE("COMPOSER_CAPABILITY_INVALID_MEMBER");
      if (!members.includes(member)) return null;
      if (!(body instanceof Uint8Array))
        throw FAILURE("COMPOSER_CAPABILITY_INVALID_BODY");
      const limit=member===SHARED_COMPOSER_CONTENT_REFERENCE.member?SHARED_COMPOSER_CONTENT_REFERENCE.maxAdaptedBytes:MAX_RESOURCE_BYTES;
      if (body.byteLength > limit)
        throw FAILURE("COMPOSER_CAPABILITY_RESOURCE_LIMIT");
      const original = Buffer.from(body),
        originalSha256 = hash(original);
      const expected = member===SHARED_COMPOSER_CONTENT_REFERENCE.member?SHARED_COMPOSER_CONTENT_REFERENCE.sha256:
        member === COMPOSER_CAPABILITY_REFERENCE.threadMember
          ? COMPOSER_CAPABILITY_REFERENCE.threadSha256
          : COMPOSER_CAPABILITY_REFERENCE.composerSha256;
      if (originalSha256 !== expected)
        throw FAILURE("COMPOSER_CAPABILITY_DIGEST_MISMATCH");
      let source;
      try {
        source = new TextDecoder("utf-8", { fatal: true }).decode(original);
      } catch {
        throw FAILURE("COMPOSER_CAPABILITY_PATCH_MISMATCH");
      }
      if (source.includes(PROP) || source.includes(REGISTRAR))
        throw FAILURE("COMPOSER_CAPABILITY_PATCH_MISMATCH");
      if (member === SHARED_COMPOSER_CONTENT_REFERENCE.member) {
        if(original.byteLength!==SHARED_COMPOSER_CONTENT_REFERENCE.originalBytes)throw FAILURE("COMPOSER_CAPABILITY_DIGEST_MISMATCH");
        source=replaceUnique(source,"Ri=Fi&&(Dt!=null||Mi)?Ai:ut,zi=cs(Ri)","Ri=(__kanbanUseSharedProjectSelection(G,nJ),__kanbanResolveSharedProjectRenderHost(G,Fi&&(Dt!=null||Mi)?Ai:ut,K)),zi=cs(Ri)");
        source=replaceUnique(source,"P=a?.hostId??O,{context:I","P=__kanbanResolveSharedProjectHost(e,a?.hostId??O,c?.type===`local`?c.localConversationId:null),{context:I");
        source=replaceUnique(source,"Ui=Dt!=null||an?yt.hostId:Ri,Wi=","Ui=__kanbanResolveSharedProjectRenderHost(G,Dt!=null||an?yt.hostId:Ri,K),Wi=");
        source=replaceUnique(source,"Wi=Zt===`worktree`?Ui:Ri,Gi=cs(Wi)","Wi=__kanbanResolveSharedProjectRenderHost(G,Zt===`worktree`?Ui:Ri,K),Gi=cs(Wi)");
        source=replaceUnique(source,"u.onDeferred?.();return","u.onDeferred?.();globalThis.__kanbanSharedThreadNavigation.markComposerDeferred({conversationId:wl(s),clientThreadId:s.value.kind===`local`?s.value.clientThreadId:s.value.kind===`new`?s.value.browserTabMentionConversationId:null});return");
        source=replaceUnique(source,"let bf=x(yf);Qf(Y,!Be&&!Jn&&!df);","let bf=globalThis.__kanbanSharedThreadNavigation.wrapComposerSubmit(x(yf),()=>({hostId:__kanbanResolveSharedProjectHost(G,Wi,K),conversationId:K??null}),fd);Qf(Y,!Be&&!Jn&&!df);");
        source=replaceUnique(source,"se=async(t,n,r,i,a,s,l,d,f)=>{let g=","se=async(t,n,r,i,a,s,l,d,f)=>{let __kanbanSubmitHost=__kanbanResolveSharedProjectHost(e,i?.hostId??O,c?.type===`local`?c.localConversationId:null);if(__kanbanSubmitHost===\"kanban-shared-cli\"){let __kanbanSubmit=await globalThis.__kanbanSharedThreadNavigation.consumeComposerSubmit({hostId:__kanbanSubmitHost,conversationId:c?.type===`local`?c.localConversationId:null,clientThreadId:o});t={...t,...__kanbanSubmit}}let g=");
        source=replaceUnique(source,"w=tD({...b,mode:oe.mode},{allowProjectlessWithoutOutputDirectory:H.cloudThreadPrototype===!0});w.clientUserMessageId=s","w=tD({...b,mode:oe.mode},{allowProjectlessWithoutOutputDirectory:H.cloudThreadPrototype===!0});if(oe.threadCreationHostId===\"kanban-shared-cli\"){Object.assign(w,await globalThis.__kanbanSharedThreadNavigation.prepareComposerCreate({hostId:oe.threadCreationHostId,clientThreadId:o,attemptId:H.__kanbanSharedCreateAttempt,projectId:f?.projectId,cwd:m}));let {__kanbanSharedCreateAttempt:__kanbanDiscardAttempt,__kanbanSharedCreateClient:__kanbanDiscardClient,...__kanbanCleanContext}=_;_=__kanbanCleanContext;T?.()}w.clientUserMessageId=s");
        source=SHARED_PROJECT_IMPORT+source;
      } else if (member === COMPOSER_CAPABILITY_REFERENCE.threadMember) {
        source = replaceUnique(
          source,
          "function Ej(e){let t=(0,Dj.c)(58),",
          "function Ej(e){let t=(0,Dj.c)(63),",
        );
        source = replaceUnique(
          source,
          "(0,kj.jsx)(Mv,{...se})",
          `(0,kj.jsx)(Mv,{...se,${PROP}:(t[58]!==s||t[59]!==o||t[60]!==M||t[61]!==b?(t[58]=s,t[59]=o,t[60]=M,t[61]=b,t[62]={hostId:s,conversationId:o,clientThreadId:M,isMain:b}):t[62])})`,
        );
      } else {
        source = replaceUnique(
          source,
          "function wr(e){let t=(0,Or.c)(256),",
          "function wr(e){let t=(0,Or.c)(264),",
        );
        // Xt is the original new-chat client identity that wr itself passes
        // to its first submit; W and U are the original host and conversation.
        // Do not infer an identity from DOM or create one for a missing Xt.
        source = replaceUnique(
          source,
          "let Ai;t[237]!==Ie",
          "let __chatgptDesktopHomeScope;t[257]!==W||t[258]!==Xt||t[259]!==R.value.kind||t[260]!==R.value.entrypoint||t[261]!==U?(__chatgptDesktopHomeScope=R.value.kind===`new`&&R.value.entrypoint===`home`&&U===null&&typeof Xt===`string`&&Xt.length>0&&typeof W===`string`&&W.length>0?{hostId:W,conversationId:null,clientThreadId:Xt,isMain:!0}:null,t[257]=W,t[258]=Xt,t[259]=R.value.kind,t[260]=R.value.entrypoint,t[261]=U,t[262]=__chatgptDesktopHomeScope):__chatgptDesktopHomeScope=t[262];let Ai;t[237]!==Ie",
        );
        source = replaceUnique(
          source,
          "t[247]!==yi||t[248]!==ki?(",
          `t[247]!==yi||t[248]!==ki||t[256]!==e.${PROP}||t[263]!==__chatgptDesktopHomeScope?(`,
        );
        source = replaceUnique(
          source,
          "children:[hi,gi,_i,vi,yi,ki]",
          `children:[hi,gi,_i,vi,yi,ki,(0,$.jsx)(${REGISTRAR},{scope:e.${PROP},homeScope:__chatgptDesktopHomeScope})]`,
        );
        source = replaceUnique(
          source,
          "t[248]=ki,t[249]=Ai",
          `t[248]=ki,t[256]=e.${PROP},t[263]=__chatgptDesktopHomeScope,t[249]=Ai`,
        );
        if(options.sharedSubmission===true){
          source=replaceUnique(source,"W=A(zt,U)","W=(__kanbanUseSharedProjectSelection(R,kr),__kanbanResolveSharedProjectRenderHost(R,A(zt,U),U))");
          // Pending project composers have no homeScope. The same Registrar
          // must receive W, and its compiled memo must depend on that host.
          source=replaceUnique(source,"(0,Or.c)(264)","(0,Or.c)(265)");
          source=replaceUnique(source,"t[263]!==__chatgptDesktopHomeScope?(","t[263]!==__chatgptDesktopHomeScope||t[264]!==W?(");
          source=replaceUnique(source,"t[263]=__chatgptDesktopHomeScope,t[249]=Ai","t[263]=__chatgptDesktopHomeScope,t[264]=W,t[249]=Ai");
          source=replaceUnique(source,`scope:e.${PROP},homeScope:`,`scope:e.${PROP}?.conversationId===null?{...e.${PROP},hostId:W}:e.${PROP},homeScope:`);
          source=SHARED_PROJECT_IMPORT+source;
        }
        source = IMPORT + source;
      }
      const adapted = Buffer.from(source, "utf8");
      if (adapted.byteLength > limit)
        throw FAILURE("COMPOSER_CAPABILITY_RESOURCE_LIMIT");
      if(member===SHARED_COMPOSER_CONTENT_REFERENCE.member&&hash(adapted)!==SHARED_COMPOSER_CONTENT_REFERENCE.adaptedSha256)throw FAILURE("COMPOSER_CAPABILITY_PATCH_MISMATCH");
      return { body: adapted, originalSha256, adaptedSha256: hash(adapted) };
    },
  });
}
