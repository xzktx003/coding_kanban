import {
  act,
  renderHook,
  render,
  fireEvent,
  screen,
} from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { useWorkspaceStore } from "@session/stores/useWorkspaceStore";
import { useAcpStore } from "@session/stores/useAcpStore";
import type { AcpSessionRecord } from "@session/services/apiAdapt/acp";
import { useAcpSessions } from "./useAcpSessions";

const api = vi.hoisted(() => ({
  load: vi.fn(),
  start: vi.fn(),
  list: vi.fn().mockResolvedValue([]),
  cancel: vi.fn().mockResolvedValue(undefined),
  remove: vi.fn(),
  fresh: vi.fn(),
}));
vi.mock("@session/services/apiAdapt/acp", () => ({
  acpListSessions: api.list,
  acpLoadSession: api.load,
  acpStart: api.start,
  acpNewSession: vi.fn(),
  acpGetSession: vi.fn(),
  acpDeleteSession: api.remove,
  acpCancel: api.cancel,
  acpStop: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./newSession", () => ({ acpFreshSession: api.fresh }));
vi.mock("./applyUpdate", () => ({ applyAcpUpdate: vi.fn() }));
vi.mock("@session/components/ui/use-toast", () => ({ toast: vi.fn() }));

const record = (sessionId: string, cwd: string): AcpSessionRecord => ({
  sessionId,
  cwd,
  agentId: "fixture-agent",
  agentTitle: "Fixture Agent",
  title: sessionId,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
});
beforeEach(() => {
  api.load.mockReset();
  api.remove.mockReset().mockResolvedValue(undefined);
  api.fresh.mockReset();
  api.start.mockReset();
  api.cancel.mockReset().mockResolvedValue(undefined);
  useAcpStore.getState().reset();
  useAcpStore.setState({
    active: true,
    agentId: "fixture-agent",
    connectionId: "fixture-connection",
    sessionId: "initial",
    canLoadSession: true,
    running: false,
  });
});

// Late replies must retain the current project and session selection.
// Two project hook instances share the real ACP store; all RPCs are mocked.
test("a late history response cannot replace the newer selection from another project", async () => {
  let resolveOld!: (value: { sessionId: string }) => void;
  let resolveNew!: (value: { sessionId: string }) => void;
  const oldReply = new Promise((resolve) => (resolveOld = resolve));
  const newReply = new Promise((resolve) => (resolveNew = resolve));
  api.load.mockReturnValueOnce(oldReply).mockReturnValueOnce(newReply);
  useAcpStore.setState({
    active: true,
    agentId: "fixture-agent",
    connectionId: "fixture-connection",
    sessionId: "initial",
    canLoadSession: true,
    entries: [],
  });
  const oldProject = renderHook(() => useAcpSessions("/fixture/old-project"));
  const newProject = renderHook(() => useAcpSessions("/fixture/new-project"));
  let oldOpen!: Promise<void>;
  let newOpen!: Promise<void>;
  act(() => {
    oldOpen = oldProject.result.current.open(
      record("old-history", "/fixture/old-project"),
    );
  });
  await act(async () => {});
  expect(api.load).toHaveBeenCalledTimes(1);
  act(() => {
    newOpen = newProject.result.current.open(
      record("new-history", "/fixture/new-project"),
    );
  });
  // Native loads mutate the connection context: filtering only the final UI
  // response is insufficient. The second load must wait for the first.
  expect(api.load).toHaveBeenCalledTimes(1);
  await act(async () => {
    resolveOld({ sessionId: "old-history" });
    await oldOpen;
  });
  expect(api.load).toHaveBeenCalledTimes(2);
  await act(async () => {
    resolveNew({ sessionId: "new-history" });
    await Promise.all([oldOpen, newOpen]);
  });
  expect(useAcpStore.getState().sessionId).toBe("new-history");
  expect(api.start).not.toHaveBeenCalled();
});

function RunningHistory() {
  const { open, confirmation } = useAcpSessions("/fixture/project");
  return (
    <>
      <button onClick={() => void open(record("history", "/fixture/project"))}>
        恢复历史
      </button>
      {confirmation}
    </>
  );
}

test("opening history cannot abandon a running task without explicit interruption", async () => {
  useAcpStore.setState({ running: true });
  render(<RunningHistory />);
  fireEvent.click(screen.getByRole("button", { name: "恢复历史" }));
  await act(async () => {});
  expect(api.cancel).not.toHaveBeenCalled();
  expect(api.load).not.toHaveBeenCalled();
  expect(useAcpStore.getState().sessionId).toBe("initial");
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  await act(async () => {});
  expect(useAcpStore.getState().running).toBe(true);
});

test("failed interruption during history selection preserves the task and never loads", async () => {
  useAcpStore.setState({ running: true });
  api.cancel.mockRejectedValueOnce(new Error("cancel failed"));
  render(<RunningHistory />);
  fireEvent.click(screen.getByRole("button", { name: "恢复历史" }));
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "中断并打开" })),
  );
  expect(api.cancel).toHaveBeenCalledExactlyOnceWith(
    "fixture-connection",
    "initial",
  );
  expect(api.load).not.toHaveBeenCalled();
  expect(useAcpStore.getState().sessionId).toBe("initial");
  expect(useAcpStore.getState().running).toBe(true);
});

