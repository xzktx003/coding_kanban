import { useEffect, useRef, useState, type ReactNode } from "react";

/** Original fg: live captions dwell for 1s; a terminal summary is immediate. */
export function useNativeDeferredHeader(key: string, node: ReactNode, immediate: boolean) {
  const [shown, setShown] = useState(() => ({ key, node }));
  const since = useRef<number | null>(null);
  useEffect(() => {
    const now = Date.now();
    since.current ??= now;
    if (key === shown.key) return;
    const update = () => {
      since.current = Date.now();
      setShown({ key, node });
    };
    const remaining = 1000 - (now - since.current);
    if (immediate || remaining <= 0) {
      update();
      return;
    }
    const timer = setTimeout(update, remaining);
    return () => clearTimeout(timer);
  }, [key, node, immediate, shown.key]);
  return immediate || key === shown.key ? node : shown.node;
}
