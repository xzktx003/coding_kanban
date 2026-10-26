import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useEffect, useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Model, ModelListResponse } from "@session/bindings/v2";
import { useLayoutStore } from "@session/stores/useLayoutStore";
import { useAgentSettingsStore } from "@session/stores/useAgentSettingsStore";
import { useAcpStore } from "@session/stores/useAcpStore";
import { useWorkspaceStore } from "@session/stores/useWorkspaceStore";
import { useModelSettingsStore } from "@session/stores/settings";
import { sessionDraftKey, useSessionDraftStore, useSessionTextDraft } from "@session/stores/useSessionDraftStore";
import { hydrateThreadModel, useThreadModelStore } from "@session/stores/useThreadModelStore";
import { nativeThreadSettings } from "@session/services/nativeThreadSettings";
import { useThreadModelSettings } from "@session/hooks/useThreadModelSettings";
import { DEFAULT_NATIVE_PICKER_REASONING_EFFORTS, useNativeModelPickerPreferencesStore } from "@session/stores/settings/useNativeModelPickerPreferencesStore";
import { useConfigStore } from "../stores/useConfigStore";
import { useCodexStore } from "../stores/useCodexStore";
import { useModelCacheStore, useModels } from "../hooks/useModels";
import { NativeModelSelector } from "./NativeModelSelector";
import { ComposerSheet } from "./v2/ComposerSheet";
import { recentModelConfigs, resetRecentModels } from "./recentModelConfigs";
import { useComposerDraftStore } from "./v2/drafts";

