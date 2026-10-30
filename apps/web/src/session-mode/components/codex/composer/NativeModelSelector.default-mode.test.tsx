import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createRef, useEffect } from "react";
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
import { DEFAULT_NATIVE_PICKER_REASONING_EFFORTS, useNativeModelPickerPreferencesStore } from "@session/stores/settings/useNativeModelPickerPreferencesStore";
import { useConfigStore } from "../stores/useConfigStore";
import { useCodexStore } from "../stores/useCodexStore";
import { useModelCacheStore, useModels } from "../hooks/useModels";
import { NativeModelSelector } from "./NativeModelSelector";
import { ConversationMenu } from "./ConversationMenu";
import { recentModelConfigs, resetRecentModels } from "./recentModelConfigs";
import { useComposerDraftStore } from "./v2/drafts";

const api = vi.hoisted(() => ({ listModels: vi.fn(), listOtherModels: vi.fn(), listConfigProviders: vi.fn(), listProviderPresets: vi.fn() }));
vi.mock("@session/services/apiAdapt/codex", async (original) => ({ ...(await original<typeof import("@session/services/apiAdapt/codex")>()), ...api }));
const A = "e7-default-a", B = "e7-default-b", CWD = "/fixture/e7";
const TERRA = "gpt-5.6-terra", SOL = "gpt-5.6-sol", EMPTY = "e7-known-empty", UNKNOWN = "e7-unknown";
const TL = "E7 Terra", SL = "E7 Sol", DRAFT = "E7 原草稿\n保持另一会话与附件";
const COMMANDS = ["提高推理强度", "降低推理强度", "循环切换推理强度"] as const;
type Mode = "default" | "model" | null;
const entry = () => useThreadModelStore.getState().threads[A];
const prefs = () => useNativeModelPickerPreferencesStore.getState();
function model(id: string, label: string, efforts: readonly string[], defaultEffort: string, isDefault = false): Model {
  return { id, model: id, displayName: label, description: "Synthetic E7 local display/intent fixture, not native eligibility",
    hidden: false, isDefault, upgrade: null, upgradeInfo: null, availabilityNux: null,
    supportedReasoningEfforts: efforts.map((reasoningEffort) => ({ reasoningEffort, description: reasoningEffort })),
    defaultReasoningEffort: defaultEffort, inputModalities: ["text"], supportsPersonality: false, additionalSpeedTiers: [], serviceTiers: [], defaultServiceTier: null };
}
const four = () => [model(TERRA, TL, ["low"], "low", true), model(SOL, SL, ["low", "medium", "high"], "high")];
const holes = () => [model(TERRA, TL, ["low"], "low", true), model(SOL, SL, ["medium", "xhigh"], "medium")];
function Editor({ owner }: { owner: string }) {
  const draft = useSessionTextDraft(owner);
  return <div className="session-rich-draft"><textarea aria-label="E7 草稿" value={draft.inputValue} onChange={(event) => draft.setInputValue(event.currentTarget.value)} /></div>;
}
function ReloadControl({ holder }: { holder: { current: null | (() => Promise<void>) } }) {
  const { reload } = useModels();
  useEffect(() => { holder.current = reload; return () => { holder.current = null; }; }, [holder, reload]);
  return null;
}
async function mount({ expanded = false, selected = SOL, raw = "medium", mode = null, catalog = four(), enabled, pending, retainedError = false }: {
  expanded?: boolean; selected?: string; raw?: string | null; mode?: Mode; catalog?: Model[]; enabled?: readonly string[];
  pending?: Promise<ModelListResponse>; retainedError?: boolean;
} = {}) {
  prefs().setSelectionMode(mode); if (enabled) prefs().setEnabledReasoningEfforts(enabled);
  const response: ModelListResponse = { data: catalog, nextCursor: null };
  api.listModels.mockReturnValue(pending ?? Promise.resolve(response));
  hydrateThreadModel(A, { model: "e7-preserved-other-provider", modelProvider: "fixture-other", reasoningEffort: "low", serviceTier: null });
  hydrateThreadModel(A, nativeThreadSettings({ model: selected, modelProvider: "openai", reasoningEffort: raw, serviceTier: "fast",
    activePermissionProfile: { id: "fixture-e7-profile", extends: null }, runtimeWorkspaceRoots: ["/fixture/e7/root"],
    sandbox: { type: "readOnly", networkAccess: false }, approvalPolicy: "on-request", approvalsReviewer: "user" }));
  hydrateThreadModel(B, { model: "e7-b-model", modelProvider: "fixture-other", reasoningEffort: "low", serviceTier: null });
  const owner = sessionDraftKey("codex", A, CWD), other = sessionDraftKey("codex", B);
  useSessionDraftStore.getState().setText(owner, DRAFT); useSessionDraftStore.getState().setText(other, "E7 B 草稿");
  const before = { a: entry(), aValue: structuredClone(entry()), b: useThreadModelStore.getState().threads[B], defaults: useConfigStore.getState(), custom: useModelSettingsStore.getState(),
    text: useSessionDraftStore.getState(), rich: useComposerDraftStore.getState(), prefs: prefs(), recent: recentModelConfigs(), response: structuredClone(response),
    records: [...catalog], efforts: catalog.map((record) => record.supportedReasoningEfforts), tiers: catalog.map((record) => record.serviceTiers) };
  const formRef = createRef<HTMLFormElement>(), submit = vi.fn(), reloadControl: { current: null | (() => Promise<void>) } = { current: null };
  const view = render(<div className="session-mode"><section data-testid="e7-host" className={expanded ? "session-composer-sheet is-full" : "session-codex-composer"} data-draft-owner={owner}>
    <form ref={formRef} onSubmit={(event) => { event.preventDefault(); submit(); }}><Editor owner={owner} /><NativeModelSelector threadId={A} draftOwner={owner} />{retainedError && <ReloadControl holder={reloadControl} />}
      {!expanded && <ConversationMenu threadId={A} draftOwner={owner} composerRef={formRef} title="E7 当前会话" />}
    </form></section></div>);
  const editor = screen.getByRole("textbox", { name: "E7 草稿" }) as HTMLTextAreaElement;
  vi.spyOn(editor, "getClientRects").mockReturnValue({ length: 1 } as DOMRectList);
  if (pending) await waitFor(() => expect(api.listModels).toHaveBeenCalledTimes(1));
  else {
    await waitFor(() => expect(useModelCacheStore.getState().loaded).toBe(true));
    expect(useModelCacheStore.getState()).toMatchObject({ loading: false, error: null, modelStatus: "success" });
    if (retainedError) {
      api.listModels.mockRejectedValueOnce(Error("E7 retained model read failure"));
      expect(typeof reloadControl.current).toBe("function");
      await act(async () => { await reloadControl.current!(); });
      expect(useModelCacheStore.getState()).toMatchObject({ loading: false, modelStatus: "error", modelSnapshot: catalog, openAiModels: catalog });
      expect(useModelCacheStore.getState().error).toBeTruthy();
    }
  }
  return { ...view, before, response, owner, editor, submit, cache: useModelCacheStore.getState(), expanded, readCount: retainedError ? 2 : 1, pending: Boolean(pending) };
}
type Surface = Awaited<ReturnType<typeof mount>>;
function protect(s: Surface, changed = false, current = A) {
  expect(s.before.a).toEqual(s.before.aValue); if (!changed) expect(entry()).toBe(s.before.a);
  expect(useThreadModelStore.getState().threads[B]).toBe(s.before.b); expect(useConfigStore.getState()).toBe(s.before.defaults);
  expect(useModelSettingsStore.getState()).toBe(s.before.custom); expect(useSessionDraftStore.getState()).toBe(s.before.text); expect(useComposerDraftStore.getState()).toBe(s.before.rich);
  expect(prefs().enabledReasoningEfforts).toBe(s.before.prefs.enabledReasoningEfforts);
  expect(prefs().setSelectionMode).toBe(s.before.prefs.setSelectionMode); expect(prefs().setEnabledReasoningEfforts).toBe(s.before.prefs.setEnabledReasoningEfforts);
  expect(useCodexStore.getState().currentThreadId).toBe(current); expect(useCodexStore.getState().account).toBeNull();
  expect(s.editor.value).toBe(DRAFT); expect(s.editor.isConnected).toBe(true); expect(s.editor.closest('[data-draft-owner]')?.getAttribute('data-draft-owner')).toBe(s.owner);
  expect(s.submit).not.toHaveBeenCalled(); expect(globalThis.fetch).not.toHaveBeenCalled();
  expect(useModelCacheStore.getState()).toBe(s.cache); expect(s.response).toEqual(s.before.response);
  if (!s.pending) {
    expect(s.cache.openAiModels).toBe(s.response.data); expect(s.cache.modelSnapshot).toBe(s.response.data);
    s.response.data.forEach((record, i) => { expect(record).toBe(s.before.records[i]); expect(record.supportedReasoningEfforts).toBe(s.before.efforts[i]); expect(record.serviceTiers).toBe(s.before.tiers[i]); });
  }
  for (const read of Object.values(api)) { expect(read).toHaveBeenCalledTimes(s.readCount); expect(read).toHaveBeenCalledWith(); }
  if (changed) {
    const stable = (value: typeof s.before.a) => { const { model, providerModels, reasoningEffort, revision, pending, pendingFields, notice, ...rest } = value; return rest; };
    expect(stable(entry())).toEqual(stable(s.before.aValue));
    expect(entry().providerModels).toEqual({ ...s.before.a.providerModels, openai: entry().model });
    for (const key of ["nativePermissionMetadata", "nativeSettings", "observed"] as const) expect(entry()[key]).toBe(s.before.a[key]);
  }
}
const trigger = () => screen.getByRole("button", { name: /^模型：/ });
async function open(s: Surface) {
  fireEvent.keyDown(trigger(), { key: "ArrowDown", code: "ArrowDown" });
  const menu = await screen.findByRole("menu");
  vi.spyOn(menu, "getClientRects").mockReturnValue({ length: 1 } as DOMRectList);
  protect(s); return menu;
}
async function advanced(menu: HTMLElement) {
  if (!menu.querySelector('[data-model-picker-view="advanced"]')) {
    const caption = within(menu).getByRole("menuitem", { name: "选择模型" });
    fireEvent.pointerDown(caption, { button: 0, pointerType: "mouse" }); fireEvent.click(caption);
  }
  await waitFor(() => expect(menu.querySelector('[data-model-picker-view="advanced"]')).not.toBeNull());
}
function defaultRow(menu: HTMLElement) {
  const row = within(menu).getByRole("menuitemradio", { name: /^默认/ });
  expect(row.textContent).toContain("推荐模型集"); return row;
}
async function clickRow(menu: HTMLElement, label: string) {
  const row = within(menu).getByRole("menuitemradio", { name: label });
  expect(row.getAttribute("aria-disabled")).not.toBe("true"); fireEvent.pointerDown(row, { button: 0, pointerType: "mouse" }); fireEvent.click(row);
  await waitFor(() => expect(menu.querySelector('[data-model-picker-view="simple"]')).not.toBeNull());
}
function power(menu: HTMLElement) {
  const slider = menu.querySelector<HTMLElement>(".session-native-power-slider"); expect(slider).not.toBeNull();
  expect(slider!.closest('[hidden],[inert],[aria-hidden="true"]')).toBeNull();
  vi.spyOn(slider!, "getClientRects").mockReturnValue({ length: 1 } as DOMRectList);
  vi.spyOn(slider!, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 240, bottom: 24, width: 240, height: 24, toJSON: () => ({}) });
  return slider!;
}
function wheel(slider: HTMLElement, deltaY: number) {
  const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaX: 0, deltaY, deltaMode: 0 });
  act(() => { slider.dispatchEvent(event); }); return event;
}
async function close(menu: HTMLElement) { fireEvent.keyDown(menu, { key: "Escape", code: "Escape" }); await waitFor(() => expect(menu.isConnected).toBe(false)); }
function watch() {
  const entries: Array<{ model: string; reasoningEffort: string | null; serviceTier: string | null | undefined; revision: number; mode: Mode }> = [];
  const modes: Mode[] = []; let overflow = false;
  const a = useThreadModelStore.subscribe((state, prev) => {
    if (state.threads[A] === prev.threads[A]) return;
    if (entries.length >= 8) { overflow = true; return; }
    const value = state.threads[A]; entries.push({ model: value.model, reasoningEffort: value.reasoningEffort, serviceTier: value.serviceTier, revision: value.revision, mode: prefs().selectionMode });
  });
  const p = useNativeModelPickerPreferencesStore.subscribe((state, prev) => {
    if (state.selectionMode === prev.selectionMode) return;
    if (modes.length >= 8) { overflow = true; return; } modes.push(state.selectionMode);
  });
  return { entries, modes, overflow: () => overflow, stop: () => { a(); p(); } };
}
function status(menu: HTMLElement, count: number, position: number) {
  expect.soft(menu.querySelectorAll(".session-native-power-dot")).toHaveLength(count);
  expect.soft(within(menu).getByRole("status").textContent).toContain("第 " + position + " 项，共 " + count + " 项");
}
async function command(label: typeof COMMANDS[number]) {
  fireEvent.keyDown(screen.getByRole("button", { name: "当前会话的更多操作" }), { key: "ArrowDown", code: "ArrowDown" });
  const item = await screen.findByRole("menuitem", { name: label }); expect(item.getAttribute("aria-disabled")).not.toBe("true");
  const menu = item.closest('[role="menu"]')!; fireEvent.click(item); await waitFor(() => expect(menu.isConnected).toBe(false));
}
beforeEach(() => {
  vi.restoreAllMocks(); vi.resetAllMocks(); vi.stubGlobal("fetch", vi.fn().mockRejectedValue(Error("Unexpected E7 transport")));
  api.listOtherModels.mockResolvedValue([]); api.listConfigProviders.mockResolvedValue([]); api.listProviderPresets.mockResolvedValue([]);
  useModelCacheStore.setState(useModelCacheStore.getInitialState(), true); useThreadModelStore.setState({ threads: {} });
  useSessionDraftStore.setState({ drafts: {}, migrated: [] }); useComposerDraftStore.setState({ drafts: {}, error: null });
  useModelSettingsStore.setState({ models: { "fixture-other": [{ id: "e7-custom", name: "E7 自定义保留" }] } });
  useConfigStore.setState({ model: "e7-global", modelProvider: "openai", reasoningEffort: "high", serviceTier: null, providerModels: { openai: "e7-global", "fixture-other": "e7-other-slot" } });
  useCodexStore.setState({ currentThreadId: A, account: null }); useLayoutStore.setState({ view: "agent" }); useAgentSettingsStore.setState({ selectedAgent: "codex" });
  useAcpStore.setState({ active: false }); useWorkspaceStore.setState({ cwd: CWD });
  prefs().setSelectionMode(null); prefs().setEnabledReasoningEfforts(DEFAULT_NATIVE_PICKER_REASONING_EFFORTS); resetRecentModels();
});
afterEach(() => { try { expect(globalThis.fetch).not.toHaveBeenCalled(); } finally { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); } });

