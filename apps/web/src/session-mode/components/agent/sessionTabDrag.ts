import {
  agentCardKey,
  useAgentCenterStore,
} from "@session/stores/useAgentCenterStore";
import {
  useSessionSplitStore,
  splitGroups,
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
  strip?: HTMLElement;
  insertion?: {
    x: number;
    y: number;
    height: number;
    side: "before" | "after" | "append";
  };
};

/** Header geometry defines one insertion point, even in gaps and empty groups. */
export function sessionHeaderDropTarget(
  strip: HTMLElement,
  x: number,
): SessionDropTarget | null {
  const groupId = strip.closest<HTMLElement>("[data-session-group]")?.dataset
    .sessionGroup;
  if (!groupId) return null;
  const bounds = strip.getBoundingClientRect();
  const tabs = Array.from(
    strip.querySelectorAll<HTMLElement>("[data-session-drag-key]"),
  )
    .map((tab) => ({ tab, bounds: tab.getBoundingClientRect() }))
    .filter((entry) => entry.bounds.width > 0);
  const index = tabs.findIndex(
    (entry) => x < entry.bounds.left + entry.bounds.width / 2,
  );
  const before = index >= 0 ? tabs[index] : undefined;
  const anchor = before ?? tabs.at(-1);
  const insertionX = before
    ? before.bounds.left
    : (anchor?.bounds.right ?? bounds.left + 8);
  const hovered = tabs.find(
    (entry) => x >= entry.bounds.left && x <= entry.bounds.right,
  );
  const side = hovered
    ? x < hovered.bounds.left + hovered.bounds.width / 2
      ? "before"
      : "after"
    : before
      ? "before"
      : "append";
  return {
    groupId,
    edge: "center",
    beforeKey: before?.tab.dataset.sessionDragKey,
    tab: anchor?.tab,
    strip,
    insertion: {
      x: Math.max(bounds.left + 2, Math.min(bounds.right - 2, insertionX)),
      y: bounds.top + 4,
      height: Math.max(0, bounds.height - 8),
      side,
    },
  };
}

/** A small border tolerance also covers the one-pixel group/resize borders. */
export function sessionDropTarget(
  root: HTMLElement,
  x: number,
  y: number,
): SessionDropTarget | null {
  const hit = document.elementFromPoint(x, y);
  // Do not turn clicks or drops over tools, inputs or tab actions into a split.
  if (
    hit?.closest(
      ".session-desktop-tool-dock, .session-tab-actions, .session-tab-mobile-menu, .session-new-tab, .session-followed-trigger, .session-attention-trigger",
    )
  )
    return null;
  const header = hit?.closest<HTMLElement>(".session-tabs");
  const strip = header?.querySelector<HTMLElement>(".session-tab-strip");
  if (strip && root.contains(strip)) return sessionHeaderDropTarget(strip, x);
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
  const destination = splitGroups(useSessionSplitStore.getState().tree).find(
    (group) => group.id === target.groupId,
  );
  if (
    !destination ||
    (target.beforeKey && !destination.keys.includes(target.beforeKey))
  )
    return undefined;
  if (tabs.cards.some((card) => agentCardKey(card) === key)) {
    if (
      target.beforeKey &&
      tabs.cards.some((card) => agentCardKey(card) === target.beforeKey)
    ) {
      tabs.reorderCard(key, target.beforeKey);
    } else if (target.strip && !target.beforeKey) {
      // Append after this group's final followed card, keeping other groups' order.
      const last = destination.keys
        .filter(
          (item) =>
            item !== key &&
            tabs.cards.some((card) => agentCardKey(card) === item),
        )
        .at(-1);
      if (last) {
        const remaining = tabs.cards.filter(
          (card) => agentCardKey(card) !== key,
        );
        const index = remaining.findIndex(
          (card) => agentCardKey(card) === last,
        );
        tabs.reorderCard(
          key,
          remaining[index + 1] ? agentCardKey(remaining[index + 1]) : null,
        );
      }
    }
  }
  layout.place(key, target.groupId, target.edge, target.beforeKey);
  return source;
}
