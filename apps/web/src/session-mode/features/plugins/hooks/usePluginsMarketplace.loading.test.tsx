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
import { publishPluginChange } from "../pluginScope";
const api = vi.hoisted(() => ({
  list: vi.fn(),
  read: vi.fn(),
  detail: vi.fn(),
  detailError: vi.fn(),
}));
vi.mock("@session/services", () => ({
  pluginList: api.list,
  pluginRead: api.read,
}));
vi.mock("../hooks", () => ({
  usePluginsViewContext: () => ({
    handlePluginDetail: api.detail,
    handlePluginDetailError: api.detailError,
  }),
}));
vi.mock("./useExternalUrl", () => ({
  useExternalUrl: () => ({ openExternalUrl: vi.fn() }),
}));
vi.mock("@session/lib/eventStream", () => ({
  openEventStream: () => () => {},
}));
beforeEach(() => {
  publishPluginChange();
  api.list.mockReset();
  api.list.mockResolvedValue({ marketplaces: [], marketplaceLoadErrors: [] });
  api.read.mockReset();
  api.detail.mockReset().mockReturnValue(7);
  api.detailError.mockReset();
});

test.each(["foreign market", "foreign plugin", "oversized detail"])(
  "detail enrichment rejects %s without replacing its original bounded summary",
  async (failure) => {
    const marketplace = {
      name: "Private",
      path: "/private/market",
      plugins: [],
    };
    const summary = {
      id: "same-native-id",
      name: "example",
      installed: false,
      source: { type: "local", path: "/private/plugin" },
    };
    api.read.mockResolvedValue({
      plugin: {
        marketplaceName: marketplace.name,
        marketplacePath:
          failure === "foreign market" ? "/another/market" : marketplace.path,
        summary: {
          ...summary,
          name: failure === "foreign plugin" ? "another" : summary.name,
        },
        description:
          failure === "oversized detail"
            ? "x".repeat(2 * 1024 * 1024)
            : "detail",
        apps: [],
        skills: [],
        hooks: [],
        appTemplates: [],
        mcpServers: [],
      },
    });
    const { result } = renderHook(() => usePluginsMarketplace());
    await act(() =>
      result.current.handleShowDetail(marketplace as any, summary as any),
    );
    expect(api.detail).toHaveBeenCalledTimes(1);
    expect(api.detail.mock.calls[0][0].marketplacePath).toBe(marketplace.path);
    expect(api.detail.mock.calls[0][0].summary.name).toBe("example");
    expect(api.detailError).toHaveBeenCalledWith(expect.any(Error), 7);
  },
);
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
  await waitFor(() => expect(result.current.isLoading).toBe(false));
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

test("oversized plugin catalog cannot replace the previous bounded navigation", async () => {
  const existing = [{ name: "Bounded", path: "/private/bounded", plugins: [] }];
  api.list.mockResolvedValue({
    marketplaces: existing,
    marketplaceLoadErrors: [],
  });
  const { result } = renderHook(() => usePluginsMarketplace(1));
  await act(() => result.current.loadPlugins());
  await waitFor(() => expect(result.current.marketplaces).toEqual(existing));
  api.list.mockResolvedValue({
    marketplaces: [
      {
        name: "Oversized",
        path: "/private/oversized",
        plugins: [],
        description: "x".repeat(2 * 1024 * 1024),
      },
    ],
    marketplaceLoadErrors: [],
  });
  await act(() => result.current.loadPlugins());
  expect(result.current.marketplaces.map((value) => value.name)).toEqual([
    "Bounded",
  ]);
  expect(result.current.loadError).toMatch(/预算/);
});
