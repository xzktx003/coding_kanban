import { act, render, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useNativeWebsiteCapability } from "./capability";
const mocks = vi.hoisted(() => ({
  store: null as any,
  origin: "",
  fetch: vi.fn(),
}));
vi.mock("@session/stores/usePairingStore", async () => {
  const { create } = await import("zustand");
  mocks.store = create(() => ({
    selectedHost: "fixture",
    desktops: [{ host: "fixture", port: 42, token: "old" }],
  }));
  return { usePairingStore: mocks.store };
});
vi.mock("@session/hooks/runtime", () => ({
  buildUrl: (p: string) => mocks.origin + p,
  authHeaders: () => ({
    Authorization: "Bearer " + mocks.store.getState().desktops[0].token,
  }),
}));
beforeEach(() => {
  mocks.origin = "https://fixture-" + Math.random() + ".invalid";
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.fetch.mockReset();
  mocks.store.setState({
    selectedHost: "fixture",
    desktops: [{ host: "fixture", port: 42, token: "old" }],
  });
});
afterEach(() => vi.unstubAllGlobals());
it("negotiates once for concurrent links and does not poll HTML or capabilities", async () => {
  let resolve!: (r: any) => void;
  mocks.fetch.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const a = renderHook(() => useNativeWebsiteCapability(true)),
    b = renderHook(() => useNativeWebsiteCapability(true));
  expect(a.result.current).toBe(false);
  expect(mocks.fetch).toHaveBeenCalledOnce();
  await act(async () =>
    resolve({ ok: true, json: async () => ({ supported: true }) }),
  );
  expect(a.result.current).toBe(true);
  expect(b.result.current).toBe(true);
  expect(mocks.fetch.mock.calls[0][1].headers).toEqual({
    Authorization: "Bearer old",
  });
  a.unmount();
  b.unmount();
});
it("a same-endpoint token change must not render the previous host capability for a frame", async () => {
  const values: boolean[] = [];
  mocks.fetch
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ supported: true }),
    })
    .mockImplementation(() => new Promise(() => {}));
  function Consumer() {
    const available = useNativeWebsiteCapability(true);
    if (mocks.store.getState().desktops[0].token === "new")
      values.push(available);
    return null;
  }
  const view = render(<Consumer />);
  await act(async () => {});
  act(() =>
    mocks.store.setState({
      desktops: [{ host: "fixture", port: 42, token: "new" }],
    }),
  );
  expect(values).not.toContain(true);
  expect(mocks.fetch).toHaveBeenCalledTimes(2);
  view.unmount();
});
it("unsupported or missing host stays unavailable and an invisible link performs no read", async () => {
  mocks.fetch.mockResolvedValue({
    ok: false,
    json: async () => ({ supported: true }),
  });
  const a = renderHook(() => useNativeWebsiteCapability(false));
  expect(mocks.fetch).not.toHaveBeenCalled();
  a.unmount();
  const b = renderHook(() => useNativeWebsiteCapability(true));
  await act(async () => {});
  expect(b.result.current).toBe(false);
  b.unmount();
});
