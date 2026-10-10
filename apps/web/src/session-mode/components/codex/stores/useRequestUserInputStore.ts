import { deliverRpc, rpcRequestContext } from "./rpcLifecycle";
import { create } from "zustand";
import type { RequestId } from "@session/bindings";
import type { ToolRequestUserInputResponse } from "@session/bindings/v2";
import { respondToRequestUserInput } from "@session/services";

// Older app-server versions omit flags/descriptions. Keep that compatibility,
// including isSecret and nullable options from the generated protocol.
type Question = {
  id: string;
  header?: string;
  question: string;
  options?: Array<{ label: string; description?: string }> | null;
  isOther?: boolean;
  isSecret?: boolean;
};
export type RequestUserInputRequest = {
  requestToken?: string;
  requestId: RequestId;
  threadId: string;
  turnId: string;
  itemId: string;
  questions: Question[];
  autoResolutionMs?: number | null;
};
export type UserInputDraft = {
  index: number;
  collapsed: boolean;
  answers: Record<string, string[]>;
  custom: Record<string, boolean>;
  customText?: Record<string, string>;
};
export const requestUserInputKey = (request: RequestUserInputRequest) =>
  JSON.stringify([
    request.threadId,
    request.requestId,
    request.turnId,
    request.itemId,
    request.requestToken,
  ]);
const emptyDraft = (): UserInputDraft => ({
  index: 0,
  collapsed: false,
  answers: {},
  custom: {},
});
const submittingRequests = new Set<string>();
interface RequestUserInputStore {
  pendingRequests: RequestUserInputRequest[];
  currentRequest: RequestUserInputRequest | null;
  // Intentionally memory-only: includes potentially secret/free-form answers.
  drafts: Record<string, UserInputDraft>;
  addRequest: (request: RequestUserInputRequest) => void;
  replaceRequests: (requests: RequestUserInputRequest[]) => void;
  updateDraft: (
    request: RequestUserInputRequest,
    update: Partial<UserInputDraft>,
  ) => void;
  resolveRequest: (threadId: string, requestId: RequestId) => void;
  clearThread: (threadId: string, turnId?: string) => void;
  respondToRequest: (
    requestId: RequestId,
    response: ToolRequestUserInputResponse,
    threadId?: string,
    target?: RequestUserInputRequest,
  ) => Promise<void>;
  clearCurrent: () => void;
}
function retainedDrafts(
  requests: RequestUserInputRequest[],
  drafts: Record<string, UserInputDraft>,
) {
  return Object.fromEntries(
    requests.map((r) => [
      requestUserInputKey(r),
      drafts[requestUserInputKey(r)] ?? emptyDraft(),
    ]),
  );
}
export const useRequestUserInputStore = create<RequestUserInputStore>(
  (set, get) => ({
    pendingRequests: [],
    currentRequest: null,
    drafts: {},
    addRequest: (request) =>
      set((state) => {
        const key = requestUserInputKey(request);
        if (state.pendingRequests.some((r) => requestUserInputKey(r) === key))
          return state;
        const pendingRequests = [...state.pendingRequests, request];
        return {
          pendingRequests,
          currentRequest: pendingRequests[0],
          drafts: retainedDrafts(pendingRequests, state.drafts),
        };
      }),
    replaceRequests: (requests) =>
      set((state) => ({
        pendingRequests: requests.map(
          (r) =>
            state.pendingRequests.find(
              (old) =>
                requestUserInputKey(old) === requestUserInputKey(r) &&
                JSON.stringify(old) === JSON.stringify(r),
            ) ?? r,
        ),
        currentRequest: requests[0] ?? null,
        drafts: retainedDrafts(requests, state.drafts),
      })),
    updateDraft: (request, update) =>
      set((state) => {
        const key = requestUserInputKey(request);
        if (!state.pendingRequests.some((r) => requestUserInputKey(r) === key))
          return state;
        return {
          drafts: {
            ...state.drafts,
            [key]: { ...(state.drafts[key] ?? emptyDraft()), ...update },
          },
        };
      }),
    resolveRequest: (threadId, requestId) =>
      set((state) => {
        const pendingRequests = state.pendingRequests.filter(
          (r) => r.threadId !== threadId || r.requestId !== requestId,
        );
        return {
          pendingRequests,
          currentRequest: pendingRequests[0] ?? null,
          drafts: retainedDrafts(pendingRequests, state.drafts),
        };
      }),
    clearThread: (threadId, turnId) => {
      const requests = get().pendingRequests.filter(
        (r) =>
          r.threadId !== threadId ||
          (turnId !== undefined && r.turnId !== turnId),
      );
      get().replaceRequests(requests);
    },
    respondToRequest: async (requestId, response, threadId, target) => {
      const request =
        target ??
        get().pendingRequests.find(
          (r) =>
            r.requestId === requestId &&
            (threadId === undefined || r.threadId === threadId),
        );
      if (
        !request ||
        request.requestId !== requestId ||
        (threadId !== undefined && request.threadId !== threadId) ||
        !get().pendingRequests.includes(request)
      )
        throw new Error("Question is no longer pending");
      const key = requestUserInputKey(request);
      if (submittingRequests.has(key)) return;
      submittingRequests.add(key);
      try {
        await deliverRpc(
          request,
          () =>
            respondToRequestUserInput(
              requestId,
              response,
              rpcRequestContext(request),
            ),
          () => {
            get().replaceRequests(
              get().pendingRequests.filter((r) => r !== request),
            );
          },
        );
      } finally {
        submittingRequests.delete(key);
      }
    },
    // Closing is a visual action only. It must not silently discard a live RPC.
    clearCurrent: () => {
      const request = get().currentRequest;
      if (request) get().updateDraft(request, { collapsed: true });
    },
  }),
);
