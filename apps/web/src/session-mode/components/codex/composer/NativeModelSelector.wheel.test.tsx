// Real NativeModelSelector, useModels/cache, settings/draft stores and Radix; four catalog reads only.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Model, ModelListResponse } from "@session/bindings/v2";
import { useLayoutStore } from "@session/stores/useLayoutStore";
import { useModelSettingsStore } from "@session/stores/settings";
import { hydrateThreadModel, useThreadModelStore } from "@session/stores/useThreadModelStore";
import { useSessionDraftStore, useSessionTextDraft, sessionDraftKey } from "@session/stores/useSessionDraftStore";
import { useComposerDraftStore } from "@session/components/codex/composer/v2/drafts";
import { useConfigStore } from "@session/components/codex/stores/useConfigStore";
import { useCodexStore } from "@session/components/codex/stores/useCodexStore";
import { useModelCacheStore } from "@session/components/codex/hooks/useModels";
import { NativeModelSelector } from "@session/components/codex/composer/NativeModelSelector";
import * as recentModels from "@session/components/codex/composer/recentModelConfigs";

const api = vi.hoisted(() => ({ listModels: vi.fn(), listOtherModels: vi.fn(),
  listConfigProviders: vi.fn(), listProviderPresets: vi.fn() }));
vi.mock("@session/services/apiAdapt", async (original) => ({
  ...(await original<typeof import("@session/services/apiAdapt")>()), ...api,
}));
const A="r24-wheel-a", B="r24-wheel-b", MODEL="r24-wheel-model";
const owner=(thread:string)=>sessionDraftKey("codex",thread);
const DRAFT="R24 未发送正文与附件保持";
let recentSpy:ReturnType<typeof vi.spyOn>;
let response:ModelListResponse;
let stopSettings:undefined|(()=>void);
const settingChanges:string[]=[];

