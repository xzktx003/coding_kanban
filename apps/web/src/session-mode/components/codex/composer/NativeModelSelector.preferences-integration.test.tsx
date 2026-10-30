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
import { DEFAULT_NATIVE_PICKER_REASONING_EFFORTS, useNativeModelPickerPreferencesStore } from "@session/stores/settings/useNativeModelPickerPreferencesStore";
import { useConfigStore } from "../stores/useConfigStore";
import { useCodexStore } from "../stores/useCodexStore";
import { useModelCacheStore, useModels } from "../hooks/useModels";
import { NativeModelSelector } from "./NativeModelSelector";
import { ConversationMenu } from "./ConversationMenu";
import { nativeReasoningOptions } from "./nativeReasoningOptions";
import { recentModelConfigs, resetRecentModels } from "./recentModelConfigs";
import { useComposerDraftStore } from "./v2/drafts";

const api = vi.hoisted(() => ({
  listModels: vi.fn(), listOtherModels: vi.fn(), listConfigProviders: vi.fn(), listProviderPresets: vi.fn(),
}));
vi.mock("@session/services/apiAdapt/codex", async (original) => ({
  ...(await original<typeof import("@session/services/apiAdapt/codex")>()), ...api,
}));

const A = "e3-shared-picker-a", B = "e3-shared-picker-b";
const MODEL = "e3-known-canonical", UNKNOWN = "e3-unknown-canonical";
const OWNER = sessionDraftKey("codex", A), OTHER = sessionDraftKey("codex", B);
const DRAFT = "E3 保留未发送正文\n附件和另一会话不变";
const NINE = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra", "persistent"] as const;
const COMMANDS = ["提高推理强度", "降低推理强度", "循环切换推理强度"] as const;
const DEFAULT_VISIBLE = ["low", "medium", "high", "xhigh"];

