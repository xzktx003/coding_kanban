import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useCodexStore } from "@session/components/codex/stores";
import { NativeAccountLogout } from "./NativeAccountLogout";
import { clearAccountMutationJournalForTests } from "./account-mutations";
const api = vi.hoisted(() => ({ health: vi.fn(), post: vi.fn() }));
vi.mock("@session/services/apiAdapt/shared", () => ({
  getJsonWithOptions: api.health,
  postJsonWithOptions: api.post,
}));
vi.mock("@session/hooks/runtime", () => ({
  buildUrl: (path: string) => "fixture-a" + path,
}));
beforeEach(() => {
  api.health
    .mockReset()
    .mockResolvedValue({
      instance: "runtime-a",
      capabilities: { codexAccountMutationsV1: true },
    });
  api.post.mockReset();
  useCodexStore.setState({ account: { type: "apiKey" }, hasAccount: true });
  clearAccountMutationJournalForTests();
});
it("an explicit current-account logout is capability gated; opening it never mutates", async () => {
  api.health.mockResolvedValueOnce({ instance: "runtime-a" });
  const mounted = render(<NativeAccountLogout open />);
  await act(async () => {});
  expect(
    screen.queryByRole("button", { name: "退出当前 Codex 账户" }),
  ).toBeNull();
  expect(api.post).not.toHaveBeenCalled();
  mounted.unmount();
  const loggedOut = vi.fn();
  api.post.mockResolvedValueOnce({});
  render(<NativeAccountLogout open onLoggedOut={loggedOut} />);
  fireEvent.click(
    await screen.findByRole("button", { name: "退出当前 Codex 账户" }),
  );
  await vi.waitFor(() => expect(loggedOut).toHaveBeenCalledTimes(1));
  expect(api.post).toHaveBeenCalledWith(
    "/api/codex/account/logout",
    { runtimeInstance: "runtime-a", expectedAccount: { type: "apiKey" } },
    { suppressToast: true },
  );
  expect(useCodexStore.getState().hasAccount).toBe(false);
});
it("a late logout receipt cannot clear another account; uncertainty keeps logout locked", async () => {
  let resolve!: (value: any) => void;
  api.post.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const loggedOut = vi.fn();
  render(<NativeAccountLogout open onLoggedOut={loggedOut} />);
  fireEvent.click(
    await screen.findByRole("button", { name: "退出当前 Codex 账户" }),
  );
  await vi.waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
  const next = {
    type: "chatgpt" as const,
    email: "next@example.invalid",
    planType: "plus" as const,
  };
  act(() => useCodexStore.getState().setAccount(next));
  await act(async () => resolve({}));
  await screen.findByText(/不会重复发送/);
  expect(useCodexStore.getState().account).toEqual(next);
  expect(loggedOut).not.toHaveBeenCalled();
  expect(
    (
      screen.getByRole("button", {
        name: "退出当前 Codex 账户",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
});
it("unknown logout is settled by explicit readonly checking, without duplicate logout", async () => {
  api.post
    .mockRejectedValueOnce(new Error("unknown"))
    .mockResolvedValueOnce({ account: null });
  const loggedOut = vi.fn();
  render(<NativeAccountLogout open onLoggedOut={loggedOut} />);
  fireEvent.click(
    await screen.findByRole("button", { name: "退出当前 Codex 账户" }),
  );
  fireEvent.click(await screen.findByRole("button", { name: "检查退出状态" }));
  await vi.waitFor(() => expect(loggedOut).toHaveBeenCalledTimes(1));
  expect(api.post.mock.calls.map((call) => call[0])).toEqual([
    "/api/codex/account/logout",
    "/api/codex/account/get",
  ]);
});
