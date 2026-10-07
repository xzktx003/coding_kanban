import { act, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import {
  detectWordBoundaryTrigger,
  useComposerPopover,
} from "./useComposerPopover";
it("does not execute an open composer command when Enter is pressed in a dialog", () => {
  const root = document.createElement("div");
  root.className = "session-mode";
  document.body.append(root);
  const dialog = document.createElement("div");
  dialog.setAttribute("role", "dialog");
  root.append(dialog);
  const input = document.createElement("input");
  dialog.append(input);
  const select = vi.fn();
  const hook = renderHook(() =>
    useComposerPopover({
      input: "/",
      items: ["review"],
      detect: detectWordBoundaryTrigger("/"),
      onKeySelect: select,
    }),
  );
  act(() =>
    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  expect(select).not.toHaveBeenCalled();
  hook.unmount();
  root.remove();
});
