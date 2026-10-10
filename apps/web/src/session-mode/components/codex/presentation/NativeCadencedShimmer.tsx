import { useEffect, useRef, type ReactNode } from "react";
/** Original p3/Eei cadence: first sweep 600ms, one-second sweep every four seconds. */
export function NativeCadencedShimmer({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const element = ref.current;
    if (!element) return;
    let finish: ReturnType<typeof setTimeout> | undefined;
    let interval: ReturnType<typeof setInterval> | undefined;
    const sweep = () => {
      if (document.hidden || element.closest("[hidden]")) return;
      if (finish) clearTimeout(finish);
      element.classList.remove("is-sweeping");
      element.classList.add("is-sweeping");
      finish = setTimeout(() => {
        element.classList.remove("is-sweeping");
        finish = undefined;
      }, 1000);
    };
    const initial = setTimeout(() => {
      sweep();
      interval = setInterval(sweep, 4000);
    }, 600);
    return () => {
      clearTimeout(initial);
      if (finish) clearTimeout(finish);
      if (interval) clearInterval(interval);
      element.classList.remove("is-sweeping");
    };
  }, []);
  return (
    <span ref={ref} className="codex-cadenced-shimmer">
      {children}
      <span aria-hidden="true" className="codex-cadenced-sweep">
        <span className="codex-cadenced-highlight">{children}</span>
      </span>
    </span>
  );
}
