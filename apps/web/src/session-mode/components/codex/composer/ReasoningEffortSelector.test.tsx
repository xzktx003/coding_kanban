import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { Model } from "@session/bindings/v2";
import { useCodexStore, useConfigStore } from "../stores";
import {
  hydrateThreadModel,
  useThreadModelStore,
} from "@session/stores/useThreadModelStore";
import { nextReasoningEffort } from "./ReasoningEffortSelector";
import { ModelReasonSelector } from "./ModelReasonSelector";

const catalog = vi.hoisted(() => ({ models: [] as Model[] }));
vi.mock("../hooks/useModels", () => ({
  useModels: () => ({
    openAiModels: catalog.models,
    providerItems: () =>
      catalog.models.map((m) => ({ id: m.id, label: m.displayName })),
    allProviders: ["openai", "custom"],
    providerSuggestions: () => [],
    loading: false,
    error: null,
    reload: vi.fn(),
  }),
}));
vi.mock("./EnvKeysDialog", () => ({ EnvKeysDialog: () => null }));

function model(
  id: string,
  supported = ["none", "low", "medium", "high", "xhigh"],
  defaultEffort = "low",
): Model {
  return {
    id,
    model: id,
    displayName: id,
    description: "",
    hidden: false,
    isDefault: true,
    defaultReasoningEffort: defaultEffort,
    supportedReasoningEfforts: supported.map((reasoningEffort) => ({
      reasoningEffort,
      description: "",
    })),
    upgrade: null,
    upgradeInfo: null,
    availabilityNux: null,
    inputModalities: [],
    supportsPersonality: false,
    additionalSpeedTiers: [],
    serviceTiers: [],
    defaultServiceTier: null,
  };
}

beforeEach(() => {
  catalog.models = [model("target")];
  useThreadModelStore.setState({ threads: {} });
  useCodexStore.setState({ currentThreadId: "a" });
  useConfigStore.setState({
    model: "new-chat-model",
    modelProvider: "openai",
    providerModels: { openai: "new-chat-model" },
    reasoningEffort: "medium",
  });
  // cmdk scrolls the active item; jsdom has no scrolling implementation.
  HTMLElement.prototype.scrollIntoView = vi.fn();
});

it.each(["none", "low", "medium", "high", "xhigh"])(
  "preserves supported %s instead of applying the target model's low default",
  (current) => {
    expect(
      nextReasoningEffort("openai", "target", current, catalog.models),
    ).toBeUndefined();
  },
);

it.each([undefined, "xhigh"])(
  "uses the target default when effort %s is absent or unsupported",
  (current) => {
    const models = [model("limited", ["low", "medium"], "medium")];
    expect(nextReasoningEffort("openai", "limited", current, models)).toBe(
      "medium",
    );
  },
);

it("keeps the preference when the model catalog is missing or a typed model is unknown", () => {
  expect(nextReasoningEffort("openai", "target", "high", [])).toBeUndefined();
  expect(
    nextReasoningEffort("openai", "typed-model", "high", catalog.models),
  ).toBeUndefined();
});

it("preserves compatible custom-provider efforts and normalizes unsupported ones", () => {
  expect(nextReasoningEffort("custom", "target", "high", [])).toBeUndefined();
  expect(nextReasoningEffort("custom", "target", "unsupported", [])).toBe(
    "medium",
  );
});

it("model selection retains A's high effort without changing B or new-chat defaults", () => {
  hydrateThreadModel("a", { model: "source", reasoningEffort: "high" });
  hydrateThreadModel("b", { model: "source", reasoningEffort: "low" });
  render(<ModelReasonSelector mode="panel" />);
  fireEvent.click(screen.getByRole("option", { name: "target" }));
  expect(useThreadModelStore.getState().threads.a).toMatchObject({
    model: "target",
    reasoningEffort: "high",
  });
  expect(useThreadModelStore.getState().threads.b).toMatchObject({
    model: "source",
    reasoningEffort: "low",
  });
  expect(useConfigStore.getState()).toMatchObject({
    model: "new-chat-model",
    reasoningEffort: "medium",
  });
});

