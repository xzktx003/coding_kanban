import { afterEach, expect, it, vi } from "vitest";
import {
  REVEAL_FLASH_DURATION_MS,
  REVEAL_FLASH_EASING,
  flashRowWhenMounted,
  prefersReducedMotion,
  revealUserMessageFlash,
} from "./userMessageReveal";

/**
 * Ported from the shipped 26.51007.21434 webview's
 * `thread-user-message-navigation-rail-5c89c24e73d1.js`, whose reveal is:
 *
 *   (e?.querySelector(`[data-user-message-bubble]`)
 *     ?? e?.querySelector(`[data-composer-attachment-pill]`))?.animate?.(
 *     [{backgroundColor:Pt},{backgroundColor:Pt,offset:.35},{backgroundColor:Ft}],
 *     {duration:t?0:I, easing:`cubic-bezier(0.23, 1, 0.32, 1)`})
 *
 * `I` resolves through `app-initial-41ab338a184f.js` (`PRt as xIt`) to 1400, so
 * the hold-then-decay runs for 1400ms — not the rail's unrelated 150ms hover
 * delay. `Pt` is a 14% text mix and `Ft` the bubble's resting 5% mix; our
 * bubbles rest on `--codex-secondary` instead, so the decay has to land on that
 * token rather than on a mix the plugin's theme happens to make equal to rest.
 */
const bubbleRow = () => {
  const row = document.createElement("div");
  row.innerHTML = '<div data-user-message-bubble="true">用户消息</div>';
  document.body.append(row);
  return row;
};

const stub = (element: Element) => {
  const animate = vi.fn();
  Object.defineProperty(element, "animate", { value: animate, writable: true });
  return animate;
};

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

it("flashes the user bubble with the plugin's own keyframes", () => {
  const row = bubbleRow();
  const bubble = row.querySelector("[data-user-message-bubble]")!;
  const animate = stub(bubble);

  revealUserMessageFlash(row);

  expect(animate).toHaveBeenCalledTimes(1);
  const [keyframes, options] = animate.mock.calls[0];
  // Hold the emphasis for the first 35% of the run, then decay to rest.
  expect(keyframes).toHaveLength(3);
  expect(keyframes[0].backgroundColor).toBe(keyframes[1].backgroundColor);
  expect(keyframes[1].offset).toBe(0.35);
  expect(keyframes[2].backgroundColor).not.toBe(keyframes[0].backgroundColor);
  // The peak is a 14% text mix over our own resting token, and the decay lands
  // back on that token, so the bubble returns to its real background.
  expect(keyframes[0].backgroundColor).toContain("14%");
  expect(keyframes[0].backgroundColor).toContain("--codex-text");
  expect(keyframes[2].backgroundColor).toBe("var(--codex-secondary)");
  expect(options).toMatchObject({
    duration: REVEAL_FLASH_DURATION_MS,
    easing: REVEAL_FLASH_EASING,
  });
  expect(REVEAL_FLASH_DURATION_MS).toBe(1400);
  expect(REVEAL_FLASH_EASING).toBe("cubic-bezier(0.23, 1, 0.32, 1)");
});

it("collapses the flash to zero under reduced motion", () => {
  const row = bubbleRow();
  const animate = stub(row.querySelector("[data-user-message-bubble]")!);

  revealUserMessageFlash(row, true);

  expect(animate.mock.calls[0][1]).toMatchObject({ duration: 0 });
});

// Parity-only: session mode renders attachments inside the bubble, so nothing
// produces `[data-composer-attachment-pill]` here yet. The branch is kept
// because the plugin has it, and this pins its behaviour if a producer appears.
it("falls back to an attachment pill when the row has no bubble", () => {
  const row = document.createElement("div");
  row.innerHTML = '<div data-composer-attachment-pill="true">图片</div>';
  document.body.append(row);
  const animate = stub(row.querySelector("[data-composer-attachment-pill]")!);

  revealUserMessageFlash(row);

  expect(animate).toHaveBeenCalledTimes(1);
});

it("stays silent for a missing row or a host without animations", () => {
  // jsdom has no `Element.animate`, which is exactly why the plugin guards the
  // call; an unsupported host must not throw mid-navigation.
  expect(() => revealUserMessageFlash(null)).not.toThrow();
  expect(() => revealUserMessageFlash(bubbleRow())).not.toThrow();
});

/**
 * Our transcript is virtualized, so the row the rail jumped to may not be in the
 * DOM on the frame the jump starts — the plugin's transcript is not, and flashes
 * synchronously. Waiting a bounded number of frames keeps the flash correct here
 * without spinning forever when the row never mounts (a folded or dropped row).
 */
const frameRunner = () => {
  const queue: FrameRequestCallback[] = [];
  return {
    raf: (callback: FrameRequestCallback) => {
      queue.push(callback);
      return queue.length;
    },
    tick(times = 1) {
      for (let i = 0; i < times; i++) queue.shift()?.(0);
    },
    get pending() {
      return queue.length;
    },
  };
};

it("flashes a row that only mounts a few frames after the jump", () => {
  const frames = frameRunner();
  const animate = vi.fn();
  let row: Element | null = null;

  flashRowWhenMounted({
    findRow: () => row,
    requestFrame: frames.raf,
  });
  frames.tick(3);
  expect(animate).not.toHaveBeenCalled();

  const mounted = bubbleRow();
  Object.defineProperty(
    mounted.querySelector("[data-user-message-bubble]")!,
    "animate",
    {
      value: animate,
    },
  );
  row = mounted;
  frames.tick();

  expect(animate).toHaveBeenCalledTimes(1);
});

it("gives up instead of polling forever when the row never mounts", () => {
  const frames = frameRunner();

  flashRowWhenMounted({ findRow: () => null, requestFrame: frames.raf });
  frames.tick(50);

  expect(frames.pending).toBe(0);
});

it("flashes only once even if later frames still find the row", () => {
  const frames = frameRunner();
  const row = bubbleRow();
  const animate = vi.fn();
  Object.defineProperty(
    row.querySelector("[data-user-message-bubble]")!,
    "animate",
    {
      value: animate,
    },
  );

  flashRowWhenMounted({ findRow: () => row, requestFrame: frames.raf });
  frames.tick(5);

  expect(animate).toHaveBeenCalledTimes(1);
});

/**
 * The plan window is a separate OS window, so the preference has to be read from
 * the document that actually owns the row — `CodexThread` passes
 * `rootRef.current?.ownerDocument.defaultView` for exactly that reason. Reading
 * the ambient `window` instead would apply the opener's preference.
 */
it("reads the motion preference from the window that owns the row", () => {
  const view = {
    matchMedia: vi.fn(() => ({ matches: true })),
  } as unknown as Window;

  expect(prefersReducedMotion(view)).toBe(true);
  expect(view.matchMedia).toHaveBeenCalledWith(
    "(prefers-reduced-motion: reduce)",
  );
});

it("treats a window without matchMedia as motion-allowed", () => {
  expect(prefersReducedMotion({} as Window)).toBe(false);
  expect(prefersReducedMotion(null)).toBe(false);
});
