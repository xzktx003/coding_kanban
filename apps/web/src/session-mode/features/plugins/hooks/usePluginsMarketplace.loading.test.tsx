import { useAgentCenterStore } from "@session/stores/useAgentCenterStore";
import { useAgentSettingsStore } from "@session/stores/useAgentSettingsStore";
import { useCodexStore } from "@session/components/codex/stores";
import {
  useSessionDraftStore,
  readDraft,
  sessionDraftKey,
} from "@session/stores/useSessionDraftStore";
import { useAcpStore } from "@session/stores/useAcpStore";
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

test("using a plugin focuses its Codex draft rather than leaving the Claude input selected", async () => {
  useAcpStore.setState({ active: false });
  useAgentSettingsStore.setState({ selectedAgent: "cc" });
  useAgentCenterStore.setState({
    cards: [
      { kind: "codex", id: "plugin-code", cwd: "/fixture" },
      { kind: "cc", id: "selected-claude", cwd: "/fixture" },
    ],
    currentAgentCardId: "selected-claude",
    currentAgentCardKind: "cc",
  });
  useCodexStore.setState({
    currentThreadId: "plugin-code",
    historyLoadedMap: { "plugin-code": true },
    events: { "plugin-code": [] },
  });
  useSessionDraftStore.setState({ drafts: {} });
  const { result } = renderHook(() => usePluginsMarketplace());
  await act(() =>
    result.current.handleUsePlugin({
      id: "fixture-plugin@fixture",
      name: "fixture-plugin",
      interface: { displayName: "Fixture Plugin" },
    } as any),
  );
  expect(useAgentCenterStore.getState().currentAgentCardId).toBe("plugin-code");
  expect(useAgentCenterStore.getState().currentAgentCardKind).toBe("codex");
  expect(readDraft(sessionDraftKey("codex", "plugin-code")).text).toContain(
    "@Fixture Plugin",
  );
});
