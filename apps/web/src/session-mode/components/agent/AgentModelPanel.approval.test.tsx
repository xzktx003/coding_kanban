import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { AgentModelPanel } from "./AgentModelPanel";
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
    { id: "old-agent", name: "当前 Agent" },
    { id: "new-agent", name: "新的 Agent" },
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

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
  useAcpStore.setState({
    active: true,
    agentId: "old-agent",
    connectionId: "old-fixture-connection",
    sessionId: "old-fixture-session",
    running: true,
  });
});

async function requestAgentChange() {
  render(<AgentModelPanel trigger={<button>选择 Agent</button>} />);
  fireEvent.click(screen.getByRole("button", { name: "选择 Agent" }));
  await act(async () =>
    fireEvent.click(await screen.findByRole("option", { name: "新的 Agent" })),
  );
}

// An Agent service is stopped only after explicit confirmation.
test("selecting another ACP Agent cannot implicitly stop the current process", async () => {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
  useAcpStore.setState({
    active: true,
    agentId: "old-agent",
    connectionId: "old-fixture-connection",
    sessionId: "old-fixture-session",
    running: true,
  });
  render(<AgentModelPanel trigger={<button>选择 Agent</button>} />);
  fireEvent.click(screen.getByRole("button", { name: "选择 Agent" }));
  await act(async () =>
    fireEvent.click(await screen.findByRole("option", { name: "新的 Agent" })),
  );
  expect(api.stop).not.toHaveBeenCalled();
  expect(useAcpStore.getState().agentId).toBe("old-agent");
  expect(useAcpStore.getState().connectionId).toBe("old-fixture-connection");
});

test("cancel keeps the original Agent service and session", async () => {
  await requestAgentChange();
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "取消" })),
  );
  expect(api.stop).not.toHaveBeenCalled();
  expect(useAcpStore.getState().agentId).toBe("old-agent");
  expect(useAcpStore.getState().sessionId).toBe("old-fixture-session");
});

test("confirmation stops exactly the old connection and selects the new Agent", async () => {
  await requestAgentChange();
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "关闭服务并切换" })),
  );
  expect(api.stop).toHaveBeenCalledExactlyOnceWith("old-fixture-connection");
  expect(useAcpStore.getState().agentId).toBe("new-agent");
  expect(useAcpStore.getState().active).toBe(true);
  expect(useAcpStore.getState().connectionId).toBeNull();
});

test("an obsolete confirmation cannot stop a newly selected session", async () => {
  await requestAgentChange();
  act(() => useAcpStore.setState({ sessionId: "another-session" }));
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "关闭服务并切换" })),
  );
  expect(api.stop).not.toHaveBeenCalled();
  expect(useAcpStore.getState().sessionId).toBe("another-session");
  expect(useAcpStore.getState().agentId).toBe("old-agent");
});
