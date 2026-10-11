import type { ServerNotification } from "@session/bindings";
import type { ItemGuardianApprovalReviewCompletedNotification } from "@session/bindings/v2/ItemGuardianApprovalReviewCompletedNotification";
import { nativeAutomaticReviewActionLabel } from "../presentation/nativeAutomaticReviewLabels";

export interface AutoReviewDenialRow {
  review: ItemGuardianApprovalReviewCompletedNotification;
  title: string;
  rationale: string;
}

function isCompletedDenial(
  event: ServerNotification,
  threadId: string,
): event is ServerNotification & {
  method: "item/autoApprovalReview/completed";
  params: ItemGuardianApprovalReviewCompletedNotification;
} {
  if (event.method !== "item/autoApprovalReview/completed") return false;
  const params = event.params;
  return (
    params.threadId === threadId &&
    params.decisionSource === "agent" &&
    params.review.status === "denied"
  );
}

/** Newest denied auto-review first. The same review identity keeps one row. */
export function listAutoReviewDenials(
  events: ServerNotification[],
  threadId: string | null,
): AutoReviewDenialRow[] {
  if (!threadId) return [];
  const rows = new Map<string, AutoReviewDenialRow>();
  for (const event of events) {
    if (!isCompletedDenial(event, threadId)) continue;
    const review = event.params;
    const key = [
      review.threadId,
      review.turnId,
      review.reviewId,
      review.targetItemId ?? "",
    ].join(":");
    rows.set(key, {
      review,
      title: nativeAutomaticReviewActionLabel(review.action, "zh") || "请求",
      rationale: review.review.rationale?.trim() || "自动审查未提供理由",
    });
  }
  return [...rows.values()].reverse();
}
