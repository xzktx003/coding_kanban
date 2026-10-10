/** Guardian approval is separate from pending JSON-RPC request approvals.
 * The browser never supplies or reconstructs the raw GuardianAssessmentEvent.
 */
export interface GuardianReviewIdentity {
  threadId: string;
  turnId: string;
  reviewId: string;
  targetItemId: string | null;
  startedAtMs: number;
  completedAtMs: number;
}
export interface GuardianDenialSnapshot {
  identity: GuardianReviewIdentity;
  runtimeInstance: string | null;
  approvalToken: string | null;
  canApprove: boolean;
  canAcceptDirectInput: boolean | null;
  state: "available" | "recorded" | "uncertain" | "rejected" | "unavailable";
  /** Exact public completed notification; no opaque event or private attribution. */
  review: Record<string, unknown> | null;
}
export interface GuardianDenialApproveRequest {
  identity: GuardianReviewIdentity;
  runtimeInstance: string;
  approvalToken: string;
  clientRequestId: string;
}
export interface GuardianDenialResult {
  identity: GuardianReviewIdentity;
  runtimeInstance: string;
  clientRequestId: string;
  state: "recorded" | "uncertain" | "rejected";
}
