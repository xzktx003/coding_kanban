import { beforeEach, expect, it, vi } from "vitest";
import { subagentScope } from "./scope";
const post = vi.hoisted(() => vi.fn());
vi.mock("@session/services/apiAdapt/shared", () => ({
  postJsonWithOptions: post,
}));
import {
  resetSubagentRuntime,
  subagentService,
  openSubagents,
} from "./service";
import { useSubagentStore } from "./store";
beforeEach(() => {
  resetSubagentRuntime();
  post.mockReset();
  useSubagentStore.setState({
    scope: subagentScope(),
    nodes: {},
    families: {},
    selection: {},
    revision: 0,
  });
});
const snapshot = {
  threads: [
    { id: "child", parentThreadId: "root", canAcceptDirectInput: true },
  ],
  complete: true,
  errors: [],
  checkedAt: 1,
};
it("reopening the main summary preserves the last inspected child for that parent", async () => {
  useSubagentStore.setState({
    selection: { root: "child", other: "other-child" },
  });
  post.mockResolvedValue(snapshot);
  openSubagents("root");
  expect(useSubagentStore.getState().selection.root).toBe("child");
  expect(useSubagentStore.getState().selection.other).toBe("other-child");
  await subagentService.refresh("root");
});
it("an in-flight refresh preserves the last confirmed family until failure is known", async () => {
  useSubagentStore.getState().apply("root", snapshot, 0);
  let reject!: (reason: Error) => void;
  post.mockImplementation(
    () =>
      new Promise((_, r) => {
        reject = r;
      }),
  );
  const refresh = subagentService.refresh("root");
  expect(useSubagentStore.getState().families.root.complete).toBe(true);
  reject(new Error("offline"));
  await refresh;
  expect(useSubagentStore.getState().families.root.complete).toBe(false);
  expect(useSubagentStore.getState().nodes.child.thread.id).toBe("child");
});
it("coalesces duplicate reads and drops snapshots from a previous runtime", async () => {
  let resolve!: (value: unknown) => void;
  post.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const first = subagentService.refresh("root");
  expect(subagentService.refresh("root")).toBe(first);
  expect(post).toHaveBeenCalledTimes(1);
  resetSubagentRuntime();
  resolve(snapshot);
  await first;
  expect(useSubagentStore.getState().nodes).toEqual({});
  expect(useSubagentStore.getState().families).toEqual({});
});
it("late verification cannot restore input permission after runtime reset", async () => {
  let resolve!: (value: unknown) => void;
  post.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const result = subagentService.verify("root", "child");
  const rejected = expect(result).rejects.toThrow("运行实例已改变");
  resetSubagentRuntime();
  resolve({ thread: snapshot.threads[0] });
  await rejected;
  expect(useSubagentStore.getState().nodes).toEqual({});
});
it("host changes discard responses and do not issue mutations for a stale scope", async () => {
  let resolve!: (value: unknown) => void;
  post.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const result = subagentService.roles("root");
  const rejected = expect(result).rejects.toThrow("运行实例已改变");
  useSubagentStore.setState({ scope: "https://another-host" });
  resolve({ roles: [] });
  await rejected;
  await expect(
    subagentService.stop("root", [{ threadId: "child", turnId: "t" }]),
  ).rejects.toThrow("未发送停止请求");
  expect(post).toHaveBeenCalledTimes(1);
});
it("unavailable snapshots retain identity and selection but withdraw capability", () => {
  useSubagentStore.getState().apply("root", snapshot, 0);
  useSubagentStore.setState({ selection: { root: "child" } });
  useSubagentStore.getState().apply(
    "root",
    {
      threads: [],
      complete: false,
      unavailableIds: ["child"],
      errors: ["not found"],
      checkedAt: 2,
    },
    0,
  );
  expect(useSubagentStore.getState().nodes.child.unavailable).toBe(true);
  expect(
    useSubagentStore.getState().nodes.child.thread.canAcceptDirectInput,
  ).toBeNull();
  expect(useSubagentStore.getState().selection.root).toBe("child");
});

it("nested verification repairs the complete ancestor chain for a selected orphan", async () => {
  post.mockResolvedValue({
    thread: { id: "child", parentThreadId: "middle" },
    threads: [
      { id: "child", parentThreadId: "middle" },
      { id: "middle", parentThreadId: "root" },
    ],
  });
  await subagentService.verify("root", "child");
  expect(useSubagentStore.getState().nodes.middle.parentId).toBe("root");
  expect(useSubagentStore.getState().nodes.child.parentId).toBe("middle");
});
it("malformed verification or role responses stay unconfirmed", async () => {
  post.mockResolvedValue({
    thread: { id: "foreign", canAcceptDirectInput: true },
  });
  await expect(subagentService.verify("root", "child")).rejects.toThrow(
    "身份尚未确认",
  );
  expect(useSubagentStore.getState().nodes).toEqual({});
  post.mockResolvedValue({});
  await expect(subagentService.roles("root")).rejects.toThrow(
    "角色配置尚未确认",
  );
});
