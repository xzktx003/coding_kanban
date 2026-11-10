import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Model, ModelListResponse } from "@session/bindings/v2";
import { useModelCacheStore } from "../hooks/useModels";
import { useConfigStore } from "../stores/useConfigStore";
import { useCodexStore } from "../stores/useCodexStore";
import { useAgentSettingsStore } from "@session/stores/useAgentSettingsStore";
import { useAcpStore } from "@session/stores/useAcpStore";
import { useWorkspaceStore } from "@session/stores/useWorkspaceStore";
import { useLayoutStore } from "@session/stores/useLayoutStore";
import { changeThreadModel, hydrateThreadModel, useThreadModelStore } from "@session/stores/useThreadModelStore";
import { sessionDraftKey } from "@session/stores/useSessionDraftStore";
import { useNativeModelPickerPreferencesStore } from "@session/stores/settings/useNativeModelPickerPreferencesStore";
import { ConversationMenu } from "./ConversationMenu";
import { NativeModelSelector } from "./NativeModelSelector";
import { resetRecentModels } from "./recentModelConfigs";

const api = vi.hoisted(() => ({
  listModels: vi.fn(),
  listOtherModels: vi.fn(),
  listConfigProviders: vi.fn(),
  listProviderPresets: vi.fn(),
}));
vi.mock("@session/services/apiAdapt/codex", async (original) => ({
  ...(await original<typeof import("@session/services/apiAdapt/codex")>()),
  ...api,
}));
vi.mock("sonner", () => ({ toast: { message: vi.fn(), error: vi.fn(), success: vi.fn() } }));

const THREAD = "advertised-effort-thread";
const OWNER = sessionDraftKey("codex", THREAD, "/fixture/advertised");
const MODEL = "gpt-6.1-terra";

function catalog(efforts: readonly string[]): Model {
  return {
    id: MODEL,
    model: MODEL,
    displayName: "GPT-6.1 Terra",
    description: "Synthetic advertised-effort catalog",
    hidden: false,
    isDefault: true,
    upgrade: null,
    upgradeInfo: null,
    availabilityNux: null,
    supportedReasoningEfforts: efforts.map((reasoningEffort) => ({
      reasoningEffort,
      description: reasoningEffort,
    })),
    defaultReasoningEffort: "low",
    inputModalities: ["text"],
    supportsPersonality: false,
    additionalSpeedTiers: [],
    serviceTiers: [],
    defaultServiceTier: null,
  } as unknown as Model;
}

function mount(efforts: readonly string[], effort = "xhigh") {
  const response: ModelListResponse = { data: [catalog(efforts)], nextCursor: null };
  api.listModels.mockResolvedValue(response);
  hydrateThreadModel(THREAD, {
    model: MODEL,
    modelProvider: "openai",
    reasoningEffort: effort,
    serviceTier: null,
  });
  changeThreadModel(THREAD, {
    sandbox: "danger-full-access",
    approvalPolicy: "never",
    approvalsReviewer: "user",
    permissionSources: {
      sandbox: "local",
      approvalPolicy: "local",
      approvalsReviewer: "local",
    },
  });
  render(
    <div className="session-mode">
      <section className="session-codex-composer" data-draft-owner={OWNER} data-owner-thread={THREAD}>
        <form onSubmit={(event) => event.preventDefault()}>
          <div className="session-rich-draft">
            <textarea aria-label="保留草稿" defaultValue="保留原草稿" />
          </div>
          <NativeModelSelector threadId={THREAD} draftOwner={OWNER} />
          <ConversationMenu threadId={THREAD} draftOwner={OWNER} title="当前会话" />
        </form>
      </section>
    </div>,
  );
  return response;
}

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Unexpected advertised-effort transport")));
  api.listModels.mockResolvedValue({ data: [], nextCursor: null });
  api.listOtherModels.mockResolvedValue([]);
  api.listConfigProviders.mockResolvedValue([]);
  api.listProviderPresets.mockResolvedValue([]);
  useModelCacheStore.setState(useModelCacheStore.getInitialState(), true);
  useThreadModelStore.setState({ threads: {} });
  useConfigStore.setState({
    model: MODEL,
    modelProvider: "openai",
    reasoningEffort: "xhigh",
    sandbox: "danger-full-access",
    approvalPolicy: "never",
  });
  useCodexStore.setState({ currentThreadId: THREAD, account: null });
  useLayoutStore.setState({ view: "agent" });
  useAgentSettingsStore.setState({ selectedAgent: "codex" });
  useAcpStore.setState({ active: false });
  useWorkspaceStore.setState({ cwd: "/fixture/advertised" });
  useNativeModelPickerPreferencesStore.getState().setSelectionMode("model");
  useNativeModelPickerPreferencesStore.getState().setEnabledReasoningEfforts(
    useNativeModelPickerPreferencesStore.getInitialState().enabledReasoningEfforts,
  );
  resetRecentModels();
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

async function openMenu() {
  const editor = screen.getByRole("textbox", { name: "保留草稿" });
  vi.spyOn(editor, "getClientRects").mockReturnValue({ length: 1 } as DOMRectList);
  await waitFor(() => expect(useModelCacheStore.getState().loaded).toBe(true));
  fireEvent.keyDown(screen.getByRole("button", { name: /^模型：/ }), { key: "ArrowDown", code: "ArrowDown" });
  const menu = await screen.findByRole("menu");
  vi.spyOn(menu, "getClientRects").mockReturnValue({ length: 1 } as DOMRectList);
  return menu;
}

