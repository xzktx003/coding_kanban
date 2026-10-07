import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { usePluginsMarketplace } from "./usePluginsMarketplace";
const api = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("@session/services", () => ({ pluginList: api.list }));
vi.mock("../hooks", () => ({
  usePluginsViewContext: () => ({ handlePluginDetail: vi.fn() }),
}));
vi.mock("./useExternalUrl", () => ({
  useExternalUrl: () => ({ openExternalUrl: vi.fn() }),
}));
beforeEach(() => {
  api.list.mockReset();
  api.list.mockResolvedValue({ marketplaces: [], marketplaceLoadErrors: [] });
});
test("plugin list failure remains distinct from successful empty data and can retry", async () => {
  api.list.mockRejectedValueOnce(new Error("catalog offline"));
  const { result } = renderHook(() => usePluginsMarketplace());
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  await waitFor(() =>
    expect((result.current as any).loadError).toBe("catalog offline"),
  );
  await act(() => result.current.loadPlugins());
  expect((result.current as any).loadError).toBeNull();
  expect(result.current.marketplaces).toEqual([]);
});
test("failed refresh preserves previously loaded plugin navigation", async () => {
  const existing = [{ name: "Fixture", path: "/fixture/plugins", plugins: [] }];
  api.list.mockResolvedValueOnce({
    marketplaces: existing,
    marketplaceLoadErrors: [],
  });
  const { result } = renderHook(() => usePluginsMarketplace(1));
  await act(() => result.current.loadPlugins());
  await waitFor(() => expect(result.current.marketplaces).toEqual(existing));
  api.list.mockRejectedValueOnce(new Error("503"));
  await act(() => result.current.loadPlugins());
  expect(result.current.marketplaces).toEqual(existing);
  expect((result.current as any).loadError).toBe("503");
});
