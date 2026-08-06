interface LatestFrameValueSchedulerOptions<Value> {
  apply: (value: Value) => void;
  cancelFrame: (frameId: number) => void;
  requestFrame: (callback: () => void) => number;
}

export interface LatestFrameValueScheduler<Value> {
  cancel: () => void;
  flush: () => Value | undefined;
  schedule: (value: Value) => void;
}

export function createLatestFrameValueScheduler<Value>(
  options: LatestFrameValueSchedulerOptions<Value>,
): LatestFrameValueScheduler<Value> {
  let frameId: number | null = null;
  let hasPendingValue = false;
  let pendingValue: Value | undefined;

  const applyPendingValue = () => {
    frameId = null;
    if (!hasPendingValue) {
      return undefined;
    }

    const value = pendingValue as Value;
    hasPendingValue = false;
    pendingValue = undefined;
    options.apply(value);
    return value;
  };

  return {
    cancel() {
      if (frameId !== null) {
        options.cancelFrame(frameId);
        frameId = null;
      }
      hasPendingValue = false;
      pendingValue = undefined;
    },
    flush() {
      if (frameId !== null) {
        options.cancelFrame(frameId);
        frameId = null;
      }
      return applyPendingValue();
    },
    schedule(value) {
      pendingValue = value;
      hasPendingValue = true;
      if (frameId !== null) {
        return;
      }

      frameId = options.requestFrame(applyPendingValue);
    },
  };
}

interface CoalescedTrailingSchedulerOptions {
  cancelFrame: (frameId: number) => void;
  clearTimer: (timerId: number) => void;
  requestFrame: (callback: () => void) => number;
  run: () => void;
  scheduleTimer: (callback: () => void, delayMs: number) => number;
  trailingDelayMs?: number;
}

export interface CoalescedTrailingScheduler {
  dispose: () => void;
  schedule: () => void;
  scheduleTrailing: () => void;
}

export function createCoalescedTrailingScheduler(
  options: CoalescedTrailingSchedulerOptions,
): CoalescedTrailingScheduler {
  const trailingDelayMs = options.trailingDelayMs ?? 96;
  let disposed = false;
  let frameId: number | null = null;
  let timerId: number | null = null;

  const scheduleTrailing = () => {
    if (disposed) {
      return;
    }

    if (timerId !== null) {
      options.clearTimer(timerId);
    }
    timerId = options.scheduleTimer(() => {
      timerId = null;
      if (!disposed) {
        options.run();
      }
    }, trailingDelayMs);
  };

  return {
    dispose() {
      disposed = true;
      if (frameId !== null) {
        options.cancelFrame(frameId);
        frameId = null;
      }
      if (timerId !== null) {
        options.clearTimer(timerId);
        timerId = null;
      }
    },
    schedule() {
      if (disposed) {
        return;
      }

      if (frameId === null) {
        frameId = options.requestFrame(() => {
          frameId = null;
          if (!disposed) {
            options.run();
          }
        });
      }
      scheduleTrailing();
    },
    scheduleTrailing,
  };
}
