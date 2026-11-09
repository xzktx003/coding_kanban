"use strict";
const { createHash } = require("node:crypto");
const { adaptNativeHostChunk } = require("./native-host-policy.cjs");
const BASE = "9714f7b4288b3f1df2654b5d215cbf026c05d7b7530bd86dd9f383f938e5422c";
const FINAL =
  "36420b1fcaa514db5d9d22dc1e30fda1a17883f0f66cc9c64ffabe8fe322c30f";
const fail = () =>
  Object.assign(new Error("Native project picker unsupported"), {
    code: "PROJECT_FOLDER_PICKER_PATCH_MISMATCH",
  });
const patches = [
  [
    'n=this.settingsStore?.getEffective(el.Szl.defaultProjectParent.key)??en.join(ea.app.getPath("documents"),"ChatGPT")',
    'n=globalThis.__kanbanDefaultProjectParent(this.settingsStore,el.Szl.defaultProjectParent.key)??en.join(ea.app.getPath("documents"),"ChatGPT")',
  ],
  [
    'await em.PCQ.mkdir(i,{recursive:!0},this.appServerClient),t&&await this.initializeDefaultWorkspace(i),i',
    'await globalThis.__kanbanCreateDefaultProjectDirectory(i),t&&await this.initializeDefaultWorkspace(i),i',
  ],
  [
    'case"electron-create-new-workspace-root-option":{let r=await this.createDefaultWorkspaceRoot(t.projectName??eeR,t.initializeGitRepository)',
    'case"electron-create-new-workspace-root-option":{let r=await globalThis.__kanbanBindProjects(this,e).createDefaultWorkspaceRoot(t.projectName??eeR,t.initializeGitRepository)',
  ],
  [
    'async skipOnboardingWorkspace(e,t){let r=null;try{r=await this.createDefaultWorkspaceRoot(eeR,t);let n=await this.projectsManager.createOrSelectLocalProjects([r]);',
    'async skipOnboardingWorkspace(e,t){let r=null;try{r=await globalThis.__kanbanBindProjects(this,e).createDefaultWorkspaceRoot(eeR,t);let n=await globalThis.__kanbanBindProjects(this.projectsManager,e).createOrSelectLocalProjects([r]);',
  ],
  [
    "let n=null==t?await this.#r8(e):[await this.#r9(t)].filter(e=>null!=e),i=(0,el.ycq)(n);",
    "let n=null==t?globalThis.__kanbanProjectPickerConsume(e,await this.#r8(e)):await(async()=>{let s=await globalThis.__kanbanProjectPickerDirect(e,[t]),n=s.canceled?[]:(await Promise.all(s.filePaths.map(e=>this.#r9(e)))).filter(e=>null!=e);return globalThis.__kanbanProjectPickerConsume(e,globalThis.__kanbanProjectPickerComplete(e,s,n))})(),i=(0,el.ycq)(n);",
  ],
  [
    "for(let r of(await this.#r8(e,t)))",
    "for(let r of globalThis.__kanbanProjectPickerConsume(e,await this.#r8(e,t)))",
  ],
  [
    'let n={properties:r,title:"Select Project Root"},i=ea.BrowserWindow.fromWebContents(e),s=null==i?await ea.dialog.showOpenDialog(n):await ea.dialog.showOpenDialog(i,n);return s.canceled?[]:(await Promise.all(s.filePaths.map(e=>this.#r9(e)))).filter(e=>null!=e)',
    "let s=await globalThis.__kanbanProjectPickerOpen(e,t),n=s.canceled?[]:(await Promise.all(s.filePaths.map(e=>this.#r9(e)))).filter(e=>null!=e);return globalThis.__kanbanProjectPickerComplete(e,s,n)",
  ],
  [
    "this.projectsManager.createOrSelectLocalProjects([i])",
    "globalThis.__kanbanBindProjects(this.projectsManager,e).createOrSelectLocalProjects([i])",
  ],
  [
    'case"electron-add-new-workspace-root-option":',
    'case"kanban-project-folder-lifecycle":if(!globalThis.__kanbanProjectPickerLifecycle(e,t))throw Error("Project folder lifecycle unavailable");break;case"kanban-project-folder-reply":void globalThis.__kanbanProjectPickerReply(e,t).catch(()=>{});break;case"electron-add-new-workspace-root-option":',
  ],
  [
    'await this.projectsManager.createOrSelectLocalProjects(t.roots);break;case"open-in-browser":',
    'await(async()=>{let r=await globalThis.__kanbanProjectPickerDirect(e,t.roots),n=globalThis.__kanbanProjectPickerConsume(e,globalThis.__kanbanProjectPickerComplete(e,r,r.filePaths));if(n.length)await this.projectsManager.createOrSelectLocalProjects(n)})();break;case"open-in-browser":',
  ],
];
function adaptProjectFolderPickerChunk({ body } = {}) {
  // The existing composition validates the exact original SHA before applying
  // Codex-only, consent and SSH protections. No caller can skip that check.
  const base = adaptNativeHostChunk({ body });
  if (base.adaptedSha256 !== BASE) throw fail();
  let source = base.body.toString("utf8");
  for (const [before, after] of patches) {
    const at = source.indexOf(before);
    if (at < 0 || at !== source.lastIndexOf(before)) throw fail();
    source = source.slice(0, at) + after + source.slice(at + before.length);
  }
  const adapted = Buffer.from(source, "utf8"),
    hash = createHash("sha256").update(adapted).digest("hex");
  if (hash !== FINAL) throw fail();
  return {
    ...base,
    body: adapted,
    adaptedSha256: hash,
    nativeHostSha256: BASE,
  };
}
module.exports = { adaptProjectFolderPickerChunk };
