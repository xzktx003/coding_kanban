import assert from "node:assert/strict";
import test from "node:test";

import {
  createCoalescedTrailingScheduler,
  createLatestFrameValueScheduler,
} from "./frame-schedulers";

test("createLatestFrameValueScheduler applies only the latest value once per frame", () => {
  const frames = new Map<number, () => void>();
  const applied: number[] = [];
  let nextFrameId = 1;

  const scheduler = createLatestFrameValueScheduler<number>({
    apply: (value) => applied.push(value),
    cancelFrame: (frameId) => frames.delete(frameId),
    requestFrame: (callback) => {
      const frameId = nextFrameId++;
      frames.set(frameId, callback);
      return frameId;
    },
  });

  scheduler.schedule(420);
  scheduler.schedule(480);
  scheduler.schedule(560);

  assert.equal(frames.size, 1);
  assert.deepEqual(applied, []);

  frames.values().next().value?.();

  assert.deepEqual(applied, [560]);
});

test("createLatestFrameValueScheduler flushes the final value synchronously", () => {
  const cancelledFrameIds: number[] = [];
  const applied: number[] = [];

  const scheduler = createLatestFrameValueScheduler<number>({
    apply: (value) => applied.push(value),
    cancelFrame: (frameId) => cancelledFrameIds.push(frameId),
    requestFrame: () => 17,
  });

  scheduler.schedule(640);
  assert.equal(scheduler.flush(), 640);

  assert.deepEqual(cancelledFrameIds, [17]);
  assert.deepEqual(applied, [640]);
  assert.equal(scheduler.flush(), undefined);
});

test("createCoalescedTrailingScheduler limits burst work to one frame and one trailing run", () => {
  const frames = new Map<number, () => void>();
  const timers = new Map<number, () => void>();
  const cancelledTimerIds: number[] = [];
  let nextFrameId = 1;
  let nextTimerId = 1;
  let runCount = 0;

  const scheduler = createCoalescedTrailingScheduler({
    cancelFrame: (frameId) => frames.delete(frameId),
    clearTimer: (timerId) => {
      cancelledTimerIds.push(timerId);
      timers.delete(timerId);
    },
    requestFrame: (callback) => {
      const frameId = nextFrameId++;
      frames.set(frameId, callback);
      return frameId;
    },
    run: () => {
      runCount += 1;
    },
    scheduleTimer: (callback) => {
      const timerId = nextTimerId++;
      timers.set(timerId, callback);
      return timerId;
    },
  });

  scheduler.schedule();
  scheduler.schedule();
  scheduler.schedule();

  assert.equal(frames.size, 1);
  assert.equal(timers.size, 1);
  assert.deepEqual(cancelledTimerIds, [1, 2]);

  frames.values().next().value?.();
  assert.equal(runCount, 1);

  timers.values().next().value?.();
  assert.equal(runCount, 2);
});

test("createCoalescedTrailingScheduler can defer burst work until resizing settles", () => {
  const frames = new Map<number, () => void>();
  const timers = new Map<number, () => void>();
  let runCount = 0;

  const scheduler = createCoalescedTrailingScheduler({
    cancelFrame: (frameId) => frames.delete(frameId),
    clearTimer: (timerId) => timers.delete(timerId),
    requestFrame: (callback) => {
      frames.set(1, callback);
      return 1;
    },
    run: () => {
      runCount += 1;
    },
    scheduleTimer: (callback) => {
      timers.set(1, callback);
      return 1;
    },
  });

  scheduler.scheduleTrailing();
  scheduler.scheduleTrailing();

  assert.equal(frames.size, 0);
  assert.equal(timers.size, 1);
  assert.equal(runCount, 0);

  timers.values().next().value?.();
  assert.equal(runCount, 1);
});
