import { beforeEach, expect, it, vi } from "vitest";
import {
  accountRuntime,
  mutateAccount,
  checkLogout,
  clearAccountMutationJournalForTests,
} from "./account-mutations";
const api = vi.hoisted(() => ({
  health: vi.fn(),
  post: vi.fn(),
  source: "fixture-a",
}));
vi.mock("@session/services/apiAdapt/shared", () => ({
  getJsonWithOptions: api.health,
  postJsonWithOptions: api.post,
}));
vi.mock("@session/hooks/runtime", () => ({
  buildUrl: (path: string) => api.source + path,
}));
const owner = {
  instance: "runtime-a",
  source: "fixture-a/health",
  supportsMutations: true,
};
const account = { type: "apiKey" as const };
beforeEach(() => {
  api.health.mockReset().mockResolvedValue({
    instance: "runtime-a",
    capabilities: { codexAccountMutationsV1: true },
  });
  api.post.mockReset();
  api.source = "fixture-a";
  clearAccountMutationJournalForTests();
});
it("missing capability never detects support with a mutation and missing instance stays unavailable", async () => {
  api.health.mockResolvedValueOnce({ instance: "runtime-a" });
  expect((await accountRuntime()).supportsMutations).toBe(false);
  api.health.mockResolvedValueOnce({
    capabilities: { codexAccountMutationsV1: true },
  });
  await expect(accountRuntime()).rejects.toThrow();
  const result = await mutateAccount({
    operation: "cancel",
    owner: { ...owner, supportsMutations: false },
    loginId: "own-id",
    isCurrent: () => true,
  });
  expect(result.status).toBe("unavailable");
  expect(api.post).not.toHaveBeenCalled();
});
it("cancel sends only captured own login/runtime and rejects changed runtime or source before dispatch", async () => {
  api.post.mockResolvedValueOnce({ status: "canceled" });
  expect(
    (
      await mutateAccount({
        operation: "cancel",
        owner,
        loginId: "own-id",
        isCurrent: () => true,
      })
    ).status,
  ).toBe("complete");
  expect(api.post).toHaveBeenCalledWith(
    "/api/codex/account/login/cancel",
    { loginId: "own-id", runtimeInstance: "runtime-a" },
    { suppressToast: true },
  );
  api.health.mockResolvedValueOnce({
    instance: "runtime-b",
    capabilities: { codexAccountMutationsV1: true },
  });
  expect(
    (
      await mutateAccount({
        operation: "cancel",
        owner,
        loginId: "second",
        isCurrent: () => true,
      })
    ).status,
  ).toBe("rejected");
  api.source = "fixture-b";
  expect(
    (
      await mutateAccount({
        operation: "cancel",
        owner,
        loginId: "third",
        isCurrent: () => true,
      })
    ).status,
  ).toBe("rejected");
  expect(api.post).toHaveBeenCalledTimes(1);
});
it("logout captures exact minimal public account, and an owner change while checking blocks mutation", async () => {
  api.post.mockResolvedValueOnce({});
  expect(
    (
      await mutateAccount({
        operation: "logout",
        owner,
        expectedAccount: account,
        isCurrent: () => true,
      })
    ).status,
  ).toBe("complete");
  expect(api.post).toHaveBeenCalledWith(
    "/api/codex/account/logout",
    { runtimeInstance: "runtime-a", expectedAccount: account },
    { suppressToast: true },
  );
  expect(
    (
      await mutateAccount({
        operation: "logout",
        owner,
        expectedAccount: {
          type: "chatgpt",
          email: "fixture@example.invalid",
          planType: "plus",
        },
        isCurrent: () => false,
      })
    ).status,
  ).toBe("rejected");
  expect(api.post).toHaveBeenCalledTimes(1);
});
it("lost receipts lock repeat sends including a new caller; definite native rejection permits explicit retry", async () => {
  api.post.mockRejectedValueOnce(new Error("lost response"));
  const request = {
    operation: "cancel" as const,
    owner,
    loginId: "own-id",
    isCurrent: () => true,
  };
  expect((await mutateAccount(request)).status).toBe("uncertain");
  expect((await mutateAccount({ ...request })).status).toBe("uncertain");
  expect(api.post).toHaveBeenCalledTimes(1);
  const rejected = { ...request, loginId: "definite" };
  api.post
    .mockRejectedValueOnce(
      Object.assign(new Error("native unsupported"), { status: 501 }),
    )
    .mockResolvedValueOnce({ status: "notFound" });
  expect((await mutateAccount(rejected)).status).toBe("rejected");
  expect((await mutateAccount(rejected)).status).toBe("complete");
  expect(api.post).toHaveBeenCalledTimes(3);
});
it("malformed acknowledgements and late changed-owner receipts cannot claim success", async () => {
  api.post.mockResolvedValueOnce({ status: "ok" });
  expect(
    (
      await mutateAccount({
        operation: "cancel",
        owner,
        loginId: "wrong-receipt",
        isCurrent: () => true,
      })
    ).status,
  ).toBe("uncertain");
  let current = true;
  api.post.mockImplementationOnce(async () => {
    current = false;
    return {};
  });
  expect(
    (
      await mutateAccount({
        operation: "logout",
        owner,
        expectedAccount: account,
        isCurrent: () => current,
      })
    ).status,
  ).toBe("uncertain");
});
it("uncertain logout can settle only by readonly same-runtime account absence and cannot resend", async () => {
  const request = {
    operation: "logout" as const,
    owner,
    expectedAccount: account,
    isCurrent: () => true,
  };
  api.post.mockRejectedValueOnce(new Error("unknown"));
  await mutateAccount(request);
  api.post.mockResolvedValueOnce({ account });
  expect((await checkLogout(request)).status).toBe("uncertain");
  api.post.mockResolvedValueOnce({ account: null });
  expect((await checkLogout(request)).status).toBe("complete");
  expect((await mutateAccount(request)).status).toBe("uncertain");
  expect(api.post.mock.calls.map((call) => call[0])).toEqual([
    "/api/codex/account/logout",
    "/api/codex/account/get",
    "/api/codex/account/get",
  ]);
});
it("a stored receipt is a duplicate-send lock and cannot act as a native success acknowledgement", async () => {
  api.post.mockResolvedValueOnce({ status: "canceled" });
  const request = {
    operation: "cancel" as const,
    owner,
    loginId: "own-id",
    isCurrent: () => true,
  };
  expect((await mutateAccount(request)).status).toBe("complete");
  expect(
    (await mutateAccount({ ...request, isCurrent: () => false })).status,
  ).toBe("uncertain");
  expect(api.post).toHaveBeenCalledTimes(1);
});
it("completed cancellations cannot exhaust future actions; uncertain receipts remain locked", async () => {
  api.post.mockRejectedValueOnce(new Error("unknown"));
  const unknown = {
    operation: "cancel" as const,
    owner,
    loginId: "uncertain-old",
    isCurrent: () => true,
  };
  await mutateAccount(unknown);
  api.post.mockResolvedValue({ status: "canceled" });
  for (let index = 0; index < 101; index++) {
    expect(
      (await mutateAccount({ ...unknown, loginId: `completed-${index}` }))
        .status,
    ).toBe("complete");
  }
  expect((await mutateAccount(unknown)).status).toBe("uncertain");
  expect(api.post).toHaveBeenCalledTimes(102);
});