it("shows advertised max and ultra, keeps persistent out, and does not rewrite the saved effort on open", async () => {
  mount(["low", "medium", "high", "xhigh", "max", "ultra", "persistent"]);
  const before = useThreadModelStore.getState().threads[THREAD];
  const menu = await openMenu();
  expect(menu.querySelectorAll(".session-native-power-dot")).toHaveLength(6);
  expect(menu.textContent).not.toContain("持续");
  expect(useThreadModelStore.getState().threads[THREAD]).toBe(before);
  fireEvent.keyDown(screen.getByRole("menuitem", { name: "强度" }), { key: "ArrowRight", code: "ArrowRight" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(useThreadModelStore.getState().threads[THREAD].reasoningEffort).toBe("max");
});

it("shows the selected reasoning range and changes the selected tick colors as the effort changes", async () => {
  mount(["low", "medium", "high", "xhigh", "max", "ultra"], "max");
  const menu = await openMenu();
  const range = menu.querySelector<HTMLElement>(".session-native-power-range");
  expect(range).not.toBeNull();
  expect(parseFloat(range!.style.width)).toBeCloseTo(152.2);
  const dots = [...menu.querySelectorAll(".session-native-power-dot")];
  expect(dots.map((dot) => dot.getAttribute("data-selected"))).toEqual([
    "true", "true", "true", "true", "true", "false",
  ]);
  fireEvent.keyDown(screen.getByRole("menuitem", { name: "强度" }), {
    key: "ArrowLeft", code: "ArrowLeft",
  });
  expect(useThreadModelStore.getState().threads[THREAD].reasoningEffort).toBe("xhigh");
  expect(parseFloat(range!.style.width)).toBeCloseTo(117.4);
  expect(dots[4].getAttribute("data-selected")).toBe("false");
});

it("fills the complete track at the last option and clears it at the first", async () => {
  mount(["low", "medium", "high", "xhigh", "max"], "max");
  const menu = await openMenu();
  const range = menu.querySelector<HTMLElement>(".session-native-power-range")!;
  expect(parseFloat(range.style.width)).toBe(200);
  const slider = screen.getByRole("menuitem", { name: "强度" });
  for (let index = 0; index < 4; index++) {
    fireEvent.keyDown(slider, { key: "ArrowLeft", code: "ArrowLeft" });
  }
  expect(useThreadModelStore.getState().threads[THREAD].reasoningEffort).toBe("low");
  expect(parseFloat(range.style.width)).toBe(0);
  expect([...menu.querySelectorAll(".session-native-power-dot")].map((dot) => dot.getAttribute("data-selected"))).toEqual([
    "true", "false", "false", "false", "false",
  ]);
});

it("does not offer max when the catalog does not advertise it", async () => {
  mount(["low", "medium", "high", "xhigh"]);
  const menu = await openMenu();
  expect(menu.querySelectorAll(".session-native-power-dot")).toHaveLength(4);
  expect(menu.textContent).not.toContain("Max");
  expect(useThreadModelStore.getState().threads[THREAD].reasoningEffort).toBe("xhigh");
});

it("asks before a full-access session slider commits ultra and leaves the saved pair unchanged on cancel", async () => {
  mount(["low", "medium", "high", "xhigh", "max", "ultra"], "max");
  await openMenu();
  fireEvent.keyDown(screen.getByRole("menuitem", { name: "强度" }), { key: "ArrowRight", code: "ArrowRight" });
  const dialog = await screen.findByRole("dialog");
  expect(dialog.textContent).toContain("完整访问权限");
  expect(useThreadModelStore.getState().threads[THREAD].reasoningEffort).toBe("max");
  expect(useThreadModelStore.getState().threads[THREAD].sandbox).toBe("danger-full-access");
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(useThreadModelStore.getState().threads[THREAD].reasoningEffort).toBe("max");
  expect(useThreadModelStore.getState().threads[THREAD].model).toBe(MODEL);
  expect(useThreadModelStore.getState().threads[THREAD].sandbox).toBe("danger-full-access");
});

it("asks before raising reasoning to ultra from the session menu and applies only after confirmation", async () => {
  mount(["xhigh", "max", "ultra"], "max");
  await waitFor(() => expect(useModelCacheStore.getState().loaded).toBe(true));
  fireEvent.keyDown(screen.getByRole("button", { name: "当前会话的更多操作" }), { key: "ArrowDown" });
  fireEvent.click(await screen.findByRole("menuitem", { name: "提高推理强度" }));
  const dialog = await screen.findByRole("dialog");
  expect(useThreadModelStore.getState().threads[THREAD].reasoningEffort).toBe("max");
  fireEvent.click(screen.getByRole("button", { name: "继续使用完整访问权限" }));
  await waitFor(() => expect(useThreadModelStore.getState().threads[THREAD].reasoningEffort).toBe("ultra"));
  expect(dialog).toBeTruthy();
  expect(useThreadModelStore.getState().threads[THREAD].sandbox).toBe("danger-full-access");
  expect(useThreadModelStore.getState().threads[THREAD].model).toBe(MODEL);
});
