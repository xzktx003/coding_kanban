import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { usePluginsMarketplace } from "./usePluginsMarketplace";
import { usePluginsView } from "./usePluginsView";
import { useAgentCenterStore } from "@session/stores/useAgentCenterStore";
import { useAgentSettingsStore } from "@session/stores/useAgentSettingsStore";
import { useAcpStore } from "@session/stores/useAcpStore";
import { useCodexStore } from "@session/components/codex/stores/useCodexStore";
import { useLayoutStore } from "@session/stores/useLayoutStore";
import { useWorkspaceStore } from "@session/stores/useWorkspaceStore";
import {
  readDraft,
  sessionDraftKey,
  useSessionDraftStore,
} from "@session/stores/useSessionDraftStore";
import {
  cancelSessionNavigation,
  confirmSessionNavigation,
  registerSessionLeaveGuard,
  useSessionNavigationGuard,
} from "@session/services/sessionNavigationGuard";
import type { PluginSummary } from "@session/bindings/v2/PluginSummary";
vi.mock("@session/services", () => ({
  pluginList: vi.fn(async () => ({
    marketplaces: [],
    marketplaceLoadErrors: [],
  })),
  readSkillGroups: vi.fn(async () => ({ groups: [] })),
}));
vi.mock("../hooks", () => ({
  usePluginsViewContext: () => ({ handlePluginDetail: vi.fn() }),
}));
vi.mock("./useExternalUrl", () => ({
  useExternalUrl: () => ({ openExternalUrl: vi.fn() }),
}));
vi.mock("@session/services/codexService", () => ({
  codexService: { setCurrentThread: vi.fn(async () => {}) },
}));
vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 0);
const plugin = {
  id: "fixture-native@market",
  name: "fixture-native@market",
  interface: { displayName: "Fixture Name" },
} as PluginSummary;
let unregister: (() => void) | undefined;
beforeEach(() => {
  useAcpStore.setState({ active: false });
  useAgentSettingsStore.setState({ selectedAgent: "cc" });
  useAgentCenterStore.setState({
    cards: [
      { kind: "codex", id: "try-codex", cwd: "/original" },
      { kind: "cc", id: "try-claude", cwd: "/other" },
    ],
    currentAgentCardId: "try-claude",
    currentAgentCardKind: "cc",
  });
  useCodexStore.setState({
    currentThreadId: "try-codex",
    threads: [{ id: "try-codex", cwd: "/original" } as never],
    historyLoadedMap: { "try-codex": true },
    events: { "try-codex": [] },
  });
  useWorkspaceStore.setState({ cwd: "/other" });
  useLayoutStore.setState({ view: "plugins" });
  useSessionDraftStore.setState({ drafts: {} });
  useSessionDraftStore
    .getState()
    .setText(sessionDraftKey("codex", "try-codex"), "Original Codex");
  useSessionDraftStore
    .getState()
    .setText(sessionDraftKey("cc", "try-claude"), "Original Claude");
  useSessionNavigationGuard.setState({
    pending: null,
    dirty: false,
    saving: false,
  });
});
afterEach(() => {
  unregister?.();
  unregister = undefined;
  cancelSessionNavigation();
});
for (const variant of ["marketplace", "detail"] as const) {
  it(`${variant} Try now cancellation preserves input, project and both drafts`, () => {
    const { result } = renderHook(() => {
      const marketplace = usePluginsMarketplace();
      const detail = usePluginsView();
      return variant === "marketplace"
        ? marketplace.handleUsePlugin
        : (summary: PluginSummary) =>
            detail.handleUsePlugin({ summary } as never);
    });
    unregister = registerSessionLeaveGuard(() => ({
      dirty: true,
      saving: false,
    }));
    act(() => result.current(plugin));
    expect(useSessionNavigationGuard.getState().pending).not.toBeNull();
    expect(useAgentCenterStore.getState().currentAgentCardId).toBe(
      "try-claude",
    );
    expect(useWorkspaceStore.getState().cwd).toBe("/other");
    act(() => cancelSessionNavigation());
    expect(useLayoutStore.getState().view).toBe("plugins");
    expect(readDraft(sessionDraftKey("codex", "try-codex")).text).toBe(
      "Original Codex",
    );
    expect(readDraft(sessionDraftKey("cc", "try-claude")).text).toBe(
      "Original Claude",
    );
  });
  it(`${variant} Try now commits target and captured token once after confirmation`, () => {
    const { result } = renderHook(() => {
      const marketplace = usePluginsMarketplace();
      const detail = usePluginsView();
      return variant === "marketplace"
        ? marketplace.handleUsePlugin
        : (summary: PluginSummary) =>
            detail.handleUsePlugin({ summary } as never);
    });
    unregister = registerSessionLeaveGuard(() => ({
      dirty: true,
      saving: false,
    }));
    act(() => result.current(plugin));
    act(() => confirmSessionNavigation());
    act(() => confirmSessionNavigation());
    expect(useLayoutStore.getState().view).toBe("agent");
    expect(useAgentCenterStore.getState().currentAgentCardId).toBe("try-codex");
    expect(
      readDraft(sessionDraftKey("codex", "try-codex")).text.match(
        /Fixture Name/g,
      ),
    ).toHaveLength(1);
    expect(readDraft(sessionDraftKey("cc", "try-claude")).text).toBe(
      "Original Claude",
    );
  });
  it(`${variant} pending Try now cannot append to another input selected before confirmation`, () => {
    const { result } = renderHook(() => {
      const marketplace = usePluginsMarketplace();
      const detail = usePluginsView();
      return variant === "marketplace"
        ? marketplace.handleUsePlugin
        : (summary: PluginSummary) =>
            detail.handleUsePlugin({ summary } as never);
    });
    unregister = registerSessionLeaveGuard(() => ({
      dirty: true,
      saving: false,
    }));
    act(() => result.current(plugin));
    act(() => useWorkspaceStore.setState({ cwd: "/new-project" }));
    act(() => confirmSessionNavigation());
    expect(readDraft(sessionDraftKey("codex", "try-codex")).text).toBe(
      "Original Codex",
    );
    expect(readDraft(sessionDraftKey("cc", "try-claude")).text).toBe(
      "Original Claude",
    );
    expect(useWorkspaceStore.getState().cwd).toBe("/new-project");
  });
}
