import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { ShellCommand } from "./ShellCommand";

const notices = vi.hoisted(() => ({ danger: vi.fn() }));
vi.mock("@session/features/native-notifications/service", () => ({
  nativeNotifications: notices,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "zh" } }),
}));
const clipboardDescriptor = Object.getOwnPropertyDescriptor(
  navigator,
  "clipboard",
);
const execDescriptor = Object.getOwnPropertyDescriptor(document, "execCommand");
afterEach(() => {
  vi.useRealTimers();
  notices.danger.mockClear();
  if (clipboardDescriptor)
    Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
  else delete (navigator as { clipboard?: unknown }).clipboard;
  if (execDescriptor)
    Object.defineProperty(document, "execCommand", execDescriptor);
  else delete (document as { execCommand?: unknown }).execCommand;
});
function clipboard(writeText?: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: writeText ? { writeText } : undefined,
  });
}
function shell(output = "raw output\n", threadId = "owner") {
  return (
    <ShellCommand
      command="check-copy"
      commandItemId="command"
      threadId={threadId}
      turnId="turn"
      status="completed"
      aggregatedOutput={output}
    />
  );
}
function expand() {
  fireEvent.click(screen.getByRole("button", { name: /command.ran/ }));
}

it("coalesces pending command copies, keeps the icon, and stops the click from reaching the row", async () => {
  let resolve!: () => void;
  const write = vi.fn(
    () =>
      new Promise<void>((done) => {
        resolve = done;
      }),
  );
  clipboard(write);
  const parent = vi.fn();
  render(<div onClick={parent}>{shell()}</div>);
  expand();
  parent.mockClear();
  const button = screen.getByRole("button", { name: "command.copyCommand" });
  const icon = button.querySelector("svg")?.outerHTML;
  fireEvent.click(button);
  fireEvent.click(button);
  expect(write).toHaveBeenCalledExactlyOnceWith("check-copy");
  expect(button.getAttribute("aria-busy")).toBe("true");
  expect(button.getAttribute("aria-disabled")).toBe("true");
  expect((button as HTMLButtonElement).disabled).toBe(false);
  expect(button.querySelector("svg")?.outerHTML).toBe(icon);
  expect(parent).not.toHaveBeenCalled();
  await act(async () => resolve());
  expect(button.hasAttribute("aria-busy")).toBe(false);
});

it("keeps native copied feedback and its copied glyph for two seconds without another write", async () => {
  vi.useFakeTimers();
  const write = vi.fn(async () => {});
  clipboard(write);
  render(shell());
  expand();
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "command.copyOutput" })),
  );
  const button = screen.getByRole("button", { name: "command.copied" });
  expect(button.getAttribute("title")).toBe("command.copied");
  expect(button.querySelector("svg")?.getAttribute("viewBox")).toBe(
    "0 0 17 17",
  );
  fireEvent.click(button);
  expect(write).toHaveBeenCalledExactlyOnceWith("raw output\n");
  act(() => vi.advanceTimersByTime(1999));
  expect(
    screen.queryByRole("button", { name: "command.copied" }),
  ).not.toBeNull();
  act(() => vi.advanceTimersByTime(1));
  expect(screen.queryByRole("button", { name: "command.copied" })).toBeNull();
});

it("copies unchanged ANSI output on HTTP and restores the focused draft selection", async () => {
  clipboard();
  const raw = "\u001b[32mexact output\u001b[0m\n";
  let copied = "";
  const exec = vi.fn(() => {
    copied = document.querySelector("textarea")!.value;
    return true;
  });
  Object.defineProperty(document, "execCommand", {
    configurable: true,
    value: exec,
  });
  render(
    <>
      <input aria-label="Draft" defaultValue="unchanged draft" />
      {shell(raw)}
    </>,
  );
  expand();
  const input = screen.getByRole("textbox", {
    name: "Draft",
  }) as HTMLInputElement;
  input.focus();
  input.setSelectionRange(2, 7, "backward");
  fireEvent.click(screen.getByRole("button", { name: "command.copyOutput" }));
  await screen.findByRole("button", { name: "command.copied" });
  expect(exec).toHaveBeenCalledExactlyOnceWith("copy");
  expect(copied).toBe(raw);
  expect(document.activeElement).toBe(input);
  expect([
    input.selectionStart,
    input.selectionEnd,
    input.selectionDirection,
  ]).toEqual([2, 7, "backward"]);
  expect(input.value).toBe("unchanged draft");
});

it("shows the native error notice once and allows an explicit retry", async () => {
  const write = vi.fn().mockRejectedValue(new Error("denied"));
  clipboard(write);
  render(shell());
  expand();
  fireEvent.click(screen.getByRole("button", { name: "command.copyOutput" }));
  await waitFor(() =>
    expect(notices.danger).toHaveBeenCalledExactlyOnceWith("无法复制到剪贴板", {
      id: "copy-to-clipboard-error",
      description: "内容未复制。请在 ChatGPT 处于焦点时重试",
    }),
  );
  expect(screen.queryByRole("button", { name: "command.copied" })).toBeNull();
  write.mockResolvedValue(undefined);
  fireEvent.click(screen.getByRole("button", { name: "command.copyOutput" }));
  await screen.findByRole("button", { name: "command.copied" });
  expect(write).toHaveBeenCalledTimes(2);
});

it.each(["resolve", "reject"])(
  "ignores a late %s after output changes away and back",
  async (settle) => {
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    clipboard(
      vi.fn(
        () =>
          new Promise<void>((done, fail) => {
            resolve = done;
            reject = fail;
          }),
      ),
    );
    const view = render(shell("A"));
    expand();
    fireEvent.click(screen.getByRole("button", { name: "command.copyOutput" }));
    view.rerender(shell("B"));
    view.rerender(shell("A"));
    await act(async () =>
      settle === "resolve" ? resolve() : reject(new Error("late")),
    );
    expect(screen.queryByRole("button", { name: "command.copied" })).toBeNull();
    expect(notices.danger).not.toHaveBeenCalled();
  },
);

it.each(["resolve", "reject"])(
  "releases feedback and ignores a late %s after the shell closes",
  async (settle) => {
    vi.useFakeTimers();
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    clipboard(
      vi.fn(
        () =>
          new Promise<void>((done, fail) => {
            resolve = done;
            reject = fail;
          }),
      ),
    );
    render(shell());
    expand();
    fireEvent.click(screen.getByRole("button", { name: "command.copyOutput" }));
    expand();
    const before = vi.getTimerCount();
    await act(async () =>
      settle === "resolve" ? resolve() : reject(new Error("late")),
    );
    expect(vi.getTimerCount()).toBe(before);
    expect(notices.danger).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "command.copied" })).toBeNull();
  },
);

it("accepts the first copy after StrictMode remounts its effects", async () => {
  clipboard(vi.fn(async () => {}));
  render(<StrictMode>{shell()}</StrictMode>);
  expand();
  fireEvent.click(screen.getByRole("button", { name: "command.copyCommand" }));
  await screen.findByRole("button", { name: "command.copied" });
});
