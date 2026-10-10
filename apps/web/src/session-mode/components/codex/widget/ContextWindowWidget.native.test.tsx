import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { ContextWindowWidget } from "./ContextWindowWidget";

const state = vi.hoisted(() => ({
  currentThreadId: "a",
  tokenUsageMap: {} as Record<string, any>,
}));
vi.mock("@session/components/codex/stores/useCodexStore", () => ({
  useCodexStore: (select: (value: typeof state) => unknown) => select(state),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: "zh" } }),
}));
const usage = (last: number, capacity: number | null) => ({
  total: { totalTokens: 1_000_000, cachedInputTokens: 50_000 },
  last: { totalTokens: last, cachedInputTokens: 1000 },
  modelContextWindow: capacity,
});
beforeEach(() => {
  state.currentThreadId = "a";
  state.tokenUsageMap = {
    a: usage(25_000, 100_000),
    b: usage(75_000, 100_000),
  };
});
it("uses the latest context instead of accumulated tokens and mirrors the native monochrome donut", () => {
  const view = render(<ContextWindowWidget />);
  const progress = view.container.querySelectorAll("circle")[1];
  expect(progress.getAttribute("stroke-dashoffset")).toBe("75");
  expect(progress.getAttribute("stroke")).toBe("currentColor");
  expect(view.container.querySelector("svg")?.getAttribute("viewBox")).toBe(
    "0 0 12 12",
  );
  expect(screen.getByRole("button", { name: "上下文用量：25%" })).toBeDefined();
});
it("switches capacity with its conversation without carrying another thread's usage", () => {
  const { rerender } = render(<ContextWindowWidget />);
  state.currentThreadId = "b";
  rerender(<ContextWindowWidget />);
  expect(screen.getByRole("button", { name: "上下文用量：75%" })).toBeDefined();
  expect(screen.queryByRole("button", { name: "上下文用量：25%" })).toBeNull();
});
for (const [last, capacity] of [
  [1, null],
  [1, 0],
  [-1, 100],
  [NaN, 100],
  [1, Infinity],
]) {
  it(`does not fabricate capacity for invalid last ${last} / limit ${capacity}`, () => {
    state.tokenUsageMap.a = usage(last!, capacity);
    const { container } = render(<ContextWindowWidget />);
    expect(container.childElementCount).toBe(0);
  });
}
it("clamps a full context while preserving the native zero-progress opacity", () => {
  state.tokenUsageMap.a = usage(200_000, 100_000);
  const { container, rerender } = render(<ContextWindowWidget />);
  expect(
    screen.getByRole("button", { name: "上下文用量：100%" }),
  ).toBeDefined();
  expect(
    container.querySelectorAll("circle")[1].getAttribute("stroke-dashoffset"),
  ).toBe("0");
  state.tokenUsageMap.a = usage(0, 100_000);
  rerender(<ContextWindowWidget />);
  expect(container.querySelectorAll("circle")[1].getAttribute("opacity")).toBe(
    "0",
  );
});
