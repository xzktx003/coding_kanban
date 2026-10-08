import { deliverRpc, sameRpc, rpcRequestContext } from './rpcLifecycle';
import { create } from 'zustand';
import type { RequestId } from '@session/bindings';
import type {
  CommandExecutionApprovalDecision,
  CommandExecutionRequestApprovalParams,
  FileChangeApprovalDecision,
  FileChangeRequestApprovalParams,
} from '@session/bindings/v2';
import { respondToCommandExecutionApproval, respondToFileChangeApproval } from '@session/services';

export type ApprovalRequest =
  | (CommandExecutionRequestApprovalParams & {
      type: 'commandExecution';
      requestId: RequestId;
    })
  | (FileChangeRequestApprovalParams & {
      type: 'fileChange';
      requestId: RequestId;
    });

interface ApprovalStore {
  // State
  pendingApprovals: ApprovalRequest[];
  currentApproval: ApprovalRequest | null;

  // Actions
  addApproval: (approval: ApprovalRequest) => void;
  respondToApproval: (
    requestId: RequestId,
    isCommandExecution: boolean,
    decision: CommandExecutionApprovalDecision | FileChangeApprovalDecision,
    target?: ApprovalRequest
  ) => Promise<void>;
  clearCurrent: () => void;
}

export const useApprovalStore = create<ApprovalStore>((set, get) => ({
  // Initial state
  pendingApprovals: [],
  currentApproval: null,

  // Actions
  addApproval: (approval) => {
    set((state) => ({
      pendingApprovals: state.pendingApprovals.some(r => sameRpc(r, approval)) ? state.pendingApprovals : [...state.pendingApprovals, approval],
      currentApproval: state.currentApproval || approval,
    }));
  },

  respondToApproval: async (requestId, isCommandExecution, decision, target) => {
    const request = target ?? get().pendingApprovals.find(r => r.requestId === requestId);
    if (!request || !get().pendingApprovals.includes(request)) throw new Error('审批已过期，请核对当前请求');
    await deliverRpc(request, () => isCommandExecution
      ? respondToCommandExecutionApproval(requestId, decision as CommandExecutionApprovalDecision, rpcRequestContext(request))
      : respondToFileChangeApproval(requestId, decision as FileChangeApprovalDecision, rpcRequestContext(request)), () => {
        set(state => {
          const pending = state.pendingApprovals.filter(r => r !== request);
          return { pendingApprovals: pending, currentApproval: pending[0] ?? null };
        });
      });
  },

  clearCurrent: () => {
    // Dismissing the view must not discard a live server request.
    set({ currentApproval: null });
  },
}));
