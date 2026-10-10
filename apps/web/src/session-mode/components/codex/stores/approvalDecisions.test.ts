import { beforeEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({
  respondToCommandExecutionApproval: vi.fn().mockResolvedValue(undefined),
  respondToFileChangeApproval: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@session/services", () => api);
import { useApprovalStore, type ApprovalRequest } from "./useApprovalStore";
import { resetRpcLifecycle } from "./rpcLifecycle";
const value: ApprovalRequest = {
  type: "commandExecution",
  requestId: 10,
  threadId: "owner",
  turnId: "turn",
  itemId: "item",
  startedAtMs: 1,
  environmentId: null,
  availableDecisions: ["decline"],
};
beforeEach(() => {
  resetRpcLifecycle();
  vi.clearAllMocks();
  useApprovalStore.setState({
    pendingApprovals: [value],
    currentApproval: value,
  });
});
it("rejects decisions the native prompt does not permit before making a request", async () => {
  await expect(
    useApprovalStore.getState().respondToApproval(10, true, "accept", value),
  ).rejects.toThrow("授权选项");
  expect(api.respondToCommandExecutionApproval).not.toHaveBeenCalled();
  expect(useApprovalStore.getState().pendingApprovals).toEqual([value]);
});
it("never routes a command approval through a file-approval callback", async () => {
  await expect(
    useApprovalStore.getState().respondToApproval(10, false, "decline", value),
  ).rejects.toThrow("类型");
  expect(api.respondToFileChangeApproval).not.toHaveBeenCalled();
});
it("sends the exact allowed native decision with the owner identity", async () => {
  await useApprovalStore
    .getState()
    .respondToApproval(10, true, "decline", value);
  expect(api.respondToCommandExecutionApproval).toHaveBeenCalledWith(
    10,
    "decline",
    { threadId: "owner", requestId: 10, turnId: "turn", itemId: "item" },
  );
  expect(useApprovalStore.getState().pendingApprovals).toHaveLength(0);
});
