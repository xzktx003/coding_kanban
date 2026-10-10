import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useLayoutStore } from "./useLayoutStore";
import {
  registerSessionLeaveGuard,
  cancelSessionNavigation,
  confirmSessionNavigation,
  useSessionNavigationGuard,
} from "@session/services/sessionNavigationGuard";
let unregister: (() => void) | undefined;
beforeEach(() => {
  useLayoutStore.setState({ view: "settings" });
  useSessionNavigationGuard.setState({ pending: null });
});
afterEach(() => {
  unregister?.();
  unregister = undefined;
  useSessionNavigationGuard.setState({ pending: null });
});
it("runs the navigation callback only after one confirmed page departure and never after cancel", () => {
  unregister = registerSessionLeaveGuard(() => ({
    dirty: true,
    saving: false,
  }));
  const proceed = vi.fn();
  useLayoutStore.getState().setView("agent", proceed);
  expect(proceed).not.toHaveBeenCalled();
  expect(useLayoutStore.getState().view).toBe("settings");
  cancelSessionNavigation();
  expect(proceed).not.toHaveBeenCalled();
  useLayoutStore.getState().setView("agent", proceed);
  confirmSessionNavigation();
  expect(proceed).toHaveBeenCalledTimes(1);
  expect(useLayoutStore.getState().view).toBe("agent");
  expect(useSessionNavigationGuard.getState().pending).toBeNull();
  confirmSessionNavigation();
  expect(proceed).toHaveBeenCalledTimes(1);
});
it("same-page callbacks run once without creating history or a duplicate leave dialog", () => {
  const proceed = vi.fn();
  useLayoutStore.getState().setView("settings", proceed);
  expect(proceed).toHaveBeenCalledTimes(1);
  expect(useSessionNavigationGuard.getState().pending).toBeNull();
});
