import { useLayoutEffect, useState, type RefObject } from "react";
import {
  autoUpdate,
  computePosition,
  flip,
  offset,
  platform,
  shift,
} from "@floating-ui/dom";
type Side = "top" | "bottom" | "left" | "right";

/** Native J1t permits horizontal rich-preview fallback before constraining its body. */
export function useNativeRichPreviewSide(
  reference: RefObject<HTMLElement | null>,
  popup: HTMLDivElement | null,
  active: boolean,
  preferred: "top" | "bottom",
): Side {
  const [placement, setPlacement] = useState<Side>(preferred);
  useLayoutEffect(() => {
    const anchor = reference.current;
    if (!active) {
      setPlacement(preferred);
      return;
    }
    if (!anchor || !popup) return;
    let alive = true,
      revision = 0,
      frame: number | undefined;
    const update = () => {
      const captured = ++revision;
      // Radix has already limited this side. Measure the actual animated body's
      // unconstrained size synchronously, restoring it before the next paint.
      let { width, height } = popup.getBoundingClientRect();
      const available = parseFloat(getComputedStyle(popup).maxHeight);
      if (Number.isFinite(available) && height >= available - 1) {
        const maxHeight = popup.style.maxHeight;
        popup.style.maxHeight = "none";
        ({ width, height } = popup.getBoundingClientRect());
        popup.style.maxHeight = maxHeight;
      }
      if (width <= 0 || height <= 0) return;
      void computePosition(anchor, popup, {
        placement: `${preferred}-start`,
        strategy: "fixed",
        middleware: [
          offset(4),
          flip({
            padding: 8,
            flipAlignment: true,
            crossAxis: true,
            fallbackAxisSideDirection: "end",
          }),
          shift({ padding: 8 }),
        ],
        platform: {
          ...platform,
          getDimensions: (element) =>
            element === popup
              ? { width, height }
              : platform.getDimensions(element),
          // Native J1t positions its surface directly in the page. Radix's
          // transformed wrapper must not become this calculation's origin.
          getOffsetParent: (element) =>
            element === popup
              ? popup.ownerDocument.defaultView!
              : platform.getOffsetParent!(element),
        },
      }).then((result) => {
        if (!alive || captured !== revision) return;
        setPlacement(result.placement.split("-")[0] as Side);
        // Radix hides an unpositioned wrapper above the viewport. Its first
        // asynchronous placement must finish before measuring our correction.
        if (popup.parentElement?.style.transform.includes("-200%")) {
          popup.style.removeProperty("transform");
          return;
        }
        // The native surface has m-px; its margin is outside Floating UI's
        // measured rectangle. Radix measures a wrapper including that margin.
        // Keep Radix's focus/dismiss layer and place the visible surface using
        // the native coordinates, including device-pixel rounding.
        const rect = popup.parentElement!.getBoundingClientRect();
        const style = getComputedStyle(popup);
        const dpr = popup.ownerDocument.defaultView!.devicePixelRatio || 1;
        const x =
          Math.round(result.x * dpr) / dpr +
          1 -
          rect.x -
          parseFloat(style.marginLeft);
        const y =
          Math.round(result.y * dpr) / dpr +
          1 -
          rect.y -
          parseFloat(style.marginTop);
        popup.style.transform = `translate(${x}px, ${y}px)`;
      });
    };
    const schedule = () => {
      if (frame !== undefined) return;
      frame = requestAnimationFrame(() => {
        frame = undefined;
        if (alive) update();
      });
    };
    const stop = autoUpdate(anchor, popup, update);
    // Once the body is clipped, its outer ResizeObserver cannot see further
    // intrinsic growth or a failed image's removal. Observe just this card.
    const mutations = new MutationObserver((records) => {
      if (records.some((record) => record.target !== popup)) schedule();
    });
    mutations.observe(popup, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["style", "src"],
    });
    const wrapper = new MutationObserver(update);
    if (popup.parentElement)
      wrapper.observe(popup.parentElement, {
        attributes: true,
        attributeFilter: ["style"],
      });
    return () => {
      alive = false;
      revision++;
      if (frame !== undefined) cancelAnimationFrame(frame);
      stop();
      mutations.disconnect();
      wrapper.disconnect();
      popup.style.removeProperty("transform");
    };
  }, [active, preferred, reference, popup]);
  return active ? placement : preferred;
}
