import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Model, ModelListResponse } from "@session/bindings/v2";
import { useLayoutStore } from "@session/stores/useLayoutStore";
import { useModelSettingsStore } from "@session/stores/settings";
import { useModelCacheStore } from "../hooks/useModels";
import { NativeModelSelector } from "./NativeModelSelector";
import { resetRecentModels } from "./recentModelConfigs";

const api = vi.hoisted(() => ({
  listModels: vi.fn(),
  listOtherModels: vi.fn(),
  listConfigProviders: vi.fn(),
  listProviderPresets: vi.fn(),
}));
const settings = vi.hoisted(() => ({
  model: "cardinality-review-target",
  provider: "openai",
  effort: "medium",
  setModel: vi.fn(),
  setEffort: vi.fn(),
  setTier: vi.fn(),
}));

// Keep the actual useModels hook, its asynchronous load and shared cache. Only
// its four external reads are fixtures; there is no browser/native transport.
vi.mock("@session/services/apiAdapt/codex", () => api);
vi.mock("@session/components/codex/stores", () => ({
  useCodexStore: Object.assign(
    (select: (state: { currentThreadId: string }) => unknown) =>
      select({ currentThreadId: "cardinality-thread" }),
    { getState: () => ({ currentThreadId: "cardinality-thread" }) },
  ),
}));
vi.mock("@session/hooks/useThreadModelSettings", () => ({
  useThreadModelSettings: () => ({
    model: settings.model,
    modelProvider: settings.provider,
    reasoningEffort: settings.effort,
    serviceTier: null,
    setModel: settings.setModel,
    setReasoningEffort: settings.setEffort,
    setModelSelection: ({ model, reasoningEffort, serviceTier }: { model: string; reasoningEffort: string; serviceTier?: string | null }) => {
      if (model !== settings.model) settings.setModel(model);
      if (reasoningEffort !== settings.effort) settings.setEffort(reasoningEffort);
      if (serviceTier !== undefined && serviceTier !== null) settings.setTier(serviceTier);
    },
    setServiceTier: settings.setTier,
  }),
}));

function catalogModel(efforts: string[]): Model {
  return {
    id: "cardinality-review-target",
    model: "cardinality-review-target",
    upgrade: null,
    upgradeInfo: null,
    availabilityNux: null,
    displayName: "目录模型",
    description: "Synthetic model/list protocol fixture",
    hidden: false,
    supportedReasoningEfforts: efforts.map((reasoningEffort) => ({
      reasoningEffort,
      description: `${reasoningEffort} effort`,
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

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockRejectedValue(new Error("Unexpected cardinality-test network")),
  );
  settings.model = "cardinality-review-target";
  settings.provider = "openai";
  settings.effort = "medium";
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
  });
  useModelSettingsStore.setState({ models: {} });
  useLayoutStore.setState({ view: "agent" });
  resetRecentModels();
});