function model(): Model {
  return {
    id: "e3-dto-alias", model: MODEL, displayName: "E3 目录模型",
    description: "Synthetic complete known-nine catalog; not an authenticated account catalog",
    hidden: false, isDefault: true, upgrade: null, upgradeInfo: null, availabilityNux: null,
    supportedReasoningEfforts: NINE.map((reasoningEffort) => ({ reasoningEffort, description: reasoningEffort })),
    defaultReasoningEffort: "medium", inputModalities: ["text"], supportsPersonality: false,
    additionalSpeedTiers: [], serviceTiers: [], defaultServiceTier: null,
  };
}
function DraftEditor() {
  const draft = useSessionTextDraft(OWNER);
  return <div className="session-rich-draft"><textarea aria-label="E3 草稿" value={draft.inputValue}
    onChange={(event) => draft.setInputValue(event.currentTarget.value)} /></div>;
}
function GenericItemsProbe() {
  const { providerItems } = useModels();
  return <output hidden data-testid="e3-generic-items">{JSON.stringify(providerItems("openai"))}</output>;
}
async function mount({ expanded = false, raw = "medium", selected = MODEL, enabled }: {
  expanded?: boolean; raw?: ReasoningEffort | null; selected?: string; enabled?: readonly ReasoningEffort[];
} = {}) {
  if (enabled) useNativeModelPickerPreferencesStore.getState().setEnabledReasoningEfforts(enabled);
  const response: ModelListResponse = { data: [model()], nextCursor: null };
  api.listModels.mockResolvedValue(response);
  hydrateThreadModel(A, { model: selected, modelProvider: "openai", reasoningEffort: raw, serviceTier: null });
  hydrateThreadModel(B, { model: "e3-untouched-b", modelProvider: "openai", reasoningEffort: "persistent", serviceTier: null });
  const before = {
    a: useThreadModelStore.getState().threads[A], aValue: structuredClone(useThreadModelStore.getState().threads[A]),
    b: useThreadModelStore.getState().threads[B], defaults: useConfigStore.getState(), custom: useModelSettingsStore.getState(),
    text: useSessionDraftStore.getState().drafts, rich: useComposerDraftStore.getState(), recent: recentModelConfigs(),
    raw: structuredClone(response), record: response.data[0], effortRefs: response.data[0].supportedReasoningEfforts,
    tierRefs: response.data[0].serviceTiers, mode: useNativeModelPickerPreferencesStore.getState().selectionMode,
  };
  const formRef = createRef<HTMLFormElement>(), submit = vi.fn();
  const view = render(<div className="session-mode"><section data-testid="e3-host"
    className={expanded ? "session-composer-sheet is-full" : "session-codex-composer"} data-draft-owner={OWNER}>
    <form ref={formRef} onSubmit={(event) => { event.preventDefault(); submit(); }}>
      <DraftEditor /><NativeModelSelector threadId={A} draftOwner={OWNER} /><GenericItemsProbe />
      {!expanded && <ConversationMenu threadId={A} draftOwner={OWNER} composerRef={formRef} title="E3 当前会话" />}
    </form>
  </section></div>);
  const editor = screen.getByRole("textbox", { name: "E3 草稿" }) as HTMLTextAreaElement;
  vi.spyOn(editor, "getClientRects").mockReturnValue({ length: 1 } as DOMRectList);
  await waitFor(() => expect(useModelCacheStore.getState().loaded).toBe(true));
  expect(useModelCacheStore.getState()).toMatchObject({ loading: false, error: null, modelStatus: "success" });
  const cache = useModelCacheStore.getState();
  const triggerButton = screen.getByRole("button", { name: /^模型：/ });
  return { ...view, response, before, cache, editor, triggerButton, formRef, submit, expanded };
}
type Surface = Awaited<ReturnType<typeof mount>>;
function assertProtected(surface: Surface) {
  const current = useThreadModelStore.getState().threads[A];
  const stable = (entry: typeof current) => {
    const { reasoningEffort, revision, pending, pendingFields, ...rest } = entry;
    return rest;
  };
  expect(stable(current)).toEqual(stable(surface.before.aValue));
  expect(surface.before.a).toEqual(surface.before.aValue);
  expect(useThreadModelStore.getState().threads[B]).toBe(surface.before.b);
  expect(useConfigStore.getState()).toBe(surface.before.defaults);
  expect(useModelSettingsStore.getState()).toBe(surface.before.custom);
  expect(useSessionDraftStore.getState().drafts).toBe(surface.before.text);
  expect(useComposerDraftStore.getState()).toBe(surface.before.rich);
  expect(useCodexStore.getState().currentThreadId).toBe(A);
  expect(useCodexStore.getState().account).toBeNull();
  expect(useNativeModelPickerPreferencesStore.getState().selectionMode).toBe(surface.before.mode);
  expect(surface.editor.value).toBe(DRAFT); expect(surface.editor.isConnected).toBe(true);
  expect(surface.editor.closest("[data-draft-owner]")?.getAttribute("data-draft-owner")).toBe(OWNER);
  expect(surface.submit).not.toHaveBeenCalled(); expect(globalThis.fetch).not.toHaveBeenCalled();
  const cache = useModelCacheStore.getState();
  expect(cache).toBe(surface.cache); expect(cache.openAiModels).toBe(surface.response.data);
  expect(cache.modelSnapshot).toBe(surface.response.data); expect(surface.response).toEqual(surface.before.raw);
  expect(cache.openAiModels[0]).toBe(surface.before.record);
  expect(cache.openAiModels[0].supportedReasoningEfforts).toBe(surface.before.effortRefs);
  expect(cache.openAiModels[0].serviceTiers).toBe(surface.before.tierRefs);
  // Raw wire/generic legality stays independent of the ordinary display policy.
  expect(nativeReasoningOptions(cache.openAiModels[0])).toEqual(["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"]);
  expect(JSON.parse(screen.getByTestId("e3-generic-items").textContent ?? "null")).toEqual([
    { id: "e3-dto-alias", label: "E3 目录模型", description: surface.response.data[0].description },
  ]);
  for (const read of Object.values(api)) { expect(read).toHaveBeenCalledTimes(1); expect(read).toHaveBeenCalledWith(); }
}
function assertReadOnly(surface: Surface) {
  assertProtected(surface);
  expect(useThreadModelStore.getState().threads[A]).toBe(surface.before.a);
  expect(useThreadModelStore.getState().threads[A]).toEqual(surface.before.aValue);
  expect(recentModelConfigs()).toEqual(surface.before.recent);
}
const trigger = () => screen.getByRole("button", { name: /^模型：/ });
async function openPicker() {
  fireEvent.keyDown(trigger(), { key: "ArrowDown", code: "ArrowDown" });
  const menu = await screen.findByRole("menu");
  vi.spyOn(menu, "getClientRects").mockReturnValue({ length: 1 } as DOMRectList);
  return menu;
}
async function openPower() {
  const menu = await openPicker();
  const slider = menu.querySelector<HTMLElement>(".session-native-power-slider");
  expect(slider).not.toBeNull();
  expect(slider!.closest("[hidden],[inert],[aria-hidden=true]")).toBeNull();
  vi.spyOn(slider!, "getClientRects").mockReturnValue({ length: 1 } as DOMRectList);
  vi.spyOn(slider!, "getBoundingClientRect").mockReturnValue({
    x: 0, y: 0, left: 0, top: 0, right: 240, bottom: 24, width: 240, height: 24, toJSON: () => ({}),
  });
  return { menu, slider: slider! };
}
async function closePicker(menu: HTMLElement) {
  fireEvent.keyDown(menu, { key: "Escape", code: "Escape" });
  await waitFor(() => expect(menu.isConnected).toBe(false));
}
function wheel(slider: HTMLElement, deltaY: number) {
  const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaX: 0, deltaY, deltaMode: 0 });
  act(() => { slider.dispatchEvent(event); });
  return event;
}
async function openCommand(label: typeof COMMANDS[number]) {
  fireEvent.keyDown(screen.getByRole("button", { name: "当前会话的更多操作" }), { key: "ArrowDown", code: "ArrowDown" });
  const item = await screen.findByRole("menuitem", { name: label });
  expect(item.getAttribute("aria-disabled")).not.toBe("true");
  expect(item.closest('[data-slot="dropdown-menu-content"]')).not.toBeNull();
  return item;
}
async function command(label: typeof COMMANDS[number]) {
  const item = await openCommand(label), menu = item.closest('[role="menu"]')!;
  fireEvent.click(item);
  await waitFor(() => expect(menu.isConnected).toBe(false));
}
function expectPower(menu: HTMLElement, count: number, caption: string, position: number) {
  expect.soft(menu.querySelector("[data-model-picker-view]")?.getAttribute("data-model-picker-view")).toBe("simple");
  expect.soft(menu.querySelectorAll(".session-native-power-dot")).toHaveLength(count);
  expect.soft(menu.querySelector(".session-native-power-effort")?.textContent).toBe(caption);
  expect.soft(within(menu).getByRole("status").textContent).toContain("第 " + position + " 项，共 " + count + " 项");
}
function expectEffort(surface: Surface, effort: ReasoningEffort, label: string) {
  assertProtected(surface);
  expect.soft(useThreadModelStore.getState().threads[A].reasoningEffort).toBe(effort);
  if (surface.triggerButton.getAttribute("aria-expanded") === "true" && document.querySelector('.session-native-model-menu [data-model-picker-view="simple"]')) {
    expect.soft(surface.triggerButton.querySelector(".session-native-model-effort")).toBeNull();
    expect.soft(surface.triggerButton.getAttribute("aria-label")).toBeNull();
    expect.soft(surface.triggerButton.querySelector(".session-native-model-trigger-placeholder")?.textContent ?? null).toBe("选择强度");
  } else expect.soft(surface.triggerButton.querySelector(".session-native-model-effort")?.textContent).toBe(label);
}

