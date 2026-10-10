import { render } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useAcpStore } from "@session/stores/useAcpStore";
import { useAgentCenterStore } from "@session/stores/useAgentCenterStore";
import { useAgentSettingsStore } from "@session/stores/useAgentSettingsStore";
import { useCCStore } from "@session/stores/cc";
import { AgentComposer } from "./AgentComposer";

const policy = vi.hoisted(() => ({ visible: true, coarse: false }));
vi.mock("@session/session-dom", () => ({
  useAgentInteractionVisible: () => policy.visible,
}));
vi.mock("@session/components/acp/AcpComposer", () => ({
  AcpComposer: () => null,
}));
vi.mock("@session/components/cc/composer", () => ({
  Composer: () => <textarea aria-label="Claude composer" />,
}));
vi.mock("@session/components/codex/composer", () => ({
  Composer: () => <div contentEditable />,
}));
vi.mock("../common", () => ({ WorkspaceSwitcher: () => null }));
vi.mock("../../hooks/useActiveSessionProject", () => ({
  useActiveSessionProject: () => ({ path: "/fixture", label: "fixture" }),
}));

beforeEach(() => {
  vi.restoreAllMocks();
  policy.visible = true;
  policy.coarse = false;
  vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
    matches: query === "(pointer: coarse)" && policy.coarse,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
  }));
  useAcpStore.setState({ active: false });
  useCCStore.setState({ activeSessionId: "focus-claude" });
  useAgentSettingsStore.setState({ selectedAgent: "cc" });
  useAgentCenterStore.setState({
    cards: [{ kind: "cc", id: "focus-claude", cwd: "/fixture" }],
    currentAgentCardId: "focus-claude",
    currentAgentCardKind: "cc",
    detachedCard: null,
  });
});

for (const setting of [
  { coarse: true, visible: true, requests: 0, name: "touch navigation" },
  { coarse: false, visible: true, requests: 1, name: "desktop navigation" },
  { coarse: false, visible: false, requests: 0, name: "hidden Session mode" },
] as const) {
  it(`keeps passive Claude focus policy for ${setting.name}`, () => {
    policy.coarse = setting.coarse;
    policy.visible = setting.visible;
    const dispatch = vi.spyOn(window, "dispatchEvent");
    render(<AgentComposer />);
    expect(
      dispatch.mock.calls.filter(
        ([event]) => event.type === "cc-input-focus-request",
      ),
    ).toHaveLength(setting.requests);
  });
}
