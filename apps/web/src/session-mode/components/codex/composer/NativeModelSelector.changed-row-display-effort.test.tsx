import { useNativeModelPickerPreferencesStore } from "@session/stores/settings/useNativeModelPickerPreferencesStore";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ReasoningEffort } from "@session/bindings";
import type { Model, ModelListResponse } from "@session/bindings/v2";
import { useLayoutStore } from "@session/stores/useLayoutStore";
import { useModelSettingsStore } from "@session/stores/settings";
import { hydrateThreadModel, useThreadModelStore } from "@session/stores/useThreadModelStore";
import { useConfigStore } from "../stores/useConfigStore";
import { useCodexStore } from "../stores/useCodexStore";
import { useModelCacheStore, useModels } from "../hooks/useModels";
import { NativeModelSelector } from "./NativeModelSelector";
import { recentModelConfigs, rememberRecentModel, resetRecentModels } from "./recentModelConfigs";
import { useComposerDraftStore } from "./v2/drafts";

const api = vi.hoisted(() => ({
  listModels: vi.fn(), listOtherModels: vi.fn(),
  listConfigProviders: vi.fn(), listProviderPresets: vi.fn(),
}));

// R25 real hook/cache/store/Trigger/Radix structure: only the four read IO
// boundaries are fixtures. No choose/helper/readiness or permission mock.
vi.mock("@session/services/apiAdapt/codex", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@session/services/apiAdapt/codex")>()), ...api,
}));

const A = "r27-current-row-owner-a";
const B = "r27-current-row-owner-b";
const CURRENT = "r27-current-model";
const TARGET = "r27-different-model";
const CURRENT_LABEL = "R27 当前模型";
const TARGET_LABEL = "R27 另一模型";
const DRAFT = "R27 保留完整草稿\n不会因重选模型而发送";

function model(id: string, label: string, efforts: ReasoningEffort[], defaultReasoningEffort: ReasoningEffort, isDefault: boolean): Model {
  return {
    id, model: id, displayName: label,
    upgrade: null, upgradeInfo: null, availabilityNux: null,
    description: "Complete synthetic R27 current-row fixture; not a real account catalog",
    hidden: false, isDefault, defaultReasoningEffort,
    supportedReasoningEfforts: efforts.map((reasoningEffort) => ({ reasoningEffort, description: reasoningEffort })),
    inputModalities: ["text", "image"], supportsPersonality: false,
    additionalSpeedTiers: [], serviceTiers: [], defaultServiceTier: null,
  };
}

function GenericItemsProbe() {
  const { providerItems } = useModels();
  return <output hidden data-testid="r27-generic-items">{JSON.stringify(providerItems("openai"))}</output>;
}

function assertReads() {
  for (const read of Object.values(api)) {
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith();
  }
}

function captureCatalog(response: ModelListResponse) {
  const value = structuredClone(response);
  const records = [...response.data];
  const efforts = response.data.map((record) => record.supportedReasoningEfforts);
  return () => {
    const cache = useModelCacheStore.getState();
    expect(response).toEqual(value);
    expect(cache.openAiModels).toBe(response.data);
    expect(cache.modelSnapshot).toBe(response.data);
    expect(cache.openAiModels).toHaveLength(records.length);
    records.forEach((record, index) => {
      expect(cache.openAiModels[index]).toBe(record);
      expect(record.supportedReasoningEfforts).toBe(efforts[index]);
    });
    expect(JSON.parse(screen.getByTestId("r27-generic-items").textContent ?? "null")).toEqual(
      response.data.map((record) => ({ id: record.id, label: record.displayName || record.model, description: record.description })),
    );
  };
}

