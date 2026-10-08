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
  reconcileRpcDeliveries(allRequests());
}

/** Expire only the owning turn. Missing turn identity is cleared only on thread/instance closure. */
export function clearCodexRequests(threadId?: string, turnId?: string) {
  const keep = (r: { threadId: string; turnId?: string | null }) =>
    (threadId !== undefined && r.threadId !== threadId) || (turnId !== undefined && r.turnId !== turnId);
  useRequestUserInputStore.getState().replaceRequests(useRequestUserInputStore.getState().pendingRequests.filter(keep));
  useApprovalStore.setState(s => { const pendingApprovals = s.pendingApprovals.filter(keep); return { pendingApprovals, currentApproval: pendingApprovals[0] ?? null }; });
  usePermissionsStore.setState(s => ({ pendingRequests: s.pendingRequests.filter(keep) }));
  useElicitationStore.setState(s => ({ pendingRequests: s.pendingRequests.filter(keep) }));
  reconcileRpcDeliveries(allRequests());
}

import { reconcileRpcDeliveries, sameRpc } from '../stores/rpcLifecycle';
function allRequests() {
  return [...useRequestUserInputStore.getState().pendingRequests, ...useApprovalStore.getState().pendingApprovals,
    ...usePermissionsStore.getState().pendingRequests, ...useElicitationStore.getState().pendingRequests];
}
/** Preserve object identity for pending sends while atomically replacing the server-owned set. */
export function reconcileCodexRequests(requests: Array<{event: string; payload: unknown}>) {
  function collect<T extends { threadId: string; requestId: RequestId; turnId?: string | null; itemId?: string | null }>(event: string, previous: T[]): T[] {
    const result: T[] = [];
    for (const envelope of requests) {
      if (envelope.event !== event) continue;
      const r = envelope.payload as T;
      if (!r || typeof r.threadId !== 'string' || !['string','number'].includes(typeof r.requestId)) continue;
      if (result.some(old => sameRpc(old,r))) continue;
      result.push(previous.find(old => sameRpc(old,r) && JSON.stringify(old) === JSON.stringify(r)) ?? r);
    }
    return result;
  }
  const approvals = collect('codex/approval-request', useApprovalStore.getState().pendingApprovals);
  useApprovalStore.setState({pendingApprovals: approvals, currentApproval: approvals[0] ?? null});
  usePermissionsStore.setState(s => ({pendingRequests: collect('codex/permissions-request', s.pendingRequests)}));
  useElicitationStore.setState(s => ({pendingRequests: collect('codex/elicitation-request', s.pendingRequests)}));
  const input = useRequestUserInputStore.getState();
  input.replaceRequests(collect('codex/request-user-input', input.pendingRequests));
  reconcileRpcDeliveries(allRequests());
}
