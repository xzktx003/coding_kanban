import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ReasoningEffort } from "@session/bindings";
import type { Model, ModelListResponse } from "@session/bindings/v2";
import { useLayoutStore } from "@session/stores/useLayoutStore";
import { useAgentSettingsStore } from "@session/stores/useAgentSettingsStore";
import { useAcpStore } from "@session/stores/useAcpStore";
import { useWorkspaceStore } from "@session/stores/useWorkspaceStore";
import { useModelSettingsStore } from "@session/stores/settings";
import { sessionDraftKey, useSessionDraftStore, useSessionTextDraft } from "@session/stores/useSessionDraftStore";
import { hydrateThreadModel, useThreadModelStore } from "@session/stores/useThreadModelStore";
import { nativeThreadSettings } from "@session/services/nativeThreadSettings";
import { useNativeModelPickerPreferencesStore } from "@session/stores/settings/useNativeModelPickerPreferencesStore";
import { useConfigStore } from "../stores/useConfigStore";
import { useCodexStore } from "../stores/useCodexStore";
import { useModelCacheStore } from "../hooks/useModels";
import { NativeModelSelector } from "./NativeModelSelector";
import { ConversationMenu } from "./ConversationMenu";
import { recentModelConfigs, resetRecentModels } from "./recentModelConfigs";
import { useComposerDraftStore } from "./v2/drafts";

const api = vi.hoisted(() => ({ listModels: vi.fn(), listOtherModels: vi.fn(), listConfigProviders: vi.fn(), listProviderPresets: vi.fn() }));
vi.mock("@session/services/apiAdapt/codex", async (original) => ({
  ...(await original<typeof import("@session/services/apiAdapt/codex")>()), ...api,
}));

