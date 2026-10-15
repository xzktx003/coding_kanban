import { beforeEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({
  post: vi.fn(),
  metadata: vi.fn(),
  access: vi.fn(),
}));
vi.mock("./apiAdapt/shared", async (original) => ({
  ...(await original<object>()),
  postJsonWithOptions: api.post,
}));
vi.mock("./apiAdapt/codex", () => ({
  threadAccess: api.access,
  threadMetadata: api.metadata,
}));
import { followupService, useFollowupStore } from "./followupService";
import { useCodexStore } from "@session/components/codex/stores";
import { resetCodexAccessCache } from "@session/stores/useCodexAccessStore";
import { useCodexDeliveryStore } from "@session/stores/useCodexDeliveryStore";
import {
  confirmSubagentMetadata,
  useSubagentStore,
} from "@session/features/subagents/store";
import { resetSubagentRuntime } from "@session/features/subagents/service";
const child = {
  id: "child",
  parentThreadId: "root",
  source: { subAgent: {} },
  canAcceptDirectInput: true,
};
beforeEach(() => {
  vi.clearAllMocks();
  api.metadata.mockReset();
  api.access.mockReset();
  api.post.mockReset();
  localStorage.clear();
  resetSubagentRuntime();
  resetCodexAccessCache();
  useSubagentStore.setState({ nodes: {}, identities: {}, revision: 0 });
  useCodexStore.setState({
    threads: [],
    turnTimingMap: {},
    threadStatusMap: {},
  });
  useCodexDeliveryStore.setState({ entries: {} });
  useFollowupStore.setState({ threads: {}, errors: {} });
  api.access.mockResolvedValue({ state: "owned", reason: "", generation: 1 });
  api.post.mockImplementation(async (_path, data) => ({
    revision: 1,
    paused: null,
    items: [{ ...data, status: "queued" }],
  }));
});
const submit = (id = "child") =>
  followupService.submit(
    `codex:${id}`,
    1,
    id,
    "captured draft",
    [],
    "queue",
    undefined,
    {},
  );
it("the public submit path ignores a false observation edge for a confirmed main thread", async () => {
  useCodexStore.setState({
    threads: [{ id: "root", source: "vscode", parentThreadId: null }] as any,
  });
  useSubagentStore.setState({
    nodes: {
      root: {
        thread: { id: "root" },
        parentId: "child",
        verified: false,
        revision: 0,
      },
    },
  });
  await submit("root");
  expect(api.metadata).not.toHaveBeenCalled();
  expect(api.post).toHaveBeenCalledTimes(1);
  expect(api.post.mock.calls[0][1].threadId).toBe("root");
});
it.each([false, null])(
  "fresh native child capability %s rejects before any submission or echo",
  async (canAcceptDirectInput) => {
    confirmSubagentMetadata([child]);
    api.metadata.mockResolvedValue({
      thread: { ...child, canAcceptDirectInput },
    });
    await expect(submit()).rejects.toThrow(/不能直接|尚未确认/);
    expect(api.post).not.toHaveBeenCalled();
    expect(api.access).not.toHaveBeenCalled();
    expect(useCodexDeliveryStore.getState().entries).toEqual({});
  },
);
it("a permission revocation during the async writer check rejects before the message echo or mutation", async () => {
  confirmSubagentMetadata([child]);
  api.metadata.mockResolvedValue({ thread: child });
  let resolve!: (value: any) => void;
  api.access.mockReturnValue(new Promise((r) => (resolve = r)));
  const pending = submit();
  const rejected = expect(pending).rejects.toThrow("不能直接");
  for (let i = 0; i < 20 && !api.access.mock.calls.length; i++)
    await new Promise((r) => setTimeout(r, 0));
  expect(api.access).toHaveBeenCalledTimes(1);
  confirmSubagentMetadata([{ ...child, canAcceptDirectInput: false }]);
  resolve({ state: "owned", reason: "", generation: 1 });
  await rejected;
  expect(api.post).not.toHaveBeenCalled();
  expect(useCodexDeliveryStore.getState().entries).toEqual({});
});
it("a native child with no parent metadata does not bypass a null capability", async () => {
  const thread = { ...child, parentThreadId: null, canAcceptDirectInput: null };
  useCodexStore.setState({ threads: [thread] as any });
  api.metadata.mockResolvedValue({ thread });
  await expect(submit()).rejects.toThrow("尚未确认");
  expect(api.post).not.toHaveBeenCalled();
  expect(useSubagentStore.getState().nodes).toEqual({});
});
