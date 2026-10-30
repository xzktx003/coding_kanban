import { act, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useCodexEvents } from "./useCodexEvents";
import { useCodexStore } from "../stores";
const api = vi.hoisted(() => ({
  read: vi.fn(),
  confirmGoalScope: vi.fn(),
  sync: null as null | ((force: boolean) => Promise<void>),
}));
vi.mock("@session/services/apiAdapt/codex", () => ({ getAccountWithParams: api.read }));
vi.mock("@session/services/goalCompletionAutoClear", () => ({
  confirmGoalCompletionAccountScope: api.confirmGoalScope,
}));
vi.mock("@session/hooks/runtime", () => ({
  isDesktopTauri: () => false,
  buildUrl: (path: string) => "fixture" + path,
}));
vi.mock("./useSseEventBridge", () => ({ useSseEventBridge: vi.fn() }));
vi.mock("./useTauriEventListeners", () => ({
  useTauriEventListeners: vi.fn(),
}));
vi.mock("./useServerNotificationHandler", () => ({
  useServerNotificationHandler: (_: any, sync: any) => {
    api.sync = sync;
    return vi.fn();
  },
}));
function Observer({ enabled = true }: { enabled?: boolean }) {
  useCodexEvents(enabled);
  const hasAccount = useCodexStore((s) => s.hasAccount);
  return (
    <div>
      {hasAccount === false
        ? "login-prompt"
        : hasAccount === null
          ? "unknown-account"
          : "known-account"}
    </div>
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  api.read.mockReset();
  useCodexStore.setState({
    account: null,
    hasAccount: null,
    accountNamespace: null,
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
it("keeps authoritative workspace identity separately from the display account", async () => {
  const account = {
    type: "chatgpt",
    email: "fixture@example.invalid",
    planType: "plus",
  };
  api.read
    .mockResolvedValueOnce({
      account,
      workspaceRouting: { chatgptAccountId: "workspace-A" },
    })
    .mockResolvedValueOnce({
      account: { ...account, planType: "pro" },
      workspaceRouting: { chatgptAccountId: "workspace-B" },
    })
    .mockResolvedValueOnce({ account: null });
  render(<Observer />);
  await vi.waitFor(() =>
    expect((useCodexStore.getState() as any).accountNamespace).toBe(
      "workspace-A",
    ),
  );
  await act(async () => api.sync?.(false));
  expect((useCodexStore.getState() as any).accountNamespace).toBe(
    "workspace-B",
  );
  await act(async () => api.sync?.(false));
  expect((useCodexStore.getState() as any).accountNamespace).toBeNull();
});
it("failed initial account read retains unknown and cannot trigger the no-account login flow", async () => {
  api.read.mockRejectedValueOnce(new Error("offline"));
  render(<Observer />);
  await vi.waitFor(() => expect(api.read).toHaveBeenCalledTimes(1));
  expect(useCodexStore.getState().hasAccount).toBeNull();
  expect(screen.queryByText("login-prompt")).toBeNull();
  expect(api.confirmGoalScope).not.toHaveBeenCalled();
});

it("explicitly confirms goal scope only after a valid current account observation, even for equal accounts", async () => {
  const account = { type: "apiKey" as const };
  useCodexStore.setState({ account, hasAccount: true });
  api.read
    .mockResolvedValueOnce({ account })
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce({ account: { ...account } });
  render(<Observer />);
  await vi.waitFor(() => expect(api.confirmGoalScope).toHaveBeenCalledTimes(1));
  await act(async () => api.sync?.(true));
  expect(api.confirmGoalScope).toHaveBeenCalledTimes(1);
  await act(async () => api.sync?.(true));
  expect(api.confirmGoalScope).toHaveBeenCalledTimes(2);
});
it("missing or unknown account payloads retain unknown; only authoritative null becomes signed out", async () => {
  api.read
    .mockResolvedValueOnce({})
    .mockResolvedValueOnce({ account: { type: "future-account" } })
    .mockResolvedValueOnce({ account: null });
  render(<Observer />);
  await vi.waitFor(() => expect(api.read).toHaveBeenCalledTimes(1));
  expect(useCodexStore.getState().hasAccount).toBeNull();
  await act(async () => api.sync?.(false));
  expect(useCodexStore.getState().hasAccount).toBeNull();
  await act(async () => api.sync?.(false));
  expect(useCodexStore.getState().hasAccount).toBe(false);
});
it("failed refresh retains the last known account and authoritative signed-out reads remain false", async () => {
  const account = { type: "apiKey" as const };
  useCodexStore.setState({ account, hasAccount: true });
  api.read
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce({ account: null });
  render(<Observer />);
  await vi.waitFor(() => expect(api.read).toHaveBeenCalledTimes(1));
  expect(useCodexStore.getState().account).toEqual(account);
  expect(useCodexStore.getState().hasAccount).toBe(true);
  await act(async () => api.sync?.(false));
  expect(useCodexStore.getState().hasAccount).toBe(false);
});
it("runtime restart requests one fresh authoritative account observation without polling", async () => {
  api.read
    .mockResolvedValueOnce({ account: { type: "apiKey" } })
    .mockResolvedValueOnce({
      account: {
        type: "chatgpt",
        email: "fixture@example.invalid",
        planType: "plus",
      },
      workspaceRouting: { chatgptAccountId: "workspace-new-runtime" },
    });
  render(<Observer />);
  await vi.waitFor(() => expect(api.confirmGoalScope).toHaveBeenCalledTimes(1));
  act(() => window.dispatchEvent(new Event("session-runtime-restarted")));
  await vi.waitFor(() =>
    expect(useCodexStore.getState().accountNamespace).toBe(
      "workspace-new-runtime",
    ),
  );
  expect(api.read).toHaveBeenCalledTimes(2);
  expect(api.confirmGoalScope).toHaveBeenCalledTimes(2);
});
it("late reads cannot overwrite a newer account observation or the runtime boundary", async () => {
  let resolve!: (value: any) => void;
  api.read
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    )
    .mockResolvedValueOnce({ account: { type: "apiKey" } });
  render(<Observer />);
  await vi.waitFor(() => expect(api.read).toHaveBeenCalledTimes(1));
  await act(async () => api.sync?.(false));
  await act(async () => resolve({ account: null }));
  expect(useCodexStore.getState().hasAccount).toBe(true);
  expect(api.confirmGoalScope).toHaveBeenCalledTimes(1);
  let old!: (value: any) => void;
  api.read.mockImplementationOnce(
    () =>
      new Promise((r) => {
        old = r;
      }),
  );
  let pending!: Promise<void>;
  act(() => {
    pending = api.sync!(false);
  });
  act(() => window.dispatchEvent(new Event("session-runtime-restarted")));
  await act(async () => {
    old({ account: null });
    await pending;
  });
  expect(useCodexStore.getState().hasAccount).toBe(true);
  expect(api.confirmGoalScope).toHaveBeenCalledTimes(1);
});
