import {act,fireEvent,render,screen,cleanup} from "@testing-library/react";
import {afterEach,expect,it,vi} from "vitest";
const api=vi.hoisted(()=>({read:vi.fn()}));
vi.mock("@session/services/claudePermissionDetail",()=>({readClaudePermissionInput:api.read}));
vi.mock(".",()=>({NO_RAW_INPUT_TOOLS:[]}));
vi.mock("./ToolInputDisplay",()=>({ToolInputDisplay:({input}:{input:unknown})=><pre>{JSON.stringify(input)}</pre>}));
import {PermissionRequestCard} from "./PermissionRequestCard";
const msg={type:"permission_request" as const,requestId:"request",sessionId:"session",toolName:"FixtureApproval",toolInput:{},toolInputTruncated:true,inputAvailable:true,inputRevision:"revision",recoveryRuntimeInstance:"runtime"};
afterEach(()=>{cleanup();vi.clearAllMocks();});
it("recovered approvals require complete details, release them while hidden, and retain a usable reject action",async()=>{
  api.read.mockResolvedValue({command:"complete secret-free fixture"});const resolve=vi.fn();
  const view=render(<PermissionRequestCard msg={msg} onResolve={resolve}/>);
  expect((screen.getByRole("button",{name:"Allow Once"}) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("button",{name:"Deny"}) as HTMLButtonElement).disabled).toBe(false);
  await act(async()=>{fireEvent.click(screen.getByRole("button",{name:"查看完整审批参数"}));});
  expect(screen.getByText(/complete secret-free fixture/)).toBeTruthy();expect((screen.getByRole("button",{name:"Allow Once"}) as HTMLButtonElement).disabled).toBe(false);
  view.rerender(<PermissionRequestCard msg={msg} onResolve={resolve} active={false}/>);
  expect(screen.queryByText(/complete secret-free fixture/)).toBeNull();expect((screen.getByRole("button",{name:"Allow Once"}) as HTMLButtonElement).disabled).toBe(true);
  view.rerender(<PermissionRequestCard msg={{...msg,inputAvailable:false,inputError:"超过安全预算"}} onResolve={resolve}/>);
  await act(async()=>{fireEvent.click(screen.getByRole("button",{name:"Deny"}));});expect(resolve).toHaveBeenCalledWith("request","deny");
});
it("a rejected permission response remains explicit and retryable",async()=>{
  const resolve=vi.fn(async()=>{throw new Error("runtime changed");});
  render(<PermissionRequestCard msg={{...msg,toolInputTruncated:false,toolInput:{command:"fixture"}}} onResolve={resolve}/>);
  await act(async()=>{fireEvent.click(screen.getByRole("button",{name:"Allow Once"}));});
  expect(screen.getByRole("alert").textContent).toContain("runtime changed");expect((screen.getByRole("button",{name:"Deny"}) as HTMLButtonElement).disabled).toBe(false);
});
