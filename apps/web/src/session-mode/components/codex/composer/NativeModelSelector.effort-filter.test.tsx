import { useNativeModelPickerPreferencesStore } from "@session/stores/settings/useNativeModelPickerPreferencesStore";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Model, ModelListResponse } from "@session/bindings/v2";
import { useLayoutStore } from "@session/stores/useLayoutStore";
import { useModelSettingsStore } from "@session/stores/settings";
import { useModelCacheStore } from "../hooks/useModels";
import { NativeModelSelector } from "./NativeModelSelector";
import { nativeReasoningLabel } from "./nativeReasoningLabel";
import { resetRecentModels } from "./recentModelConfigs";

const api = vi.hoisted(() => ({
  listModels: vi.fn(),
  listOtherModels: vi.fn(),
  listConfigProviders: vi.fn(),
  listProviderPresets: vi.fn(),
}));
const settings = vi.hoisted(() => ({
  model: "effort-filter-review-target",
  effort: "medium",
  setModel: vi.fn(),
  setEffort: vi.fn(),
  setTier: vi.fn(),
  submit: vi.fn(),
}));

// Use the real useModels load/cache and Radix menu. Only the four catalog
// boundary reads and thread-setting callbacks are fixtures; no transport runs.
vi.mock("@session/services/apiAdapt", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@session/services/apiAdapt")>()),
  ...api,
}));
vi.mock("@session/hooks/useThreadModelSettings", () => ({
  useThreadModelSettings: () => ({
    model: settings.model,
    modelProvider: "openai",
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

function catalogModel(efforts: readonly string[]): Model {
  return {
    id: settings.model,
    model: settings.model,
    upgrade: null,
    upgradeInfo: null,
    availabilityNux: null,
    displayName: "目录模型",
    description: "Synthetic complete model/list protocol fixture",
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

function surface() {
  return (
    <div className="session-mode">
      <section
        className="session-codex-composer"
        data-draft-owner="codex:new:effort-filter"
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            settings.submit();
          }}
        >
          <div className="session-rich-draft">
            <textarea aria-label="保留草稿" defaultValue="保留原草稿" />
          </div>
          <NativeModelSelector
            threadId={null}
            draftOwner="codex:new:effort-filter"
          />
        </form>
      </section>
    </div>
  );
}

beforeEach(() => {
  // Explicit initial enabled membership preserves the original none/minimal/max
  // counterexamples. The app display policy still excludes ultra.
  useNativeModelPickerPreferencesStore.getState().setEnabledReasoningEfforts([
    "none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra", "persistent",
  ]);
  vi.clearAllMocks();
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockRejectedValue(new Error("Unexpected effort-filter-test network")),
  );
  settings.model = "effort-filter-review-target";
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

async function receiveModel(efforts: readonly string[]) {
  const model = catalogModel(efforts);
  const expectedModel = structuredClone(model);
  const rawOptions = model.supportedReasoningEfforts;
  const response: ModelListResponse = { data: [model], nextCursor: null };
  api.listModels.mockResolvedValue(response);
  const view = render(surface());
  const editor = screen.getByRole("textbox", { name: "保留草稿" });
  vi.spyOn(editor, "getClientRects").mockReturnValue({ length: 1 } as DOMRectList);
  await waitFor(() => expect(useModelCacheStore.getState().loaded).toBe(true));
  function assertRawCache() {
    const cache = useModelCacheStore.getState();
    expect(cache.loaded).toBe(true);
    expect(cache.error).toBeNull();
    expect(cache.openAiModels).toBe(response.data);
    expect(cache.openAiModels[0]).toBe(model);
    expect(cache.openAiModels[0]).toEqual(expectedModel);
    expect(cache.openAiModels[0].supportedReasoningEfforts).toBe(rawOptions);
    expect(
      cache.openAiModels[0].supportedReasoningEfforts.map(
        (option) => option.reasoningEffort,
      ),
    ).toEqual([...efforts]);
    for (const read of Object.values(api))
      expect(read).toHaveBeenCalledTimes(1);
  }
  assertRawCache();
  return { view, assertRawCache };
}

function assertNoOtherWrites() {
  expect(settings.setModel).not.toHaveBeenCalled();
  expect(settings.setTier).not.toHaveBeenCalled();
  expect(settings.submit).not.toHaveBeenCalled();
  expect((screen.getByLabelText("保留草稿") as HTMLTextAreaElement).value).toBe(
    "保留原草稿",
  );
}

async function openMenu() {
  fireEvent.keyDown(screen.getByRole("button", { name: /^模型：/ }), {
    key: "ArrowDown",
    code: "ArrowDown",
  });
  const menu = await screen.findByRole("menu");
  vi.spyOn(menu, "getClientRects").mockReturnValue({ length: 1 } as DOMRectList);
  return menu;
}

it.each([
  { name: "medium plus persistent", efforts: ["medium", "persistent"] },
  { name: "persistent only", efforts: ["persistent"] },
])(
  "naturally opens advanced for $name without exposing persistent as an intensity choice",
  async ({ efforts }) => {
    const { assertRawCache } = await receiveModel(efforts);
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
    for (const key of ["ArrowDown", "ArrowUp", "Home", "End"]) {
      fireEvent.keyDown(menu, { key, code: key });
    }
    expect(settings.setEffort).not.toHaveBeenCalled();
    assertNoOtherWrites();
    assertRawCache();
  },
);

it("offers only low and medium and ArrowRight skips persistent while retaining the raw catalog", async () => {
  settings.effort = "low";
  const { assertRawCache } = await receiveModel([
    "low",
    "persistent",
    "medium",
  ]);
  const menu = await openMenu();
  expect(
    menu
      .querySelector("[data-model-picker-view]")
      ?.getAttribute("data-model-picker-view"),
  ).toBe("simple");
  expect
    .soft(menu.querySelectorAll(".session-native-power-dot"))
    .toHaveLength(2);
  expect(settings.setEffort).not.toHaveBeenCalled();
  fireEvent.keyDown(screen.getByRole("menuitem", { name: "强度" }), {
    key: "ArrowRight",
    code: "ArrowRight",
  });
  expect.soft(settings.setEffort.mock.calls).toEqual([["medium"]]);
  expect.soft(settings.setEffort).not.toHaveBeenCalledWith("persistent");
  assertNoOtherWrites();
  assertRawCache();
});

it("shows seven explicitly enabled ordinary efforts with ultra hidden and ArrowRight moves medium to high", async () => {
  const efforts = [
    "none",
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
    "ultra",
  ];
  const { view, assertRawCache } = await receiveModel(efforts);
  const menu = await openMenu();
  expect(
    menu
      .querySelector("[data-model-picker-view]")
      ?.getAttribute("data-model-picker-view"),
  ).toBe("simple");
  const dots = [
    ...menu.querySelectorAll<HTMLElement>(".session-native-power-dot"),
  ];
  expect(dots).toHaveLength(7);
  dots.forEach((dot, index) => {
    expect(parseFloat(dot.style.left)).toBeCloseTo(13 + (index / 6) * 174);
  });
  for (const [index, effort] of efforts.slice(0, 7).entries()) {
    settings.effort = effort;
    view.rerender(surface());
    expect(
      menu.querySelector(".session-native-power-effort")?.textContent,
    ).toBe(nativeReasoningLabel(effort));
    expect(screen.getByRole("status").textContent).toContain(
      `第 ${index + 1} 项，共 7 项`,
    );
    expect(menu.querySelectorAll(".session-native-power-dot")).toHaveLength(7);
  }
  settings.effort = "ultra";
  view.rerender(surface());
  expect(settings.effort).toBe("ultra");
  expect(document.querySelector(".session-native-model-trigger .session-native-model-effort")).toBeNull();
    expect(document.querySelector(".session-native-model-trigger")?.getAttribute("aria-label")).toBeNull();
    expect(document.querySelector(".session-native-model-trigger-placeholder")?.textContent ?? null).toBe("选择强度");
  expect(menu.querySelector(".session-native-power-effort")?.textContent).toBe("中");
  expect(screen.getByRole("status").textContent).toContain("第 4 项，共 7 项");
  expect(menu.querySelector(".session-native-power-effort")?.getAttribute("data-maximum")).toBe("false");
  assertRawCache();
  expect(settings.setEffort).not.toHaveBeenCalled();
  settings.effort = "medium";
  view.rerender(surface());
  fireEvent.keyDown(screen.getByRole("menuitem", { name: "强度" }), {
    key: "ArrowRight",
    code: "ArrowRight",
  });
  expect(settings.setEffort.mock.calls).toEqual([["high"]]);
  assertNoOtherWrites();
  assertRawCache();
});

it("derives medium for a configured persistent value without repairing settings on open, then ArrowLeft selects low", async () => {
  settings.effort = "persistent";
  const { assertRawCache } = await receiveModel([
    "low",
    "persistent",
    "medium",
  ]);
  expect
    .soft(document.querySelector(".session-native-model-effort")?.textContent)
    .toBe("中");
  const menu = await openMenu();
  expect(
    menu
      .querySelector("[data-model-picker-view]")
      ?.getAttribute("data-model-picker-view"),
  ).toBe("simple");
  expect
    .soft(menu.querySelector(".session-native-power-effort")?.textContent)
    .toBe("中");
  expect.soft(menu.textContent).not.toContain("持续");
  expect
    .soft(menu.querySelectorAll(".session-native-power-dot"))
    .toHaveLength(2);
  expect
    .soft(screen.getByRole("status").textContent)
    .toContain("第 2 项，共 2 项");
  // CSSOM evaluates the fixed 13px inset + 174px travel; 2/2 is the right end.
  expect
    .soft(
      menu.querySelector<HTMLElement>(".session-native-power-thumb")?.style
        .left,
    )
    .toMatch(/^calc\((?:187px|13px \+ 174px)\)$/);
  expect(settings.effort).toBe("persistent");
  expect(settings.setEffort).not.toHaveBeenCalled();
  assertNoOtherWrites();
  assertRawCache();
  fireEvent.keyDown(screen.getByRole("menuitem", { name: "强度" }), {
    key: "ArrowLeft",
    code: "ArrowLeft",
  });
  expect(settings.setEffort.mock.calls).toEqual([["low"]]);
  expect(settings.setEffort).not.toHaveBeenCalledWith("persistent");
  assertNoOtherWrites();
  assertRawCache();
});
