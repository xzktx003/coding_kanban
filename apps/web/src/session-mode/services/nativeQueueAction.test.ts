import { beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  context: vi.fn(),
}));
vi.mock("./apiAdapt/shared", () => ({
  getJsonWithOptions: mock.get,
  postJsonWithOptions: mock.post,
  isExplicitRequestRejection: () => false,
}));
vi.mock("./nativeOperationContext", () => ({
  readNativeOperationContext: mock.context,
}));
import { changeNativeQueue } from "./nativeQueueAction";
const saved = () =>
  Object.keys(localStorage)
    .filter((key) => key.startsWith("session-native-queue-actions-v1:"))
    .map((key) => JSON.parse(localStorage.getItem(key)!));
beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  mock.context.mockResolvedValue({ scopeToken: "scope", namespace: "account" });
});
it("a lost queue action ACK can only GET its original operation despite a newer queue revision", async () => {
  mock.post.mockRejectedValueOnce(new Error("lost ACK"));
  await expect(
    changeNativeQueue("thread", 1, {
      type: "edit",
      id: "row",
      text: "saved text",
    }),
  ).rejects.toThrow(/lost/);
  const record = saved()[0];
  expect(JSON.stringify(saved())).not.toContain("saved text");
  mock.get.mockResolvedValueOnce({
    authority: "native",
    revision: 2,
    paused: null,
    items: [],
    operation: { id: record.id, status: "accepted" },
  });
  await changeNativeQueue("thread", 2, {
    type: "edit",
    id: "row",
    text: "saved text",
  });
  expect(mock.post).toHaveBeenCalledTimes(1);
  expect(mock.get.mock.calls[0][0]).toContain(record.id);
});
it("reconciling an earlier edit never claims a different new edit was applied", async () => {
  mock.post.mockRejectedValueOnce(new Error("lost"));
  await expect(
    changeNativeQueue("thread", 1, { type: "edit", id: "row", text: "old" }),
  ).rejects.toThrow();
  const record = saved()[0];
  mock.get.mockResolvedValueOnce({
    authority: "native",
    revision: 2,
    paused: null,
    items: [],
    operation: { id: record.id, status: "accepted" },
  });
  await expect(
    changeNativeQueue("thread", 2, { type: "edit", id: "row", text: "new" }),
  ).rejects.toThrow(/尚未提交/);
  expect(mock.post).toHaveBeenCalledTimes(1);
});
it("independent unknown actions use separate durable keys so concurrent pages cannot replace another target's receipt", async () => {
  mock.post.mockRejectedValue(new Error("lost ACK"));
  await expect(
    changeNativeQueue("thread-a", 1, { type: "resume" }),
  ).rejects.toThrow();
  await expect(
    changeNativeQueue("thread-b", 1, { type: "resume" }),
  ).rejects.toThrow();
  const keys = Object.keys(localStorage).filter((key) =>
    key.startsWith("session-native-queue-actions-v1:"),
  );
  expect(keys).toHaveLength(2);
  const rows = keys.map((key) => JSON.parse(localStorage.getItem(key)!));
  expect(new Set(rows.map((row) => row.threadId))).toEqual(
    new Set(["thread-a", "thread-b"]),
  );
  expect(localStorage.getItem("session-native-queue-actions-v1")).toBeNull();
});
it("simultaneous edits for the same row never accept the first edit as the second edit's receipt", async () => {
  let release!: (value: any) => void;
  mock.post.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const first = changeNativeQueue("thread", 1, {
    type: "edit",
    id: "row",
    text: "first captured edit",
  });
  await vi.waitFor(() => expect(mock.post).toHaveBeenCalledTimes(1));
  const second = changeNativeQueue("thread", 1, {
    type: "edit",
    id: "row",
    text: "different later edit",
  }).then(
    () => null,
    (error) => error,
  );
  const record = saved()[0];
  release({
    authority: "native",
    revision: 2,
    paused: null,
    items: [],
    operation: { id: record.id, status: "accepted" },
  });
  await first;
  expect(await second).toBeInstanceOf(Error);
  expect(String(await second)).toMatch(/尚未提交|核对/);
  expect(mock.post).toHaveBeenCalledTimes(1);
});
