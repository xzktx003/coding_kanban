import { useNativeModelPickerPreferencesStore } from "@session/stores/settings/useNativeModelPickerPreferencesStore";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Model, ModelListResponse } from "@session/bindings/v2";
import { useLayoutStore } from "@session/stores/useLayoutStore";
import { useModelSettingsStore } from "@session/stores/settings";
import {
  changeThreadModel,
  hydrateThreadModel,
  useThreadModelStore,
} from "@session/stores/useThreadModelStore";
import { useConfigStore } from "../stores/useConfigStore";
import { useCodexStore } from "../stores/useCodexStore";
import { useModelCacheStore } from "../hooks/useModels";
import { NativeModelSelector } from "./NativeModelSelector";
import { recentModelConfigs, resetRecentModels } from "./recentModelConfigs";

const api = vi.hoisted(() => ({
  listModels: vi.fn(),
  listOtherModels: vi.fn(),
  listConfigProviders: vi.fn(),
  listProviderPresets: vi.fn(),
}));

// Actual hook/cache, thread/config stores, nested Trigger, Tooltip and Radix.
// Only the four catalog reads are fixtures; readiness is never stubbed.
vi.mock("@session/services/apiAdapt", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@session/services/apiAdapt")>()),
  ...api,
}));

const A = "r20-label-a";
const B = "r20-label-b";
const UNKNOWN = "r20-typed-unknown";
const DRAFT = "R20 保留原草稿与模型身份";

function model(id: string, efforts: string[], wireModel = id): Model {
  return {
    id,
    model: wireModel,
    upgrade: null,
    upgradeInfo: null,
    availabilityNux: null,
    displayName: `目录 ${id}`,
    description: "Complete synthetic model/list fixture",
    hidden: false,
    supportedReasoningEfforts: efforts.map((reasoningEffort) => ({
      reasoningEffort,
      description: reasoningEffort,
    })),
    defaultReasoningEffort: "medium",
    inputModalities: ["text", "image"],
    supportsPersonality: false,
    additionalSpeedTiers: [],
    serviceTiers: [],
    defaultServiceTier: null,
    isDefault: true,
  };
}

function fixture(data: Model[] = []): ModelListResponse {
  return { data, nextCursor: null };
}

function captureCatalog(response: ModelListResponse) {
  const raw = structuredClone(response);
  const options = response.data.map((item) => item.supportedReasoningEfforts);
  return () => {
    const cache = useModelCacheStore.getState();
    expect(response).toEqual(raw);
    expect(cache.openAiModels).toBe(response.data);
    response.data.forEach((item, index) => {
      expect(cache.openAiModels[index]).toBe(item);
      expect(item.supportedReasoningEfforts).toBe(options[index]);
    });
  };
}

function assertReads(providerReads = 1) {
  expect(api.listModels).toHaveBeenCalledTimes(1);
  expect(api.listOtherModels).toHaveBeenCalledTimes(1);
  expect(api.listProviderPresets).toHaveBeenCalledTimes(1);
  expect(api.listConfigProviders).toHaveBeenCalledTimes(providerReads);
}

async function waitForSuccessfulCatalog(response: ModelListResponse) {
  await waitFor(() => expect(useModelCacheStore.getState().loaded).toBe(true));
  const cache = useModelCacheStore.getState();
  expect(cache.loading).toBe(false);
  expect(cache.error).toBeNull();
  expect(cache.openAiModels).toBe(response.data);
  assertReads();
}

function mountSurface({
  selected = UNKNOWN,
  effort = "none",
  provider = "openai",
  expanded = false,
}: {
  selected?: string;
  effort?: "none" | null;
  provider?: string;
  expanded?: boolean;
} = {}) {
  hydrateThreadModel(A, {
    // hydrateThreadModel deliberately ignores an empty model. Construct the
    // empty-string control through the real user-change path after a seed.
    model: selected || "r20-before-empty-user-change",
    modelProvider: provider,
    reasoningEffort: effort,
    serviceTier: null,
  });
  if (selected === "") changeThreadModel(A, { model: "", reasoningEffort: effort });
  hydrateThreadModel(B, {
    model: "r20-other-owner",
    modelProvider: "openai",
    reasoningEffort: "persistent",
    serviceTier: null,
  });
  const before = {
    a: useThreadModelStore.getState().threads[A],
    b: useThreadModelStore.getState().threads[B],
    defaults: useConfigStore.getState(),
    customModels: useModelSettingsStore.getState(),
  };
  const submit = vi.fn();
  const view = render(
    <div className="session-mode">
      <section
        className={expanded ? "session-composer-sheet is-full" : "session-codex-composer"}
        data-draft-owner={`codex:${A}`}
      >
        <form onSubmit={(event) => { event.preventDefault(); submit(); }}>
          <div className="session-rich-draft">
            <textarea aria-label="R20 保留草稿" defaultValue={DRAFT} />
          </div>
          <NativeModelSelector threadId={A} draftOwner={`codex:${A}`} />
        </form>
      </section>
    </div>,
  );
  const editor = screen.getByRole("textbox", { name: "R20 保留草稿" }) as HTMLTextAreaElement;
  // Establish a real captured composer owner in jsdom before opening the menu.
  vi.spyOn(editor, "getClientRects").mockReturnValue({ length: 1 } as DOMRectList);
  return { ...view, before, editor, submit, selected };
}

