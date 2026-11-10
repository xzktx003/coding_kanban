import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useConfigStore } from "@session/components/codex/stores/useConfigStore";
import { NativeModelTrigger } from "./NativeModelTrigger";
import type { Model } from "@session/bindings/v2";

const fixture = vi.hoisted(() => ({
  threadId: null as string | null,
  models: [] as Model[],
  status: "success",
}));
vi.mock("@session/components/codex/stores", () => ({
  useCodexStore: (selector: (state: unknown) => unknown) =>
    selector({ currentThreadId: fixture.threadId }),
}));
vi.mock("../hooks/useModels", () => ({
  useModels: () => ({
    providerItems: () => [],
    openAiModels: fixture.models,
    modelStatus: fixture.status,
  }),
}));

beforeEach(() => {
  fixture.threadId = null;
  fixture.status = "success";
  fixture.models = [
    {
      id: "catalog-id",
      model: "gpt-6.1-terra",
      displayName: "GPT-6.1 Terra",
      isDefault: true,
      defaultReasoningEffort: "low",
      supportedReasoningEfforts: [
        { reasoningEffort: "low", description: "" },
        { reasoningEffort: "medium", description: "" },
      ],
    } as Model,
  ];
  useConfigStore.setState({
    model: "",
    modelProvider: "openai",
    providerModels: {},
    reasoningEffort: "medium",
  });
});

it("waits for a successful catalog and never overwrites an explicit choice", async () => {
  fixture.status = "pending";
  const { rerender } = render(<NativeModelTrigger />);
  expect(useConfigStore.getState().model).toBe("");
  useConfigStore.getState().setModel("chosen-model");
  fixture.status = "success";
  rerender(<NativeModelTrigger />);
  expect(useConfigStore.getState().model).toBe("chosen-model");
});

it("uses the model's supported default when the previous effort is unsupported", async () => {
  useConfigStore.setState({ reasoningEffort: "high" });
  render(<NativeModelTrigger />);
  await waitFor(() =>
    expect(useConfigStore.getState()).toMatchObject({
      model: "gpt-6.1-terra",
      reasoningEffort: "low",
    }),
  );
});
afterEach(cleanup);

it("initializes the visible new-chat model before sending and preserves a supported effort", async () => {
  const storedBefore = localStorage.getItem(
    "kanban.session.codex-config-storage.v3.model",
  );
  render(<NativeModelTrigger />);
  await waitFor(() => expect(screen.getByText("GPT-6.1 Terra")).toBeTruthy());
  expect(useConfigStore.getState()).toMatchObject({
    model: "gpt-6.1-terra",
    reasoningEffort: "medium",
  });
  expect(
    localStorage.getItem("kanban.session.codex-config-storage.v3.model"),
  ).toBe(storedBefore);
});

it("shows the logged-out custom medium label when the home catalog is empty", () => {
  fixture.models = [];
  render(<NativeModelTrigger />);
  expect(screen.getByRole("button", { name: "自定义，中" })).toBeTruthy();
  expect(screen.getByText("自定义")).toBeTruthy();
  expect(screen.getByText("中")).toBeTruthy();
  expect(screen.queryByText("选择模型")).toBeNull();
  expect(useConfigStore.getState().model).toBe("");
});

it("does not borrow the default model for an existing unknown thread", () => {
  fixture.threadId = "unknown-thread";
  render(<NativeModelTrigger />);
  expect(screen.getByText("选择模型")).toBeTruthy();
  expect(useConfigStore.getState().model).toBe("");
});
