import { beforeEach, expect, test, vi } from "vitest";
import { useAcpStore } from "@session/stores/useAcpStore";
import { acpFreshSession } from "./newSession";

const api = vi.hoisted(() => ({ cancel: vi.fn(), create: vi.fn() }));
vi.mock("@session/services/apiAdapt/acp", () => ({
  acpCancel: api.cancel,
  acpNewSession: api.create,
}));
beforeEach(() => {
  api.cancel.mockReset().mockResolvedValue(undefined);
  api.create.mockReset().mockResolvedValue({ sessionId: "created" });
  useAcpStore.setState({
    active: true,
    agentId: "fixture",
    connectionId: "connection",
    sessionId: "original",
    running: true,
    entries: [{ id: "draft-context", role: "agent", text: "保留原任务" }],
  });
});

test("a new session cannot silently interrupt a running task", async () => {
  expect(await acpFreshSession("connection", "/fixture")).toBe(false);
  expect(api.cancel).not.toHaveBeenCalled();
  expect(api.create).not.toHaveBeenCalled();
  expect(useAcpStore.getState().running).toBe(true);
});

test("a failed confirmed interruption never creates a session or clears context", async () => {
  api.cancel.mockRejectedValueOnce(new Error("cancel failed"));
  expect(
    await acpFreshSession("connection", "/fixture", { allowInterrupt: true }),
  ).toBe(false);
  expect(api.create).not.toHaveBeenCalled();
  expect(useAcpStore.getState().sessionId).toBe("original");
  expect(useAcpStore.getState().running).toBe(true);
  expect(useAcpStore.getState().entries[0]).toMatchObject({
    text: "保留原任务",
  });
});

test("a late new-session reply cannot replace another selected identity", async () => {
  useAcpStore.setState({ running: false });
  let resolve!: (session: { sessionId: string }) => void;
  api.create.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const result = acpFreshSession("connection", "/fixture");
  await vi.waitFor(() => expect(api.create).toHaveBeenCalledOnce());
  useAcpStore.setState({
    connectionId: "another-connection",
    sessionId: "another-session",
  });
  resolve({ sessionId: "late" });
  expect(await result).toBe(false);
  expect(useAcpStore.getState().sessionId).toBe("another-session");
  expect(useAcpStore.getState().entries[0]).toMatchObject({
    text: "保留原任务",
  });
});

test("an old connection cannot cancel the task on the current connection", async () => {
  expect(
    await acpFreshSession("old-connection", "/fixture", {
      allowInterrupt: true,
    }),
  ).toBe(false);
  expect(api.cancel).not.toHaveBeenCalled();
  expect(api.create).not.toHaveBeenCalled();
});

test("successful interruption and creation replace only the owned context", async () => {
  expect(
    await acpFreshSession("connection", "/fixture", { allowInterrupt: true }),
  ).toBe(true);
  expect(api.cancel).toHaveBeenCalledExactlyOnceWith("connection", "original");
  expect(api.create).toHaveBeenCalledExactlyOnceWith("connection", "/fixture");
  expect(useAcpStore.getState().sessionId).toBe("created");
  expect(useAcpStore.getState().running).toBe(false);
});

test("cancel delivery is not a terminal acknowledgement when replacement fails", async () => {
  api.create.mockRejectedValueOnce(new Error("new session failed"));
  expect(
    await acpFreshSession("connection", "/fixture", { allowInterrupt: true }),
  ).toBe(false);
  expect(api.cancel).toHaveBeenCalledExactlyOnceWith("connection", "original");
  expect(useAcpStore.getState().sessionId).toBe("original");
  expect(useAcpStore.getState().running).toBe(true);
});
