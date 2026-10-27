import { createContext, useContext, type ReactNode } from "react";
import {
  AnimatePresence,
  motion,
  useIsPresent,
  useReducedMotion,
} from "framer-motion";
import "./composer-rail.css";

const RailPresence = createContext(true);
// Portals do not inherit DOM inert. Consumers with sheets/menus must also close
// those surfaces while their retained rail item is exiting.
export const useComposerRailPresent = () => useContext(RailPresence);

export function ComposerRail({ children }: { children: ReactNode }) {
  const reducedMotion = useReducedMotion();
  return (
    <div
      className="session-composer-rail"
      data-composer-rail=""
      data-composer-rail-placement="above"
      data-reduced-motion={!!reducedMotion}
      aria-label="会话提示与待发送消息"
    >
      {children}
    </div>
  );
}

export function ComposerRailItem({
  children,
  visible,
}: {
  children: ReactNode;
  visible: boolean;
}) {
  return (
    <AnimatePresence initial={false} propagate>
      {visible && <RailItem>{children}</RailItem>}
    </AnimatePresence>
  );
}

function RailItem({ children }: { children: ReactNode }) {
  const present = useIsPresent();
  const reducedMotion = useReducedMotion();
  const transition = {
    duration: reducedMotion ? 0 : 0.15,
    ease: [0.23, 1, 0.32, 1] as const,
  };
  return (
    <motion.div
      className="session-composer-rail-item"
      data-composer-rail-item={present ? "present" : "exiting"}
      data-composer-rail-placement="above"
      data-composer-rail-contained=""
      data-composer-rail-framed=""
      aria-hidden={!present || undefined}
      inert={!present || undefined}
      initial={
        reducedMotion ? false : { gridTemplateRows: "0fr", borderTopWidth: 0 }
      }
      animate={{ gridTemplateRows: "1fr", borderTopWidth: 1 }}
      exit={{ gridTemplateRows: "0fr", borderTopWidth: 0 }}
      transition={transition}
    >
      <motion.div
        className="session-composer-rail-item-body"
        initial={reducedMotion ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={transition}
      >
        <RailPresence.Provider value={present}>
          <div className="session-composer-rail-item-content">{children}</div>
        </RailPresence.Provider>
      </motion.div>
    </motion.div>
  );
}
