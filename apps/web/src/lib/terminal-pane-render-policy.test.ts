import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  resolveRetainedTerminalMonitorSlots,
  resolveRecentTerminalSessionIds,
  shouldMountTerminalPane,
} from "./terminal-pane-render-policy.js";

describe("terminal pane render policy", () => {
  it("keeps the current session plus only the two most recent single-pane sessions", () => {
    assert.deepEqual(
      resolveRecentTerminalSessionIds(
        "session-4",
        ["session-3", "session-2", "session-1"],
        3,
      ),
      ["session-4", "session-3", "session-2"],
    );
  });

  it("deduplicates a cached current session and keeps it first", () => {
    assert.deepEqual(
      resolveRecentTerminalSessionIds(
        "session-2",
        ["session-3", "session-2", "session-1"],
        3,
      ),
      ["session-2", "session-3", "session-1"],
    );
  });

  it("mounts every manual pane but defers offscreen group panes", () => {
    assert.equal(
      shouldMountTerminalPane({
        active: false,
        groupArrangement: false,
        visible: false,
      }),
      true,
    );
    assert.equal(
      shouldMountTerminalPane({
        active: true,
        groupArrangement: true,
        visible: false,
      }),
      true,
    );
    assert.equal(
      shouldMountTerminalPane({
        active: false,
        groupArrangement: true,
        visible: false,
      }),
      false,
    );
    assert.equal(
      shouldMountTerminalPane({
        active: false,
        groupArrangement: true,
        visible: true,
      }),
      true,
    );
  });

  it("retains previously mounted manual panes across layout contraction", () => {
    const retained = resolveRetainedTerminalMonitorSlots({
      currentSlots: [{ id: "terminal-monitor-slot-1", sessionId: "session-1" }],
      retainedSlots: [
        { id: "terminal-monitor-slot-1", sessionId: "session-1" },
        { id: "terminal-monitor-slot-2", sessionId: "session-2" },
        { id: "terminal-monitor-slot-3", sessionId: "session-3" },
      ],
      validSessionIds: new Set(["session-1", "session-2", "session-3"]),
    });

    assert.deepEqual(retained, [
      { id: "terminal-monitor-slot-1", sessionId: "session-1" },
      { id: "terminal-monitor-slot-2", sessionId: "session-2" },
      { id: "terminal-monitor-slot-3", sessionId: "session-3" },
    ]);
  });

  it("makes current panes authoritative and removes stale retained sessions", () => {
    const retained = resolveRetainedTerminalMonitorSlots({
      currentSlots: [
        { id: "terminal-monitor-slot-1", sessionId: "session-2" },
        { id: "terminal-monitor-slot-2", sessionId: "session-1" },
      ],
      retainedSlots: [
        { id: "terminal-monitor-slot-1", sessionId: "session-1" },
        { id: "terminal-monitor-slot-2", sessionId: "session-2" },
        { id: "terminal-monitor-slot-3", sessionId: "deleted-session" },
      ],
      validSessionIds: new Set(["session-1", "session-2"]),
    });

    assert.deepEqual(retained, [
      { id: "terminal-monitor-slot-1", sessionId: "session-2" },
      { id: "terminal-monitor-slot-2", sessionId: "session-1" },
      { id: "terminal-monitor-slot-3", sessionId: null },
    ]);
  });
});
