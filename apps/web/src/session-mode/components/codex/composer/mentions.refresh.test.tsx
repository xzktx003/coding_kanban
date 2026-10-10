import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useMentionItems } from "./mentions";
import { usePluginsMarketplace } from "@session/features/plugins/hooks/usePluginsMarketplace";
import { useWorkspaceStore } from "@session/stores/useWorkspaceStore";
const api = vi.hoisted(() => ({
  installed: vi.fn(),
  skills: vi.fn(),
  install: vi.fn(),
  list: vi.fn(),
}));
vi.mock("@session/services", () => ({
  pluginInstalled: api.installed,
  pluginInstall: api.install,
  pluginList: api.list,
}));
vi.mock("@session/services/codexService", () => ({
  codexService: { listSkills: api.skills },
}));
vi.mock("@session/features/plugins/hooks", () => ({
  usePluginsViewContext: () => ({ handlePluginDetail: vi.fn() }),
}));
vi.mock("@session/features/plugins/hooks/useExternalUrl", () => ({
  useExternalUrl: () => ({ openExternalUrl: vi.fn() }),
}));
const plugin = {
  id: "fixture-native@market",
  name: "fixture-native@market",
  installed: true,
  enabled: true,
  keywords: [],
  interface: { displayName: "Fixture Name" },
};
beforeEach(() => {
  api.installed.mockReset();
  api.skills.mockReset();
  api.install.mockReset();
  api.list.mockReset();
  api.skills.mockResolvedValue([]);
  api.installed.mockResolvedValue({ marketplaces: [] });
  api.list.mockResolvedValue({ marketplaces: [], marketplaceLoadErrors: [] });
  api.install.mockResolvedValue({ appsNeedingAuth: [] });
  useWorkspaceStore.setState({ cwd: "/A" });
});
it("successful native install refreshes the already mounted owner candidate list with typed plugin identity", async () => {
  const { result } = renderHook(() => ({
    mentions: useMentionItems(),
    marketplace: usePluginsMarketplace(),
  }));
  await waitFor(() => expect(api.installed).toHaveBeenCalledTimes(1));
  api.installed.mockResolvedValue({ marketplaces: [{ plugins: [plugin] }] });
  await act(() =>
    result.current.marketplace.handleInstall(
      { name: "market", path: "/catalog", plugins: [plugin] } as never,
      plugin as never,
    ),
  );
  await waitFor(() => expect(result.current.mentions.items).toHaveLength(1));
  expect(result.current.mentions.items[0]).toMatchObject({
    insertText: "@Fixture Name",
    inputMention: {
      name: "Fixture Name",
      path: "plugin://fixture-native@market",
    },
  });
});
it("late A candidate response cannot replace the current B workspace after refresh", async () => {
  let resolveA!: (value: unknown) => void;
  api.installed
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveA = resolve;
        }),
    )
    .mockResolvedValue({ marketplaces: [] });
  const { result } = renderHook(() => useMentionItems());
  await waitFor(() => expect(api.installed).toHaveBeenCalledTimes(1));
  act(() => useWorkspaceStore.setState({ cwd: "/B" }));
  await waitFor(() => expect(api.installed).toHaveBeenCalledTimes(2));
  await act(async () => resolveA({ marketplaces: [{ plugins: [plugin] }] }));
  expect(result.current.items).toEqual([]);
});