beforeEach(() => {
  vi.restoreAllMocks(); vi.resetAllMocks();
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Unexpected E3 transport")));
  api.listOtherModels.mockResolvedValue([]); api.listConfigProviders.mockResolvedValue([]); api.listProviderPresets.mockResolvedValue([]);
  useModelCacheStore.setState(useModelCacheStore.getInitialState(), true);
  useThreadModelStore.setState({ threads: {} });
  useSessionDraftStore.setState({ drafts: {}, migrated: [] });
  useSessionDraftStore.getState().setText(OWNER, DRAFT); useSessionDraftStore.getState().setText(OTHER, "E3 B 保留草稿");
  useComposerDraftStore.setState({ error: null, drafts: {
    [OWNER]: { contexts: [], drawings: {}, expanded: false, plain: true },
    [OTHER]: { contexts: [], drawings: {}, expanded: true, plain: false },
  } });
  useModelSettingsStore.setState({ models: { "e3-custom": [{ id: "e3-custom-model", name: "E3 自定义保留" }] } });
  useConfigStore.setState({ model: "e3-global", modelProvider: "openai", providerModels: { openai: "e3-global" }, reasoningEffort: "high", serviceTier: null });
  useCodexStore.setState({ currentThreadId: A, account: null });
  useLayoutStore.setState({ view: "agent" }); useAgentSettingsStore.setState({ selectedAgent: "codex" });
  useAcpStore.setState({ active: false }); useWorkspaceStore.setState({ cwd: "/fixture/e3" });
  useNativeModelPickerPreferencesStore.getState().setSelectionMode("model");
  useNativeModelPickerPreferencesStore.getState().setEnabledReasoningEfforts(DEFAULT_NATIVE_PICKER_REASONING_EFFORTS);
  resetRecentModels();
});
afterEach(() => {
  try { expect(globalThis.fetch).not.toHaveBeenCalled(); }
  finally { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); }
});

