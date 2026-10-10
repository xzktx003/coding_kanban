import { expect, it, vi } from "vitest";
import { prepareThreadSearchMatch } from "./prepareThreadSearchMatch";
const message = {
  rowId: "actual-row",
  itemId: "item",
  turnId: "turn",
  role: "user",
  text: "needle",
} as const;
const match = {
  itemId: "item",
  turnId: "turn",
  threadId: "owner",
  query: "needle",
  occurrence: 0,
  preview: "needle",
  role: "user",
  turnCursor: "actual-native-cursor",
} as const;
it("hydrates only the actual native cursor and resolves the exact owner/turn/item to a projected stable row", async () => {
  let rows: (typeof message)[] = [];
  const loadCursor = vi.fn(async () => {
    rows = [message];
  });
  const result = await prepareThreadSearchMatch({
    threadId: "owner",
    match,
    getMessages: () => rows,
    loadCursor,
    isCurrent: () => true,
    waitForLayout: async () => {},
  });
  expect(loadCursor).toHaveBeenCalledWith("actual-native-cursor");
  expect(result).toMatchObject({
    rowId: "actual-row",
    itemId: "item",
    turnId: "turn",
    query: "needle",
  });
});
it("rejects foreign, absent and superseded targets without inventing an anchor or issuing a foreign read", async () => {
  const loadCursor = vi.fn(async () => {}),
    options = {
      threadId: "owner",
      match,
      getMessages: () => [],
      loadCursor,
      isCurrent: () => true,
      waitForLayout: async () => {},
    };
  expect(
    await prepareThreadSearchMatch({
      ...options,
      match: { ...match, threadId: "other" },
    }),
  ).toBeNull();
  expect(loadCursor).not.toHaveBeenCalled();
  expect(
    await prepareThreadSearchMatch({
      ...options,
      match: { ...match, turnCursor: undefined },
    }),
  ).toBeNull();
  expect(loadCursor).not.toHaveBeenCalled();
  let current = true;
  expect(
    await prepareThreadSearchMatch({
      ...options,
      getMessages: () => (current ? [] : [message]),
      isCurrent: () => current,
      loadCursor: async () => {
        current = false;
      },
    }),
  ).toBeNull();
});
