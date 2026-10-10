import { beforeEach, expect, it, vi } from "vitest";
import type { SavedPatchRequest } from "@agent-orchestrator/shared";
import { useSavedPatchStore, savedPatchKey } from "./useSavedPatchStore";
const api = vi.hoisted(() => ({ apply: vi.fn(), status: vi.fn() }));
vi.mock("@session/services/savedPatchService", () => ({
  savedPatchApply: api.apply,
  savedPatchStatus: api.status,
}));
const input = {
  threadId: "a",
  turnId: "t",
  action: "undo" as const,
  expectedChanges: [
    {
      id: "i",
      changes: [
        { path: "file", kind: { type: "update" as const }, diff: "saved" },
      ],
    },
  ],
};
beforeEach(() => {
  vi.clearAllMocks();
  useSavedPatchStore.setState({ records: {} });
});
it("captures original owner, guards duplicate clicks and toggles to reapply only with a success receipt", async () => {
  let resolve!: (value: unknown) => void;
  api.apply.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const first = useSavedPatchStore.getState().apply(input);
  const duplicate = useSavedPatchStore.getState().apply(input);
  await vi.waitFor(() => expect(api.apply).toHaveBeenCalledOnce());
  const request = api.apply.mock.calls[0][0] as SavedPatchRequest;
  expect(request).toMatchObject(input);
  resolve({
    requestId: request.requestId,
    action: "undo",
    status: "success",
    changedFiles: 1,
  });
  await Promise.all([first, duplicate]);
  expect(
    useSavedPatchStore.getState().records[savedPatchKey(input)],
  ).toMatchObject({ status: "success", nextAction: "reapply" });
  expect(
    useSavedPatchStore.getState().records[
      savedPatchKey({ ...input, threadId: "b" })
    ],
  ).toBeUndefined();
});
it("unknown network delivery persists uncertainty and a read-only status check cannot resubmit", async () => {
  api.apply.mockRejectedValueOnce(new Error("network disconnected"));
  await useSavedPatchStore.getState().apply(input);
  const key = savedPatchKey(input);
  const old = useSavedPatchStore.getState().records[key];
  expect(old.status).toBe("uncertain");
  await useSavedPatchStore.getState().apply(input);
  expect(api.apply).toHaveBeenCalledOnce();
  api.status.mockResolvedValueOnce({ result: null });
  await useSavedPatchStore.getState().check(input);
  expect(api.status).toHaveBeenCalledWith("a", old.requestId);
  expect(useSavedPatchStore.getState().records[key].status).toBe("uncertain");
  api.status.mockResolvedValueOnce({
    result: {
      requestId: old.requestId,
      action: "undo",
      status: "success",
      changedFiles: 1,
    },
  });
  await useSavedPatchStore.getState().check(input);
  expect(useSavedPatchStore.getState().records[key].nextAction).toBe("reapply");
  expect(api.apply).toHaveBeenCalledOnce();
});
it("a conflict displays the actual error and never changes which operation comes next", async () => {
  api.apply.mockImplementationOnce(async (request: SavedPatchRequest) => ({
    requestId: request.requestId,
    action: "undo",
    status: "conflict",
    changedFiles: 0,
    error: "later edits conflict",
  }));
  await useSavedPatchStore.getState().apply(input);
  expect(
    useSavedPatchStore.getState().records[savedPatchKey(input)],
  ).toMatchObject({
    status: "conflict",
    nextAction: "undo",
    error: "later edits conflict",
  });
});
