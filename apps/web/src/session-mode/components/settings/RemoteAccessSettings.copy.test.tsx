import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RemoteAccessSettings } from "./RemoteAccessSettings";

const fixtures = vi.hoisted(() => ({
  danger: vi.fn(),
  remote: vi.fn(),
  pairing: vi.fn(),
}));
vi.mock("@session/features/native-notifications/service", () => ({
  nativeNotifications: { danger: fixtures.danger },
}));
vi.mock("@session/hooks/runtime", () => ({ isDesktopTauri: () => false }));
vi.mock("@session/services/apiAdapt/remote", () => ({
  remoteGetStatus: fixtures.remote,
  remoteRotateToken: fixtures.remote,
  remoteStart: fixtures.remote,
  remoteStop: fixtures.remote,
}));
vi.mock("@session/stores/usePairingStore", () => ({
  usePairingStore: fixtures.pairing,
}));
const clipboardDescriptor = Object.getOwnPropertyDescriptor(
  navigator,
  "clipboard",
);
const execDescriptor = Object.getOwnPropertyDescriptor(document, "execCommand");
const first = "http://fixture-one.invalid:31917/?mode=session";
const second = "http://fixture-two.invalid:31919/?mode=session";
let legacy: ReturnType<typeof vi.fn>, address: ReturnType<typeof vi.spyOn>;

function clipboard(value: unknown) {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value });
}
beforeEach(() => {
  vi.useFakeTimers();
  fixtures.danger.mockReset();
  fixtures.remote.mockReset();
  fixtures.pairing.mockReset();
  // Only substitute the serialized fixture URL. The real web branch and CopyField mount.
  address = vi.spyOn(URL.prototype, "href", "get").mockReturnValue(first);
  clipboard(undefined);
  legacy = vi.fn(() => true);
  Object.defineProperty(document, "execCommand", {
    configurable: true,
    value: legacy,
  });
});
afterEach(() => {
  cleanup();
  expect(fixtures.remote).not.toHaveBeenCalled();
  expect(fixtures.pairing).not.toHaveBeenCalled();
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (clipboardDescriptor)
    Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
  else delete (navigator as { clipboard?: unknown }).clipboard;
  if (execDescriptor)
    Object.defineProperty(document, "execCommand", execDescriptor);
  else delete (document as { execCommand?: unknown }).execCommand;
});

it("copies the HTTP workbench URL through the real webpage branch and keeps 1.5-second feedback", async () => {
  let copied = "";
  legacy.mockImplementation(() => {
    copied = (document.activeElement as HTMLTextAreaElement).value;
    return true;
  });
  render(<RemoteAccessSettings />);
  expect(screen.getByText(first)).toBeTruthy();
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "复制地址" })),
  );
  expect(copied).toBe(first);
  expect(legacy).toHaveBeenCalledExactlyOnceWith("copy");
  expect(screen.getByRole("button", { name: "已复制地址" })).toBeTruthy();
  await act(async () => vi.advanceTimersByTime(1499));
  expect(screen.getByRole("button", { name: "已复制地址" })).toBeTruthy();
  await act(async () => vi.advanceTimersByTime(1));
  expect(screen.getByRole("button", { name: "复制地址" })).toBeTruthy();
});

for (const failure of ["legacy-false", "modern-reject"] as const)
  it(`shows a ${failure} notification without copied feedback`, async () => {
    if (failure === "legacy-false") legacy.mockReturnValue(false);
    else
      clipboard({
        writeText: vi.fn().mockRejectedValue(new Error("fixture denied")),
      });
    render(<RemoteAccessSettings />);
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "复制地址" })),
    );
    expect(fixtures.danger).toHaveBeenCalledExactlyOnceWith(
      "无法复制到剪贴板",
      {
        id: "copy-to-clipboard-error",
        description: "内容未复制。请在 ChatGPT 处于焦点时重试",
      },
    );
    expect(screen.queryByRole("button", { name: "已复制地址" })).toBeNull();
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(vi.getTimerCount()).toBe(0);
  });

it("locks repeated pending and accepted clicks until feedback expires", async () => {
  let resolve!: () => void;
  const writeText = vi.fn(
    () =>
      new Promise<void>((done) => {
        resolve = done;
      }),
  );
  clipboard({ writeText });
  render(<RemoteAccessSettings />);
  const button = screen.getByRole("button", { name: "复制地址" });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(writeText).toHaveBeenCalledExactlyOnceWith(first);
  expect(button.getAttribute("aria-busy")).toBe("true");
  await act(async () => resolve());
  fireEvent.click(screen.getByRole("button", { name: "已复制地址" }));
  expect(writeText).toHaveBeenCalledTimes(1);
});

for (const settlement of ["resolve", "reject"] as const)
  it(`ignores stale ${settlement} feedback after the workbench value changes`, async () => {
    let resolve!: () => void, reject!: (reason: Error) => void;
    const writeText = vi.fn(
      () =>
        new Promise<void>((done, fail) => {
          resolve = done;
          reject = fail;
        }),
    );
    clipboard({ writeText });
    const view = render(<RemoteAccessSettings />);
    fireEvent.click(screen.getByRole("button", { name: "复制地址" }));
    address.mockReturnValue(second);
    view.rerender(<RemoteAccessSettings />);
    expect(screen.getByText(second)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "复制地址" }));
    expect(writeText).toHaveBeenCalledTimes(1);
    await act(async () =>
      settlement === "resolve" ? resolve() : reject(new Error("fixture stale")),
    );
    expect(screen.queryByRole("button", { name: "已复制地址" })).toBeNull();
    expect(fixtures.danger).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

it("releases the feedback timer on a new URL and on unmount", async () => {
  clipboard({ writeText: vi.fn().mockResolvedValue(undefined) });
  const view = render(<RemoteAccessSettings />);
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "复制地址" })),
  );
  expect(vi.getTimerCount()).toBe(1);
  address.mockReturnValue(second);
  view.rerender(<RemoteAccessSettings />);
  expect(vi.getTimerCount()).toBe(0);
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "复制地址" })),
  );
  expect(vi.getTimerCount()).toBe(1);
  view.unmount();
  expect(vi.getTimerCount()).toBe(0);
});

for (const settlement of ["resolve", "reject"] as const)
  it(`does not create feedback after an unmounted address write ${settlement}s`, async () => {
    let resolve!: () => void, reject!: (reason: Error) => void;
    clipboard({
      writeText: () =>
        new Promise<void>((done, fail) => {
          resolve = done;
          reject = fail;
        }),
    });
    const view = render(<RemoteAccessSettings />);
    fireEvent.click(screen.getByRole("button", { name: "复制地址" }));
    view.unmount();
    await act(async () =>
      settlement === "resolve"
        ? resolve()
        : reject(new Error("fixture detached")),
    );
    expect(fixtures.danger).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
