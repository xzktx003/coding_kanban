import { beforeEach, expect, it, vi } from "vitest";
import { searchThreadOccurrences, nativeSearchMatches } from "./nativeSearch";
import { SessionApiError } from "@session/services/apiAdapt/shared";
const mocks = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock("@session/services/apiAdapt/shared", async (original) => ({
  ...(await original<typeof import("@session/services/apiAdapt/shared")>()),
  postJsonWithOptions: mocks.post,
}));
const data = {
  data: [
    {
      turnId: "actual-turn",
      itemId: "actual-item",
      turnCursor: "opaque-inclusive",
      snippet: "😀 native",
      snippetMatchRange: { start: 3, end: 9 },
    },
    {
      turnId: "actual-turn",
      itemId: "actual-item",
      turnCursor: "opaque-inclusive",
      snippet: "Another native",
      snippetMatchRange: { start: 8, end: 14 },
    },
  ],
  nextCursor: "next-page",
};
beforeEach(() => mocks.post.mockReset().mockResolvedValue(data));
it("sends only the captured owner/query/cursor and retains native UTF16 ranges and item occurrence ordinals", async () => {
  const response = await searchThreadOccurrences({
    threadId: "owner",
    searchTerm: "native",
    cursor: "previous-page",
  });
  expect(mocks.post).toHaveBeenCalledWith(
    "/api/codex/thread/search-occurrences",
    {
      threadId: "owner",
      searchTerm: "native",
      cursor: "previous-page",
      limit: 250,
    },
    expect.objectContaining({ suppressToast: true }),
  );
  expect(response).toEqual(data);
  expect(
    nativeSearchMatches("owner", "native", data.data).map((match) => [
      match.threadId,
      match.turnId,
      match.itemId,
      match.occurrence,
      match.rowId,
      match.snippetMatchRange,
    ]),
  ).toEqual([
    ["owner", "actual-turn", "actual-item", 0, undefined, { start: 3, end: 9 }],
    [
      "owner",
      "actual-turn",
      "actual-item",
      1,
      undefined,
      { start: 8, end: 14 },
    ],
  ]);
});
it("only a verified unsupported capability falls back; auth, invalid cursor and gateway errors remain explicit", async () => {
  for (const status of [404, 405, 501]) {
    mocks.post.mockRejectedValueOnce(
      new SessionApiError("Method unavailable", status),
    );
    expect(
      await searchThreadOccurrences({
        threadId: "owner",
        searchTerm: "native",
      }),
    ).toBeNull();
  }
  for (const status of [400, 401, 403, 500, 503]) {
    mocks.post.mockRejectedValueOnce(
      new SessionApiError("Business failure", status),
    );
    await expect(
      searchThreadOccurrences({ threadId: "owner", searchTerm: "native" }),
    ).rejects.toThrow("Business failure");
  }
});
it("malformed native identities and ranges fail rather than inventing navigation rows", async () => {
  mocks.post.mockResolvedValueOnce({
    ...data,
    data: [{ ...data.data[0], snippetMatchRange: { start: 99, end: 100 } }],
  });
  await expect(
    searchThreadOccurrences({ threadId: "owner", searchTerm: "native" }),
  ).rejects.toThrow(/无效/);
  mocks.post.mockResolvedValueOnce({
    ...data,
    data: [{ ...data.data[0], turnCursor: null }],
  });
  await expect(
    searchThreadOccurrences({ threadId: "owner", searchTerm: "native" }),
  ).rejects.toThrow(/无效/);
  await expect(
    searchThreadOccurrences({
      threadId: "owner",
      searchTerm: "native",
      cursor: "c".repeat(4097),
    }),
  ).rejects.toThrow(/参数/);
});
