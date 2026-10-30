import { beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  context: vi.fn(),
  get: vi.fn(),
  post: vi.fn(),
}));
vi.mock("./nativeOperationContext", () => ({
  readNativeOperationContext: mock.context,
}));
vi.mock("./apiAdapt/shared", () => ({
  getJsonWithOptions: mock.get,
  postJsonWithOptions: mock.post,
  isExplicitRequestRejection: () => false,
}));
import { lifecycleMutation } from "./lifecycleMutation";
const rows = () =>
  Object.keys(localStorage)
    .filter((key) => key.startsWith("session-lifecycle-mutations-v1:"))
    .map((key) => JSON.parse(localStorage.getItem(key)!));
beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  mock.context.mockResolvedValue({ scopeToken: "scope", namespace: "account" });
});
it("persists an unknown archive before POST and a refresh reconciles the same intent by GET only", async () => {
  mock.post.mockImplementationOnce(async (_path, body) => {
    expect(JSON.stringify(rows())).toContain(body.operationId);
    throw new Error("lost acknowledgement");
  });
  await expect(
    lifecycleMutation("archive", "thread", {
      mode: "stop",
      expectedTurnId: "turn",
    }),
  ).rejects.toThrow(/lost/);
  const saved = rows()[0];
  mock.get.mockResolvedValueOnce({
    operationId: saved.operationId,
    threadId: "thread",
    status: "archived",
  });
  await expect(
    lifecycleMutation("archive", "thread", {
      mode: "stop",
      expectedTurnId: "later",
    }),
  ).rejects.toThrow(/尚未提交/);
  expect(mock.post).toHaveBeenCalledTimes(1);
  expect(mock.get.mock.calls[0][0]).toContain(
    encodeURIComponent(saved.operationId),
  );
  expect(JSON.stringify(rows())).not.toContain("expectedTurnId");
});
it("isolates unknown receipts by stable namespace and never saves rename text", async () => {
  mock.post.mockRejectedValueOnce(new Error("offline"));
  await expect(
    lifecycleMutation("rename", "thread", { name: "private name" }),
  ).rejects.toThrow();
  expect(JSON.stringify(rows())).not.toContain("private name");
  mock.context.mockResolvedValue({
    scopeToken: "scope-b",
    namespace: "account-b",
  });
  mock.post.mockImplementationOnce(async (_path, body) => ({
    operationId: body.operationId,
    threadId: body.threadId,
    status: "accepted",
  }));
  expect(
    (await lifecycleMutation("rename", "thread", { name: "new account" }))
      .status,
  ).toBe("accepted");
  expect(mock.get).not.toHaveBeenCalled();
});
it("reconciles an unknown review using its exact operation instead of starting a changed target", async () => {
  mock.post.mockRejectedValueOnce(new Error("lost review acknowledgement"));
  await expect(
    lifecycleMutation("review", "source", {
      delivery: "detached",
      target: { type: "custom", instructions: "private review text" },
    }),
  ).rejects.toThrow(/待核对/);
  const saved = rows()[0];
  mock.get.mockResolvedValueOnce({
    operationId: saved.operationId,
    threadId: "source",
    status: "accepted",
    reviewThreadId: "actual-review",
    turn: { id: "actual-turn", status: "inProgress", items: [] },
  });
  const result = await lifecycleMutation("review", "source", {
    delivery: "inline",
    target: { type: "uncommittedChanges" },
  });
  expect(mock.post).toHaveBeenCalledTimes(1);
  expect(mock.get.mock.calls[0][0]).toContain("/followups/review?");
  expect(mock.get.mock.calls[0][0]).toContain("threadId=source");
  expect(result).toMatchObject({
    reviewThreadId: "actual-review",
    reconciled: true,
  });
  expect(JSON.stringify(rows())).not.toContain("private review text");
});
it("separate pages' unknown lifecycle targets are saved under independent operation keys", async () => {
  mock.post.mockRejectedValue(new Error("offline"));
  await expect(
    lifecycleMutation("rename", "one", { name: "private one" }),
  ).rejects.toThrow();
  await expect(
    lifecycleMutation("archive", "two", { mode: "idle" }),
  ).rejects.toThrow();
  expect(rows()).toHaveLength(2);
  expect(localStorage.getItem("session-lifecycle-mutations-v1")).toBeNull();
  expect(JSON.stringify(rows())).not.toContain("private one");
});
it("a second simultaneous rename cannot receive the first name's acknowledgement", async () => {
  let release!: (value: any) => void;
  mock.post.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const first = lifecycleMutation("rename", "one", { name: "first" });
  await vi.waitFor(() => expect(mock.post).toHaveBeenCalledTimes(1));
  const second = lifecycleMutation("rename", "one", { name: "second" }).then(
    () => null,
    (error) => error,
  );
  const saved = rows()[0];
  release({
    operationId: saved.operationId,
    threadId: "one",
    status: "accepted",
  });
  await first;
  expect(await second).toBeInstanceOf(Error);
  expect(String(await second)).toMatch(/尚未提交/);
  expect(mock.post).toHaveBeenCalledTimes(1);
});
