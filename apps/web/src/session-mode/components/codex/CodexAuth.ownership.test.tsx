import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { CodexAuth } from "./CodexAuth";
import { clearAccountMutationJournalForTests } from "@session/features/codex-account/account-mutations";

const api = vi.hoisted(() => ({
  read: vi.fn(),
  login: vi.fn(),
  health: vi.fn(),
  snapshot: vi.fn(),
  open: vi.fn(),
  event: null as null | ((event: any) => void),
  source: "fixture-a",
  tauri: false,
  tauriEvent: null as null | ((event: any) => void),
  subscriptions: vi.fn(),
  post: vi.fn(),
}));
vi.mock("@session/services", () => ({
  getAccountWithParams: api.read,
  loginAccount: api.login,
  saveAccountSnapshot: api.snapshot,
}));
vi.mock("@session/services/apiAdapt/shared", () => ({
  getJsonWithOptions: api.health,
  postJsonWithOptions: api.post,
}));
vi.mock("@session/hooks/runtime", () => ({
  isTauri: () => api.tauri,
  buildUrl: (path: string) => api.source + path,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (_: string, callback: any) => {
    api.tauriEvent = callback;
    return () => {
      api.tauriEvent = null;
    };
  },
}));
vi.mock("@session/browser-opener", () => ({ open: api.open }));
vi.mock("@session/lib/eventStream", () => ({
  openEventStream: ({ onEvent }: any) => {
    api.event = onEvent;
    api.subscriptions();
    return () => {
      api.event = null;
    };
  },
}));
beforeEach(() => {
  vi.clearAllMocks();
  clearAccountMutationJournalForTests();
  api.source = "fixture-a";
  api.tauri = false;
  api.health.mockReset();
  api.login.mockReset();
  api.read.mockResolvedValue({ account: null, requiresOpenaiAuth: true });
  api.health.mockResolvedValue({ instance: "runtime-a" });
  api.login.mockResolvedValue({
    type: "chatgptDeviceCode",
    loginId: "own-login",
    verificationUrl: "https://example.invalid/device",
    userCode: "FIXTURE",
  });
});
it("explicit Cancel is capability gated and sends only this actual login ID and runtime", async () => {
  api.health.mockResolvedValue({
    instance: "runtime-a",
    capabilities: { codexAccountMutationsV1: true },
  });
  api.post.mockResolvedValueOnce({ status: "canceled" });
  const authenticated = vi.fn();
  render(<CodexAuth onAuthenticated={authenticated} />);
  await start();
  fireEvent.click(screen.getByRole("button", { name: "取消本次登录" }));
  await screen.findByText("已取消本次登录");
  expect(api.post).toHaveBeenCalledWith(
    "/api/codex/account/login/cancel",
    { loginId: "own-login", runtimeInstance: "runtime-a" },
    { suppressToast: true },
  );
  expect(authenticated).not.toHaveBeenCalled();
  expect(screen.queryByText("FIXTURE")).toBeNull();
});
it("native notFound ends only the local waiting flow and cannot claim a successful cancellation or login", async () => {
  api.health.mockResolvedValue({
    instance: "runtime-a",
    capabilities: { codexAccountMutationsV1: true },
  });
  api.post.mockResolvedValueOnce({ status: "notFound" });
  const authenticated = vi.fn();
  render(<CodexAuth onAuthenticated={authenticated} />);
  await start();
  fireEvent.click(screen.getByRole("button", { name: "取消本次登录" }));
  await screen.findByText("未找到待取消的登录；请检查当前登录状态。");
  expect(screen.queryByText("已取消本次登录")).toBeNull();
  expect(screen.queryByText("FIXTURE")).toBeNull();
  expect(authenticated).not.toHaveBeenCalled();
});
it("old runtime hides Cancel and unknown cancellation receipt disables repeat sends", async () => {
  const mounted = render(<CodexAuth />);
  await start();
  expect(screen.queryByRole("button", { name: "取消本次登录" })).toBeNull();
  mounted.unmount();
  api.health.mockResolvedValue({
    instance: "runtime-a",
    capabilities: { codexAccountMutationsV1: true },
  });
  api.post.mockRejectedValueOnce(new Error("lost cancel receipt"));
  render(<CodexAuth />);
  await start();
  fireEvent.click(screen.getByRole("button", { name: "取消本次登录" }));
  await screen.findByText(/不会重复发送/);
  const button = screen.getByRole("button", {
    name: "取消本次登录",
  }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  fireEvent.click(button);
  expect(api.post).toHaveBeenCalledTimes(1);
});
async function completed(loginId: string | null, success = true) {
  await act(async () =>
    api.event?.({
      event: "codex:notification",
      payload: {
        method: "account/login/completed",
        params: { loginId, success, error: success ? null : "fixture failure" },
      },
    }),
  );
}
async function start() {
  fireEvent.click(screen.getByRole("button", { name: "登录 ChatGPT" }));
  await screen.findByText("FIXTURE");
}
it("only the captured actual login ID completes this dialog; null/foreign completions preserve its pending flow", async () => {
  const authenticated = vi.fn();
  render(<CodexAuth onAuthenticated={authenticated} />);
  await start();
  await completed(null);
  await completed("foreign-login");
  expect(authenticated).not.toHaveBeenCalled();
  expect(screen.getByText("FIXTURE")).toBeTruthy();
  expect(api.login).toHaveBeenCalledTimes(1);
  await completed("own-login");
  expect(authenticated).toHaveBeenCalledTimes(1);
  expect(screen.queryByText("FIXTURE")).toBeNull();
  await completed("own-login");
  expect(authenticated).toHaveBeenCalledTimes(1);
});
it("a changed actual runtime or source cannot accept even the same login ID", async () => {
  const authenticated = vi.fn();
  render(<CodexAuth onAuthenticated={authenticated} />);
  await start();
  api.health.mockResolvedValue({ instance: "runtime-b" });
  await completed("own-login");
  expect(authenticated).not.toHaveBeenCalled();
  api.health.mockResolvedValue({ instance: "runtime-a" });
  api.source = "fixture-b";
  await completed("own-login");
  expect(authenticated).not.toHaveBeenCalled();
});
it("runtime restart invalidates pending HTTP acknowledgement and late completion without opening its link", async () => {
  let resolve!: (value: any) => void;
  api.login.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const authenticated = vi.fn();
  render(<CodexAuth onAuthenticated={authenticated} />);
  fireEvent.click(screen.getByRole("button", { name: "登录 ChatGPT" }));
  await vi.waitFor(() => expect(api.login).toHaveBeenCalledTimes(1));
  act(() => window.dispatchEvent(new Event("session-runtime-restarted")));
  await act(async () =>
    resolve({
      type: "chatgpt",
      loginId: "old-login",
      authUrl: "https://example.invalid/old",
    }),
  );
  await completed("old-login");
  expect(authenticated).not.toHaveBeenCalled();
  expect(api.open).not.toHaveBeenCalled();
  expect(screen.queryByRole("link")).toBeNull();
});
it("unknown runtime blocks login; lost login acknowledgement locks retries without automatic replay", async () => {
  const authenticated = vi.fn();
  api.health.mockRejectedValueOnce(new Error("offline"));
  render(<CodexAuth onAuthenticated={authenticated} />);
  fireEvent.click(screen.getByRole("button", { name: "登录 ChatGPT" }));
  await screen.findByText(/offline/);
  expect(api.login).not.toHaveBeenCalled();
  api.login.mockRejectedValueOnce(new Error("lost acknowledgement"));
  fireEvent.click(screen.getByRole("button", { name: "登录 ChatGPT" }));
  await screen.findByText(/lost acknowledgement/);
  const button = screen.getByRole("button", {
    name: /登录 ChatGPT|Starting ChatGPT login/,
  });
  expect((button as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(button);
  await completed("unknown-login");
  expect(api.login).toHaveBeenCalledTimes(1);
  expect(authenticated).not.toHaveBeenCalled();
});
it("completion racing before the HTTP acknowledgement is reconciled only after its actual ID and runtime are verified", async () => {
  let resolve!: (value: any) => void;
  api.login.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const authenticated = vi.fn();
  render(<CodexAuth onAuthenticated={authenticated} />);
  fireEvent.click(screen.getByRole("button", { name: "登录 ChatGPT" }));
  await vi.waitFor(() => expect(api.login).toHaveBeenCalledTimes(1));
  await completed("foreign-login");
  await completed("own-login");
  expect(authenticated).not.toHaveBeenCalled();
  await act(async () =>
    resolve({
      type: "chatgptDeviceCode",
      loginId: "own-login",
      verificationUrl: "https://example.invalid/device",
      userCode: "FIXTURE",
    }),
  );
  expect(authenticated).toHaveBeenCalledTimes(1);
  expect(screen.queryByText("FIXTURE")).toBeNull();
});
it("Tauri uses the same exact ownership guard and changing callback does not resubscribe browser SSE", async () => {
  api.tauri = true;
  const authenticated = vi.fn();
  const mounted = render(<CodexAuth onAuthenticated={authenticated} />);
  await start();
  await act(async () =>
    api.tauriEvent?.({
      payload: {
        method: "account/login/completed",
        params: { loginId: "foreign", success: true, error: null },
      },
    }),
  );
  expect(authenticated).not.toHaveBeenCalled();
  await act(async () =>
    api.tauriEvent?.({
      payload: {
        method: "account/login/completed",
        params: { loginId: "own-login", success: true, error: null },
      },
    }),
  );
  expect(authenticated).toHaveBeenCalledTimes(1);
  mounted.unmount();
  api.tauri = false;
  const browser = render(<CodexAuth onAuthenticated={authenticated} />);
  await start();
  const next = vi.fn();
  browser.rerender(<CodexAuth onAuthenticated={next} />);
  expect(api.subscriptions).toHaveBeenCalledTimes(1);
  await completed("own-login");
  expect(next).toHaveBeenCalledTimes(1);
});
it("authoritative own failure unlocks login; a foreign failure leaves own code and status intact", async () => {
  render(<CodexAuth />);
  await start();
  const button = screen.getByRole("button", { name: /Starting ChatGPT login/ });
  expect((button as HTMLButtonElement).disabled).toBe(true);
  await completed("foreign-login", false);
  expect(screen.queryByText("fixture failure")).toBeNull();
  expect(screen.getByText("FIXTURE")).toBeTruthy();
  await completed("own-login", false);
  expect(screen.getByText("fixture failure")).toBeTruthy();
  expect(
    (screen.getByRole("button", { name: "登录 ChatGPT" }) as HTMLButtonElement)
      .disabled,
  ).toBe(false);
});
