import { act, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { NativeCompactionItem } from "./NativeCompactionItem";
it("uses actual startedAtMs for the native ten-second reassurance and clears it on completion", () => {
  vi.useFakeTimers();
  vi.setSystemTime(100000);
  try {
    const { rerender } = render(
      <NativeCompactionItem running startedAtMs={100000} />,
    );
    expect(screen.queryByText(/可能需要几分钟/)).toBeNull();
    act(() => vi.advanceTimersByTime(10000));
    expect(screen.getAllByText(/可能需要几分钟/).length).toBeGreaterThan(0);
    rerender(<NativeCompactionItem startedAtMs={100000} source="manual" />);
    expect(screen.queryByText(/可能需要几分钟/)).toBeNull();
    rerender(<NativeCompactionItem running />);
    act(() => vi.advanceTimersByTime(20000));
    expect(screen.queryByText(/可能需要几分钟/)).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});
