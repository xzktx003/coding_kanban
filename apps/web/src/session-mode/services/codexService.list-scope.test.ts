import { beforeEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ listThreads: vi.fn() }));
vi.mock("./apiAdapt", () => api);
vi.mock("./apiAdapt/codex", () => api);
vi.mock("./apiAdapt/git", () => api);
vi.mock("./apiAdapt/skills", () => api);
import { codexService, resetCodexRuntimeState } from "./codexService";
import { useCodexStore } from "../components/codex/stores/useCodexStore";

beforeEach(() => {
  vi.clearAllMocks();
  resetCodexRuntimeState();
  useCodexStore.setState({ threads: [], threadListNextCursor: null });
});

it.each([false, true])(
  "an old runtime list response cannot replace current thread metadata (failure=%s)",
  async (failure) => {
    let resolve!: (value: unknown) => void;
    let reject!: (error: Error) => void;
    api.listThreads.mockImplementation(
      () =>
        new Promise((yes, no) => {
          resolve = yes;
          reject = no;
        }),
    );
    const pending = codexService.loadThreads("/old");
    resetCodexRuntimeState();
    const current = [{ id: "new", parentThreadId: "new-parent" }] as any;
    useCodexStore.setState({
      threads: current,
      threadListNextCursor: "new-cursor",
    });
    if (failure) reject(new Error("old connection failed"));
    else
      resolve({
        data: [{ id: "new", source: "cli", parentThreadId: null }],
        nextCursor: "old-cursor",
      });
    await pending;
    expect(useCodexStore.getState().threads).toBe(current);
    expect(useCodexStore.getState().threadListNextCursor).toBe("new-cursor");
  },
);
