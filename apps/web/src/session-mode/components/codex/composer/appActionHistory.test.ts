import { beforeEach, expect, it, vi } from "vitest";
import { canRedoAppAction, canUndoAppAction, recordAppAction, redoAppAction, resetAppActionHistory, undoAppAction } from "./appActionHistory";
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
beforeEach(() => resetAppActionHistory());
it("keeps async undo pending in its original stack and prevents duplicate dispatch", async () => {
  const work = deferred(), undo = vi.fn(() => work.promise);
  recordAppAction({ label: "置顶", undo, redo: vi.fn() });
  const pending = undoAppAction();
  expect(canRedoAppAction()).toBe(false);
  expect(await undoAppAction()).toBeNull();
  work.resolve(); expect(await pending).toBe("置顶");
  expect(undo).toHaveBeenCalledOnce(); expect(canRedoAppAction()).toBe(true);
});
it("failed async undo preserves its entry and never enables redo", async () => {
  recordAppAction({ label: "改名", undo: async () => { throw new Error("remote revision changed"); }, redo: vi.fn() });
  await expect(undoAppAction()).rejects.toThrow("remote revision changed");
  expect(canUndoAppAction()).toBe(true); expect(canRedoAppAction()).toBe(false);
});
it("reset during a pending mutation prevents late ACK from modifying a new history", async () => {
  const work = deferred();
  recordAppAction({ label: "old", undo: () => work.promise, redo: vi.fn() });
  const pending = undoAppAction(); resetAppActionHistory();
  const newUndo = vi.fn(); recordAppAction({ label: "new", undo: newUndo, redo: vi.fn() });
  work.resolve(); await pending;
  expect(canRedoAppAction()).toBe(false);
  expect(await undoAppAction()).toBe("new"); expect(newUndo).toHaveBeenCalledOnce();
});
it("new committed actions during pending undo clear redo without losing their history", async () => {
  const work = deferred();
  recordAppAction({ label: "old", undo: () => work.promise, redo: vi.fn() });
  const pending = undoAppAction();
  const newer = vi.fn(); recordAppAction({ label: "newer", undo: newer, redo: vi.fn() });
  work.resolve(); await pending;
  expect(canRedoAppAction()).toBe(false);
  await undoAppAction(); expect(newer).toHaveBeenCalledOnce();
  await redoAppAction(); expect(canUndoAppAction()).toBe(true);
});