function mountSurface(effort: ReasoningEffort | null, expanded: boolean, serviceTier: string | null = null) {
  rememberRecentModel({ model: "r27-unrelated-recent", label: "R27 既有最近模型", reasoningEffort: "low", serviceTier: null });
  hydrateThreadModel(A, { model: CURRENT, modelProvider: "openai", reasoningEffort: effort, serviceTier });
  hydrateThreadModel(B, { model: "r27-untouched-b", modelProvider: "openai", reasoningEffort: "persistent", serviceTier: null });
  const before = {
    a: useThreadModelStore.getState().threads[A], b: useThreadModelStore.getState().threads[B],
    aValue: structuredClone(useThreadModelStore.getState().threads[A]),
    bValue: structuredClone(useThreadModelStore.getState().threads[B]),
    defaults: useConfigStore.getState(), custom: useModelSettingsStore.getState(),
    drafts: useComposerDraftStore.getState(), recent: recentModelConfigs(),
  };
  expect(before.a.reasoningEffort).toBe(effort);
  expect(before.a.pending).toBe(false);
  expect(before.a.pendingFields ?? []).toEqual([]);
  const submit = vi.fn();
  const view = render(
    <div className="session-mode">
      <section className={expanded ? "session-composer-sheet is-full" : "session-codex-composer"} data-draft-owner={`codex:${A}`}>
        <form onSubmit={(event) => { event.preventDefault(); submit(); }}>
          <div className="session-rich-draft"><textarea aria-label="R27 保留草稿" defaultValue={DRAFT} /></div>
          <NativeModelSelector threadId={A} draftOwner={`codex:${A}`} />
          <GenericItemsProbe />
        </form>
      </section>
    </div>,
  );
  const editor = screen.getByRole("textbox", { name: "R27 保留草稿" }) as HTMLTextAreaElement;
  vi.spyOn(editor, "getClientRects").mockReturnValue({ length: 1 } as DOMRectList);
  return { ...view, before, editor, submit };
}
type Surface = ReturnType<typeof mountSurface>;

function assertUnrelatedProtected(surface: Surface) {
  expect(surface.before.a).toEqual(surface.before.aValue);
  expect(useThreadModelStore.getState().threads[B]).toBe(surface.before.b);
  expect(useThreadModelStore.getState().threads[B]).toEqual(surface.before.bValue);
  expect(useConfigStore.getState()).toBe(surface.before.defaults);
  expect(useModelSettingsStore.getState()).toBe(surface.before.custom);
  expect(useComposerDraftStore.getState()).toBe(surface.before.drafts);
  expect(useCodexStore.getState().currentThreadId).toBe(A);
  expect(surface.editor.closest("[data-draft-owner]")?.getAttribute("data-draft-owner")).toBe(`codex:${A}`);
  expect(surface.editor.value).toBe(DRAFT);
  expect(surface.editor.isConnected).toBe(true);
  expect(surface.submit).not.toHaveBeenCalled();
  expect(globalThis.fetch).not.toHaveBeenCalled();
  assertReads();
}

function assertProtected(
  surface: Surface,
  differentRow = false,
  expectedDifferentTier?: { serviceTier: string | null },
) {
  // Tier changes are permitted only for an explicit different-row case, and
  // only to its declared expected value. Existing callers retain exact tier.
  if (expectedDifferentTier) expect(differentRow).toBe(true);
  const protectedPart = (entry: typeof surface.before.a) => {
    const { reasoningEffort: _effort, revision: _revision, pending: _pending, pendingFields: _pendingFields, ...rest } = entry;
    if (!differentRow) return rest;
    const { model: _model, providerModels: _models, notice: _notice, ...same } = rest;
    return same;
  };
  const expected = protectedPart(surface.before.aValue);
  expect(protectedPart(useThreadModelStore.getState().threads[A])).toEqual(
    expectedDifferentTier ? { ...expected, serviceTier: expectedDifferentTier.serviceTier } : expected,
  );
  assertUnrelatedProtected(surface);
}

function assertReadOnly(surface: Surface) {
  expect(useThreadModelStore.getState().threads[A]).toBe(surface.before.a);
  expect(useThreadModelStore.getState().threads[A]).toEqual(surface.before.aValue);
  expect(recentModelConfigs()).toEqual(surface.before.recent);
  assertProtected(surface);
}

async function ready(response: ModelListResponse) {
  await waitFor(() => expect(useModelCacheStore.getState().loaded).toBe(true));
  const cache = useModelCacheStore.getState();
  expect(cache.modelStatus).toBe("success");
  expect(cache.loading).toBe(false);
  expect(cache.error).toBeNull();
  expect(cache.openAiModels).toBe(response.data);
  expect(cache.modelSnapshot).toBe(response.data);
  assertReads();
}

