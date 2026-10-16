import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { NativeReviewFileDiff } from "./NativeReviewFileDiff";

const descriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
afterEach(() => {
  if (descriptor) Object.defineProperty(navigator, "clipboard", descriptor);
  else delete (navigator as { clipboard?: unknown }).clipboard;
});

it("does not publish an old review copy failure after changing the owning turn away and back", async () => {
  let reject!: (error: Error) => void;
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: vi.fn(
        () =>
          new Promise<void>((_done, fail) => {
            reject = fail;
          }),
      ),
    },
  });
  const review = (turnId: string) => (
    <NativeReviewFileDiff
      owner={{ threadId: "owner", turnId, cwd: "/owner" }}
      path="source.ts"
      displayPath="/owner/source.ts"
      unifiedDiff="@@ -1 +1 @@\n-before\n+after\n"
      isCollapsed={false}
    />
  );
  const view = render(review("turn-a"));
  fireEvent.pointerDown(screen.getByRole("button", { name: "文件操作" }), {
    button: 0,
    ctrlKey: false,
  });
  fireEvent.click(await screen.findByRole("menuitem", { name: "复制补丁" }));
  view.rerender(review("turn-b"));
  view.rerender(review("turn-a"));
  await act(async () => reject(new Error("late failure")));
  expect(screen.queryByRole("alert")).toBeNull();
});