function model(efforts:string[]):Model {
  return { id:MODEL,model:MODEL,displayName:"R24目录模型",description:"Synthetic catalog fixture",
    hidden:false,isDefault:true,upgrade:null,upgradeInfo:null,availabilityNux:null,
    supportedReasoningEfforts:efforts.map(reasoningEffort=>({reasoningEffort,description:reasoningEffort})),
    defaultReasoningEffort:"medium",inputModalities:["text"],supportsPersonality:false,
    additionalSpeedTiers:[],serviceTiers:[],defaultServiceTier:null };
}
function DraftEditor({thread}:{thread:string}) {
  const text=useSessionTextDraft(owner(thread));
  return <div className="session-rich-draft"><textarea aria-label="R24 草稿"
    value={text.inputValue} onChange={e=>text.setInputValue(e.currentTarget.value)}/></div>;
}
function Surface({thread=A,expanded=false,submit}:{thread?:string;expanded?:boolean;submit:()=>void}) {
  return <div className="session-mode"><section data-testid="host"
    className={expanded?"session-composer-sheet is-full":"session-codex-composer"}
    data-draft-owner={owner(thread)}><form onSubmit={e=>{e.preventDefault();submit();}}>
    <DraftEditor thread={thread}/><NativeModelSelector threadId={thread} draftOwner={owner(thread)}/>
  </form></section></div>;
}
function deferred<T>() {
  let resolve!:(value:T)=>void;
  const promise=new Promise<T>(done=>{resolve=done;});
  return {promise,resolve};
}
function capture() {
  return {a:useThreadModelStore.getState().threads[A],b:useThreadModelStore.getState().threads[B],
    defaults:useConfigStore.getState(),textDrafts:useSessionDraftStore.getState().drafts,
    contextDrafts:useComposerDraftStore.getState().drafts,raw:structuredClone(response.data),
    optionRefs:response.data.map(m=>m.supportedReasoningEfforts),recent:recentModels.recentModelConfigs()};
}
async function mount({expanded=false,effort="medium",efforts=["low","medium","high"],provider="openai",wait=true}={}) {
  response={data:[model(efforts)],nextCursor:null};
  api.listModels.mockResolvedValueOnce(response);
  if(provider!=="openai") {
    api.listConfigProviders.mockResolvedValue([{name:provider,base_url:"https://fixture.invalid"}]);
    api.listOtherModels.mockResolvedValue([{provider,models:[{id:MODEL}]}]);
  }
  hydrateThreadModel(A,{model:MODEL,modelProvider:provider,reasoningEffort:effort,serviceTier:null});
  hydrateThreadModel(B,{model:"r24-other-owner",modelProvider:"openai",reasoningEffort:"persistent",serviceTier:null});
  const before=capture(),submit=vi.fn();
  const view=render(<Surface expanded={expanded} submit={submit}/>);
  const editor=screen.getByRole("textbox",{name:"R24 草稿"}) as HTMLTextAreaElement;
  // Geometry fixture only: no focus/owner/model hook is replaced.
  vi.spyOn(editor,"getClientRects").mockReturnValue({length:1} as DOMRectList);
  if(wait)await waitFor(()=>expect(useModelCacheStore.getState().modelStatus).toBe("success"));
  return {...view,editor,submit,before,expanded};
}
function assertReads(count=1) {
  for(const read of Object.values(api)){expect(read).toHaveBeenCalledTimes(count);expect(read).toHaveBeenCalledWith();}
}
function assertProtected(surface:Awaited<ReturnType<typeof mount>>,count=1) {
  const {before}=surface,current=useThreadModelStore.getState().threads[A];
  for(const key of ["model","modelProvider","serviceTier","sandbox","sandboxPolicy","approvalPolicy",
    "approvalsReviewer","webSearchRequest","collaborationMode","personality"] as const)
    expect(current[key],key).toEqual(before.a[key]);
  expect(useThreadModelStore.getState().threads[B]).toBe(before.b);
  expect(useConfigStore.getState()).toBe(before.defaults);
  expect(useSessionDraftStore.getState().drafts).toBe(before.textDrafts);
  expect(useComposerDraftStore.getState().drafts).toBe(before.contextDrafts);
  expect(surface.editor.value).toBe(DRAFT);
  expect(surface.submit).not.toHaveBeenCalled();
  const cache=useModelCacheStore.getState();
  expect(cache.openAiModels).toBe(response.data);expect(cache.modelSnapshot).toBe(response.data);
  expect(cache.openAiModels).toEqual(before.raw);
  cache.openAiModels.forEach((m,i)=>{expect(m).toBe(response.data[i]);expect(m.supportedReasoningEfforts).toBe(before.optionRefs[i]);});
  assertReads(count);expect(globalThis.fetch).not.toHaveBeenCalled();
}
function assertNoChange(surface:Awaited<ReturnType<typeof mount>>,count=1) {
  expect(useThreadModelStore.getState().threads[A]).toBe(surface.before.a);
  expect(recentModels.recentModelConfigs()).toEqual(surface.before.recent);
  expect(recentSpy).not.toHaveBeenCalled();expect(settingChanges).toEqual([]);
  assertProtected(surface,count);
}
async function openPower() {
  fireEvent.keyDown(screen.getByRole("button",{name:/^模型：/}),{key:"ArrowDown",code:"ArrowDown"});
  const menu=await screen.findByRole("menu");
  vi.spyOn(menu, "getClientRects").mockReturnValue({ length: 1 } as DOMRectList);
  const slider=menu.querySelector<HTMLElement>(".session-native-power-slider");
  expect(slider).not.toBeNull();expect(slider!.closest("[data-model-picker-view]")?.getAttribute("data-model-picker-view")).toBe("simple");
  expect(slider!.closest("[hidden],[inert],[aria-hidden=true]")).toBeNull();
  vi.spyOn(slider!,"getClientRects").mockReturnValue({length:1} as DOMRectList);
  return {menu,slider:slider!};
}
function wheel(target:HTMLElement,deltaY:number,timeStamp=100,init:WheelEventInit={}) {
  const e=new WheelEvent("wheel",{bubbles:true,cancelable:true,deltaX:0,deltaY,deltaMode:0,...init});
  Object.defineProperty(e,"timeStamp",{value:timeStamp});
  act(()=>{target.dispatchEvent(e);});
  return e;
}
function watchSettings() {
  stopSettings=useThreadModelStore.subscribe((s,p)=>{
    if(s.threads[A]?.reasoningEffort!==p.threads[A]?.reasoningEffort)
      settingChanges.push(s.threads[A].reasoningEffort??"null");
  });
}

