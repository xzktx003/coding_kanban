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
  hydrateThreadModel,
  useThreadModelStore,
} from "@session/stores/useThreadModelStore";
import { useConfigStore } from "../stores/useConfigStore";
import { useCodexStore } from "../stores/useCodexStore";
import { useModelCacheStore } from "../hooks/useModels";
import { NativeModelSelector } from "./NativeModelSelector";
import { resetRecentModels } from "./recentModelConfigs";

const api = vi.hoisted(() => ({
  listModels: vi.fn(),
  listOtherModels: vi.fn(),
  listConfigProviders: vi.fn(),
  listProviderPresets: vi.fn(),
}));

// Keep the actual hook/cache, thread/config stores, nested Trigger and Radix.
// Only the four external catalog reads are fixtures; no transport is allowed.
vi.mock("@session/services/apiAdapt/codex", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@session/services/apiAdapt/codex")>()),
  ...api,
}));

const A = "r18-a";
const B = "r18-b";
const UNKNOWN = "r18-typed-unknown";
const DRAFT = "R18 保留原草稿";

function catalogModel(id: string, efforts: string[]): Model {
  return {
    id,
    model: id,
    upgrade: null,
    upgradeInfo: null,
    availabilityNux: null,
    displayName: `目录 ${id}`,
    description: "Synthetic complete model/list fixture",
    hidden: false,
    supportedReasoningEfforts: efforts.map((reasoningEffort) => ({
      reasoningEffort,
      description: `${reasoningEffort} effort`,
    })),
    defaultReasoningEffort: efforts[0] ?? "medium",
    inputModalities: ["text", "image"],
    supportsPersonality: false,
    additionalSpeedTiers: [],
    serviceTiers: [],
    defaultServiceTier: null,
    isDefault: true,
  };
}

function prepareThread(
  effort: string,
  model = UNKNOWN,
  provider = "openai",
) {
  hydrateThreadModel(A, {
    model,
    modelProvider: provider,
    reasoningEffort: effort,
    serviceTier: null,
  });
  hydrateThreadModel(B, {
    model: "r18-other-owner",
    modelProvider: "openai",
    reasoningEffort: "persistent",
    serviceTier: null,
  });
  return {
    a: useThreadModelStore.getState().threads[A],
    b: useThreadModelStore.getState().threads[B],
    defaults: useConfigStore.getState(),
  };
}

function renderSurface() {
  const submit = vi.fn();
  const view = render(
    <div className="session-mode">
      <section
        className="session-codex-composer"
        data-draft-owner={`codex:${A}`}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div className="session-rich-draft">
            <textarea aria-label="R18 保留草稿" defaultValue={DRAFT} />
          </div>
          <NativeModelSelector threadId={A} draftOwner={`codex:${A}`} />
        </form>
      </section>
    </div>,
  );
  const editor = screen.getByRole("textbox", { name: "R18 保留草稿" });
  vi.spyOn(editor, "getClientRects").mockReturnValue({ length: 1 } as DOMRectList);
  return { ...view, submit };
}

function assertOneCatalogRead() {
  for (const read of Object.values(api)) expect(read).toHaveBeenCalledTimes(1);
}

function captureRawResponse(response: ModelListResponse) {
  const expected = structuredClone(response.data);
  const rawOptions = response.data.map((model) => model.supportedReasoningEfforts);
  return () => {
    const cache = useModelCacheStore.getState();
    expect(cache.openAiModels).toBe(response.data);
    expect(cache.openAiModels).toEqual(expected);
    response.data.forEach((model, index) => {
      expect(cache.openAiModels[index]).toBe(model);
      expect(cache.openAiModels[index].supportedReasoningEfforts).toBe(
        rawOptions[index],
      );
    });
    assertOneCatalogRead();
  };
}

async function waitForSuccessfulCatalog(response: ModelListResponse) {
  await waitFor(() => {
    expect(useModelCacheStore.getState().loaded).toBe(true);
  });
  const cache = useModelCacheStore.getState();
  expect(cache.loading).toBe(false);
  expect(cache.error).toBeNull();
  expect(cache.openAiModels).toBe(response.data);
  assertOneCatalogRead();
}

function trigger() {
  return screen.getByRole("button", { name: /^模型：/ });
}

async function openMenu() {
  fireEvent.keyDown(trigger(), { key: "ArrowDown", code: "ArrowDown" });
  const menu = await screen.findByRole("menu");
  vi.spyOn(menu, "getClientRects").mockReturnValue({ length: 1 } as DOMRectList);
  return menu;
}

