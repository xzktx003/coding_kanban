import { beforeEach, expect, it, vi } from "vitest";
import { readTextFile } from "@session/services/apiAdapt/filesystem";
import { addFileContexts } from "./ContextAttachments";
import { composerDrafts, useComposerDraftStore } from "./drafts";

vi.mock("@session/services/apiAdapt/filesystem", () => ({
  readTextFile: vi.fn(),
}));
beforeEach(() => {
  vi.clearAllMocks();
  useComposerDraftStore.setState({ drafts: {}, error: null });
});

it("times out a stalled remote context read, aborts it and ignores its late result", async () => {
  vi.useFakeTimers();
  try {
    let release!: (text: string) => void;
    vi.mocked(readTextFile).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const outcome = addFileContexts("a", ["/slow.md"]).catch((error) => error);
    await vi.advanceTimersByTimeAsync(15_001);
    // Check the clock before awaiting outcome so the original code fails instead of hanging.
    expect(vi.mocked(readTextFile).mock.calls[0][1]?.signal?.aborted).toBe(
      true,
    );
    expect(await outcome).toMatchObject({
      message: "读取文件超时，请重新选择文件",
    });
    vi.mocked(readTextFile).mockResolvedValueOnce("next");
    await addFileContexts("a", ["/next.md"]);
    release("late");
    await Promise.resolve();
    expect(composerDrafts.read("a").contexts.map((c) => c.path)).toEqual([
      "/next.md",
    ]);
    expect(composerDrafts.read("b").contexts).toEqual([]);
  } finally {
    vi.useRealTimers();
  }
});
