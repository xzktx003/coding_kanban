import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
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

// Deliberately red until the user approves the interruption-confirmation flow.
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
