import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { IndividualFileChanges } from "./IndividualFileChanges";
import { getChangeCounts, getDiffViewerProps } from "./fileChangeLogic";
import { CodexContentOwner } from "../presentation/ownerContext";

const notices = vi.hoisted(() => ({ danger: vi.fn() }));
vi.mock("@session/features/native-notifications/service", () => ({
  nativeNotifications: notices,
}));
vi.mock("@session/features/DiffViewer", () => ({
  DiffViewer: () => <div>Diff body</div>,
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
const patch = "@@ -1 +1 @@\n-before\n+after\n\\ No newline at end of file\n";
function files(diff = patch) {
  return (
    <IndividualFileChanges
      changes={[
        {
          path: "/fixture/source.ts",
          kind: { type: "update", move_path: null },
          diff,
        },
      ]}
      fileChangeMap={{ add: "创建", update: "编辑", delete: "删除" }}
      getChangeCounts={getChangeCounts}
      getDiffViewerProps={getDiffViewerProps}
    />
  );
}
function expand() {
  fireEvent.click(
    screen.getByRole("button", { name: "展开或收起 source.ts Diff" }),
  );
}

it("copies the untouched patch through the HTTP fallback and restores the draft selection", async () => {
  clipboard();
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
      {files()}
    </>,
  );
  expand();
  const input = screen.getByRole("textbox", {
    name: "Draft",
  }) as HTMLInputElement;
  input.focus();
  input.setSelectionRange(1, 5, "backward");
  fireEvent.click(screen.getByRole("button", { name: "Copy" }));
  await waitFor(() =>
    expect(
      screen
        .getByRole("button", { name: "Copy" })
        .getAttribute("title"),
    ).toBe("Copied!"),
  );
  expect(exec).toHaveBeenCalledExactlyOnceWith("copy");
  expect(copied).toBe(patch);
  expect(document.activeElement).toBe(input);
  expect([
    input.selectionStart,
    input.selectionEnd,
    input.selectionDirection,
  ]).toEqual([1, 5, "backward"]);
  expect(input.value).toBe("unchanged draft");
});

it("coalesces pending patch copies, reports failure once, and permits retry", async () => {
  let reject!: (error: Error) => void;
  const write = vi.fn(
    () =>
      new Promise<void>((_done, fail) => {
        reject = fail;
      }),
  );
  clipboard(write);
  render(files());
  expand();
  const button = screen.getByRole("button", { name: "Copy" });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(write).toHaveBeenCalledExactlyOnceWith(patch);
  expect(button.getAttribute("aria-busy")).toBe("true");
  await act(async () => reject(new Error("denied")));
  expect(notices.danger).toHaveBeenCalledExactlyOnceWith("无法复制到剪贴板", {
    id: "copy-to-clipboard-error",
    description: "内容未复制。请在 ChatGPT 处于焦点时重试",
  });
  expect(button.getAttribute("title")).toBe("Copy");
  write.mockImplementation(async () => {});
  fireEvent.click(button);
  await waitFor(() => expect(button.getAttribute("title")).toBe("Copied!"));
});

it.each(["resolve", "reject"])(
  "ignores a late %s after changing patches away and back",
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
    const view = render(files());
    expand();
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    view.rerender(files("@@ -2 +2 @@\n-A\n+B\n"));
    view.rerender(files());
    await act(async () =>
      settle === "resolve" ? resolve() : reject(new Error("late")),
    );
    expect(
      screen
        .getByRole("button", { name: "Copy" })
        .getAttribute("title"),
    ).toBe("Copy");
    expect(notices.danger).not.toHaveBeenCalled();
  },
);

it("releases the feedback timer when its Diff is closed", async () => {
  vi.useFakeTimers();
  clipboard(vi.fn(async () => {}));
  render(files());
  expand();
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Copy" })),
  );
  const before = vi.getTimerCount();
  expand();
  expect(vi.getTimerCount()).toBeLessThan(before);
});

it("does not publish a copy receipt into another thread showing the same file and patch", async () => {
  let resolve!: () => void;
  clipboard(
    vi.fn(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    ),
  );
  const content = (thread: string) => (
    <CodexContentOwner.Provider value={thread}>
      {files()}
    </CodexContentOwner.Provider>
  );
  const view = render(content("first"));
  expand();
  fireEvent.click(screen.getByRole("button", { name: "Copy" }));
  view.rerender(content("second"));
  view.rerender(content("first"));
  await act(async () => resolve());
  expect(
    screen
      .getByRole("button", { name: "Copy" })
      .getAttribute("title"),
  ).toBe("Copy");
});
