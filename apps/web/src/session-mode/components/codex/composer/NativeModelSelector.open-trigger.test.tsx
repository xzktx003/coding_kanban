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
import { recentModelConfigs, resetRecentModels } from "./recentModelConfigs";
import { useComposerDraftStore } from "./v2/drafts";

const api = vi.hoisted(() => ({ listModels: vi.fn(), listOtherModels: vi.fn(), listConfigProviders: vi.fn(), listProviderPresets: vi.fn() }));
vi.mock("@session/services/apiAdapt", async (original) => ({ ...(await original<typeof import("@session/services/apiAdapt")>()), ...api }));
const A = "e8-open-a", B = "e8-open-b", CWD = "/fixture/e8";
const TERRA = "gpt-5.6-terra", SOL = "gpt-5.6-sol", EMPTY = "e8-known-empty", UNKNOWN = "e8-unknown";
const TL = "E8 Terra", SL = "E8 Sol", DRAFT = "E8 原草稿\n保持另一会话与附件";
type Mode = "default" | "model" | null;
const entry = () => useThreadModelStore.getState().threads[A];
const prefs = () => useNativeModelPickerPreferencesStore.getState();
function model(id: string, label: string, efforts: readonly string[], defaultEffort: string, isDefault = false): Model {
  return { id, model: id, displayName: label, description: "Synthetic E8 local display/intent fixture, not native eligibility",
    hidden: false, isDefault, upgrade: null, upgradeInfo: null, availabilityNux: null,
    supportedReasoningEfforts: efforts.map((reasoningEffort) => ({ reasoningEffort, description: reasoningEffort })),
    defaultReasoningEffort: defaultEffort, inputModalities: ["text"], supportsPersonality: false, additionalSpeedTiers: [], serviceTiers: [], defaultServiceTier: null };
}
const four = () => [model(TERRA, TL, ["low"], "low", true), model(SOL, SL, ["low", "medium", "high"], "high")];
const holes = () => [model(TERRA, TL, ["low"], "low", true), model(SOL, SL, ["medium", "xhigh"], "medium")];
function Editor({ owner }: { owner: string }) {
  const draft = useSessionTextDraft(owner);
  return <div className="session-rich-draft"><textarea aria-label="E8 草稿" value={draft.inputValue} onChange={(event) => draft.setInputValue(event.currentTarget.value)} /></div>;
}
function ReloadControl({ holder }: { holder: { current: null | (() => Promise<void>) } }) {
  const { reload } = useModels();
  useEffect(() => { holder.current = reload; return () => { holder.current = null; }; }, [holder, reload]);
  return null;
}
async function mount({ expanded = false, selected = SOL, raw = "medium", mode = null, catalog = four(), enabled, pending, retainedError = false, ancillary, primaryError = false }: {
  expanded?: boolean; selected?: string; raw?: string | null; mode?: Mode; catalog?: Model[]; enabled?: readonly string[];
  pending?: Promise<ModelListResponse>; retainedError?: boolean; ancillary?: Promise<[]>; primaryError?: boolean;
} = {}) {
  prefs().setSelectionMode(mode); if (enabled) prefs().setEnabledReasoningEfforts(enabled);
  const response: ModelListResponse = { data: catalog, nextCursor: null };
  api.listModels.mockReturnValue(primaryError ? Promise.reject(Error("E8 primary model failure")) : pending ?? Promise.resolve(response));
  if (ancillary) api.listConfigProviders.mockReturnValue(ancillary);
  hydrateThreadModel(A, { model: "e8-preserved-other-provider", modelProvider: "fixture-other", reasoningEffort: "low", serviceTier: null });
  hydrateThreadModel(A, nativeThreadSettings({ model: selected, modelProvider: "openai", reasoningEffort: raw, serviceTier: "fast",
    activePermissionProfile: { id: "fixture-e8-profile", extends: null }, runtimeWorkspaceRoots: ["/fixture/e8/root"],
    sandbox: { type: "readOnly", networkAccess: false }, approvalPolicy: "on-request", approvalsReviewer: "user" }));
  hydrateThreadModel(B, { model: "e8-b-model", modelProvider: "fixture-other", reasoningEffort: "low", serviceTier: null });
  const owner = sessionDraftKey("codex", A, CWD), other = sessionDraftKey("codex", B);
  useSessionDraftStore.getState().setText(owner, DRAFT); useSessionDraftStore.getState().setText(other, "E8 B 草稿");
  const before = { a: entry(), aValue: structuredClone(entry()), b: useThreadModelStore.getState().threads[B], defaults: useConfigStore.getState(), custom: useModelSettingsStore.getState(),
    text: useSessionDraftStore.getState(), rich: useComposerDraftStore.getState(), prefs: prefs(), recent: recentModelConfigs(), response: structuredClone(response),
    records: [...catalog], efforts: catalog.map((record) => record.supportedReasoningEfforts), tiers: catalog.map((record) => record.serviceTiers) };
  const formRef = createRef<HTMLFormElement>(), submit = vi.fn(), reloadControl: { current: null | (() => Promise<void>) } = { current: null };
  const view = render(<div className="session-mode"><section data-testid="e8-host" className={expanded ? "session-composer-sheet is-full" : "session-codex-composer"} data-draft-owner={owner}>
    <form ref={formRef} onSubmit={(event) => { event.preventDefault(); submit(); }}><Editor owner={owner} /><NativeModelSelector threadId={A} draftOwner={owner} />{retainedError && <ReloadControl holder={reloadControl} />}
    </form></section></div>);
  const editor = screen.getByRole("textbox", { name: "E8 草稿" }) as HTMLTextAreaElement;
  vi.spyOn(editor, "getClientRects").mockReturnValue({ length: 1 } as DOMRectList);
  if (pending) await waitFor(() => expect(api.listModels).toHaveBeenCalledTimes(1));
  else if (primaryError) await waitFor(() => expect(useModelCacheStore.getState()).toMatchObject({ modelStatus: "error", loading: false }));
  else if (ancillary) await waitFor(() => expect(useModelCacheStore.getState().modelStatus).toBe("success"));
  else {
    await waitFor(() => expect(useModelCacheStore.getState().loaded).toBe(true));
    expect(useModelCacheStore.getState()).toMatchObject({ loading: false, error: null, modelStatus: "success" });
    if (retainedError) {
      api.listModels.mockRejectedValueOnce(Error("E8 retained model read failure"));
      expect(typeof reloadControl.current).toBe("function");
      await act(async () => { await reloadControl.current!(); });
      expect(useModelCacheStore.getState()).toMatchObject({ loading: false, modelStatus: "error", modelSnapshot: catalog, openAiModels: catalog });
      expect(useModelCacheStore.getState().error).toBeTruthy();
    }
  }
  return { ...view, before, response, owner, editor, submit, cache: useModelCacheStore.getState(), expanded, readCount: retainedError ? 2 : 1, pending: Boolean(pending), dataReady: !pending && !primaryError };
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
  if (s.dataReady) {
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
beforeEach(() => {
  vi.restoreAllMocks(); vi.resetAllMocks(); vi.stubGlobal("fetch", vi.fn().mockRejectedValue(Error("Unexpected E8 transport")));
  api.listOtherModels.mockResolvedValue([]); api.listConfigProviders.mockResolvedValue([]); api.listProviderPresets.mockResolvedValue([]);
  useModelCacheStore.setState(useModelCacheStore.getInitialState(), true); useThreadModelStore.setState({ threads: {} });
  useSessionDraftStore.setState({ drafts: {}, migrated: [] }); useComposerDraftStore.setState({ drafts: {}, error: null });
  useModelSettingsStore.setState({ models: { "fixture-other": [{ id: "e8-custom", name: "E8 自定义保留" }] } });
  useConfigStore.setState({ model: "e8-global", modelProvider: "openai", reasoningEffort: "high", serviceTier: null, providerModels: { openai: "e8-global", "fixture-other": "e8-other-slot" } });
  useCodexStore.setState({ currentThreadId: A, account: null }); useLayoutStore.setState({ view: "agent" }); useAgentSettingsStore.setState({ selectedAgent: "codex" });
  useAcpStore.setState({ active: false }); useWorkspaceStore.setState({ cwd: CWD });
  prefs().setSelectionMode(null); prefs().setEnabledReasoningEfforts(DEFAULT_NATIVE_PICKER_REASONING_EFFORTS); resetRecentModels();
});
afterEach(() => { try { expect(globalThis.fetch).not.toHaveBeenCalled(); } finally { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); } });

type Sample = ReturnType<typeof sample>;
function ownedTrigger(s: Surface): HTMLButtonElement {
  const node = s.container.querySelector<HTMLButtonElement>(".session-native-model-trigger");
  if (!node) throw Error("Own real model Trigger missing"); return node;
}
function sample(button: HTMLButtonElement) {
  const content = button.querySelector<HTMLElement>(".session-native-model-trigger-content");
  const placeholder = button.querySelector<HTMLElement>(".session-native-model-trigger-placeholder");
  const measurement = button.querySelector<HTMLElement>(".session-native-model-trigger-measurement");
  return { connected: button.isConnected, aria: button.getAttribute("aria-label"), expanded: button.getAttribute("aria-expanded"),
    model: button.querySelector(".session-native-model-label")?.textContent ?? null,
    effort: button.querySelector(".session-native-model-effort")?.textContent ?? null,
    purpose: placeholder?.textContent ?? null, contentExists: content !== null,
    labelledby: button.getAttribute("aria-labelledby"), minWidth: content?.style.minWidth ?? null, measurementExists: measurement !== null,
    measurementText: measurement?.textContent ?? null,
    measurementHidden: measurement?.getAttribute("aria-hidden") ?? null };
}
const frames = async () => { await act(async () => { await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); }); };
function purpose(value: Sample, expected: "选择模型" | "选择强度") {
  expect.soft(value.connected).toBe(true); expect.soft(value.expanded).toBe("true");
  expect.soft(value.aria).toBeNull(); expect.soft(value.labelledby).toBeNull(); expect.soft(value.model).toBeNull(); expect.soft(value.effort).toBeNull();
  expect.soft(value.purpose).toBe(expected); expect.soft(value.contentExists).toBe(true);
  expect.soft(value.measurementExists).toBe(true); expect.soft(value.measurementHidden).toBe("true"); expect.soft(value.measurementText).toBe(expected);
}
function current(value: Sample, selected = SOL, label = SL) {
  expect.soft(value.aria).toBe(`模型：${selected}，medium`); expect.soft(value.model).toBe(label);
  expect.soft(value.effort).toBe("中"); expect.soft(value.purpose).toBeNull();
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }

