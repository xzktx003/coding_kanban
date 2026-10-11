import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { NativeCodeFence } from "./NativeCodeFence";
import { NativeMarkdownTable } from "./NativeMarkdownTable";
const notices = vi.hoisted(() => ({ danger: vi.fn() }));
vi.mock("../../../features/native-notifications/service", () => ({
  nativeNotifications: notices,
}));

vi.mock("./nativeFenceHighlight", () => ({
  nativeFenceHighlight: { highlight: () => null },
}));
const clipboardDescriptor = Object.getOwnPropertyDescriptor(
  navigator,
  "clipboard",
);
const execDescriptor = Object.getOwnPropertyDescriptor(document, "execCommand");
afterEach(() => {
  vi.restoreAllMocks();
  if (clipboardDescriptor)
    Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
  else delete (navigator as { clipboard?: unknown }).clipboard;
  if (execDescriptor)
    Object.defineProperty(document, "execCommand", execDescriptor);
  else delete (document as { execCommand?: unknown }).execCommand;
});

function httpClipboard(success = true) {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: undefined,
  });
  const data = new Map<string, string>();
  const exec = vi.fn(() => {
    const event = new Event("copy", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: {
        setData: (type: string, value: string) => data.set(type, value),
      },
    });
    document.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    return success;
  });
  Object.defineProperty(document, "execCommand", {
    configurable: true,
    value: exec,
  });
  return { data, exec };
}

it("copies code on HTTP and restores the focused control", async () => {
  const { data, exec } = httpClipboard();
  render(<NativeCodeFence code={"original source\n"} language="text" />);
  const button = screen.getByRole("button", { name: "复制" });
  button.focus();
  fireEvent.click(button);
  await screen.findByRole("button", { name: "已复制" });
  expect(exec).toHaveBeenCalledWith("copy");
  expect(data.get("text/plain")).toBe("original source\n");
  expect(document.activeElement).toBe(button);
  expect(document.querySelector("textarea")).toBeNull();
});

it("copies sanitized HTML and Markdown together on HTTP", async () => {
  const { data } = httpClipboard();
  render(
    <NativeMarkdownTable>
      <tbody>
        <tr>
          <td>
            <code dir="ltr" data-streamdown="inline-code">
              a|b
            </code>
          </td>
        </tr>
      </tbody>
    </NativeMarkdownTable>,
  );
  fireEvent.click(screen.getByRole("button", { name: "复制表格" }));
  await screen.findByRole("button", { name: "已复制" });
  expect(data.get("text/plain")).toBe("| a\\|b |\n| --- |");
  expect(data.get("text/html")).toBe(
    '<table><tbody><tr><td><code dir="ltr">a|b</code></td></tr></tbody></table>',
  );
});

it("does not report success if the browser rejects legacy copy", async () => {
  httpClipboard(false);
  render(<NativeCodeFence code="source" language="text" />);
  fireEvent.click(screen.getByRole("button", { name: "复制" }));
  await waitFor(() =>
    expect(notices.danger).toHaveBeenCalledWith("无法复制到剪贴板", {
      id: "copy-to-clipboard-error",
      description: "内容未复制。请在 ChatGPT 处于焦点时重试",
    }),
  );
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.queryByRole("button", { name: "已复制" })).toBeNull();
});

it("preserves the composer selection after copying another control's source", async () => {
  httpClipboard();
  render(
    <>
      <input aria-label="Draft" defaultValue="keep my draft" />
      <NativeCodeFence code="source" language="text" />
    </>,
  );
  const input = screen.getByRole("textbox", {
    name: "Draft",
  }) as HTMLInputElement;
  input.focus();
  input.setSelectionRange(1, 6, "backward");
  fireEvent.click(screen.getByRole("button", { name: "复制" }));
  await screen.findByRole("button", { name: "已复制" });
  expect(document.activeElement).toBe(input);
  expect([
    input.selectionStart,
    input.selectionEnd,
    input.selectionDirection,
  ]).toEqual([1, 6, "backward"]);
  expect(input.value).toBe("keep my draft");
});