const A = "e6-joint-a", B = "e6-joint-b", CWD = "/fixture/e6";
const CURRENT = "e6-current", TARGET = "e6-target", LABEL = "E6 当前模型", TARGET_LABEL = "E6 另一模型";
const DRAFT = "E6 草稿保留\n不发消息不改另一会话";
const COMMANDS = ["提高推理强度", "降低推理强度", "循环切换推理强度"] as const;
const getA = () => useThreadModelStore.getState().threads[A];
function model(id: string, label: string, efforts: ReasoningEffort[], defaultReasoningEffort: ReasoningEffort, tier = false): Model {
  return { id, model: id, displayName: label, description: "Synthetic E6 local intent catalog, not account authority",
    hidden: false, isDefault: id === CURRENT, upgrade: null, upgradeInfo: null, availabilityNux: null,
    supportedReasoningEfforts: efforts.map((reasoningEffort) => ({ reasoningEffort, description: reasoningEffort })),
    defaultReasoningEffort, inputModalities: ["text"], supportsPersonality: false, additionalSpeedTiers: [],
    serviceTiers: tier ? [{ id: "fast", name: "Fast", description: "fixture" }] : [], defaultServiceTier: null };
}
function Editor({ owner }: { owner: string }) {
  const draft = useSessionTextDraft(owner);
  return <div className="session-rich-draft"><textarea aria-label="E6 未发送草稿" value={draft.inputValue}
    onChange={(event) => draft.setInputValue(event.currentTarget.value)} /></div>;
}
async function mount({ raw = "medium", tier = "fast", expanded = false, threadId = A, provider = "openai", currentEfforts = ["low", "medium", "high"], targetEfforts = ["low", "medium", "high"], targetDefault = "high", targetSupportsTier = false }: {
  raw?: ReasoningEffort | null; tier?: string | null; expanded?: boolean; threadId?: string | null; provider?: string;
  currentEfforts?: ReasoningEffort[]; targetEfforts?: ReasoningEffort[]; targetDefault?: ReasoningEffort; targetSupportsTier?: boolean;
} = {}) {
  const response: ModelListResponse = { data: [model(CURRENT, LABEL, currentEfforts, "high", true), model(TARGET, TARGET_LABEL, targetEfforts, targetDefault, targetSupportsTier)], nextCursor: null };
  api.listModels.mockResolvedValue(response);
  api.listConfigProviders.mockResolvedValue(provider === "openai" ? [] : [{ name: provider }]);
  hydrateThreadModel(A, { model: "e6-a-preserved-provider-model", modelProvider: "fixture-other", reasoningEffort: "low", serviceTier: null });
  hydrateThreadModel(A, nativeThreadSettings({ model: CURRENT, modelProvider: provider, reasoningEffort: raw, serviceTier: tier,
    activePermissionProfile: { id: "fixture-e6-profile", extends: null }, runtimeWorkspaceRoots: ["/fixture/e6/root"],
    sandbox: { type: "readOnly", networkAccess: false }, approvalPolicy: "on-request", approvalsReviewer: "user" }));
  hydrateThreadModel(B, { model: "e6-b-model", modelProvider: "fixture-other", reasoningEffort: "low", serviceTier: null });
  if (threadId === null) useConfigStore.setState({ model: CURRENT, modelProvider: provider, reasoningEffort: raw ?? "medium", serviceTier: tier,
    providerModels: { openai: CURRENT, "fixture-other": "e6-other-slot" } });
  useCodexStore.setState({ currentThreadId: threadId });
  const owner = sessionDraftKey("codex", threadId, CWD), otherOwner = sessionDraftKey("codex", B);
  useSessionDraftStore.getState().setText(owner, DRAFT);
  useSessionDraftStore.getState().setText(otherOwner, "E6 B 草稿");
  const before = { a: getA(), aValue: structuredClone(getA()), b: useThreadModelStore.getState().threads[B],
    defaults: useConfigStore.getState(), custom: useModelSettingsStore.getState(), text: useSessionDraftStore.getState(),
    rich: useComposerDraftStore.getState(), prefs: useNativeModelPickerPreferencesStore.getState(), recent: recentModelConfigs(), raw: structuredClone(response),
    records: [...response.data], effortRefs: response.data.map((record) => record.supportedReasoningEfforts), tierRefs: response.data.map((record) => record.serviceTiers) };
  const formRef = createRef<HTMLFormElement>(), submit = vi.fn();
  const view = render(<div className="session-mode"><section data-testid="e6-host"
    className={expanded ? "session-composer-sheet is-full" : "session-codex-composer"} data-draft-owner={owner}>
    <form ref={formRef} onSubmit={(event) => { event.preventDefault(); submit(); }}>
      <Editor owner={owner} /><NativeModelSelector threadId={threadId} draftOwner={owner} />
      {!expanded && <ConversationMenu threadId={threadId} draftOwner={owner} composerRef={formRef} title="E6 当前会话" />}
    </form>
  </section></div>);
  const editor = screen.getByRole("textbox", { name: "E6 未发送草稿" }) as HTMLTextAreaElement;
  vi.spyOn(editor, "getClientRects").mockReturnValue({ length: 1 } as DOMRectList);
  await waitFor(() => expect(useModelCacheStore.getState().loaded).toBe(true));
  expect(useModelCacheStore.getState()).toMatchObject({ loading: false, error: null, modelStatus: "success" });
  const cache = useModelCacheStore.getState();
  return { ...view, before, response, editor, cache, owner, threadId, expanded, submit };
}
type Surface = Awaited<ReturnType<typeof mount>>;
function protectedState(s: Surface, { aChanged = false, defaultsChanged = false, currentThreadId = s.threadId }: { aChanged?: boolean; defaultsChanged?: boolean; currentThreadId?: string | null } = {}) {
  expect(s.before.a).toEqual(s.before.aValue);
  if (!aChanged) expect(getA()).toBe(s.before.a);
  expect(useThreadModelStore.getState().threads[B]).toBe(s.before.b);
  if (!defaultsChanged) expect(useConfigStore.getState()).toBe(s.before.defaults);
  expect(useModelSettingsStore.getState()).toBe(s.before.custom);
  expect(useSessionDraftStore.getState()).toBe(s.before.text);
  expect(useComposerDraftStore.getState()).toBe(s.before.rich);
  expect(useNativeModelPickerPreferencesStore.getState()).toBe(s.before.prefs);
  expect(useCodexStore.getState().currentThreadId).toBe(currentThreadId);
  expect(s.editor.value).toBe(DRAFT); expect(s.editor.isConnected).toBe(true);
  expect(s.editor.closest("[data-draft-owner]")?.getAttribute("data-draft-owner")).toBe(s.owner);
  expect(s.submit).not.toHaveBeenCalled(); expect(globalThis.fetch).not.toHaveBeenCalled();
  expect(useModelCacheStore.getState()).toBe(s.cache);
  expect(s.cache.openAiModels).toBe(s.response.data); expect(s.cache.modelSnapshot).toBe(s.response.data);
  expect(s.response).toEqual(s.before.raw);
  s.response.data.forEach((record, index) => {
    expect(s.cache.openAiModels[index]).toBe(s.before.records[index]);
    expect(record.supportedReasoningEfforts).toBe(s.before.effortRefs[index]);
    expect(record.serviceTiers).toBe(s.before.tierRefs[index]);
  });
  for (const read of Object.values(api)) { expect(read).toHaveBeenCalledTimes(1); expect(read).toHaveBeenCalledWith(); }
}
function unchangedEntryFields(s: Surface) {
  const omitIntent = (entry: typeof s.before.a) => {
    const { model, reasoningEffort, serviceTier, revision, pending, pendingFields, notice, providerModels, ...rest } = entry;
    return rest;
  };
  expect(omitIntent(getA())).toEqual(omitIntent(s.before.aValue));
  expect(getA().providerModels).toEqual({ ...s.before.a.providerModels, [getA().modelProvider]: getA().model });
  for (const key of ["nativePermissionMetadata", "nativeSettings", "observed"] as const) expect(getA()[key]).toBe(s.before.a[key]);
}
function watchThread() {
  const entries: Array<ReturnType<typeof getA>> = []; let overflow = false;
  const unsubscribe = useThreadModelStore.subscribe((state, previous) => {
    if (state.threads[A] === previous.threads[A]) return;
    if (entries.length < 8) entries.push(state.threads[A]); else overflow = true;
  });
  return { entries, overflow: () => overflow, stop: unsubscribe };
}
function watchDefaults() {
  const entries: Array<ReturnType<typeof useConfigStore.getState>> = []; let overflow = false;
  const unsubscribe = useConfigStore.subscribe((state) => { if (entries.length < 8) entries.push(state); else overflow = true; });
  return { entries, overflow: () => overflow, stop: unsubscribe };
}
async function openPicker(s: Surface) {
  fireEvent.keyDown(screen.getByRole("button", { name: /^模型：/ }), { key: "ArrowDown", code: "ArrowDown" });
  const menu = await screen.findByRole("menu");
  vi.spyOn(menu, "getClientRects").mockReturnValue({ length: 1 } as DOMRectList);
  protectedState(s); expect(getA()).toBe(s.before.a); expect(recentModelConfigs()).toEqual(s.before.recent);
  return menu;
}
async function advanced(s: Surface) {
  const menu = await openPicker(s), caption = within(menu).getByRole("menuitem", { name: "选择模型" });
  fireEvent.pointerDown(caption, { button: 0, pointerType: "mouse" }); fireEvent.click(caption);
  await waitFor(() => expect(menu.querySelector('[data-model-picker-view="advanced"]')).not.toBeNull());
  protectedState(s); expect(getA()).toBe(s.before.a); expect(recentModelConfigs()).toEqual(s.before.recent);
  return menu;
}
async function row(menu: HTMLElement, label: string, view: "simple" | "advanced" = "simple") {
  const target = within(menu).getByRole("menuitemradio", { name: label });
  expect(target.getAttribute("aria-disabled")).not.toBe("true");
  fireEvent.pointerDown(target, { button: 0, pointerType: "mouse" }); fireEvent.click(target);
  await waitFor(() => expect(menu.querySelector(`[data-model-picker-view="${view}"]`)).not.toBeNull());
}
async function power(s: Surface) {
  const menu = await openPicker(s), slider = menu.querySelector<HTMLElement>(".session-native-power-slider")!;
  expect(slider).not.toBeNull(); expect(slider.closest('[hidden],[inert],[aria-hidden="true"]')).toBeNull();
  vi.spyOn(slider, "getClientRects").mockReturnValue({ length: 1 } as DOMRectList);
  vi.spyOn(slider, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 240, bottom: 24, width: 240, height: 24, toJSON: () => ({}) });
  return { menu, slider };
}
async function commandItem(label: typeof COMMANDS[number]) {
  fireEvent.keyDown(screen.getByRole("button", { name: "当前会话的更多操作" }), { key: "ArrowDown", code: "ArrowDown" });
  const item = await screen.findByRole("menuitem", { name: label });
  expect(item.getAttribute("aria-disabled")).not.toBe("true"); return item;
}
const tuple = (entry: { model: string; reasoningEffort: ReasoningEffort | null; serviceTier?: string | null }) => ({ model: entry.model, reasoningEffort: entry.reasoningEffort, serviceTier: entry.serviceTier });

