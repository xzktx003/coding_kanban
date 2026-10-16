import { act, renderHook, waitFor } from "@testing-library/react";
import { StrictMode, type MouseEvent } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useWorkspaceStore } from "@session/stores/useWorkspaceStore";
import { clipboardFixture, deferredClipboard } from "@session/test/clipboardFixture";
import { useSessionActions } from "./useSessionActions";

const calls = vi.hoisted(() => ({ toast: vi.fn(), remove: vi.fn(), worktree: vi.fn() }));
vi.mock("@session/components/ui/use-toast", () => ({ useToast: () => ({ toast: calls.toast }) }));
vi.mock("@session/services/apiAdapt/cc", () => ({ ccDeleteSession: calls.remove }));
vi.mock("@session/services/apiAdapt/git", () => ({ gitRemoveWorktree: calls.worktree }));
let clipboard: ReturnType<typeof clipboardFixture>;
beforeEach(() => { clipboard = clipboardFixture(); vi.clearAllMocks(); useWorkspaceStore.setState({ cwd: "/fixture" }); });
afterEach(() => clipboard.restore());
function copy(hook: { copySessionId: (e: MouseEvent, id: string) => void }) {
  const stopPropagation = vi.fn();
  act(() => hook.copySessionId({ stopPropagation } as unknown as MouseEvent, "fixture-cc-session"));
  expect(stopPropagation).toHaveBeenCalledOnce();
}
it("copies the captured CC ID over HTTP and only reports success after completion", async () => {
  const hook = renderHook(() => useSessionActions({ onSessionDeleted: vi.fn() }));
  copy(hook.result.current);
  await waitFor(() => expect(calls.toast).toHaveBeenCalledWith({ description: "Session ID copied to clipboard" }));
  expect(clipboard.texts).toEqual(["fixture-cc-session"]);
  expect(clipboard.copyEvents).toEqual([expect.objectContaining({ data: { "text/plain": "fixture-cc-session" }, defaultPrevented: true })]);
  expect(calls.remove).not.toHaveBeenCalled();
  expect(calls.worktree).not.toHaveBeenCalled();
});
it.each(["missing", "rejected"])("does not claim success on %s clipboard failure", async mode => {
  if (mode === "missing") clipboard.legacy.mockReturnValue(false);
  if (mode === "rejected") {
    const write = deferredClipboard(); clipboard.modern(vi.fn(() => write.promise)); write.reject(new Error("denied"));
  }
  const hook = renderHook(() => useSessionActions({ onSessionDeleted: vi.fn() }));
  copy(hook.result.current);
  await waitFor(() => expect(calls.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive" })));
  expect(calls.toast).not.toHaveBeenCalledWith({ description: "Session ID copied to clipboard" });
  if (mode === "rejected") expect(clipboard.legacy).not.toHaveBeenCalled();
});
it("waits for a pending write and suppresses the old project's late result", async () => {
  const write = deferredClipboard(); clipboard.modern(vi.fn(() => write.promise));
  const hook = renderHook(() => useSessionActions({ onSessionDeleted: vi.fn() }), { wrapper: StrictMode });
  copy(hook.result.current);
  expect(calls.toast).not.toHaveBeenCalled();
  await act(async () => useWorkspaceStore.setState({ cwd: "/next" }));
  await act(async () => write.resolve());
  expect(calls.toast).not.toHaveBeenCalled();
});
it("announces a pending successful write only after its receipt", async () => {
  const write = deferredClipboard(); clipboard.modern(vi.fn(() => write.promise));
  const hook = renderHook(() => useSessionActions({ onSessionDeleted: vi.fn() }), { wrapper: StrictMode });
  copy(hook.result.current);
  expect(calls.toast).not.toHaveBeenCalled();
  await act(async () => write.resolve());
  expect(calls.toast).toHaveBeenCalledExactlyOnceWith({ description: "Session ID copied to clipboard" });
});
it("does not announce a copy after the hook unmounts", async () => {
  const write = deferredClipboard(); clipboard.modern(vi.fn(() => write.promise));
  const hook = renderHook(() => useSessionActions({ onSessionDeleted: vi.fn() }));
  copy(hook.result.current);
  hook.unmount();
  await act(async () => write.resolve());
  expect(calls.toast).not.toHaveBeenCalled();
});