it("mount/derive/hover do not seed FI or repair raw null", async () => {
  const s = await mount({ raw: null }); protect(s); fireEvent.pointerEnter(trigger()); fireEvent.focus(trigger()); protect(s);
  expect(prefs()).toBe(s.before.prefs); expect(prefs().selectionMode).toBeNull(); expect(entry()).toBe(s.before.a); expect(recentModelConfigs()).toEqual(s.before.recent);
});
it.each([{ expanded: false }, { expanded: true }])("seeds actual default only on an admitted real open / expanded=$expanded", async ({ expanded }) => {
  const s = await mount({ expanded, raw: null }), watched = watch();
  try {
    const menu = await open(s); protect(s); expect(entry()).toBe(s.before.a); expect(entry()).toEqual(s.before.aValue); expect(recentModelConfigs()).toEqual(s.before.recent);
    const openedAccent = menu.querySelector(".session-native-power-effort")?.getAttribute("data-accent") ?? null;
    await advanced(menu); protect(s);
    expect.soft(prefs().selectionMode).toBe("default"); expect.soft(watched.modes).toEqual(["default"]); expect(watched.entries).toEqual([]); expect(watched.overflow()).toBe(false);
    expect.soft(openedAccent).toBe("false");
    expect.soft(within(menu).queryByRole("menuitemradio", { name: /^默认/ })).not.toBeNull();
    const row = within(menu).queryByRole("menuitemradio", { name: /^默认/ });
    if (row) expect.soft(row.getAttribute("aria-checked")).toBe("true");
    expect.soft(within(menu).getByRole("menuitemradio", { name: SL }).getAttribute("aria-checked")).toBe("false");
  } finally { watched.stop(); }
});
it("seeds model outside Et instead of repairing null or always saving default", async () => {
  const s = await mount({ selected: TERRA, raw: null }); const menu = await open(s); protect(s);
  expect(entry()).toBe(s.before.a); expect(recentModelConfigs()).toEqual(s.before.recent); expect.soft(prefs().selectionMode).toBe("model");
  expect.soft(menu.querySelector('[data-model-picker-view="advanced"]')).not.toBeNull();
});
it("below-three families show no Default while real null open seeds model", async () => {
  const s = await mount({ selected: SOL, raw: "low", catalog: [model(TERRA, TL, ["low"], "low", true), model(SOL, SL, ["low"], "low")] });
  const menu = await open(s); protect(s); await advanced(menu); protect(s);
  expect(within(menu).queryByRole("menuitemradio", { name: /^默认/ })).toBeNull(); expect.soft(prefs().selectionMode).toBe("model");
});
it("secondary family uses compact declaration order while the raw order stays untouched", async () => {
  const s = await mount({ selected: TERRA, raw: "medium", mode: "default", catalog: [model(TERRA, TL, ["high", "low", "medium"], "high", true)] });
  const menu = await open(s); protect(s); expect(entry()).toBe(s.before.a); status(menu, 3, 2); expect(prefs()).toBe(s.before.prefs);
});
it("selected Default keeps pair/raw null/tier and does not jump to a different TX target", async () => {
  const s = await mount({ raw: null, mode: "default" }), menu = await open(s); await advanced(menu); protect(s); const watched = watch();
  try {
    const row = defaultRow(menu); expect(row.getAttribute("aria-checked")).toBe("true"); fireEvent.pointerDown(row, { button: 0 }); fireEvent.click(row);
    protect(s); expect(entry()).toBe(s.before.a); expect(prefs()).toBe(s.before.prefs); expect(recentModelConfigs()).toEqual(s.before.recent);
    expect(watched.entries).toEqual([]); expect(watched.modes).toEqual([]); expect(watched.overflow()).toBe(false);
    expect(menu.querySelector('[data-model-picker-view="simple"]')).not.toBeNull(); status(menu, 4, 3);
  } finally { watched.stop(); }
});
it("explicit Reset restores the recommended pair and leaves speed and drafts intact", async () => {
  const s = await mount({ mode: "model" }), menu = await open(s), watched = watch();
  try {
    const reset = within(menu).getByRole("menuitem", { name: "恢复默认" });
    fireEvent.click(reset);
    protect(s, true);
    expect(entry()).toMatchObject({ model: TERRA, reasoningEffort: "low", serviceTier: "fast", pending: true });
    expect(prefs().selectionMode).toBe("default");
    expect(recentModelConfigs()).toEqual(s.before.recent);
    expect(watched.entries).toHaveLength(1);
    expect(watched.entries[0].mode).toBe("default");
    expect(menu.isConnected).toBe(true);
    expect(menu.querySelector('[data-model-picker-view="simple"]')).not.toBeNull();
    expect(within(menu).queryByRole("menuitem", { name: "恢复默认" })).toBeNull();
  } finally { watched.stop(); }
});
it("default presentation has no explicit-model Reset action", async () => {
  const s = await mount({ mode: "default" }), menu = await open(s);
  expect(within(menu).queryByRole("menuitem", { name: "恢复默认" })).toBeNull();
  protect(s);
});
it("Reset cannot edit a composer whose captured owner has changed", async () => {
  const s = await mount({ mode: "model" }), menu = await open(s);
  const reset = within(menu).getByRole("menuitem", { name: "恢复默认" });
  screen.getByTestId("e7-host").dataset.draftOwner = "another-owner";
  fireEvent.click(reset);
  expect(entry()).toBe(s.before.a);
  expect(prefs().selectionMode).toBe("model");
  expect(recentModelConfigs()).toEqual(s.before.recent);
  expect(s.submit).not.toHaveBeenCalled();
});
it.each([{ expanded: false }, { expanded: true }])("current row from Default writes only FI and keeps complete A entry / expanded=$expanded", async ({ expanded }) => {
  const s = await mount({ expanded, raw: null, mode: "default" }), menu = await open(s);
  const openedAccent = menu.querySelector(".session-native-power-effort")?.getAttribute("data-accent") ?? null;
  await advanced(menu); protect(s); const watched = watch();
  try {
    const current = within(menu).getByRole("menuitemradio", { name: SL }); const checkedBefore = current.getAttribute("aria-checked");
    await clickRow(menu, SL); protect(s); expect(entry()).toBe(s.before.a); expect(entry()).toEqual(s.before.aValue); expect(watched.entries).toEqual([]);
    expect(recentModelConfigs()[0]).toMatchObject({ model: SOL, reasoningEffort: null, serviceTier: "fast" }); expect(watched.overflow()).toBe(false);
    expect.soft(checkedBefore).toBe("false"); expect.soft(prefs().selectionMode).toBe("model"); expect.soft(watched.modes).toEqual(["model"]); status(menu, 3, 2);
    expect.soft(openedAccent).toBe("false"); expect.soft(menu.querySelector(".session-native-power-effort")?.getAttribute("data-accent")).toBe("true");
  } finally { watched.stop(); }
});
it("unselected Default saves FI before one omitted-tier pair publication and adds no recent entry", async () => {
  const s = await mount({ mode: "model" }), menu = await open(s); await advanced(menu); protect(s); const watched = watch();
  try {
    const row = defaultRow(menu); expect(row.getAttribute("aria-checked")).toBe("false"); fireEvent.pointerDown(row, { button: 0 }); fireEvent.click(row);
    protect(s, true); expect(entry()).toMatchObject({ model: TERRA, reasoningEffort: "low", serviceTier: "fast", revision: s.before.a.revision + 1, pending: true });
    expect(entry().pendingFields).toEqual(expect.arrayContaining(["model", "reasoningEffort"])); expect(entry().pendingFields).not.toContain("serviceTier");
    expect(recentModelConfigs()).toEqual(s.before.recent); expect(watched.modes).toEqual(["default"]); expect(watched.overflow()).toBe(false);
    expect(watched.entries).toEqual([{ model: TERRA, reasoningEffort: "low", serviceTier: "fast", revision: s.before.a.revision + 1, mode: "default" }]); status(menu, 4, 1);
  } finally { watched.stop(); }
});
it("one compact Default pair list drives arrow/wheel/pointer/status without FI or row-tier cleanup", async () => {
  const s = await mount({ selected: TERRA, raw: "low", mode: "default", catalog: holes() }), menu = await open(s), slider = power(menu), watched = watch();
  try {
    expect([...menu.querySelectorAll<HTMLElement>(".session-native-power-dot")].map((dot) => dot.style.left)).toEqual(["13px", "100px", "187px"]);
    status(menu, 3, 1); fireEvent.keyDown(menu.querySelector<HTMLElement>('[data-reasoning-slider]')!, { key: "ArrowRight", code: "ArrowRight" });
    protect(s, true); expect(entry()).toMatchObject({ model: SOL, reasoningEffort: "medium", serviceTier: "fast" }); status(menu, 3, 2);
    expect(wheel(slider, -30).defaultPrevented).toBe(true); protect(s, true); expect(entry()).toMatchObject({ model: SOL, reasoningEffort: "xhigh", serviceTier: "fast" }); status(menu, 3, 3);
    fireEvent.pointerDown(slider, { button: 0, pointerId: 1, pointerType: "mouse", clientX: 0, clientY: 12 });
    protect(s, true); expect(entry()).toMatchObject({ model: TERRA, reasoningEffort: "low", serviceTier: "fast" }); status(menu, 3, 1);
    expect(prefs()).toBe(s.before.prefs); expect(watched.modes).toEqual([]); expect(watched.overflow()).toBe(false);
    expect(watched.entries.map(({ model, reasoningEffort, serviceTier }) => ({ model, reasoningEffort, serviceTier }))).toEqual([
      { model: SOL, reasoningEffort: "medium", serviceTier: "fast" }, { model: SOL, reasoningEffort: "xhigh", serviceTier: "fast" }, { model: TERRA, reasoningEffort: "low", serviceTier: "fast" }]);
    expect(recentModelConfigs()[0]).toMatchObject({ model: TERRA, label: TL, reasoningEffort: "low", serviceTier: "fast" });
  } finally { watched.stop(); }
});
it("three commands still use current singleton gt rather than neighbouring Default Et", async () => {
  const s = await mount({ selected: TERRA, raw: "low", mode: "default" });
  for (const label of COMMANDS) { await command(label); protect(s); expect(entry()).toBe(s.before.a); expect(prefs()).toBe(s.before.prefs); expect(recentModelConfigs()).toEqual(s.before.recent); }
});
it("explicit model mode keeps only current Sol physical pairs and does not seed again", async () => {
  const s = await mount({ mode: "model", catalog: holes() }), menu = await open(s); protect(s); power(menu); status(menu, 2, 1);
  expect(prefs()).toBe(s.before.prefs); expect(entry()).toBe(s.before.a);
});
it.each([{ efforts: [] }, { efforts: ["persistent"] }])("known $efforts keeps advanced placeholder domain rather than unknown six", async ({ efforts }) => {
  const s = await mount({ selected: EMPTY, raw: null, mode: "model", catalog: [...four(), model(EMPTY, "E7 空目录模型", efforts, "medium")] }), menu = await open(s); protect(s); await advanced(menu); protect(s);
  expect(menu.querySelector('[data-reasoning-slider]')).toBeNull(); expect(menu.querySelectorAll('.session-native-power-dot')).toHaveLength(0);
  expect(entry()).toBe(s.before.a); expect(prefs()).toBe(s.before.prefs);
  expect.soft(within(menu).queryByRole("menuitemradio", { name: /^默认/ })).not.toBeNull();
});
it("empty own preferences keep unknown six with no Default and no raw none repair", async () => {
  const s = await mount({ selected: UNKNOWN, raw: "none", mode: "model", enabled: [] }), menu = await open(s); protect(s); power(menu); status(menu, 6, 3);
  await advanced(menu); protect(s); expect(within(menu).queryByRole("menuitemradio", { name: /^默认/ })).toBeNull(); expect(entry().reasoningEffort).toBe("none"); expect(prefs()).toBe(s.before.prefs);
});
it.each([{ condition: "hidden" }, { condition: "inert" }, { condition: "owner" }])("rejects null-seed admission from $condition composer", async ({ condition }) => {
  const s = await mount({ raw: null }), host = screen.getByTestId("e7-host"), ownedTrigger = trigger();
  if (condition === "owner") act(() => useCodexStore.setState({ currentThreadId: B })); else host.setAttribute(condition, "");
  try {
    fireEvent.keyDown(ownedTrigger, { key: "ArrowDown", code: "ArrowDown" });
    protect(s, false, condition === "owner" ? B : A); expect(prefs()).toBe(s.before.prefs); expect(entry()).toBe(s.before.a); expect(recentModelConfigs()).toEqual(s.before.recent);
  } finally { host.removeAttribute("hidden"); host.removeAttribute("inert"); }
});
it("retained model-read error keeps admitted opening but disables Default without raw repair", async () => {
  const s = await mount({ raw: null, retainedError: true }), menu = await open(s); await advanced(menu); protect(s);
  expect(defaultRow(menu).getAttribute("aria-disabled")).toBe("true"); expect(entry()).toBe(s.before.a); expect(recentModelConfigs()).toEqual(s.before.recent); expect.soft(prefs().selectionMode).toBe("default");
});
it("saved default outside Et stays saved and resumes effective default after explicit pair intent", async () => {
  const s = await mount({ selected: TERRA, raw: null, mode: "default" }), menu = await open(s);
  expect(menu.querySelector('[data-model-picker-view="advanced"]')).not.toBeNull();
  expect(menu.querySelector(".session-native-power-effort")).toBeNull();
  await advanced(menu); protect(s);
  const row = defaultRow(menu), watched = watch();
  try {
    expect(row.getAttribute("aria-checked")).toBe("false");
    expect(within(menu).getByRole("menuitemradio", { name: TL }).getAttribute("aria-checked")).toBe("true");
    expect(prefs()).toBe(s.before.prefs); expect(entry()).toBe(s.before.a);
    fireEvent.pointerDown(row, { button: 0 }); fireEvent.click(row); protect(s, true);
    expect(entry()).toMatchObject({ model: TERRA, reasoningEffort: "low", serviceTier: "fast", revision: s.before.a.revision + 1 });
    expect(watched.modes).toEqual([]); expect(prefs()).toBe(s.before.prefs); expect(recentModelConfigs()).toEqual(s.before.recent);
    expect(watched.entries).toEqual([{ model: TERRA, reasoningEffort: "low", serviceTier: "fast", revision: s.before.a.revision + 1, mode: "default" }]);
    const returnedDefaultAccent = menu.querySelector(".session-native-power-effort")?.getAttribute("data-accent") ?? null;
    await advanced(menu); expect(defaultRow(menu).getAttribute("aria-checked")).toBe("true"); expect(watched.overflow()).toBe(false);
    expect.soft(returnedDefaultAccent).toBe("false");
  } finally { watched.stop(); }
});
it("a genuinely pending first model read cannot seed or open", async () => {
  let finish!: (value: ModelListResponse) => void;
  const pending = new Promise<ModelListResponse>((resolve) => { finish = resolve; });
  const s = await mount({ raw: null, pending });
  try {
    const loading = screen.getByRole("button", { name: "Loading model…" }); expect((loading as HTMLButtonElement).disabled).toBe(true); fireEvent.click(loading);
    protect(s); expect(prefs()).toBe(s.before.prefs); expect(screen.queryByRole("menu")).toBeNull(); expect(entry()).toBe(s.before.a);
  } finally { s.unmount(); await act(async () => { finish(s.response); await pending; }); }
});
it("close350ms resets only transient view and preserves non-null FI/raw entry", async () => {
  const s = await mount({ mode: "default" }); const menu = await open(s); await advanced(menu); protect(s); await close(menu);
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 360)); });
  protect(s); expect(prefs()).toBe(s.before.prefs); const next = await open(s); protect(s);
  expect(next.querySelector('[data-model-picker-view="simple"]')).not.toBeNull(); expect(entry()).toBe(s.before.a); status(next, 4, 3);
});

