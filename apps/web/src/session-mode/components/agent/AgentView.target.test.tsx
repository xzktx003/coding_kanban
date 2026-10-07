import { act, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import AgentView from "./AgentView";
import { useAcpStore } from "@session/stores/useAcpStore";
import { useAgentCenterStore } from "@session/stores/useAgentCenterStore";
vi.mock("./AgentViewHeader", () => ({ AgentViewHeader: () => null }));
vi.mock("./AgentComposer", () => ({
  AgentComposer: () => <input aria-label="当前Agent输入" />,
}));
vi.mock("./AgentCard", () => ({ AgentCard: () => <div>旧Codex卡片</div> }));
vi.mock("@session/components/acp/AcpSession", () => ({
  default: () => <div>当前ACP历史</div>,
}));
vi.mock("@session/stores/cc", () => ({
  useCCStore: () => ({ activeSessionId: null }),
}));
vi.mock("@session/components/codex/thread/CodexThread", () => ({
  CodexThread: () => null,
}));
vi.mock("@session/SessionWelcome", () => ({ SessionWelcome: () => null }));
test.each(["grid", "list"] as const)(
  "ACP transcript matches its composer while retaining %s preference",
  async (mode) => {
    const cards = [
      {
        kind: "codex" as const,
        id: "old-codex",
        preview: "旧卡片",
        cwd: "/fixture",
      },
    ];
    useAgentCenterStore.setState({
      cards,
      cardsViewMode: mode,
      currentAgentCardId: "old-codex",
    });
    useAcpStore.setState({
      active: true,
      connectionId: "fixture-connection",
      sessionId: "fixture-session",
    });
    render(<AgentView />);
    expect(await screen.findByText("当前ACP历史")).toBeTruthy();
    expect(screen.queryByText("旧Codex卡片")).toBeNull();
    expect(useAgentCenterStore.getState().cardsViewMode).toBe(mode);
    expect(useAgentCenterStore.getState().cards).toEqual(cards);
    act(() => useAcpStore.setState({ active: false }));
    expect(await screen.findByText("旧Codex卡片")).toBeTruthy();
  },
);
