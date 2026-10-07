import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { useAcpSessions } from "./useAcpSessions";
const api = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("@session/services/apiAdapt/acp", () => ({
  acpListSessions: api.list,
}));
beforeEach(() => api.list.mockReset());
test("ACP list exposes loading, failure and retry success independently of empty results", async () => {
  api.list
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce([]);
  const { result } = renderHook(() => useAcpSessions("/fixture"));
  expect(result.current.loading).toBe(true);
  await waitFor(() => expect(result.current.error).toBe("offline"));
  expect(result.current.loading).toBe(false);
  await act(() => result.current.refresh());
  expect(result.current.error).toBeNull();
  expect(result.current.sessions).toEqual([]);
});
test("old ACP response cannot replace a newer project result", async () => {
  let resolveOld!: (rows: any[]) => void;
  api.list
    .mockReturnValueOnce(new Promise((resolve) => (resolveOld = resolve)))
    .mockResolvedValueOnce([{ sessionId: "new" }]);
  const { result, rerender } = renderHook(({ dir }) => useAcpSessions(dir), {
    initialProps: { dir: "/old" },
  });
  rerender({ dir: "/new" });
  await waitFor(() =>
    expect(result.current.sessions[0]?.sessionId).toBe("new"),
  );
  await act(async () => resolveOld([{ sessionId: "old" }]));
  expect(result.current.sessions[0]?.sessionId).toBe("new");
});
