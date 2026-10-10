import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, it, expect, vi } from "vitest";
import { NativeModelSelector } from "./NativeModelSelector";
const calls = vi.hoisted(() => ({
  model: vi.fn(),
  effort: vi.fn(),
  effortValue: "high",
  options: ["low", "medium", "high"],
}));
beforeEach(() => {
  calls.effortValue = "high";
  calls.options = ["low", "medium", "high"];
});
vi.mock("@session/components/codex/stores", () => ({
  useCodexStore: (selector: (s: unknown) => unknown) =>
    selector({ currentThreadId: "original" }),
}));
vi.mock("@session/hooks/useThreadModelSettings", () => ({
  useThreadModelSettings: () => ({
    model: "model-one",
    modelProvider: "openai",
    reasoningEffort: calls.effortValue,
    setModel: calls.model,
    setReasoningEffort: calls.effort,
  }),
}));
vi.mock("../hooks/useModels", () => ({
  useModels: () => ({
    loading: false,
    error: null,
    reload: vi.fn(),
    providerItems: () => [
      { id: "model-one", label: "原生模型一" },
      { id: "model-two", label: "原生模型二" },
    ],
    openAiModels: [
      {
        id: "model-one",
        model: "model-one",
        displayName: "原生模型一",
        defaultReasoningEffort: "medium",
        supportedReasoningEfforts: calls.options.map((reasoningEffort) => ({
          reasoningEffort,
        })),
      },
      {
        id: "model-two",
        model: "model-two",
        displayName: "原生模型二",
        defaultReasoningEffort: "medium",
        supportedReasoningEfforts: [
          { reasoningEffort: "medium" },
          { reasoningEffort: "high" },
        ],
      },
    ],
  }),
}));
it("uses native simple power view and switches to native radio model rows without losing supported effort", async () => {
  render(<NativeModelSelector threadId="original" />);
  fireEvent.keyDown(screen.getByRole("button", { name: /Agent 与模型/ }), {
    key: "ArrowDown",
  });
  expect(await screen.findByRole("slider", { name: "推理强度" })).toBeDefined();
  expect(
    screen.getByRole("menuitem", { name: "选择模型" }).textContent,
  ).toContain("高");
  fireEvent.keyDown(screen.getByRole("slider", { name: "推理强度" }), {
    key: "ArrowLeft",
  });
  expect(calls.effort).toHaveBeenCalledWith("medium");
  fireEvent.click(screen.getByRole("menuitem", { name: "选择模型" }));
  fireEvent.click(
    await screen.findByRole("menuitemradio", { name: "原生模型二" }),
  );
  expect(calls.model).toHaveBeenCalledWith("model-two");
  expect(calls.effort).not.toHaveBeenCalledWith("low");
});

it("matches native pointer view changes by focusing the menu container", async () => {
  render(<NativeModelSelector threadId="original" />);
  fireEvent.pointerDown(screen.getByRole("button", { name: /Agent 与模型/ }), {
    button: 0,
    ctrlKey: false,
    pointerType: "mouse",
  });
  await screen.findByRole("slider", { name: "推理强度" });
  fireEvent.click(screen.getByRole("menuitem", { name: "选择模型" }));
  await screen.findByRole("menuitemradio", { name: "原生模型一" });
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByRole("menu")),
  );
  fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowDown" });
  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole("menuitemradio", { name: "原生模型一" }),
    ),
  );
});

it("uses the actual native 28px thumb minus 1px endpoint inset for ticks and input", async () => {
  render(<NativeModelSelector threadId="original" />);
  fireEvent.keyDown(screen.getByRole("button", { name: /Agent 与模型/ }), {
    key: "ArrowDown",
  });
  const thumb = await screen.findByRole("slider", { name: "推理强度" });
  expect(thumb.style.left).toBe("calc(187px)");
  const dots = document.querySelectorAll<HTMLElement>(
    ".session-native-power-dot",
  );
  expect([...dots].map((dot) => dot.style.left)).toEqual([
    "13px",
    "100px",
    "187px",
  ]);
});

it.each(["high", "xhigh", "ultra"])(
  "uses native explicit-model accent and only supported ultra maximum metadata (%s)",
  async (effort) => {
    calls.options = ["low", "medium", "high", "xhigh", "ultra"];
    calls.effortValue = effort;
    render(<NativeModelSelector threadId="original" />);
    fireEvent.keyDown(screen.getByRole("button", { name: /Agent 与模型/ }), {
      key: "ArrowDown",
    });
    await screen.findByRole("slider", { name: "推理强度" });
    const label = document.querySelector(".session-native-power-effort")!;
    expect(label.getAttribute("data-accent")).toBe("true");
    expect(label.getAttribute("data-maximum")).toBe(String(effort === "ultra"));
  },
);
