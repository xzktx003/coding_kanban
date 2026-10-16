import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DiffViewer } from "./DiffViewer";

const clipboardDescriptor = Object.getOwnPropertyDescriptor(
  navigator,
  "clipboard",
);
const execDescriptor = Object.getOwnPropertyDescriptor(document, "execCommand");
afterEach(() => {
  vi.useRealTimers();
  if (clipboardDescriptor)
    Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
  else delete (navigator as { clipboard?: unknown }).clipboard;
  if (execDescriptor)
    Object.defineProperty(document, "execCommand", execDescriptor);
  else delete (document as { execCommand?: unknown }).execCommand;
});
const patch = "@@ -1 +1 @@\n-before\n+after\n\\ No newline at end of file\n";
function viewer(unifiedDiff = patch, displayPath = "/owner/source.ts") {
  return (
    <DiffViewer
      native
      unifiedDiff={unifiedDiff}
      displayPath={displayPath}
      isCollapsed={false}
    />
  );
}
function clipboard(writeText?: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: writeText ? { writeText } : undefined,
  });
}

it("uses HTTP fallback for the full patch and preserves the focused draft selection", async () => {
  clipboard();
  let source = "";
  const exec = vi.fn(() => {
    source = document.querySelector("textarea")!.value;
    return true;
  });
  Object.defineProperty(document, "execCommand", {
    configurable: true,
    value: exec,
  });
  render(
    <>
      <input aria-label="Draft" defaultValue="saved draft" />
      {viewer()}
    </>,
  );
  const input = screen.getByRole("textbox", {
    name: "Draft",
  }) as HTMLInputElement;
  input.focus();
  input.setSelectionRange(1, 4, "backward");
  fireEvent.click(screen.getByRole("button", { name: "Copy" }));
  await waitFor(() =>
    expect(
      screen
        .getByRole("button", { name: "Copy" })
        .getAttribute("title"),
    ).toBe("Copied!"),
  );
  expect(exec).toHaveBeenCalledExactlyOnceWith("copy");
  expect(source).toBe(patch);
  expect(document.activeElement).toBe(input);
  expect([
    input.selectionStart,
    input.selectionEnd,
    input.selectionDirection,
  ]).toEqual([1, 4, "backward"]);
});

it("coalesces pending copies and releases the lock after failure", async () => {
  let reject!: (error: Error) => void;
  const write = vi.fn(
    () =>
      new Promise<void>((_done, fail) => {
        reject = fail;
      }),
  );
  clipboard(write);
  render(viewer());
  const button = screen.getByRole("button", { name: "Copy" });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(write).toHaveBeenCalledExactlyOnceWith(patch);
  expect(button.getAttribute("aria-busy")).toBe("true");
  await act(async () => reject(new Error("denied")));
  expect(screen.getByRole("alert").textContent).toContain("复制失败");
  write.mockImplementation(async () => {});
  fireEvent.click(button);
  await waitFor(() => expect(button.getAttribute("title")).toBe("Copied!"));
});

it.each(["resolve", "reject"])(
  "ignores a late %s after a file changes away and back",
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
    const view = render(viewer());
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    view.rerender(viewer("@@ -2 +2 @@\n-A\n+B\n", "/other/source.ts"));
    view.rerender(viewer());
    await act(async () =>
      settle === "resolve" ? resolve() : reject(new Error("late")),
    );
    expect(
      screen
        .getByRole("button", { name: "Copy" })
        .getAttribute("title"),
    ).toBe("Copy");
    expect(screen.queryByRole("alert")).toBeNull();
  },
);

it("copies the review path on HTTP without an unhandled exception", async () => {
  clipboard();
  let source = "";
  Object.defineProperty(document, "execCommand", {
    configurable: true,
    value: () => {
      source = document.querySelector("textarea")!.value;
      return true;
    },
  });
  render(
    <DiffViewer
      native
      presentation="review"
      displayPath="/owner/source.ts"
      unifiedDiff={patch}
      isCollapsed={false}
    />,
  );
  fireEvent.pointerDown(screen.getByRole("button", { name: "文件操作" }), {
    button: 0,
    ctrlKey: false,
  });
  fireEvent.click(await screen.findByRole("menuitem", { name: "复制路径" }));
  await waitFor(() => expect(source).toBe("/owner/source.ts"));
});
