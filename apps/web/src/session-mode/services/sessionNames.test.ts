import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  renameThread: vi.fn(),
  saveSessionName: vi.fn(),
}));
vi.mock("./apiAdapt", () => ({ renameThread: mocks.renameThread }));
vi.mock("../lib/settings", () => ({ saveSessionName: mocks.saveSessionName }));
import { renameSession } from "./sessionNames";
import { useSessionNameStore } from "../stores/useSessionNameStore";
beforeEach(() => {
  vi.resetAllMocks();
  useSessionNameStore.setState({ names: {} });
});
it("validates names before calling a persistence endpoint", async () => {
  await expect(renameSession("cc", "id", "   ")).rejects.toThrow();
  await expect(renameSession("codex", "id", "x".repeat(129))).rejects.toThrow();
  expect(mocks.renameThread).not.toHaveBeenCalled();
  expect(mocks.saveSessionName).not.toHaveBeenCalled();
});
it("uses native Codex rename and updates the label only after success", async () => {
  mocks.renameThread.mockRejectedValueOnce(new Error("offline"));
  await expect(renameSession("codex", "id", "Name")).rejects.toThrow("offline");
  expect(useSessionNameStore.getState().names["codex:id"]).toBeUndefined();
  mocks.renameThread.mockResolvedValueOnce({});
  await renameSession("codex", "id", "  Name  ");
  expect(mocks.renameThread).toHaveBeenLastCalledWith("id", "Name");
  expect(useSessionNameStore.getState().names["codex:id"]).toBe("Name");
});
it("persists Claude and ACP names without changing a running session", async () => {
  await renameSession("cc", "claude", "Claude title");
  await renameSession("acp", "acp", "ACP title");
  expect(mocks.saveSessionName).toHaveBeenCalledWith(
    "cc:claude",
    "Claude title",
  );
  expect(mocks.saveSessionName).toHaveBeenCalledWith("acp:acp", "ACP title");
  expect(mocks.renameThread).not.toHaveBeenCalled();
});