it.each([
  { expanded: false, mode: "model" as const }, { expanded: true, mode: "model" as const },
  { expanded: false, mode: "default" as const }, { expanded: true, mode: "default" as const },
])("actual simple-open purpose restores current selection through advanced/return/Escape/reopen: $mode / expanded=$expanded", async ({ expanded, mode }) => {
  const s = await mount({ expanded, raw: null, mode }), button = ownedTrigger(s), watched = watch();
  const snapshots: Record<string, Sample> = { closed: sample(button) };
  try {
    const menu = await open(s); snapshots.immediate = sample(button); await frames(); snapshots.twoRAF = sample(button);
    await waitFor(() => expect(menu.querySelector('[data-model-picker-view="simple"]')).not.toBeNull()); snapshots.settled = sample(button);
    protect(s); expect(entry()).toEqual(s.before.aValue); expect(prefs()).toBe(s.before.prefs); expect(recentModelConfigs()).toEqual(s.before.recent);
    const caption = within(menu).getByRole("menuitem", { name: "选择模型" }); expect(caption.getAttribute("aria-disabled")).not.toBe("true");
    await advanced(menu); snapshots.advanced = sample(button); protect(s); expect(prefs()).toBe(s.before.prefs);
    if (mode === "default") {
      const row = defaultRow(menu); expect(row.getAttribute("aria-checked")).toBe("true");
      fireEvent.pointerDown(row, { button: 0, pointerType: "mouse" }); fireEvent.click(row);
      expect(recentModelConfigs()).toEqual(s.before.recent);
    } else {
      await clickRow(menu, SL); expect(recentModelConfigs()[0]).toMatchObject({ model: SOL, reasoningEffort: null, serviceTier: "fast" });
    }
    await waitFor(() => expect(menu.querySelector('[data-model-picker-view="simple"]')).not.toBeNull()); snapshots.returned = sample(button);
    protect(s); expect(entry()).toBe(s.before.a); expect(entry()).toEqual(s.before.aValue); expect(prefs()).toBe(s.before.prefs);
    await advanced(menu); snapshots.beforeClose = sample(button); protect(s);
    await close(menu); await waitFor(() => expect(document.activeElement).toBe(s.editor)); snapshots.closedAfter = sample(button);
    // Preserve the existing reset boundary; no purpose timer or fake clock is introduced.
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 360)); });
    const reopened = await open(s); snapshots.reopened = sample(button);
    expect(reopened.querySelector('[data-model-picker-view="simple"]')).not.toBeNull(); await close(reopened);
    protect(s); expect(entry()).toBe(s.before.a); expect(watched.entries).toEqual([]); expect(watched.modes).toEqual([]); expect(watched.overflow()).toBe(false);
    const expected = mode === "model" ? "选择强度" : "选择模型";
    for (const key of ["immediate", "twoRAF", "settled", "returned", "reopened"]) purpose(snapshots[key], expected);
    for (const key of ["closed", "advanced", "beforeClose", "closedAfter"]) current(snapshots[key]);
    expect.soft(snapshots.closedAfter.minWidth).toBe("");
  } finally { watched.stop(); }
});
it("accepted model/list opens purpose while ancillary requests remain pending without an aggregate-success gate", async () => {
  const provider = deferred<[]>(), s = await mount({ mode: "model", ancillary: provider.promise }), button = ownedTrigger(s);
  try {
    expect(s.cache).toMatchObject({ modelStatus: "success", loaded: false, loading: true });
    const menu = await open(s), value = sample(button); protect(s); expect(entry()).toBe(s.before.a); expect(prefs()).toBe(s.before.prefs);
    expect(menu.querySelector('[data-model-picker-view="simple"]')).not.toBeNull(); await close(menu); protect(s); purpose(value, "选择强度");
  } finally { await act(async () => { provider.resolve([]); }); }
});
it("retained primary error stays legacy/current despite a nonempty usable snapshot", async () => {
  const s = await mount({ mode: "model", retainedError: true }), button = ownedTrigger(s), menu = await open(s), value = sample(button);
  protect(s); expect(entry()).toBe(s.before.a); expect(prefs()).toBe(s.before.prefs); expect(s.cache.modelStatus).toBe("error");
  expect(menu.querySelector('[data-model-picker-view="simple"]')).not.toBeNull(); await close(menu); protect(s); current(value);
});
it("primary pending remains disabled Loading and cannot seed FI/open purpose", async () => {
  const pending = deferred<ModelListResponse>(), s = await mount({ raw: null, pending: pending.promise }), button = ownedTrigger(s);
  try {
    protect(s); expect(button.disabled).toBe(true); expect(button.getAttribute("aria-label")).toBe("Loading model…");
    fireEvent.keyDown(button, { key: "ArrowDown", code: "ArrowDown" }); protect(s);
    expect(screen.queryByRole("menu")).toBeNull(); expect(prefs()).toBe(s.before.prefs); expect(entry()).toBe(s.before.a);
    expect(button.querySelector(".session-native-model-trigger-placeholder")).toBeNull();
  } finally { await act(async () => { pending.resolve(s.response); }); }
});
it("primary error without snapshot exposes no manufactured six-choice simple purpose", async () => {
  const s = await mount({ raw: null, mode: "model", primaryError: true }), button = ownedTrigger(s), menu = await open(s), value = sample(button);
  protect(s); expect(s.cache.modelStatus).toBe("error"); expect(s.cache.modelSnapshot).toBeNull();
  expect(menu.querySelector('[data-model-picker-view="advanced"]')).not.toBeNull(); expect(menu.querySelector('[data-reasoning-slider]')).toBeNull();
  expect(prefs()).toBe(s.before.prefs); await close(menu); protect(s);
  expect(value.purpose).toBeNull(); expect(value.aria).toBe(`模型：${SOL}，medium`);
});
it.each([{ efforts: [] }, { efforts: ["medium"] }])("natural known0/1 stays advanced and keeps current label: $efforts", async ({ efforts }) => {
  const s = await mount({ raw: null, mode: "model", catalog: [model(SOL, SL, efforts, "medium")] }), button = ownedTrigger(s), menu = await open(s), value = sample(button);
  protect(s); expect(entry()).toBe(s.before.a); expect(prefs()).toBe(s.before.prefs); expect(menu.querySelector('[data-model-picker-view="advanced"]')).not.toBeNull();
  expect(menu.querySelector('[data-reasoning-slider]')).toBeNull(); await close(menu); protect(s); current(value);
});
it.each(["other-owner", "hidden-host"] as const)("captured row cannot convert FI or pair after %s", async (kind) => {
  const s = await mount({ mode: "default", raw: null }), menu = await open(s); await advanced(menu);
  const row = within(menu).getByRole("menuitemradio", { name: SL }), host = s.editor.closest<HTMLElement>("[data-draft-owner]");
  if (!host) throw Error("Own fixture host missing"); const watched = watch();
  try {
    if (kind === "other-owner") act(() => useCodexStore.setState({ currentThreadId: B })); else host.hidden = true;
    fireEvent.pointerDown(row, { button: 0, pointerType: "mouse" }); fireEvent.click(row);
    protect(s, false, kind === "other-owner" ? B : A); expect(prefs()).toBe(s.before.prefs); expect(entry()).toBe(s.before.a);
    expect(watched.entries).toEqual([]); expect(watched.modes).toEqual([]); expect(recentModelConfigs()).toEqual(s.before.recent); expect(watched.overflow()).toBe(false);
  } finally { host.hidden = false; watched.stop(); }
});
it("accepted unknown keeps the six-choice current-model domain and never repairs raw none", async () => {
  const s = await mount({ selected: UNKNOWN, raw: "none", mode: "model", catalog: [] }), button = ownedTrigger(s), menu = await open(s), value = sample(button);
  protect(s); expect(entry()).toBe(s.before.a); expect(entry().reasoningEffort).toBe("none"); expect(prefs()).toBe(s.before.prefs);
  expect(menu.querySelectorAll(".session-native-power-dot")).toHaveLength(6); expect(within(menu).getByRole("status").textContent).toContain("第 3 项，共 6 项");
  await close(menu); protect(s); purpose(value, "选择强度");
});
