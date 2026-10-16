import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { StrictMode } from "react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import { zh } from "@session/locales/zh";
import { PlanContentItem } from "./PlanContentItem";
import { useSessionDraftStore } from "@session/stores/useSessionDraftStore";

const notices = vi.hoisted(() => ({ danger: vi.fn() }));
vi.mock("@session/features/native-notifications/service", () => ({
  nativeNotifications: notices,
}));
const clipboardDescriptor = Object.getOwnPropertyDescriptor(
  navigator,
  "clipboard",
);
const execDescriptor = Object.getOwnPropertyDescriptor(document, "execCommand");
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  notices.danger.mockClear();
  if (clipboardDescriptor)
    Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
  else delete (navigator as { clipboard?: unknown }).clipboard;
  if (execDescriptor)
    Object.defineProperty(document, "execCommand", execDescriptor);
  else delete (document as { execCommand?: unknown }).execCommand;
});

function clipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
}

vi.mock("@session/contexts/ThemeContext", () => ({
  useThemeContext: () => ({ resolvedTheme: "dark" }),
  CapturedThemeProvider: ({ children }: { children: unknown }) => children,
}));
vi.mock("../presentation/CodexMarkdown", () => ({
  CodexMarkdown: ({ value }: { value: string }) => <span>{value}</span>,
}));

beforeAll(async () => {
  await i18next
    .use(initReactI18next)
    .init({ lng: "zh", resources: { zh: { thread: zh.thread } } });
});

it("shows feedback for the first copy after StrictMode restores its effects", async () => {
  const write = vi.fn(async () => {});
  clipboard(write);
  render(
    <StrictMode>
      <PlanContentItem text="# Strict plan" threadId="owner" />
    </StrictMode>,
  );
  fireEvent.click(screen.getByRole("button", { name: "复制计划" }));
  await screen.findByRole("button", { name: "已复制" });
  expect(write).toHaveBeenCalledExactlyOnceWith("# Strict plan");
});

it("copies only the open plan and leaves another session draft unchanged", async () => {
  const writeText = vi.fn(async () => undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  const plan = ["# 计划", "", "先看范围，再改代码。"].join("\n");
  useSessionDraftStore.setState({
    drafts: { "other-session": { text: "不要改这条草稿", revision: 3 } },
  });
  render(<PlanContentItem text={plan} threadId="owner" />);
  fireEvent.click(screen.getByRole("button", { name: "复制计划" }));
  await waitFor(() => {
    expect(screen.getByRole("button", { name: "已复制" })).toBeTruthy();
  });
  expect(writeText).toHaveBeenCalledWith(plan);
  expect(useSessionDraftStore.getState().drafts["other-session"]).toEqual({
    text: "不要改这条草稿",
    revision: 3,
  });
});

it("stops the copy click before it reaches an enclosing interaction", async () => {
  const parentClick = vi.fn();
  clipboard(vi.fn(async () => {}));
  render(
    <div onClick={parentClick}>
      <PlanContentItem text="# Plan" />
    </div>,
  );
  fireEvent.click(screen.getByRole("button", { name: "复制计划" }));
  await screen.findByRole("button", { name: "已复制" });
  expect(parentClick).not.toHaveBeenCalled();
});

it("coalesces pending clicks and shows the original clipboard error before allowing retry", async () => {
  let reject!: (error: Error) => void;
  const writeText = vi.fn(
    () =>
      new Promise<void>((_, fail) => {
        reject = fail;
      }),
  );
  clipboard(writeText);
  vi.spyOn(console, "error").mockImplementation(() => {});
  render(<PlanContentItem text="# Plan" threadId="owner" turnId="turn" />);
  const button = screen.getByRole("button", { name: "复制计划" });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(writeText).toHaveBeenCalledTimes(1);
  expect(button.getAttribute("aria-busy")).toBe("true");
  expect(button.getAttribute("aria-disabled")).toBe("true");
  await act(async () => reject(new Error("permission denied")));
  expect(notices.danger).toHaveBeenCalledExactlyOnceWith("无法复制到剪贴板", {
    id: "copy-to-clipboard-error",
    description: "内容未复制。请在 ChatGPT 处于焦点时重试",
  });
  expect(screen.queryByRole("button", { name: "已复制" })).toBeNull();
  expect(button.hasAttribute("aria-busy")).toBe(false);
  expect(button.hasAttribute("aria-disabled")).toBe(false);
  writeText.mockImplementation(async () => {});
  fireEvent.click(button);
  await screen.findByRole("button", { name: "已复制" });
  expect(writeText).toHaveBeenCalledTimes(2);
});

it("keeps copied feedback for the native two seconds without duplicate writes", async () => {
  vi.useFakeTimers();
  const writeText = vi.fn(async () => {});
  clipboard(writeText);
  render(<PlanContentItem text="# Plan" />);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "复制计划" }));
  });
  const button = screen.getByRole("button", { name: "已复制" });
  fireEvent.click(button);
  expect(writeText).toHaveBeenCalledTimes(1);
  act(() => {
    vi.advanceTimersByTime(1999);
  });
  expect(screen.queryByRole("button", { name: "已复制" })).not.toBeNull();
  act(() => {
    vi.advanceTimersByTime(1);
  });
  expect(screen.queryByRole("button", { name: "已复制" })).toBeNull();
});