const api = vi.hoisted(() => ({ listModels: vi.fn(), listOtherModels: vi.fn(), listConfigProviders: vi.fn(), listProviderPresets: vi.fn() }));
vi.mock("@session/services/apiAdapt", async (original) => ({ ...(await original<typeof import("@session/services/apiAdapt")>()), ...api }));
const rpc = vi.hoisted(() => ({ threadStart: vi.fn(), turnStart: vi.fn(), turnSteer: vi.fn(), turnInterrupt: vi.fn(), respondToPermissionsApproval: vi.fn() }));
vi.mock("@session/services/apiAdapt/codex", async (original) => ({ ...(await original<typeof import("@session/services/apiAdapt/codex")>()), ...rpc }));
const A = "e12-owner-a", B = "e12-owner-b", CWD = "/fixture/e12";
const OWNER = sessionDraftKey("codex", A, CWD), OTHER = sessionDraftKey("codex", B);
const SOL = "gpt-5.6-sol", TERRA = "gpt-5.6-terra", EMPTY = "e12-known-empty", UNKNOWN = "e12-unknown";
const CUSTOM = "e12-custom", CUSTOM_MODEL = "e12-custom-model", CUSTOM_B = "e12-custom-b", CUSTOM_B_MODEL = "e12-custom-b-model", DRAFT = "E12 未发送草稿\n保留归属、权限和另一会话";
const entry = () => useThreadModelStore.getState().threads[A];
const prefs = () => useNativeModelPickerPreferencesStore.getState();
function model(id: string, efforts: string[]): Model {
  return { id, model: id, displayName: id, description: "Synthetic local E12 catalog, not native eligibility",
    hidden: false, isDefault: id === TERRA, upgrade: null, upgradeInfo: null, availabilityNux: null,
    supportedReasoningEfforts: efforts.map((reasoningEffort) => ({ reasoningEffort, description: reasoningEffort })),
    defaultReasoningEffort: id === TERRA ? "low" : "medium", inputModalities: ["text"], supportsPersonality: false,
    additionalSpeedTiers: [], serviceTiers: [], defaultServiceTier: null };
}
const catalog = () => [model(TERRA, ["low"]), model(SOL, ["low", "medium", "high"]), model(EMPTY, [])];
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as unknown;
function protectedValues() {
  return json({ b: useThreadModelStore.getState().threads[B], defaults: useConfigStore.getState(), custom: useModelSettingsStore.getState(),
    drafts: useSessionDraftStore.getState(), rich: useComposerDraftStore.getState(), preferences: prefs(), recent: recentModelConfigs() });
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
function Editor({ label }: { label: string }) {
  const draft = useSessionTextDraft(OWNER);
  return <div className="session-rich-draft"><textarea aria-label={label} value={draft.inputValue} onChange={(event) => draft.setInputValue(event.currentTarget.value)} /></div>;
}
function Controls({ reload }: { reload: { current: null | (() => Promise<void>) } }) {
  const settings = useThreadModelSettings(A), models = useModels();
  useEffect(() => { reload.current = models.reload; return () => { reload.current = null; }; }, [models.reload, reload]);
  return <><button type="button" data-e12-provider="openai" onClick={() => settings.setModelProvider("openai")}>E12切换OpenAI</button>
    <button type="button" data-e12-provider={CUSTOM} onClick={() => settings.setModelProvider(CUSTOM)}>E12切换自定义</button>
    <button type="button" data-e12-provider={CUSTOM_B} onClick={() => settings.setModelProvider(CUSTOM_B)}>E12切换另一自定义</button></>;
}
function Harness({ expanded, reload, submit, sheetClose }: {
  expanded: boolean; reload: { current: null | (() => Promise<void>) }; submit: () => void; sheetClose: () => void;
}) {
  const [shown, setShown] = useState(false);
  return <div className="session-mode" onSubmitCapture={(event) => { event.preventDefault(); submit(); }}>
    <button type="button" data-e12-background>非输入背景按钮</button>
    {expanded && <button type="button" onClick={() => setShown(true)}>E12打开展开</button>}
    <section className="session-codex-composer" data-draft-owner={OWNER}>
      <form><Editor label="E12主草稿" /><NativeModelSelector threadId={A} draftOwner={OWNER} /><Controls reload={reload} /></form>
    </section>
    {shown && <ComposerSheet full title="E12展开编辑" onClose={() => { sheetClose(); setShown(false); }}
      footer={<NativeModelSelector threadId={A} draftOwner={OWNER} />}>
      <Editor label="E12展开草稿" />
    </ComposerSheet>}
  </div>;
}
type Status = "known" | "unknown" | "empty" | "primary-error" | "aux-pending" | "primary-pending";
async function mount(options: { expanded?: boolean; status?: Status; provider?: string } = {}) {
  const { expanded = false, status = "known", provider = "openai" } = options;
  const records = catalog(), response: ModelListResponse = { data: records, nextCursor: null };
  const primary = deferred<ModelListResponse>(), ancillary = deferred<[]>();
  api.listModels.mockReturnValue(status === "primary-pending" ? primary.promise
    : status === "primary-error" ? Promise.reject(Error("E12 fixture primary read failure")) : Promise.resolve(response));
  api.listConfigProviders.mockReturnValue(status === "aux-pending" ? ancillary.promise : Promise.resolve([{ name: CUSTOM }, { name: CUSTOM_B }]));
  hydrateThreadModel(A, { model: SOL, modelProvider: "openai", reasoningEffort: "medium", serviceTier: "fast" });
  hydrateThreadModel(A, { model: CUSTOM_MODEL, modelProvider: CUSTOM, reasoningEffort: "medium", serviceTier: "fast" });
  hydrateThreadModel(A, { model: CUSTOM_B_MODEL, modelProvider: CUSTOM_B, reasoningEffort: "medium", serviceTier: "fast" });
  const selected = status === "unknown" ? UNKNOWN : status === "empty" ? EMPTY : SOL;
  hydrateThreadModel(A, nativeThreadSettings({ model: provider === "openai" ? selected : provider === CUSTOM ? CUSTOM_MODEL : CUSTOM_B_MODEL, modelProvider: provider,
    reasoningEffort: "medium", serviceTier: "fast", activePermissionProfile: { id: "e12-profile", extends: null },
    runtimeWorkspaceRoots: ["/fixture/e12/root"], sandbox: { type: "readOnly", networkAccess: false }, approvalPolicy: "on-request", approvalsReviewer: "user" }));
  hydrateThreadModel(B, { model: "e12-other", modelProvider: CUSTOM, reasoningEffort: "low", serviceTier: null });
  useSessionDraftStore.getState().setText(OWNER, DRAFT); useSessionDraftStore.getState().setText(OTHER, "E12 B保持草稿");
  const reload: { current: null | (() => Promise<void>) } = { current: null }, submit = vi.fn(), sheetClose = vi.fn();
  const view = render(<Harness expanded={expanded} reload={reload} submit={submit} sheetClose={sheetClose} />);
  if (expanded) {
    // Root must commit before the genuine Sheet opens, so its real Portal uses it.
    fireEvent.click(within(view.container).getByRole("button", { name: "E12打开展开" }));
    await screen.findByRole("dialog", { name: "E12展开编辑" });
  }
  const scope = expanded ? document.querySelector<HTMLElement>(".session-composer-sheet.is-full")
    : view.container.querySelector<HTMLElement>(".session-codex-composer");
  if (!scope) throw Error("Actual main/ComposerSheet scope missing");
  const editor = scope.querySelector<HTMLTextAreaElement>("textarea"), button = scope.querySelector<HTMLButtonElement>(".session-native-model-trigger");
  const background = view.container.querySelector<HTMLButtonElement>("[data-e12-background]");
  if (!editor || !button || !background) throw Error("Actual editor/Trigger/background missing");
  vi.spyOn(editor, "getClientRects").mockReturnValue({ length: 1 } as DOMRectList);
  if (status === "primary-pending") await waitFor(() => expect(api.listModels).toHaveBeenCalledTimes(1));
  else if (status === "primary-error") await waitFor(() => expect(useModelCacheStore.getState().modelStatus).toBe("error"));
  else await waitFor(() => expect(useModelCacheStore.getState().modelStatus).toBe("success"));
  if (status !== "primary-pending" && status !== "aux-pending") await waitFor(() => expect(useModelCacheStore.getState().loading).toBe(false));
  const before = { a: entry(), aValue: structuredClone(entry()), b: useThreadModelStore.getState().threads[B], defaults: useConfigStore.getState(),
    custom: useModelSettingsStore.getState(), text: useSessionDraftStore.getState(), rich: useComposerDraftStore.getState(),
    preferences: prefs(), protectedValues: protectedValues(), recent: recentModelConfigs(), raw: structuredClone(response), recordRefs: [...records], effortRefs: records.map((row) => row.supportedReasoningEfforts) };
  return { ...view, expanded, status, provider, records, response, primary, ancillary, scope, editor, button, background, reload, submit, sheetClose, before };
}
type Surface = Awaited<ReturnType<typeof mount>>;
function hidden(element: Element) { return Boolean(element.closest('[aria-hidden="true"]')); }
function noIO() { expect(globalThis.fetch).not.toHaveBeenCalled(); for (const method of Object.values(rpc)) expect(method).not.toHaveBeenCalled(); }
function guard(s: Surface, providerChanged = false, readCount = 1) {
  noIO(); expect(s.submit).not.toHaveBeenCalled(); expect(s.sheetClose).not.toHaveBeenCalled();
  expect(s.before.a).toEqual(s.before.aValue); expect(protectedValues()).toEqual(s.before.protectedValues);
  if (!providerChanged) expect(entry()).toBe(s.before.a);
  expect(useThreadModelStore.getState().threads[B]).toBe(s.before.b); expect(useConfigStore.getState()).toBe(s.before.defaults);
  expect(useModelSettingsStore.getState()).toBe(s.before.custom); expect(useSessionDraftStore.getState()).toBe(s.before.text);
  expect(useComposerDraftStore.getState()).toBe(s.before.rich); expect(prefs()).toBe(s.before.preferences);
  expect(recentModelConfigs()).toEqual(s.before.recent); expect(useCodexStore.getState().currentThreadId).toBe(A);
  expect(s.editor.isConnected).toBe(true); expect(s.editor.value).toBe(DRAFT); expect(s.scope.contains(s.editor)).toBe(true);
  expect(s.scope.querySelector(".session-native-model-trigger")).toBe(s.button);
  expect(s.response).toEqual(s.before.raw);
  if (useModelCacheStore.getState().modelSnapshot) {
    expect(useModelCacheStore.getState().openAiModels).toBe(s.records); expect(useModelCacheStore.getState().modelSnapshot).toBe(s.records);
    s.records.forEach((row, i) => { expect(row).toBe(s.before.recordRefs[i]); expect(row.supportedReasoningEfforts).toBe(s.before.effortRefs[i]); });
  }
  for (const read of Object.values(api)) { expect(read).toHaveBeenCalledTimes(readCount); expect(read).toHaveBeenCalledWith(); }
}
async function frames() { await act(async () => { await new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))); }); }
async function open(s: Surface) {
  act(() => s.button.focus()); fireEvent.keyDown(s.button, { key: "ArrowDown", code: "ArrowDown" });
  const menu = await screen.findByRole("menu");
  vi.spyOn(menu, "getClientRects").mockReturnValue({ length: 1 } as DOMRectList);
  await frames(); expect(menu.contains(document.activeElement)).toBe(true); guard(s); return menu;
}
async function closeMenu(menu: HTMLElement) {
  if (menu.isConnected) { fireEvent.keyDown(menu, { key: "Escape", code: "Escape" }); await waitFor(() => expect(menu.isConnected).toBe(false)); }
}
function actualLayer(s: Surface, menu: HTMLElement) {
  return { bodyLocked: document.body.style.pointerEvents === "none", editorHidden: hidden(s.editor), triggerHidden: hidden(s.button),
    backgroundHidden: hidden(s.background), sameButton: s.scope.querySelector(".session-native-model-trigger") === s.button,
    menuConnected: menu.isConnected, activeInMenu: menu.contains(document.activeElement) };
}
async function finishReads(s: Surface) {
  if (s.status === "primary-pending") await act(async () => { s.primary.resolve(s.response); await s.primary.promise; });
  if (s.status === "aux-pending") await act(async () => { s.ancillary.resolve([]); await s.ancillary.promise; });
}
beforeEach(() => {
  vi.restoreAllMocks(); vi.resetAllMocks(); vi.stubGlobal("fetch", vi.fn().mockRejectedValue(Error("Unexpected E12 transport")));
  api.listOtherModels.mockResolvedValue([]); api.listProviderPresets.mockResolvedValue([]);
  useModelCacheStore.setState(useModelCacheStore.getInitialState(), true); useThreadModelStore.setState({ threads: {} });
  useSessionDraftStore.setState({ drafts: {}, migrated: [] }); useComposerDraftStore.setState({ drafts: {}, error: null });
  useModelSettingsStore.setState({ models: { [CUSTOM]: [{ id: CUSTOM_MODEL, name: "E12 custom retained" }], [CUSTOM_B]: [{ id: CUSTOM_B_MODEL, name: "E12 custom B retained" }] } });
  useConfigStore.setState({ model: "e12-global", modelProvider: "openai", reasoningEffort: "high", serviceTier: null, providerModels: { openai: "e12-global", [CUSTOM]: "e12-other-slot" } });
  useCodexStore.setState({ currentThreadId: A, account: null }); useLayoutStore.setState({ view: "agent" });
  useAgentSettingsStore.setState({ selectedAgent: "codex" }); useAcpStore.setState({ active: false }); useWorkspaceStore.setState({ cwd: CWD });
  prefs().setSelectionMode("model"); prefs().setEnabledReasoningEfforts(DEFAULT_NATIVE_PICKER_REASONING_EFFORTS); resetRecentModels();
});
afterEach(async () => { try { noIO(); } finally { cleanup(); await waitFor(() => expect(document.body.style.pointerEvents).not.toBe("none")); vi.restoreAllMocks(); vi.unstubAllGlobals(); } });

