import { createHash } from "node:crypto";

// Server-owned opt-in adapter for exactly the audited Mac archive.  Enabling
// these resources requires installing the matching per-document navigation
// bridge and the native/daemon authorization gates first.
const ARCHIVE =
  "bb88615052255e79b5977885f9a0cc212c268589587c79d4d3b7c4b46e881a95";
const MAX = 512 * 1024;
const MAIN = "webview/assets/app-main-efa2926f393b.js";
const PROVIDER = "webview/assets/initialize-app-host-services-a3479e215e83.js";
const RESUME =
  "webview/assets/use-resume-conversation-if-needed-2ee16336bda8.js";
const APPROVAL = "webview/assets/pending-request-item-panel-cef204561ca3.js";
export const SHARED_THREAD_NAVIGATION_REFERENCE = Object.freeze({
  archiveSha256: ARCHIVE,
  members: Object.freeze({
    [MAIN]: Object.freeze({
      originalSha256:
        "3e108c15c5e59d4b07884ddaa016cd11d4ab375f2f3f4a562b554b34e75aefa7",
      adaptedSha256:
        "f603911564258950a1fbf1655486344866d130d5456454c37d27b6c55339af46",
    }),
    [PROVIDER]: Object.freeze({
      originalSha256:
        "3212418ea362dbd6ca22a4f02319511dbeee19a3482ae45f40923d9a9ce856eb",
      adaptedSha256:
        "042ffb31e3e56766c356e23b45f99ae712a12a6b25aa53b4fc98d54543ebe1cd",
    }),
    [RESUME]: Object.freeze({
      originalSha256:
        "d97622754eaea94e8d8c1824d383c73ef6e2c397cd6b2c1e97c117a46d14c6bb",
      adaptedSha256:
        "9690c27d1a093bc499d3dd8c0b373da7d34baa7b96ae14c82e9fdb3b5bc743f7",
    }),
    [APPROVAL]: Object.freeze({
      originalSha256:
        "2a3129cf4465d9d024e07f7d83b7d0c6a6e0cec913babcb68efb523d5434dbd1",
      adaptedSha256:
        "6ac55a070fcef9ee6c9f83c2651402e60cbe90f9d49a1d9b232213fb3bdb8008",
    }),
  }),
});
const fail = (code) =>
  Object.assign(new Error("Shared thread navigation unavailable"), { code });
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const patches = Object.freeze({
  [APPROVAL]: Object.freeze([
    [
      "H=e=>{let{hasFeedback:t,onSuccess:n}=e;V({hasFeedback:t!==void 0&&t,onSuccess:n,recordManualApproval:!1,selectedOptionId:null,sendResponse:e=>a.type===`exec`?Dt(c,i).replyWithCommandExecutionApprovalDecision(r,e,`decline`):Dt(c,i).replyWithFileChangeApprovalDecision(r,e,`decline`)})}",
      "H=e=>{let{hasFeedback:t,onSuccess:n}=e;if(i!==\"kanban-shared-cli\")return V({hasFeedback:t!==void 0&&t,onSuccess:n,recordManualApproval:!1,selectedOptionId:null,sendResponse:e=>a.type===`exec`?Dt(c,i).replyWithCommandExecutionApprovalDecision(r,e,`decline`):Dt(c,i).replyWithFileChangeApprovalDecision(r,e,`decline`)});let __kanbanApproval=globalThis.__kanbanSharedThreadNavigation.beginApproval({hostId:i,threadId:r,requestId:S,itemId:a.callId});if(!__kanbanApproval)return;V({hasFeedback:t!==void 0&&t,onSuccess:n,recordManualApproval:!1,selectedOptionId:null,sendResponse:e=>__kanbanApproval.send(e,`decline`)})}",
    ],
    [
      "q=e=>{let{selectedOptionId:t,hasFeedback:n,onSuccess:o}=e;V({hasFeedback:n!==void 0&&n,onSuccess:o,recordManualApproval:!0,selectedOptionId:t,sendResponse:e=>a.type===`exec`?Dt(c,i).replyWithCommandExecutionApprovalDecision(r,e,$r(t,I,N)):Dt(c,i).replyWithFileChangeApprovalDecision(r,e,ei(t))})}",
      "q=e=>{let{selectedOptionId:t,hasFeedback:n,onSuccess:o}=e;if(i!==\"kanban-shared-cli\")return V({hasFeedback:n!==void 0&&n,onSuccess:o,recordManualApproval:!0,selectedOptionId:t,sendResponse:e=>a.type===`exec`?Dt(c,i).replyWithCommandExecutionApprovalDecision(r,e,$r(t,I,N)):Dt(c,i).replyWithFileChangeApprovalDecision(r,e,ei(t))});let __kanbanApproval=globalThis.__kanbanSharedThreadNavigation.beginApproval({hostId:i,threadId:r,requestId:S,itemId:a.callId});if(!__kanbanApproval)return;V({hasFeedback:n!==void 0&&n,onSuccess:o,recordManualApproval:!0,selectedOptionId:t,sendResponse:e=>__kanbanApproval.send(e,a.type===`exec`?$r(t,I,N):ei(t))})}",
    ],
  ]),
  [MAIN]: Object.freeze([
    [
      "(0,u.createRoot)(d)",
      "globalThis.__kanbanSharedThreadNavigation.createRoot((0,u.createRoot),d)",
    ],
  ]),
  [PROVIDER]: Object.freeze([
    [
      "let e=dm(t);return t.set(Ld,()=>e),v.setAppStateCapture(()=>BE(t)),()=>{v.setAppStateCapture(null),t.set(Ld,null),e.dispose()}",
      "let e=dm(t),__kanbanOffSharedHosts;try{t.set(Ld,()=>e),__kanbanOffSharedHosts=globalThis.__kanbanSharedThreadNavigation.bindAppServerHosts(t,za)}catch(__kanbanHostError){t.set(Ld,null),e.dispose();throw __kanbanHostError}return v.setAppStateCapture(()=>BE(t)),()=>{__kanbanOffSharedHosts(),v.setAppStateCapture(null),t.set(Ld,null),e.dispose()}",
    ],
    [
      "navigateToLocalConversation:_",
      "navigateToLocalConversation:globalThis.__kanbanSharedThreadNavigation.wrapNavigation(_)",
    ],
  ]),
  [RESUME]: Object.freeze([
    [
      'zfr as Oe}from"./app-initial-18b189e867e7.js"',
      'zfr as Oe,ofr as __kanbanSharedLocation}from"./app-initial-18b189e867e7.js"',
    ],
    [
      "r=o.get(ye,e);let l=o.get(me,e)",
      "r=o.get(ye,e);let __kanbanConnectAttempt;if(r===\"kanban-shared-cli\"){__kanbanConnectAttempt=await globalThis.__kanbanSharedThreadNavigation.consumeRoute({state:o.get(__kanbanSharedLocation)?.state,hostId:r,threadId:e});if(__kanbanConnectAttempt==null||w.current!==e||!o.get(_e,e)||o.get(ye,e)!==r)return}let l=o.get(me,e)",
    ],
    [
      "resumeConversation({...i,conversationId:e,threadAccess:t",
      "resumeConversation({...i,...(__kanbanConnectAttempt==null?{}:{__kanbanSharedConnectAttempt:__kanbanConnectAttempt}),conversationId:e,threadAccess:t",
    ],
  ]),
});

