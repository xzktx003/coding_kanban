import { afterEach, expect, it } from "vitest";
import { useCodexStore } from "./useCodexStore";
afterEach(() => useCodexStore.setState({ threads: [], currentThreadId: null }));
it("deduplicates overlapping native list identities without changing their order or input target", () => {
  const latest = { id: "a", name: "newest", updatedAt: 2 } as any;
  const other = { id: "b", name: "other" } as any;
  useCodexStore.setState({ currentThreadId: "b" });
  useCodexStore.getState().setThreads([latest, other, { ...latest, name: "overlap", updatedAt: 1 }]);
  expect(useCodexStore.getState().threads).toEqual([latest, other]);
  expect(useCodexStore.getState().currentThreadId).toBe("b");
  useCodexStore.getState().appendThreads([{ id: "a" } as any, { id: "c" } as any]);
  expect(useCodexStore.getState().threads.map(t => t.id)).toEqual(["a", "b", "c"]);
});
