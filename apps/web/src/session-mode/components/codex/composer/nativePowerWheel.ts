/** Ordinary native Power wheel; special explicit-selection presets are separate. */
export interface NativePowerWheelAccumulator {
  accumulatedDelta: number;
  lastEventTime: number;
}

export interface NativePowerWheelInput {
  ctrlKey: boolean;
  deltaX: number;
  deltaY: number;
  deltaMode: number;
  timeStamp: number;
  webkitDirectionInvertedFromDevice?: boolean;
}

const WHEEL_THRESHOLD = 30;
const WHEEL_RESET_GAP = 160;

export function nextOrdinaryPowerWheel(
  state: NativePowerWheelAccumulator,
  event: NativePowerWheelInput,
  current: { index: number; count: number; disabled: boolean },
): { consume: boolean; nextIndex: number | null } {
  if (event.ctrlKey || current.disabled || current.count <= 1)
    return { consume: false, nextIndex: null };

  let delta =
    Math.abs(event.deltaX) > Math.abs(event.deltaY)
      ? event.deltaX
      : -event.deltaY;
  if (
    "webkitDirectionInvertedFromDevice" in event &&
    event.webkitDirectionInvertedFromDevice === true
  )
    delta *= -1;
  // DOM_DELTA_PIXEL is 0; line/page inputs contribute one signed threshold.
  const normalized =
    event.deltaMode === 0 ? delta : Math.sign(delta) * WHEEL_THRESHOLD;
  if (normalized === 0) return { consume: true, nextIndex: null };

  if (
    event.timeStamp - state.lastEventTime > WHEEL_RESET_GAP ||
    Math.sign(normalized) !== Math.sign(state.accumulatedDelta)
  )
    state.accumulatedDelta = 0;
  state.lastEventTime = event.timeStamp;
  state.accumulatedDelta += normalized;
  if (Math.abs(state.accumulatedDelta) < WHEEL_THRESHOLD)
    return { consume: true, nextIndex: null };

  const direction = Math.sign(state.accumulatedDelta);
  state.accumulatedDelta -= direction * WHEEL_THRESHOLD;
  const nextIndex = Math.max(
    0,
    Math.min(current.index + direction, current.count - 1),
  );
  if (nextIndex === current.index) {
    state.accumulatedDelta = 0;
    return { consume: true, nextIndex: null };
  }
  return { consume: true, nextIndex };
}