type Surface = ReturnType<typeof mountSurface>;

function assertUnrelated(surface: Surface) {
  const current = useThreadModelStore.getState().threads[A];
  expect(current.model).toBe(surface.before.a.model);
  expect(current.modelProvider).toBe(surface.before.a.modelProvider);
  expect(current.serviceTier).toBe(surface.before.a.serviceTier);
  expect(current.sandbox).toBe(surface.before.a.sandbox);
  expect(current.approvalPolicy).toBe(surface.before.a.approvalPolicy);
  expect(current.approvalsReviewer).toBe(surface.before.a.approvalsReviewer);
  expect(useThreadModelStore.getState().threads[B]).toBe(surface.before.b);
  expect(useConfigStore.getState()).toBe(surface.before.defaults);
  expect(useModelSettingsStore.getState()).toBe(surface.before.customModels);
  expect(useCodexStore.getState().currentThreadId).toBe(A);
  expect(surface.editor.closest("[data-draft-owner]")?.getAttribute("data-draft-owner")).toBe(`codex:${A}`);
  expect(surface.editor.value).toBe(DRAFT);
  expect(surface.submit).not.toHaveBeenCalled();
  expect(globalThis.fetch).not.toHaveBeenCalled();
}

function assertReadOnly(surface: Surface) {
  expect(useThreadModelStore.getState().threads[A]).toBe(surface.before.a);
  expect(recentModelConfigs()).toEqual([]);
  assertUnrelated(surface);
}

function trigger() {
  return screen.getByRole("button", { name: /^模型：/ });
}

async function inspectLabels(
  surface: Surface,
  statusModelLabel: string,
  displayedEffort: "none" | "medium",
  dots: number | null,
) {
  const button = trigger();
  expect(button.getAttribute("aria-label")).toBe(`模型：${surface.selected || "选择模型"}，${displayedEffort}`);
  expect(button.querySelector(".session-native-model-effort")?.textContent).toBe(displayedEffort === "none" ? "无" : "中");
  const closed = button.querySelector(".session-native-model-label")?.textContent;
  fireEvent.keyDown(button, { key: "ArrowDown", code: "ArrowDown" });
  const menu = await screen.findByRole("menu");
  vi.spyOn(menu, "getClientRects").mockReturnValue({ length: 1 } as DOMRectList);
  expect(menu.querySelector("[data-model-picker-view]")?.getAttribute("data-model-picker-view")).toBe(dots === null ? "advanced" : "simple");
  const caption = menu.querySelector(".session-native-power-model");
  if (dots === null) {
    expect(caption).toBeNull();
    expect(menu.querySelector("[data-reasoning-slider]")).toBeNull();
  } else {
    expect(menu.querySelectorAll(".session-native-power-dot")).toHaveLength(dots);
    expect(menu.querySelector(".session-native-power-effort")?.textContent).toBe(displayedEffort === "none" ? "无" : "中");
    const status = within(menu).getByRole("status").textContent;
    const statusEffortLabel = displayedEffort === "none"
      ? "无"
      : surface.before.a.modelProvider === "openai" ? "标准" : "中";
    expect(status).toContain(`${statusModelLabel} ${statusEffortLabel}`);
    expect(status).toContain(`共 ${dots} 项`);
  }
  return { closed, caption: caption?.textContent ?? null, menu };
}

