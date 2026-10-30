import {
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
import {
  readDraft,
  sessionDraftKey,
  useSessionDraftStore,
  useSessionTextDraft,
} from "@session/stores/useSessionDraftStore";
import { useConfigStore } from "@session/components/codex/stores/useConfigStore";
import { useCodexStore } from "@session/components/codex/stores/useCodexStore";
import { useModelCacheStore } from "@session/components/codex/hooks/useModels";
import { NativeModelSelector } from "@session/components/codex/composer/NativeModelSelector";
import {
  recentModelConfigs,
  resetRecentModels,
} from "@session/components/codex/composer/recentModelConfigs";

const api = vi.hoisted(() => ({
  listModels: vi.fn(),
  listOtherModels: vi.fn(),
  listConfigProviders: vi.fn(),
  listProviderPresets: vi.fn(),
}));

// Preserve the real API module, useModels.load, cache and all setting setters.
// There is no mocked readiness/permission/settings return or native connection.
vi.mock("@session/services/apiAdapt/codex", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@session/services/apiAdapt/codex")>()),
  ...api,
}));

const A = "r23-status-a";
const B = "r23-status-b";
const OWNER_A = sessionDraftKey("codex", A);
const OWNER_B = sessionDraftKey("codex", B);
const KNOWN = "r23-status-known";
const UNKNOWN = "r23-status-unknown-raw";
const CUSTOM = "r23-custom";
const KNOWN_LABEL = "R23 目录模型";
const CUSTOM_LABEL = "R23 自有提供商目录模型";
const DRAFT_A = "R23 主目标原草稿（保留正文和 revision）";
const DRAFT_B = "R23 另一 owner 的原草稿";
const unsubscribers: Array<() => void> = [];

function completeModel(id: string): Model {
  return {
    id,
    model: id,
    upgrade: null,
    upgradeInfo: null,
    availabilityNux: null,
    displayName: KNOWN_LABEL,
    description: "Synthetic complete protocol catalog; no native/remote access",
    hidden: false,
    supportedReasoningEfforts: ["low", "medium", "high", "xhigh"].map(
      (reasoningEffort) => ({ reasoningEffort, description: reasoningEffort }),
    ),
    defaultReasoningEffort: "medium",
    inputModalities: ["text", "image"],
    supportsPersonality: false,
    additionalSpeedTiers: [],
    serviceTiers: [],
    defaultServiceTier: null,
    isDefault: true,
  };
}

function catalog(): ModelListResponse {
  return { data: [completeModel(KNOWN)], nextCursor: null };
}

function assertFourReads() {
  for (const read of Object.values(api)) {
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith();
  }
  expect(globalThis.fetch).not.toHaveBeenCalled();
}

async function acceptedCatalog(response: ModelListResponse) {
  // This readiness is produced by the actual asynchronous useModels.load.
  await waitFor(() => expect(useModelCacheStore.getState().loaded).toBe(true));
  const cache = useModelCacheStore.getState();
  expect(cache.loading).toBe(false);
  expect(cache.error).toBeNull();
  expect(cache.modelStatus).toBe("success");
  expect(cache.modelSnapshot).toBe(response.data);
  expect(cache.openAiModels).toBe(response.data);
  assertFourReads();
}

function assertRawCatalog(response: ModelListResponse, raw: ModelListResponse) {
  expect(response).toEqual(raw);
  const cache = useModelCacheStore.getState();
  expect(cache.openAiModels).toBe(response.data);
  response.data.forEach((model, index) => {
    expect(cache.openAiModels[index]).toBe(model);
    expect(model.supportedReasoningEfforts).toEqual(
      raw.data[index].supportedReasoningEfforts,
    );
  });
}

function DraftEditor() {
  // Actual persisted draft hook, matching Composer's sessionDraftKey owner.
  const { inputValue, setInputValue } = useSessionTextDraft(OWNER_A);
  return (
    <textarea
      aria-label="R23 原草稿"
      value={inputValue}
      onChange={(event) => setInputValue(event.currentTarget.value)}
    />
  );
}

