import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { AgentModelPanel } from "./AgentModelPanel";
import { AgentSelector } from "./AgentSelector";
import { AgentBadge } from "./AgentBadge";
import { ThemeProvider } from "@session/contexts/ThemeContext";
import { useAcpStore } from "@session/stores/useAcpStore";

const scrollDescriptor = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "scrollIntoView",
);
afterEach(() => {
  if (scrollDescriptor)
    Object.defineProperty(
      HTMLElement.prototype,
      "scrollIntoView",
      scrollDescriptor,
    );
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
});

const api = vi.hoisted(() => ({ stop: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@session/services/apiAdapt/acp", () => ({ acpStop: api.stop }));
vi.mock("@session/components/acp/useAcpAgents", () => ({
  useAcpAgents: () => [
    {
      id: "old-agent",
      name: "当前 Agent",
      command: "fixture",
      args: [],
      available: true,
    },
    {
      id: "new-agent",
      name: "新的 Agent",
      command: "fixture",
      args: [],
      available: true,
    },
  ],
}));
vi.mock("@session/components/acp/AcpModelMenu", () => ({
  AcpModelMenu: () => null,
}));
vi.mock("@session/components/cc/composer/ModelSelector", () => ({
  ModelSelector: () => null,
}));
vi.mock("@session/components/codex/composer/ModelReasonSelector", () => ({
  ModelReasonSelector: () => null,
}));

import {
  useAcpRuntimeOwnersStore,
  rememberCurrentAcpOwner,
} from "@session/services/acpRuntimeOwners";
import { buildUrl } from "@session/hooks/runtime";
import { chooseAcpAgent } from "@session/services/acpAgentChoice";
beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  useAcpStore.getState().reset();
  useAcpRuntimeOwnersStore.setState({ owners: {} });
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
  useAcpStore.setState({
    active: true,
    agentId: "old-agent",
    agentTitle: "当前 Agent",
    connectionId: "old-fixture-connection",
    runtimeInstance: "fixture-runtime",
    connectionEndpoint: buildUrl("/api/acp/connection-snapshot"),
    sessionId: "old-fixture-session",
    sessionCwd: "/fixture",
    running: true,
  });
});
for (const [label, Component] of [
  ["model panel", null],
  ["selector", AgentSelector],
  ["badge", AgentBadge],
] as const) {
  test(`${label} navigates to another ACP Agent while preserving the original running owner without a stop`, async () => {
    render(
      <ThemeProvider>
        {Component ? (
          <Component />
        ) : (
          <AgentModelPanel trigger={<button>选择 Agent</button>} />
        )}
      </ThemeProvider>,
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: Component ? /当前 Agent/ : "选择 Agent",
      }),
    );
    await act(async () =>
      fireEvent.click(
        await screen.findByRole("option", { name: /新的 Agent/ }),
      ),
    );
    expect(api.stop).not.toHaveBeenCalled();
    expect(useAcpStore.getState()).toMatchObject({
      active: true,
      agentId: "new-agent",
      connectionId: null,
    });
    expect(Object.values(useAcpRuntimeOwnersStore.getState().owners)).toEqual([
      expect.objectContaining({
        agentId: "old-agent",
        connectionId: "old-fixture-connection",
        running: true,
      }),
    ]);
    expect(screen.queryByRole("button", { name: "关闭服务并切换" })).toBeNull();
  });
}
test("returning to a known Agent installs a readonly recovery barrier for the exact saved owner", async () => {
  const old = rememberCurrentAcpOwner()!;
  useAcpStore.setState({
    agentId: "new-agent",
    agentTitle: "新的 Agent",
    connectionId: "new-connection",
    sessionId: "new-session",
    running: false,
  });
  const ask = vi.fn();
  await chooseAcpAgent("old-agent", ask);
  expect(ask).not.toHaveBeenCalled();
  expect(api.stop).not.toHaveBeenCalled();
  expect(useAcpStore.getState()).toMatchObject({
    agentId: "old-agent",
    connectionId: null,
    connectionRecovery: "recovering",
  });
  expect(useAcpRuntimeOwnersStore.getState().owners[old.key].running).toBe(
    true,
  );
});
test("an unverifiable old runtime cannot be silently discarded to navigate elsewhere", async () => {
  useAcpStore.setState({ runtimeInstance: null });
  await expect(chooseAcpAgent("new-agent", vi.fn())).rejects.toThrow(
    /缺少可核验运行身份/,
  );
  expect(useAcpStore.getState()).toMatchObject({
    agentId: "old-agent",
    connectionId: "old-fixture-connection",
    running: true,
  });
  expect(api.stop).not.toHaveBeenCalled();
});
