import { expect, it, vi } from "vitest";
import type {
  GetAccountResponse,
  GetAccountRateLimitsResponse,
} from "@session/bindings/v2";
import { CodexAccountUsageController } from "./controller";
const account: GetAccountResponse = {
  account: {
    type: "chatgpt",
    email: "fixture@example.invalid",
    planType: "plus",
  },
  requiresOpenaiAuth: true,
};
const response: GetAccountRateLimitsResponse = {
  rateLimits: {
    limitId: "codex",
    limitName: "Codex",
    primary: { usedPercent: 20, windowDurationMins: 300, resetsAt: 100 },
    secondary: null,
    credits: null,
    individualLimit: null,
    spendControlReached: null,
    planType: null,
    rateLimitReachedType: null,
  },
  rateLimitsByLimitId: null,
  rateLimitResetCredits: null,
};
it("only readonly account/rate reads run, and full snapshot is refetched on sparse updates", async () => {
  const readAccount = vi.fn().mockResolvedValue(account),
    readRateLimits = vi.fn().mockResolvedValue(response);
  const controller = new CodexAccountUsageController({
    readAccount,
    readRateLimits,
  });
  await controller.refresh();
  expect(controller.getState().response).toEqual(response);
  controller.notification({
    method: "account/rateLimits/updated",
    params: { rateLimits: { primary: { usedPercent: 99 }, planType: null } },
  });
  await vi.waitFor(() => expect(readRateLimits).toHaveBeenCalledTimes(2));
  expect(controller.getState().response).toEqual(response);
  controller.notification({
    method: "turn/started",
    params: { threadId: "other" },
  });
  expect(readRateLimits).toHaveBeenCalledTimes(2);
});
it("account change invalidates cached quota immediately and rejects late former-account reads", async () => {
  let resolve!: (value: GetAccountRateLimitsResponse) => void;
  const readRateLimits = vi
    .fn()
    .mockResolvedValueOnce(response)
    .mockImplementationOnce(() => new Promise((r) => (resolve = r)))
    .mockResolvedValueOnce({ ...response, rateLimitsByLimitId: {} });
  const controller = new CodexAccountUsageController({
    readAccount: async () => account,
    readRateLimits,
  });
  await controller.refresh();
  const old = controller.refresh();
  controller.notification({
    method: "account/updated",
    params: { authMode: "apiKey" },
  });
  expect(controller.getState().response).toBeNull();
  await vi.waitFor(() =>
    expect(controller.getState().response?.rateLimitsByLimitId).toEqual({}),
  );
  resolve(response);
  await old;
  expect(controller.getState().response?.rateLimitsByLimitId).toEqual({});
});
it("unavailable rate limits clear old percentages and retain explicit recovery, failed login does not refresh", async () => {
  const readRateLimits = vi
    .fn()
    .mockResolvedValueOnce(response)
    .mockRejectedValueOnce(new Error("offline"));
  const controller = new CodexAccountUsageController({
    readAccount: async () => account,
    readRateLimits,
  });
  await controller.refresh();
  await controller.refresh();
  expect(controller.getState().response).toBeNull();
  expect(controller.getState().error).toBe("offline");
  controller.notification({
    method: "account/login/completed",
    params: { success: false },
  });
  expect(readRateLimits).toHaveBeenCalledTimes(2);
});
it("dispose stops late updates and cancels captured readonly reads", async () => {
  let resolve!: (value: GetAccountRateLimitsResponse) => void;
  let captured: AbortSignal | undefined;
  const controller = new CodexAccountUsageController({
    readAccount: async () => account,
    readRateLimits: (signal) => {
      captured = signal;
      return new Promise((r) => (resolve = r));
    },
  });
  const pending = controller.refresh();
  controller.dispose();
  expect(captured?.aborted).toBe(true);
  resolve(response);
  await pending;
  expect(controller.getState().response).toBeNull();
});