test("failed native restoration keeps sending blocked until an explicit retry succeeds", async () => {
  api.load
    .mockRejectedValueOnce(new Error("load failed"))
    .mockResolvedValueOnce({ sessionId: "history" });
  const hook = renderHook(() => useAcpSessions("/fixture/project"));
  await act(() =>
    hook.result.current.open(record("history", "/fixture/project")),
  );
  expect(useAcpStore.getState().sessionTransitionError).toContain(
    "load failed",
  );
  await act(() =>
    hook.result.current.open(record("history", "/fixture/project")),
  );
  expect(useAcpStore.getState().sessionTransitionError).toBeNull();
  expect(useAcpStore.getState().sessionId).toBe("history");
});

test("deleting a running current session preserves its record and never interrupts implicitly", async () => {
  useAcpStore.setState({ running: true });
  const hook = renderHook(() => useAcpSessions("/fixture/project"));
  await expect(
    hook.result.current.remove(record("initial", "/fixture/project")),
  ).rejects.toThrow("任务");
  expect(api.remove).not.toHaveBeenCalled();
  expect(api.fresh).not.toHaveBeenCalled();
  expect(api.cancel).not.toHaveBeenCalled();
});
test("failed replacement cannot destroy the current history record", async () => {
  api.fresh.mockResolvedValue(false);
  const hook = renderHook(() => useAcpSessions("/fixture/project"));
  await expect(
    hook.result.current.remove(record("initial", "/fixture/project")),
  ).rejects.toThrow("新会话");
  expect(api.remove).not.toHaveBeenCalled();
  expect(useAcpStore.getState().sessionId).toBe("initial");
});

test("opening the already running session restores its recorded project without interruption or reload", async () => {
  useAcpStore.setState({ running: true, sessionCwd: null });
  useWorkspaceStore.setState({ cwd: "/browsed-other" });
  const hook = renderHook(() => useAcpSessions("/fixture/project"));
  await act(() =>
    hook.result.current.open(record("initial", "/fixture/project")),
  );
  expect(useWorkspaceStore.getState().cwd).toBe("/fixture/project");
  expect(useAcpStore.getState().sessionCwd).toBe("/fixture/project");
  expect(api.cancel).not.toHaveBeenCalled();
  expect(api.load).not.toHaveBeenCalled();
  expect(useAcpStore.getState().running).toBe(true);
});

test("failed native history load restores the original identity and visible context for explicit retry", async () => {
  const entries = [
    { id: "original-message", role: "agent" as const, text: "原任务正文" },
  ];
  useAcpStore.setState({ entries, sessionCwd: "/fixture/original" });
  api.load.mockRejectedValueOnce(new Error("native load rejected"));
  const hook = renderHook(() => useAcpSessions("/fixture/project"));
  await act(() =>
    hook.result.current.open(record("history", "/fixture/project")),
  );
  expect(useAcpStore.getState().sessionId).toBe("initial");
  expect(useAcpStore.getState().sessionCwd).toBe("/fixture/original");
  expect(useAcpStore.getState().entries).toEqual(entries);
  expect(useAcpStore.getState().sessionTransitionError).toContain(
    "native load rejected",
  );
});
