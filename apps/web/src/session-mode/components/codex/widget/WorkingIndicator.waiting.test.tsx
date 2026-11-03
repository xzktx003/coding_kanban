import { act, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { WorkingIndicator } from "./WorkingIndicator";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        working: "进行中",
        worked: "用时",
        waitingForOutput: "暂未显示本轮过程或回复",
      })[key],
  }),
}));

afterEach(() => vi.useRealTimers());

it("explains silence in a recovered running turn even without a work row", () => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  const timing = {
    turnId: "turn",
    startedAtMs: Date.now(),
    durationMs: null,
    status: "inProgress" as const,
  };
  const { rerender } = render(<WorkingIndicator turnTiming={timing} />);
  expect(screen.queryByText("暂未显示本轮过程或回复")).toBeNull();
  act(() => vi.advanceTimersByTime(30_000));
  expect(screen.getByText("暂未显示本轮过程或回复")).toBeTruthy();
  rerender(<WorkingIndicator turnTiming={timing} hasLiveMessage />);
  expect(screen.queryByText("暂未显示本轮过程或回复")).toBeNull();
  rerender(<WorkingIndicator turnTiming={timing} retryNotice="retry" />);
  expect(screen.queryByText("暂未显示本轮过程或回复")).toBeNull();
  expect(screen.getByText(/retry/)).toBeTruthy();
  for (const startedAtMs of [-1, Number.NaN]) {
    rerender(
      <WorkingIndicator turnTiming={{ ...timing, startedAtMs }} />,
    );
    expect(screen.queryByText("暂未显示本轮过程或回复")).toBeNull();
  }
  rerender(
    <WorkingIndicator
      turnTiming={{ ...timing, status: "completed", durationMs: 30_000 }}
    />,
  );
  expect(screen.queryByText("暂未显示本轮过程或回复")).toBeNull();
});
