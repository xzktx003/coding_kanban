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

const api = vi.hoisted(() => ({
  listModels: vi.fn(), listOtherModels: vi.fn(),
  listConfigProviders: vi.fn(), listProviderPresets: vi.fn(),
}));

// Actual hook/cache/stores, nested Trigger and Radix. Only four IO reads are
// fixtures; neither readiness nor the component/identity helpers are mocked.
vi.mock("@session/services/apiAdapt", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@session/services/apiAdapt")>()), ...api,
}));

const A = "r25-identity-owner-a";
const B = "r25-identity-owner-b";
const DRAFT = "R25 保留草稿与原始模型字符串";
const RAW_ALIAS = "r25-catalog-alias";
const CANONICAL = "r25-canonical-a";
const FRIENDLY_A = "R25 目录甲";
const FRIENDLY_B = "R25 目录乙";

function model(
  id: string,
  wireModel: string,
  label: string,
  efforts: ReasoningEffort[],
  defaultReasoningEffort: ReasoningEffort = "medium",
  isDefault = true,
): Model {
  return {
    id, model: wireModel, displayName: label,
    upgrade: null, upgradeInfo: null, availabilityNux: null,
    description: "Complete synthetic identity fixture; not a real account catalog",
    hidden: false, isDefault, defaultReasoningEffort,
    supportedReasoningEfforts: efforts.map((reasoningEffort) => ({ reasoningEffort, description: reasoningEffort })),
    inputModalities: ["text", "image"], supportsPersonality: false,
    additionalSpeedTiers: [], serviceTiers: [], defaultServiceTier: null,
  };
}

// A read-only observer of the real generic hook output. Native-only alignment
// must not change useModels.providerItems or grouped custom/Side semantics.
function GenericItemsProbe() {
  const { providerItems } = useModels();
  return <output hidden data-testid="r25-generic-items">{JSON.stringify(providerItems("openai"))}</output>;
}

function assertReads() {
  expect(api.listModels).toHaveBeenCalledTimes(1);
  expect(api.listModels).toHaveBeenCalledWith();
  expect(api.listOtherModels).toHaveBeenCalledTimes(1);
  expect(api.listConfigProviders).toHaveBeenCalledTimes(1);
  expect(api.listProviderPresets).toHaveBeenCalledTimes(1);
}

function captureCatalog(response: ModelListResponse) {
  const raw = structuredClone(response);
  const records = [...response.data];
  const efforts = response.data.map((entry) => entry.supportedReasoningEfforts);
  return () => {
    const cache = useModelCacheStore.getState();
    expect(response).toEqual(raw);
    expect(cache.openAiModels).toBe(response.data);
    expect(cache.modelSnapshot).toBe(response.data);
    expect(cache.openAiModels).toHaveLength(records.length);
    records.forEach((entry, index) => {
      expect(cache.openAiModels[index]).toBe(entry);
      expect(entry.supportedReasoningEfforts).toBe(efforts[index]);
    });
    expect(JSON.parse(screen.getByTestId("r25-generic-items").textContent ?? "null")).toEqual(
      response.data.map((entry) => ({ id: entry.id, label: entry.displayName || entry.model, description: entry.description })),
    );
  };
}

function mountSurface({ selected, effort = "medium", provider = "openai", expanded = false, seedRecentAlias = false, serviceTier = null }: {
  selected: string; effort?: ReasoningEffort; provider?: string; expanded?: boolean; seedRecentAlias?: boolean; serviceTier?: string | null;
}) {
  if (seedRecentAlias) rememberRecentModel({ model: RAW_ALIAS, label: "R25 保留旧别名", reasoningEffort: "medium", serviceTier: null });
  hydrateThreadModel(A, { model: selected, modelProvider: provider, reasoningEffort: effort, serviceTier });
  hydrateThreadModel(B, { model: "r25-untouched-b", modelProvider: "openai", reasoningEffort: "persistent", serviceTier: null });
  const before = {
    a: useThreadModelStore.getState().threads[A], b: useThreadModelStore.getState().threads[B],
    defaults: useConfigStore.getState(), custom: useModelSettingsStore.getState(), recent: recentModelConfigs(),
  };
  const submit = vi.fn();
  const view = render(
    <div className="session-mode">
      <section className={expanded ? "session-composer-sheet is-full" : "session-codex-composer"} data-draft-owner={`codex:${A}`}>
        <form onSubmit={(event) => { event.preventDefault(); submit(); }}>
          <div className="session-rich-draft"><textarea aria-label="R25 保留草稿" defaultValue={DRAFT} /></div>
          <NativeModelSelector threadId={A} draftOwner={`codex:${A}`} />
          <GenericItemsProbe />
        </form>
      </section>
    </div>,
  );
  const editor = screen.getByRole("textbox", { name: "R25 保留草稿" }) as HTMLTextAreaElement;
  vi.spyOn(editor, "getClientRects").mockReturnValue({ length: 1 } as DOMRectList);
  return { ...view, selected, before, editor, submit };
}

