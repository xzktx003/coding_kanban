import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type {
  PluginDetail,
  PluginMarketplaceEntry,
  PluginSummary,
} from "@session/bindings/v2";
import { usePluginsMarketplace } from "./usePluginsMarketplace";
import { usePluginsView } from "./usePluginsView";

const calls = vi.hoisted(() => ({
  notice: vi.fn(),
  error: vi.fn(),
  install: vi.fn(),
  read: vi.fn(),
  compact: false,
}));
vi.mock("sonner", () => ({
  toast: Object.assign(calls.notice, { error: calls.error, dismiss: vi.fn() }),
}));
vi.mock("@session/services", () => ({
  pluginList: vi.fn(async () => ({
    marketplaces: [],
    marketplaceLoadErrors: [],
  })),
  pluginInstall: calls.install,
  pluginRead: calls.read,
  pluginUninstall: vi.fn(),
  readSkillGroups: vi.fn(async () => ({ groups: [] })),
}));
vi.mock("../hooks", () => ({
  usePluginsViewContext: () => ({ handlePluginDetail: vi.fn() }),
}));
vi.mock("./useExternalUrl", () => ({
  useExternalUrl: () => ({ openExternalUrl: vi.fn() }),
}));

const summary = {
  id: "fixture",
  name: "fixture",
  interface: { displayName: "Fixture Plugin" },
} as PluginSummary;
const marketplace = {
  name: "Fixture",
  path: "/fixture/plugins",
  plugins: [summary],
} as PluginMarketplaceEntry;
const detail = {
  marketplaceName: "Fixture",
  marketplacePath: "/fixture/plugins",
  summary,
} as PluginDetail;

beforeEach(() => {
  calls.notice.mockClear();
  calls.error.mockClear();
  calls.install.mockReset().mockResolvedValue({ appsNeedingAuth: [] });
  calls.read.mockResolvedValue({ plugin: detail });
  calls.compact = false;
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: calls.compact,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
});

for (const surface of ["marketplace", "detail"] as const) {
  for (const compact of [false, true])
    it(`${surface} installation notice has its own class and current ${compact ? "compact" : "desktop"} position`, async () => {
      const { result } = renderHook(() => {
        const catalog = usePluginsMarketplace();
        const view = usePluginsView();
        return surface === "marketplace"
          ? () => catalog.handleInstall(marketplace, summary)
          : () => view.handlePluginInstall(detail);
      });
      // Resolve the current viewport independently of the hook's mount.
      calls.compact = compact;
      await act(() => result.current());
      expect(calls.notice).toHaveBeenCalledWith(
        "Plugin installed",
        expect.objectContaining({
          description: "Fixture Plugin is ready in the composer.",
          className: "session-plugin-notice",
          position: compact ? "bottom-center" : "top-right",
        }),
      );
      expect(calls.error).not.toHaveBeenCalled();
    });

  it(`${surface} install failure retains diagnostic text and the same scoped notice options`, async () => {
    const { result } = renderHook(() => {
      const catalog = usePluginsMarketplace();
      const view = usePluginsView();
      return surface === "marketplace"
        ? () => catalog.handleInstall(marketplace, summary)
        : () => view.handlePluginInstall(detail);
    });
    calls.compact = true;
    calls.install.mockRejectedValue(new Error("fixture install failed"));
    await act(() => result.current());
    expect(calls.error).toHaveBeenCalledWith(
      "Install failed",
      expect.objectContaining({
        description: "fixture install failed",
        className: "session-plugin-notice",
        position: "bottom-center",
      }),
    );
  });
}
