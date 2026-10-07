import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
const rpc = vi.hoisted(() => ({
  acpRespondPermission: vi.fn(),
  acpAuthenticate: vi.fn(),
  acpNewSession: vi.fn(),
}));
vi.mock("@session/services/apiAdapt/acp", () => rpc);
vi.mock("./useAcpEvents", () => ({ useAcpEvents: () => {} }));
vi.mock("@session/hooks/useSessionReadReceipt", () => ({
  useSessionReadReceipt: () => {},
}));
import AcpSession from "./AcpSession";
import { useAcpStore } from "../../stores/useAcpStore";
beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
  useAcpStore.setState({
    connectionId: "conn",
    sessionId: "session",
    entries: [],
    permission: {
      requestId: "request",
      title: "执行测试操作",
      options: [{ optionId: "allow", name: "允许" }],
    },
  });
});
it("failed approval remains visible and retryable, without duplicate requests", async () => {
  let reject!: (error: Error) => void;
  rpc.acpRespondPermission.mockImplementationOnce(
    () =>
      new Promise((_, r) => {
        reject = r;
      }),
  );
  render(<AcpSession />);
  fireEvent.click(screen.getByRole("button", { name: "允许" }));
  expect(useAcpStore.getState().permission?.requestId).toBe("request");
  expect(
    screen.getByRole("button", { name: "允许" }).hasAttribute("disabled"),
  ).toBe(true);
  await act(async () => reject(new Error("offline")));
  expect((await screen.findByRole("alert")).textContent).toContain("offline");
  rpc.acpRespondPermission.mockResolvedValueOnce(undefined);
  fireEvent.click(screen.getByRole("button", { name: "允许" }));
  await waitFor(() => expect(useAcpStore.getState().permission).toBeNull());
  expect(rpc.acpRespondPermission).toHaveBeenCalledTimes(2);
});
it("a late approval response cannot dismiss a different request or session", async () => {
  let resolve!: () => void;
  rpc.acpRespondPermission.mockImplementationOnce(
    () =>
      new Promise<void>((r) => {
        resolve = r;
      }),
  );
  render(<AcpSession />);
  fireEvent.click(screen.getByRole("button", { name: "允许" }));
  act(() =>
    useAcpStore.setState({
      sessionId: "other",
      permission: { requestId: "new", title: "新的请求", options: [] },
    }),
  );
  await act(async () => resolve());
  expect(useAcpStore.getState().permission?.requestId).toBe("new");
});
it("new output does not pull the reader away from older history", () => {
  const scroll = vi.spyOn(Element.prototype, "scrollIntoView");
  const { container } = render(<AcpSession />);
  scroll.mockClear();
  const history = container.querySelector("[data-acp-history]")!;
  Object.defineProperties(history, {
    scrollHeight: { configurable: true, value: 1000 },
    clientHeight: { configurable: true, value: 200 },
    scrollTop: { configurable: true, writable: true, value: 100 },
  });
  fireEvent.scroll(history);
  act(() =>
    useAcpStore.setState({
      entries: [{ id: "entry", role: "agent", text: "新的输出" }],
    }),
  );
  expect(scroll).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "回到最新消息" })).toBeTruthy();
});
it("an older failure cannot erase the current permission error after session changes", async () => {
  let rejectOld!: (error: Error) => void;
  let rejectNew!: (error: Error) => void;
  rpc.acpRespondPermission
    .mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectOld = reject;
        }),
    )
    .mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectNew = reject;
        }),
    );
  render(<AcpSession />);
  fireEvent.click(screen.getByRole("button", { name: "允许" }));
  act(() =>
    useAcpStore.setState({
      sessionId: "new-session",
      permission: {
        requestId: "new-request",
        title: "当前请求",
        options: [{ optionId: "allow-new", name: "允许当前请求" }],
      },
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "允许当前请求" }));
  await act(async () => rejectNew(new Error("当前请求离线")));
  expect((await screen.findByRole("alert")).textContent).toContain(
    "当前请求离线",
  );
  await act(async () => rejectOld(new Error("旧请求离线")));
  expect(screen.getByRole("alert").textContent).toContain("当前请求离线");
  expect(screen.getByRole("alert").textContent).not.toContain("旧请求离线");
  expect(useAcpStore.getState().permission?.requestId).toBe("new-request");
  expect(
    screen
      .getByRole("button", { name: "允许当前请求" })
      .hasAttribute("disabled"),
  ).toBe(false);
});