async function openAdvanced(surface: Surface, assertRaw: () => void, initialPower: string) {
  const button = screen.getByRole("button", { name: /^模型：/ });
  fireEvent.keyDown(button, { key: "ArrowDown", code: "ArrowDown" });
  const menu = await screen.findByRole("menu");
  vi.spyOn(menu, "getClientRects").mockReturnValue({ length: 1 } as DOMRectList);
  await waitFor(() => expect(menu.querySelector("[data-model-picker-view]")?.getAttribute("data-model-picker-view")).toBe("simple"));
  assertReadOnly(surface); assertRaw();
  expect(menu.querySelector(".session-native-power-effort")?.textContent).toBe(initialPower);
  const caption = within(menu).getByRole("menuitem", { name: "选择模型" });
  fireEvent.pointerDown(caption, { button: 0, ctrlKey: false, pointerType: "mouse" });
  fireEvent.click(caption);
  await waitFor(() => expect(menu.querySelector("[data-model-picker-view]")?.getAttribute("data-model-picker-view")).toBe("advanced"));
  assertReadOnly(surface); assertRaw();
  return { button, menu };
}

async function chooseRow(menu: HTMLElement, label: string) {
  const row = within(menu).getByRole("menuitemradio", { name: label });
  expect(row.getAttribute("aria-disabled")).not.toBe("true");
  fireEvent.pointerDown(row, { button: 0, ctrlKey: false, pointerType: "mouse" });
  fireEvent.click(row);
  await waitFor(() => expect(menu.querySelector("[data-model-picker-view]")?.getAttribute("data-model-picker-view")).toBe("simple"));
  expect(menu.isConnected).toBe(true);
}

beforeEach(() => {
  // Explicit initial enabled membership preserves the original none/minimal/max
  // counterexamples. The app display policy still excludes ultra.
  useNativeModelPickerPreferencesStore.getState().setEnabledReasoningEfforts([
    "none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra", "persistent",
  ]);
  vi.resetAllMocks();
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Unexpected R27 transport")));
  api.listModels.mockResolvedValue({ data: [], nextCursor: null });
  api.listOtherModels.mockResolvedValue([]);
  api.listConfigProviders.mockResolvedValue([]);
  api.listProviderPresets.mockResolvedValue([]);
  useModelCacheStore.setState({ openAiModels: [], otherModels: {}, configProviders: [], presets: [], loaded: false, loading: false, error: null, modelStatus: "pending", modelSnapshot: null });
  useThreadModelStore.setState({ threads: {} });
  useModelSettingsStore.setState({ models: { "r27-custom-provider": [{ id: "r27-custom-model", name: "R27 保留自定义模型" }] } });
  useComposerDraftStore.setState({ drafts: {
    [`codex:${A}`]: { contexts: [], drawings: {}, expanded: false, plain: true },
    [`codex:${B}`]: { contexts: [], drawings: {}, expanded: true, plain: false },
  }, error: null });
  useConfigStore.setState({ model: "r27-global-default", modelProvider: "openai", providerModels: { openai: "r27-global-default" }, reasoningEffort: "high", serviceTier: null });
  useCodexStore.setState({ currentThreadId: A });
  useLayoutStore.setState({ view: "agent" });
  resetRecentModels();
});

afterEach(() => {
  try { expect(globalThis.fetch).not.toHaveBeenCalled(); }
  finally { cleanup(); vi.unstubAllGlobals(); }
});

function captureTierReferences(response: ModelListResponse) {
  const arrays = response.data.map((record) => record.serviceTiers);
  const records = response.data.map((record) => [...record.serviceTiers]);
  return () => response.data.forEach((record, index) => {
    expect(record.serviceTiers).toBe(arrays[index]);
    expect(record.serviceTiers).toHaveLength(records[index].length);
    record.serviceTiers.forEach((tier, tierIndex) => expect(tier).toBe(records[index][tierIndex]));
  });
}


type ChangedRowCase = {
  id: "ROW01" | "ROW02";
  raw: ReasoningEffort | null;
  currentEfforts: ReasoningEffort[];
  targetEfforts: ReasoningEffort[];
  targetDefault: ReasoningEffort;
  initialPower: "高" | "中";
};