beforeEach(() => {
  vi.restoreAllMocks(); vi.resetAllMocks();
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Unexpected E6 transport")));
  api.listOtherModels.mockResolvedValue([]); api.listConfigProviders.mockResolvedValue([]); api.listProviderPresets.mockResolvedValue([]);
  useModelCacheStore.setState(useModelCacheStore.getInitialState(), true); useThreadModelStore.setState({ threads: {} });
  useSessionDraftStore.setState({ drafts: {}, migrated: [] });
  useComposerDraftStore.setState({ drafts: {}, error: null });
  useModelSettingsStore.setState({ models: { "fixture-other": [{ id: "e6-custom-kept", name: "E6 自定义保留" }], "fixture-custom": [{ id: CURRENT, name: LABEL }] } });
  useConfigStore.setState({ model: "e6-global", modelProvider: "openai", reasoningEffort: "high", serviceTier: null,
    providerModels: { openai: "e6-global", "fixture-other": "e6-other-slot" } });
  useCodexStore.setState({ currentThreadId: A, account: null }); useLayoutStore.setState({ view: "agent" });
  useAgentSettingsStore.setState({ selectedAgent: "codex" }); useAcpStore.setState({ active: false }); useWorkspaceStore.setState({ cwd: CWD });
  useNativeModelPickerPreferencesStore.getState().setSelectionMode("model");
  useNativeModelPickerPreferencesStore.getState().setEnabledReasoningEfforts(["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra", "persistent"]);
  resetRecentModels();
});
afterEach(() => {
  try { expect(globalThis.fetch).not.toHaveBeenCalled(); }
  finally { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); }
});

