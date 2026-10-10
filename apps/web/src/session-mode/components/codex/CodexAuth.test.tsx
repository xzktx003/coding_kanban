import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({
  loginAccount: vi.fn(async () => ({
    type: "chatgptDeviceCode",
    loginId: "fixture-login",
    verificationUrl: "https://auth.openai.com/device",
    userCode: "ABCD-EFGH",
  })),
  getAccountWithParams: vi.fn(async () => ({
    account: null,
    requiresOpenaiAuth: true,
  })),
  saveAccountSnapshot: vi.fn(),
  getJsonWithOptions: vi.fn(async () => ({ instance: "fixture-runtime" })),
  postJsonWithOptions: vi.fn(),
}));
vi.mock("@session/services", () => api);
vi.mock("@session/browser-opener", () => ({ open: vi.fn() }));
vi.mock("@session/hooks/runtime", () => ({
  isTauri: () => false,
  buildUrl: (path: string) => "https://fixture.invalid/api/session" + path,
}));
vi.mock("@session/services/apiAdapt/shared", () => ({
  getJsonWithOptions: api.getJsonWithOptions,
  postJsonWithOptions: api.postJsonWithOptions,
}));
vi.mock("@session/lib/eventStream", () => ({
  openEventStream: () => () => {},
}));
import { CodexAuth } from "./CodexAuth";
it("uses device-code login from a LAN browser and shows the code and verification link", async () => {
  render(<CodexAuth />);
  fireEvent.click(screen.getByRole("button", { name: "登录 ChatGPT" }));
  await waitFor(() =>
    expect(api.loginAccount).toHaveBeenCalledWith({
      type: "chatgptDeviceCode",
    }),
  );
  expect(await screen.findByText("ABCD-EFGH")).toBeTruthy();
  expect(
    screen.getByRole("link", { name: "打开登录页面" }).getAttribute("href"),
  ).toBe("https://auth.openai.com/device");
  expect(api.getJsonWithOptions).toHaveBeenCalledWith("/health", {
    suppressToast: true,
  });
  expect(api.postJsonWithOptions).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "取消本次登录" })).toBeNull();
});
