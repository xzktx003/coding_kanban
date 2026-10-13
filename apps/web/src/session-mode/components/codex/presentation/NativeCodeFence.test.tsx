import { nativeNotifications } from "@session/features/native-notifications/service";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { NativeCodeFence } from "./NativeCodeFence";
import { useMarkdownSettingsStore } from "@session/stores/settings/useMarkdownSettingsStore";

const callbacks = vi.hoisted(() => [] as Array<(html: string) => void>);
vi.mock("./nativeFenceHighlight", () => ({
  nativeFenceHighlight: {
    highlight: (_: unknown, callback: (html: string) => void) => {
      callbacks.push(callback);
      return null;
    },
  },
}));
afterEach(() => {
  act(() => useMarkdownSettingsStore.getState().setWordWrap(false));
  callbacks.splice(0);
  vi.restoreAllMocks();
});

it("shows source immediately and toggles native wrapping without adding line numbers", () => {
  render(<NativeCodeFence code="const example = 42;" language="typescript" />);
  expect(screen.getByText("const example = 42;")).toBeTruthy();
  const wrap = screen.getByRole("button", { name: "启用自动换行" });
  expect(wrap.getAttribute("aria-pressed")).toBe("false");
  fireEvent.click(wrap);
  expect(
    screen
      .getByRole("button", { name: "禁用自动换行" })
      .getAttribute("aria-pressed"),
  ).toBe("true");
  expect(
    screen
      .getByText("const example = 42;")
      .closest("pre")
      ?.getAttribute("data-wrap"),
  ).toBe("true");
  expect(document.querySelector("[data-line-number]")).toBeNull();
});

it("does not let a stale highlighter return replace the current code", async () => {
  const view = render(<NativeCodeFence code="first" language="typescript" />);
  view.rerender(<NativeCodeFence code="second" language="typescript" />);
  act(() => callbacks[0]('<span style="color:red">first</span>'));
  expect(screen.getByText("second")).toBeTruthy();
  expect(screen.queryByText("first")).toBeNull();
  act(() => callbacks[1]('<span style="color:blue">second</span>'));
  await waitFor(() =>
    expect(screen.getByText("second").style.color).toBe("blue"),
  );
});

it("shows copied code after the clipboard accepts the source", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  render(<NativeCodeFence code={"exact source\n"} language="text" />);
  fireEvent.click(screen.getByRole("button", { name: "复制代码" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "已复制代码" })).toBeTruthy(),
  );
  expect(writeText).toHaveBeenCalledWith("exact source\n");
});

it("copies the captured code and reports a rejected clipboard operation truthfully", async () => {
  const danger = vi.spyOn(nativeNotifications, "danger");
  const writeText = vi.fn().mockRejectedValue(new Error("Clipboard denied"));
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  render(<NativeCodeFence code={"exact source\n"} language="text" />);
  fireEvent.click(screen.getByRole("button", { name: "复制代码" }));
  await waitFor(() =>
    expect(danger).toHaveBeenCalledWith("无法复制到剪贴板", {
      id: "copy-to-clipboard-error",
      description: "内容未复制。请在 ChatGPT 处于焦点时重试",
    }),
  );
  expect(screen.queryByRole("alert")).toBeNull();
  expect(writeText).toHaveBeenCalledWith("exact source\n");
  expect(screen.queryByRole("button", { name: "已复制代码" })).toBeNull();
});

it("keeps source download reachable from the compact native menu", async () => {
  const createObjectURL = vi.fn(() => "blob:fixture"),
    revokeObjectURL = vi.fn();
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: createObjectURL,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: revokeObjectURL,
  });
  const click = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(() => {});
  render(<NativeCodeFence code="source" language="typescript" />);
  fireEvent.keyDown(screen.getByRole("button", { name: "代码块更多操作" }), {
    key: "ArrowDown",
  });
  fireEvent.click(await screen.findByRole("menuitem", { name: "下载代码" }));
  expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
  expect(click).toHaveBeenCalledOnce();
});

it("shares the native wrap choice across code blocks and later mounted messages", () => {
  const first = render(<NativeCodeFence code="first" language="typescript" />);
  render(<NativeCodeFence code="second" language="python" />);
  fireEvent.click(screen.getAllByRole("button", { name: "启用自动换行" })[0]);
  expect(screen.getAllByRole("button", { name: "禁用自动换行" })).toHaveLength(
    2,
  );
  first.unmount();
  render(<NativeCodeFence code="later" language="javascript" />);
  expect(screen.getAllByRole("button", { name: "禁用自动换行" })).toHaveLength(
    2,
  );
  fireEvent.click(screen.getAllByRole("button", { name: "禁用自动换行" })[0]);
  expect(screen.getAllByRole("button", { name: "启用自动换行" })).toHaveLength(
    2,
  );
});

it("locks repeated copy clicks while clipboard permission is pending and during the copied feedback", async () => {
  let finish!: () => void;
  const writeText = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  render(<NativeCodeFence code="source" language="typescript" />);
  const button = screen.getByRole("button", { name: "复制代码" });
  fireEvent.click(button);
  expect(button.getAttribute("aria-busy")).toBe("true");
  expect(button.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(button);
  expect(writeText).toHaveBeenCalledTimes(1);
  await act(async () => finish());
  fireEvent.click(screen.getByRole("button", { name: "已复制代码" }));
  expect(writeText).toHaveBeenCalledTimes(1);
});
