import { expect, it } from "vitest";
import { transcriptRowForVirtualItem } from "./transcriptVirtualRow";

it("ignores a virtual row retained from before transcript history was compacted", () => {
  const currentRows = [{ key: "turn-current" }, { key: "message-current" }];
  const staleVirtualItem = { index: 4, key: "message-removed" };

  expect(
    transcriptRowForVirtualItem(currentRows, staleVirtualItem),
  ).toBeUndefined();
});

it("does not render a different current row at a stale virtual index", () => {
  const currentRow = { key: "message-current" };

  expect(
    transcriptRowForVirtualItem([currentRow], {
      index: 0,
      key: "message-removed",
    }),
  ).toBeUndefined();
  expect(
    transcriptRowForVirtualItem([currentRow], {
      index: 0,
      key: "message-current",
    }),
  ).toBe(currentRow);
});