type Surface = ReturnType<typeof mountSurface>;

function assertProtected(surface: Surface, expected?: { serviceTier: string | null }) {
  const stripAllowedSelection = (entry: typeof surface.before.a) => {
    const { model: _model, reasoningEffort: _effort, providerModels: _models,
      revision: _revision, pending: _pending, pendingFields: _pendingFields,
      notice: _notice, ...rest } = entry;
    return rest;
  };
  const protectedBefore = stripAllowedSelection(surface.before.a);
  expect(stripAllowedSelection(useThreadModelStore.getState().threads[A])).toEqual(
    expected ? { ...protectedBefore, serviceTier: expected.serviceTier } : protectedBefore,
  );
  expect(useThreadModelStore.getState().threads[B]).toBe(surface.before.b);
  expect(useConfigStore.getState()).toBe(surface.before.defaults);
  expect(useModelSettingsStore.getState()).toBe(surface.before.custom);
  expect(useCodexStore.getState().currentThreadId).toBe(A);
  expect(surface.editor.closest("[data-draft-owner]")?.getAttribute("data-draft-owner")).toBe(`codex:${A}`);
  expect(surface.editor.value).toBe(DRAFT);
  expect(surface.editor.isConnected).toBe(true);
  expect(surface.submit).not.toHaveBeenCalled();
  expect(globalThis.fetch).not.toHaveBeenCalled();
  assertReads();
}

function assertReadOnly(surface: Surface) {
  expect(useThreadModelStore.getState().threads[A]).toBe(surface.before.a);
  expect(recentModelConfigs()).toEqual(surface.before.recent);
  assertProtected(surface);
}

async function settled(response: ModelListResponse) {
  await waitFor(() => expect(useModelCacheStore.getState().loaded).toBe(true));
  const state = useModelCacheStore.getState();
  expect(state.modelStatus).toBe("success");
  expect(state.loading).toBe(false);
  expect(state.error).toBeNull();
  expect(state.openAiModels).toBe(response.data);
  expect(state.modelSnapshot).toBe(response.data);
  assertReads();
}

async function openSimple() {
  const button = screen.getByRole("button", { name: /^模型：/ });
  fireEvent.keyDown(button, { key: "ArrowDown", code: "ArrowDown" });
  const menu = await screen.findByRole("menu");
  vi.spyOn(menu, "getClientRects").mockReturnValue({ length: 1 } as DOMRectList);
  await waitFor(() => expect(menu.querySelector("[data-model-picker-view]")?.getAttribute("data-model-picker-view")).toBe("simple"));
  return { button, menu };
}

async function openAdvanced(menu: HTMLElement) {
  const caption = within(menu).getByRole("menuitem", { name: "选择模型" });
  fireEvent.pointerDown(caption, { button: 0, ctrlKey: false, pointerType: "mouse" });
  fireEvent.click(caption);
  await waitFor(() => expect(menu.querySelector("[data-model-picker-view]")?.getAttribute("data-model-picker-view")).toBe("advanced"));
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Unexpected R25 transport")));
  api.listModels.mockResolvedValue({ data: [], nextCursor: null });
  api.listOtherModels.mockResolvedValue([]);
  api.listConfigProviders.mockResolvedValue([]);
  api.listProviderPresets.mockResolvedValue([]);
  useModelCacheStore.setState({ openAiModels: [], otherModels: {}, configProviders: [], presets: [], loaded: false, loading: false, error: null, modelStatus: "pending", modelSnapshot: null });
  useModelSettingsStore.setState({ models: {} });
  useThreadModelStore.setState({ threads: {} });
  useConfigStore.setState({ model: "r25-global-default", modelProvider: "openai", providerModels: { openai: "r25-global-default" }, reasoningEffort: "high", serviceTier: null });
  useCodexStore.setState({ currentThreadId: A });
  useLayoutStore.setState({ view: "agent" });
  resetRecentModels();
});