const scenarios = [
  { id: "raw-null-clear-tier", raw: null, currentEfforts: ["low", "high"], targetEfforts: ["low", "medium", "high"], targetDefault: "high", supportsTier: false, finalTier: null },
  { id: "raw-max-retain-tier", raw: "max", currentEfforts: ["low", "medium", "high"], targetEfforts: ["max", "medium"], targetDefault: "max", supportsTier: true, finalTier: "fast" },
] satisfies Array<{ id: string; raw: ReasoningEffort | null; currentEfforts: ReasoningEffort[]; targetEfforts: ReasoningEffort[]; targetDefault: ReasoningEffort; supportsTier: boolean; finalTier: string | null }>;
for (const scenario of scenarios) it.each([{ expanded: false }, { expanded: true }])(
  scenario.id + " emits exactly one coherent native row intent / expanded=$expanded", async ({ expanded }) => {
    const s = await mount({ raw: scenario.raw, expanded, currentEfforts: scenario.currentEfforts, targetEfforts: scenario.targetEfforts,
      targetDefault: scenario.targetDefault, targetSupportsTier: scenario.supportsTier });
    const menu = await advanced(s), watched = watchThread();
    try {
      await row(menu, TARGET_LABEL);
      protectedState(s, { aChanged: true }); unchangedEntryFields(s);
      expect(tuple(getA())).toEqual({ model: TARGET, reasoningEffort: "medium", serviceTier: scenario.finalTier });
      expect(getA().providerModels).toEqual({ ...s.before.a.providerModels, openai: TARGET });
      expect(getA()).toMatchObject({ pending: true });
      expect(getA().pendingFields).toEqual(expect.arrayContaining(["model", "reasoningEffort", ...(!scenario.supportsTier ? ["serviceTier"] : [])]));
      expect(recentModelConfigs()[0]).toMatchObject({ model: TARGET, reasoningEffort: "medium", serviceTier: "fast" });
      expect(watched.overflow()).toBe(false);
      // All value/owner/catalog/draft/no-IO controls precede the coherent-publication assertions.
      expect.soft(watched.entries.map(tuple)).toEqual([{ model: TARGET, reasoningEffort: "medium", serviceTier: scenario.finalTier }]);
      expect.soft(watched.entries.map((entry) => entry.revision)).toEqual([s.before.a.revision + 1]);
      expect.soft(getA().revision).toBe(s.before.a.revision + 1);
    } finally { watched.stop(); }
  },
);