function replaceUnique(source, before, after) {
  const at = source.indexOf(before);
  if (at < 0 || at !== source.lastIndexOf(before))
    throw fail("SHARED_NAV_PATCH_MISMATCH");
  return source.slice(0, at) + after + source.slice(at + before.length);
}

export function createSharedThreadNavigationAssetAdapter(options) {
  if (
    !options ||
    typeof options !== "object" ||
    Array.isArray(options) ||
    Object.keys(options).join(",") !== "archiveSha256" ||
    options.archiveSha256 !== ARCHIVE
  )
    throw fail("SHARED_NAV_UNSUPPORTED_ARCHIVE");
  const members = Object.freeze(
    Object.keys(SHARED_THREAD_NAVIGATION_REFERENCE.members),
  );
  return Object.freeze({
    members,
    adapt({ member, body } = {}) {
      if (typeof member !== "string") throw fail("SHARED_NAV_INVALID_MEMBER");
      if (!Object.hasOwn(patches, member)) return null;
      if (!(body instanceof Uint8Array)) throw fail("SHARED_NAV_INVALID_BODY");
      if (body.byteLength > MAX) throw fail("SHARED_NAV_RESOURCE_LIMIT");
      const original = Buffer.from(body),
        originalSha256 = hash(original);
      if (
        originalSha256 !==
        SHARED_THREAD_NAVIGATION_REFERENCE.members[member].originalSha256
      )
        throw fail("SHARED_NAV_DIGEST_MISMATCH");
      let source;
      try {
        source = new TextDecoder("utf-8", { fatal: true }).decode(original);
      } catch {
        throw fail("SHARED_NAV_PATCH_MISMATCH");
      }
      for (const [before, after] of patches[member])
        source = replaceUnique(source, before, after);
      const adapted = Buffer.from(source, "utf8");
      if (adapted.byteLength > MAX) throw fail("SHARED_NAV_RESOURCE_LIMIT");
      const adaptedSha256 = hash(adapted);
      if (
        adaptedSha256 !==
        SHARED_THREAD_NAVIGATION_REFERENCE.members[member].adaptedSha256
      )
        throw fail("SHARED_NAV_PATCH_MISMATCH");
      return { body: adapted, originalSha256, adaptedSha256 };
    },
  });
}
