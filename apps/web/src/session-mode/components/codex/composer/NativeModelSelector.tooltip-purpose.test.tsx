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
vi.mock("@session/services/apiAdapt/codex", async (original) => ({ ...(await original<typeof import("@session/services/apiAdapt/codex")>()), ...api }));
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
async function mount({ expanded = false, selected = SOL, raw = "medium", mode = null, catalog = four(), enabled, pending, retainedError = false, ancillary, primaryError = false, provider = "openai", direct = false }: {
  expanded?: boolean; selected?: string; raw?: string | null; mode?: Mode; catalog?: Model[]; enabled?: readonly string[];
  pending?: Promise<ModelListResponse>; retainedError?: boolean; ancillary?: Promise<[]>; primaryError?: boolean; provider?: string; direct?: boolean;
} = {}) {
  prefs().setSelectionMode(mode); if (enabled) prefs().setEnabledReasoningEfforts(enabled);
  const response: ModelListResponse = { data: catalog, nextCursor: null };
  api.listModels.mockReturnValue(primaryError ? Promise.reject(Error("E8 primary model failure")) : pending ?? Promise.resolve(response));
  if (ancillary) api.listConfigProviders.mockReturnValue(ancillary);
  hydrateThreadModel(A, { model: "e8-preserved-other-provider", modelProvider: "fixture-other", reasoningEffort: "low", serviceTier: null });
  hydrateThreadModel(A, nativeThreadSettings({ model: selected, modelProvider: provider, reasoningEffort: raw, serviceTier: "fast",
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
    <form ref={formRef} onSubmit={(event) => { event.preventDefault(); submit(); }}><Editor owner={owner} />{direct ? <NativeModelTrigger /> : <NativeModelSelector threadId={A} draftOwner={owner} />}{retainedError && <ReloadControl holder={reloadControl} />}
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
function readHint(button: HTMLButtonElement) {
  const contents = [...document.querySelectorAll<HTMLElement>(tooltipSelector)];
  const content = contents[0] ?? null;
  // The direct label belongs to the real Content; Radix's hidden role=tooltip
  // copy is recorded only as a description, never treated as visible hint proof.
  const label = content?.querySelector<HTMLElement>(":scope > .session-native-composer-tooltip-label") ?? null;
  const ids = (button.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
  return { contentCount: contents.length, connected: content?.isConnected ?? false,
    label: label?.textContent ?? null, rawName: button.getAttribute("aria-label"),
    description: ids.map((id) => ({ id, role: document.getElementById(id)?.getAttribute("role") ?? null, text: document.getElementById(id)?.textContent ?? null })) };
}
async function focusHint(s: Surface, button: HTMLButtonElement, hover = false) {
  // Real Tooltip component-level DOM simulation follows its existing native unit.
  // Trusted input and physical visibility remain exclusively browser evidence.
  if (hover) {
    const move = new MouseEvent("pointermove", { bubbles: true });
    Object.defineProperty(move, "pointerType", { value: "mouse" }); fireEvent(button, move);
  } else act(() => button.focus());
  await waitFor(() => expect(readHint(button).contentCount).toBe(1));
  const value = readHint(button);
  expect(value.connected).toBe(true); expect(value.label).not.toBeNull();
  expect(value.description.length).toBeGreaterThan(0);
  const label = value.label; if (label === null) throw Error("Real Tooltip direct label missing");
  expect(value.description.some((item) => item.role === "tooltip" && item.text?.includes(label))).toBe(true);
  protect(s); return value;
}
async function leaveHint(s: Surface) {
  act(() => { ownButton(s).focus(); s.editor.focus(); });
  await waitFor(() => expect(document.querySelector(tooltipSelector)).toBeNull());
}
function closedSelection(button: HTMLButtonElement) {
  return { aria: button.getAttribute("aria-label"), model: button.querySelector(".session-native-model-label")?.textContent ?? null,
    effort: button.querySelector(".session-native-model-effort")?.textContent ?? null,
    placeholder: button.querySelector(".session-native-model-trigger-placeholder")?.textContent ?? null };
}
async function frames() {
  await act(async () => { await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
const positiveCases = [
  { id: "effective model/main", expanded: false, mode: "model" as const, purpose: "选择强度", seed: "model" as const, view: "simple" },
  { id: "effective model/expanded scope", expanded: true, mode: "model" as const, purpose: "选择强度", seed: "model" as const, view: "simple" },
  { id: "effective Default/main", expanded: false, mode: "default" as const, purpose: "选择模型", seed: "default" as const, view: "simple" },
  { id: "effective Default/expanded scope", expanded: true, mode: "default" as const, purpose: "选择模型", seed: "default" as const, view: "simple" },
  { id: "saved Default outside Et is effective model/natural one", mode: "default" as const, selected: TERRA, raw: null, purpose: "选择强度", seed: "default" as const, view: "advanced" },
  { id: "null FI in Et: hover/focus does not seed", mode: null, raw: null, purpose: "选择模型", seed: "default" as const, view: "simple" },
  { id: "null FI outside Et: hover/focus does not seed", mode: null, selected: TERRA, raw: null, purpose: "选择强度", seed: "model" as const, view: "advanced" },
  { id: "known empty is natural advanced, not unknown six", mode: "model" as const, catalog: [model(SOL, SL, [], "medium")], purpose: "选择强度", seed: "model" as const, view: "advanced" },
  { id: "accepted unknown canonical is ordinary six", mode: "model" as const, selected: UNKNOWN, raw: "none", purpose: "选择强度", seed: "model" as const, view: "simple" },
  { id: "four advertised efforts retain ordinary purpose", mode: "model" as const, raw: "high", catalog: [model(SOL, SL, ["low", "medium", "high", "xhigh"], "high", true)], purpose: "选择强度", seed: "model" as const, view: "simple" },
];
it.each(positiveCases)("real hook + Tooltip content uses effective purpose without raw writes: $id", async (spec) => {
  const s = await mount(spec), button = ownButton(s), baseline = closedSelection(button), watched = watch();
  const labels: Array<ReturnType<typeof readHint>> = [];
  try {
    labels.push(await focusHint(s, button, spec.mode === null));
    const rawEffortName = s.before.a.reasoningEffort === "high" ? "high" : "medium";
    expect(baseline.aria).toBe(`模型：${s.before.a.model}，${rawEffortName}`);
    expect(baseline.placeholder).toBeNull();
    expect(closedSelection(button)).toEqual(baseline); expect(prefs()).toBe(s.before.prefs);
    expect(watched.entries).toEqual([]); expect(watched.modes).toEqual([]); expect(recentModelConfigs()).toEqual(s.before.recent);
    await leaveHint(s);
    const menu = await open(s); await frames();
    await waitFor(() => expect(menu.querySelector(`[data-model-picker-view="${spec.view}"]`)).not.toBeNull());
    await waitFor(() => expect(document.querySelector(tooltipSelector)).toBeNull());
    protect(s); expect(prefs().selectionMode).toBe(spec.seed);
    expect(watched.modes).toEqual(spec.mode === null ? [spec.seed] : []);
    if (spec.view === "simple") {
      await advanced(menu); await frames();
      await waitFor(() => expect(document.querySelector(tooltipSelector)).toBeNull()); protect(s);
    }
    await close(menu); await waitFor(() => expect(document.activeElement).toBe(s.editor));
    protect(s); expect(closedSelection(button)).toEqual(baseline);
    labels.push(await focusHint(s, button)); await leaveHint(s);
    protect(s); expect(entry()).toBe(s.before.a); expect(entry()).toEqual(s.before.aValue);
    expect(prefs().selectionMode).toBe(spec.seed); expect(watched.entries).toEqual([]);
    expect(watched.modes).toEqual(spec.mode === null ? [spec.seed] : []); expect(watched.overflow()).toBe(false);
    expect(recentModelConfigs()).toEqual(s.before.recent);
  } finally { s.unmount(); watched.stop(); }
  // Wording is the prospective RED, reached after all raw/cache/owner/read/IO
  // hard controls and actual component unmount/subscription release.
  expect(button.isConnected).toBe(false); expect(document.querySelector(tooltipSelector)).toBeNull();
  expect(watched.entries).toEqual([]); expect(globalThis.fetch).not.toHaveBeenCalled();
  for (const hint of labels) expect.soft(hint.label).toBe(spec.purpose);
});
it("accepted primary model keeps purpose while an ancillary provider read is pending", async () => {
  const ancillary = deferred<[]>(), s = await mount({ mode: "model", ancillary: ancillary.promise }), button = ownButton(s), watched = watch();
  let label: string | null = null;
  try {
    expect(s.cache).toMatchObject({ modelStatus: "success", loaded: false, loading: true });
    label = (await focusHint(s, button)).label; await leaveHint(s); protect(s);
    expect(prefs()).toBe(s.before.prefs); expect(watched.entries).toEqual([]); expect(watched.modes).toEqual([]);
  } finally { s.unmount(); watched.stop(); await act(async () => { ancillary.resolve([]); }); }
  expect(button.isConnected).toBe(false); expect(globalThis.fetch).not.toHaveBeenCalled(); expect.soft(label).toBe("选择强度");
});
it.each([
  { id: "retained primary error", retainedError: true, mode: "model" as const, expected: SL + " · medium" },
  { id: "first primary error without snapshot", primaryError: true, mode: "model" as const, expected: SOL + " · medium" },
  { id: "custom provider keeps its adapter", provider: "fixture-other", selected: "e8-custom", mode: "model" as const, expected: "e8-custom · medium" },
  { id: "direct basic Trigger has no ordinary caller context", direct: true, mode: "model" as const, expected: SL + " · medium" },
])("legacy/generic boundary stays raw: $id", async (spec) => {
  const s = await mount(spec), button = ownButton(s), raw = closedSelection(button), watched = watch(); let label: string | null = null;
  try {
    label = (await focusHint(s, button)).label; await leaveHint(s); protect(s);
    expect(closedSelection(button)).toEqual(raw); expect(prefs()).toBe(s.before.prefs);
    expect(entry()).toBe(s.before.a); expect(watched.entries).toEqual([]); expect(watched.modes).toEqual([]);
    expect(screen.queryByRole("menu")).toBeNull(); expect(recentModelConfigs()).toEqual(s.before.recent);
  } finally { s.unmount(); watched.stop(); }
  expect(button.isConnected).toBe(false); expect(document.querySelector(tooltipSelector)).toBeNull(); expect(label).toBe(spec.expected);
});
it("primary pending preserves Loading/disabled/no-FI guard without claiming universal disabled-hover behavior", async () => {
  const pending = deferred<ModelListResponse>(), s = await mount({ pending: pending.promise, raw: null }), button = ownButton(s), watched = watch();
  try {
    protect(s); expect(button.disabled).toBe(true); expect(button.getAttribute("aria-label")).toBe("Loading model…");
    expect(button.querySelector(".session-native-model-label")?.textContent).toBe("Loading model…");
    fireEvent.keyDown(button, { key: "ArrowDown", code: "ArrowDown" });
    protect(s); expect(screen.queryByRole("menu")).toBeNull(); expect(prefs()).toBe(s.before.prefs);
    expect(watched.entries).toEqual([]); expect(watched.modes).toEqual([]); expect(recentModelConfigs()).toEqual(s.before.recent);
  } finally { s.unmount(); watched.stop(); await act(async () => { pending.resolve(s.response); }); }
  expect(button.isConnected).toBe(false); expect(globalThis.fetch).not.toHaveBeenCalled();
});