it.each([{ expanded: false }, { expanded: true }])("keeps same-current native null and unsupported saved tier completely readonly / expanded=$expanded", async ({ expanded }) => {
  const s = await mount({ raw: null, expanded, currentEfforts: ["low", "high"], tier: "unadvertised" });
  const menu = await advanced(s), watched = watchThread();
  try {
    await row(menu, LABEL); protectedState(s);
    expect(getA()).toBe(s.before.a); expect(getA()).toEqual(s.before.aValue);
    expect(watched.entries).toEqual([]); expect(watched.overflow()).toBe(false);
    expect(recentModelConfigs()[0]).toMatchObject({ model: CURRENT, reasoningEffort: null, serviceTier: "unadvertised" });
  } finally { watched.stop(); }
});

it("publishes a changed new-chat default pair and tier in one config notification without touching thread state", async () => {
  const s = await mount({ threadId: null, raw: "low", tier: "fast" });
  const menu = await advanced(s), watched = watchDefaults();
  try {
    await row(menu, TARGET_LABEL); protectedState(s, { defaultsChanged: true });
    const after = useConfigStore.getState();
    expect(tuple(after)).toEqual({ model: TARGET, reasoningEffort: "low", serviceTier: null });
    expect(after.providerModels).toEqual({ ...s.before.defaults.providerModels, openai: TARGET });
    for (const key of ["modelProvider", "sandbox", "approvalPolicy", "approvalsReviewer", "webSearchRequest", "personality", "collaborationMode", "threadCwdMode"] as const) expect(after[key]).toBe(s.before.defaults[key]);
    expect(watched.overflow()).toBe(false);
    expect.soft(watched.entries.map(tuple)).toEqual([{ model: TARGET, reasoningEffort: "low", serviceTier: null }]);
  } finally { watched.stop(); }
});

it("deduplicates a real pointer selection of the existing default Power pair", async () => {
  const s = await mount({ threadId: null, raw: "medium", tier: "fast" }), { slider } = await power(s), watched = watchDefaults();
  try {
    fireEvent.pointerDown(slider, { button: 0, pointerId: 1, pointerType: "mouse", clientX: 120, clientY: 12 });
    protectedState(s, { defaultsChanged: true });
    expect(tuple(useConfigStore.getState())).toEqual({ model: CURRENT, reasoningEffort: "medium", serviceTier: "fast" });
    expect(useConfigStore.getState().modelProvider).toBe(s.before.defaults.modelProvider);
    expect(useConfigStore.getState().providerModels).toBe(s.before.defaults.providerModels);
    expect(watched.overflow()).toBe(false);
    expect.soft(watched.entries).toEqual([]); expect.soft(useConfigStore.getState()).toBe(s.before.defaults);
  } finally { watched.stop(); }
});

