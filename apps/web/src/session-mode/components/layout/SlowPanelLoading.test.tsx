import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DeferredRightPanel } from "./DeferredLayoutPanels";

vi.mock("./RightPanel", () => new Promise(() => {}));

afterEach(() => vi.useRealTimers());

it("explains a stalled tool panel and lets the user close it without refreshing", () => {
  vi.useFakeTimers();
  const close = vi.fn();
  render(<DeferredRightPanel visible onClose={close} />);
  expect(screen.getByRole("status").textContent).toContain("正在加载工具面板");
  expect(screen.queryByRole("button", { name: "关闭工具面板" })).toBeNull();
  act(() => vi.advanceTimersByTime(10_000));
  expect(screen.getByRole("status").textContent).toContain("加载时间较长");
  fireEvent.click(screen.getByRole("button", { name: "关闭工具面板" }));
  expect(close).toHaveBeenCalledOnce();
});

it("clears the slow-loading timer when the panel finishes or closes", () => {
  vi.useFakeTimers();
  const view = render(<DeferredRightPanel visible onClose={vi.fn()} />);
  expect(vi.getTimerCount()).toBe(1);
  view.unmount();
  expect(vi.getTimerCount()).toBe(0);
});