beforeEach(()=>{
  vi.restoreAllMocks();vi.resetAllMocks();settingChanges.length=0;
  vi.stubGlobal("fetch",vi.fn().mockRejectedValue(new Error("Unexpected R24 transport")));
  api.listOtherModels.mockResolvedValue([]);api.listConfigProviders.mockResolvedValue([]);api.listProviderPresets.mockResolvedValue([]);
  useModelCacheStore.setState({openAiModels:[],otherModels:{},configProviders:[],presets:[],loaded:false,loading:false,
    error:null,modelStatus:"pending",modelSnapshot:null});
  useModelSettingsStore.setState({models:{}});useThreadModelStore.setState({threads:{}});
  useSessionDraftStore.setState({drafts:{},migrated:[]});
  useSessionDraftStore.getState().setText(owner(A),DRAFT);useSessionDraftStore.getState().setText(owner(B),"B 原草稿");
  useComposerDraftStore.setState({error:null,drafts:{[owner(A)]:{contexts:[],drawings:{},expanded:false,plain:false},
    [owner(B)]:{contexts:[],drawings:{},expanded:false,plain:false}}});
  useConfigStore.setState({model:"r24-global-default",modelProvider:"openai",providerModels:{openai:"r24-global-default"},
    reasoningEffort:"low",serviceTier:null});
  useCodexStore.setState({currentThreadId:A});useLayoutStore.setState({view:"agent"});
  recentModels.resetRecentModels();recentSpy=vi.spyOn(recentModels,"rememberRecentModel");
});
afterEach(()=>{try{expect(globalThis.fetch).not.toHaveBeenCalled();}finally{
  stopSettings?.();stopSettings=undefined;cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();
}});

