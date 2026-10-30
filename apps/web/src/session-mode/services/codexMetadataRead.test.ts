import { beforeEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({
  threadRead: vi.fn(),
  threadMetadata: vi.fn(),
}));
vi.mock("./apiAdapt/codex", () => api);
import { codexService } from "./codexService";
import { useCodexStore } from "../components/codex/stores/useCodexStore";
import { useThreadModelStore } from "../stores/useThreadModelStore";
beforeEach(() => {
  vi.clearAllMocks();
  useThreadModelStore.setState({ threads: {} });
  useCodexStore.setState({
    currentThreadId: "selected",
    threads: [],
    events: {},
    turnTimingMap: {},
    threadStatusMap: {},
    historyLoadedMap: {},
    historyLoadingMap: {},
    historyErrorMap: {},
  });
  api.threadRead.mockImplementation(async ({ threadId }) => ({
    thread: { id: threadId, turns: [] },
    historyPage: { nextCursor: null, earlier: false },
  }));
  api.threadMetadata.mockImplementation(async (threadId: string) => ({
    thread: {
      id: threadId,
      cwd: "/fixture",
      model: "native-model",
      modelProvider: "openai",
    },
  }));
});

it("does not append an unbounded full history read to a bounded background recent page", async () => {
  await codexService.loadThreadHistory("background", undefined, {
    recent: true,
    background: true,
  });
  await Promise.resolve();
  expect(api.threadRead).toHaveBeenCalledTimes(1);
  expect(api.threadRead).toHaveBeenCalledWith(
    { threadId: "background", recent: true },
    expect.anything(),
  );
  expect(api.threadMetadata).not.toHaveBeenCalled();
});
it("reads selected model and permission metadata without reading its full transcript a second time", async () => {
  await codexService.loadThreadHistory("selected", undefined, {
    recent: true,
    background: true,
  });
  await vi.waitFor(() => expect(api.threadMetadata).toHaveBeenCalledOnce());
  expect(api.threadRead).toHaveBeenCalledTimes(1);
  expect(api.threadMetadata).toHaveBeenCalledWith(
    "selected",
    expect.objectContaining({ suppressToast: true }),
  );
});