function mountSurface({
  selected = KNOWN,
  effort,
  expanded,
  provider = "openai",
}: {
  selected?: string;
  effort: string;
  expanded: boolean;
  provider?: string;
}) {
  hydrateThreadModel(A, {
    model: selected,
    modelProvider: provider,
    reasoningEffort: effort,
    serviceTier: null,
  });
  hydrateThreadModel(B, {
    model: "r23-unrelated-owner-model",
    modelProvider: "openai",
    reasoningEffort: "persistent",
    serviceTier: null,
  });
  useSessionDraftStore.getState().setText(OWNER_A, DRAFT_A);
  useSessionDraftStore.getState().setText(OWNER_B, DRAFT_B);
  const before = {
    a: useThreadModelStore.getState().threads[A],
    b: useThreadModelStore.getState().threads[B],
    defaults: useConfigStore.getState(),
    customModels: useModelSettingsStore.getState(),
    drafts: useSessionDraftStore.getState().drafts,
    draftA: readDraft(OWNER_A),
    draftB: readDraft(OWNER_B),
  };
  let modelChanges = 0;
  unsubscribers.push(
    useThreadModelStore.subscribe((next, previous) => {
      if (next.threads[A] !== previous.threads[A]) modelChanges += 1;
    }),
  );
  const submit = vi.fn();
  const view = render(
    <div className="session-mode">
      <section
        className={expanded ? "session-composer-sheet is-full" : "session-codex-composer"}
        data-draft-owner={OWNER_A}
      >
        <form onSubmit={(event) => { event.preventDefault(); submit(); }}>
          <div className="session-rich-draft"><DraftEditor /></div>
          <NativeModelSelector threadId={A} draftOwner={OWNER_A} />
        </form>
      </section>
    </div>,
  );
  const editor = screen.getByRole("textbox", { name: "R23 原草稿" }) as HTMLTextAreaElement;
  // Geometry only: a connected visible editor for the existing owner guard.
  // No manual focus, view/controller/cache mutation or fake ready state.
  vi.spyOn(editor, "getClientRects").mockReturnValue({ length: 1 } as DOMRectList);
  return { ...view, before, submit, editor, selected, modelChanges: () => modelChanges };
}

type Surface = ReturnType<typeof mountSurface>;

function assertPreserved(surface: Surface, expectedChanges: 0 | 1) {
  const current = useThreadModelStore.getState().threads[A];
  expect(surface.modelChanges()).toBe(expectedChanges);
  expect(current.revision).toBe(surface.before.a.revision + expectedChanges);
  if (expectedChanges === 0) {
    expect(current).toBe(surface.before.a);
    expect(recentModelConfigs()).toEqual([]);
  } else {
    const { reasoningEffort, revision, pending, pendingFields, ...unchanged } = current;
    const { reasoningEffort: oldEffort, revision: oldRevision, pending: oldPending,
      pendingFields: oldPendingFields, ...beforeUnchanged } = surface.before.a;
    expect(unchanged).toEqual(beforeUnchanged);
    expect(reasoningEffort).toBe("high");
    expect(pending).toBe(true);
    expect(pendingFields).toEqual(["reasoningEffort"]);
    expect(oldEffort).toBe("medium");
    expect(oldPending).toBe(false);
    expect(oldPendingFields ?? []).toEqual([]);
    expect(revision).toBe(oldRevision + 1);
    // Display-only relabeling must not leak into raw identity/recent storage.
    expect(recentModelConfigs()).toEqual([{
      model: UNKNOWN,
      label: UNKNOWN,
      reasoningEffort: "high",
      serviceTier: null,
    }]);
  }
  expect(current.model).toBe(surface.before.a.model);
  expect(current.modelProvider).toBe(surface.before.a.modelProvider);
  expect(useThreadModelStore.getState().threads[B]).toBe(surface.before.b);
  expect(useConfigStore.getState()).toBe(surface.before.defaults);
  expect(useModelSettingsStore.getState()).toBe(surface.before.customModels);
  expect(useCodexStore.getState().currentThreadId).toBe(A);
  expect(useLayoutStore.getState().view).toBe("agent");
  expect(surface.editor.closest("[data-draft-owner]")?.getAttribute("data-draft-owner")).toBe(OWNER_A);
  expect(surface.editor.value).toBe(DRAFT_A);
  expect(useSessionDraftStore.getState().drafts).toBe(surface.before.drafts);
  expect(readDraft(OWNER_A)).toBe(surface.before.draftA);
  expect(readDraft(OWNER_B)).toBe(surface.before.draftB);
  expect(readDraft(OWNER_A).revision).toBe(surface.before.draftA.revision);
  expect(readDraft(OWNER_B).revision).toBe(surface.before.draftB.revision);
  expect(surface.submit).not.toHaveBeenCalled();
  assertFourReads();
}