it.each([false,true])("ordinary OpenAI wheel adjusts only A, expanded=%s",async expanded=>{
  const s=await mount({expanded});const {slider}=await openPower();watchSettings();
  const event=wheel(slider,-30);
  // Cancellation alone may also come from Radix RemoveScroll; actual state is the RED assertion.
  expect(event.defaultPrevented).toBe(true);
  assertProtected(s);expect(useThreadModelStore.getState().threads[A].reasoningEffort).toBe("high");
  expect(settingChanges).toEqual(["high"]);expect(recentSpy).toHaveBeenCalledTimes(1);
  expect(recentModels.recentModelConfigs()).toMatchObject([{model:MODEL,reasoningEffort:"high"}]);
});
it("keeps threshold and residual across effort re-renders; one step per huge event",async()=>{
  const s=await mount({effort:"low",efforts:["low","medium","high","xhigh"]});
  const {slider}=await openPower();watchSettings();
  wheel(slider,-29,100);assertNoChange(s);
  wheel(slider,-1,110);expect(useThreadModelStore.getState().threads[A].reasoningEffort).toBe("medium");
  wheel(slider,-65,120);expect(useThreadModelStore.getState().threads[A].reasoningEffort).toBe("high");
  wheel(slider,-1,130);expect(useThreadModelStore.getState().threads[A].reasoningEffort).toBe("xhigh");
  wheel(slider,-30,140);assertProtected(s);
  expect(settingChanges).toEqual(["medium","high","xhigh"]);expect(recentSpy).toHaveBeenCalledTimes(3);
});
it.each([{effort:"high",delta:-300},{effort:"low",delta:30}])("edge $effort consumes without value change/recent",async({effort,delta})=>{
  const s=await mount({effort});const {slider}=await openPower();watchSettings();
  wheel(slider,delta);assertNoChange(s);
});
it.each([{name:"Ctrl",delta:-30,init:{ctrlKey:true}},{name:"zero",delta:0,init:{}}])("$name does not change power",async({delta,init})=>{
  const s=await mount();const {slider}=await openPower();watchSettings();wheel(slider,delta,100,init);assertNoChange(s);
});
it("accepted model data is usable while ancillary first read remains pending",async()=>{
  const pending=deferred<[]>();api.listConfigProviders.mockReturnValue(pending.promise);
  const s=await mount();expect(useModelCacheStore.getState()).toMatchObject({loading:true,loaded:false,modelStatus:"success"});
  const {slider}=await openPower();watchSettings();wheel(slider,-30);assertProtected(s);
  expect(useThreadModelStore.getState().threads[A].reasoningEffort).toBe("high");
  await act(async()=>{pending.resolve([]);await pending.promise;});
  await waitFor(()=>expect(useModelCacheStore.getState().loaded).toBe(true));assertProtected(s);
});
it("retained native catalog error keeps ordinary reasoning usable",async()=>{
  api.listConfigProviders.mockRejectedValueOnce(new Error("fixture initial ancillary error"));
  const s=await mount();await waitFor(()=>expect(useModelCacheStore.getState().loading).toBe(false));
  expect(useModelCacheStore.getState().loaded).toBe(false);
  api.listModels.mockRejectedValueOnce(new Error("fixture retained model error"));
  await act(async()=>{await useModelCacheStore.getState().load();});
  expect(useModelCacheStore.getState()).toMatchObject({modelStatus:"error",modelSnapshot:response.data});
  const {menu,slider}=await openPower();watchSettings();wheel(slider,-30);
  assertProtected(s,2);expect(useThreadModelStore.getState().threads[A].reasoningEffort).toBe("high");
  fireEvent.pointerDown(screen.getByRole("menuitem",{name:"选择模型"}),{button:0,pointerType:"mouse"});
  fireEvent.click(screen.getByRole("menuitem",{name:"选择模型"}));
  expect(menu.querySelectorAll('[role="menuitemradio"]:not([data-disabled]):not([aria-disabled="true"])')).toHaveLength(0);
});
it.each(["host-hidden","host-inert","owner","active-thread","agent-view","mode-hidden","lost-session-root"])("revoked %s cannot use an old portalled slider",async kind=>{
  const s=await mount();const {slider}=await openPower();watchSettings();const host=s.getByTestId("host");
  act(()=>{
    if(kind==="host-hidden")host.hidden=true;
    if(kind==="host-inert")host.setAttribute("inert","");
    if(kind==="owner")host.dataset.draftOwner=owner(B);
    if(kind==="active-thread")useCodexStore.setState({currentThreadId:B});
    if(kind==="agent-view")useLayoutStore.setState({view:"settings"});
    if(kind==="mode-hidden")host.closest<HTMLElement>(".session-mode")!.hidden=true;
    if(kind==="lost-session-root")host.closest<HTMLElement>(".session-mode")!.classList.remove("session-mode");
  });
  wheel(slider,-30);assertNoChange(s);
});
it("A→B→A does not revive old listener or accumulator; fresh A can act",async()=>{
  const s=await mount();const old=await openPower();watchSettings();wheel(old.slider,-20);assertNoChange(s);
  act(()=>useCodexStore.setState({currentThreadId:B}));s.rerender(<Surface thread={B} submit={s.submit}/>);
  act(()=>useCodexStore.setState({currentThreadId:A}));s.rerender(<Surface thread={A} submit={s.submit}/>);
  wheel(old.slider,-30,110);assertNoChange(s);
  const fresh=await openPower();wheel(fresh.slider,-10,120);assertNoChange(s);
  wheel(fresh.slider,-20,130);assertProtected(s);
  expect(useThreadModelStore.getState().threads[A].reasoningEffort).toBe("high");
  expect(settingChanges).toEqual(["high"]);
});
it.each(["hidden","inert","aria-hidden"])("inactive slider ancestor %s rejects synthetic dispatch",async attribute=>{
  const s=await mount();const {slider}=await openPower();watchSettings();
  const panel=slider.closest<HTMLElement>("[data-model-picker-view]")!;
  panel.setAttribute(attribute,attribute==="aria-hidden"?"true":"");wheel(slider,-30);assertNoChange(s);
});
it.each(["advanced","closed"])("%s removes this wheel input target",async kind=>{
  const s=await mount();const {menu,slider}=await openPower();watchSettings();
  if(kind==="advanced") {
    const caption=screen.getByRole("menuitem",{name:"选择模型"});fireEvent.pointerDown(caption,{button:0,pointerType:"mouse"});fireEvent.click(caption);
  } else fireEvent.keyDown(menu,{key:"Escape",code:"Escape"});
  await waitFor(()=>expect(slider.isConnected).toBe(false));wheel(slider,-30);assertNoChange(s);
});
it("initial model pending exposes no actionable power; real response does not write",async()=>{
  const pending=deferred<ModelListResponse>();api.listModels.mockReturnValue(pending.promise);
  // mount schedules a one-time response; preserve the genuine pending first read explicitly.
  api.listModels.mockImplementationOnce(()=>pending.promise);
  const s=await mount({wait:false});
  await waitFor(()=>assertReads());
  const busy=screen.getByRole("button",{name:"Loading model…"});expect(busy).toHaveProperty("disabled",true);
  wheel(busy,-30);expect(screen.queryByRole("menu")).toBeNull();expect(s.container.querySelector(".session-native-power-slider")).toBeNull();
  expect(useThreadModelStore.getState().threads[A]).toBe(s.before.a);expect(recentSpy).not.toHaveBeenCalled();
  await act(async()=>{pending.resolve(response);await pending.promise;});
  await waitFor(()=>expect(useModelCacheStore.getState().loaded).toBe(true));assertNoChange(s);
});
it.each([{efforts:[]},{efforts:["medium"]}])("known $efforts has no simple wheel target",async({efforts})=>{
  const s=await mount({efforts});
  fireEvent.keyDown(screen.getByRole("button",{name:/^模型：/}),{key:"ArrowDown",code:"ArrowDown"});
  const menu=await screen.findByRole("menu");expect(menu.querySelector(".session-native-power-slider")).toBeNull();
  watchSettings();wheel(menu,-30);assertNoChange(s);
});
it("unmount releases any native listener before stale dispatch",async()=>{
  const adds=vi.spyOn(EventTarget.prototype,"addEventListener"),removes=vi.spyOn(EventTarget.prototype,"removeEventListener");
  const s=await mount();const {slider}=await openPower();watchSettings();
  const owned=adds.mock.calls.flatMap((args,i)=>adds.mock.contexts[i]===slider&&args[0]==="wheel"?[args]:[]);
  expect(owned).toHaveLength(1);
  for(const args of owned)expect(args[2]).toMatchObject({passive:false});
  s.unmount();wheel(slider,-30);assertNoChange(s);
  for(const args of owned)expect(removes.mock.calls.some((r,i)=>removes.mock.contexts[i]===slider&&r[0]==="wheel"&&r[1]===args[1])).toBe(true);
});
it("custom provider keeps no-wheel semantics and existing generic arrow adjustment",async()=>{
  const s=await mount({provider:"r24-custom"});const {slider}=await openPower();watchSettings();
  wheel(slider,-30);assertNoChange(s);
  const control=screen.getByRole("menuitem",{name:"强度"});fireEvent.keyDown(control,{key:"ArrowRight",code:"ArrowRight"});
  assertProtected(s);expect(useThreadModelStore.getState().threads[A].reasoningEffort).toBe("high");
});


