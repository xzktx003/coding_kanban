import { afterEach, expect, it, vi } from "vitest";
import { nativeImageResetDate } from "./nativeImageFailure";

afterEach(() => vi.useRealTimers());

it("matches native hu's local same-day short time and other-day medium date", () => {
  vi.useFakeTimers();
  const now = new Date(2026, 9, 30, 12, 0);
  vi.setSystemTime(now);
  const today = new Date(2026, 9, 30, 16, 45);
  const future = new Date(2027, 0, 1, 8, 30);
  expect(nativeImageResetDate(today.getTime() / 1000, "zh-CN")).toBe(today.toLocaleTimeString("zh-CN", { timeStyle: "short" }));
  expect(nativeImageResetDate(future.getTime() / 1000, "en-US")).toBe(future.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }));
});

it("keeps unknown or invalid reset times absent", () => {
  expect(nativeImageResetDate(null, "zh")).toBeNull();
  expect(nativeImageResetDate(Number.MAX_VALUE, "zh")).toBeNull();
});
