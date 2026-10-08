import { afterEach, expect, it, vi } from "vitest";
import { shouldAutoFocusComposer } from "./composerFocus";

const originalMatchMedia = window.matchMedia;

afterEach(() => {
  window.matchMedia = originalMatchMedia;
});

it("does not auto-focus on coarse-pointer devices", () => {
  window.matchMedia = vi.fn(
    () => ({ matches: true }) as unknown as MediaQueryList,
  );
  expect(shouldAutoFocusComposer()).toBe(false);
});

it("keeps desktop auto-focus behaviour", () => {
  window.matchMedia = vi.fn(
    () => ({ matches: false }) as unknown as MediaQueryList,
  );
  expect(shouldAutoFocusComposer()).toBe(true);
});
