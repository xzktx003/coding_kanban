import { beforeEach, expect, it, vi } from "vitest";
import { subagentScope } from "./scope";
const mock = vi.hoisted(() => ({ metadata: vi.fn(), post: vi.fn() }));
vi.mock("@session/services/apiAdapt/codex", () => ({
  threadMetadata: mock.metadata,
}));
vi.mock("@session/services/apiAdapt/shared", () => ({
  postJsonWithOptions: mock.post,
}));
import { resetSubagentRuntime, subagentService } from "./service";
import {
  confirmSubagentMetadata,
  observeSubagents,
  useSubagentStore,
} from "./store";
import { codexThreadInputState } from "./inputIdentity";
import { useCodexStore } from "@session/components/codex/stores";
const child = {
  id: "child",
  parentThreadId: "root",
  canAcceptDirectInput: true,
};
beforeEach(() => {
  resetSubagentRuntime();
  mock.metadata.mockReset();
  mock.post.mockReset();
  useCodexStore.setState({ threads: [] });
  useSubagentStore.setState({
    nodes: {},
    identities: {},
    identityChecks: {},
    revision: 0,
    scope: subagentScope(),
  });
});
const deferred = () => {
  let resolve!: (value: any) => void;
  const promise = new Promise<any>((r) => (resolve = r));
  return { promise, resolve };
};
it("merges concurrent metadata reads and removes each abort listener after settlement", async () => {
  const read = deferred();
  mock.metadata.mockReturnValue(read.promise);
  const a = new AbortController(),
    b = new AbortController();
  const removeA = vi.spyOn(a.signal, "removeEventListener"),
    removeB = vi.spyOn(b.signal, "removeEventListener");
  const first = subagentService.inspectIdentity("child", a.signal),
    second = subagentService.inspectIdentity("child", b.signal);
  expect(mock.metadata).toHaveBeenCalledTimes(1);
  read.resolve({ thread: child });
  await Promise.all([first, second]);
  expect(removeA).toHaveBeenCalledWith("abort", expect.any(Function));
  expect(removeB).toHaveBeenCalledWith("abort", expect.any(Function));
  expect(codexThreadInputState("child").blocked).toBe(false);
});
it("one cancelled input does not cancel another visible input's shared read", async () => {
  const read = deferred();
  mock.metadata.mockReturnValue(read.promise);
  const a = new AbortController(),
    b = new AbortController();
  const first = subagentService.inspectIdentity("child", a.signal),
    second = subagentService.inspectIdentity("child", b.signal);
  const rejected = expect(first).rejects.toMatchObject({ name: "AbortError" });
  a.abort();
  await rejected;
  expect(mock.metadata.mock.calls[0][1].signal.aborted).toBe(false);
  read.resolve({ thread: child });
  await second;
  expect(codexThreadInputState("child").blocked).toBe(false);
});
it("last-consumer cancellation permits an immediate new read instead of reusing the aborted promise", async () => {
  const old = deferred();
  mock.metadata
    .mockReturnValueOnce(old.promise)
    .mockResolvedValueOnce({ thread: child });
  const controller = new AbortController();
  const pending = subagentService.inspectIdentity("child", controller.signal);
  const rejected = expect(pending).rejects.toMatchObject({
    name: "AbortError",
  });
  controller.abort();
  await rejected;
  await subagentService.inspectIdentity("child");
  expect(mock.metadata).toHaveBeenCalledTimes(2);
  old.resolve({ thread: { ...child, canAcceptDirectInput: false } });
  await Promise.resolve();
  expect(codexThreadInputState("child").blocked).toBe(false);
});
it("a metadata response cannot reopen input revoked by a newer native event", async () => {
  const read = deferred();
  mock.metadata.mockReturnValue(read.promise);
  const pending = subagentService.inspectIdentity("child");
  confirmSubagentMetadata([{ ...child, canAcceptDirectInput: false }]);
  read.resolve({ thread: child });
  expect((await pending).canAcceptDirectInput).toBe(false);
  expect(codexThreadInputState("child").blocked).toBe(true);
});
it.each(["inspect", "verify", "snapshot"])(
  "a newer native confirmation of the same denied capability fences an older permitted %s without snapshot churn",
  async (operation) => {
    const denied = { ...child, canAcceptDirectInput: false };
    confirmSubagentMetadata([denied]);
    const read = deferred();
    mock.metadata.mockReturnValue(read.promise);
    mock.post.mockReturnValue(read.promise);
    const pending =
      operation === "inspect"
        ? subagentService.inspectIdentity("child")
        : operation === "verify"
          ? subagentService.verify("root", "child")
          : subagentService.refresh("root");
    const unchanged = useSubagentStore.getState();
    observeSubagents({
      method: "thread/started",
      params: { thread: { ...denied } },
    } as any);
    expect(useSubagentStore.getState().nodes).toBe(unchanged.nodes);
    expect(useSubagentStore.getState().identities).toBe(unchanged.identities);
    read.resolve(
      operation === "snapshot"
        ? { threads: [child], complete: true, errors: [], checkedAt: 1 }
        : { thread: child },
    );
    const result = await pending;
    if (result) expect(result.canAcceptDirectInput).toBe(false);
    expect(codexThreadInputState("child").blocked).toBe(true);
  },
);