it.each(["known", "unknown", "empty", "primary-error", "aux-pending"] as const)("OpenAI %s new menu exposes own editor/background and uses no body pointer lock", async (status) => {
  const s = await mount({ status }); let observed: ReturnType<typeof actualLayer> | null = null;
  try {
    const menu = await open(s); observed = actualLayer(s, menu); guard(s);
    await closeMenu(menu); await waitFor(() => expect(document.activeElement).toBe(s.editor)); guard(s);
  } finally { await finishReads(s); s.unmount(); }
  expect(observed).toEqual({ bodyLocked: false, editorHidden: false, triggerHidden: false, backgroundHidden: false, sameButton: true, menuConnected: true, activeInMenu: true });
});
it("OpenAI known inside the real ComposerSheet keeps only the outer Dialog lock/AX boundary", async () => {
  const s = await mount({ expanded: true }); let observed: ReturnType<typeof actualLayer> | null = null;
  try {
    expect(document.body.style.pointerEvents).toBe("none"); expect(hidden(s.background)).toBe(true); expect(hidden(s.editor)).toBe(false);
    const menu = await open(s); observed = actualLayer(s, menu); guard(s);
    await closeMenu(menu); expect(document.body.style.pointerEvents).toBe("none"); expect(hidden(s.background)).toBe(true);
    await waitFor(() => expect(document.activeElement).toBe(s.editor)); guard(s);
  } finally { s.unmount(); }
  expect(observed).toEqual({ bodyLocked: true, editorHidden: false, triggerHidden: false, backgroundHidden: true, sameButton: true, menuConnected: true, activeInMenu: true });
});
it("primary pending keeps the existing disabled Loading control and cannot open a menu", async () => {
  const s = await mount({ status: "primary-pending" });
  try {
    expect(s.button.disabled).toBe(true); expect(s.button.getAttribute("aria-label")).toBe("Loading model…");
    fireEvent.pointerDown(s.button, { button: 0, pointerType: "mouse" }); fireEvent.keyDown(s.button, { key: "ArrowDown", code: "ArrowDown" });
    expect(document.querySelector(".session-native-model-menu")).toBeNull(); expect(document.body.style.pointerEvents).not.toBe("none"); guard(s);
  } finally { await finishReads(s); s.unmount(); }
});
it("non-OpenAI provider retains a real modal picker rather than inheriting the native policy", async () => {
  const s = await mount({ provider: CUSTOM }); let observed: ReturnType<typeof actualLayer> | null = null;
  try { const menu = await open(s); observed = actualLayer(s, menu); guard(s); await closeMenu(menu); guard(s); }
  finally { s.unmount(); }
  expect(observed).toEqual({ bodyLocked: true, editorHidden: true, triggerHidden: true, backgroundHidden: true, sameButton: true, menuConnected: true, activeInMenu: true });
});
it.each([["openai", CUSTOM], [CUSTOM, "openai"], [CUSTOM, CUSTOM_B]] as const)("provider boundary %s -> %s closes old epoch; only next opening adopts new policy", async (from, to) => {
  const s = await mount({ provider: from }); const layers: Array<ReturnType<typeof actualLayer>> = [];
  try {
    const oldMenu = await open(s); layers.push(actualLayer(s, oldMenu));
    const switchButton = s.container.querySelector<HTMLButtonElement>(`[data-e12-provider="${to}"]`); if (!switchButton) throw Error("Existing public-hook provider control missing");
    // Unit-only external setting control using the real hook/action. This does
    // not claim a pointer can hit a modal-hidden background control in a GUI.
    fireEvent.click(switchButton); await waitFor(() => expect(oldMenu.isConnected).toBe(false));
    expect(document.querySelector(".session-native-model-menu")).toBeNull(); expect(entry().modelProvider).toBe(to);
    expect(entry().model).toBe(to === "openai" ? SOL : to === CUSTOM ? CUSTOM_MODEL : CUSTOM_B_MODEL); expect(entry().revision).toBe(s.before.a.revision + 1);
    const stable = (value: typeof s.before.a) => { const { model, modelProvider, providerModels, revision, pending, pendingFields, notice, ...rest } = value; return rest; };
    expect(stable(entry())).toEqual(stable(s.before.aValue)); expect(entry().providerModels).toEqual(s.before.a.providerModels); guard(s, true);
    act(() => s.button.focus()); fireEvent.keyDown(s.button, { key: "ArrowDown", code: "ArrowDown" });
    const newMenu = await screen.findByRole("menu"); vi.spyOn(newMenu, "getClientRects").mockReturnValue({ length: 1 } as DOMRectList);
    await frames(); layers.push(actualLayer(s, newMenu)); guard(s, true); await closeMenu(newMenu); guard(s, true);
  } finally { s.unmount(); }
  expect(layers.map((row) => row.bodyLocked)).toEqual([from !== "openai", to !== "openai"]);
  expect(layers.map((row) => row.editorHidden)).toEqual([from !== "openai", to !== "openai"]);
  expect(layers.every((row) => row.sameButton)).toBe(true);
});
it("accepted catalog success -> primary read error while open preserves the same layer policy, focus, raw snapshot and owner", async () => {
  const s = await mount(); let observed: ReturnType<typeof actualLayer> | null = null;
  try {
    const menu = await open(s), active = document.activeElement; if (!(active instanceof HTMLElement)) throw Error("Actual open-menu focus missing");
    expect(typeof s.reload.current).toBe("function"); api.listModels.mockRejectedValueOnce(Error("E12 retained primary failure"));
    await act(async () => { await s.reload.current!(); });
    expect(useModelCacheStore.getState()).toMatchObject({ modelStatus: "error", loaded: false, loading: false, openAiModels: s.records, modelSnapshot: s.records });
    expect(menu.isConnected).toBe(true); expect(document.activeElement).toBe(active); observed = actualLayer(s, menu); guard(s, false, 2);
    await closeMenu(menu); guard(s, false, 2);
  } finally { s.unmount(); }
  expect(observed).toEqual({ bodyLocked: false, editorHidden: false, triggerHidden: false, backgroundHidden: false, sameButton: true, menuConnected: true, activeInMenu: true });
});
