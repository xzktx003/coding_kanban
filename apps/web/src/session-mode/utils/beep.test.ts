import { afterEach, beforeEach, expect, it, vi } from "vitest";

const contexts: MockAudioContext[] = [];
class MockAudioContext {
  currentTime = 10;
  state = "running";
  destination = {};
  oscillator = {
    type: "",
    frequency: { setValueAtTime: vi.fn() },
    connect: vi.fn(),
    disconnect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    onended: null as (() => void) | null,
  };
  createOscillator = vi.fn(() => this.oscillator);
  close = vi.fn(async () => {
    this.state = "closed";
  });
  resume = vi.fn(async () => {
    this.state = "running";
  });
  constructor() {
    contexts.push(this);
  }
}
beforeEach(() => {
  contexts.length = 0;
  vi.resetModules();
  vi.useFakeTimers();
  vi.stubGlobal("AudioContext", MockAudioContext);
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("releases the oscillator immediately and closes the reused native context after idle", async () => {
  const { playBeep } = await import("./beep");
  playBeep();
  const ctx = contexts[0];
  expect(ctx.oscillator.frequency.setValueAtTime).toHaveBeenCalledWith(440, 10);
  expect(ctx.oscillator.stop).toHaveBeenCalledWith(10.3);
  ctx.oscillator.onended?.();
  await Promise.resolve();
  expect(ctx.oscillator.disconnect).toHaveBeenCalledOnce();
  expect(ctx.close).not.toHaveBeenCalled();
  expect(ctx.oscillator.onended).toBeNull();
  await vi.advanceTimersByTimeAsync(29_999);
  expect(ctx.close).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(ctx.close).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it("bounds overlapping and consecutive completions to a single reused context", async () => {
  const { playBeep } = await import("./beep");
  for (let i = 0; i < 1000; i++) playBeep();
  expect(contexts).toHaveLength(1);
  contexts[0].oscillator.onended?.();
  await Promise.resolve();
  playBeep();
  expect(contexts).toHaveLength(1);
  contexts[0].oscillator.onended?.();
  await vi.advanceTimersByTimeAsync(30_000);
  playBeep();
  expect(contexts).toHaveLength(2);
});

it("closes suspended contexts on wall time even if audio time never advances", async () => {
  class SuspendedContext extends MockAudioContext {
    state = "suspended";
    resume = vi.fn(() => new Promise<void>(() => {}));
  }
  vi.stubGlobal("AudioContext", SuspendedContext);
  const { playBeep } = await import("./beep");
  playBeep();
  await vi.advanceTimersByTimeAsync(1000);
  expect(contexts[0].close).toHaveBeenCalledOnce();
  expect(contexts[0].oscillator.disconnect).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it("stops stalled oscillators on wall time and resets the idle window on reuse", async () => {
  const { playBeep } = await import("./beep");
  playBeep();
  await vi.advanceTimersByTimeAsync(1000);
  const ctx = contexts[0];
  expect(ctx.oscillator.disconnect).toHaveBeenCalledOnce();
  expect(ctx.close).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(20_000);
  playBeep();
  expect(contexts).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(1000);
  expect(ctx.oscillator.disconnect).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(29_999);
  expect(ctx.close).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(ctx.close).toHaveBeenCalledOnce();
});

it("keeps a closing context bounded until native cleanup settles", async () => {
  const { playBeep } = await import("./beep");
  playBeep();
  let finish!: () => void;
  contexts[0].close.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  contexts[0].oscillator.onended?.();
  await vi.advanceTimersByTimeAsync(30_000);
  for (let i = 0; i < 100; i++) playBeep();
  expect(contexts).toHaveLength(1);
  finish();
  await Promise.resolve();
  playBeep();
  expect(contexts).toHaveLength(2);
});

it("does not let unsupported or failing audio interrupt completion handling", async () => {
  const { playBeep } = await import("./beep");
  vi.stubGlobal("AudioContext", undefined);
  expect(playBeep).not.toThrow();
  vi.stubGlobal(
    "AudioContext",
    class {
      constructor() {
        throw new Error("audio unavailable");
      }
    },
  );
  expect(playBeep).not.toThrow();
  vi.stubGlobal(
    "AudioContext",
    class extends MockAudioContext {
      createOscillator = vi.fn(() => {
        throw new Error("node unavailable");
      });
    },
  );
  expect(playBeep).not.toThrow();
  expect(contexts[0].close).toHaveBeenCalledOnce();
});

it("contains close rejection and allows a later notification to try again", async () => {
  const { playBeep } = await import("./beep");
  playBeep();
  contexts[0].close.mockRejectedValue(new Error("already closed"));
  contexts[0].oscillator.onended?.();
  await vi.advanceTimersByTimeAsync(30_000);
  playBeep();
  expect(contexts).toHaveLength(2);
});
