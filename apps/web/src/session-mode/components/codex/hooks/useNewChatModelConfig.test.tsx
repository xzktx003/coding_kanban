import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
const read = vi.hoisted(() => vi.fn());
vi.mock("@session/services/newChatModelConfig", () => ({
  readNewChatModelConfig: read,
}));
import { useNewChatModelConfig } from "./useNewChatModelConfig";
import { useWorkspaceStore } from "@session/stores/useWorkspaceStore";
beforeEach(() => {
  read.mockReset();
  useWorkspaceStore.setState({ cwd: "/a" });
});
it("rejects a late prior workspace result and rereads on opening", async () => {
  let old!: (v: unknown) => void;
  read
    .mockImplementationOnce(() => new Promise((r) => (old = r)))
    .mockResolvedValue({
      status: "ready",
      model: "new",
      modelProvider: "magpie",
      reasoningEffort: null,
    });
  const hook = renderHook(({ open }) => useNewChatModelConfig(true, open), {
    initialProps: { open: false },
  });
  act(() => useWorkspaceStore.setState({ cwd: "/b" }));
  await waitFor(() => expect(hook.result.current.value?.model).toBe("new"));
  await act(async () => old({ status: "ready", model: "old" }));
  expect(hook.result.current.value?.model).toBe("new");
  hook.rerender({ open: true });
  await waitFor(() => expect(read).toHaveBeenCalledTimes(3));
});
it("does not read configs for existing threads", () => {
  renderHook(() => useNewChatModelConfig(false, false));
  expect(read).not.toHaveBeenCalled();
});
it("reads a new-chat config once when the model menu mounts already open", async () => {
  read.mockResolvedValue({
    status: "ready",
    model: "gpt-5",
    modelProvider: "openai",
    reasoningEffort: null,
  });
  const hook = renderHook(() => useNewChatModelConfig(true, true));
  await waitFor(() => expect(hook.result.current.value?.model).toBe("gpt-5"));
  expect(read).toHaveBeenCalledTimes(1);
});
it("does not repeat the mount read for the menu's first requested open", async () => {
  read.mockResolvedValue({
    status: "ready",
    model: "gpt-5",
    modelProvider: "openai",
    reasoningEffort: null,
  });
  const hook = renderHook(
    ({ open }) => useNewChatModelConfig(true, open, true),
    { initialProps: { open: false } },
  );
  await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
  hook.rerender({ open: true });
  expect(read).toHaveBeenCalledTimes(1);
  hook.rerender({ open: false });
  hook.rerender({ open: true });
  await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
});
it("invalidates and rereads on runtime replacement",async()=>{
 read.mockResolvedValue({status:"ready",model:"first",modelProvider:null,reasoningEffort:null});
 const hook=renderHook(()=>useNewChatModelConfig(true,false));
 await waitFor(()=>expect(hook.result.current.value?.model).toBe("first"));
 read.mockResolvedValue({status:"ready",model:"second",modelProvider:null,reasoningEffort:null});
 act(()=>window.dispatchEvent(new Event("session-runtime-restarted")));
 await waitFor(()=>expect(hook.result.current.value?.model).toBe("second"));
});
