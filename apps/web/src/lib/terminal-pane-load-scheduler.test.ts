import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createTerminalPaneLoadScheduler,
  type TerminalPaneLoadPermit,
} from "./terminal-pane-load-scheduler.js";

async function flushScheduler(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("terminal pane load scheduler", () => {
  it("bounds concurrent loads and grants the active pane first", async () => {
    const scheduler = createTerminalPaneLoadScheduler(2);
    const grants: string[] = [];
    const permits = new Map<string, TerminalPaneLoadPermit>();

    scheduler.request(0, (permit) => {
      grants.push("monitor-1");
      permits.set("monitor-1", permit);
    });
    scheduler.request(100, (permit) => {
      grants.push("active");
      permits.set("active", permit);
    });
    scheduler.request(0, (permit) => {
      grants.push("monitor-2");
      permits.set("monitor-2", permit);
    });

    await flushScheduler();
    assert.deepEqual(grants, ["active", "monitor-1"]);

    permits.get("active")?.release();
    await flushScheduler();
    assert.deepEqual(grants, ["active", "monitor-1", "monitor-2"]);
  });

  it("reorders a queued pane when it becomes active", async () => {
    const scheduler = createTerminalPaneLoadScheduler(1);
    const grants: string[] = [];
    const permits: { first?: TerminalPaneLoadPermit } = {};

    scheduler.request(10, (permit) => {
      grants.push("first");
      permits.first = permit;
    });
    scheduler.request(0, () => grants.push("second"));
    const promoted = scheduler.request(0, () => grants.push("promoted"));
    promoted.updatePriority(100);

    await flushScheduler();
    assert.deepEqual(grants, ["promoted"]);

    promoted.cancel();
    await flushScheduler();
    assert.deepEqual(grants, ["promoted", "first"]);

    permits.first?.release();
    await flushScheduler();
    assert.deepEqual(grants, ["promoted", "first", "second"]);
  });

  it("skips a cancelled queued pane", async () => {
    const scheduler = createTerminalPaneLoadScheduler(1);
    const grants: string[] = [];
    const permits: { first?: TerminalPaneLoadPermit } = {};

    scheduler.request(1, (permit) => {
      grants.push("first");
      permits.first = permit;
    });
    const cancelled = scheduler.request(0, () => grants.push("cancelled"));
    cancelled.cancel();

    await flushScheduler();
    permits.first?.release();
    await flushScheduler();

    assert.deepEqual(grants, ["first"]);
  });
});
