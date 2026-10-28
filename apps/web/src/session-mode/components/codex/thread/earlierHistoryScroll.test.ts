import { describe, expect, it } from "vitest";
import {
  EARLIER_HISTORY_SCROLL_MARGIN,
  hasEarlierHistory,
  shouldLoadEarlierOnScroll,
  type EarlierHistoryScrollInput,
} from "./earlierHistoryScroll";

const reading: EarlierHistoryScrollInput = {
  scrollTop: 0,
  pinnedToBottom: false,
  cursor: "before-50",
  trimmedAnchor: undefined,
  loading: false,
  error: undefined,
};

describe("earlier-history scroll paging", () => {
  it("pages in older history once the reader scrolls to the top edge", () => {
    expect(shouldLoadEarlierOnScroll(reading)).toBe(true);
    // The margin loads the next page just before the reader hits the very top,
    // so upward reading continues without stalling at an empty edge.
    expect(
      shouldLoadEarlierOnScroll({
        ...reading,
        scrollTop: EARLIER_HISTORY_SCROLL_MARGIN,
      }),
    ).toBe(true);
    expect(
      shouldLoadEarlierOnScroll({
        ...reading,
        scrollTop: EARLIER_HISTORY_SCROLL_MARGIN + 1,
      }),
    ).toBe(false);
  });

  it("pages from a trimmed-history anchor when no page cursor remains", () => {
    expect(
      shouldLoadEarlierOnScroll({
        ...reading,
        cursor: null,
        trimmedAnchor: "turn-0",
      }),
    ).toBe(true);
  });

  it("stops at the oldest message instead of requesting forever", () => {
    expect(
      shouldLoadEarlierOnScroll({
        ...reading,
        cursor: null,
        trimmedAnchor: undefined,
      }),
    ).toBe(false);
  });

  it("never pages while following live output at the bottom", () => {
    // A short transcript sits at scrollTop 0 while pinned. Auto-paging there
    // would silently pull the whole history nobody asked for.
    expect(
      shouldLoadEarlierOnScroll({ ...reading, pinnedToBottom: true }),
    ).toBe(false);
  });

  it("does not stack requests or retry a failed page on its own", () => {
    expect(shouldLoadEarlierOnScroll({ ...reading, loading: true })).toBe(false);
    // The visible retry control owns recovery; scrolling must not hammer it.
    expect(
      shouldLoadEarlierOnScroll({ ...reading, error: "读取失败" }),
    ).toBe(false);
  });
});

describe("earlier-history availability", () => {
  it("offers the control whenever either paging source can still read older turns", () => {
    expect(hasEarlierHistory({ cursor: "before-50", trimmedAnchor: undefined })).toBe(true);
    // Memory eviction released older turns of an already-loaded thread. The
    // reader must still have a way back, even without a server page cursor.
    expect(hasEarlierHistory({ cursor: null, trimmedAnchor: "turn-0" })).toBe(true);
    expect(hasEarlierHistory({ cursor: undefined, trimmedAnchor: undefined })).toBe(false);
    // An empty cursor is not a page: it must not advertise unreachable history.
    expect(hasEarlierHistory({ cursor: "", trimmedAnchor: "" })).toBe(false);
  });
});
