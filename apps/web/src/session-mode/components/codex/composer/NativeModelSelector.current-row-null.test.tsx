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

async function openAdvanced(surface: Surface, assertRaw: () => void) {
  const button = screen.getByRole("button", { name: /^模型：/ });
  fireEvent.keyDown(button, { key: "ArrowDown", code: "ArrowDown" });
  const menu = await screen.findByRole("menu");
  vi.spyOn(menu, "getClientRects").mockReturnValue({ length: 1 } as DOMRectList);
  await waitFor(() => expect(menu.querySelector("[data-model-picker-view]")?.getAttribute("data-model-picker-view")).toBe("simple"));
  assertReadOnly(surface); assertRaw();
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

it.each([{ expanded: false }, { expanded: true }])(
  "reselecting current native row preserves raw null / expanded=$expanded",
  async ({ expanded }) => {
    const response: ModelListResponse = { data: [model(CURRENT, CURRENT_LABEL, ["low", "medium", "high"], "high", true)], nextCursor: null };
    const assertRaw = captureCatalog(response);
    api.listModels.mockResolvedValue(response);
    const surface = mountSurface(null, expanded);
    await ready(response);
    assertReadOnly(surface); assertRaw();
    const { button, menu } = await openAdvanced(surface, assertRaw);
    expect(button.querySelector(".session-native-model-effort")?.textContent).toBe("中");
    await chooseRow(menu, CURRENT_LABEL);
    // Hard protections precede prospective product RED projections.
    assertProtected(surface); assertRaw();
    expect(recentModelConfigs()[0]).toMatchObject({ model: CURRENT, label: CURRENT_LABEL, serviceTier: null });
    expect(recentModelConfigs().slice(1)).toEqual(surface.before.recent);
    const after = useThreadModelStore.getState().threads[A];
    expect.soft(after).toBe(surface.before.a);
    expect.soft(after).toEqual(surface.before.aValue);
    expect.soft(after.reasoningEffort).toBeNull();
    expect.soft(after.revision).toBe(surface.before.aValue.revision);
    expect.soft(after.pending).toBe(surface.before.aValue.pending);
    expect.soft(after.pendingFields).toEqual(surface.before.aValue.pendingFields);
    expect.soft(button.querySelector(".session-native-model-effort")?.textContent).toBeUndefined();
  expect.soft(button.getAttribute("aria-label")).toBeNull();
  expect.soft(button.querySelector(".session-native-model-trigger-placeholder")?.textContent ?? null).toBe("选择强度");
    expect.soft(menu.querySelector(".session-native-power-effort")?.textContent).toBe("中");
  },
);

it("already-supported medium current-row control keeps entry and existing view/recent behavior", async () => {
  const response: ModelListResponse = { data: [model(CURRENT, CURRENT_LABEL, ["low", "medium", "high"], "high", true)], nextCursor: null };
  const assertRaw = captureCatalog(response);
  api.listModels.mockResolvedValue(response);
  const surface = mountSurface("medium", true);
  await ready(response);
  assertReadOnly(surface); assertRaw();
  const { menu } = await openAdvanced(surface, assertRaw);
  await chooseRow(menu, CURRENT_LABEL);
  assertProtected(surface); assertRaw();
  expect(useThreadModelStore.getState().threads[A]).toBe(surface.before.a);
  expect(useThreadModelStore.getState().threads[A]).toEqual(surface.before.aValue);
  expect(recentModelConfigs()[0]).toMatchObject({ model: CURRENT, label: CURRENT_LABEL, reasoningEffort: "medium", serviceTier: null });
  expect(recentModelConfigs().slice(1)).toEqual(surface.before.recent);
});

it("explicit different native row still adopts its supported default with captured-owner protections", async () => {
  const response: ModelListResponse = { data: [
    model(CURRENT, CURRENT_LABEL, ["low", "medium", "high"], "high", true),
    model(TARGET, TARGET_LABEL, ["low", "medium"], "medium", false),
  ], nextCursor: null };
  const assertRaw = captureCatalog(response);
  api.listModels.mockResolvedValue(response);
  const surface = mountSurface("high", false);
  await ready(response);
  assertReadOnly(surface); assertRaw();
  const { menu } = await openAdvanced(surface, assertRaw);
  await chooseRow(menu, TARGET_LABEL);
  assertProtected(surface, true); assertRaw();
  const after = useThreadModelStore.getState().threads[A];
  expect(after.model).toBe(TARGET);
  expect(after.providerModels).toEqual({ ...surface.before.aValue.providerModels, openai: TARGET });
  expect(after.reasoningEffort).toBe("medium");
  expect(after.revision).toBeGreaterThan(surface.before.aValue.revision);
  expect(after.pending).toBe(true);
  expect(after.pendingFields).toEqual(expect.arrayContaining(["model", "reasoningEffort"]));
  expect(recentModelConfigs()[0]).toMatchObject({ model: TARGET, label: TARGET_LABEL, reasoningEffort: "medium", serviceTier: null });
  expect(recentModelConfigs().slice(1)).toEqual(surface.before.recent);
});

// R27 tier supplement: the original four cases above are unchanged.
function captureTierReferences(response: ModelListResponse) {
  const arrays = response.data.map((record) => record.serviceTiers);
  const records = response.data.map((record) => [...record.serviceTiers]);
  return () => response.data.forEach((record, index) => {
    expect(record.serviceTiers).toBe(arrays[index]);
    expect(record.serviceTiers).toHaveLength(records[index].length);
    record.serviceTiers.forEach((tier, tierIndex) => expect(tier).toBe(records[index][tierIndex]));
  });
}

function assertCurrentRowTierSafety(surface: Surface) {
  // Effort/model/provider/tier provenance and every other setting remain hard
  // protections. Only the prospective tier/revision/pending results move to
  // the final full-entry soft assertions in this single same-row case.
  const protectedPart = (entry: typeof surface.before.a) => {
    const { serviceTier: _tier, revision: _revision, pending: _pending, pendingFields: _pendingFields, ...rest } = entry;
    return rest;
  };
  expect(protectedPart(useThreadModelStore.getState().threads[A])).toEqual(protectedPart(surface.before.aValue));
  assertUnrelatedProtected(surface);
}

it("reselecting current native row preserves a saved unsupported fast tier without repairing it", async () => {
  const response: ModelListResponse = { data: [model(CURRENT, CURRENT_LABEL, ["low", "medium", "high"], "high", true)], nextCursor: null };
  const assertRaw = captureCatalog(response);
  const assertTiers = captureTierReferences(response);
  api.listModels.mockResolvedValue(response);
  const surface = mountSurface("medium", false, "fast");
  await ready(response);
  expect(surface.before.a.serviceTier).toBe("fast");
  expect(response.data[0].serviceTiers).toEqual([]);
  assertReadOnly(surface); assertRaw(); assertTiers();
  const { menu } = await openAdvanced(surface, assertRaw);
  assertReadOnly(surface); assertRaw(); assertTiers();
  await chooseRow(menu, CURRENT_LABEL);
  // All unrelated safety/IO/owner/raw-catalog controls run before the tier RED.
  assertCurrentRowTierSafety(surface); assertRaw(); assertTiers();
  expect(recentModelConfigs()[0]).toMatchObject({ model: CURRENT, label: CURRENT_LABEL, reasoningEffort: "medium", serviceTier: "fast" });
  expect(recentModelConfigs().slice(1)).toEqual(surface.before.recent);
  const after = useThreadModelStore.getState().threads[A];
  expect.soft(after).toBe(surface.before.a);
  expect.soft(after).toEqual(surface.before.aValue);
  expect.soft(after.serviceTier).toBe("fast");
  expect.soft(after.revision).toBe(surface.before.aValue.revision);
  expect.soft(after.pending).toBe(surface.before.aValue.pending);
  expect.soft(after.pendingFields).toEqual(surface.before.aValue.pendingFields);
});

it("explicit different native row still clears saved fast when its target does not advertise that tier", async () => {
  const current = model(CURRENT, CURRENT_LABEL, ["low", "medium", "high"], "high", true);
  current.serviceTiers = [{ id: "fast", name: "R27 Fixture Fast", description: "Synthetic advertised fast tier" }];
  const response: ModelListResponse = { data: [
    current,
    model(TARGET, TARGET_LABEL, ["low", "medium"], "medium", false),
  ], nextCursor: null };
  const assertRaw = captureCatalog(response);
  const assertTiers = captureTierReferences(response);
  api.listModels.mockResolvedValue(response);
  const surface = mountSurface("high", true, "fast");
  await ready(response);
  expect(surface.before.a.serviceTier).toBe("fast");
  expect(response.data[0].serviceTiers.some((tier) => tier.id === "fast")).toBe(true);
  expect(response.data[1].serviceTiers).toEqual([]);
  assertReadOnly(surface); assertRaw(); assertTiers();
  const { menu } = await openAdvanced(surface, assertRaw);
  assertReadOnly(surface); assertRaw(); assertTiers();
  await chooseRow(menu, TARGET_LABEL);
  assertProtected(surface, true, { serviceTier: null }); assertRaw(); assertTiers();
  const after = useThreadModelStore.getState().threads[A];
  expect(after.model).toBe(TARGET);
  expect(after.providerModels).toEqual({ ...surface.before.aValue.providerModels, openai: TARGET });
  expect(after.reasoningEffort).toBe("medium");
  expect(after.serviceTier).toBeNull();
  expect(after.revision).toBeGreaterThan(surface.before.aValue.revision);
  expect(after.pending).toBe(true);
  expect(after.pendingFields).toEqual(expect.arrayContaining(["model", "reasoningEffort", "serviceTier"]));
  // Existing local recent snapshots capture the pre-clear tier. This control
  // preserves that behavior and makes no original recent/pair-ACK claim.
  expect(recentModelConfigs()[0]).toMatchObject({ model: TARGET, label: TARGET_LABEL, reasoningEffort: "medium", serviceTier: "fast" });
  expect(recentModelConfigs().slice(1)).toEqual(surface.before.recent);
});
