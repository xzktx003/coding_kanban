import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { NativeCodeFence } from "./NativeCodeFence";
vi.mock("./nativeFenceHighlight", () => ({
  nativeFenceHighlight: { highlight: () => null },
}));
afterEach(() => vi.useRealTimers());

it("uses the native copy-code hint after 200ms without a second browser title", async () => {
  vi.useFakeTimers();
  render(<NativeCodeFence code="const a = 1;" language="typescript" />);
  const button = screen.getByRole("button", { name: "复制" });
  expect(button.hasAttribute("title")).toBe(false);
  const move = new MouseEvent("pointermove", { bubbles: true });
  Object.defineProperty(move, "pointerType", { value: "mouse" });
  fireEvent(button, move);
  await act(async () => vi.advanceTimersByTimeAsync(199));
  expect(screen.queryByRole("tooltip", { hidden: true })).toBeNull();
  await act(async () => vi.advanceTimersByTimeAsync(2));
  expect(screen.getByRole("tooltip", { hidden: true }).textContent).toBe(
    "复制代码",
  );
});
