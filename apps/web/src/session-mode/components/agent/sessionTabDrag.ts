import {
  agentCardKey,
  useAgentCenterStore,
} from "@session/stores/useAgentCenterStore";
import {
  useSessionSplitStore,
  type SplitEdge,
} from "@session/stores/useSessionSplitStore";

// Keep native drag state out of a React refresh boundary. Pointer drags do not
// depend on this state; native drop also reads the explicit dataTransfer key.
export const sessionTabDrag: { key: string | null } = { key: null };
export const SESSION_TAB_MIME = "application/x-session-tab";
export function sessionDragKey(transfer: Pick<DataTransfer, "getData">) {
  return transfer.getData(SESSION_TAB_MIME) || sessionTabDrag.key;
}

export function sessionDragCard(key: string) {
  const state = useAgentCenterStore.getState();
  return (
    state.cards.find((card) => agentCardKey(card) === key) ??
    (state.detachedCard && agentCardKey(state.detachedCard) === key
      ? state.detachedCard
      : undefined)
  );
}

export function splitEdgeAt(
  bounds: Pick<DOMRect, "x" | "y" | "width" | "height">,
  x: number,
  y: number,
): SplitEdge {
  const horizontal = (x - bounds.x) / bounds.width;
  const vertical = (y - bounds.y) / bounds.height;
  return horizontal < 0.22
    ? "left"
    : horizontal > 0.78
      ? "right"
      : vertical < 0.22
        ? "top"
        : vertical > 0.78
          ? "bottom"
          : "center";
}

export type SessionDropTarget = {
  groupId: string;
  edge: SplitEdge;
  beforeKey?: string;
  tab?: HTMLElement;
};

/** A small border tolerance also covers the one-pixel group/resize borders. */
export function sessionDropTarget(
  root: HTMLElement,
  x: number,
  y: number,
): SessionDropTarget | null {
  const hit = document.elementFromPoint(x, y);
  const tab = hit?.closest<HTMLElement>("[data-session-drag-key]");
  if (tab && root.contains(tab)) {
    const groupId = tab.closest<HTMLElement>("[data-session-group]")?.dataset
      .sessionGroup;
    if (groupId)
      return {
        groupId,
        edge: "center",
        beforeKey: tab.dataset.sessionDragKey,
        tab,
      };
  }
  // Do not turn clicks or drops over tools, inputs or tab actions into a split.
  if (
    hit?.closest(
      ".session-desktop-tool-dock, .session-tab-actions, .session-tab-mobile-menu",
    )
  )
    return null;
  const bodies = Array.from(
    root.querySelectorAll<HTMLElement>("[data-session-group-body]"),
  );
  let closest: { body: HTMLElement; bounds: DOMRect; distance: number } | null =
    null;
  for (const body of bodies) {
    const bounds = body.getBoundingClientRect();
    if (!bounds.width || !bounds.height) continue;
    const dx = Math.max(bounds.left - x, 0, x - bounds.right);
    const dy = Math.max(bounds.top - y, 0, y - bounds.bottom);
    const distance = Math.hypot(dx, dy);
    if (distance <= 12 && (!closest || distance < closest.distance))
      closest = { body, bounds, distance };
  }
  if (!closest) return null;
  const groupId = closest.body.closest<HTMLElement>("[data-session-group]")
    ?.dataset.sessionGroup;
  return groupId ? { groupId, edge: splitEdgeAt(closest.bounds, x, y) } : null;
}

/** Resolve membership at release time, including a remotely unfollowed reading tab. */
export function placeSessionDrag(key: string, target: SessionDropTarget) {
  const source = sessionDragCard(key);
  if (!source || target.beforeKey === key) return undefined;
  const tabs = useAgentCenterStore.getState();
  const layout = useSessionSplitStore.getState();
  layout.reconcile(
    [...tabs.cards, ...(tabs.detachedCard ? [tabs.detachedCard] : [])].map(
      agentCardKey,
    ),
  );
  if (target.beforeKey) {
    const before = tabs.cards.find(
      (card) => agentCardKey(card) === target.beforeKey,
    );
    if (before && tabs.cards.some((card) => agentCardKey(card) === key))
      tabs.moveCard(source, before);
  }
  layout.place(key, target.groupId, target.edge, target.beforeKey);
  return source;
}
