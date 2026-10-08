import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { NewAgentButton } from "./NewAgentButton";
import { useAcpStore } from "@session/stores/useAcpStore";
import { useWorkspaceStore } from "@session/stores/useWorkspaceStore";
import { useLayoutStore } from "@session/stores";

const api = vi.hoisted(() => ({
  cancel: vi.fn().mockResolvedValue(undefined),
  newSession: vi.fn().mockResolvedValue({ sessionId: "new-fixture-session" }),
  stop: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@session/services/apiAdapt/acp", () => ({
  acpCancel: api.cancel,
  acpNewSession: api.newSession,
  acpStop: api.stop,
}));
vi.mock("@session/components/codex/hooks", () => ({
  useNewThread: () => ({ handleNewThread: vi.fn() }),
}));
vi.mock("@session/hooks/useCCSessionManager", () => ({
  useCCSessionManager: () => ({ handleNewSession: vi.fn() }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  useLayoutStore.setState({ view: "agent" });
  useWorkspaceStore.setState({ cwd: "/fixture/project" });
  useAcpStore.setState({
    active: true,
    agentId: "fixture-agent",
    connectionId: "fixture-connection",
    sessionId: "running-fixture-session",
    running: true,
  });
});

// Task interruption requires a deliberate user action.
test("new ACP chat does not cancel a running task before explicit confirmation", async () => {
  useLayoutStore.setState({ view: "agent" });
  useWorkspaceStore.setState({ cwd: "/fixture/project" });
  useAcpStore.setState({
    active: true,
    agentId: "fixture-agent",
    connectionId: "fixture-connection",
    sessionId: "running-fixture-session",
    running: true,
  });
  render(<NewAgentButton />);
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: /newChat/ })),
  );
  expect(api.cancel).not.toHaveBeenCalled();
  expect(api.newSession).not.toHaveBeenCalled();
  expect(api.stop).not.toHaveBeenCalled();
  expect(useAcpStore.getState().sessionId).toBe("running-fixture-session");
  expect(useAcpStore.getState().running).toBe(true);
});

test("cancel preserves the running ACP chat", async () => {
  render(<NewAgentButton />);
  fireEvent.click(screen.getByRole("button", { name: /newChat/ }));
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "取消" })),
  );
  expect(api.cancel).not.toHaveBeenCalled();
  expect(api.newSession).not.toHaveBeenCalled();
  expect(useAcpStore.getState().sessionId).toBe("running-fixture-session");
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("confirmation interrupts the owned task and starts the new session", async () => {
  render(<NewAgentButton />);
  fireEvent.click(screen.getByRole("button", { name: /newChat/ }));
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "中断并新建" })),
  );
  expect(api.cancel).toHaveBeenCalledExactlyOnceWith(
    "fixture-connection",
    "running-fixture-session",
  );
  expect(api.newSession).toHaveBeenCalledExactlyOnceWith(
    "fixture-connection",
    "/fixture/project",
  );
  expect(api.stop).not.toHaveBeenCalled();
  expect(useAcpStore.getState().sessionId).toBe("new-fixture-session");
  expect(useAcpStore.getState().running).toBe(false);
});

test("confirmation for an old task does not interrupt a newly selected session", async () => {
  render(<NewAgentButton />);
  fireEvent.click(screen.getByRole("button", { name: /newChat/ }));
  act(() => useAcpStore.setState({ sessionId: "another-session" }));
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "中断并新建" })),
  );
  expect(api.cancel).not.toHaveBeenCalled();
  expect(api.newSession).not.toHaveBeenCalled();
  expect(useAcpStore.getState().sessionId).toBe("another-session");
});
