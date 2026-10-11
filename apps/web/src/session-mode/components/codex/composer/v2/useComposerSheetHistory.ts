import { v4 as randomUUID } from "uuid";
import { useEffect, useRef } from "react";
import { useSessionInteractionVisible } from "@session/session-dom";
let pendingClose: string | null = null;
export function useComposerSheetHistory(onClose: () => void) {
  const close = useRef(onClose);
  close.current = onClose;
  const visible = useSessionInteractionVisible();
  // A sheet consumes one browser Back step; closing it never navigates away from the session.
  useEffect(() => {
    if (!visible) return;
    const marker = randomUUID();
    if (pendingClose && history.state?.composerSheet === pendingClose)
      history.replaceState({ ...history.state, composerSheet: marker }, "");
    else history.pushState({ ...history.state, composerSheet: marker }, "");
    pendingClose = null;
    const back = () => {
      if (history.state?.composerSheet !== marker) close.current();
    };
    window.addEventListener("popstate", back);
    return () => {
      window.removeEventListener("popstate", back);
      if (history.state?.composerSheet === marker) {
        pendingClose = marker;
        queueMicrotask(() => {
          if (pendingClose === marker) {
            pendingClose = null;
            if (history.state?.composerSheet === marker) history.back();
          }
        });
      }
    };
  }, [visible]);
  return visible;
}
