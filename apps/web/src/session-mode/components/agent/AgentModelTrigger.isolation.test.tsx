import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { beforeEach, expect, it } from "vitest";
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
it("shows one dismissible per-thread switch notice without sending a message or interrupting a task", () => {
  const { result } = renderHook(() => useThreadModelSettings("a"));
  const { rerender } = render(<ModelChangeNotice threadId="a" />);
  expect(screen.queryByRole("status")).toBeNull();
  act(() => result.current.setModel("gpt-6-luna"));
  expect(screen.getByRole("status").textContent).toContain(
    "gpt-6-astra → gpt-6-luna",
  );
  expect(screen.getByRole("status").textContent).toContain("下次发送生效");
  rerender(<ModelChangeNotice threadId="b" />);
  expect(screen.queryByRole("status")).toBeNull();
  rerender(<ModelChangeNotice threadId="a" />);
  fireEvent.click(screen.getByRole("button", { name: "收起模型切换提示" }));
  expect(screen.queryByRole("status")).toBeNull();
  act(() => result.current.setModel("gpt-6-sol"));
  expect(screen.getByRole("status").textContent).toContain(
    "gpt-6-luna → gpt-6-sol",
  );
  act(() =>
    hydrateThreadModel(
      "a",
      { model: "gpt-6-sol", reasoningEffort: "high" },
      { notify: true },
    ),
  );
  expect(screen.getByRole("status").textContent).toContain(
    "后续发送使用当前模型",
  );
});
