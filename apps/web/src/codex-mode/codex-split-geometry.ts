import {
  codexSplitGroups,
  type CodexSplitEdge,
  type CodexSplitNode,
} from "./codex-multiwindow-state";
import type { NativeSurfaceFrame } from "./native-surface";

export type CodexPaneBox = {
  groupId: string;
  windowId: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
};

const GAP = 12;

/** Measure every visible pane. Hidden tabs stay out of the native frame list. */
export function codexPaneBoxes(
  node: CodexSplitNode,
  bounds: { width: number; height: number },
  mobileGroupId?: string,
): CodexPaneBox[] {
  const groups = codexSplitGroups(node);
  const visible = mobileGroupId ? groups.filter((group) => group.id === mobileGroupId) : groups;
  const root = mobileGroupId ? visible[0] ?? node : node;
  return layoutNode(root, { x: 0, y: 0, width: Math.max(1, bounds.width), height: Math.max(1, bounds.height) });
}

function layoutNode(
  node: CodexSplitNode,
  bounds: { x: number; y: number; width: number; height: number },
): CodexPaneBox[] {
  if (node.type === "group") {
    return [{
      groupId: node.id,
      windowId: node.selected,
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
    }];
  }
  const horizontal = node.direction === "horizontal";
  const span = horizontal ? bounds.width : bounds.height;
  const firstSpan = Math.max(1, Math.round(((span - GAP) * node.ratio) / 100));
  const secondSpan = Math.max(1, span - GAP - firstSpan);
  const first = horizontal
    ? { ...bounds, width: firstSpan }
    : { ...bounds, height: firstSpan };
  const second = horizontal
    ? { ...bounds, x: bounds.x + firstSpan + GAP, width: secondSpan }
    : { ...bounds, y: bounds.y + firstSpan + GAP, height: secondSpan };
  return [...layoutNode(node.first, first), ...layoutNode(node.second, second)];
}

export function codexNativeFrames(boxes: readonly CodexPaneBox[]): NativeSurfaceFrame[] {
  return boxes.flatMap((box) => box.windowId ? [{
    id: box.windowId,
    x: box.x,
    y: box.y + 44,
    width: box.width,
    height: Math.max(1, box.height - 44),
  }] : []);
}

export function codexSplitEdgeAt(
  bounds: Pick<DOMRect, "x" | "y" | "width" | "height">,
  x: number,
  y: number,
): CodexSplitEdge {
  const horizontal = (x - bounds.x) / bounds.width;
  const vertical = (y - bounds.y) / bounds.height;
  return horizontal < 0.22 ? "left"
    : horizontal > 0.78 ? "right"
      : vertical < 0.22 ? "top"
        : vertical > 0.78 ? "bottom"
          : "center";
}

export type CodexDropTarget = {
  groupId: string;
  edge: CodexSplitEdge;
  beforeKey?: string;
};

/** Resolve the final drop from the pointer, including a 12px pane-border tolerance. */
export function codexDropTarget(root: HTMLElement, x: number, y: number): CodexDropTarget | null {
  const hit = document.elementFromPoint(x, y);
  if (hit?.closest(".codex-window-tab-close, .codex-new-chat, .codex-group-menu")) return null;
  const strip = hit?.closest<HTMLElement>("[data-codex-tab-strip]");
  if (strip && root.contains(strip)) {
    const groupId = strip.closest<HTMLElement>("[data-codex-group]")?.dataset.codexGroup;
    if (!groupId) return null;
    const tabs = Array.from(strip.querySelectorAll<HTMLElement>("[data-codex-window]"))
      .map((tab) => ({ tab, bounds: tab.getBoundingClientRect() }))
      .filter((entry) => entry.bounds.width > 0);
    const before = tabs.find((entry) => x < entry.bounds.left + entry.bounds.width / 2);
    return { groupId, edge: "center", beforeKey: before?.tab.dataset.codexWindow };
  }
  const bodies = Array.from(root.querySelectorAll<HTMLElement>("[data-codex-group-body]"));
  let closest: { body: HTMLElement; bounds: DOMRect; distance: number } | null = null;
  for (const body of bodies) {
    const bounds = body.getBoundingClientRect();
    if (!bounds.width || !bounds.height) continue;
    const dx = Math.max(bounds.left - x, 0, x - bounds.right);
    const dy = Math.max(bounds.top - y, 0, y - bounds.bottom);
    const distance = Math.hypot(dx, dy);
    if (distance <= 12 && (!closest || distance < closest.distance)) closest = { body, bounds, distance };
  }
  const groupId = closest?.body.closest<HTMLElement>("[data-codex-group]")?.dataset.codexGroup;
  return closest && groupId ? { groupId, edge: codexSplitEdgeAt(closest.bounds, x, y) } : null;
}
