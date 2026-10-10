import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useNativeThreadSearch } from "./useNativeThreadSearch";
const mocks = vi.hoisted(() => ({ search: vi.fn() }));
vi.mock("./nativeSearch", () => ({ searchThreadOccurrences: mocks.search }));
const occurrence = {
  turnId: "turn",
  itemId: "item",
  snippet: "literal native",
  snippetMatchRange: { start: 8, end: 14 },
  turnCursor: "inclusive-turn",
};
beforeEach(() => {
  mocks.search.mockReset();
});
it("cancels captured owner and query requests and rejects their late results", async () => {
  let finishOld!: (value: unknown) => void;
  mocks.search
    .mockImplementationOnce(
      () => new Promise((resolve) => (finishOld = resolve)),
    )
    .mockResolvedValue({ data: [occurrence], nextCursor: null });
  const { result, rerender, unmount } = renderHook(
    ({ owner, query }) => useNativeThreadSearch(owner, query, true, () => true),
    { initialProps: { owner: "owner-a", query: "first" } },
  );
  await waitFor(() => expect(mocks.search).toHaveBeenCalledTimes(1));
  const oldSignal = mocks.search.mock.calls[0][1] as AbortSignal;
  rerender({ owner: "owner-b", query: "native" });
  expect(oldSignal.aborted).toBe(true);
  await waitFor(() => expect(result.current.data).toEqual([occurrence]));
  await act(async () =>
    finishOld({ data: [{ ...occurrence, itemId: "stale" }], nextCursor: null }),
  );
  expect(result.current.data).toEqual([occurrence]);
  expect(mocks.search.mock.calls[1][0]).toEqual({
    threadId: "owner-b",
    searchTerm: "native",
  });
  unmount();
});
it("loads only the returned owner/query cursor, coalesces concurrent clicks and never downgrades a partial native page", async () => {
  mocks.search
    .mockResolvedValueOnce({ data: [occurrence], nextCursor: "actual-next" })
    .mockResolvedValueOnce({
      data: [{ ...occurrence, itemId: "next-item" }],
      nextCursor: "last-page",
    })
    .mockResolvedValueOnce(null);
  const { result } = renderHook(() =>
    useNativeThreadSearch("owner", "native", true, () => true),
  );
  await waitFor(() => expect(result.current.nextCursor).toBe("actual-next"));
  act(() => {
    result.current.loadMore();
    result.current.loadMore();
  });
  await waitFor(() => expect(result.current.data).toHaveLength(2));
  expect(mocks.search).toHaveBeenCalledTimes(2);
  expect(mocks.search.mock.calls[1][0]).toEqual({
    threadId: "owner",
    searchTerm: "native",
    cursor: "actual-next",
  });
  act(() => result.current.loadMore());
  await waitFor(() => expect(result.current.error).toContain("分页时不可用"));
  expect(result.current.data).toHaveLength(2);
  expect(result.current.unsupported).toBe(false);
});
it("never sends a hidden panel request and reports definite unsupported separately from failed native search", async () => {
  const hidden = renderHook(() =>
    useNativeThreadSearch("owner", "native", true, () => false),
  );
  await act(async () => new Promise((resolve) => setTimeout(resolve, 180)));
  expect(mocks.search).not.toHaveBeenCalled();
  hidden.unmount();
  mocks.search.mockResolvedValueOnce(null);
  const { result, rerender } = renderHook(
    ({ query }) => useNativeThreadSearch("owner", query, true, () => true),
    { initialProps: { query: "native" } },
  );
  await waitFor(() => expect(result.current.unsupported).toBe(true));
  mocks.search.mockRejectedValueOnce(new Error("Permission denied"));
  rerender({ query: "denied" });
  await waitFor(() => expect(result.current.error).toBe("Permission denied"));
  expect(result.current.unsupported).toBe(false);
});
