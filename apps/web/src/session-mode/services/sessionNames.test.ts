import { resetAppActionHistory, canUndoAppAction, undoAppAction } from "../components/codex/composer/appActionHistory";
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
  resetAppActionHistory();
  useSessionNameStore.setState({ names: {}, sources: {}, editRevisions: {} });
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

it("a delayed rename acknowledgement cannot overwrite a later name intent", async () => {
  let acknowledge!: () => void;
  mocks.renameThread.mockImplementationOnce(() => new Promise<void>(resolve => { acknowledge = resolve; }));
  const pending = renameSession("codex", "id", "Old intent");
  await Promise.resolve();
  useSessionNameStore.getState().setName("codex", "id", "New intent");
  acknowledge(); await pending;
  expect(useSessionNameStore.getState().names["codex:id"]).toBe("New intent");
});

it("records an acknowledged rename for async undo and refuses a later same-valued native name revision", async () => {
  useSessionNameStore.getState().setName("codex", "id", "Before");
  mocks.renameThread.mockResolvedValue({});
  await renameSession("codex", "id", "After");
  expect(canUndoAppAction()).toBe(true);
  useSessionNameStore.getState().applyNativeName("codex", "id", "After");
  await expect(undoAppAction()).rejects.toThrow(/修改/);
  expect(mocks.renameThread).toHaveBeenCalledTimes(1);
  expect(canUndoAppAction()).toBe(true);
});
