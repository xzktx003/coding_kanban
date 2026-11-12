import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it } from "vitest";
import { useServerNotificationHandler } from "./useServerNotificationHandler";
import {
  changeThreadModel,
  hydrateThreadModel,
  useThreadModelStore,
} from "@session/stores/useThreadModelStore";
import { useCodexStore } from "../stores/useCodexStore";
import { clearModelChangeAnnouncements, getModelChangeAnnouncements } from "@session/features/model-change/modelChangeTranscript";
import { invalidateCodexOperationScope } from "@session/services/codexOperationScope";
beforeEach(() => {
  clearModelChangeAnnouncements();
  useThreadModelStore.setState({ threads: {} });
  hydrateThreadModel("a", { model: "astra", reasoningEffort: "high" });
  hydrateThreadModel("b", { model: "sol", reasoningEffort: "low" });
  useCodexStore.setState({
    currentThreadId: "a",
    events: {},
    historyLoadedMap: { a: true, b: true },
  });
});

it("projects confirmed settings changes into only the matching thread and clears them with the operation scope", () => {
  hydrateThreadModel("a", { model: "astra", modelProvider: "openai" }, { modelChangeBaseline: true });
  hydrateThreadModel("b", { model: "sol", modelProvider: "openai" }, { modelChangeBaseline: true });
  const event = (threadId: string) => ({
    method: "item/started" as const,
    params: { threadId, turnId: `${threadId}-old`, startedAtMs: 1, item: { type: "userMessage" as const, id: `${threadId}-message`, clientId: null, content: [] } },
  });
  useCodexStore.setState({ events: { a: [event("a")], b: [event("b")] } });
  const { result } = renderHook(() => useServerNotificationHandler({
    isCodexThreadActiveRef: { current: true },
    taskCompleteBeepModeRef: { current: "never" },
    preventSleepDuringTasksRef: { current: false },
  }, async () => {}));
  const notify = (threadId: string, model: string, modelProvider: string) => act(() => result.current({
    method: "thread/settings/updated",
    params: { threadId, threadSettings: { model, modelProvider } },
  } as any));
  changeThreadModel("a", { model: "pending" });
  notify("b", "sol", "custom");
  notify("b", "sol", "custom");
  notify("a", "astra", "openai");
  expect(getModelChangeAnnouncements("a")).toEqual([]);
  expect(getModelChangeAnnouncements("b")).toMatchObject([{
    afterTurnId: "b-old",
    from: { model: "sol", provider: "openai" },
    to: { model: "sol", provider: "custom" },
  }]);
  notify("a", "pending", "openai");
  expect(getModelChangeAnnouncements("a")).toMatchObject([{
    afterTurnId: "a-old",
    from: { model: "astra", provider: "openai" },
    to: { model: "pending", provider: "openai" },
  }]);
  act(() => invalidateCodexOperationScope());
  expect(getModelChangeAnnouncements("a")).toEqual([]);
  expect(getModelChangeAnnouncements("b")).toEqual([]);
});
it("routes native settings notifications by thread ID and keeps local next-turn choices until native confirmation", () => {
  const { result } = renderHook(() =>
    useServerNotificationHandler(
      {
        isCodexThreadActiveRef: { current: true },
        taskCompleteBeepModeRef: { current: "never" },
        preventSleepDuringTasksRef: { current: false },
      },
      async () => {},
    ),
  );
  const notify = (id: string, model: string, effort: string) =>
    act(() =>
      result.current({
        method: "thread/settings/updated",
        params: {
          threadId: id,
          threadSettings: { model, modelProvider: "openai", effort, serviceTier:"fast", approvalPolicy:"on-request", approvalsReviewer:"user", sandboxPolicy:{type:"readOnly",networkAccess:false}, collaborationMode:{mode:"default",settings:{model,reasoning_effort:effort,developer_instructions:null}} },
        },
      } as any),
    );
  changeThreadModel("a", { model: "luna", reasoningEffort: "medium" });
  notify("b", "astra", "high");
  expect(useThreadModelStore.getState().threads.b).toMatchObject({
    model: "astra",
    serviceTier: "fast",
    approvalsReviewer: "user",
    sandbox: "read-only",
    collaborationMode: "default",
    notice: { from: "sol", to: "astra" },
  });
  expect(useThreadModelStore.getState().threads.a).toMatchObject({
    model: "luna",
    pending: true,
  });
  notify("a", "astra", "high");
  expect(useThreadModelStore.getState().threads.a).toMatchObject({
    model: "luna",
    pending: true,
  });
  notify("a", "luna", "medium");
  expect(useThreadModelStore.getState().threads.a).toMatchObject({
    model: "luna",
    pending: false,
    notice: { from: "astra", to: "luna" },
  });
  expect(useCodexStore.getState().currentThreadId).toBe("a");
  expect(useCodexStore.getState().events).toEqual({});
});
