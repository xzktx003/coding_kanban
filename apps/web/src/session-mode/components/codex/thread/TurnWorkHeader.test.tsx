import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { TurnWorkHeader, formatTurnWorkTime } from "./TurnWorkHeader";
import type { TurnWork } from "./turnWork";
const visibility = vi.hoisted(() => ({ current: true }));
vi.mock("@session/session-dom", () => ({
  useAgentInteractionVisible: () => visibility.current,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    i18n: { language: "zh-CN" },
    t: (key: string, values?: { time: string }) =>
      ({
        workingFor: `已处理 ${values?.time}`,
        workedFor: `用时 ${values?.time}`,
        workActivity: "工作过程",
      })[key as "workingFor"],
  }),
}));
afterEach(() => {
  vi.useRealTimers();
  visibility.current = true;
});
const work: TurnWork = {
  key: "work",
  threadId: "thread",
  turnId: "turn",
  running: false,
  startedAtMs: null,
  durationMs: 659000,
  processKeys: new Set(["comment"]),
  expanded: false,
};
it("shows minutes and seconds in the native duration form", () => {
  expect(formatTurnWorkTime(659000, "zh-CN")).toBe("10分钟 59秒");
  expect(formatTurnWorkTime(0, "zh-CN")).toBe("0秒");
});
it("updates the live timer and freezes at the authoritative completed duration", () => {
  vi.useFakeTimers();
  vi.setSystemTime(1000000);
  const { rerender, unmount } = render(
    <TurnWorkHeader
      work={{
        ...work,
        running: true,
        startedAtMs: Date.now() - 166000,
        durationMs: null,
      }}
      onToggle={() => {}}
    />,
  );
  expect(screen.getByRole("status").textContent).toBe("已处理 2分钟 46秒");
  act(() => vi.advanceTimersByTime(1000));
  expect(screen.getByRole("status").textContent).toBe("已处理 2分钟 47秒");
  const toggle = vi.fn();
  rerender(<TurnWorkHeader work={work} onToggle={toggle} />);
  act(() => vi.advanceTimersByTime(5000));
  const button = screen.getByRole("button", { name: "用时 10分钟 59秒" });
  expect(button.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(button);
  expect(toggle).toHaveBeenCalledTimes(1);
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});
it("uses an unknown-work label instead of inventing zero time", () => {
  render(
    <TurnWorkHeader work={{ ...work, durationMs: null }} onToggle={() => {}} />,
  );
  expect(screen.getByRole("button").textContent).toBe("工作过程");
});

it("stops hidden timers, resumes from the start time and keeps retry notices visible", () => {
  vi.useFakeTimers();
  vi.setSystemTime(1000000);
  const running = {
    ...work,
    running: true,
    startedAtMs: 1000000,
    durationMs: null,
  };
  const props = {
    work: running,
    onToggle: () => {},
    retryNotice: "Reconnecting 1/5",
  };
  const { rerender, unmount } = render(<TurnWorkHeader {...props} />);
  expect(screen.getByRole("status").textContent).toContain("Reconnecting 1/5");
  visibility.current = false;
  rerender(<TurnWorkHeader {...props} />);
  expect(vi.getTimerCount()).toBe(0);
  act(() => vi.advanceTimersByTime(65000));
  visibility.current = true;
  rerender(<TurnWorkHeader {...props} />);
  expect(screen.getByRole("status").textContent).toContain("已处理 1分钟 5秒");
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});
