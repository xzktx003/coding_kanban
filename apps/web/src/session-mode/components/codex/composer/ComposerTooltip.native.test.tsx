import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ComposerTooltip } from "./ComposerTooltip";

afterEach(() => vi.useRealTimers());

it("shows the native context hint after 200ms with its keyboard equivalent", async () => {
  vi.useFakeTimers();
  render(
    <ComposerTooltip label="添加文件等内容" shortcut="@">
      <button type="button">附件</button>
    </ComposerTooltip>,
  );
  const move = new MouseEvent("pointermove", { bubbles: true });
  Object.defineProperty(move, "pointerType", { value: "mouse" });
  fireEvent(screen.getByRole("button", { name: "附件" }), move);
  await act(async () => vi.advanceTimersByTimeAsync(199));
  expect(screen.queryByRole("tooltip", { hidden: true })).toBeNull();
  await act(async () => vi.advanceTimersByTimeAsync(2));
  const hint = screen.getByRole("tooltip", { hidden: true });
  expect(hint.textContent).toContain("添加文件等内容");
  expect(hint.querySelector("kbd")?.textContent).toBe("@");
});

it("removes the hint while its attached popup is open", () => {
  const { rerender } = render(
    <ComposerTooltip label="添加文件等内容">
      <button type="button">附件</button>
    </ComposerTooltip>,
  );
  fireEvent.focus(screen.getByRole("button", { name: "附件" }));
  expect(screen.queryByRole("tooltip", { hidden: true })).not.toBeNull();
  rerender(
    <ComposerTooltip label="添加文件等内容" popupOpen>
      <button type="button">附件</button>
    </ComposerTooltip>,
  );
  expect(screen.queryByRole("tooltip", { hidden: true })).toBeNull();
});