function assertUnrelatedState(
  before: ReturnType<typeof prepareThread>,
  surface: ReturnType<typeof renderSurface>,
) {
  const current = useThreadModelStore.getState().threads[A];
  expect(current.model).toBe(before.a.model);
  expect(current.modelProvider).toBe(before.a.modelProvider);
  expect(current.serviceTier).toBe(before.a.serviceTier);
  expect(useThreadModelStore.getState().threads[B]).toBe(before.b);
  expect(useConfigStore.getState()).toBe(before.defaults);
  expect((screen.getByLabelText("R18 保留草稿") as HTMLTextAreaElement).value).toBe(
    DRAFT,
  );
  expect(surface.submit).not.toHaveBeenCalled();
  expect(globalThis.fetch).not.toHaveBeenCalled();
}

function assertNoSettingsWrite(
  before: ReturnType<typeof prepareThread>,
  surface: ReturnType<typeof renderSurface>,
) {
  expect(useThreadModelStore.getState().threads[A]).toBe(before.a);
  assertUnrelatedState(before, surface);
}

beforeEach(() => {
  // Explicit initial enabled membership preserves the original none/minimal/max
  // counterexamples. The app display policy still excludes ultra.
  useNativeModelPickerPreferencesStore.getState().setEnabledReasoningEfforts([
    "none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra", "persistent",
  ]);
  vi.resetAllMocks();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockRejectedValue(new Error("Unexpected R18 test transport")),
  );
  api.listModels.mockResolvedValue({ data: [], nextCursor: null });
  api.listOtherModels.mockResolvedValue([]);
  api.listConfigProviders.mockResolvedValue([]);
  api.listProviderPresets.mockResolvedValue([]);
  useModelCacheStore.setState({
    openAiModels: [],
    otherModels: {},
    configProviders: [],
    presets: [],
    loaded: false,
    loading: false,
    error: null,
    modelStatus: "pending",
    modelSnapshot: null,
  });
  useModelSettingsStore.setState({ models: {} });
  useThreadModelStore.setState({ threads: {} });
  useConfigStore.setState({
    model: "r18-default-model",
    modelProvider: "openai",
    providerModels: { openai: "r18-default-model" },
    reasoningEffort: "high",
    serviceTier: null,
  });
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

it("uses minimal immediately before low for an unknown OpenAI model after a successful empty catalog read", async () => {
  const response: ModelListResponse = { data: [], nextCursor: null };
  const assertRawCache = captureRawResponse(response);
  api.listModels.mockResolvedValue(response);
  const before = prepareThread("low");
  const surface = renderSurface();
  await waitForSuccessfulCatalog(response);
  expect(useModelCacheStore.getState().openAiModels).toHaveLength(0);
  const menu = await openMenu();
  expect(menu.querySelector("[data-model-picker-view]")?.getAttribute("data-model-picker-view")).toBe("simple");
  expect.soft(menu.querySelectorAll(".session-native-power-dot")).toHaveLength(6);
  expect.soft(within(menu).getByRole("status").textContent).toContain(
    "第 2 项，共 6 项",
  );
  assertNoSettingsWrite(before, surface);
  assertRawCache();
  fireEvent.keyDown(screen.getByRole("menuitem", { name: "强度" }), {
    key: "ArrowLeft",
    code: "ArrowLeft",
  });
  expect.soft(useThreadModelStore.getState().threads[A].reasoningEffort).toBe(
    "minimal",
  );
  assertUnrelatedState(before, surface);
  assertRawCache();
});

it("uses max immediately after xhigh when a successful nonempty OpenAI catalog lacks the typed model", async () => {
  const response: ModelListResponse = {
    data: [catalogModel("r18-unrelated-catalog-model", ["low", "medium"])],
    nextCursor: null,
  };
  const assertRawCache = captureRawResponse(response);
  api.listModels.mockResolvedValue(response);
  const before = prepareThread("xhigh");
  const surface = renderSurface();
  await waitForSuccessfulCatalog(response);
  expect(
    useModelCacheStore.getState().openAiModels.some(
      (model) => model.id === UNKNOWN || model.model === UNKNOWN,
    ),
  ).toBe(false);
  const menu = await openMenu();
  expect.soft(menu.querySelectorAll(".session-native-power-dot")).toHaveLength(6);
  expect.soft(within(menu).getByRole("status").textContent).toContain(
    "第 5 项，共 6 项",
  );
  assertNoSettingsWrite(before, surface);
  assertRawCache();
  fireEvent.keyDown(screen.getByRole("menuitem", { name: "强度" }), {
    key: "ArrowRight",
    code: "ArrowRight",
  });
  expect.soft(useThreadModelStore.getState().threads[A].reasoningEffort).toBe(
    "max",
  );
  assertUnrelatedState(before, surface);
  assertRawCache();
});

it("displays medium in the closed Trigger and simple menu for successful unknown OpenAI none without rewriting settings", async () => {
  const response: ModelListResponse = { data: [], nextCursor: null };
  const assertRawCache = captureRawResponse(response);
  api.listModels.mockResolvedValue(response);
  const before = prepareThread("none");
  const surface = renderSurface();
  await waitForSuccessfulCatalog(response);
  expect.soft(trigger().getAttribute("aria-label")).toBe(
    `模型：${UNKNOWN}，medium`,
  );
  expect.soft(document.querySelector(".session-native-model-effort")?.textContent).toBe("中");
  assertNoSettingsWrite(before, surface);
  const menu = await openMenu();
  expect.soft(menu.querySelectorAll(".session-native-power-dot")).toHaveLength(6);
  expect.soft(menu.querySelector(".session-native-power-effort")?.textContent).toBe("中");
  expect.soft(within(menu).getByRole("status").textContent).toContain(
    "第 3 项，共 6 项",
  );
  expect(useThreadModelStore.getState().threads[A].reasoningEffort).toBe("none");
  assertNoSettingsWrite(before, surface);
  assertRawCache();
});

it("keeps custom-provider none and five generic choices despite same-ID OpenAI metadata", async () => {
  const id = "r18-same-id";
  const response: ModelListResponse = {
    data: [catalogModel(id, ["medium"])],
    nextCursor: null,
  };
  const assertRawCache = captureRawResponse(response);
  api.listModels.mockResolvedValue(response);
  api.listConfigProviders.mockResolvedValue([
    { name: "fixture-custom", base_url: "https://unused.invalid" },
  ]);
  api.listOtherModels.mockResolvedValue([
    { provider: "fixture-custom", models: [{ id }] },
  ]);
  const before = prepareThread("none", id, "fixture-custom");
  const surface = renderSurface();
  await waitForSuccessfulCatalog(response);
  expect(trigger().getAttribute("aria-label")).toBe(`模型：${id}，none`);
  expect(document.querySelector(".session-native-model-effort")?.textContent).toBe("无");
  const menu = await openMenu();
  expect(menu.querySelectorAll(".session-native-power-dot")).toHaveLength(5);
  expect(menu.querySelector(".session-native-power-effort")?.textContent).toBe("无");
  assertNoSettingsWrite(before, surface);
  fireEvent.keyDown(screen.getByRole("menuitem", { name: "强度" }), {
    key: "ArrowRight",
    code: "ArrowRight",
  });
  expect(useThreadModelStore.getState().threads[A].reasoningEffort).toBe("low");
  assertUnrelatedState(before, surface);
  assertRawCache();
});

it.each([
  { count: 0, efforts: [] as string[], displayed: "中" },
  { count: 1, efforts: ["none"], displayed: "无" },
])("keeps a known $count-effort model advanced without manufacturing unknown choices", async ({ efforts, displayed }) => {
  const id = "r18-known-limited";
  const response: ModelListResponse = {
    data: [catalogModel(id, efforts)],
    nextCursor: null,
  };
  const assertRawCache = captureRawResponse(response);
  api.listModels.mockResolvedValue(response);
  const before = prepareThread("none", id);
  const surface = renderSurface();
  await waitForSuccessfulCatalog(response);
  expect(document.querySelector(".session-native-model-effort")?.textContent).toBe(displayed);
  const menu = await openMenu();
  expect(menu.querySelector("[data-model-picker-view]")?.getAttribute("data-model-picker-view")).toBe("advanced");
  expect(menu.querySelector("[data-reasoning-slider]")).toBeNull();
  expect(screen.queryByRole("menuitem", { name: "强度" })).toBeNull();
  expect(useThreadModelStore.getState().threads[A].reasoningEffort).toBe("none");
  assertNoSettingsWrite(before, surface);
  assertRawCache();
});

it("shows Loading and keeps raw none untouched while the actual model read is pending", async () => {
  let resolveModels!: (response: ModelListResponse) => void;
  const pending = new Promise<ModelListResponse>((resolve) => {
    resolveModels = resolve;
  });
  api.listModels.mockReturnValue(pending);
  const before = prepareThread("none");
  const surface = renderSurface();
  try {
    await waitFor(() => expect(useModelCacheStore.getState().loading).toBe(true));
    expect(useModelCacheStore.getState().loaded).toBe(false);
    expect(useModelCacheStore.getState().error).toBeNull();
    const loadingTrigger = screen.getByRole("button", { name: "Loading model…" });
    expect(loadingTrigger.getAttribute("aria-label")).toBe("Loading model…");
    expect(loadingTrigger.textContent).toContain("Loading model…");
    expect((loadingTrigger as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(loadingTrigger, { key: "ArrowDown", code: "ArrowDown" });
    expect(screen.queryByRole("menu")).toBeNull();
    assertNoSettingsWrite(before, surface);
    assertOneCatalogRead();
  } finally {
    surface.unmount();
    await act(async () => {
      resolveModels({ data: [], nextCursor: null });
      await pending;
    });
    await waitFor(() => expect(useModelCacheStore.getState().loading).toBe(false));
  }
});

it("uses six displayed choices without repairing raw none when model/list succeeds and another read fails", async () => {
  const response: ModelListResponse = { data: [], nextCursor: null };
  const assertRawCache = captureRawResponse(response);
  api.listModels.mockResolvedValue(response);
  api.listOtherModels.mockRejectedValue(new Error("fixture partial catalog failure"));
  const before = prepareThread("none");
  const surface = renderSurface();
  await waitFor(() => {
    expect(useModelCacheStore.getState().error).toContain("fixture partial catalog failure");
  });
  expect(useModelCacheStore.getState().loaded).toBe(false);
  expect(useModelCacheStore.getState().loading).toBe(false);
  expect(trigger().getAttribute("aria-label")).toBe(`模型：${UNKNOWN}，medium`);
  const menu = await openMenu();
  expect(menu.querySelectorAll(".session-native-power-dot")).toHaveLength(6);
  expect(menu.querySelector(".session-native-power-effort")?.textContent).toBe("中");
  assertNoSettingsWrite(before, surface);
  assertRawCache();
});

it("keeps accepted model choices when a real provider-only refresh fails", async () => {
  const response: ModelListResponse = {
    data: [catalogModel("r18-warm-catalog-model", ["low", "medium"])],
    nextCursor: null,
  };
  const expected = structuredClone(response.data);
  const rawOptions = response.data[0].supportedReasoningEfforts;
  api.listModels.mockResolvedValue(response);
  api.listConfigProviders
    .mockResolvedValueOnce([])
    .mockRejectedValueOnce(new Error("fixture warm provider refresh failure"));
  const before = prepareThread("none");
  const surface = renderSurface();
  await waitForSuccessfulCatalog(response);
  await act(async () => {
    await useModelCacheStore.getState().refreshProviders();
  });
  const cache = useModelCacheStore.getState();
  expect(cache.loaded).toBe(true);
  expect(cache.loading).toBe(false);
  expect(cache.error).toContain("fixture warm provider refresh failure");
  expect(trigger().getAttribute("aria-label")).toBe(`模型：${UNKNOWN}，medium`);
  const menu = await openMenu();
  expect(menu.querySelectorAll(".session-native-power-dot")).toHaveLength(6);
  expect(menu.querySelector(".session-native-power-effort")?.textContent).toBe(
    "中",
  );
  assertNoSettingsWrite(before, surface);
  expect(cache.openAiModels).toBe(response.data);
  expect(cache.openAiModels).toEqual(expected);
  expect(cache.openAiModels[0]).toBe(response.data[0]);
  expect(cache.openAiModels[0].supportedReasoningEfforts).toBe(rawOptions);
  expect(api.listConfigProviders).toHaveBeenCalledTimes(2);
  expect(api.listModels).toHaveBeenCalledTimes(1);
  expect(api.listOtherModels).toHaveBeenCalledTimes(1);
  expect(api.listProviderPresets).toHaveBeenCalledTimes(1);
});

it("displays medium for a successful unknown existing thread with an explicitly null effort without inheriting defaults", async () => {
  const response: ModelListResponse = { data: [], nextCursor: null };
  const assertRawCache = captureRawResponse(response);
  api.listModels.mockResolvedValue(response);
  const prepared = prepareThread("none");
  hydrateThreadModel(A, {
    model: UNKNOWN,
    modelProvider: "openai",
    reasoningEffort: null,
    serviceTier: null,
  });
  const before = {
    ...prepared,
    a: useThreadModelStore.getState().threads[A],
  };
  expect(before.a.reasoningEffort).toBeNull();
  expect(before.defaults.reasoningEffort).toBe("high");
  const surface = renderSurface();
  await waitForSuccessfulCatalog(response);
  expect.soft(trigger().getAttribute("aria-label")).toBe(
    `模型：${UNKNOWN}，medium`,
  );
  expect.soft(
    document.querySelector(".session-native-model-effort")?.textContent,
  ).toBe("中");
  assertNoSettingsWrite(before, surface);
  const menu = await openMenu();
  expect(menu.querySelectorAll(".session-native-power-dot")).toHaveLength(6);
  expect(menu.querySelector(".session-native-power-effort")?.textContent).toBe(
    "中",
  );
  expect(within(menu).getByRole("status").textContent).toContain(
    "第 3 项，共 6 项",
  );
  expect(useThreadModelStore.getState().threads[A].reasoningEffort).toBeNull();
  assertNoSettingsWrite(before, surface);
  assertRawCache();
});
