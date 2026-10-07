import { act, renderHook } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { useAcpStore } from "@session/stores/useAcpStore";
import type { AcpSessionRecord } from "@session/services/apiAdapt/acp";
import { useAcpSessions } from "./useAcpSessions";

const api = vi.hoisted(() => ({
  load: vi.fn(),
  start: vi.fn(),
  list: vi.fn().mockResolvedValue([]),
}));
vi.mock("@session/services/apiAdapt/acp", () => ({
  acpListSessions: api.list,
  acpLoadSession: api.load,
  acpStart: api.start,
  acpNewSession: vi.fn(),
  acpGetSession: vi.fn(),
  acpDeleteSession: vi.fn(),
}));
vi.mock("./newSession", () => ({ acpFreshSession: vi.fn() }));
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

// Deliberately red until the user approves navigation ownership protection.
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
    newOpen = newProject.result.current.open(
      record("new-history", "/fixture/new-project"),
    );
  });
  await act(async () => {
    resolveNew({ sessionId: "new-history" });
  });
  await act(async () => {
    resolveOld({ sessionId: "old-history" });
    await Promise.all([oldOpen, newOpen]);
  });
  expect(useAcpStore.getState().sessionId).toBe("new-history");
  expect(api.start).not.toHaveBeenCalled();
});
