import { afterEach, expect, it, vi } from "vitest";
import {
  hasTranscriptTrafficPressure,
  recordTranscriptTraffic,
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
