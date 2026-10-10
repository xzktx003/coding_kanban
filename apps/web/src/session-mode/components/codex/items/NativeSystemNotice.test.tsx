import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { EventItem } from "./EventItem";
vi.mock("@session/contexts/ThemeContext", () => ({
  useThemeContext: () => ({ resolvedTheme: "dark" }),
}));
it("renders actual cyber model routing notice without changing the user's chosen model", () => {
  render(
    <EventItem
      event={
        {
          method: "model/rerouted",
          params: {
            threadId: "owner",
            turnId: "turn",
            fromModel: "gpt-a",
            toModel: "gpt-b",
            reason: "highRiskCyberActivity",
          },
        } as never
      }
    />,
  );
  expect(screen.getByText(/gpt-b/i)).toBeTruthy();
  expect(screen.queryByText("model/rerouted")).toBeNull();
});
it("keeps approved review hidden and shows the native explicit-authorization explanation for a denied action", () => {
  const params = {
    threadId: "owner",
    turnId: "turn",
    reviewId: "review",
    targetItemId: "item",
    review: {
      status: "approved",
      riskLevel: "high",
      userAuthorization: "unknown",
      rationale: "Needs explicit scope",
    },
    action: {
      type: "command",
      command: "curl target",
      cwd: "/owner",
      source: "agent",
    },
  };
  const { rerender } = render(
    <EventItem
      event={{ method: "item/autoApprovalReview/completed", params } as never}
    />,
  );
  expect(document.body.textContent).toBe("");
  rerender(
    <EventItem
      event={
        {
          method: "item/autoApprovalReview/completed",
          params: { ...params, review: { ...params.review, status: "denied" } },
        } as never
      }
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /curl target/ }));
  expect(screen.queryByText("Needs explicit scope")).toBeNull();
  expect(screen.queryByText("自动审核已拒绝")).toBeNull();
  expect(screen.queryByText("操作详情")).toBeNull();
  expect(screen.getByText(/需要明确授权/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "批准" })).toBeNull();
});
it("keeps non-denied automatic review rationale behind its native second disclosure", () => {
  const params = {
    threadId: "owner",
    turnId: "turn",
    reviewId: "review",
    targetItemId: "item",
    review: {
      status: "timedOut",
      riskLevel: null,
      userAuthorization: null,
      rationale: "Real timeout rationale",
    },
    action: {
      type: "command",
      command: "timeout target",
      cwd: "/owner",
      source: "agent",
    },
  };
  render(
    <EventItem
      event={{ method: "item/autoApprovalReview/completed", params } as never}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "timeout target" }));
  expect(screen.queryByText("Real timeout rationale")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "自动审核超时" }));
  expect(screen.getByText("Real timeout rationale")).toBeTruthy();
});
it("keeps unknown started native tools diagnosable without eagerly showing unknown fields", () => {
  render(
    <EventItem
      event={
        {
          method: "item/started",
          params: {
            threadId: "owner",
            turnId: "turn",
            item: { type: "newNativeTool", id: "item", value: 42 },
          },
        } as never
      }
    />,
  );
  expect(screen.getByText("newNativeTool")).toBeTruthy();
  expect(screen.queryByText(/42/)).toBeNull();
});
