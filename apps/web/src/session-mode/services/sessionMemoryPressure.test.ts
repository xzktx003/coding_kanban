import { afterEach, expect, it, vi } from "vitest";
import {
  hasTranscriptTrafficPressure,
  recordTranscriptTraffic,
  subscribeTranscriptTrafficPressure,
} from "./sessionMemoryPressure";
afterEach(() => vi.useRealTimers());
it("detects heavy incoming output even without a browser heap API and expires after silence", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-10T00:00:00Z"));
  expect(hasTranscriptTrafficPressure()).toBe(false);
  recordTranscriptTraffic(8 * 1024 * 1024);
  expect(hasTranscriptTrafficPressure()).toBe(false);
  recordTranscriptTraffic(8 * 1024 * 1024);
  expect(hasTranscriptTrafficPressure()).toBe(true);
  vi.advanceTimersByTime(5001);
  expect(hasTranscriptTrafficPressure()).toBe(false);
  recordTranscriptTraffic(1024);
  expect(hasTranscriptTrafficPressure()).toBe(false);
});

it("notifies once per pressure episode and stops notifying after unsubscribe", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2031-01-01T00:00:00Z"));
  const listener = vi.fn();
  const unsubscribe = subscribeTranscriptTrafficPressure(listener);
  recordTranscriptTraffic(8 * 1024 * 1024);
  expect(listener).not.toHaveBeenCalled();
  recordTranscriptTraffic(8 * 1024 * 1024);
  recordTranscriptTraffic(1);
  expect(listener).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(5001);
  recordTranscriptTraffic(16 * 1024 * 1024);
  expect(listener).toHaveBeenCalledTimes(2);
  unsubscribe();
  vi.advanceTimersByTime(5001);
  recordTranscriptTraffic(16 * 1024 * 1024);
  expect(listener).toHaveBeenCalledTimes(2);
});
