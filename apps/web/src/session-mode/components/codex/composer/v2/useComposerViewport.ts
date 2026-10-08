import { useEffect } from "react";
import {
  sessionPortalContainer,
  useSessionInteractionVisible,
} from "@session/session-dom";
export function useComposerViewport() {
  const visible = useSessionInteractionVisible();
  useEffect(() => {
    const root = sessionPortalContainer();
    if (!visible || !root) return;
    const viewport = window.visualViewport;
    const update = () => {
      const height = viewport?.height ?? window.innerHeight,
        top = viewport?.offsetTop ?? 0;
      const inset = Math.max(0, window.innerHeight - height - top);
      root.style.setProperty("--session-visual-height", `${height}px`);
      root.style.setProperty("--session-visual-top", `${top}px`);
      root.style.setProperty("--session-keyboard-inset", `${inset}px`);
      root.classList.toggle("session-keyboard-open", inset > 100);
    };
    update();
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    return () => {
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      root.classList.remove("session-keyboard-open");
      for (const key of [
        "--session-visual-height",
        "--session-visual-top",
        "--session-keyboard-inset",
      ])
        root.style.removeProperty(key);
    };
  }, [visible]);
}