it("late child verification returns the current revoked capability rather than the stale permitted response", async () => {
  const read = deferred();
  mock.post.mockReturnValue(read.promise);
  const pending = subagentService.verify("root", "child");
  confirmSubagentMetadata([{ ...child, canAcceptDirectInput: false }]);
  read.resolve({ thread: child });
  expect((await pending).canAcceptDirectInput).toBe(false);
});
it("runtime reset rejects the old response without restoring a node or permission", async () => {
  const read = deferred();
  mock.metadata.mockReturnValue(read.promise);
  const pending = subagentService.inspectIdentity("child");
  const rejected = expect(pending).rejects.toThrow();
  resetSubagentRuntime();
  read.resolve({ thread: child });
  await rejected;
  expect(useSubagentStore.getState().nodes).toEqual({});
  expect(useSubagentStore.getState().identities).toEqual({});
});

it("a fresh metadata event for an unrelated child does not invalidate this child's read", async () => {
  confirmSubagentMetadata([{ ...child, canAcceptDirectInput: false }]);
  const read = deferred();
  mock.metadata.mockReturnValue(read.promise);
  const pending = subagentService.inspectIdentity("child");
  observeSubagents({
    method: "thread/started",
    params: {
      thread: {
        id: "other-child",
        parentThreadId: "other-root",
        canAcceptDirectInput: false,
      },
    },
  } as any);
  read.resolve({ thread: child });
  expect((await pending).canAcceptDirectInput).toBe(true);
  expect(codexThreadInputState("child").blocked).toBe(false);
});

it("a stale unavailable snapshot cannot withdraw availability after a newer unchanged native confirmation", async () => {
  const denied = { ...child, canAcceptDirectInput: false };
  confirmSubagentMetadata([denied]);
  const read = deferred();
  mock.post.mockReturnValue(read.promise);
  const pending = subagentService.refresh("root");
  observeSubagents({
    method: "thread/started",
    params: { thread: { ...denied } },
  } as any);
  read.resolve({
    threads: [],
    complete: false,
    errors: ["old read unavailable"],
    unavailableIds: ["child"],
    checkedAt: 1,
  });
  await pending;
  expect(useSubagentStore.getState().nodes.child.unavailable).toBe(false);
  expect(
    useSubagentStore.getState().nodes.child.thread.canAcceptDirectInput,
  ).toBe(false);
});
it("identical native snapshots reuse nodes and identity references", () => {
  const snapshot = {
    threads: [child],
    complete: true,
    checkedAt: 1,
    errors: [],
  };
  useSubagentStore.getState().apply("root", snapshot, 0);
  const first = useSubagentStore.getState();
  const notified = vi.fn();
  const unsubscribe = useSubagentStore.subscribe(notified);
  useSubagentStore
    .getState()
    .apply("root", { ...snapshot, checkedAt: 99 }, first.revision);
  unsubscribe();
  expect(notified).not.toHaveBeenCalled();
});
it("identity caches retain no turns or preview, and the node holds only the latest bounded turn metadata", () => {
  const body = "secret".repeat(200_000);
  confirmSubagentMetadata([
    {
      ...child,
      preview: body,
      turns: Array.from({ length: 5000 }, (_, i) => ({
        id: String(i),
        status: "completed",
        items: [{ text: body }],
      })),
    },
  ]);
  const state = useSubagentStore.getState();
  expect(state.nodes.child.thread.turns).toEqual([
    { id: "4999", status: "completed" },
  ]);
  expect(state.identities.child.thread.turns).toBeUndefined();
  expect(state.identities.child.thread.preview).toBeUndefined();
  expect(JSON.stringify(state.nodes)).not.toContain(body);
});