it.each([{ expanded: false }, { expanded: true }])("projects default hAt6 into readonly known-nine UI / expanded=$expanded", async ({ expanded }) => {
  const surface = await mount({ expanded, raw: "max" });
  expect(useNativeModelPickerPreferencesStore.getState().enabledReasoningEfforts).toEqual(["low", "medium", "high", "xhigh", "ultra", "persistent"]);
  assertReadOnly(surface);
  expect.soft(trigger().querySelector(".session-native-model-effort")?.textContent).toBe("中");
  const { menu } = await openPower(); assertReadOnly(surface);
  expectPower(menu, DEFAULT_VISIBLE.length, "中", 2);
  expect(useThreadModelStore.getState().threads[A].reasoningEffort).toBe("max");
});

it.each([{ expanded: false }, { expanded: true }])("shares default projected pointer/arrow/status/wheel and main command steps / expanded=$expanded", async ({ expanded }) => {
  const surface = await mount({ expanded });
  const { menu, slider } = await openPower(); assertReadOnly(surface);
  expectPower(menu, 4, "中", 2);
  fireEvent.pointerDown(slider, { button: 0, pointerId: 1, pointerType: "mouse", clientX: 240, clientY: 12 });
  expectEffort(surface, "xhigh", "极高"); expectPower(menu, 4, "极高", 4);
  fireEvent.keyDown(menu.querySelector<HTMLElement>("[data-reasoning-slider]")!, { key: "ArrowLeft", code: "ArrowLeft" });
  expectEffort(surface, "high", "高"); expectPower(menu, 4, "高", 3);
  expect(wheel(slider, -30).defaultPrevented).toBe(true);
  expectEffort(surface, "xhigh", "极高"); expectPower(menu, 4, "极高", 4);
  await closePicker(menu);
  if (!expanded) {
    const beforeBoundary = useThreadModelStore.getState().threads[A], recent = recentModelConfigs();
    await command(COMMANDS[0]); assertProtected(surface);
    expect(useThreadModelStore.getState().threads[A]).toBe(beforeBoundary); expect(recentModelConfigs()).toEqual(recent);
    expectEffort(surface, "xhigh", "极高");
    await command(COMMANDS[1]); expectEffort(surface, "high", "高");
    await command(COMMANDS[2]); expectEffort(surface, "xhigh", "极高");
    await command(COMMANDS[2]); expectEffort(surface, "low", "轻度");
  }
});