afterEach(() => {
  try { expect(globalThis.fetch).not.toHaveBeenCalled(); }
  finally { cleanup(); vi.unstubAllGlobals(); }
});

type IdentityCase = {
  name: string; selected: string; effort: ReasoningEffort; catalog: () => Model[];
  label: string; dots: number; effortLabel: string; statusEffort: string;
  checked: string[]; provider?: string; preserveRecentAlias?: boolean;
};
const identityCases: IdentityCase[] = [
  {
    name: "canonical-only current record keeps its friendly label and row value",
    selected: CANONICAL, effort: "medium", preserveRecentAlias: true,
    catalog: () => [model(RAW_ALIAS, CANONICAL, FRIENDLY_A, ["low", "medium"])],
    label: FRIENDLY_A, dots: 2, effortLabel: "中", statusEffort: "标准", checked: [FRIENDLY_A],
  },
  {
    name: "id-only string stays raw unknown instead of borrowing known capabilities",
    selected: RAW_ALIAS, effort: "medium",
    catalog: () => [model(RAW_ALIAS, CANONICAL, FRIENDLY_A, ["low", "medium"])],
    label: "自定义", dots: 6, effortLabel: "中", statusEffort: "标准", checked: [RAW_ALIAS],
  },
  {
    name: "an earlier catalog id cannot shadow a later canonical record",
    selected: "r25-canonical-b", effort: "high",
    catalog: () => [
      model("r25-canonical-b", "r25-canonical-a", FRIENDLY_A, ["low", "medium"]),
      model("r25-catalog-b", "r25-canonical-b", FRIENDLY_B, ["medium", "high"], "medium", false),
    ],
    label: FRIENDLY_B, dots: 2, effortLabel: "高", statusEffort: "深度", checked: [FRIENDLY_B],
  },
];

async function verifyProjection(testCase: IdentityCase, expanded: boolean) {
  const response: ModelListResponse = { data: testCase.catalog(), nextCursor: null };
  const assertRaw = captureCatalog(response);
  api.listModels.mockResolvedValue(response);
  if (testCase.provider) {
    api.listConfigProviders.mockResolvedValue([{ name: testCase.provider, base_url: "https://unused.invalid" }]);
    api.listOtherModels.mockResolvedValue([{ provider: testCase.provider, models: [{ id: testCase.selected }] }]);
    useModelSettingsStore.setState({ models: { [testCase.provider]: [{ id: testCase.selected, name: testCase.label }] } });
  }
  const surface = mountSurface({ selected: testCase.selected, effort: testCase.effort, provider: testCase.provider, expanded, seedRecentAlias: testCase.preserveRecentAlias });
  await settled(response);
  assertReadOnly(surface); assertRaw();
  const { button, menu } = await openSimple();
  const observed = {
    closed: button.querySelector(".session-native-model-label")?.textContent,
    closedEffort: button.querySelector(".session-native-model-effort")?.textContent,
    aria: button.getAttribute("aria-label"),
    purpose: button.querySelector(".session-native-model-trigger-placeholder")?.textContent ?? null,
    caption: menu.querySelector(".session-native-power-model")?.textContent,
    captionEffort: menu.querySelector(".session-native-power-effort")?.textContent,
    dots: menu.querySelectorAll(".session-native-power-dot").length,
    status: within(menu).getByRole("status").textContent,
  };
  assertReadOnly(surface); assertRaw();
  // Only these projection expectations are prospective product RED assertions.
  // Raw alias settings/ARIA and the local extra checked row are diagnostics,
  // not a claim about a full original GUI or upstream saved-alias normalization.
  if (testCase.provider) {
    expect.soft(observed.closed).toBe(testCase.label);
    expect.soft(observed.closedEffort).toBe(testCase.effortLabel);
    expect.soft(observed.aria).toBe(`模型：${testCase.selected}，${testCase.effort}`);
    expect.soft(observed.purpose).toBeNull();
  } else {
    expect.soft(observed.closed).toBeUndefined();
    expect.soft(observed.closedEffort).toBeUndefined();
    expect.soft(observed.aria).toBeNull();
    expect.soft(observed.purpose).toBe("选择强度");
  }
  expect.soft(observed.caption).toBe(testCase.label);
  expect.soft(observed.captionEffort).toBe(testCase.effortLabel);
  expect.soft(observed.dots).toBe(testCase.dots);
  expect.soft(observed.status).toContain(`${testCase.label} ${testCase.statusEffort}`);
  await openAdvanced(menu);
  const rows = within(menu).getAllByRole("menuitemradio");
  expect.soft(rows.filter((row) => row.getAttribute("aria-checked") === "true").map((row) => row.textContent?.trim())).toEqual(testCase.checked);
  assertReadOnly(surface); assertRaw();
}