beforeEach(() => {
  // Explicit initial enabled membership preserves the original none/minimal/max
  // counterexamples. The app display policy still excludes ultra.
  useNativeModelPickerPreferencesStore.getState().setEnabledReasoningEfforts([
    "none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra", "persistent",
  ]);
  vi.resetAllMocks();
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Unexpected R20 transport")));
  api.listModels.mockResolvedValue(fixture());
  api.listOtherModels.mockResolvedValue([]);
  api.listConfigProviders.mockResolvedValue([]);
  api.listProviderPresets.mockResolvedValue([]);
  useModelCacheStore.setState({ openAiModels: [], otherModels: {}, configProviders: [], presets: [], loaded: false, loading: false, error: null, modelStatus: "pending", modelSnapshot: null });
  useModelSettingsStore.setState({ models: {} });
  useThreadModelStore.setState({ threads: {} });
  useConfigStore.setState({ model: "r20-default", modelProvider: "openai", providerModels: { openai: "r20-default" }, reasoningEffort: "high", serviceTier: null });
  useCodexStore.setState({ currentThreadId: A });
  useLayoutStore.setState({ view: "agent" });
  resetRecentModels();
});

afterEach(() => {
  try {
    expect(globalThis.fetch).not.toHaveBeenCalled();
  } finally {
    cleanup();
    vi.unstubAllGlobals();
  }
});

it.each([
  { name: "main empty catalog / none", selected: UNKNOWN, effort: "none" as const, expanded: false, nonempty: false },
  { name: "expanded gpt-prefixed literal / none", selected: "gpt-7-r20-future-unknown", effort: "none" as const, expanded: true, nonempty: true },
  { name: "expanded explicit-null effort", selected: UNKNOWN, effort: null, expanded: true, nonempty: false },
])("shows 自定义 in visible model spans and the native live status: $name", async (testCase) => {
  const response = fixture(testCase.nonempty ? [model("r20-unrelated", ["low", "medium"])] : []);
  const assertRaw = captureCatalog(response);
  api.listModels.mockResolvedValue(response);
  const surface = mountSurface(testCase);
  expect(surface.before.a.reasoningEffort).toBe(testCase.effort);
  expect(surface.before.defaults.reasoningEffort).toBe("high");
  await waitForSuccessfulCatalog(response);
  const labels = await inspectLabels(surface, "自定义", "medium", 6);
  assertReadOnly(surface);
  assertRaw();
  assertReads();
  // R20 visible-span guards remain; inspectLabels also checks the R23 live label.
  expect.soft(labels.closed).toBe("自定义");
  expect.soft(labels.caption).toBe("自定义");
});

type Control = {
  name: string;
  selected: string;
  catalog: () => Model[];
  label: string;
  displayedEffort: "none" | "medium";
  dots: number | null;
  custom?: boolean;
};
const controls: Control[] = [
  { name: "id-only alias remains raw unknown in the native UI", selected: "r20-alias-id", catalog: () => [model("r20-alias-id", ["low", "medium"], "r20-alias-wire")], label: "自定义", displayedEffort: "medium", dots: 6 },
  { name: "canonical model uses its catalog display label", selected: "r20-alias-wire", catalog: () => [model("r20-alias-id", ["low", "medium"], "r20-alias-wire")], label: "目录 r20-alias-id", displayedEffort: "medium", dots: 2 },
  { name: "known zero-effort remains advanced", selected: "r20-known-zero", catalog: () => [model("r20-known-zero", [])], label: "目录 r20-known-zero", displayedEffort: "medium", dots: null },
  { name: "known one-effort remains advanced", selected: "r20-known-one", catalog: () => [model("r20-known-one", ["none"])], label: "目录 r20-known-one", displayedEffort: "none", dots: null },
  { name: "custom provider keeps its friendly label despite same-ID OpenAI metadata", selected: "r20-custom-model", catalog: () => [model("r20-custom-model", ["medium"])], label: "Fixture custom display", displayedEffort: "none", dots: 5, custom: true },
  { name: "empty string keeps its existing empty label and raw none", selected: "", catalog: () => [model("r20-unrelated", ["low", "medium"])], label: "", displayedEffort: "none", dots: 5 },
];

it.each(controls)("does not relabel a successful control: $name", async (testCase) => {
  const response = fixture(testCase.catalog());
  const assertRaw = captureCatalog(response);
  api.listModels.mockResolvedValue(response);
  if (testCase.custom) {
    api.listConfigProviders.mockResolvedValue([{ name: "r20-custom", base_url: "https://unused.invalid" }]);
    api.listOtherModels.mockResolvedValue([{ provider: "r20-custom", models: [{ id: testCase.selected }] }]);
    useModelSettingsStore.setState({ models: { "r20-custom": [{ id: testCase.selected, name: testCase.label }] } });
  }
  const surface = mountSurface({ selected: testCase.selected, provider: testCase.custom ? "r20-custom" : "openai" });
  await waitForSuccessfulCatalog(response);
  const labels = await inspectLabels(surface, testCase.label, testCase.displayedEffort, testCase.dots);
  assertReadOnly(surface);
  assertRaw();
  assertReads();
  expect(labels.closed).toBe(testCase.label);
  expect(labels.caption).toBe(testCase.dots === null ? null : testCase.label);
});

