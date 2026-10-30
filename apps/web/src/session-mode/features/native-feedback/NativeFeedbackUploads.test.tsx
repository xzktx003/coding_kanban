import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { FeedbackReport } from "./controller";
const mocks = vi.hoisted(() => ({ copy: vi.fn(), error: vi.fn() }));
vi.mock(
  "@session/components/codex/presentation/nativeMarkdownClipboard",
  () => ({ writeNativeMarkdownClipboard: mocks.copy }),
);
vi.mock("../native-notifications/service", () => ({
  nativeNotifications: { danger: mocks.error },
}));
import { FeedbackUploadReport } from "./FeedbackUploadReport";
const report: FeedbackReport = {
  id: "isolated",
  owner: "owner-A",
  correlationId: "thread-A",
  status: "uploading",
  open: true,
  notification: false,
};
beforeEach(() => vi.clearAllMocks());
it("keeps the original CopyButton instance across a changed receipt while copying the captured old value", async () => {
  let finish!: () => void;
  mocks.copy.mockImplementation(
    () => new Promise<void>((resolve) => (finish = resolve)),
  );
  const view = render(<FeedbackUploadReport report={report} />);
  fireEvent.click(screen.getByRole("button", { name: "复制" }));
  view.rerender(
    <FeedbackUploadReport
      report={{ ...report, correlationId: "receipt-B", status: "uploaded" }}
    />,
  );
  expect(mocks.copy).toHaveBeenCalledExactlyOnceWith("thread-A");
  finish();
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "已复制" })).toBeTruthy(),
  );
  expect(screen.getByText("receipt-B")).toBeTruthy();
});
it("retains the uncopied state and displays the original localized clipboard error", async () => {
  mocks.copy.mockRejectedValue(new Error("isolated clipboard denial"));
  render(<FeedbackUploadReport report={report} />);
  fireEvent.click(screen.getByRole("button", { name: "复制" }));
  await waitFor(() =>
    expect(mocks.error).toHaveBeenCalledExactlyOnceWith("无法复制到剪贴板", {
      id: "copy-to-clipboard-error",
      description: "内容未复制。请在 ChatGPT 处于焦点时重试",
    }),
  );
  expect(
    screen.getByRole("button", { name: "复制" }).getAttribute("aria-busy"),
  ).toBeNull();
});
it("reports a clipboard failure after the original dialog closes without reviving its button", async () => {
  let fail!: (error: Error) => void;
  mocks.copy.mockImplementation(
    () => new Promise<void>((_, reject) => (fail = reject)),
  );
  const view = render(<FeedbackUploadReport report={report} />);
  fireEvent.click(screen.getByRole("button", { name: "复制" }));
  view.unmount();
  fail(new Error("isolated clipboard denial"));
  await waitFor(() => expect(mocks.error).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole("dialog")).toBeNull();
});
it("rounds the measured native report height and releases its size observer", () => {
  let height = 254.65625,
    resize!: ResizeObserverCallback;
  const disconnect = vi.fn();
  const bounds = vi
    .spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockImplementation(function (this: HTMLElement) {
      return {
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 520,
        bottom: height,
        width: 520,
        height: this.classList.contains("feedback-report-body") ? height : 0,
        toJSON: () => ({}),
      } as DOMRect;
    });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      own = false;
      constructor(private callback: ResizeObserverCallback) {}
      observe(element: Element) {
        if (element.classList.contains("feedback-report-body")) {
          this.own = true;
          resize = this.callback;
        }
      }
      unobserve() {}
      disconnect() {
        if (this.own) disconnect();
      }
    },
  );
  try {
    const view = render(<FeedbackUploadReport report={report} />);
    expect(screen.getByRole("dialog").style.height).toBe("255px");
    act(() => {
      height = 276.25;
      resize([], {} as ResizeObserver);
    });
    expect(screen.getByRole("dialog").style.height).toBe("277px");
    view.unmount();
    expect(disconnect).toHaveBeenCalledTimes(1);
  } finally {
    bounds.mockRestore();
    vi.unstubAllGlobals();
  }
});
