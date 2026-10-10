import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useTranscriptVisibility } from "./useTranscriptVisibility";
import {
  expiredCodexTranscripts,
  markCodexTranscriptDormant,
  isCodexTranscriptDormant,
  forgetCodexTranscript,
} from "@session/services/codexTranscriptActivity";
const load = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("@session/services/codexService", () => ({
  codexService: { loadThreadHistory: load },
}));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  forgetCodexTranscript("view");
  load.mockClear();
});

it("releases a kept-mounted session when switching to terminal mode and restores on return", () => {
  vi.useFakeTimers();
  const root = document.createElement("div");
  root.className = "session-mode";
  document.body.append(root);
  const { result, unmount } = renderHook(() => useTranscriptVisibility("view"));
  try {
    act(() => result.current.ref(document.createElement("div")));
    act(() => {
      root.hidden = true;
      window.dispatchEvent(new Event("workbench-mode-changed"));
    });
    act(() => vi.advanceTimersByTime(60_000));
    expect(expiredCodexTranscripts()).toContain("view");
    act(() => markCodexTranscriptDormant("view"));
    expect(result.current.renderTranscript).toBe(false);
    act(() => {
      root.hidden = false;
      window.dispatchEvent(new Event("workbench-mode-changed"));
    });
    expect(result.current.renderTranscript).toBe(true);
    expect(load).toHaveBeenCalledOnce();
  } finally {
    unmount();
    root.remove();
  }
});

it("releases the view when its viewport leaves, then restores on reentry with observer cleanup", () => {
  vi.useFakeTimers();
  let notify!: IntersectionObserverCallback;
  const disconnect = vi.fn();
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: IntersectionObserverCallback) {
        notify = callback;
      }
      observe() {}
      disconnect = disconnect;
    },
  );
  const { result, unmount } = renderHook(() => useTranscriptVisibility("view"));
  act(() => result.current.ref(document.createElement("div")));
  act(() =>
    notify(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    ),
  );
  act(() => vi.advanceTimersByTime(61_000));
  expect(expiredCodexTranscripts()).not.toContain("view");
  act(() =>
    notify(
      [{ isIntersecting: false } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    ),
  );
  act(() => vi.advanceTimersByTime(60_000));
  expect(expiredCodexTranscripts()).toContain("view");
  act(() => markCodexTranscriptDormant("view"));
  expect(result.current.renderTranscript).toBe(false);
  expect(isCodexTranscriptDormant("view")).toBe(true);
  act(() =>
    notify(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    ),
  );
  expect(result.current.renderTranscript).toBe(true);
  expect(load).toHaveBeenCalledWith("view", undefined, {
    background: true,
    recent: true,
  });
  unmount();
  expect(disconnect).toHaveBeenCalledOnce();
});

it("releases ownership when the browser document hides even if the viewport remains intersecting", () => {
  vi.useFakeTimers();
  const { result, unmount } = renderHook(() => useTranscriptVisibility("view"));
  act(() => result.current.ref(document.createElement("div")));
  const visibility = vi
    .spyOn(document, "visibilityState", "get")
    .mockReturnValue("hidden");
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  act(() => vi.advanceTimersByTime(60_000));
  expect(expiredCodexTranscripts()).toContain("view");
  act(() => markCodexTranscriptDormant("view"));
  expect(result.current.renderTranscript).toBe(false);
  visibility.mockReturnValue("visible");
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  expect(result.current.renderTranscript).toBe(true);
  expect(isCodexTranscriptDormant("view")).toBe(false);
  unmount();
  visibility.mockRestore();
});
