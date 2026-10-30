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
  Object.defineProperty(Element.prototype, "scrollTo", {
    configurable: true,
    value: vi.fn(function (this: HTMLElement, options: ScrollToOptions) {
      this.scrollTop = options.top ?? this.scrollTop;
    }),
  });
  useAcpStore.setState({
    connectionId: "conn",
    sessionId: "session",
    entries: [],
    pendingPermissions: {},
    permission: {
      requestId: "request",
      title: "执行测试操作",
      options: [{ optionId: "allow", name: "允许" }],
    },
  });
});
it("parallel permissions expose the next request only after the first response succeeds", async () => {
  useAcpStore.getState().setPermission({
    requestId: "first",
    title: "第一项审批",
    options: [{ optionId: "first-allow", name: "允许第一项" }],
  });
  useAcpStore.getState().setPermission({
    requestId: "second",
    title: "第二项审批",
    options: [{ optionId: "second-allow", name: "允许第二项" }],
  });
  rpc.acpRespondPermission.mockResolvedValue(undefined);
  render(<AcpSession />);
  expect(screen.getByText("另有 1 项待处理")).toBeTruthy();
  expect(screen.queryByText("第二项审批")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "允许第一项" }));
  await screen.findByText("第二项审批");
  expect(rpc.acpRespondPermission).toHaveBeenCalledExactlyOnceWith(
    "conn",
    "first",
    "first-allow",
  );
  fireEvent.click(screen.getByRole("button", { name: "允许第二项" }));
  await waitFor(() => expect(useAcpStore.getState().permission).toBeNull());
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
  fireEvent.wheel(history, { deltaY: -100 });
  fireEvent.scroll(history);
  act(() =>
    useAcpStore.setState({
      entries: [{ id: "entry", role: "agent", text: "新的输出" }],
    }),
  );
  expect(scroll).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "回到最新消息" })).toBeTruthy();
});
it("layout scroll events before a user gesture keep following new output", async () => {
  useAcpStore.setState({ sessionId: "layout-only-session" });
  const scroll = vi.spyOn(Element.prototype, "scrollIntoView");
  const { container } = render(<AcpSession />);
  await new Promise((resolve) => setTimeout(resolve, 50));
  const history = container.querySelector("[data-acp-history]")!;
  Object.defineProperties(history, {
    scrollHeight: { configurable: true, value: 1000 },
    clientHeight: { configurable: true, value: 200 },
    scrollTop: { configurable: true, writable: true, value: 0 },
  });
  fireEvent.scroll(history);
  scroll.mockClear();
  act(() =>
    useAcpStore.setState({
      entries: [{ id: "layout", role: "agent", text: "latest" }],
    }),
  );
  expect(scroll).toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "回到最新消息" })).toBeNull();
});
it("tapping current message content keeps following subsequent output", () => {
  useAcpStore.setState({
    sessionId: "tap-only-session",
    entries: [{ id: "tap", role: "agent", text: "Current output" }],
  });
  const scroll = vi.spyOn(Element.prototype, "scrollIntoView");
  render(<AcpSession />);
  scroll.mockClear();
  fireEvent.pointerDown(screen.getByText("Current output"));
  fireEvent.touchStart(screen.getByText("Current output"));
  act(() =>
    useAcpStore.setState({
      entries: [
        ...useAcpStore.getState().entries,
        { id: "next", role: "agent", text: "Next output" },
      ],
    }),
  );
  expect(scroll).toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "回到最新消息" })).toBeNull();
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
it("native load can temporarily clear source identity without changing hook order", () => {
  useAcpStore.setState({
    runtimeInstance: "runtime",
    historySessionId: "source-before",
    permission: null,
  });
  render(<AcpSession />);
  expect(() =>
    act(() =>
      useAcpStore.setState({
        historySessionId: null,
        sessionId: "loaded-native",
      }),
    ),
  ).not.toThrow();
  expect(() =>
    act(() => useAcpStore.setState({ historySessionId: "source-after" })),
  ).not.toThrow();
});
