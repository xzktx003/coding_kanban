import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
const list = vi.hoisted(() => vi.fn());
vi.mock("@session/lib/sessions", () => ({ listSessions: list }));
vi.mock("@session/hooks/runtime", () => ({ isDesktopTauri: () => false }));
import { useSessionPagination } from "./useSessionPagination";
const session = { session_id: "a", summary: "会话", last_modified: 1 };
beforeEach(() => list.mockReset());
it("expands already supplied rows without requesting or replacing them", async () => {
  const { result } = renderHook(() =>
    useSessionPagination({
      directory: "/a",
      sessions: Array.from({ length: 5 }, (_, i) => ({
        ...session,
        session_id: String(i),
      })),
    }),
  );
  await act(() => result.current.loadMoreSessions());
  expect(result.current.expanded).toBe(true);
  expect(list).not.toHaveBeenCalled();
});
it("preserves loaded rows when pagination fails and allows retry", async () => {
  list.mockResolvedValueOnce({ sessions: [session], total: 30 });
  const { result } = renderHook(() =>
    useSessionPagination({ directory: "/a" }),
  );
  await waitFor(() => expect(result.current.loading).toBe(false));
  await act(() => result.current.loadMoreSessions());
  list.mockRejectedValueOnce(new Error("offline"));
  await act(() => result.current.loadMoreSessions());
  expect(result.current.loadedSessions).toEqual([session]);
  expect(result.current.pageError).toBe("offline");
  list.mockResolvedValueOnce({
    sessions: [{ ...session, session_id: "b" }],
    total: 2,
  });
  await act(() => result.current.loadMoreSessions());
  expect(result.current.pageError).toBeNull();
  expect(result.current.loadedSessions).toHaveLength(2);
});
it("deduplicates clicks and drops late pagination after switching project", async () => {
  let resolve!: (value: unknown) => void;
  list.mockResolvedValueOnce({ sessions: [session], total: 30 });
  const { result, rerender } = renderHook(
    ({ directory }) => useSessionPagination({ directory }),
    { initialProps: { directory: "/a" } },
  );
  await waitFor(() => expect(result.current.loading).toBe(false));
  await act(() => result.current.loadMoreSessions());
  list.mockReturnValueOnce(
    new Promise((r) => {
      resolve = r;
    }),
  );
  let pending!: Promise<void>;
  act(() => {
    pending = result.current.loadMoreSessions();
    void result.current.loadMoreSessions();
  });
  expect(list).toHaveBeenCalledTimes(2);
  list.mockResolvedValueOnce({
    sessions: [{ ...session, session_id: "new" }],
    total: 1,
  });
  rerender({ directory: "/b" });
  await waitFor(() =>
    expect(result.current.loadedSessions[0]?.session_id).toBe("new"),
  );
  await act(async () => {
    resolve({ sessions: [{ ...session, session_id: "old-page" }], total: 30 });
    await pending;
  });
  expect(result.current.loadedSessions.map((s) => s.session_id)).toEqual([
    "new",
  ]);
});
