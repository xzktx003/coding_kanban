import {
  createContext,
  useContext,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import "./composer-rail.css";

const RailPresence = createContext(true);
const ReducedMotion = createContext(false);
// Portals do not inherit DOM inert. Consumers with sheets/menus must also close
// those surfaces while their retained rail item is exiting.
export const useComposerRailPresent = () => useContext(RailPresence);

function useReducedMotion() {
  const query = useMemo(
    () => window.matchMedia("(prefers-reduced-motion: reduce)"),
    [],
  );
  return useSyncExternalStore(
    (listener) => {
      query.addEventListener("change", listener);
      return () => query.removeEventListener("change", listener);
    },
    () => query.matches,
    () => false,
  );
}

// Only collapsed owners need an entry. Keep this page-local and bounded; the
// composer is remounted on a session switch and its drafts live elsewhere.
const collapsedOwners = new Set<string>();
const MAX_COLLAPSED_OWNERS = 100;

export function ComposerRail({
  children,
  owner,
  status,
  collapsedSummary,
}: {
  children: ReactNode;
  owner?: string;
  status?: ReactNode;
  collapsedSummary?: string;
}) {
  const reducedMotion = useReducedMotion();
  const contentsId = useId();
  const railRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(
    () => !!owner && collapsedOwners.has(owner),
  );
  const [hasItems, setHasItems] = useState(false);
  useLayoutEffect(() => {
    const content = railRef.current?.querySelector(
      ".session-composer-rail-content",
    );
    if (!content) return;
    // On remount an empty projection may mean that the owner's notices have
    // not been restored yet. Only an observed present-to-empty transition
    // proves that this mounted rail's notices have all disappeared.
    let observedPresent = false;
    const update = () => {
      const present = !!content.querySelector(
        '[data-composer-rail-item="present"]',
      );
      setHasItems(present);
      if (present) observedPresent = true;
      else if (observedPresent) {
        if (owner) collapsedOwners.delete(owner);
        setCollapsed(false);
      }
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(content, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["data-composer-rail-item"],
    });
    return () => observer.disconnect();
  }, [owner]);
  function toggle() {
    const next = !collapsed;
    if (owner) {
      collapsedOwners.delete(owner);
      if (next) collapsedOwners.add(owner);
      if (collapsedOwners.size > MAX_COLLAPSED_OWNERS)
        collapsedOwners.delete(collapsedOwners.values().next().value!);
    }
    setCollapsed(next);
  }
  return (
    <ReducedMotion.Provider value={reducedMotion}>
      <div
        className="session-composer-rail"
        ref={railRef}
        data-composer-rail=""
        data-composer-rail-placement="above"
        data-reduced-motion={!!reducedMotion}
        aria-label="会话提示与待发送消息"
      >
        <div className="session-composer-rail-header">
          {status}
          {hasItems && (
            <button
              type="button"
              className="session-composer-rail-toggle"
              aria-label={collapsed ? "展开提示" : "收起提示"}
              title={collapsed ? "展开提示" : "收起提示"}
              aria-expanded={!collapsed}
              aria-controls={contentsId}
              onClick={toggle}
            >
              {collapsed ? (
                <ChevronUp aria-hidden="true" />
              ) : (
                <ChevronDown aria-hidden="true" />
              )}
              {collapsed && <span>展开</span>}
            </button>
          )}
        </div>
        {collapsed && collapsedSummary && (
          <span className="session-composer-rail-summary" role="status">
            {collapsedSummary}
          </span>
        )}
        <div
          id={contentsId}
          className="session-composer-rail-content"
          hidden={collapsed}
          aria-hidden={collapsed || undefined}
          inert={collapsed || undefined}
        >
          <RailPresence.Provider value={!collapsed}>
            {children}
          </RailPresence.Provider>
        </div>
      </div>
    </ReducedMotion.Provider>
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
  const railPresent = useContext(RailPresence);
  const [retained, setRetained] = useState(visible),
    [expanded, setExpanded] = useState(visible);
  useLayoutEffect(() => {
    let frame: number | undefined,
      timer: ReturnType<typeof setTimeout> | undefined;
    if (visible) {
      setRetained(true);
      if (reducedMotion) setExpanded(true);
      else if (!expanded)
        frame = requestAnimationFrame(() => setExpanded(true));
    } else if (retained) {
      setExpanded(false);
      if (reducedMotion) setRetained(false);
      else timer = setTimeout(() => setRetained(false), 150);
    }
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      if (timer !== undefined) clearTimeout(timer);
    };
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
      style={{
        gridTemplateRows: shown ? "1fr" : "0fr",
        borderTopWidth: shown ? 1 : 0,
        transition: `grid-template-rows ${transition}, border-top-width ${transition}`,
      }}
    >
      <div
        className="session-composer-rail-item-body"
        style={{ opacity: shown ? 1 : 0, transition: `opacity ${transition}` }}
      >
        <RailPresence.Provider value={visible && railPresent}>
          <div className="session-composer-rail-item-content">{children}</div>
        </RailPresence.Provider>
      </div>
    </div>
  );
}
