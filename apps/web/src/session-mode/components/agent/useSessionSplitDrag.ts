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
import { createSessionTabPreview } from "./sessionTabPreview";

type Gesture = {
  key: string;
  pointerId: number;
  startX: number;
  startY: number;
  source: HTMLElement;
  dragging: boolean;
};

/** Pointer capture keeps a tab drag alive across text, scrollbars and browser edges. */
export function useSessionSplitDrag() {
  const root = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const floatingTab =
    useRef<ReturnType<typeof createSessionTabPreview>>(undefined);
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
      floatingTab.current?.move(event.clientX, event.clientY);
      const hit = sessionDropTarget(root.current, event.clientX, event.clientY);
      for (const tab of root.current.querySelectorAll<HTMLElement>(
        "[data-pointer-drop]",
      ))
        delete tab.dataset.pointerDrop;
      if (hit?.tab && hit.beforeKey !== current.key)
        hit.tab.dataset.pointerDrop = "true";
      const next = hit?.tab ? null : hit;
      setPreview((previous) =>
        previous?.groupId === next?.groupId && previous?.edge === next?.edge
          ? previous
          : next,
      );
      const strip = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest<HTMLElement>(".session-tab-strip");
      if (strip && root.current.contains(strip)) {
        const bounds = strip.getBoundingClientRect();
        if (event.clientX < bounds.left + 28) strip.scrollLeft -= 18;
        else if (event.clientX > bounds.right - 28) strip.scrollLeft += 18;
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
    const abort = () => {
      if (gesture.current?.dragging)
        cancelledPointer.current = gesture.current.pointerId;
      cancel();
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
      };
      // Suppress native text/image dragging without capturing ordinary clicks.
      event.preventDefault();
    },
    [visible, mobile, cancel],
  );
  return { root, preview, start };
}
