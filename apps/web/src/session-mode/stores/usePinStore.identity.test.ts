import { beforeEach, expect, test } from "vitest";
import { usePinStore } from "./usePinStore";
import { useSessionAttentionStore } from "./useSessionAttentionStore";
beforeEach(() => { usePinStore.setState({ pinned: [] }); useSessionAttentionStore.setState({ receipts: {} }); });
test("equal native ids from different agents keep independent pin actions", () => {
  const store = usePinStore.getState();
  store.togglePin({ kind: "codex", id: "same", title: "Codex", cwd: "/project" });
  store.togglePin({ kind: "cc", id: "same", title: "Claude", cwd: "/project" });
  expect(usePinStore.getState().pinned).toHaveLength(2);
  store.unpin("same", "codex");
  expect(usePinStore.getState().pinned.map(p => p.kind)).toEqual(["cc"]);
});
test("a visibility observation captured before manual-unread cannot clear that new intention", () => {
  const store = useSessionAttentionStore.getState();
  store.complete("codex", "a", "reply");
  store.read("codex", "a", "reply");
  store.markUnread("codex", "a");
  store.read("codex", "a", "reply", 0);
  expect(useSessionAttentionStore.getState().receipts["codex:a"].read).toEqual([]);
});