it("model selection falls back when the target does not support the current effort", () => {
  catalog.models = [model("limited", ["low", "medium"], "medium")];
  hydrateThreadModel("a", { model: "source", reasoningEffort: "xhigh" });
  render(<ModelReasonSelector mode="panel" />);
  fireEvent.click(screen.getByRole("option", { name: "limited" }));
  expect(useThreadModelStore.getState().threads.a).toMatchObject({
    model: "limited",
    reasoningEffort: "medium",
  });
});

it.each([
  { current: "high", supported: ["low", "medium", "high"], expected: "high" },
  { current: "xhigh", supported: ["low", "medium"], expected: "medium" },
])(
  "provider switching reconciles $current with the destination model",
  ({ current, supported, expected }) => {
    catalog.models = [model("target", supported, "medium")];
    hydrateThreadModel("a", {
      modelProvider: "custom",
      model: "source",
      reasoningEffort: current,
    });
    render(<ModelReasonSelector mode="panel" />);
    fireEvent.click(screen.getByRole("button", { name: "custom" }));
    fireEvent.click(screen.getByRole("option", { name: "openai" }));
    expect(useThreadModelStore.getState().threads.a).toMatchObject({
      modelProvider: "openai",
      model: "target",
      reasoningEffort: expected,
    });
  },
);

it("initializing the new-chat model also preserves a supported reasoning preference", () => {
  useConfigStore.setState({
    model: "",
    providerModels: {},
    reasoningEffort: "high",
  });
  render(<ModelReasonSelector mode="panel" threadId={null} />);
  expect(useConfigStore.getState()).toMatchObject({
    model: "target",
    reasoningEffort: "high",
  });
});

it("skips a wire-supported persistent effort in the actual panel without changing another thread, defaults or raw catalog", () => {
  const target = model("target", ["low", "persistent", "medium"], "medium");
  const raw = target.supportedReasoningEfforts;
  catalog.models = [target];
  hydrateThreadModel("a", { model: "target", reasoningEffort: "low" });
  hydrateThreadModel("b", { model: "other", reasoningEffort: "persistent" });
  const beforeB = useThreadModelStore.getState().threads.b;
  const beforeDefaults = useConfigStore.getState();
  render(<ModelReasonSelector mode="panel" threadId="a" />);

  fireEvent.keyDown(screen.getByRole("slider", { name: "推理强度" }), {
    key: "ArrowRight",
  });

  expect.soft(useThreadModelStore.getState().threads.a.reasoningEffort).toBe("medium");
  expect.soft(useThreadModelStore.getState().threads.b).toBe(beforeB);
  expect.soft(useConfigStore.getState()).toBe(beforeDefaults);
  expect.soft(catalog.models[0]).toBe(target);
  expect.soft(target.supportedReasoningEfforts).toBe(raw);
  expect.soft(raw.map((option) => option.reasoningEffort)).toEqual([
    "low",
    "persistent",
    "medium",
  ]);
});

it("displays medium for a configured persistent effort without rewriting it on panel mount", () => {
  const target = model("target", ["low", "persistent", "medium"], "medium");
  const raw = target.supportedReasoningEfforts;
  catalog.models = [target];
  hydrateThreadModel("a", { model: "target", reasoningEffort: "persistent" });
  const before = useThreadModelStore.getState().threads.a;
  const defaults = useConfigStore.getState();
  render(<ModelReasonSelector mode="panel" threadId="a" />);

  const slider = screen.getByRole("slider", { name: "推理强度" });
  expect.soft(slider.getAttribute("aria-valuetext")).toBe("medium");
  expect.soft(slider.getAttribute("aria-valuemax")).toBe("1");
  expect(useThreadModelStore.getState().threads.a).toBe(before);
  expect(useConfigStore.getState()).toBe(defaults);
  expect(target.supportedReasoningEfforts).toBe(raw);
  expect(raw.map((option) => option.reasoningEffort)).toEqual([
    "low",
    "persistent",
    "medium",
  ]);
  fireEvent.keyDown(slider, { key: "ArrowLeft" });
  expect(useThreadModelStore.getState().threads.a.reasoningEffort).toBe("low");
});
