import { deliverRpc, sameRpc } from './rpcLifecycle';
import { create } from 'zustand';
import type { RequestId } from '@session/bindings';
import type { PermissionGrantScope, PermissionsRequestApprovalParams } from '@session/bindings/v2';
import { respondToPermissionsApproval } from '@session/services';

export type PermissionsRequest = PermissionsRequestApprovalParams & {
  requestId: RequestId;
};

export type PermissionsDecision =
  | { kind: 'grantTurn' }
  | { kind: 'grantTurnStrict' }
  | { kind: 'grantSession' }
  | { kind: 'deny' };

interface PermissionsStore {
  pendingRequests: PermissionsRequest[];
  addRequest: (request: PermissionsRequest) => void;
  respond: (request: PermissionsRequest, decision: PermissionsDecision) => Promise<void>;
}

export const usePermissionsStore = create<PermissionsStore>((set, get) => ({
  pendingRequests: [],
  addRequest: (request) => {
    set((state) => ({ pendingRequests: state.pendingRequests.some(r => sameRpc(r, request)) ? state.pendingRequests : [...state.pendingRequests, request] }));
  },
  respond: async (request, decision) => {
    // Denying grants an empty profile rather than sending a decision field —
    // mirrors codex-rs `handle_permissions_decision`.
    const permissions = decision.kind === 'deny' ? {} : request.permissions;
    const scope: PermissionGrantScope = decision.kind === 'grantSession' ? 'session' : 'turn';
    if (!get().pendingRequests.includes(request)) throw new Error('审批已过期');
    await deliverRpc(request, () => respondToPermissionsApproval(
        request.requestId,
        permissions,
        scope,
        decision.kind === 'grantTurnStrict'
      ), () => {
      set((state) => ({
        pendingRequests: state.pendingRequests.filter((r) => r !== request),
      }));
    });
  },
}));