it("publishes live own preferences to the same open Power and the next command without repair or extra reads", async () => {
  const surface = await mount(), { menu, slider } = await openPower(); assertReadOnly(surface);
  act(() => useNativeModelPickerPreferencesStore.getState().setEnabledReasoningEfforts(["low", "medium"]));
  assertReadOnly(surface); expect(menu.querySelector(".session-native-power-slider")).toBe(slider);
  expectPower(menu, 2, "中", 2);
  const beforeBoundary = useThreadModelStore.getState().threads[A], recent = recentModelConfigs();
  wheel(slider, -30); assertProtected(surface);
  expect.soft(useThreadModelStore.getState().threads[A]).toBe(beforeBoundary); expect.soft(recentModelConfigs()).toEqual(recent);
  expectEffort(surface, "medium", "中");
  await closePicker(menu);
  await command(COMMANDS[1]); expectEffort(surface, "low", "轻度");
});

it.each([{ known: true }, { known: false }])("keeps empty preferences distinct for known zero and unknown six / known=$known", async ({ known }) => {
  const surface = await mount({ selected: known ? MODEL : UNKNOWN, raw: known ? "medium" : "xhigh", enabled: [] });
  const menu = await openPicker(); assertReadOnly(surface);
  if (known) {
    expect.soft(menu.querySelector("[data-model-picker-view]")?.getAttribute("data-model-picker-view")).toBe("advanced");
    expect.soft(menu.querySelectorAll(".session-native-power-dot")).toHaveLength(0);
    expect.soft(menu.querySelector("[data-reasoning-slider]")).toBeNull();
    await closePicker(menu);
    for (const label of COMMANDS) { await command(label); assertProtected(surface); }
    expect.soft(useThreadModelStore.getState().threads[A]).toBe(surface.before.a);
    expect.soft(recentModelConfigs()).toEqual(surface.before.recent);
  } else {
    expectPower(menu, 6, "极高", 5); await closePicker(menu);
    await command(COMMANDS[0]); assertProtected(surface);
    expect(useThreadModelStore.getState().threads[A].reasoningEffort).toBe("max");
    const next = await openPower(); expectPower(next.menu, 6, "Max", 6);
    wheel(next.slider, 30); assertProtected(surface);
    expect(useThreadModelStore.getState().threads[A].reasoningEffort).toBe("xhigh");
  }
});

it("cannot enable ultra through nine own preferences and leaves raw ultra and generic legality intact", async () => {
  const surface = await mount({ raw: "ultra", enabled: NINE }); assertReadOnly(surface);
  expect(useNativeModelPickerPreferencesStore.getState().enabledReasoningEfforts).toEqual(NINE);
  expect.soft(trigger().querySelector(".session-native-model-effort")?.textContent).toBe("中");
  const { menu } = await openPower(); assertReadOnly(surface);
  expectPower(menu, 7, "中", 4);
  expect(useThreadModelStore.getState().threads[A].reasoningEffort).toBe("ultra");
});

it("a revoked actual owner cannot reuse projected wheel or portalled command inputs", async () => {
  const surface = await mount(), host = surface.getByTestId("e3-host");
  const { menu, slider } = await openPower(); assertReadOnly(surface);
  try {
    host.dataset.draftOwner = OTHER;
    expect(useCodexStore.getState().currentThreadId).toBe(A); wheel(slider, -30);
  } finally { host.dataset.draftOwner = OWNER; }
  assertReadOnly(surface); await closePicker(menu);
  const item = await openCommand(COMMANDS[0]);
  try {
    host.dataset.draftOwner = OTHER;
    expect(useCodexStore.getState().currentThreadId).toBe(A); fireEvent.click(item);
  } finally { host.dataset.draftOwner = OWNER; }
  assertReadOnly(surface);
});
