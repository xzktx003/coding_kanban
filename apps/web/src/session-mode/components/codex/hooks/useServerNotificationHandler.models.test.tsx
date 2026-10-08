import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it } from "vitest";
import { useServerNotificationHandler } from "./useServerNotificationHandler";
import {
  changeThreadModel,
  hydrateThreadModel,
  useThreadModelStore,
} from "@session/stores/useThreadModelStore";
import { useCodexStore } from "../stores/useCodexStore";
beforeEach(() => {
  useThreadModelStore.setState({ threads: {} });
  hydrateThreadModel("a", { model: "astra", reasoningEffort: "high" });
  hydrateThreadModel("b", { model: "sol", reasoningEffort: "low" });
  useCodexStore.setState({
    currentThreadId: "a",
    events: {},
    historyLoadedMap: { a: true, b: true },
  });
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
          threadSettings: { model, modelProvider: "openai", effort },
        },
      } as any),
    );
  changeThreadModel("a", { model: "luna", reasoningEffort: "medium" });
  notify("b", "astra", "high");
  expect(useThreadModelStore.getState().threads.b).toMatchObject({
    model: "astra",
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
