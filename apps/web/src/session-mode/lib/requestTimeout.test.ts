import { afterEach, expect, it, vi } from "vitest";
import { requestTimeout } from "./requestTimeout";
afterEach(() => vi.useRealTimers());
it("times out a stalled request with a distinguishable reason", () => {
  vi.useFakeTimers();
  const request = requestTimeout(new AbortController().signal, 5000);
  vi.advanceTimersByTime(4999);
  expect(request.signal.aborted).toBe(false);
  vi.advanceTimersByTime(1);
  expect(request.signal.aborted).toBe(true);
  expect(request.signal.reason.name).toBe("TimeoutError");
  expect(vi.getTimerCount()).toBe(0);
});
it("cancels on owner disposal and releases the deadline", () => {
  vi.useFakeTimers();
  const owner = new AbortController();
  const request = requestTimeout(owner.signal, 5000);
  owner.abort();
  expect(request.signal.aborted).toBe(true);
  expect(request.signal.reason.name).toBe("AbortError");
  expect(vi.getTimerCount()).toBe(0);
});
it("successful completion removes timeout and owner listener", () => {
  vi.useFakeTimers();
  const owner = new AbortController();
  const request = requestTimeout(owner.signal, 5000);
  request.dispose();
  owner.abort();
  vi.advanceTimersByTime(5000);
  expect(request.signal.aborted).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
});
it("an already cancelled owner never starts a deadline", () => {
  vi.useFakeTimers();
  const owner = new AbortController();
  owner.abort();
  const request = requestTimeout(owner.signal, 5000);
  expect(request.signal.aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});
