import { render, screen } from "@testing-library/react";
import { it, expect, vi } from "vitest";
import { NativeModelTrigger } from "./NativeModelTrigger";
const state = vi.hoisted(() => ({ threadId: "one" }));
vi.mock("../hooks/useModels", () => ({
  useModels: () => ({ providerItems: () => [] }),
}));
vi.mock("@session/components/codex/stores", () => ({
  useCodexStore: (selector: (state: unknown) => unknown) =>
    selector({ currentThreadId: state.threadId }),
}));
vi.mock("@session/hooks/useThreadModelSettings", () => ({
  useThreadModelSettings: (id: string) =>
    id === "one"
      ? { model: "gpt-6.1-sol", reasoningEffort: "xhigh" }
      : { model: "gpt-6-astra", reasoningEffort: "medium" },
}));
it("shows the full model identity and current thread effort when switching owners", () => {
  const { rerender } = render(<NativeModelTrigger />);
  expect(
    screen.getByRole("button", {
      name: "Agent 与模型：Codex，gpt-6.1-sol，xhigh",
    }),
  ).toBeDefined();
  state.threadId = "two";
  rerender(<NativeModelTrigger />);
  expect(
    screen.getByRole("button", {
      name: "Agent 与模型：Codex，gpt-6-astra，medium",
    }),
  ).toBeDefined();
});