for (const condition of ["missing-root", "replacement-root", "content-rect0"] as const) {
  it.each([{ action: "row" }, { action: "default" }, { action: "power" }] as const)("old real-root layer rejects $action after " + condition, async ({ action }) => {
    const s = await mount({ mode: action === "default" ? "model" : "default" }), menu = await open(s);
    if (action !== "power") await advanced(menu);
    const row = action === "row" ? within(menu).getByRole("menuitemradio", { name: SL }) : action === "default" ? defaultRow(menu) : null;
    const slider = action === "power" ? power(menu) : null;
    const keyboard = action === "power" ? menu.querySelector<HTMLElement>('[data-reasoning-slider]') : null;
    if (row) expect(row.getAttribute("aria-disabled")).not.toBe("true");
    if (action === "power") expect(keyboard).not.toBeNull();
    const root = s.editor.closest<HTMLElement>(".session-mode"); expect(root).not.toBeNull();
    expect(root!.isConnected).toBe(true); expect(root!.contains(menu)).toBe(true);
    expect(document.querySelector(".session-mode")).toBe(root); protect(s);
    const rootClass = root!.className, beforePrefs = prefs(), beforeRecent = recentModelConfigs(), watched = watch();
    const menuRects = vi.mocked(menu.getClientRects); let replacement: HTMLDivElement | null = null;
    try {
      if (condition === "content-rect0") menuRects.mockReturnValue({ length: 0 } as DOMRectList);
      else {
        root!.classList.remove("session-mode");
        if (condition === "replacement-root") {
          replacement = document.createElement("div"); replacement.className = "session-mode";
          root!.parentNode!.insertBefore(replacement, root!);
        }
        expect(document.querySelector(".session-mode")).toBe(replacement); expect(root!.contains(menu)).toBe(true);
      }
      expect(menu.isConnected).toBe(true); expect(s.editor.isConnected).toBe(true);
      if (row) { fireEvent.pointerDown(row, { button: 0, pointerType: "mouse" }); fireEvent.click(row); }
      else {
        fireEvent.pointerDown(slider!, { button: 0, pointerId: 1, pointerType: "mouse", clientX: 239, clientY: 12 });
        fireEvent.keyDown(keyboard!, { key: "ArrowRight", code: "ArrowRight" }); wheel(slider!, -30);
      }
      protect(s); expect(entry()).toBe(s.before.a); expect(entry()).toEqual(s.before.aValue);
      expect(prefs()).toBe(beforePrefs); expect(recentModelConfigs()).toEqual(beforeRecent);
      expect(watched.entries).toEqual([]); expect(watched.modes).toEqual([]); expect(watched.overflow()).toBe(false);
    } finally {
      watched.stop(); root!.className = rootClass; replacement?.remove();
      menuRects.mockReturnValue({ length: 1 } as DOMRectList);
    }
  });
}
