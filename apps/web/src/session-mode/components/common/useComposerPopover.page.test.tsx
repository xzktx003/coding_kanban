import { act, renderHook } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { useLayoutStore } from "@session/stores/useLayoutStore";
import {
  detectWordBoundaryTrigger,
  useComposerPopover,
} from "./useComposerPopover";
test("hidden agent menus stop listening to keys on secondary pages and reopen only in agent view", () => {
  const root = document.createElement("div");
  root.className = "session-mode";
  document.body.append(root);
  useLayoutStore.setState({ view: "agent" });
  const select = vi.fn();
  const detect = detectWordBoundaryTrigger("/");
  const hook = renderHook(() =>
    useComposerPopover({
      input: "/",
      items: ["review"],
      detect,
      onKeySelect: select,
    }),
  );
  expect(hook.result.current.open).toBe(true);
  act(() => useLayoutStore.getState().setView("plugins"));
  expect(hook.result.current.open).toBe(false);
  act(() =>
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  expect(select).not.toHaveBeenCalled();
  act(() => useLayoutStore.getState().setView("agent"));
  expect(hook.result.current.open).toBe(true);
  hook.unmount();
  root.remove();
});
