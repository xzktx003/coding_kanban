import { beforeEach, expect, test } from "vitest";
import { captureHistorySourceScope } from "../components/history/historySourceScope";
import { invalidateCodexOperationScope } from "./codexOperationScope";
import {
  confirmProviderHistoryRows,
  readProviderHistoryConfirmation,
  useProviderHistoryConfirmationStore,
} from "./providerHistorySourceConfirmation";
beforeEach(() => useProviderHistoryConfirmationStore.setState({ revision: 0 }));
const identity = {
  provider: "acp" as const,
  sourceId: "history-source",
  itemId: "source-1",
  owner: "exact-owner",
};
test("only an accepted canonical row gets an exact source proof; another identical object does not", () => {
  const row = { id: "entry" },
    scope = captureHistorySourceScope("/api/acp/session");
  confirmProviderHistoryRows([{ row, ...identity }], scope);
  expect(readProviderHistoryConfirmation(row, identity)?.scope).toBe(scope);
  expect(readProviderHistoryConfirmation({ id: "entry" }, identity)).toBeNull();
  expect(
    readProviderHistoryConfirmation(row, { ...identity, sourceId: "other" }),
  ).toBeNull();
  expect(
    readProviderHistoryConfirmation(row, { ...identity, itemId: "source-2" }),
  ).toBeNull();
});
test("same scope confirmation keeps both token and subscriptions unchanged", () => {
  const row = {},
    scope = captureHistorySourceScope("/api/acp/session");
  confirmProviderHistoryRows([{ row, ...identity }], scope);
  const before = readProviderHistoryConfirmation(row, identity),
    rev = useProviderHistoryConfirmationStore.getState().revision;
  confirmProviderHistoryRows(
    [{ row, ...identity }],
    captureHistorySourceScope("/api/acp/session"),
  );
  expect(readProviderHistoryConfirmation(row, identity)).toBe(before);
  expect(useProviderHistoryConfirmationStore.getState().revision).toBe(rev);
});
test("accepted page cursor remains a memory locator without creating new authority or notifications", () => {
  const row = {},
    scope = captureHistorySourceScope("/api/acp/session");
  confirmProviderHistoryRows([{ row, ...identity }], scope, "older-page");
  const proof = readProviderHistoryConfirmation(row, identity),
    rev = useProviderHistoryConfirmationStore.getState().revision;
  expect(proof?.readCursor).toBe("older-page");
  confirmProviderHistoryRows([{ row, ...identity }], scope, "overlapping-page");
  expect(readProviderHistoryConfirmation(row, identity)).toBe(proof);
  expect(proof?.readCursor).toBe("overlapping-page");
  expect(useProviderHistoryConfirmationStore.getState().revision).toBe(rev);
  invalidateCodexOperationScope();
  expect(readProviderHistoryConfirmation(row, identity)?.scope).toBe(scope);
  expect(readProviderHistoryConfirmation(row, identity)?.confirmationKey).toBe(
    proof?.confirmationKey,
  );
  confirmProviderHistoryRows(
    [{ row, ...identity }],
    captureHistorySourceScope("/api/acp/session"),
  );
  expect(
    readProviderHistoryConfirmation(row, identity)?.readCursor,
  ).toBeUndefined();
  expect(
    readProviderHistoryConfirmation(row, identity)?.confirmationKey,
  ).not.toBe(proof?.confirmationKey);
});
test("fresh accepted read after same-value account invalidation advances only the confirmed row", () => {
  const row = {},
    other = {},
    scope = captureHistorySourceScope("/api/acp/session");
  confirmProviderHistoryRows(
    [
      { row, ...identity },
      { row: other, ...identity, itemId: "source-2" },
    ],
    scope,
  );
  const old = readProviderHistoryConfirmation(row, identity),
    otherBefore = readProviderHistoryConfirmation(other, {
      ...identity,
      itemId: "source-2",
    });
  invalidateCodexOperationScope();
  confirmProviderHistoryRows(
    [{ row, ...identity }],
    captureHistorySourceScope("/api/acp/session"),
  );
  expect(
    readProviderHistoryConfirmation(row, identity)?.confirmationKey,
  ).not.toBe(old?.confirmationKey);
  expect(
    readProviderHistoryConfirmation(other, { ...identity, itemId: "source-2" }),
  ).toBe(otherBefore);
});