afterEach(() => {
  try {
    expect(globalThis.fetch).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});

async function receiveModels(models: Model[]) {
  const response: ModelListResponse = { data: models, nextCursor: null };
  api.listModels.mockResolvedValue(response);
  render(
    <div className="session-mode">
      <section
        className="session-codex-composer"
        data-draft-owner="codex:cardinality-thread"
      >
        <div className="session-rich-draft">
          <textarea aria-label="基数夹具草稿" />
        </div>
        <NativeModelSelector
          threadId="cardinality-thread"
          draftOwner="codex:cardinality-thread"
        />
      </section>
    </div>,
  );
  const editor = screen.getByRole("textbox", { name: "基数夹具草稿" });
  vi.spyOn(editor, "getClientRects").mockReturnValue({ length: 1 } as DOMRectList);
  await waitFor(() => expect(useModelCacheStore.getState().loaded).toBe(true));
  expect(useModelCacheStore.getState().error).toBeNull();
  expect(api.listModels).toHaveBeenCalledTimes(1);
  expect(api.listConfigProviders).toHaveBeenCalledTimes(1);
  expect(api.listOtherModels).toHaveBeenCalledTimes(1);
  expect(api.listProviderPresets).toHaveBeenCalledTimes(1);
  expect(useModelCacheStore.getState().openAiModels).toBe(response.data);
}

async function openMenu() {
  fireEvent.keyDown(screen.getByRole("button", { name: /^模型：/ }), {
    key: "ArrowDown",
  });
  const menu = await screen.findByRole("menu");
  vi.spyOn(menu, "getClientRects").mockReturnValue({ length: 1 } as DOMRectList);
  return menu;
}

const knownLimited = [
  { count: 0, efforts: [] },
  { count: 1, efforts: ["medium"] },
];

it.each(knownLimited)(
  "receives a complete known $count-effort Model unchanged through the actual API cache",
  async ({ efforts }) => {
    const model = catalogModel(efforts);
    await receiveModels([model]);
    const received = useModelCacheStore.getState().openAiModels[0];
    expect(received).toBe(model);
    expect(received.supportedReasoningEfforts).toBe(
      model.supportedReasoningEfforts,
    );
    expect(
      received.supportedReasoningEfforts.map(
        (option) => option.reasoningEffort,
      ),
    ).toEqual(efforts);
    expect(settings.setModel).not.toHaveBeenCalled();
    expect(settings.setEffort).not.toHaveBeenCalled();
    expect(settings.setTier).not.toHaveBeenCalled();
  },
);

it.each(knownLimited)(
  "naturally opens advanced for a known $count-effort Model without offering unsupported intensity choices",
  async ({ efforts }) => {
    await receiveModels([catalogModel(efforts)]);
    const menu = await openMenu();
    expect
      .soft(
        menu
          .querySelector("[data-model-picker-view]")
          ?.getAttribute("data-model-picker-view"),
      )
      .toBe("advanced");
    expect
      .soft(screen.queryByRole("menuitemradio", { name: "目录模型" }))
      .not.toBeNull();
    expect.soft(menu.querySelector("[data-reasoning-slider]")).toBeNull();
    expect.soft(screen.queryByRole("menuitem", { name: "强度" })).toBeNull();
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(settings.setModel).not.toHaveBeenCalled();
    expect(settings.setEffort).not.toHaveBeenCalled();
    expect(settings.setTier).not.toHaveBeenCalled();
  },
);

it("keeps the known two-effort model simple and changes only within advertised choices", async () => {
  await receiveModels([catalogModel(["low", "medium"])]);
  const menu = await openMenu();
  expect(
    menu
      .querySelector("[data-model-picker-view]")
      ?.getAttribute("data-model-picker-view"),
  ).toBe("simple");
  expect(menu.querySelectorAll(".session-native-power-dot")).toHaveLength(2);
  const intensity = screen.getByRole("menuitem", { name: "强度" });
  fireEvent.keyDown(intensity, { key: "ArrowRight" });
  expect(settings.setEffort).not.toHaveBeenCalled();
  fireEvent.keyDown(intensity, { key: "ArrowLeft" });
  expect(settings.setEffort.mock.calls).toEqual([["low"]]);
  expect(settings.setModel).not.toHaveBeenCalled();
});

it("uses the native six-effort fallback for an unknown OpenAI model after a successful empty catalog read", async () => {
  settings.model = "typed-unknown-model";
  await receiveModels([]);
  const menu = await openMenu();
  expect(
    menu
      .querySelector("[data-model-picker-view]")
      ?.getAttribute("data-model-picker-view"),
  ).toBe("simple");
  expect(menu.querySelectorAll(".session-native-power-dot")).toHaveLength(6);
  fireEvent.keyDown(screen.getByRole("menuitem", { name: "强度" }), {
    key: "ArrowRight",
  });
  expect(settings.setEffort.mock.calls).toEqual([["high"]]);
});

it("preserves the custom-provider fallback even when the OpenAI catalog has one same-ID effort", async () => {
  settings.provider = "custom";
  api.listConfigProviders.mockResolvedValue([
    { name: "custom", base_url: "https://unused.invalid" },
  ]);
  api.listOtherModels.mockResolvedValue([
    { provider: "custom", models: [{ id: "cardinality-review-target" }] },
  ]);
  await receiveModels([catalogModel(["medium"])]);
  const menu = await openMenu();
  expect(
    menu
      .querySelector("[data-model-picker-view]")
      ?.getAttribute("data-model-picker-view"),
  ).toBe("simple");
  expect(menu.querySelectorAll(".session-native-power-dot")).toHaveLength(5);
  fireEvent.keyDown(screen.getByRole("menuitem", { name: "强度" }), {
    key: "ArrowRight",
  });
  expect(settings.setEffort.mock.calls).toEqual([["high"]]);
});
