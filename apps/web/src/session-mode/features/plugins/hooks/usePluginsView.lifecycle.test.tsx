import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { PluginDetail } from "@session/bindings/v2";
const api = vi.hoisted(() => ({
  read: vi.fn(),
  install: vi.fn(),
  uninstall: vi.fn(),
  perform: vi.fn(),
}));
vi.mock("@session/services", () => ({
  pluginRead: api.read,
  pluginInstall: api.install,
  pluginUninstall: api.uninstall,
  readSkillGroups: async () => ({ groups: [] }),
  writeSkillGroups: async () => {},
}));
vi.mock("../pluginOperations", () => ({ performPluginOperation: api.perform }));
vi.mock("./useExternalUrl", () => ({
  useExternalUrl: () => ({ openExternalUrl: vi.fn() }),
}));
vi.mock("@session/lib/eventStream", () => ({
  openEventStream: () => () => {},
}));
import { usePluginsView } from "./usePluginsView";
const plugin = (name: string, marketplacePath = "/market/one") =>
  ({
    marketplaceName: "Private",
    marketplacePath,
    summary: {
      id: "same-native-id",
      name,
      installed: false,
      interface: { displayName: name },
      source: { type: "local", path: "/plugin" },
    },
    apps: [],
    skills: [],
    hooks: [],
    appTemplates: [],
    mcpServers: [],
  }) as unknown as PluginDetail;
beforeEach(() => {
  localStorage.clear();
  api.read.mockReset();
  api.perform.mockReset();
  api.install.mockReset();
  api.uninstall.mockReset();
  api.read.mockImplementation(async (target) => ({
    plugin: plugin(target.pluginName, target.marketplacePath),
  }));
});
it("an older install receipt cannot replace another marketplace's selected detail", async () => {
  const first = plugin("first"),
    second = plugin("second", "/market/two");
  let finish!: (value: any) => void;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  api.install.mockReturnValue(pending);
  api.perform.mockReturnValue(pending);
  const { result } = renderHook(() => usePluginsView());
  act(() => result.current.handlePluginDetail(first));
  let installing!: ReturnType<typeof result.current.handlePluginInstall>;
  act(() => {
    installing = result.current.handlePluginInstall(first);
  });
  act(() => result.current.handlePluginDetail(second));
  await act(async () => {
    finish({
      status: "accepted",
      authPolicy: "ON_INSTALL",
      appsNeedingAuth: [],
    });
    await installing;
  });
  expect(result.current.selectedPluginDetail?.marketplacePath).toBe(
    "/market/two",
  );
  expect(result.current.selectedPluginDetail?.summary.name).toBe("second");
});
it("retains every native authentication target as explicit follow-up actions", async () => {
  const apps = [
    { id: "one", name: "First", installUrl: "https://example.invalid/one" },
    { id: "two", name: "Second", installUrl: "https://example.invalid/two" },
  ];
  api.install.mockResolvedValue({
    authPolicy: "ON_INSTALL",
    appsNeedingAuth: apps,
  });
  api.perform.mockResolvedValue({
    status: "accepted",
    authPolicy: "ON_INSTALL",
    appsNeedingAuth: apps,
  });
  const { result } = renderHook(() => usePluginsView());
  const value = plugin("example");
  act(() => result.current.handlePluginDetail(value));
  await act(() => result.current.handlePluginInstall(value));
  expect(
    (result.current as any).authentication?.apps.map((app: any) => app.id),
  ).toEqual(["one", "two"]);
});

it("a detail-read error belongs only to its original selection generation", () => {
  const { result } = renderHook(() => usePluginsView());
  let firstVersion = 0,
    secondVersion = 0;
  act(() => {
    firstVersion = result.current.handlePluginDetail(plugin("first"));
  });
  act(() => {
    secondVersion = result.current.handlePluginDetail(
      plugin("second", "/market/two"),
    );
  });
  act(() =>
    result.current.handlePluginDetailError(
      new Error("stale detail"),
      firstVersion,
    ),
  );
  expect(result.current.operationError).toBeNull();
  act(() =>
    result.current.handlePluginDetailError(
      new Error("current detail failed"),
      secondVersion,
    ),
  );
  expect(result.current.operationError).toContain("current detail failed");
  expect(result.current.selectedPluginDetail?.summary.name).toBe("second");
  act(() => result.current.handlePluginDetail(null));
  expect(result.current.operationError).toBeNull();
});
