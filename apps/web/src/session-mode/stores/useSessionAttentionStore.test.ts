import { beforeEach, expect, test } from "vitest";
import {
  useSessionAttentionStore,
  latestUnread,
} from "./useSessionAttentionStore";

beforeEach(() => useSessionAttentionStore.setState({ receipts: {} }));
test("completion is unread until its exact reply is viewed; replay cannot re-notify", () => {
  const store = useSessionAttentionStore.getState();
  store.complete("codex", "a", "turn-1");
  expect(
    latestUnread(useSessionAttentionStore.getState().receipts["codex:a"]),
  ).toBe("turn-1");
  store.read("codex", "a", "turn-1");
  store.complete("codex", "a", "turn-1");
  expect(
    latestUnread(useSessionAttentionStore.getState().receipts["codex:a"]),
  ).toBeNull();
});
test("an older read receipt cannot dismiss a newer completion or another agent", () => {
  const store = useSessionAttentionStore.getState();
  store.complete("codex", "a", "one");
  store.complete("codex", "a", "two");
  store.complete("cc", "a", "cc-result");
  store.read("codex", "a", "one");
  expect(
    latestUnread(useSessionAttentionStore.getState().receipts["codex:a"]),
  ).toBe("two");
  expect(
    latestUnread(useSessionAttentionStore.getState().receipts["cc:a"]),
  ).toBe("cc-result");
});
test("rehydration retains unread and merges peer read receipts", async () => {
  const store = useSessionAttentionStore.getState();
  store.complete("cc", "a", "result");
  const persisted = localStorage.getItem("kanban.session.attention")!;
  useSessionAttentionStore.setState({ receipts: {} });
  localStorage.setItem("kanban.session.attention", persisted);
  await useSessionAttentionStore.persist.rehydrate();
  expect(
    latestUnread(useSessionAttentionStore.getState().receipts["cc:a"]),
  ).toBe("result");
});
