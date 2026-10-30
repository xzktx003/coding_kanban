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
  handleInstall:vi.fn(),
  read:vi.fn(),
}));
vi.mock("@session/services/apiAdapt/codex", () => ({
  pluginInstalled: api.installed,
  pluginInstall: api.install,
  pluginList: api.list,
}));
vi.mock("@session/services/codexService", () => ({
  codexService: { listSkills: api.skills },
}));
vi.mock("@session/features/plugins/hooks", () => ({
  usePluginsViewContext: () => ({ handlePluginDetail: vi.fn(),handlePluginInstall:api.handleInstall }),
}));
vi.mock("@session/features/plugins/hooks/useExternalUrl", () => ({
  useExternalUrl: () => ({ openExternalUrl: vi.fn() }),
}));
vi.mock("@session/lib/eventStream",()=>({openEventStream:()=>()=>{}}));
vi.mock("@session/services",()=>({pluginList:api.list,pluginRead:api.read,readSkillGroups:async()=>({groups:[]}),writeSkillGroups:async()=>{}}));
vi.mock("@session/features/plugins/pluginOperations",()=>({performPluginOperation:api.install}));
import { usePluginsView } from "@session/features/plugins/hooks/usePluginsView";
import { resetGoalCompletionScope } from "@session/services/goalCompletionAutoClear";
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
  api.install.mockResolvedValue({status:"accepted",appsNeedingAuth: []});
  api.read.mockResolvedValue({plugin:{marketplaceName:"market",marketplacePath:"/catalog",summary:plugin,apps:[]}});
  useWorkspaceStore.setState({ cwd: "/A" });
});
it("successful native install refreshes the already mounted owner candidate list with typed plugin identity", async () => {
  const { result } = renderHook(() => {
    const view=usePluginsView();api.handleInstall.mockImplementation(view.handlePluginInstall);
    return {mentions:useMentionItems(),marketplace:usePluginsMarketplace()};
  });
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
it("another page's plugin change refreshes an already mounted composer without a view mount",async()=>{
 const {result}=renderHook(()=>useMentionItems());await waitFor(()=>expect(api.installed).toHaveBeenCalled());
 api.installed.mockResolvedValue({marketplaces:[{plugins:[plugin]}]});
 act(()=>window.dispatchEvent(new StorageEvent("storage",{key:"kanban.session.plugins.changed.v1",newValue:"other-page-revision"})));
 await waitFor(()=>expect(result.current.items).toHaveLength(1));
});
it("a same-value account event clears candidates and rejects the late original account result",async()=>{
 let finish!:(value:unknown)=>void;
 api.installed.mockReturnValueOnce(new Promise(resolve=>{finish=resolve;})).mockResolvedValue({marketplaces:[]});
 const {result}=renderHook(()=>useMentionItems());await waitFor(()=>expect(api.installed).toHaveBeenCalledTimes(1));
 act(()=>resetGoalCompletionScope());await waitFor(()=>expect(api.installed).toHaveBeenCalledTimes(2));
 await act(async()=>{finish({marketplaces:[{plugins:[plugin]}]});});expect(result.current.items).toEqual([]);
});