it("uses the HTTP clipboard fallback without altering plan source or the focused draft selection", async () => {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: undefined,
  });
  const exec = vi.fn(() => true);
  Object.defineProperty(document, "execCommand", {
    configurable: true,
    value: exec,
  });
  const source = "# Plan\n\nKeep exact source citeturn0search0\n";
  render(
    <>
      <input aria-label="Draft" defaultValue="untouched draft" />
      <PlanContentItem text={source} />
    </>,
  );
  const input = screen.getByRole("textbox", {
    name: "Draft",
  }) as HTMLInputElement;
  input.focus();
  input.setSelectionRange(1, 6, "backward");
  let copiedSource = "";
  exec.mockImplementation(() => {
    copiedSource = document.querySelector("textarea")!.value;
    return true;
  });
  fireEvent.click(screen.getByRole("button", { name: "复制计划" }));
  await screen.findByRole("button", { name: "已复制" });
  expect(exec).toHaveBeenCalledExactlyOnceWith("copy");
  expect(copiedSource).toBe(source);
  expect(document.activeElement).toBe(input);
  expect([
    input.selectionStart,
    input.selectionEnd,
    input.selectionDirection,
  ]).toEqual([1, 6, "backward"]);
  expect(input.value).toBe("untouched draft");
});

it("does not apply a pending copy receipt to another thread or a later same-text plan", async () => {
  let resolve!: () => void;
  clipboard(
    vi.fn(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    ),
  );
  const view = render(
    <PlanContentItem text="# A" threadId="first" turnId="a" />,
  );
  fireEvent.click(screen.getByRole("button", { name: "复制计划" }));
  view.rerender(<PlanContentItem text="# B" threadId="second" turnId="b" />);
  view.rerender(<PlanContentItem text="# A" threadId="first" turnId="a" />);
  await act(async () => resolve());
  expect(screen.queryByRole("button", { name: "已复制" })).toBeNull();
});

it("clears copied feedback on a new owner and releases its timer on unmount", async () => {
  vi.useFakeTimers();
  clipboard(vi.fn(async () => {}));
  const view = render(<PlanContentItem text="# A" threadId="first" />);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "复制计划" }));
  });
  view.rerender(<PlanContentItem text="# A" threadId="second" />);
  expect(screen.queryByRole("button", { name: "已复制" })).toBeNull();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "复制计划" }));
  });
  expect(vi.getTimerCount()).toBeGreaterThan(0);
  view.unmount();
  expect(vi.getTimerCount()).toBe(0);
});
