import {render,screen,fireEvent,waitFor} from "@testing-library/react";
import {it,expect,vi,afterEach} from "vitest";
import * as surface from "./native-surface";
import {CODEX_MULTIWINDOW_KEY} from "./codex-multiwindow-state";
const lease=vi.hoisted(()=>({setVisible:vi.fn(()=>true),stop:vi.fn(),start:vi.fn()}));
vi.mock("./native-visibility",()=>({startNativeVisibilityClient:lease.start}));
vi.mock("../lib/vscode-service-worker",()=>({probeVsCodeWebServiceWorker:vi.fn(async()=>({state:"ready"}))}));
vi.mock("@session/lib/agentNav",()=>({navigateToAgentSession:vi.fn()}));
vi.mock("@session/stores/useWorkspaceStore",()=>({useWorkspaceStore:{getState:()=>({cwd:null,setCwd:vi.fn()})}}));
vi.mock("@session/services/apiAdapt/shared",()=>({postJsonWithOptions:vi.fn(async()=>({data:[],nextCursor:null}))}));
import CodexWorkbench from "./CodexWorkbench";
const profileId="019aabcd-1234-7890-abcd-000000000001",instanceId="019aabcd-1234-7890-abcd-000000000002",threadId="019aabcd-1234-7890-abcd-000000000003",startup="019aabcd-1234-7890-abcd-000000000004";
afterEach(()=>{history.replaceState(null,"","/");sessionStorage.clear();localStorage.clear();vi.restoreAllMocks();vi.unstubAllGlobals();vi.clearAllMocks()});
async function mount(enabled:boolean){
  lease.start.mockReturnValue({setVisible:lease.setVisible,stop:lease.stop});
  if(enabled)history.replaceState(null,"",`/?nativeClient=${profileId}`);
  localStorage.setItem(CODEX_MULTIWINDOW_KEY+(enabled?`:${profileId}`:""),JSON.stringify({version:2,hostKey:startup,activeId:threadId,activeGroupId:"g",tree:{type:"group",id:"g",keys:[threadId],selected:threadId},windows:[{id:threadId,kind:"thread",threadId,title:"Visible",cwd:"/tmp/visibility"}]}));
  vi.stubGlobal("fetch",vi.fn(async(path:RequestInfo|URL)=>({ok:true,status:200,json:async()=>String(path).endsWith('/status')?{available:true,resumeAvailable:true,iframeUrl:enabled?`/native-codex/clients/${profileId}/`:"/native-codex/",newChatWindowIds:[startup],...(enabled?{refreshVisibility:{available:true}}:{})}:path==="/api/native-codex/tabs"?{initialized:true,revision:1,sequence:0,threads:[{id:threadId,cwd:"/tmp/visibility",title:"Visible"}]}:path==="/api/session/projects"?{projects:[]}:{opened:true,column:1,focused:true,applied:true}} as Response)));
  vi.spyOn(surface,"mountNativeSurface").mockImplementation((_doc,count,ready,options)=>{count(1);ready?.(1);options?.onHostInstance?.(instanceId);return {start:vi.fn(),pause:vi.fn(),dispose:vi.fn(),setLayout:vi.fn(),bindWindowAtColumn:vi.fn()}});
  const view=render(<CodexWorkbench active onModeChange={vi.fn()}/>);fireEvent.load(await screen.findByTitle("原生 Codex 会话窗口"));return view;
}
it("automatically publishes visible UUIDs only for an explicitly enabled profile and clears the set on mode exit",async()=>{
  const view=await mount(true);await waitFor(()=>expect(lease.start).toHaveBeenCalledWith(expect.objectContaining({profileId,instanceId})));
  await waitFor(()=>expect(lease.setVisible).toHaveBeenCalledWith([threadId],true));
  view.rerender(<CodexWorkbench active={false} onModeChange={vi.fn()}/>);
  await waitFor(()=>expect(lease.setVisible).toHaveBeenLastCalledWith([threadId],false));
});
it("does not create a protection connection or read visibility storage in the default entry",async()=>{
  await mount(false);expect(lease.start).not.toHaveBeenCalled();
});
