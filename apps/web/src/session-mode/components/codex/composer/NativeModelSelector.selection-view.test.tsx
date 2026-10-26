import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
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

// Real hook/cache, settings stores, Trigger and Radix; fixture catalog IO only.
vi.mock("@session/services/apiAdapt", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@session/services/apiAdapt")>()),
  ...api,
}));

const A = "r19-a";
const B = "r19-b";
const CURRENT = "r19-current";
const NEXT = "r19-next";
const DRAFT = "R19 保留当前草稿";

function model(id: string, efforts: string[]): Model {
  return {
    id,
    model: id,
    upgrade: null,
    upgradeInfo: null,
    availabilityNux: null,
    displayName: `目录 ${id}`,
    description: "Complete synthetic model/list input",
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
    isDefault: id === CURRENT,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockRejectedValue(new Error("Unexpected R19 transport")),
  );
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
  useThreadModelStore.setState({ threads: {} });
  useConfigStore.setState({
    model: "r19-default",
    modelProvider: "openai",
    providerModels: { openai: "r19-default" },
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

type Case = {
  name: string;
  input: "pointer" | "Enter" | "Space";
  expanded: boolean;
  same?: boolean;
  custom?: boolean;
  startEfforts?: string[];
  efforts: string[];
  view: "simple" | "advanced";
};
const cases: Case[] = [
  {
    name: "pointer current",
    input: "pointer",
    expanded: false,
    same: true,
    efforts: ["medium", "high"],
    view: "simple",
  },
  {
    name: "Enter current expanded",
    input: "Enter",
    expanded: true,
    same: true,
    efforts: ["medium", "high"],
    view: "simple",
  },
  {
    name: "Space current",
    input: "Space",
    expanded: false,
    same: true,
    efforts: ["medium", "high"],
    view: "simple",
  },
  {
    name: "Enter next",
    input: "Enter",
    expanded: false,
    efforts: ["medium", "high"],
    view: "simple",
  },
  {
    name: "Space next expanded",
    input: "Space",
    expanded: true,
    efforts: ["medium", "high"],
    view: "simple",
  },
  {
    name: "Enter empty current to next",
    input: "Enter",
    expanded: false,
    startEfforts: [],
    efforts: ["medium", "high"],
    view: "simple",
  },
  {
    name: "Enter single current to next",
    input: "Enter",
    expanded: true,
    startEfforts: ["medium"],
    efforts: ["medium", "high"],
    view: "simple",
  },
  {
    name: "Enter empty known",
    input: "Enter",
    expanded: false,
    efforts: [],
    view: "advanced",
  },
  {
    name: "Enter single known",
    input: "Enter",
    expanded: true,
    efforts: ["medium"],
    view: "advanced",
  },
  {
    name: "Space raw two filtered one",
    input: "Space",
    expanded: false,
    efforts: ["medium", "persistent"],
    view: "advanced",
  },
  {
    name: "pointer custom current",
    input: "pointer",
    expanded: false,
    same: true,
    custom: true,
    efforts: ["medium"],
    view: "simple",
  },
];

it.each(cases)(
  "$name requests the native row view and focus while preserving settings ownership",
  async (testCase) => {
    const response: ModelListResponse = {
      data: [
        model(CURRENT, testCase.startEfforts ?? ["low", "medium", "high"]),
        model(NEXT, testCase.efforts),
      ],
      nextCursor: null,
    };
    const raw = structuredClone(response);
    api.listModels.mockResolvedValue(response);
    if (testCase.custom) {
      api.listConfigProviders.mockResolvedValue([
        { name: "r19-custom", base_url: "https://unused.invalid" },
      ]);
      api.listOtherModels.mockResolvedValue([
        { provider: "r19-custom", models: [{ id: CURRENT }, { id: NEXT }] },
      ]);
    }
    hydrateThreadModel(A, {
      model: CURRENT,
      modelProvider: testCase.custom ? "r19-custom" : "openai",
      reasoningEffort: "medium",
      serviceTier: null,
    });
    hydrateThreadModel(B, {
      model: "r19-other-owner",
      modelProvider: "openai",
      reasoningEffort: "persistent",
      serviceTier: null,
    });
    const before = useThreadModelStore.getState().threads;
    const defaults = useConfigStore.getState();
    const submit = vi.fn();
    render(
      <div className="session-mode">
        <section
          className={
            testCase.expanded
              ? "session-composer-sheet is-full"
              : "session-codex-composer"
          }
          data-draft-owner={`codex:${A}`}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <div className="session-rich-draft">
              <textarea aria-label="R19 草稿" defaultValue={DRAFT} />
            </div>
            <NativeModelSelector threadId={A} draftOwner={`codex:${A}`} />
          </form>
        </section>
      </div>,
    );
    const editor = screen.getByRole("textbox", { name: "R19 草稿" });
    vi.spyOn(editor, "getClientRects").mockReturnValue({
      length: 1,
    } as DOMRectList);
    await waitFor(() =>
      expect(useModelCacheStore.getState().loaded).toBe(true),
    );
    const cache = useModelCacheStore.getState();
    expect(cache.loading).toBe(false);
    expect(cache.error).toBeNull();
    expect(cache.openAiModels).toBe(response.data);
    fireEvent.keyDown(screen.getByRole("button", { name: /^模型：/ }), {
      key: "ArrowDown",
      code: "ArrowDown",
    });
    const menu = await screen.findByRole("menu");
    vi.spyOn(menu, "getClientRects").mockReturnValue({ length: 1 } as DOMRectList);
    const caption = screen.queryByRole("menuitem", { name: "选择模型" });
    if (caption) {
      fireEvent.pointerDown(caption, {
        button: 0,
        ctrlKey: false,
        pointerType: "mouse",
      });
      fireEvent.click(caption);
    }
    const target = testCase.same ? CURRENT : NEXT;
    const row = await screen.findByRole("menuitemradio", {
      name: testCase.custom ? target : `目录 ${target}`,
    });
    if (caption) await waitFor(() => expect(document.activeElement).toBe(menu));
    if (testCase.input === "pointer") {
      fireEvent.pointerDown(row, {
        button: 0,
        ctrlKey: false,
        pointerType: "mouse",
      });
      fireEvent.click(row);
    } else {
      fireEvent.keyDown(menu, { key: "Home", code: "Home" });
      await waitFor(() =>
        expect(document.activeElement).toBe(
          screen.getAllByRole("menuitemradio")[0],
        ),
      );
      if (!testCase.same)
        fireEvent.keyDown(document.activeElement!, {
          key: "ArrowDown",
          code: "ArrowDown",
        });
      await waitFor(() => expect(document.activeElement).toBe(row));
      fireEvent.keyDown(row, {
        key: testCase.input === "Space" ? " " : "Enter",
        code: testCase.input,
      });
    }
    const expectedFocus =
      testCase.view === "advanced"
        ? row
        : testCase.input === "pointer"
          ? menu
          : menu.querySelector('[role^="menuitem"]:not([data-disabled])');
    expect(screen.getByRole("menu")).toBe(menu);
    const current = useThreadModelStore.getState().threads[A];
    expect(current.model).toBe(target);
    expect(current.reasoningEffort).toBe("medium");
    expect(current.modelProvider).toBe(before[A].modelProvider);
    expect(current.serviceTier).toBeNull();
    expect(current.sandbox).toBe(before[A].sandbox);
    expect(current.approvalPolicy).toBe(before[A].approvalPolicy);
    expect(current.approvalsReviewer).toBe(before[A].approvalsReviewer);
    expect(useThreadModelStore.getState().threads[B]).toBe(before[B]);
    expect(useConfigStore.getState()).toBe(defaults);
    if (testCase.same) expect(current).toBe(before[A]);
    expect((editor as HTMLTextAreaElement).value).toBe(DRAFT);
    expect(submit).not.toHaveBeenCalled();
    expect(useModelCacheStore.getState()).toBe(cache);
    expect(response).toEqual(raw);
    for (const read of Object.values(api))
      expect(read).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(
        menu
          .querySelector("[data-model-picker-view]")
          ?.getAttribute("data-model-picker-view"),
      ).toBe(testCase.view);
      if (expectedFocus) expect(document.activeElement).toBe(expectedFocus);
    });
    if (testCase.view === "simple") {
      expect(menu.querySelectorAll(".session-native-power-dot")).toHaveLength(
        testCase.custom ? 5 : testCase.same ? 3 : 2,
      );
    } else {
      expect(screen.queryByRole("menuitem", { name: "强度" })).toBeNull();
    }
  },
);

async function enterCurrentLowCardinalityRow(efforts: string[]) {
  const response: ModelListResponse = {
    data: [model(CURRENT, efforts), model(NEXT, ["medium", "high"])],
    nextCursor: null,
  };
  api.listModels.mockResolvedValue(response);
  hydrateThreadModel(A, {
    model: CURRENT, modelProvider: "openai", reasoningEffort: "medium", serviceTier: null,
  });
  hydrateThreadModel(B, {
    model: "r19-other-owner", modelProvider: "openai", reasoningEffort: "high", serviceTier: null,
  });
  const threads = useThreadModelStore.getState().threads;
  const defaults = useConfigStore.getState();
  render(
    <div className="session-mode">
      <section className="session-codex-composer" data-draft-owner={`codex:${A}`}>
        <div className="session-rich-draft">
          <textarea aria-label="R19 延迟草稿" defaultValue={DRAFT} />
        </div>
        <NativeModelSelector threadId={A} draftOwner={`codex:${A}`} />
      </section>
    </div>,
  );
  const editor = screen.getByRole("textbox", { name: "R19 延迟草稿" });
  vi.spyOn(editor, "getClientRects").mockReturnValue({ length: 1 } as DOMRectList);
  await waitFor(() => expect(useModelCacheStore.getState().loaded).toBe(true));
  fireEvent.keyDown(screen.getByRole("button", { name: /^模型：/ }), { key: "ArrowDown", code: "ArrowDown" });
  const menu = await screen.findByRole("menu");
  vi.spyOn(menu, "getClientRects").mockReturnValue({ length: 1 } as DOMRectList);
  const row = screen.getByRole("menuitemradio", { name: `目录 ${CURRENT}` });
  fireEvent.keyDown(menu, { key: "Home", code: "Home" });
  await waitFor(() => expect(document.activeElement).toBe(row));
  fireEvent.keyDown(row, { key: "Enter", code: "Enter" });
  return { response, threads, defaults, editor, menu, row };
}

it.each([[], ["medium"], ["medium", "persistent"]])(
  "retains low-cardinality current-row focus after 40ms for raw %j",
  async (...efforts) => {
    const state = await enterCurrentLowCardinalityRow(efforts);
    const cache = useModelCacheStore.getState();
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(state.menu.querySelector("[data-model-picker-view]")?.getAttribute("data-model-picker-view")).toBe("advanced");
    expect(document.activeElement).toBe(state.row);
    expect(useThreadModelStore.getState().threads).toBe(state.threads);
    expect(useConfigStore.getState()).toBe(state.defaults);
    expect((state.editor as HTMLTextAreaElement).value).toBe(DRAFT);
    expect(useModelCacheStore.getState()).toBe(cache);
    expect(cache.openAiModels).toBe(state.response.data);
    for (const read of Object.values(api)) expect(read).toHaveBeenCalledTimes(1);
  },
);

it("clears earlier row keyboard focus intent before a pointer search action and diagnostic catalog reload", async () => {
  const state = await enterCurrentLowCardinalityRow(["medium"]);
  await new Promise((resolve) => setTimeout(resolve, 40));
  expect(document.activeElement).toBe(state.row);
  api.listConfigProviders.mockRejectedValueOnce(new Error("R19 warm provider retry"));
  await act(async () => {
    await useModelCacheStore.getState().refreshProviders();
  });
  expect(useModelCacheStore.getState().loaded).toBe(true);
  expect(useModelCacheStore.getState().error).toContain("R19 warm provider retry");
  const response: ModelListResponse = {
    data: [model(CURRENT, ["medium", "high"]), model(NEXT, ["medium", "high"])],
    nextCursor: null,
  };
  api.listModels.mockResolvedValueOnce(response);
  const search = screen.getByRole("button", { name: "搜索模型" });
  fireEvent.pointerDown(search, { button: 0, ctrlKey: false, pointerType: "mouse" });
  fireEvent.click(search);
  // The native OpenAI menu has no inline Retry. Exercise the same existing
  // read-only reload through the fixture after the real pointer intent change.
  await act(async () => {
    useModelCacheStore.setState({ loaded: false });
    await useModelCacheStore.getState().load();
  });
  await waitFor(() => expect(useModelCacheStore.getState().openAiModels).toBe(response.data));
  expect(useModelCacheStore.getState().error).toBeNull();
  expect(state.menu.querySelector("[data-model-picker-view]")?.getAttribute("data-model-picker-view")).toBe("simple");
  await new Promise((resolve) => setTimeout(resolve, 40));
  expect(useThreadModelStore.getState().threads).toBe(state.threads);
  expect(useConfigStore.getState()).toBe(state.defaults);
  expect((state.editor as HTMLTextAreaElement).value).toBe(DRAFT);
  expect(api.listModels).toHaveBeenCalledTimes(2);
  expect(api.listOtherModels).toHaveBeenCalledTimes(2);
  expect(api.listProviderPresets).toHaveBeenCalledTimes(2);
  expect(api.listConfigProviders).toHaveBeenCalledTimes(3);
  expect(document.activeElement).toBe(state.menu);
});