it("shows Loading without repairing the raw identity while the actual model read is pending", async () => {
  let resolveModels!: (response: ModelListResponse) => void;
  const pending = new Promise<ModelListResponse>((resolve) => { resolveModels = resolve; });
  api.listModels.mockReturnValue(pending);
  const surface = mountSurface();
  try {
    await waitFor(() => expect(useModelCacheStore.getState().loading).toBe(true));
    expect(useModelCacheStore.getState().loaded).toBe(false);
    expect(useModelCacheStore.getState().error).toBeNull();
    const loadingTrigger = screen.getByRole("button", { name: "Loading model…" });
    expect(loadingTrigger.getAttribute("aria-label")).toBe("Loading model…");
    expect(loadingTrigger.querySelector(".session-native-model-label")?.textContent).toBe("Loading model…");
    expect((loadingTrigger as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(loadingTrigger, { key: "ArrowDown", code: "ArrowDown" });
    expect(screen.queryByRole("menu")).toBeNull();
    assertReadOnly(surface);
    assertReads();
  } finally {
    surface.unmount();
    await act(async () => { resolveModels(fixture()); await pending; });
    await waitFor(() => expect(useModelCacheStore.getState().loading).toBe(false));
  }
});

it("uses Custom for an accepted model snapshot after an ancillary read fails", async () => {
  const response = fixture();
  const assertRaw = captureCatalog(response);
  api.listModels.mockResolvedValue(response);
  api.listOtherModels.mockRejectedValue(new Error("fixture R20 partial failure"));
  const surface = mountSurface();
  await waitFor(() => expect(useModelCacheStore.getState().error).toContain("fixture R20 partial failure"));
  expect(useModelCacheStore.getState().loaded).toBe(false);
  expect(useModelCacheStore.getState().loading).toBe(false);
  const labels = await inspectLabels(surface, "自定义", "medium", 6);
  assertReadOnly(surface);
  assertRaw();
  assertReads();
  expect(labels.closed).toBe("自定义");
  expect(labels.caption).toBe("自定义");
});

it("keeps Custom for an accepted snapshot after a warm provider-only refresh fails", async () => {
  const response = fixture([model("r20-unrelated", ["low", "medium"])]);
  const assertRaw = captureCatalog(response);
  api.listModels.mockResolvedValue(response);
  api.listConfigProviders.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error("fixture R20 warm failure"));
  const surface = mountSurface();
  await waitForSuccessfulCatalog(response);
  await act(async () => { await useModelCacheStore.getState().refreshProviders(); });
  expect(useModelCacheStore.getState().loaded).toBe(true);
  expect(useModelCacheStore.getState().loading).toBe(false);
  expect(useModelCacheStore.getState().error).toContain("fixture R20 warm failure");
  const labels = await inspectLabels(surface, "自定义", "medium", 6);
  assertReadOnly(surface);
  assertRaw();
  assertReads(2);
  expect(labels.closed).toBe("自定义");
  expect(labels.caption).toBe("自定义");
});

it("uses ordinary purpose tooltip while retaining raw identity/recent and localized status; only explicit effort changes A", async () => {
  const response = fixture();
  const assertRaw = captureCatalog(response);
  api.listModels.mockResolvedValue(response);
  const surface = mountSurface();
  await waitForSuccessfulCatalog(response);
  act(() => trigger().focus());
  expect((await screen.findByRole("tooltip")).textContent).toContain("选择强度");
  act(() => surface.editor.focus());
  await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
  const { menu } = await inspectLabels(surface, "自定义", "medium", 6);
  assertReadOnly(surface);
  fireEvent.keyDown(within(menu).getByRole("menuitem", { name: "强度" }), { key: "ArrowRight", code: "ArrowRight" });
  expect(useThreadModelStore.getState().threads[A].reasoningEffort).toBe("high");
  expect(recentModelConfigs()).toEqual([{ model: UNKNOWN, label: UNKNOWN, reasoningEffort: "high", serviceTier: null }]);
  expect(within(menu).getByRole("status").textContent).toContain("自定义 深度");
  assertUnrelated(surface);
  assertRaw();
  assertReads();
});
