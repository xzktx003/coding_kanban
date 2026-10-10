import { useLayoutStore } from "@session/stores/useLayoutStore";
import {
  createContext,
  createElement,
  useContext,
  useSyncExternalStore,
  type ReactNode,
} from "react";

const SessionPortalDocument = createContext<Document | null>(null);
export const useSessionPortalDocument = () => useContext(SessionPortalDocument);
export function SessionPortalDocumentProvider({
  ownerDocument,
  children,
}: {
  ownerDocument: Document;
  children: ReactNode;
}) {
  return createElement(
    SessionPortalDocument.Provider,
    { value: ownerDocument },
    children,
  );
}
export function sessionPortalContainer(
  ownerDocument?: Document,
): HTMLElement | undefined {
  const activeDocument =
    ownerDocument ?? (typeof document !== "undefined" ? document : undefined);
  return (
    activeDocument?.querySelector<HTMLElement>(".session-mode") ?? undefined
  );
}

export function isSessionModeActive(): boolean {
  const root = sessionPortalContainer();
  return Boolean(root && !root.hidden);
}

export function listenInSessionMode(
  target: Window | Document,
  type: string,
  listener: (event: KeyboardEvent) => void,
  options?: boolean | AddEventListenerOptions,
): () => void {
  const scoped = (event: Event) => {
    if (isSessionModeActive()) listener(event as KeyboardEvent);
  };
  target.addEventListener(type, scoped, options);
  return () => target.removeEventListener(type, scoped, options);
}

/** Primitives remain usable without a workbench root (standalone/tests). */
export function isSessionInteractionVisible(): boolean {
  const root = sessionPortalContainer();
  return !root || (!root.hidden && !root.closest("[inert]"));
}

const visibilityListeners = new Set<() => void>();
let visibilityObserver: MutationObserver | null = null;
const notifyVisibility = () =>
  visibilityListeners.forEach((listener) => listener());

function subscribeSessionVisibility(listener: () => void): () => void {
  visibilityListeners.add(listener);
  if (visibilityListeners.size === 1) {
    window.addEventListener("workbench-mode-changed", notifyVisibility);
    const root = sessionPortalContainer();
    if (root) {
      visibilityObserver = new MutationObserver(notifyVisibility);
      visibilityObserver.observe(root, {
        attributes: true,
        attributeFilter: ["hidden", "inert"],
      });
    }
  }
  return () => {
    visibilityListeners.delete(listener);
    if (!visibilityListeners.size) {
      window.removeEventListener("workbench-mode-changed", notifyVisibility);
      visibilityObserver?.disconnect();
      visibilityObserver = null;
    }
  };
}

export function useSessionInteractionVisible(): boolean {
  return useSyncExternalStore(
    subscribeSessionVisibility,
    isSessionInteractionVisible,
    () => true,
  );
}

/** Agent-local menus and shortcuts pause while a secondary page is showing. */
export function isAgentInteractionVisible(): boolean {
  const root = sessionPortalContainer();
  return (
    !root ||
    (isSessionInteractionVisible() &&
      useLayoutStore.getState().view === "agent")
  );
}

function subscribeAgentVisibility(listener: () => void): () => void {
  const stopRoot = subscribeSessionVisibility(listener);
  const stopView = useLayoutStore.subscribe((state, previous) => {
    if (state.view !== previous.view) listener();
  });
  return () => {
    stopRoot();
    stopView();
  };
}

export function useAgentInteractionVisible(): boolean {
  return useSyncExternalStore(
    subscribeAgentVisibility,
    isAgentInteractionVisible,
    () => true,
  );
}