it("effort commits preserve the same native listener and residual", async () => {
  const adds = vi.spyOn(EventTarget.prototype, "addEventListener");
  const removes = vi.spyOn(EventTarget.prototype, "removeEventListener");
  const s = await mount({ effort: "low", efforts: ["low", "medium", "high", "xhigh"] });
  const { slider } = await openPower();
  watchSettings();
  const registrations = () => adds.mock.calls.flatMap((args, i) =>
    adds.mock.contexts[i] === slider && args[0] === "wheel" ? [args] : []);
  expect(registrations()).toHaveLength(1);
  const first = registrations()[0][1];
  wheel(slider, -30, 100);
  wheel(slider, -65, 110);
  wheel(slider, -1, 120);
  expect(useThreadModelStore.getState().threads[A].reasoningEffort).toBe("xhigh");
  expect(settingChanges).toEqual(["medium", "high", "xhigh"]);
  expect(recentSpy).toHaveBeenCalledTimes(3);
  expect(screen.getByRole("menu").querySelector(".session-native-power-slider")).toBe(slider);
  expect(registrations()).toHaveLength(1);
  expect(registrations()[0][1]).toBe(first);
  expect(removes.mock.calls.some((args, i) =>
    removes.mock.contexts[i] === slider && args[0] === "wheel" && args[1] === first)).toBe(false);
  assertProtected(s);
});

