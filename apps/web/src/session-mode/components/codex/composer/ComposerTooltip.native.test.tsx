import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ComposerTooltip } from "./ComposerTooltip";

afterEach(() => vi.useRealTimers());

it("shows the native context hint after 200ms with its keyboard equivalent", async () => {
  vi.useFakeTimers();
  render(
    <ComposerTooltip label="附加文件" shortcut="@">
      <button type="button">附加文件</button>
    </ComposerTooltip>,
  );
  const move = new MouseEvent("pointermove", { bubbles: true });
  Object.defineProperty(move, "pointerType", { value: "mouse" });
  fireEvent(screen.getByRole("button", { name: "附加文件" }), move);
  await act(async () => vi.advanceTimersByTimeAsync(199));
  expect(screen.queryByRole("tooltip", { hidden: true })).toBeNull();
  await act(async () => vi.advanceTimersByTimeAsync(2));
  const hint = screen.getByRole("tooltip", { hidden: true });
  expect(hint.textContent).toContain("附加文件");
  expect(hint.querySelector("kbd")?.textContent).toBe("@");
});

it("removes the hint while its attached popup is open", () => {
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  const { rerender } = render(
    <ComposerTooltip label="附加文件">
      <button type="button">附加文件</button>
    </ComposerTooltip>,
  );
  fireEvent.focus(screen.getByRole("button", { name: "附加文件" }));
  expect(screen.queryByRole("tooltip", { hidden: true })).not.toBeNull();
  rerender(
    <ComposerTooltip label="附加文件" popupOpen>
      <button type="button">附加文件</button>
    </ComposerTooltip>,
  );
  expect(screen.queryByRole("tooltip", { hidden: true })).toBeNull();
  expect(
    warning.mock.calls.filter(([message]) =>
      String(message).includes("uncontrolled"),
    ),
  ).toEqual([]);
  warning.mockRestore();
});
