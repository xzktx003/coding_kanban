import { expect, it } from "vitest";
import {
  isBareContinuation,
  isProviderSafetyBlock,
  threadBlockedByProviderSafety,
} from "./providerSafetyBlock";

const blocked = {
  method: "error",
  params: {
    willRetry: false,
    error: {
      message:
        "This request was blocked by our safety systems. Reason: Potentially unintended activity.",
      codexErrorInfo: "misalignment_policy_violation",
    },
  },
};

it("recognizes the provider safety refusal and a bare continuation", () => {
  expect(isProviderSafetyBlock(blocked.params.error.message, blocked.params.error.codexErrorInfo)).toBe(true);
  expect(isProviderSafetyBlock("ordinary capacity error")).toBe(false);
  expect(isBareContinuation("继续")).toBe(true);
  expect(isBareContinuation("继续看这个报错")).toBe(false);
});

it("keeps a blocked thread blocked until a later completed turn", () => {
  expect(threadBlockedByProviderSafety([blocked])).toBe(true);
  expect(threadBlockedByProviderSafety([
    blocked,
    { method: "turn/completed", params: { turn: { status: "completed" } } },
  ])).toBe(false);
  expect(threadBlockedByProviderSafety([
    { method: "error", params: { willRetry: false, error: { message: "busy" } } },
  ])).toBe(false);
});