it.each([false, true].flatMap((expanded) => identityCases.map((testCase) => ({ ...testCase, expanded }))))(
  "$name / expanded=$expanded uses ordinary canonical identity without repair",
  async (testCase) => verifyProjection(testCase, testCase.expanded),
);

const controls: IdentityCase[] = [
  {
    name: "equal id/model known control",
    selected: "r25-equal", effort: "medium",
    catalog: () => [model("r25-equal", "r25-equal", FRIENDLY_A, ["low", "medium"])],
    label: FRIENDLY_A, dots: 2, effortLabel: "中", statusEffort: "标准", checked: [FRIENDLY_A],
  },
  {
    name: "grouped custom control remains id-based despite OpenAI metadata collision",
    selected: RAW_ALIAS, effort: "none", provider: "r25-custom",
    catalog: () => [model(RAW_ALIAS, CANONICAL, FRIENDLY_A, ["medium"])],
    label: "R25 自定义目录", dots: 5, effortLabel: "无", statusEffort: "无", checked: ["R25 自定义目录"],
  },
];
it.each(controls)("$name preserves unrelated shared projection", async (testCase) => verifyProjection(testCase, false));

it("explicit different row stores canonical model and takes effort from that same target record", async () => {
  const current = "r25-current";
  const target = "r25-target-canonical";
  const response: ModelListResponse = { data: [
    // Earlier DTO.id collides with the target canonical value; effort lookup
    // must use the selected target record rather than the shared id-only helper.
    model(target, current, "R25 当前模型", ["low", "medium", "high"]),
    model("r25-target-catalog-id", target, FRIENDLY_B, ["low", "medium"], "medium", false),
  ], nextCursor: null };
  const assertRaw = captureCatalog(response);
  api.listModels.mockResolvedValue(response);
  const surface = mountSurface({ selected: current, effort: "high" });
  await settled(response);
  assertReadOnly(surface); assertRaw();
  const { menu } = await openSimple();
  await openAdvanced(menu);
  const row = within(menu).getByRole("menuitemradio", { name: FRIENDLY_B });
  fireEvent.pointerDown(row, { button: 0, ctrlKey: false, pointerType: "mouse" });
  fireEvent.click(row);
  await waitFor(() => expect(menu.querySelector("[data-model-picker-view]")?.getAttribute("data-model-picker-view")).toBe("simple"));
  const after = useThreadModelStore.getState().threads[A];
  assertProtected(surface); assertRaw();
  expect.soft(after.model).toBe(target);
  expect.soft(after.providerModels.openai).toBe(target);
  expect.soft(after.reasoningEffort).toBe("medium");
  expect.soft(after.revision).toBeGreaterThan(surface.before.a.revision);
  expect.soft(recentModelConfigs()[0]).toMatchObject({ model: target, label: FRIENDLY_B, reasoningEffort: "medium", serviceTier: null });
  // This is a local state handoff assertion, not an atomic native pair/RPC ACK.
});

it("explicit current canonical row preserves settings entry while remembering the canonical recent value", async () => {
  const response: ModelListResponse = { data: [model(RAW_ALIAS, CANONICAL, FRIENDLY_A, ["low", "medium"])], nextCursor: null };
  const assertRaw = captureCatalog(response);
  api.listModels.mockResolvedValue(response);
  const surface = mountSurface({ selected: CANONICAL, effort: "medium", expanded: true, seedRecentAlias: true });
  await settled(response);
  assertReadOnly(surface); assertRaw();
  const { menu } = await openSimple();
  await openAdvanced(menu);
  const row = within(menu).getByRole("menuitemradio", { name: FRIENDLY_A });
  fireEvent.pointerDown(row, { button: 0, ctrlKey: false, pointerType: "mouse" });
  fireEvent.click(row);
  await waitFor(() => expect(menu.querySelector("[data-model-picker-view]")?.getAttribute("data-model-picker-view")).toBe("simple"));
  assertProtected(surface); assertRaw();
  expect.soft(useThreadModelStore.getState().threads[A]).toBe(surface.before.a);
  expect.soft(useThreadModelStore.getState().threads[A].model).toBe(CANONICAL);
  expect.soft(recentModelConfigs()[0]).toMatchObject({ model: CANONICAL, label: FRIENDLY_A, reasoningEffort: "medium", serviceTier: null });
  expect.soft(recentModelConfigs().slice(1)).toEqual(surface.before.recent);
});


