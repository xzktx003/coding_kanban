import { act, render, renderHook, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
const notices = vi.hoisted(() => ({ info: vi.fn() }));
vi.mock("@session/features/native-notifications/service", () => ({
  nativeNotifications: notices,
}));
import { AgentModelTrigger } from "./AgentModelTrigger";
import { ModelChangeNotice } from "../codex/composer/ModelChangeNotice";
import { useCodexStore, useConfigStore } from "../codex/stores";
import { useAcpStore } from "../../stores/useAcpStore";
import { useAgentSettingsStore } from "../../stores/useAgentSettingsStore";
import { useThreadModelSettings } from "../../hooks/useThreadModelSettings";
import {
  hydrateThreadModel,
  useThreadModelStore,
} from "../../stores/useThreadModelStore";

beforeEach(() => {
  notices.info.mockClear();
  useThreadModelStore.setState({ threads: {} });
  useAgentSettingsStore.setState({ selectedAgent: "codex" });
  useAcpStore.setState({ active: false });
  useCodexStore.setState({ currentThreadId: "a" });
  useConfigStore.setState({
    model: "new-chat-default",
    reasoningEffort: "medium",
  });
  hydrateThreadModel("a", { model: "gpt-6-astra", reasoningEffort: "high" });
  hydrateThreadModel("b", { model: "gpt-6-sol", reasoningEffort: "low" });
});
it("switches the visible label between each thread's own settings; selecting A cannot change B or new-chat defaults", () => {
  const { result } = renderHook(({ id }) => useThreadModelSettings(id), {
    initialProps: { id: "a" as string | null },
  });
  render(<AgentModelTrigger compact />);
  expect(
    screen.getByRole("button", { name: /gpt-6-astra，high/ }),
  ).toBeTruthy();
  act(() => {
    result.current.setModel("gpt-6-luna");
    result.current.setReasoningEffort("medium");
  });
  expect(
    screen.getByRole("button", { name: /gpt-6-luna，medium/ }),
  ).toBeTruthy();
  act(() => useCodexStore.setState({ currentThreadId: "b" }));
  expect(screen.getByRole("button", { name: /gpt-6-sol，low/ })).toBeTruthy();
  act(() => useCodexStore.setState({ currentThreadId: "a" }));
  expect(
    screen.getByRole("button", { name: /gpt-6-luna，medium/ }),
  ).toBeTruthy();
  act(() => useCodexStore.setState({ currentThreadId: null }));
  expect(
    screen.getByRole("button", { name: /new-chat-default，medium/ }),
  ).toBeTruthy();
});
it("late callbacks keep the thread identity captured by their model selector", () => {
  const { result, rerender } = renderHook(
    ({ id }) => useThreadModelSettings(id),
    { initialProps: { id: "a" } },
  );
  const oldCallback = result.current.setModel;
  rerender({ id: "b" });
  act(() => oldCallback("gpt-6-luna"));
  expect(result.current.model).toBe("gpt-6-sol");
  expect(useThreadModelStore.getState().threads.a.model).toBe("gpt-6-luna");
});
it("keeps ordinary settings callbacks silent across thread switching and read-only restoration", () => {
  const { result } = renderHook(() => useThreadModelSettings("a"));
  const { rerender } = render(<ModelChangeNotice threadId="a" />);
  act(() => result.current.setModel("gpt-6-luna"));
  rerender(<ModelChangeNotice threadId="b" />);
  rerender(<ModelChangeNotice threadId="a" />);
  act(() => result.current.setModel("gpt-6-sol"));
  expect(useThreadModelStore.getState().threads.b.model).toBe("gpt-6-sol");
  act(() =>
    hydrateThreadModel(
      "a",
      { model: "gpt-6-sol", reasoningEffort: "high" },
      { notify: true },
    ),
  );
  expect(notices.info).not.toHaveBeenCalled();
});
