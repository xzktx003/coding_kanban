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
import { NativeModelTrigger } from "./NativeModelTrigger";
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
function Editor({ owner }: { owner: string }) {
  const draft = useSessionTextDraft(owner);
  return <div className="session-rich-draft"><textarea aria-label="E8 草稿" value={draft.inputValue} onChange={(event) => draft.setInputValue(event.currentTarget.value)} /></div>;
}
function ReloadControl({ holder }: { holder: { current: null | (() => Promise<void>) } }) {
  const { reload } = useModels();
  useEffect(() => { holder.current = reload; return () => { holder.current = null; }; }, [holder, reload]);
  return null;
}
async function mount({ expanded = false, selected = SOL, raw = "medium", mode = null, catalog = four(), enabled, pending, retainedError = false, ancillary, primaryError = false, provider = "openai", direct = false, ordinaryB = false }: {
  expanded?: boolean; selected?: string; raw?: string | null; mode?: Mode; catalog?: Model[]; enabled?: readonly string[];
  pending?: Promise<ModelListResponse>; retainedError?: boolean; ancillary?: Promise<[]>; primaryError?: boolean; provider?: string; direct?: boolean; ordinaryB?: boolean;
} = {}) {
  prefs().setSelectionMode(mode); if (enabled) prefs().setEnabledReasoningEfforts(enabled);
  const response: ModelListResponse = { data: catalog, nextCursor: null };
  api.listModels.mockReturnValue(primaryError ? Promise.reject(Error("E8 primary model failure")) : pending ?? Promise.resolve(response));
  if (ancillary) api.listConfigProviders.mockReturnValue(ancillary);
  hydrateThreadModel(A, { model: "e8-preserved-other-provider", modelProvider: "fixture-other", reasoningEffort: "low", serviceTier: null });
  hydrateThreadModel(A, nativeThreadSettings({ model: selected, modelProvider: provider, reasoningEffort: raw, serviceTier: "fast",
    activePermissionProfile: { id: "fixture-e8-profile", extends: null }, runtimeWorkspaceRoots: ["/fixture/e8/root"],
    sandbox: { type: "readOnly", networkAccess: false }, approvalPolicy: "on-request", approvalsReviewer: "user" }));
  hydrateThreadModel(B, ordinaryB ? { model: SOL, modelProvider: "openai", reasoningEffort: "high", serviceTier: null } : { model: "e8-b-model", modelProvider: "fixture-other", reasoningEffort: "low", serviceTier: null });
  const owner = sessionDraftKey("codex", A, CWD), other = sessionDraftKey("codex", B);
  useSessionDraftStore.getState().setText(owner, DRAFT); useSessionDraftStore.getState().setText(other, "E8 B 草稿");
  const before = { a: entry(), aValue: structuredClone(entry()), b: useThreadModelStore.getState().threads[B], defaults: useConfigStore.getState(), custom: useModelSettingsStore.getState(),
    text: useSessionDraftStore.getState(), rich: useComposerDraftStore.getState(), prefs: prefs(), recent: recentModelConfigs(), response: structuredClone(response),
    records: [...catalog], efforts: catalog.map((record) => record.supportedReasoningEfforts), tiers: catalog.map((record) => record.serviceTiers) };
  const formRef = createRef<HTMLFormElement>(), submit = vi.fn(), reloadControl: { current: null | (() => Promise<void>) } = { current: null };
  const tree = (threadId = A, draftOwner = owner) => <div className="session-mode"><section data-testid="e8-host" className={expanded ? "session-composer-sheet is-full" : "session-codex-composer"} data-draft-owner={draftOwner}>
    <form ref={formRef} onSubmit={(event) => { event.preventDefault(); submit(); }}><Editor owner={draftOwner} />{direct ? <NativeModelTrigger /> : <NativeModelSelector threadId={threadId} draftOwner={draftOwner} />}{retainedError && <ReloadControl holder={reloadControl} />}
    </form></section></div>;
  const view = render(tree());
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
  return { ...view, tree, other, before, response, owner, editor, submit, cache: useModelCacheStore.getState(), expanded, readCount: retainedError ? 2 : 1, pending: Boolean(pending), dataReady: !pending && !primaryError };
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

const tooltipSelector = '.session-native-composer-tooltip[data-slot="tooltip-content"]';
function ownButton(s: Surface): HTMLButtonElement {
  const button = s.container.querySelector<HTMLButtonElement>(".session-native-model-trigger");
  if (!button) throw Error("Owned real Trigger missing"); return button;
}
function closedSelection(button: HTMLButtonElement) {
  return { aria: button.getAttribute("aria-label"), model: button.querySelector(".session-native-model-label")?.textContent ?? null,
    effort: button.querySelector(".session-native-model-effort")?.textContent ?? null,
    placeholder: button.querySelector(".session-native-model-trigger-placeholder")?.textContent ?? null };
}
async function frames() {
  await act(async () => { await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
}

type HintIdentity = { id: string; label: string };
function modelHint(button: HTMLButtonElement, identity: HintIdentity | null) {
  const all = [...document.querySelectorAll<HTMLElement>(tooltipSelector)];
  if (all.length > 8) throw Error("Tooltip Content observation overflow");
  const ids = (button.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
  if (ids.length > 8) throw Error("Tooltip description observation overflow");
  if (identity && ids.some((id) => id !== identity.id)) throw Error("Owned Tooltip native id changed");
  const raw = all.map((content) => {
    const descriptions = [...content.querySelectorAll<HTMLElement>('[role="tooltip"]')];
    if (descriptions.length > 8) throw Error("Tooltip description copy overflow");
    return { state: content.dataset.state ?? null, label: content.querySelector(":scope > .session-native-composer-tooltip-label")?.textContent ?? null,
      connected: content.isConnected, ids: descriptions.map((item) => item.id), descriptionTexts: descriptions.map((item) => item.textContent) };
  });
  const duplicates = identity ? [...document.querySelectorAll<HTMLElement>('[role="tooltip"]')].filter((item) => item.id === identity.id) : [];
  if (duplicates.length > 1) throw Error("Duplicate owned native Tooltip id");
  const owned = identity ? raw.filter((content) => content.ids.includes(identity.id)) : [];
  if (owned.length > 1) throw Error("Owned Tooltip id occurs in multiple Content roots");
  return { describedby: ids, rawName: button.getAttribute("aria-label"), raw, owned,
    labels: owned.map((row) => row.label), count: owned.length };
}
async function initialHint(s: Surface, button: HTMLButtonElement): Promise<HintIdentity> {
  // Component DOM simulation only: genuine :focus-visible and exit paint are browser evidence.
  act(() => button.focus());
  await waitFor(() => expect(button.getAttribute("aria-describedby")).not.toBeNull());
  const ids = (button.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
  expect(ids).toHaveLength(1); const id = ids[0]; if (!id) throw Error("Initial keyboard model-hint id missing");
  const descriptions = [...document.querySelectorAll<HTMLElement>('[role="tooltip"]')].filter((item) => item.id === id);
  expect(descriptions).toHaveLength(1);
  const content = descriptions[0].closest<HTMLElement>(tooltipSelector);
  if (!content) throw Error("Initial model description has no actual Tooltip Content");
  const label = content.querySelector(":scope > .session-native-composer-tooltip-label")?.textContent;
  if (!label) throw Error("Initial model-hint direct label missing");
  const identity = { id, label }; expect(modelHint(button, identity).count).toBe(1); protect(s); return identity;
}
async function sampleFocus(button: HTMLButtonElement, identity: HintIdentity) {
  act(() => button.focus()); await frames(); return modelHint(button, identity);
}
function power(menu: HTMLElement) { return within(menu).getByRole("menuitem", { name: "强度" }); }
async function complete(s: Surface, button: HTMLButtonElement) {
  act(() => button.focus()); const menu = await open(s);
  expect(menu.querySelector('[data-model-picker-view="simple"]')).not.toBeNull();
  const item = power(menu); expect(item.getAttribute("aria-disabled")).not.toBe("true");
  act(() => item.focus()); expect(document.activeElement).toBe(item); expect(document.activeElement).not.toBe(button);
  const receipt = { blursBeforeEnter: 0, blursAfterEnter: 0 }; const blur = () => { receipt.blursAfterEnter++; };
  button.addEventListener("blur", blur);
  try { fireEvent.keyDown(item, { key: "Enter", code: "Enter" }); await waitFor(() => expect(menu.isConnected).toBe(false)); }
  finally { button.removeEventListener("blur", blur); }
  await waitFor(() => expect(document.activeElement).toBe(s.editor));
  // Trigger was already blurred before completion; raw blur must not invent an event.
  expect(receipt.blursAfterEnter).toBe(receipt.blursBeforeEnter); protect(s); return receipt;
}
function pointer(button: HTMLElement, type: "pointerover" | "pointerout", relatedTarget: EventTarget | null) {
  const event = new MouseEvent(type, { bubbles: true, relatedTarget });
  Object.defineProperty(event, "pointerType", { value: "mouse" }); fireEvent(button, event);
}
const lifecycleCases = [
  { id: "model/main", expanded: false, mode: "model" as const, raw: "medium", purpose: "选择强度" },
  { id: "model/expanded DOM harness", expanded: true, mode: "model" as const, raw: "medium", purpose: "选择强度" },
  { id: "Default/main raw null", expanded: false, mode: "default" as const, raw: null, purpose: "选择模型" },
  { id: "Default/expanded DOM harness raw null", expanded: true, mode: "default" as const, raw: null, purpose: "选择模型" },
  { id: "unknown canonical accepted ordinary", expanded: false, mode: "model" as const, selected: UNKNOWN, raw: "medium", purpose: "选择强度" },
];
it.each(lifecycleCases)("completion survives first actual blur and 350ms, then second blur/leave release: $id", async (spec) => {
  const s = await mount(spec), button = ownButton(s), watched = watch(), closed = closedSelection(button);
  const checks: Array<{ phase: string; actual: ReturnType<typeof modelHint>; expected: string[] }> = [];
  let actualBlurs = 0; const blur = () => { actualBlurs++; }; button.addEventListener("blur", blur);
  try {
    const identity = await initialHint(s, button); expect(identity.label).toBe(spec.purpose);
    await complete(s, button); const completionBlurCount = actualBlurs;
    checks.push({ phase: "completion focus", actual: await sampleFocus(button, identity), expected: [] });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 360)); });
    checks.push({ phase: "after separate350ms reset", actual: modelHint(button, identity), expected: [] });
    act(() => s.editor.focus()); expect(actualBlurs).toBe(completionBlurCount + 1);
    checks.push({ phase: "first actual post-completion blur consumed", actual: await sampleFocus(button, identity), expected: [] });
    act(() => s.editor.focus()); expect(actualBlurs).toBe(completionBlurCount + 2);
    checks.push({ phase: "second actual blur releases", actual: await sampleFocus(button, identity), expected: [spec.purpose] });
    await complete(s, button); checks.push({ phase: "fresh completion", actual: await sampleFocus(button, identity), expected: [] });
    pointer(button, "pointerover", s.editor); await frames();
    checks.push({ phase: "pointer enter retains", actual: modelHint(button, identity), expected: [] });
    pointer(button, "pointerout", s.editor); act(() => s.editor.focus());
    checks.push({ phase: "real DOM pointerleave path releases", actual: await sampleFocus(button, identity), expected: [spec.purpose] });
    protect(s); expect(entry()).toBe(s.before.a); expect(entry()).toEqual(s.before.aValue);
    expect(closedSelection(button)).toEqual(closed); expect(prefs()).toBe(s.before.prefs);
    expect(watched.entries).toEqual([]); expect(watched.modes).toEqual([]); expect(watched.overflow()).toBe(false);
    expect(recentModelConfigs()).toEqual(s.before.recent); expect(screen.queryByRole("menu")).toBeNull();
  } finally { button.removeEventListener("blur", blur); s.unmount(); watched.stop(); }
  expect(button.isConnected).toBe(false); expect(document.querySelector(tooltipSelector)).toBeNull(); expect(globalThis.fetch).not.toHaveBeenCalled();
  expect(checks).toHaveLength(7);
  for (const check of checks) expect.soft(check.actual.labels, check.phase).toEqual(check.expected);
});

const nonCompletion = ["current row", "selected Default", "ArrowRight", "pointer drag", "wheel", "Escape"] as const;
it.each(nonCompletion)("source-allowed action does not create Enter-completion hold: %s", async (action) => {
  const mode = action === "selected Default" ? "default" as const : "model" as const;
  const raw = action === "selected Default" ? null : "medium";
  const s = await mount({ mode, raw }), button = ownButton(s), watched = watch(); let final: ReturnType<typeof modelHint> | null = null;
  try {
    const identity = await initialHint(s, button); const menu = await open(s);
    if (action === "current row" || action === "selected Default") {
      await advanced(menu);
      const row = action === "selected Default" ? within(menu).getByRole("menuitemradio", { name: /^默认/ }) : within(menu).getByRole("menuitemradio", { name: SL });
      expect(row.getAttribute("aria-checked")).toBe("true"); fireEvent.click(row);
      await waitFor(() => expect(menu.querySelector('[data-model-picker-view="simple"]')).not.toBeNull());
    } else if (action === "ArrowRight") {
      const item = power(menu); act(() => item.focus()); fireEvent.keyDown(item, { key: "ArrowRight", code: "ArrowRight" });
    } else if (action === "pointer drag") {
      const slider = menu.querySelector<HTMLElement>(".session-native-power-slider"); if (!slider) throw Error("Actual Power Root missing");
      vi.spyOn(slider, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 200, bottom: 28, width: 200, height: 28, toJSON: () => ({}) });
      const event = new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, clientX: 187, clientY: 14 });
      Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: "mouse" } }); fireEvent(slider, event);
    } else if (action === "wheel") {
      const slider = menu.querySelector<HTMLElement>(".session-native-power-slider"); if (!slider) throw Error("Actual Power Root missing");
      vi.spyOn(slider, "getClientRects").mockReturnValue({ length: 1 } as DOMRectList);
      act(() => { slider.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaX: 0, deltaY: -30, deltaMode: 0 })); });
    }
    if (["ArrowRight", "pointer drag", "wheel"].includes(action)) {
      await waitFor(() => expect(entry().reasoningEffort).toBe("high")); protect(s, true);
      expect(entry().model).toBe(SOL); expect(entry().revision).toBe(s.before.a.revision + 1); expect(entry().pending).toBe(true);
      expect(watched.entries).toHaveLength(1); expect(watched.entries[0]).toMatchObject({ model: SOL, reasoningEffort: "high", serviceTier: "fast" });
    } else { protect(s); expect(watched.entries).toEqual([]); }
    await close(menu); await waitFor(() => expect(document.activeElement).toBe(s.editor)); final = await sampleFocus(button, identity);
    protect(s, ["ArrowRight", "pointer drag", "wheel"].includes(action)); expect(prefs().selectionMode).toBe(mode);
    expect(watched.modes).toEqual([]); expect(watched.overflow()).toBe(false);
    if (action === "Escape" || action === "selected Default") expect(recentModelConfigs()).toEqual(s.before.recent);
    else expect(recentModelConfigs()[0]).toMatchObject({ model: SOL, reasoningEffort: ["ArrowRight", "pointer drag", "wheel"].includes(action) ? "high" : raw, serviceTier: "fast" });
  } finally { s.unmount(); watched.stop(); }
  expect(button.isConnected).toBe(false); expect(document.querySelector(tooltipSelector)).toBeNull(); expect(final).not.toBeNull();
  expect.soft(final?.labels).toEqual([mode === "default" ? "选择模型" : "选择强度"]);
});
it("non-openai custom provider keeps its ordinary-independent raw adapter after Power Enter", async () => {
  const s = await mount({ provider: "fixture-other", selected: "e8-custom", mode: "model" }), button = ownButton(s), watched = watch(); let final: ReturnType<typeof modelHint> | null = null;
  try { const identity = await initialHint(s, button); expect(identity.label).toBe("e8-custom · medium");
    await complete(s, button); final = await sampleFocus(button, identity); protect(s);
    expect(watched.entries).toEqual([]); expect(watched.modes).toEqual([]); expect(recentModelConfigs()).toEqual(s.before.recent);
  } finally { s.unmount(); watched.stop(); }
  expect(button.isConnected).toBe(false); expect(document.querySelector(tooltipSelector)).toBeNull(); expect(final).not.toBeNull(); expect.soft(final?.labels).toEqual(["e8-custom · medium"]);
});
it("a stale current-store owner cannot arm the old connected Power Enter callback", async () => {
  const s = await mount({ mode: "model" }), button = ownButton(s), watched = watch(); let final: ReturnType<typeof modelHint> | null = null;
  try {
    const identity = await initialHint(s, button), menu = await open(s), item = power(menu); act(() => item.focus());
    act(() => useCodexStore.setState({ currentThreadId: B }));
    fireEvent.keyDown(item, { key: "Enter", code: "Enter" }); await waitFor(() => expect(menu.isConnected).toBe(false));
    protect(s, false, B); expect(watched.entries).toEqual([]); expect(watched.modes).toEqual([]);
    act(() => useCodexStore.setState({ currentThreadId: A })); final = await sampleFocus(button, identity); protect(s);
    expect(recentModelConfigs()).toEqual(s.before.recent);
  } finally { s.unmount(); watched.stop(); }
  expect(button.isConnected).toBe(false); expect(document.querySelector(tooltipSelector)).toBeNull(); expect(final).not.toBeNull(); expect.soft(final?.labels).toEqual(["选择强度"]);
});
it("scope replacement clears local completion state into another enhanced OpenAI owner", async () => {
  const s = await mount({ mode: "model", ordinaryB: true }), button = ownButton(s), watched = watch(); let nextHint: ReturnType<typeof modelHint> | null = null;
  const focusReceipt = { oldBlurs: 0, newFocuses: 0, overflow: false };
  let nextFocusTarget: HTMLButtonElement | null = null;
  const oldBlur = () => { if (focusReceipt.oldBlurs >= 1) { focusReceipt.overflow = true; return; } focusReceipt.oldBlurs++; };
  const newFocus = () => { if (focusReceipt.newFocuses >= 1) { focusReceipt.overflow = true; return; } focusReceipt.newFocuses++; };
  try {
    const oldIdentity = await initialHint(s, button); await complete(s, button); await sampleFocus(button, oldIdentity); protect(s);
    expect(document.activeElement).toBe(button);
    button.addEventListener("blur", oldBlur);
    act(() => s.editor.focus());
    expect(document.activeElement).toBe(s.editor); expect(focusReceipt.oldBlurs).toBe(1); expect(focusReceipt.overflow).toBe(false);
    protect(s);
    act(() => useCodexStore.setState({ currentThreadId: B })); s.rerender(s.tree(B, s.other)); await frames();
    const nextButton = s.container.querySelector<HTMLButtonElement>(".session-native-model-trigger"); if (!nextButton) throw Error("New owned ordinary Trigger missing");
    const nextEditor = s.container.querySelector<HTMLTextAreaElement>('textarea[aria-label="E8 草稿"]'); if (!nextEditor) throw Error("New owned editor missing");
    vi.spyOn(nextEditor, "getClientRects").mockReturnValue({ length: 1 } as DOMRectList);
    expect(document.activeElement).not.toBe(nextButton);
    nextFocusTarget = nextButton; nextButton.addEventListener("focus", newFocus);
    act(() => nextButton.focus()); await frames();
    expect(document.activeElement).toBe(nextButton); expect(focusReceipt.newFocuses).toBe(1);
    expect(focusReceipt.oldBlurs).toBe(1); expect(focusReceipt.overflow).toBe(false);
    const ids = (nextButton.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
    // Reuse the Root identity if mounted; no assertion may turn a missing capture into hidden success.
    const nextIdentity = { id: ids[0] ?? oldIdentity.id, label: "选择强度" }; nextHint = modelHint(nextButton, nextIdentity);
    expect(nextButton.disabled).toBe(false); expect(nextButton.getAttribute("aria-label")).toBe(`模型：${SOL}，high`);
    expect(nextEditor.value).toBe("E8 B 草稿"); expect(nextEditor.closest('[data-draft-owner]')?.getAttribute('data-draft-owner')).toBe(s.other);
    expect(entry()).toBe(s.before.a); expect(entry()).toEqual(s.before.aValue); expect(useThreadModelStore.getState().threads[B]).toBe(s.before.b);
    expect(useConfigStore.getState()).toBe(s.before.defaults); expect(useModelSettingsStore.getState()).toBe(s.before.custom); expect(useModelCacheStore.getState()).toBe(s.cache);
    expect(useSessionDraftStore.getState()).toBe(s.before.text); expect(useComposerDraftStore.getState()).toBe(s.before.rich);
    expect(prefs()).toBe(s.before.prefs); expect(watched.entries).toEqual([]); expect(watched.modes).toEqual([]); expect(recentModelConfigs()).toEqual(s.before.recent);
    for (const read of Object.values(api)) expect(read).toHaveBeenCalledTimes(1); expect(s.submit).not.toHaveBeenCalled();
  } finally {
    button.removeEventListener("blur", oldBlur); nextFocusTarget?.removeEventListener("focus", newFocus);
    s.unmount(); watched.stop();
  }
  expect(document.querySelector(tooltipSelector)).toBeNull(); expect(nextHint).not.toBeNull(); expect.soft(nextHint?.labels).toEqual(["选择强度"]);
});
it("unmount and fresh ordinary remount discard held state without hydrating settings again", async () => {
  const s = await mount({ mode: "model" }), button = ownButton(s), watched = watch(); let final: ReturnType<typeof modelHint> | null = null;
  let fresh: ReturnType<typeof render> | null = null;
  try {
    const identity = await initialHint(s, button); await complete(s, button); await sampleFocus(button, identity); protect(s);
    s.unmount(); expect(button.isConnected).toBe(false); expect(document.querySelector(tooltipSelector)).toBeNull();
    fresh = render(s.tree()); const nextEditor = screen.getByRole("textbox", { name: "E8 草稿" }) as HTMLTextAreaElement;
    vi.spyOn(nextEditor, "getClientRects").mockReturnValue({ length: 1 } as DOMRectList);
    const nextButton = fresh.container.querySelector<HTMLButtonElement>(".session-native-model-trigger"); if (!nextButton) throw Error("Fresh ordinary Trigger missing");
    act(() => nextButton.focus()); await frames();
    const ids = (nextButton.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
    const nextIdentity = { id: ids[0] ?? identity.id, label: "选择强度" }; final = modelHint(nextButton, nextIdentity);
    protect({ ...s, ...fresh, editor: nextEditor }); expect(watched.entries).toEqual([]); expect(watched.modes).toEqual([]); expect(recentModelConfigs()).toEqual(s.before.recent);
  } finally { fresh?.unmount(); s.unmount(); watched.stop(); }
  expect(document.querySelector(tooltipSelector)).toBeNull(); expect(final).not.toBeNull(); expect.soft(final?.labels).toEqual(["选择强度"]);
});