it("a released same-layer listener cannot revive or lend its residual to the new lease", async () => {
  const adds = vi.spyOn(EventTarget.prototype, "addEventListener");
  const removes = vi.spyOn(EventTarget.prototype, "removeEventListener");
  const s = await mount();
  const { menu, slider } = await openPower();
  const host = s.getByTestId("host");
  const parent = host.parentNode!;
  const nextSibling = host.nextSibling;
  const parking = document.createElement("div");
  document.body.append(parking);
  const registrations = () => adds.mock.calls.flatMap((args, i) =>
    adds.mock.contexts[i] === slider && args[0] === "wheel" ? [args] : []);
  expect(registrations()).toHaveLength(1);
  const oldCallback = registrations()[0][1];
  if (typeof oldCallback !== "function") throw new Error("Expected owned native listener function");
  watchSettings();
  wheel(slider, -20, 100);
  assertNoChange(s);
  try {
    // Synthetic lifecycle control: preserve the real root and portal, move
    // only the captured composer host outside it, and commit the same props.
    act(() => { parking.append(host); });
    s.rerender(<Surface submit={s.submit} />);
    expect(slider.isConnected).toBe(true);
    expect(screen.getByRole("menu")).toBe(menu);
    expect(menu.querySelector(".session-native-power-slider")).toBe(slider);
    expect(removes.mock.calls.some((args, i) =>
      removes.mock.contexts[i] === slider && args[0] === "wheel" && args[1] === oldCallback)).toBe(true);
    act(() => { parent.insertBefore(host, nextSibling?.parentNode === parent ? nextSibling : null); });
    s.rerender(<Surface submit={s.submit} />);
    expect(screen.getByRole("menu")).toBe(menu);
    expect(menu.querySelector(".session-native-power-slider")).toBe(slider);
    expect(registrations()).toHaveLength(2);
    const stale = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -10, deltaMode: 0 });
    Object.defineProperty(stale, "timeStamp", { value: 110 });
    act(() => { oldCallback.call(slider, stale); });
    expect(stale.defaultPrevented).toBe(false);
    assertNoChange(s);
    wheel(slider, -10, 120);
    assertNoChange(s);
    wheel(slider, -20, 130);
    assertProtected(s);
    expect(useThreadModelStore.getState().threads[A].reasoningEffort).toBe("high");
    expect(settingChanges).toEqual(["high"]);
    expect(recentSpy).toHaveBeenCalledTimes(1);
  } finally {
    // Keep React's owned host at its original position even if an assertion fails.
    act(() => {
      if (host.parentNode !== parent)
        parent.insertBefore(host, nextSibling?.parentNode === parent ? nextSibling : null);
      parking.remove();
    });
  }
});
