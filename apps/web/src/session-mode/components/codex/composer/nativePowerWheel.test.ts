import { expect, it } from "vitest";
import { nextOrdinaryPowerWheel, type NativePowerWheelAccumulator, type NativePowerWheelInput } from "./nativePowerWheel";

const fresh = (): NativePowerWheelAccumulator => ({ accumulatedDelta: 0, lastEventTime: 0 });
const input = (overrides: Partial<NativePowerWheelInput> = {}): NativePowerWheelInput => ({
  ctrlKey: false, deltaX: 0, deltaY: -30, deltaMode: 0, timeStamp: 100, ...overrides,
});
const current = { index: 1, count: 4, disabled: false };

it("uses the dominant axis, Y on ties, and the strict native inversion flag", () => {
  expect(nextOrdinaryPowerWheel(fresh(), input({ deltaX: -40, deltaY: -30 }), current).nextIndex).toBe(0);
  expect(nextOrdinaryPowerWheel(fresh(), input({ deltaX: -30, deltaY: -30 }), current).nextIndex).toBe(2);
  expect(nextOrdinaryPowerWheel(fresh(), input({ webkitDirectionInvertedFromDevice: true }), current).nextIndex).toBe(0);
});
it("normalizes nonpixel units to one signed threshold", () => {
  for (const deltaMode of [1, 2]) {
    const state = fresh();
    expect(nextOrdinaryPowerWheel(state, input({ deltaY: -0.01, deltaMode }), current)).toEqual({ consume: true, nextIndex: 2 });
    expect(state.accumulatedDelta).toBe(0);
  }
});
it("preserves residual after one step even for a huge input", () => {
  const state = fresh();
  expect(nextOrdinaryPowerWheel(state, input({ deltaY: -65 }), current).nextIndex).toBe(2);
  expect(state.accumulatedDelta).toBe(35);
  expect(nextOrdinaryPowerWheel(state, input({ deltaY: -1, timeStamp: 110 }), { ...current, index: 2 }).nextIndex).toBe(3);
  expect(state.accumulatedDelta).toBe(6);
});
it("keeps a 160ms gap and resets only beyond it", () => {
  const exact = fresh(), expired = fresh();
  for (const state of [exact, expired])
    expect(nextOrdinaryPowerWheel(state, input({ deltaY: -20 }), current).nextIndex).toBeNull();
  expect(nextOrdinaryPowerWheel(exact, input({ deltaY: -10, timeStamp: 260 }), current).nextIndex).toBe(2);
  expect(nextOrdinaryPowerWheel(expired, input({ deltaY: -10, timeStamp: 261 }), current).nextIndex).toBeNull();
  expect(expired.accumulatedDelta).toBe(10);
});
it("resets on direction reversal and leaves zero input out of the clock", () => {
  const state = fresh();
  nextOrdinaryPowerWheel(state, input({ deltaY: -20 }), current);
  expect(nextOrdinaryPowerWheel(state, input({ deltaY: 0, timeStamp: 200 }), current)).toEqual({ consume: true, nextIndex: null });
  expect(state).toEqual({ accumulatedDelta: 20, lastEventTime: 100 });
  expect(nextOrdinaryPowerWheel(state, input({ deltaY: 10, timeStamp: 210 }), current).nextIndex).toBeNull();
  expect(state).toEqual({ accumulatedDelta: -10, lastEventTime: 210 });
});
it("consumes a boundary without selecting or retaining its residual", () => {
  const state = fresh();
  expect(nextOrdinaryPowerWheel(state, input({ deltaY: -300 }), { ...current, index: 3 })).toEqual({ consume: true, nextIndex: null });
  expect(state).toEqual({ accumulatedDelta: 0, lastEventTime: 100 });
});
it("does not consume or mutate Ctrl, disabled, or 0/1-option inputs", () => {
  for (const [event, at] of [
    [input({ ctrlKey: true }), current],
    [input(), { ...current, disabled: true }],
    [input(), { ...current, count: 0 }],
    [input(), { ...current, count: 1 }],
  ] as const) {
    const state = { accumulatedDelta: 9, lastEventTime: 50 };
    expect(nextOrdinaryPowerWheel(state, event, at)).toEqual({ consume: false, nextIndex: null });
    expect(state).toEqual({ accumulatedDelta: 9, lastEventTime: 50 });
  }
});
