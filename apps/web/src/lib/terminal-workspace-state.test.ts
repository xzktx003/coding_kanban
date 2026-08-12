import assert from "node:assert/strict";
import test from "node:test";

import {
  loadTerminalWorkspaceState,
  resolveTerminalWorkspaceStateForFocus,
  saveTerminalWorkspaceState,
} from "./terminal-workspace-state.js";

function createStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
    removeItem(key: string) {
      values.delete(key);
    },
  };
}

test("persists monitor layout, slot assignments, active input slot, and closed slots", () => {
  const storage = createStorage();

  saveTerminalWorkspaceState(
    {
      mode: "quad",
      slots: [
        { id: "terminal-monitor-slot-1", sessionId: "session-a" },
        { id: "terminal-monitor-slot-2", sessionId: null },
        { id: "terminal-monitor-slot-3", sessionId: "session-c" },
        { id: "terminal-monitor-slot-4", sessionId: "session-d" },
      ],
      activeSlotId: "terminal-monitor-slot-3",
      closedSlotIds: ["terminal-monitor-slot-2"],
    },
    storage,
  );

  assert.deepEqual(loadTerminalWorkspaceState(storage), {
    mode: "quad",
    slots: [
      { id: "terminal-monitor-slot-1", sessionId: "session-a" },
      { id: "terminal-monitor-slot-2", sessionId: null },
      { id: "terminal-monitor-slot-3", sessionId: "session-c" },
      { id: "terminal-monitor-slot-4", sessionId: "session-d" },
    ],
    activeSlotId: "terminal-monitor-slot-3",
    closedSlotIds: ["terminal-monitor-slot-2"],
  });
});

test("migrates the previous layout-mode-only storage and rejects malformed slots", () => {
  const storage = createStorage({
    "terminal-monitor-layout-mode": "dual",
  });

  assert.deepEqual(loadTerminalWorkspaceState(storage), {
    mode: "dual",
    slots: [],
    activeSlotId: "terminal-monitor-slot-1",
    closedSlotIds: [],
  });

  storage.setItem(
    "terminal-monitor-workspace-v1",
    JSON.stringify({
      mode: "quad",
      slots: [{ id: "../invalid", sessionId: 42 }],
      activeSlotId: "../invalid",
      closedSlotIds: ["../invalid"],
    }),
  );

  assert.deepEqual(loadTerminalWorkspaceState(storage), {
    mode: "quad",
    slots: [],
    activeSlotId: "terminal-monitor-slot-1",
    closedSlotIds: [],
  });
});

test("reopens a stale closed active slot for a newly focused session", () => {
  assert.deepEqual(
    resolveTerminalWorkspaceStateForFocus(
      {
        mode: "single",
        slots: [
          { id: "terminal-monitor-slot-1", sessionId: "deleted-session" },
        ],
        activeSlotId: "terminal-monitor-slot-1",
        closedSlotIds: ["terminal-monitor-slot-1"],
      },
      [{ id: "remaining-session" }],
      "remaining-session",
    ),
    {
      mode: "single",
      slots: [
        {
          id: "terminal-monitor-slot-1",
          sessionId: "remaining-session",
        },
      ],
      activeSlotId: "terminal-monitor-slot-1",
      closedSlotIds: [],
    },
  );
});
