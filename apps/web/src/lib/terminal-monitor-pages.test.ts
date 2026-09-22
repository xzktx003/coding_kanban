import assert from "node:assert/strict";
import test from "node:test";

import {
  createTerminalMonitorPage,
  deleteTerminalMonitorPage,
  loadTerminalMonitorPages,
  renameTerminalMonitorPage,
  saveTerminalMonitorPages,
  updateActiveTerminalMonitorPage,
} from "./terminal-monitor-pages.js";
import type { TerminalWorkspaceState } from "./terminal-workspace-state.js";

const LEGACY_WORKSPACE_KEY = "terminal-monitor-workspace-v1";

function createStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}

function emptyWorkspace(
  overrides: Partial<TerminalWorkspaceState> = {},
): TerminalWorkspaceState {
  return {
    mode: "single",
    arrangementMode: "manual",
    arrangementGroupId: null,
    groupSessionOrderByGroupId: {},
    slots: [],
    activeSlotId: "terminal-monitor-slot-1",
    closedSlotIds: [],
    ...overrides,
  };
}

test("empty storage loads a single default page", () => {
  const pages = loadTerminalMonitorPages(createStorage());

  assert.equal(pages.pages.length, 1);
  assert.equal(pages.pages[0]?.name, "默认");
  assert.equal(pages.pages[0]?.id, "terminal-monitor-page-1");
  assert.equal(pages.activePageId, "terminal-monitor-page-1");
  assert.deepEqual(pages.pages[0]?.state, emptyWorkspace());
});

test("migrates the legacy workspace into the default page", () => {
  const legacy = emptyWorkspace({
    mode: "dual",
    slots: [
      { id: "terminal-monitor-slot-1", sessionId: "session-a" },
      { id: "terminal-monitor-slot-2", sessionId: "session-b" },
    ],
    activeSlotId: "terminal-monitor-slot-2",
  });
  const pages = loadTerminalMonitorPages(
    createStorage({
      [LEGACY_WORKSPACE_KEY]: JSON.stringify(legacy),
    }),
  );

  assert.equal(pages.pages.length, 1);
  assert.equal(pages.pages[0]?.name, "默认");
  assert.deepEqual(pages.pages[0]?.state, legacy);
});

test("creates page 2 and makes it active", () => {
  const created = createTerminalMonitorPage(
    loadTerminalMonitorPages(createStorage()),
  );

  assert.equal(created.pages.length, 2);
  assert.equal(created.pages[1]?.name, "页面 2");
  assert.equal(created.pages[1]?.id, "terminal-monitor-page-2");
  assert.equal(created.activePageId, "terminal-monitor-page-2");
  assert.deepEqual(created.pages[1]?.state, emptyWorkspace());
});

test("renaming or deleting the default page leaves state unchanged", () => {
  const initial = loadTerminalMonitorPages(createStorage());

  assert.deepEqual(
    renameTerminalMonitorPage(initial, "terminal-monitor-page-1", "工作台"),
    initial,
  );
  assert.deepEqual(
    deleteTerminalMonitorPage(initial, "terminal-monitor-page-1"),
    initial,
  );
});

test("rejects duplicate or blank names and keeps the original state", () => {
  const created = createTerminalMonitorPage(
    loadTerminalMonitorPages(createStorage()),
  );
  const secondPageId = created.pages[1]?.id ?? "";

  assert.deepEqual(
    renameTerminalMonitorPage(created, secondPageId, "  默认  "),
    created,
  );
  assert.deepEqual(
    renameTerminalMonitorPage(created, secondPageId, "   "),
    created,
  );
  assert.deepEqual(
    renameTerminalMonitorPage(created, secondPageId, ""),
    created,
  );
});

test("deleting the active non-default page activates the previous page", () => {
  const second = createTerminalMonitorPage(
    loadTerminalMonitorPages(createStorage()),
  );
  const third = createTerminalMonitorPage(second);

  assert.equal(third.activePageId, "terminal-monitor-page-3");

  const deleted = deleteTerminalMonitorPage(third, "terminal-monitor-page-3");

  assert.equal(deleted.activePageId, "terminal-monitor-page-2");
  assert.deepEqual(
    deleted.pages.map((page) => page.id),
    ["terminal-monitor-page-1", "terminal-monitor-page-2"],
  );
});

test("saved pages load back unchanged", () => {
  const storage = createStorage();
  const created = createTerminalMonitorPage(
    loadTerminalMonitorPages(storage),
  );
  const updated = updateActiveTerminalMonitorPage(
    created,
    emptyWorkspace({ mode: "quad", activeSlotId: "terminal-monitor-slot-1" }),
  );

  saveTerminalMonitorPages(updated, storage);

  assert.deepEqual(loadTerminalMonitorPages(storage), updated);
});