const changedRowCases: ChangedRowCase[] = [
  { id: "ROW01", raw: null, currentEfforts: ["low", "high"],
    targetEfforts: ["low", "medium", "high"], targetDefault: "high", initialPower: "高" },
  { id: "ROW02", raw: "max", currentEfforts: ["low", "medium", "high"],
    targetEfforts: ["max", "medium"], targetDefault: "max", initialPower: "中" },
];

for (const scenario of changedRowCases) it.each([{ expanded: false }, { expanded: true }])(
  scenario.id + " different native row explicitly adopts display medium / expanded=$expanded",
  async ({ expanded }) => {
    const response: ModelListResponse = { data: [
      model(CURRENT, CURRENT_LABEL, scenario.currentEfforts, "high", true),
      model(TARGET, TARGET_LABEL, scenario.targetEfforts, scenario.targetDefault, false),
    ], nextCursor: null };
    const assertRaw = captureCatalog(response);
    const assertTiers = captureTierReferences(response);
    api.listModels.mockResolvedValue(response);
    const surface = mountSurface(scenario.raw, expanded);
    await ready(response);
    assertReadOnly(surface); assertRaw(); assertTiers();
    const buttonBefore = screen.getByRole("button", { name: /^模型：/ });
    expect(buttonBefore.querySelector(".session-native-model-effort")?.textContent).toBe("中");
    const { button, menu } = await openAdvanced(surface, assertRaw, scenario.initialPower);
    expect(button).toBe(buttonBefore);
    assertReadOnly(surface); assertRaw(); assertTiers();
    const currentRow = within(menu).getByRole("menuitemradio", { name: CURRENT_LABEL });
    const targetRow = within(menu).getByRole("menuitemradio", { name: TARGET_LABEL });
    expect(currentRow.getAttribute("aria-checked")).toBe("true");
    expect(targetRow.getAttribute("aria-checked")).toBe("false");
    expect(within(menu).getAllByRole("menuitemradio")).toHaveLength(2);
    await chooseRow(menu, TARGET_LABEL);
    // Only actual different-row model/effort/revision/pending may change. The
    // saved tier, provenance, owner, defaults, B, raw catalog and IO stay hard.
    assertProtected(surface, true); assertRaw(); assertTiers();
    const after = useThreadModelStore.getState().threads[A];
    expect(after).not.toBe(surface.before.a);
    expect(after.model).toBe(TARGET);
    expect(after.modelProvider).toBe("openai");
    expect(after.providerModels).toEqual({ ...surface.before.aValue.providerModels, openai: TARGET });
    expect(after.revision).toBeGreaterThan(surface.before.aValue.revision);
    expect(after.pending).toBe(true);
    expect(after.pendingFields).toEqual(expect.arrayContaining(["model"]));
    expect(after.serviceTier).toBeNull();
    expect(menu.querySelectorAll(".session-native-power-dot")).toHaveLength(scenario.targetEfforts.length);
    expect(recentModelConfigs()[0]).toMatchObject({ model: TARGET, label: TARGET_LABEL, serviceTier: null });
    expect(recentModelConfigs().slice(1)).toEqual(surface.before.recent);
    // These prospective product checks follow all hard controls. Incoming bt
    // is medium even when the old raw value is null/max or menu TX is high.
    expect.soft(after.reasoningEffort).toBe("medium");
    expect.soft(after.pendingFields).toEqual(expect.arrayContaining(["model", "reasoningEffort"]));
    expect.soft(button.querySelector(".session-native-model-effort")?.textContent).toBeUndefined();
  expect.soft(button.getAttribute("aria-label")).toBeNull();
  expect.soft(button.querySelector(".session-native-model-trigger-placeholder")?.textContent ?? null).toBe("选择强度");
    expect.soft(menu.querySelector(".session-native-power-effort")?.textContent).toBe("中");
    expect.soft(within(menu).getByRole("status").textContent).toContain(
      "标准，第 2 项，共 " + scenario.targetEfforts.length + " 项",
    );
    expect.soft(recentModelConfigs()[0].reasoningEffort).toBe("medium");
  },
);
