import { afterEach, expect, it, vi } from "vitest";
import {
  scheduleComposerAutoFocus,
  shouldAutoFocusComposer,
} from "./composerFocus";

const originalMatchMedia = window.matchMedia;
const roots: HTMLElement[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) root.remove();
  vi.restoreAllMocks();
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

function focusFrame() {
  window.matchMedia = vi.fn(() => ({ matches: false }) as MediaQueryList);
  let next = 0;
  const frames = new Map<number, FrameRequestCallback>();
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frames.set(++next, callback);
    return next;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
    frames.delete(id);
  });
  const root = document.createElement("div");
  root.contentEditable = "true";
  root.tabIndex = 0;
  document.body.append(root);
  roots.push(root);
  vi.spyOn(root, "getClientRects").mockReturnValue([
    {},
  ] as unknown as DOMRectList);
  return {
    root,
    flush() {
      for (const [id, callback] of [...frames]) {
        frames.delete(id);
        callback(0);
      }
    },
  };
}

it("defers parent and editor focus requests until layout and focuses their shared root once", () => {
  const { root, flush } = focusFrame();
  const focus = vi.fn(() => root.focus());
  scheduleComposerAutoFocus(() => root, focus);
  scheduleComposerAutoFocus(() => root, focus);
  expect(focus).not.toHaveBeenCalled();
  flush();
  expect(focus).toHaveBeenCalledTimes(1);
  expect(document.activeElement).toBe(root);
});

it("cancels an old owner's request and refuses a replaced native editor root", () => {
  const { root, flush } = focusFrame();
  const focus = vi.fn();
  const cancel = scheduleComposerAutoFocus(() => root, focus);
  cancel();
  flush();
  expect(focus).not.toHaveBeenCalled();
  let current: HTMLElement | null = root;
  scheduleComposerAutoFocus(() => current, focus);
  current = null;
  flush();
  expect(focus).not.toHaveBeenCalled();
});

it("does not steal a newer deliberate focus from another input", () => {
  const { root, flush } = focusFrame();
  const focus = vi.fn(() => root.focus());
  const other = document.createElement("input");
  document.body.append(other);
  roots.push(other);
  scheduleComposerAutoFocus(() => root, focus);
  other.focus();
  flush();
  expect(focus).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(other);
});

for (const hidden of [false, true]) {
  it(`does not focus an editor that became ${hidden ? "hidden" : "disconnected"}`, () => {
    const { root, flush } = focusFrame();
    const focus = vi.fn();
    scheduleComposerAutoFocus(() => root, focus);
    if (hidden)
      vi.mocked(root.getClientRects).mockReturnValue(
        [] as unknown as DOMRectList,
      );
    else root.remove();
    flush();
    expect(focus).not.toHaveBeenCalled();
  });
}

it("retains desktop refocus requests and rechecks touch policy before applying them", () => {
  const { root, flush } = focusFrame();
  const focus = vi.fn(() => root.focus());
  scheduleComposerAutoFocus(() => root, focus);
  flush();
  expect(focus).toHaveBeenCalledTimes(1);
  root.blur();
  focus.mockClear();
  scheduleComposerAutoFocus(() => root, focus);
  window.matchMedia = vi.fn(() => ({ matches: true }) as MediaQueryList);
  flush();
  expect(focus).not.toHaveBeenCalled();
});