async function simpleMenu() {
  const trigger = screen.getByRole("button", { name: /^模型：/ });
  fireEvent.keyDown(trigger, { key: "ArrowDown", code: "ArrowDown" });
  const menu = await screen.findByRole("menu");
  vi.spyOn(menu, "getClientRects").mockReturnValue({ length: 1 } as DOMRectList);
  expect(menu.querySelector("[data-model-picker-view]")?.getAttribute("data-model-picker-view")).toBe("simple");
  const power = within(menu).getByRole("menuitem", { name: "强度" });
  const status = within(menu).getByRole("status");
  expect(power.getAttribute("aria-keyshortcuts")).toBe("ArrowLeft ArrowRight");
  expect(power.getAttribute("aria-describedby")).toBe(status.id);
  expect(power.hasAttribute("aria-valuetext")).toBe(false);
  expect(status.getAttribute("aria-live")).toBe("polite");
  return { trigger, menu, power, status };
}

function assertP8(
  opened: Awaited<ReturnType<typeof simpleMenu>>,
  surface: Surface,
  effort: string,
  visible: string,
  modelLabel: string,
  count: number,
) {
  if (surface.before.a.modelProvider === "openai") {
    expect(opened.trigger.getAttribute("aria-label")).toBeNull();
    expect(opened.trigger.querySelector(".session-native-model-label")).toBeNull();
    expect(opened.trigger.querySelector(".session-native-model-effort")).toBeNull();
    expect(opened.trigger.querySelector(".session-native-model-trigger-placeholder")?.textContent ?? null).toBe("选择强度");
  } else {
    expect(opened.trigger.getAttribute("aria-label")).toBe(`模型：${surface.selected}，${effort}`);
    expect(opened.trigger.querySelector(".session-native-model-label")?.textContent).toBe(modelLabel);
    expect(opened.trigger.querySelector(".session-native-model-effort")?.textContent).toBe(visible);
  }
  expect(opened.menu.querySelector(".session-native-power-model")?.textContent).toBe(modelLabel);
  expect(opened.menu.querySelector(".session-native-power-effort")?.textContent).toBe(visible);
  expect(opened.menu.querySelectorAll(".session-native-power-dot")).toHaveLength(count);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Unexpected R23 transport")));
  api.listModels.mockResolvedValue(catalog());
  api.listOtherModels.mockResolvedValue([]);
  api.listConfigProviders.mockResolvedValue([]);
  api.listProviderPresets.mockResolvedValue([]);
  useModelCacheStore.setState({ openAiModels: [], otherModels: {}, configProviders: [], presets: [], loaded: false, loading: false, error: null, modelStatus: "pending", modelSnapshot: null });
  useModelSettingsStore.setState({ models: {} });
  useThreadModelStore.setState({ threads: {} });
  useSessionDraftStore.setState({ drafts: {}, migrated: [] });
  useConfigStore.setState({ model: "r23-global-default", modelProvider: "openai", providerModels: { openai: "r23-global-default" }, reasoningEffort: "xhigh", serviceTier: null });
  useCodexStore.setState({ currentThreadId: A });
  useLayoutStore.setState({ view: "agent" });
  resetRecentModels();
});

