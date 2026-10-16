import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CopyButton } from "./CopyButton";

const notices = vi.hoisted(() => ({ danger: vi.fn() }));
vi.mock("@session/features/native-notifications/service", () => ({
  nativeNotifications: notices,
}));
const clipboardDescriptor = Object.getOwnPropertyDescriptor(
  navigator,
  "clipboard",
);
const execDescriptor = Object.getOwnPropertyDescriptor(document, "execCommand");
const source = '  完整正文\n:codex-file-citation{path="/fixture/a.ts"}\n\t';
let legacy: ReturnType<typeof vi.fn>;

function clipboard(value: unknown) {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value });
}
beforeEach(() => {
  vi.useFakeTimers();
  notices.danger.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
  clipboard(undefined);
  legacy = vi.fn(() => true);
  Object.defineProperty(document, "execCommand", {
    configurable: true,
    value: legacy,
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (clipboardDescriptor)
    Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
  else delete (navigator as { clipboard?: unknown }).clipboard;
  if (execDescriptor)
    Object.defineProperty(document, "execCommand", execDescriptor);
  else delete (document as { execCommand?: unknown }).execCommand;
});

it("copies the complete HTTP source, blurs immediately, and keeps the two-second feedback", async () => {
  let copied = "";
  legacy.mockImplementation(() => {
    copied = (document.activeElement as HTMLTextAreaElement).value;
    return true;
  });
  render(<CopyButton text={source} />);
  const button = screen.getByRole("button", { name: "Copy" });
  button.focus();
  fireEvent.click(button);
  expect(document.activeElement).not.toBe(button);
  await act(async () => {});
  expect(copied).toBe(source);
  expect(legacy).toHaveBeenCalledExactlyOnceWith("copy");
  expect(document.querySelector("textarea")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Copied" }));
  expect(legacy).toHaveBeenCalledTimes(1);
  await act(async () => vi.advanceTimersByTime(1999));
  expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy();
  await act(async () => vi.advanceTimersByTime(1));
  expect(screen.getByRole("button", { name: "Copy" })).toBeTruthy();
});

for (const failure of ["legacy-false", "modern-reject"] as const)
  it(`reports ${failure} visibly and never marks the source copied`, async () => {
    if (failure === "legacy-false") legacy.mockReturnValue(false);
    else
      clipboard({
        writeText: vi.fn().mockRejectedValue(new Error("fixture denied")),
      });
    render(<CopyButton text={source} />);
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Copy" })),
    );
    expect(notices.danger).toHaveBeenCalledExactlyOnceWith("无法复制到剪贴板", {
      id: "copy-to-clipboard-error",
      description: "内容未复制。请在 ChatGPT 处于焦点时重试",
    });
    expect(screen.queryByRole("button", { name: "Copied" })).toBeNull();
    // jsdom schedules selectionchange tasks for the fallback textarea.
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(vi.getTimerCount()).toBe(0);
  });

it("admits one write while permission is pending and starts feedback only after acceptance", async () => {
  let resolve!: () => void;
  const writeText = vi.fn(
    () =>
      new Promise<void>((done) => {
        resolve = done;
      }),
  );
  clipboard({ writeText });
  render(<CopyButton text={source} />);
  const button = screen.getByRole("button", { name: "Copy" });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(writeText).toHaveBeenCalledExactlyOnceWith(source);
  expect(button.getAttribute("aria-busy")).toBe("true");
  expect(screen.queryByRole("button", { name: "Copied" })).toBeNull();
  await act(async () => resolve());
  expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy();
});

for (const settlement of ["resolve", "reject"] as const)
  it(`ignores a ${settlement} for the previous source after its value changes`, async () => {
    let resolve!: () => void, reject!: (reason: Error) => void;
    const writeText = vi.fn(
      () =>
        new Promise<void>((done, fail) => {
          resolve = done;
          reject = fail;
        }),
    );
    clipboard({ writeText });
    const view = render(<CopyButton text="fixture first" />);
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    view.rerender(<CopyButton text="fixture second" />);
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(writeText).toHaveBeenCalledTimes(1);
    await act(async () =>
      settlement === "resolve" ? resolve() : reject(new Error("fixture stale")),
    );
    expect(screen.queryByRole("button", { name: "Copied" })).toBeNull();
    expect(notices.danger).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    writeText.mockResolvedValueOnce(undefined);
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Copy" })),
    );
    expect(writeText).toHaveBeenLastCalledWith("fixture second");
    expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy();
  });

it("clears accepted feedback when the source changes and when the button unmounts", async () => {
  clipboard({ writeText: vi.fn().mockResolvedValue(undefined) });
  const view = render(<CopyButton text="fixture first" />);
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Copy" })),
  );
  expect(vi.getTimerCount()).toBe(1);
  view.rerender(<CopyButton text="fixture second" />);
  expect(vi.getTimerCount()).toBe(0);
  expect(screen.getByRole("button", { name: "Copy" })).toBeTruthy();
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Copy" })),
  );
  expect(vi.getTimerCount()).toBe(1);
  view.unmount();
  expect(vi.getTimerCount()).toBe(0);
});

for (const settlement of ["resolve", "reject"] as const)
  it(`does not retain feedback after an unmounted write ${settlement}s`, async () => {
    let resolve!: () => void, reject!: (reason: Error) => void;
    clipboard({
      writeText: () =>
        new Promise<void>((done, fail) => {
          resolve = done;
          reject = fail;
        }),
    });
    const view = render(<CopyButton text={source} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    view.unmount();
    await act(async () =>
      settlement === "resolve"
        ? resolve()
        : reject(new Error("fixture detached")),
    );
    expect(notices.danger).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
