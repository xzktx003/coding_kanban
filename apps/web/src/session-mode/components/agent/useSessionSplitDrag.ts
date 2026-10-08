import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  isAgentInteractionVisible,
  useAgentInteractionVisible,
} from "@session/session-dom";
import { useIsMobile } from "@session/hooks/use-mobile";
import { useSessionTabActions } from "@session/hooks/useSessionTabs";
import {
  sessionDropTarget,
  placeSessionDrag,
  sessionDragCard,
  sessionTabDrag,
  type SessionDropTarget,
} from "./sessionTabDrag";
import {
  createSessionTabPreview,
  createSessionTabInsertionMarker,
} from "./sessionTabPreview";

type Gesture = {
  key: string;
  pointerId: number;
  startX: number;
  startY: number;
  source: HTMLElement;
  dragging: boolean;
  x: number;
  y: number;
};

/** Pointer capture keeps a tab drag alive across text, scrollbars and browser edges. */
export function useSessionSplitDrag() {
  const root = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const floatingTab =
    useRef<ReturnType<typeof createSessionTabPreview>>(undefined);
  const insertionMarker =
    useRef<ReturnType<typeof createSessionTabInsertionMarker>>(undefined);
  const scrollFrame = useRef<number | null>(null);
  const cancelledPointer = useRef<number | null>(null);
  const suppressedClick = useRef<{ x: number; y: number; time: number } | null>(
    null,
  );
  const [preview, setPreview] = useState<SessionDropTarget | null>(null);
  const visible = useAgentInteractionVisible();
  const mobile = useIsMobile();
  const { selectTab } = useSessionTabActions();
  const cancel = useCallback(() => {
    const current = gesture.current;
    gesture.current = null;
    floatingTab.current?.destroy();
    floatingTab.current = undefined;
    insertionMarker.current?.destroy();
    insertionMarker.current = undefined;
    if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current);
    scrollFrame.current = null;
    if (current) delete current.source.dataset.pointerSource;
    if (current?.source.hasPointerCapture?.(current.pointerId))
      current.source.releasePointerCapture(current.pointerId);
    sessionTabDrag.key = null;
    if (root.current) {
      delete root.current.dataset.sessionDragging;
      for (const tab of root.current.querySelectorAll<HTMLElement>(
        "[data-pointer-drop]",
      ))
        delete tab.dataset.pointerDrop;
    }
    setPreview(null);
  }, []);

  useEffect(() => {
    if (!visible || mobile) {
      cancel();
      return;
    }
    const abort = () => {
      if (gesture.current?.dragging)
        cancelledPointer.current = gesture.current.pointerId;
      cancel();
    };
    const showTarget = (current: Gesture) => {
      if (!root.current) return null;
      const hit = sessionDropTarget(root.current, current.x, current.y);
      if (hit?.strip && hit.insertion) {
        insertionMarker.current ??= createSessionTabInsertionMarker(
          root.current,
        );
        insertionMarker.current?.show(hit);
      } else {
        insertionMarker.current?.destroy();
        insertionMarker.current = undefined;
      }
      const next = hit?.strip ? null : hit;
      setPreview((previous) =>
        previous?.groupId === next?.groupId && previous?.edge === next?.edge
          ? previous
          : next,
      );
      return hit;
    };
    const scrollDirection = (strip: HTMLElement, x: number) => {
      if (strip.scrollWidth <= strip.clientWidth) return 0;
      const bounds = strip.getBoundingClientRect();
      const left = x - bounds.left;
      const right = bounds.right - x;
      if (left < 28 && strip.scrollLeft > 0)
        return -Math.max(2, Math.round(12 * (1 - left / 28)));
      if (
        right < 28 &&
        strip.scrollLeft < strip.scrollWidth - strip.clientWidth
      )
        return Math.max(2, Math.round(12 * (1 - right / 28)));
      return 0;
    };
    const scroll = () => {
      scrollFrame.current = null;
      const current = gesture.current;
      if (!current?.dragging || !root.current) return;
      if (
        !isAgentInteractionVisible() ||
        !current.source.isConnected ||
        !sessionDragCard(current.key)
      ) {
        abort();
        return;
      }
      const target = sessionDropTarget(root.current, current.x, current.y);
      const strip = target?.strip;
      const delta = strip ? scrollDirection(strip, current.x) : 0;
      if (!strip || !delta) return;
      strip.scrollLeft += delta;
      showTarget(current);
      scrollFrame.current = requestAnimationFrame(scroll);
    };
    const move = (event: PointerEvent) => {
      const current = gesture.current;
      if (!current || event.pointerId !== current.pointerId || !root.current)
        return;
      if (!isAgentInteractionVisible()) {
        cancel();
        return;
      }
      if (!current.source.isConnected || !sessionDragCard(current.key)) {
        cancel();
        return;
      }
      if (
        !current.dragging &&
        Math.hypot(
          event.clientX - current.startX,
          event.clientY - current.startY,
        ) < 6
      )
        return;
      if (!current.dragging) {
        current.dragging = true;
        floatingTab.current = createSessionTabPreview(
          current.source,
          current.startX,
          current.startY,
        );
        current.source.dataset.pointerSource = "true";
        sessionTabDrag.key = current.key;
        root.current.dataset.sessionDragging = "true";
        current.source.setPointerCapture?.(current.pointerId);
        window.getSelection()?.removeAllRanges();
      }
      event.preventDefault();
      current.x = event.clientX;
      current.y = event.clientY;
      floatingTab.current?.move(event.clientX, event.clientY);
      const hit = showTarget(current);
      if (hit?.strip && scrollDirection(hit.strip, current.x)) {
        if (scrollFrame.current === null)
          scrollFrame.current = requestAnimationFrame(scroll);
      } else if (scrollFrame.current !== null) {
        cancelAnimationFrame(scrollFrame.current);
        scrollFrame.current = null;
      }
    };
    const finish = (event: PointerEvent) => {
      const current = gesture.current;
      if (!current && cancelledPointer.current === event.pointerId) {
        cancelledPointer.current = null;
        suppressedClick.current = {
          x: event.clientX,
          y: event.clientY,
          time: performance.now(),
        };
        event.preventDefault();
        return;
      }
      if (!current || event.pointerId !== current.pointerId) return;
      const target =
        current.dragging && root.current && isAgentInteractionVisible()
          ? sessionDropTarget(root.current, event.clientX, event.clientY)
          : null;
      if (current.dragging) {
        event.preventDefault();
        suppressedClick.current = {
          x: event.clientX,
          y: event.clientY,
          time: performance.now(),
        };
      }
      cancel();
      if (target) {
        const source = placeSessionDrag(current.key, target);
        if (source) void selectTab(source);
      }
    };
    const cancelPointer = (event: PointerEvent) => {
      if (gesture.current?.pointerId === event.pointerId) abort();
    };
    const keyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && gesture.current) {
        event.preventDefault();
        event.stopImmediatePropagation();
        abort();
      }
    };
    const click = (event: MouseEvent) => {
      const last = suppressedClick.current;
      if (!last) return;
      suppressedClick.current = null;
      if (
        performance.now() - last.time < 400 &&
        Math.hypot(event.clientX - last.x, event.clientY - last.y) < 3
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    window.addEventListener("pointermove", move, {
      capture: true,
      passive: false,
    });
    window.addEventListener("pointerup", finish, true);
    window.addEventListener("pointercancel", cancelPointer, true);
    window.addEventListener("keydown", keyDown, true);
    window.addEventListener("click", click, true);
    window.addEventListener("blur", abort);
    return () => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", finish, true);
      window.removeEventListener("pointercancel", cancelPointer, true);
      window.removeEventListener("keydown", keyDown, true);
      window.removeEventListener("click", click, true);
      window.removeEventListener("blur", abort);
      cancel();
    };
  }, [visible, mobile, cancel, selectTab]);

  const start = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (
        !visible ||
        mobile ||
        event.button !== 0 ||
        event.pointerType === "touch"
      )
        return;
      const element = event.target as HTMLElement;
      if (element.closest(".session-tab-actions, .session-tab-mobile-menu"))
        return;
      const source = element.closest<HTMLElement>("[data-session-drag-key]");
      const key = source?.dataset.sessionDragKey;
      if (!source || !key) return;
      cancel();
      cancelledPointer.current = null;
      gesture.current = {
        key,
        pointerId: event.pointerId,
        source,
        startX: event.clientX,
        startY: event.clientY,
        dragging: false,
        x: event.clientX,
        y: event.clientY,
      };
      // Suppress native text/image dragging without capturing ordinary clicks.
      event.preventDefault();
    },
    [visible, mobile, cancel],
  );
  return { root, preview, start };
}
