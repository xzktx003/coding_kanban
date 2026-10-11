import { describe, expect, it } from "vitest";
import type { ServerNotification } from "@session/bindings";
import { listAutoReviewDenials } from "./autoReviewDenials";

const denial = (
  reviewId: string,
  extra: Record<string, unknown> = {},
): ServerNotification =>
  ({
    method: "item/autoApprovalReview/completed",
    params: {
      threadId: "ux-0",
      turnId: "turn-1",
      reviewId,
      targetItemId: "item-1",
      startedAtMs: 1,
      completedAtMs: 2,
      decisionSource: "agent",
      review: {
        status: "denied",
        riskLevel: "high",
        userAuthorization: "unknown",
        rationale: " 需要明确授权 ",
      },
      action: {
        type: "command",
        source: "shell",
        command: `curl ${reviewId}`,
        cwd: "/fixture",
      },
      ...extra,
    },
  }) as ServerNotification;

describe("listAutoReviewDenials", () => {
  it("keeps the newest agent denial for this thread and drops other reviews", () => {
    const rows = listAutoReviewDenials(
      [
        denial("older"),
        denial("older", { completedAtMs: 9 }),
        denial("other-thread", { threadId: "ux-1" }),
        {
          method: "item/autoApprovalReview/started",
          params: { threadId: "ux-0", review: { status: "inProgress" } },
        } as ServerNotification,
        denial("user", { decisionSource: "user" }),
        denial("approved", {
          review: {
            status: "approved",
            riskLevel: null,
            userAuthorization: null,
            rationale: null,
          },
        }),
        denial("blank", {
          review: {
            status: "denied",
            riskLevel: "low",
            userAuthorization: null,
            rationale: "  ",
          },
          action: { type: "unknown" },
        }),
      ],
      "ux-0",
    );
    expect(rows.map((row) => row.review.reviewId)).toEqual([
      "blank",
      "older",
    ]);
    expect(rows[1]).toMatchObject({
      title: "curl older",
      rationale: "需要明确授权",
      review: { completedAtMs: 9 },
    });
    expect(rows[0].rationale).toBe("自动审查未提供理由");
    expect(rows[0].title).toBe("请求");
    expect(listAutoReviewDenials([], null)).toEqual([]);
  });
});
