import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { NewAgentButton } from "./NewAgentButton";
import { useAcpStore } from "@session/stores/useAcpStore";
import { useWorkspaceStore } from "@session/stores/useWorkspaceStore";
import { useLayoutStore } from "@session/stores";
import { buildUrl } from "@session/hooks/runtime";
import { useAcpRuntimeOwnersStore } from "@session/services/acpRuntimeOwners";
const api = vi.hoisted(() => ({
  cancel: vi.fn(),
  newSession: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
}));
vi.mock("@session/services/apiAdapt/acp", () => ({
  acpCancel: api.cancel,
  acpNewSession: api.newSession,
  acpStart: api.start,
  acpStop: api.stop,
  acpReadConnectionSnapshot: vi.fn(),
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
const created = () => ({
  connectionId: "new-connection",
  runtimeInstance: "runtime",
  sessionId: "s1",
  historySessionId: "source-new",
  session: { sessionId: "s1", historySessionId: "source-new" },
  initialize: { agentInfo: { title: "fixture" } },
  sessionError: null,
});
beforeEach(() => {
  vi.clearAllMocks();
  api.start.mockResolvedValue(created());
  api.newSession.mockResolvedValue({
    sessionId: "new-session",
    historySessionId: "source-new",
  });
  api.stop.mockResolvedValue(undefined);
  useLayoutStore.setState({ view: "agent" });
  useWorkspaceStore.setState({ cwd: "/fixture/project" });
  useAcpStore.getState().reset();
  useAcpRuntimeOwnersStore.setState({ owners: {} });
  useAcpStore.setState({
    active: true,
    agentId: "fixture",
    connectionId: "fixture-connection",
    runtimeInstance: "runtime",
    connectionEndpoint: buildUrl("/api/acp/connection-snapshot"),
    sessionId: "s1",
    historySessionId: "source-old",
    sessionCwd: "/fixture/project",
    running: true,
  });
});
test("new ACP chat opens an independent connection without an interruption dialog or stopping the original task", async () => {
  render(<NewAgentButton />);
  fireEvent.click(screen.getByRole("button", { name: /newChat/ }));
  await waitFor(() =>
    expect(api.start).toHaveBeenCalledExactlyOnceWith(
      "fixture",
      "/fixture/project",
    ),
  );
  await waitFor(() =>
    expect(useAcpStore.getState().connectionId).toBe("new-connection"),
  );
  expect(api.cancel).not.toHaveBeenCalled();
  expect(api.stop).not.toHaveBeenCalled();
  expect(api.newSession).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(Object.values(useAcpRuntimeOwnersStore.getState().owners)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        connectionId: "fixture-connection",
        running: true,
      }),
    ]),
  );
});
test("failed new connection preserves the running target and never restarts it", async () => {
  api.start.mockRejectedValueOnce(new Error("fixture start failed"));
  render(<NewAgentButton />);
  fireEvent.click(screen.getByRole("button", { name: /newChat/ }));
  await waitFor(() => expect(api.start).toHaveBeenCalledOnce());
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: /newChat/ }).hasAttribute("disabled"),
    ).toBe(false),
  );
  expect(useAcpStore.getState()).toMatchObject({
    connectionId: "fixture-connection",
    sessionId: "s1",
    running: true,
  });
  expect(api.cancel).not.toHaveBeenCalled();
  expect(api.stop).not.toHaveBeenCalled();
  expect(api.newSession).not.toHaveBeenCalled();
});
test("repeated new chat clicks coalesce into one connection and keep the current task while waiting", async () => {
  let resolve!: (value: ReturnType<typeof created>) => void;
  api.start.mockReturnValueOnce(new Promise((done) => (resolve = done)));
  render(<NewAgentButton />);
  const button = screen.getByRole("button", { name: /newChat/ });
  fireEvent.click(button);
  fireEvent.click(button);
  await waitFor(() => expect(api.start).toHaveBeenCalledOnce());
  expect(button.hasAttribute("disabled")).toBe(true);
  expect(useAcpStore.getState().running).toBe(true);
  await act(async () => resolve(created()));
  expect(api.start).toHaveBeenCalledOnce();
  expect(button.hasAttribute("disabled")).toBe(false);
  expect(api.cancel).not.toHaveBeenCalled();
});
test("idle new chat reuses its verified process without stopping or asking to interrupt", async () => {
  useAcpStore.setState({ running: false });
  render(<NewAgentButton />);
  fireEvent.click(screen.getByRole("button", { name: /newChat/ }));
  await waitFor(() =>
    expect(api.newSession).toHaveBeenCalledExactlyOnceWith(
      "fixture-connection",
      "/fixture/project",
    ),
  );
  expect(api.start).not.toHaveBeenCalled();
  expect(api.cancel).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog")).toBeNull();
});
