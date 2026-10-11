import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { NativeMarkdownTooltip } from "./NativeMarkdownTooltip";
afterEach(() => vi.useRealTimers());
async function openHint() {
  const move = new MouseEvent("pointermove", { bubbles: true });
  Object.defineProperty(move, "pointerType", { value: "mouse" });
  fireEvent(screen.getByRole("button", { name: "Open" }), move);
  await act(async () => vi.advanceTimersByTimeAsync(201));
  expect(screen.getByRole("tooltip", { hidden: true }).textContent).toBe("URL");
}
it("dismisses the native hint when the browser window loses focus", async () => {
  vi.useFakeTimers();
  render(
    <NativeMarkdownTooltip label="URL">
      <button>Open</button>
    </NativeMarkdownTooltip>,
  );
  await openHint();
  fireEvent(window, new Event("blur"));
  expect(screen.queryByRole("tooltip", { hidden: true })).toBeNull();
});
it("does not resurrect a hint after the session mode is hidden and shown", async () => {
  vi.useFakeTimers();
  const view = render(
    <div className="session-mode">
      <NativeMarkdownTooltip label="URL">
        <button>Open</button>
      </NativeMarkdownTooltip>
    </div>,
  );
  await openHint();
  const root = view.container.querySelector(".session-mode") as HTMLElement;
  await act(async () => {
    root.hidden = true;
    window.dispatchEvent(new Event("workbench-mode-changed"));
  });
  await act(async () => {
    root.hidden = false;
    window.dispatchEvent(new Event("workbench-mode-changed"));
  });
  expect(screen.queryByRole("tooltip", { hidden: true })).toBeNull();
});
