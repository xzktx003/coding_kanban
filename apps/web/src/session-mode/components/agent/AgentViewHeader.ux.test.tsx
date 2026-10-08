import * as runtime from "../../hooks/runtime";
import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { AgentViewHeader } from "./AgentViewHeader";
import { useAgentCenterStore } from "../../stores/useAgentCenterStore";
import { useAcpStore } from "../../stores/useAcpStore";
import { useWorkspaceStore } from "../../stores/useWorkspaceStore";
beforeEach(() => {
  useAcpStore.setState({ active: false });
  useAgentCenterStore.setState({ cards: [], cardsViewMode: "solo" });
});
it.each(["solo", "grid", "list"] as const)(
  "does not create a separate project/tool row in %s",
  (mode) => {
    useAgentCenterStore.setState({ cardsViewMode: mode });
    const { container } = render(<AgentViewHeader />);
    expect(container.textContent).toBe("");
    expect(container.querySelector(".session-agent-header")).toBeNull();
  },
);
it("keeps ACP identity local while retaining the saved card layout", () => {
  useAcpStore.setState({
    active: true,
    agentId: "fixture-agent",
    sessionId: null,
    agentTitle: "ACP 会话",
  });
  useWorkspaceStore.setState({ cwd: "/fixture/acp-project" });
  useAgentCenterStore.setState({ cardsViewMode: "grid" });
  render(<AgentViewHeader />);
  expect(screen.getByText("ACP 会话")).toBeTruthy();
  expect(screen.getByText("acp-project")).toBeTruthy();
  expect(useAgentCenterStore.getState().cardsViewMode).toBe("grid");
});

it('leaves the native phone header to its existing shell', () => {
  const phone = vi.spyOn(runtime, 'isPhone').mockReturnValue(true);
  useAcpStore.setState({active:true,agentId:'fixture-agent'});
  const {container}=render(<AgentViewHeader/>);
  expect(container.textContent).toBe('');
  phone.mockRestore();
});
