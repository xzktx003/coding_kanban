import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type {
  GetAccountRateLimitsResponse,
  GetAccountResponse,
  RateLimitSnapshot,
} from "@session/bindings/v2";
import { NativeCodexUsage } from "./NativeCodexUsage";
let notification: (value: any) => void;
vi.mock("@session/lib/eventStream", () => ({
  openEventStream: ({ onEvent }: any) => {
    notification = (payload) =>
      onEvent({ event: "codex:notification", payload });
    return vi.fn();
  },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: any) =>
      `${key}${values ? JSON.stringify(values) : ""}`,
    i18n: { language: "en" },
  }),
}));
const bucket = (patch: Partial<RateLimitSnapshot> = {}): RateLimitSnapshot => ({
  limitId: "codex",
  limitName: "Codex",
  primary: { usedPercent: 23, windowDurationMins: 120, resetsAt: null },
  secondary: null,
  credits: null,
  individualLimit: null,
  spendControlReached: null,
  planType: null,
  rateLimitReachedType: null,
  ...patch,
});
const response: GetAccountRateLimitsResponse = {
  rateLimits: bucket(),
  rateLimitsByLimitId: {
    codex: bucket(),
    special: bucket({
      limitId: "special",
      limitName: "gpt_special",
      primary: { usedPercent: 99, windowDurationMins: 10080, resetsAt: 100 },
    }),
  },
  rateLimitResetCredits: null,
};
const account: GetAccountResponse = { account: null, requiresOpenaiAuth: true };
it("displays actual bucket windows/remaining quota and refreshes real snapshots for global sparse account updates", async () => {
  const api = {
    readAccount: vi.fn().mockResolvedValue(account),
    readRateLimits: vi.fn().mockResolvedValue(response),
  };
  render(<NativeCodexUsage api={api} />);
  await screen.findByText("gpt-special");
  expect(screen.getByText('accountUsage.remaining{"percent":77}')).toBeTruthy();
  expect(
    screen.getByText('accountUsage.windows.hours{"count":2}:'),
  ).toBeTruthy();
  expect(
    screen.getByText('accountUsage.windows.days{"count":7}:'),
  ).toBeTruthy();
  await act(async () =>
    notification({
      method: "account/rateLimits/updated",
      params: { rateLimits: { primary: null, planType: null } },
    }),
  );
  await waitFor(() => expect(api.readRateLimits).toHaveBeenCalledTimes(2));
});
it("unavailable quota offers explicit retry/login without pretending zero or automatically logging in", async () => {
  const onSignIn = vi.fn();
  const api = {
    readAccount: vi.fn().mockResolvedValue(account),
    readRateLimits: vi.fn().mockRejectedValue(new Error("quota unavailable")),
  };
  render(<NativeCodexUsage api={api} onSignIn={onSignIn} />);
  await screen.findByText("quota unavailable");
  expect(screen.queryByText(/percent/)).toBeNull();
  expect(onSignIn).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "accountUsage.signIn" }));
  expect(onSignIn).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "accountUsage.refresh" }));
  await waitFor(() => expect(api.readRateLimits).toHaveBeenCalledTimes(2));
});
it("runtime boundary immediately clears the previous quota and discards reads already in flight", async () => {
  let old!: (value: GetAccountRateLimitsResponse) => void;
  let current!: (value: GetAccountRateLimitsResponse) => void;
  const api = {
    readAccount: vi.fn().mockResolvedValue(account),
    readRateLimits: vi
      .fn()
      .mockResolvedValueOnce(response)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            old = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            current = resolve;
          }),
      ),
  };
  render(<NativeCodexUsage api={api} />);
  await screen.findByText("gpt-special");
  fireEvent.click(screen.getByRole("button", { name: "accountUsage.refresh" }));
  act(() => window.dispatchEvent(new Event("session-runtime-restarted")));
  expect(screen.queryByText("gpt-special")).toBeNull();
  await vi.waitFor(() => expect(api.readRateLimits).toHaveBeenCalledTimes(3));
  await act(async () => old(response));
  expect(screen.queryByText("gpt-special")).toBeNull();
  await act(async () => current({ ...response, rateLimitsByLimitId: {} }));
  expect(screen.queryByText("gpt-special")).toBeNull();
});
