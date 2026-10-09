import { beforeEach, expect, test, vi } from "vitest";
import { useAcpStore } from "@session/stores/useAcpStore";
import { authenticateAcpSession } from "./authenticateSession";
const api = vi.hoisted(() => ({
  authenticate: vi.fn(),
  cancel: vi.fn(),
  create: vi.fn(),
}));
vi.mock("@session/services/apiAdapt/acp", () => ({
  acpAuthenticate: api.authenticate,
  acpCancel: api.cancel,
  acpNewSession: api.create,
}));
vi.mock("@session/components/ui/use-toast", () => ({ toast: vi.fn() }));
beforeEach(() => {
  api.authenticate.mockReset().mockResolvedValue(undefined);
  api.cancel.mockReset().mockResolvedValue(undefined);
  api.create.mockReset().mockResolvedValue({ sessionId: "fresh" });
  useAcpStore.getState().reset();
  useAcpStore.setState({
    active: true,
    agentId: "fixture",
    connectionId: "connection",
    sessionId: "original",
    running: true,
  });
});
test("sign-in cannot silently interrupt the current task", async () => {
  expect(
    await authenticateAcpSession("connection", "account", "/fixture"),
  ).toBe(false);
  expect(api.cancel).not.toHaveBeenCalled();
  expect(api.authenticate).not.toHaveBeenCalled();
});
test("confirmed account switching stops only the captured task before authentication", async () => {
  expect(
    await authenticateAcpSession("connection", "account", "/fixture", {
      allowInterrupt: true,
    }),
  ).toBe(true);
  expect(api.cancel).toHaveBeenCalledExactlyOnceWith("connection", "original");
  expect(api.authenticate).toHaveBeenCalledExactlyOnceWith(
    "connection",
    "account",
  );
  expect(api.create).toHaveBeenCalledExactlyOnceWith("connection", "/fixture");
  expect(api.cancel.mock.invocationCallOrder[0]).toBeLessThan(
    api.authenticate.mock.invocationCallOrder[0],
  );
  expect(useAcpStore.getState().sessionId).toBe("fresh");
});
test("interruption failure cannot change the account or open a new session", async () => {
  api.cancel.mockRejectedValueOnce(new Error("cancel failed"));
  expect(
    await authenticateAcpSession("connection", "account", "/fixture", {
      allowInterrupt: true,
    }),
  ).toBe(false);
  expect(api.authenticate).not.toHaveBeenCalled();
  expect(api.create).not.toHaveBeenCalled();
  expect(useAcpStore.getState().running).toBe(true);
  expect(useAcpStore.getState().sessionId).toBe("original");
});
test("a late authentication result cannot create or bind a session after navigation", async () => {
  useAcpStore.setState({ running: false });
  let resolve!: () => void;
  api.authenticate.mockReturnValueOnce(
    new Promise<void>((done) => {
      resolve = done;
    }),
  );
  const result = authenticateAcpSession("connection", "account", "/fixture");
  await vi.waitFor(() => expect(api.authenticate).toHaveBeenCalledOnce());
  useAcpStore.setState({ sessionId: "other" });
  resolve();
  expect(await result).toBe(false);
  expect(api.create).not.toHaveBeenCalled();
  expect(useAcpStore.getState().selectedAuthMethod).toBeNull();
  expect(useAcpStore.getState().sessionId).toBe("other");
});

test("cancel delivery is not a terminal acknowledgement when replacement fails", async () => {
  api.create.mockRejectedValueOnce(new Error("new session failed"));
  expect(
    await authenticateAcpSession("connection", "account", "/fixture", {
      allowInterrupt: true,
    }),
  ).toBe(false);
  expect(api.cancel).toHaveBeenCalledExactlyOnceWith("connection", "original");
  expect(useAcpStore.getState().sessionId).toBe("original");
  expect(useAcpStore.getState().running).toBe(true);
});