afterEach(() => {
  try {
    expect(globalThis.fetch).not.toHaveBeenCalled();
  } finally {
    cleanup();
    while (unsubscribers.length) unsubscribers.pop()?.();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});

// Four representative efforts, rather than a provider × owner × effort matrix.
// Only the medium/high status strings should RED; low/xhigh are controls.
it.each([
  { effort: "low", visible: "轻度", announced: "轻度", index: 1, expanded: false },
  { effort: "medium", visible: "中", announced: "标准", index: 2, expanded: false },
  { effort: "high", visible: "高", announced: "深度", index: 3, expanded: true },
  { effort: "xhigh", visible: "极高", announced: "极高", index: 4, expanded: true },
])("ordinary known $effort keeps P8 caption/trigger and announces its native live label", async (testCase) => {
  const response = catalog();
  const raw = structuredClone(response);
  api.listModels.mockResolvedValue(response);
  const surface = mountSurface(testCase);
  await acceptedCatalog(response);
  const opened = await simpleMenu();
  assertP8(opened, surface, testCase.effort, testCase.visible, KNOWN_LABEL, 4);
  assertPreserved(surface, 0);
  assertRawCatalog(response, raw);
  // Intended RED assertion only; never infer actual RED from this comment.
  expect(opened.status.textContent).toBe(`${KNOWN_LABEL} ${testCase.announced}，第 ${testCase.index} 项，共 4 项。使用左右方向键调整强度`);
});

it.each([
  { expanded: false, name: "main" },
  { expanded: true, name: "expanded" },
])("unknown $name announces Custom and updates medium/high without repairing identity or draft", async ({ expanded }) => {
  const response = catalog();
  const raw = structuredClone(response);
  api.listModels.mockResolvedValue(response);
  const surface = mountSurface({ selected: UNKNOWN, effort: "medium", expanded });
  await acceptedCatalog(response);
  const opened = await simpleMenu();
  assertP8(opened, surface, "medium", "中", "自定义", 6);
  const initialStatus = opened.status.textContent;
  assertPreserved(surface, 0);
  fireEvent.keyDown(opened.power, { key: "ArrowRight", code: "ArrowRight" });
  await waitFor(() => expect(useThreadModelStore.getState().threads[A].reasoningEffort).toBe("high"));
  const finalStatus = within(opened.menu).getByRole("status").textContent;
  assertP8(opened, surface, "high", "高", "自定义", 6);
  expect(opened.menu.isConnected).toBe(true);
  assertPreserved(surface, 1);
  assertRawCatalog(response, raw);
  // Both phases are captured before these intended label-only RED assertions.
  expect.soft(initialStatus).toBe("自定义 标准，第 3 项，共 6 项。使用左右方向键调整强度");
  expect.soft(finalStatus).toBe("自定义 深度，第 4 项，共 6 项。使用左右方向键调整强度");
});

it("keeps custom-provider high status/trigger/caption on the existing P8 path", async () => {
  const response = catalog();
  const raw = structuredClone(response);
  api.listModels.mockResolvedValue(response);
  api.listConfigProviders.mockResolvedValue([{ name: CUSTOM, base_url: "https://unused.invalid" }]);
  api.listOtherModels.mockResolvedValue([{ provider: CUSTOM, models: [{ id: KNOWN }] }]);
  useModelSettingsStore.setState({ models: { [CUSTOM]: [{ id: KNOWN, name: CUSTOM_LABEL }] } });
  const surface = mountSurface({ effort: "high", provider: CUSTOM, expanded: false });
  await acceptedCatalog(response);
  const opened = await simpleMenu();
  assertP8(opened, surface, "high", "高", CUSTOM_LABEL, 5);
  assertPreserved(surface, 0);
  assertRawCatalog(response, raw);
  expect(opened.status.textContent).toBe(`${CUSTOM_LABEL} 高，第 4 项，共 5 项。使用左右方向键调整强度`);
});