it("keeps native pointer, arrow and wheel on current-model effort with one revision per real change", async () => {
  const s = await mount(), { menu, slider } = await power(s), watched = watchThread();
  try {
    fireEvent.pointerDown(slider, { button: 0, pointerId: 1, pointerType: "mouse", clientX: 240, clientY: 12 });
    fireEvent.keyDown(menu.querySelector<HTMLElement>("[data-reasoning-slider]")!, { key: "ArrowLeft", code: "ArrowLeft" });
    const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -30, deltaX: 0, deltaMode: 0 });
    act(() => { slider.dispatchEvent(event); });
    protectedState(s, { aChanged: true }); unchangedEntryFields(s);
    expect(event.defaultPrevented).toBe(true); expect(watched.overflow()).toBe(false);
    expect(watched.entries.map(tuple)).toEqual(["high", "medium", "high"].map((reasoningEffort) => ({ model: CURRENT, reasoningEffort, serviceTier: "fast" })));
    expect(watched.entries.map((entry) => entry.revision)).toEqual([1, 2, 3].map((delta) => s.before.a.revision + delta));
  } finally { watched.stop(); }
});

it.each(COMMANDS)("keeps %s in captured current-model domain and preserves tier", async (label) => {
  const s = await mount(), item = await commandItem(label), watched = watchThread();
  try {
    fireEvent.click(item); protectedState(s, { aChanged: true }); unchangedEntryFields(s);
    const expected = label === "降低推理强度" ? "low" : "high";
    expect(watched.entries.map(tuple)).toEqual([{ model: CURRENT, reasoningEffort: expected, serviceTier: "fast" }]);
    expect(getA().revision).toBe(s.before.a.revision + 1); expect(watched.overflow()).toBe(false);
  } finally { watched.stop(); }
});

it("preserves the generic provider individual effort behavior", async () => {
  const s = await mount({ provider: "fixture-custom" }), { menu } = await power(s), watched = watchThread();
  try {
    fireEvent.keyDown(menu.querySelector<HTMLElement>("[data-reasoning-slider]")!, { key: "ArrowRight", code: "ArrowRight" });
    protectedState(s, { aChanged: true }); unchangedEntryFields(s);
    expect(getA()).toMatchObject({ model: CURRENT, modelProvider: "fixture-custom", reasoningEffort: "high", serviceTier: "fast" });
    expect(watched.entries.map(tuple)).toEqual([{ model: CURRENT, reasoningEffort: "high", serviceTier: "fast" }]);
  } finally { watched.stop(); }
});

it("rejects the captured Dropdown command row after the active owner changes to B", async () => {
  const s = await mount(), item = await commandItem("提高推理强度"), watched = watchThread();
  try {
    act(() => useCodexStore.setState({ currentThreadId: B }));
    fireEvent.click(item); protectedState(s, { currentThreadId: B });
    expect(getA()).toBe(s.before.a); expect(watched.entries).toEqual([]); expect(watched.overflow()).toBe(false);
  } finally { watched.stop(); }
});

it.each([{ raw: null }, { raw: "low" }, { raw: "" }] as const)("preserves the old effective raw $raw for an advertised empty default", async ({ raw }) => {
  const s = await mount({ raw, targetEfforts: [], targetDefault: "", tier: "fast" }), menu = await advanced(s), watched = watchThread();
  try {
    await row(menu, TARGET_LABEL, "advanced");
    protectedState(s, { aChanged: true }); unchangedEntryFields(s);
    expect(tuple(getA())).toEqual({ model: TARGET, reasoningEffort: raw, serviceTier: null });
    // Old setting writes use if(next), while recent independently uses next ?? raw.
    expect(recentModelConfigs()[0]).toMatchObject({ model: TARGET, reasoningEffort: "", serviceTier: "fast" });
    expect(watched.overflow()).toBe(false);
    expect(watched.entries.every((entry) => entry.reasoningEffort === raw)).toBe(true);
    if (raw === null) {
      // The typed joint API cannot carry null: this deliberate legacy exception may publish model/tier separately.
      expect(watched.entries.length).toBeGreaterThan(0);
    } else {
      expect.soft(watched.entries.map(tuple)).toEqual([{ model: TARGET, reasoningEffort: raw, serviceTier: null }]);
      expect.soft(getA().revision).toBe(s.before.a.revision + 1);
    }
  } finally { watched.stop(); }
});
