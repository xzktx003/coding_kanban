import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NativeModelSelector } from "./NativeModelSelector";
import { ModelChangeNotice, ModelUpgradeBanner } from "./ModelChangeNotice";
import {
  hydrateThreadModel,
  useThreadModelStore,
} from "@session/stores/useThreadModelStore";
import { useCodexStore } from "../stores/useCodexStore";
import { useConfigStore } from "../stores/useConfigStore";
import { useLayoutStore } from "@session/stores/useLayoutStore";
import { useNativeModelPickerPreferencesStore } from "@session/stores/settings/useNativeModelPickerPreferencesStore";
const notices = vi.hoisted(() => ({ info: vi.fn() }));
vi.mock("@session/features/native-notifications/service", () => ({
  nativeNotifications: notices,
}));
vi.mock("../hooks/useModels", () => ({
  useModels: () => ({
    loading: false,
    error: null,
    reload: vi.fn(),
    modelStatus: "success",
    hasModelSnapshot: true,
    providerItems: () => [
      { id: "gpt-6-sol", label: "6 Sol" },
      { id: "gpt-5.5", label: "5.5" },
      { id: "gpt-5.6-sol", label: "5.6 Sol" },
      { id: "gpt-5.6-terra", label: "5.6 Terra" },
    ],
    openAiModels: ["gpt-6-sol", "gpt-5.5", "gpt-5.6-sol", "gpt-5.6-terra"].map(
      (model) => ({
        id: model,
        model,
        displayName: model,
        description: "Synthetic catalog",
      upgrade: model === "gpt-5.5" ? "gpt-6-sol" : null,
        isDefault: model === "gpt-6-sol",
        hidden: false,
        supportedReasoningEfforts: ["low", "medium", "high"].map(
          (reasoningEffort) => ({
            reasoningEffort,
            description: reasoningEffort,
          }),
        ),
        defaultReasoningEffort: "medium",
        inputModalities: ["text"],
        supportsPersonality: false,
      }),
    ),
  }),
}));
import { rememberRecentModel, resetRecentModels } from "./recentModelConfigs";
beforeEach(() => {
  resetRecentModels();
  notices.info.mockClear();
  useThreadModelStore.setState({ threads: {} });
  hydrateThreadModel("a", {
    model: "gpt-6-sol",
    modelProvider: "openai",
    reasoningEffort: "medium",
  });
  useConfigStore.setState({ modelProvider: "openai" });
  useLayoutStore.setState({ view: "agent" });
  useNativeModelPickerPreferencesStore.getState().setSelectionMode("model");
  useCodexStore.setState({
    currentThreadId: "a",
    historyLoadedMap: { a: true },
    turnTimingMap: {
      a: {
        turnId: "turn-1",
        status: "completed",
        startedAtMs: 1,
        durationMs: 1,
      },
    },
    events: {
      a: [
        {
          method: "turn/completed",
          params: {
            threadId: "a",
            turn: {
              id: "turn-1",
              items: [],
              itemsView: "full",
              status: "completed",
              error: null,
              startedAt: 1,
              completedAt: 2,
              durationMs: 1000,
            },
          },
        },
      ],
    },
  });
});
afterEach(cleanup);
it("matches original hCa model-radio selection: changes the captured model without a power-commit warning", async () => {
  render(
    <>
      <ModelChangeNotice threadId="a" />
      <NativeModelSelector threadId="a" />
    </>,
  );
  fireEvent.keyDown(screen.getByRole("button", { name: /^模型：/ }), {
    key: "ArrowDown",
  });
  fireEvent.click(await screen.findByRole("menuitem", { name: "选择模型" }));
  fireEvent.click(await screen.findByRole("menuitemradio", { name: /5\.5/ }));
  await waitFor(() =>
    expect(useThreadModelStore.getState().threads.a.model).toBe("gpt-5.5"),
  );
  expect(useThreadModelStore.getState().threads.a.pending).toBe(true);
  expect(notices.info).not.toHaveBeenCalled();
});
it("emits only the explicit power commit after the captured thread's model changes", async () => {
  hydrateThreadModel("a", { model: "gpt-5.6-sol", reasoningEffort: "low" });
  useNativeModelPickerPreferencesStore.getState().setSelectionMode("default");
  render(
    <>
      <ModelChangeNotice threadId="a" />
      <NativeModelSelector threadId="a" />
    </>,
  );
  fireEvent.keyDown(screen.getByRole("button", { name: /^模型：/ }), {
    key: "ArrowDown",
  });
  fireEvent.keyDown(await screen.findByRole("menuitem", { name: "强度" }), {
    key: "ArrowLeft",
  });
  await waitFor(() =>
    expect(useThreadModelStore.getState().threads.a.model).toBe(
      "gpt-5.6-terra",
    ),
  );
  expect(notices.info).toHaveBeenCalledTimes(1);
  expect(notices.info.mock.calls[0][0]).toContain("gpt-5.6-sol");
});
it("emits a captured recent choice even when its effort and speed setters advance the revision", async () => {
  rememberRecentModel({
    model: "gpt-5.5",
    label: "Saved 5.5",
    reasoningEffort: "high",
    serviceTier: null,
  });
  render(
    <>
      <ModelChangeNotice threadId="a" />
      <NativeModelSelector threadId="a" />
    </>,
  );
  fireEvent.keyDown(screen.getByRole("button", { name: /^模型：/ }), {
    key: "ArrowDown",
  });
  fireEvent.click(await screen.findByRole("menuitem", { name: "选择模型" }));
  fireEvent.click(screen.getByRole("button", { name: "打开最近使用的模型" }));
  fireEvent.click(screen.getByRole("button", { name: /Saved 5\.5/ }));
  expect(useThreadModelStore.getState().threads.a).toMatchObject({
    model: "gpt-5.5",
    reasoningEffort: "high",
    pending: true,
  });
  expect(notices.info).toHaveBeenCalledTimes(1);
  expect(notices.info.mock.calls[0][0]).toContain("gpt-6-sol");
});

it("a silent radio selection cannot leave the replacement banner permanently hidden", async () => {
  render(<><ModelUpgradeBanner threadId="a"/><ModelChangeNotice threadId="a"/><NativeModelSelector threadId="a"/></>);
  fireEvent.keyDown(screen.getByRole("button", {name:/^模型：/}), {key:"ArrowDown"});
  fireEvent.click(await screen.findByRole("menuitem", {name:"选择模型"}));
  fireEvent.click(await screen.findByRole("menuitemradio", {name:/5\.5/}));
  expect(useThreadModelStore.getState().threads.a.model).toBe("gpt-5.5");
  expect(notices.info).not.toHaveBeenCalled();
  expect(screen.getByText("认识 GPT-6 Sol")).toBeTruthy();
});
