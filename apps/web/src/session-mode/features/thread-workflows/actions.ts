import { create } from "zustand";
export type ThreadWorkflowAction = "search" | "users" | "export" | "copyLink";
export interface WorkflowActionRequest {
  id: number;
  threadId: string;
  action: "export" | "copyLink";
}
interface WorkflowActions {
  panels: Record<string, "search" | "users">;
  requests: Record<string, WorkflowActionRequest>;
  focusRequests: Record<string, { id: number; ownerRoot?: HTMLElement }>;
  moveRequests: Record<
    string,
    { id: number; step: 1 | -1; ownerRoot?: HTMLElement }
  >;
}
export const useThreadWorkflowActions = create<WorkflowActions>(() => ({
  panels: {},
  requests: {},
  focusRequests: {},
  moveRequests: {},
}));
let sequence = 0;
export const threadWorkflowActions = {
  move: (
    threadId: string,
    step: 1 | -1,
    options?: { ownerRoot?: HTMLElement },
  ) => {
    useThreadWorkflowActions.setState((state) =>
      state.panels[threadId] === "search"
        ? {
            moveRequests: {
              ...state.moveRequests,
              [threadId]: {
                id: ++sequence,
                step,
                ownerRoot: options?.ownerRoot,
              },
            },
          }
        : state,
    );
  },
  consumeMove: (threadId: string, id: number) => {
    let accepted = false;
    useThreadWorkflowActions.setState((state) => {
      if (state.moveRequests[threadId]?.id !== id) return state;
      accepted = true;
      const moveRequests = { ...state.moveRequests };
      delete moveRequests[threadId];
      return { moveRequests };
    });
    return accepted;
  },
  request: (
    threadId: string,
    action: ThreadWorkflowAction,
    options?: { focus?: boolean; ownerRoot?: HTMLElement },
  ) => {
    if (!threadId) return;
    useThreadWorkflowActions.setState((state) =>
      action === "search" || action === "users"
        ? {
            panels: { ...state.panels, [threadId]: action },
            ...(options?.focus
              ? {
                  focusRequests: {
                    ...state.focusRequests,
                    [threadId]: {
                      id: ++sequence,
                      ownerRoot: options.ownerRoot,
                    },
                  },
                }
              : {}),
          }
        : {
            requests: {
              ...state.requests,
              [threadId]: { id: ++sequence, threadId, action },
            },
          },
    );
  },
  consumeFocus: (threadId: string, id: number) => {
    let accepted = false;
    useThreadWorkflowActions.setState((state) => {
      if (state.focusRequests[threadId]?.id !== id) return state;
      accepted = true;
      const focusRequests = { ...state.focusRequests };
      delete focusRequests[threadId];
      return { focusRequests };
    });
    return accepted;
  },
  consume: (request: WorkflowActionRequest) => {
    let accepted = false;
    useThreadWorkflowActions.setState((state) => {
      if (state.requests[request.threadId]?.id !== request.id) return state;
      accepted = true;
      const requests = { ...state.requests };
      delete requests[request.threadId];
      return { requests };
    });
    return accepted;
  },
  close: (threadId: string) =>
    useThreadWorkflowActions.setState((state) => {
      const panels = { ...state.panels };
      const focusRequests = { ...state.focusRequests };
      const moveRequests = { ...state.moveRequests };
      delete panels[threadId];
      delete focusRequests[threadId];
      delete moveRequests[threadId];
      return { panels, focusRequests, moveRequests };
    }),
};
