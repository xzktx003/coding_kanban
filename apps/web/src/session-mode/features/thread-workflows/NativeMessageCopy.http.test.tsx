import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { NativeMessageCopy } from "./NativeMessageCopy";

const descriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
const execDescriptor = Object.getOwnPropertyDescriptor(document, "execCommand");
afterEach(() => {
  vi.restoreAllMocks();
  if (descriptor) Object.defineProperty(navigator, "clipboard", descriptor);
  else delete (navigator as { clipboard?: unknown }).clipboard;
  if (execDescriptor)
    Object.defineProperty(document, "execCommand", execDescriptor);
  else delete (document as { execCommand?: unknown }).execCommand;
});
it("copies full citation labels through the HTTP clipboard path", async () => {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: undefined,
  });
  let copied = "";
  Object.defineProperty(document, "execCommand", {
    configurable: true,
    value: vi.fn(() => {
      const event = new Event("copy", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", {
        value: { setData: (_type: string, value: string) => (copied = value) },
      });
      document.dispatchEvent(event);
      return true;
    }),
  });
  render(
    <NativeMessageCopy
      kind="assistant"
      text='Source :codex-file-citation{path="/project/source.ts" line_range_start="502" line_range_end="503"}'
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "复制回复" }));
  await screen.findByRole("button", { name: "已复制" });
  expect(copied).toContain("source.ts （第 502-503 行）");
  expect(copied).not.toContain("codex-file-citation{");
});

it("keeps the assistant copied state for the native default two seconds", async () => {
  vi.useFakeTimers();
  const { act } = await import("@testing-library/react");
  try {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    render(<NativeMessageCopy kind="assistant" text="reply" />);
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "复制回复" })),
    );
    await act(async () => vi.advanceTimersByTime(1800));
    expect(screen.getByRole("button", { name: "已复制" })).toBeTruthy();
    await act(async () => vi.advanceTimersByTime(201));
    expect(screen.getByRole("button", { name: "复制回复" })).toBeTruthy();
  } finally {
    vi.useRealTimers();
  }
});
it("releases the copy operation UI when its message unmounts before the write completes", async () => {
  vi.useFakeTimers();
  const { act } = await import("@testing-library/react");
  try {
    let finish!: () => void;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      },
    });
    const view = render(<NativeMessageCopy text="captured" />);
    fireEvent.click(screen.getByRole("button", { name: "复制消息" }));
    view.unmount();
    const baseline = vi.getTimerCount();
    await act(async () => finish());
    expect(vi.getTimerCount()).toBe(baseline);
  } finally {
    vi.useRealTimers();
  }
});