// Both cases initialize an advertised priority tier before render. The middle
// record is an independent id collision, never the actual current model.
it.each([
  { name: "retains priority supported by the actual canonical target", targetSupportsPriority: true, expectedTier: "priority" },
  { name: "clears priority unsupported by the actual canonical target", targetSupportsPriority: false, expectedTier: null },
])("explicit target $name despite opposite decoy tier metadata", async ({ targetSupportsPriority, expectedTier }) => {
  const current = "r25-tier-current";
  const target = "r25-tier-target-canonical";
  const targetLabel = "R25 Tier 目标模型";
  const priority = { id: "priority", name: "Fixture priority", description: "Synthetic tier fixture" };
  const response: ModelListResponse = { data: [
    { ...model(current, current, "R25 Tier 当前模型", ["low", "medium", "high"]), serviceTiers: [priority] },
    // Earlier id matches target canonical, but this is a different model. Its
    // high effort and opposite tier detect a partially migrated target lookup.
    { ...model(target, "r25-tier-decoy-canonical", "R25 Tier 干扰模型", ["low", "medium", "high"], "medium", false),
      serviceTiers: targetSupportsPriority ? [] : [priority] },
    { ...model("r25-tier-target-catalog-id", target, targetLabel, ["low", "medium"], "medium", false),
      serviceTiers: targetSupportsPriority ? [priority] : [] },
  ], nextCursor: null };
  const assertRaw = captureCatalog(response);
  const tierArrays = response.data.map((entry) => entry.serviceTiers);
  const tierRecords = response.data.map((entry) => [...entry.serviceTiers]);
  const assertTierReferences = () => response.data.forEach((entry, index) => {
    expect(entry.serviceTiers).toBe(tierArrays[index]);
    expect(entry.serviceTiers).toHaveLength(tierRecords[index].length);
    entry.serviceTiers.forEach((tier, tierIndex) => expect(tier).toBe(tierRecords[index][tierIndex]));
  });
  api.listModels.mockResolvedValue(response);
  const surface = mountSurface({ selected: current, effort: "high", serviceTier: "priority" });
  await settled(response);
  expect(surface.before.a.serviceTier).toBe("priority");
  expect(response.data[0].serviceTiers.some((tier) => tier.id === "priority")).toBe(true);
  assertReadOnly(surface); assertRaw(); assertTierReferences();
  const { menu } = await openSimple();
  await openAdvanced(menu);
  assertReadOnly(surface); assertRaw(); assertTierReferences();
  const row = within(menu).getByRole("menuitemradio", { name: targetLabel });
  fireEvent.pointerDown(row, { button: 0, ctrlKey: false, pointerType: "mouse" });
  fireEvent.click(row);
  await waitFor(() => expect(menu.querySelector("[data-model-picker-view]")?.getAttribute("data-model-picker-view")).toBe("simple"));
  const after = useThreadModelStore.getState().threads[A];
  // Only this explicitly declared tier result is allowed; native snapshots,
  // other settings, owner/B/defaults/draft and all IO remain protected.
  assertProtected(surface, { serviceTier: expectedTier }); assertRaw(); assertTierReferences();
  expect.soft(after.model).toBe(target);
  expect.soft(after.providerModels).toEqual({ ...surface.before.a.providerModels, openai: target });
  expect.soft(after.reasoningEffort).toBe("medium");
  expect.soft(after.serviceTier).toBe(expectedTier);
  expect.soft(after.revision).toBeGreaterThan(surface.before.a.revision);
  // Existing choose records recent before a possible tier clear. Preserve the
  // captured priority here even when the final thread tier becomes null.
  expect.soft(recentModelConfigs()[0]).toMatchObject({ model: target, label: targetLabel, reasoningEffort: "medium", serviceTier: "priority" });
  // This observes a local UI handoff, not a native atomic pair or RPC ACK.
});
