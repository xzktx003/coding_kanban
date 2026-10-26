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


// Public prop transitions exercise the real Tooltip bridge; no internal state mock.
function tooltipBridgeSurface(popupOpen: boolean) {
  return (
    <>
      <ComposerTooltip label="选择强度" popupOpen={popupOpen}>
        <button type="button" aria-label="原按钮名称">模型触发器</button>
      </ComposerTooltip>
      <button type="button">外部焦点</button>
    </>
  );
}

function tooltipBridgeContent(trigger: HTMLElement, expectedOpen: boolean) {
  expect(screen.getByRole("button", { name: "原按钮名称" })).toBe(trigger);
  expect(trigger.textContent).toBe("模型触发器");
  expect(trigger.getAttribute("aria-label")).toBe("原按钮名称");
  const contents = document.querySelectorAll(".session-native-composer-tooltip");
  expect(contents).toHaveLength(expectedOpen ? 1 : 0);
  if (expectedOpen) {
    expect(contents[0]?.querySelector(".session-native-composer-tooltip-label")?.textContent).toBe("选择强度");
    expect(trigger.getAttribute("aria-describedby")).toMatch(/\S/);
  } else {
    expect(trigger.getAttribute("aria-describedby")).toBeNull();
  }
}

function tooltipBridgeMouse(target: HTMLElement, type: "pointermove" | "pointerout", relatedTarget?: HTMLElement) {
  const event = new MouseEvent(type, { bubbles: true, relatedTarget: relatedTarget ?? null });
  Object.defineProperty(event, "pointerType", { value: "mouse" });
  fireEvent(target, event);
}

it("does not retain a focus opening request received while its popup suppresses the hint", () => {
  const mount = render(tooltipBridgeSurface(true));
  try {
    const trigger = screen.getByRole("button", { name: "原按钮名称" });
    const outside = screen.getByRole("button", { name: "外部焦点" });
    act(() => outside.focus());
    act(() => trigger.focus());
    expect(document.activeElement).toBe(trigger);
    tooltipBridgeContent(trigger, false);
    act(() => outside.focus());
    expect(document.activeElement).toBe(outside);
    mount.rerender(tooltipBridgeSurface(false));
    tooltipBridgeContent(trigger, false);
    expect(document.activeElement).toBe(outside);
    act(() => trigger.focus());
    expect(document.activeElement).toBe(trigger);
    tooltipBridgeContent(trigger, true);
  } finally {
    mount.unmount();
  }
});

it("drops an already open hint on popup suppression and requires a fresh focus to reopen", () => {
  const mount = render(tooltipBridgeSurface(false));
  try {
    const trigger = screen.getByRole("button", { name: "原按钮名称" });
    const outside = screen.getByRole("button", { name: "外部焦点" });
    act(() => trigger.focus());
    expect(document.activeElement).toBe(trigger);
    tooltipBridgeContent(trigger, true);
    mount.rerender(tooltipBridgeSurface(true));
    tooltipBridgeContent(trigger, false);
    expect(document.activeElement).toBe(trigger);
    act(() => outside.focus());
    expect(document.activeElement).toBe(outside);
    mount.rerender(tooltipBridgeSurface(false));
    tooltipBridgeContent(trigger, false);
    expect(document.activeElement).toBe(outside);
    act(() => trigger.focus());
    expect(document.activeElement).toBe(trigger);
    tooltipBridgeContent(trigger, true);
  } finally {
    mount.unmount();
  }
});

it("does not retain a delayed mouse opening request during suppression and still opens on a new hover", async () => {
  vi.useFakeTimers();
  const mount = render(tooltipBridgeSurface(true));
  try {
    const trigger = screen.getByRole("button", { name: "原按钮名称" });
    const outside = screen.getByRole("button", { name: "外部焦点" });
    act(() => outside.focus());
    tooltipBridgeMouse(trigger, "pointermove");
    await act(async () => vi.advanceTimersByTimeAsync(201));
    tooltipBridgeContent(trigger, false);
    expect(document.activeElement).toBe(outside);
    mount.rerender(tooltipBridgeSurface(false));
    tooltipBridgeContent(trigger, false);
    expect(document.activeElement).toBe(outside);
    tooltipBridgeMouse(trigger, "pointerout", outside);
    tooltipBridgeMouse(trigger, "pointermove");
    // Re-entry can use Radix's skip-delay path; this is not an exact delay claim.
    await act(async () => vi.advanceTimersByTimeAsync(201));
    tooltipBridgeContent(trigger, true);
    expect(document.activeElement).toBe(outside);
  } finally {
    mount.unmount();
  }
});
