import type { RequestId } from "@session/bindings";
import { useApprovalStore } from "../stores/useApprovalStore";
import { useElicitationStore } from "../stores/useElicitationStore";
import { usePermissionsStore } from "../stores/usePermissionsStore";
import { useRequestUserInputStore } from "../stores/useRequestUserInputStore";

/** A response from any device, expiration, or cancellation removes the same RPC. */
export function resolveCodexServerRequest(
  threadId: string,
  requestId: RequestId,
) {
  useRequestUserInputStore.getState().resolveRequest(threadId, requestId);
  useApprovalStore.setState((state) => {
    const pendingApprovals = state.pendingApprovals.filter(
      (r) => r.threadId !== threadId || r.requestId !== requestId,
    );
    return { pendingApprovals, currentApproval: pendingApprovals[0] ?? null };
  });
  useElicitationStore.setState((state) => ({
    pendingRequests: state.pendingRequests.filter(
      (r) => r.threadId !== threadId || r.requestId !== requestId,
    ),
  }));
  usePermissionsStore.setState((state) => ({
    pendingRequests: state.pendingRequests.filter(
      (r) => r.threadId !== threadId || r.requestId !== requestId,
    ),
  }));
}
