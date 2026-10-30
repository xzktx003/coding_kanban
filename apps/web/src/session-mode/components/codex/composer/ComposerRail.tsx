import { createContext, useContext, useLayoutEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import "./composer-rail.css";

const RailPresence = createContext(true);
const ReducedMotion = createContext(false);
// Portals do not inherit DOM inert. Consumers with sheets/menus must also close
// those surfaces while their retained rail item is exiting.
export const useComposerRailPresent = () => useContext(RailPresence);

function useReducedMotion() {
  const query = useMemo(() => window.matchMedia("(prefers-reduced-motion: reduce)"), []);
  return useSyncExternalStore(listener => {
    query.addEventListener("change", listener);
    return () => query.removeEventListener("change", listener);
  }, () => query.matches, () => false);
}

export function ComposerRail({ children }: { children: ReactNode }) {
  const reducedMotion = useReducedMotion();
  return (
    <ReducedMotion.Provider value={reducedMotion}><div
      className="session-composer-rail"
      data-composer-rail=""
      data-composer-rail-placement="above"
      data-reduced-motion={!!reducedMotion}
      aria-label="会话提示与待发送消息"
    >
      {children}
    </div></ReducedMotion.Provider>
  );
}

export function ComposerRailItem({
  children,
  visible,
}: {
  children: ReactNode;
  visible: boolean;
}) {
  const reducedMotion = useContext(ReducedMotion);
  const [retained, setRetained] = useState(visible), [expanded, setExpanded] = useState(visible);
  useLayoutEffect(() => {
    let frame: number | undefined, timer: ReturnType<typeof setTimeout> | undefined;
    if (visible) {
      setRetained(true);
      if (reducedMotion) setExpanded(true);
      else if (!expanded) frame = requestAnimationFrame(() => setExpanded(true));
    } else if (retained) {
      setExpanded(false);
      if (reducedMotion) setRetained(false);
      else timer = setTimeout(() => setRetained(false), 150);
    }
    return () => { if (frame !== undefined) cancelAnimationFrame(frame); if (timer !== undefined) clearTimeout(timer); };
  }, [visible, reducedMotion]);
  if (!visible && !retained) return null;
  const shown = visible && expanded;
  const transition = `${reducedMotion ? 0 : 150}ms cubic-bezier(0.23, 1, 0.32, 1)`;
  return (
    <div
      className="session-composer-rail-item"
      data-composer-rail-item={visible ? "present" : "exiting"}
      data-composer-rail-placement="above"
      data-composer-rail-contained=""
      data-composer-rail-framed=""
      aria-hidden={!visible || undefined}
      inert={!visible || undefined}
      style={{ gridTemplateRows: shown ? "1fr" : "0fr", borderTopWidth: shown ? 1 : 0, transition: `grid-template-rows ${transition}, border-top-width ${transition}` }}
    >
      <div
        className="session-composer-rail-item-body"
        style={{ opacity: shown ? 1 : 0, transition: `opacity ${transition}` }}
      >
        <RailPresence.Provider value={visible}>
          <div className="session-composer-rail-item-content">{children}</div>
        </RailPresence.Provider>
      </div>
    </div>
  );
}
