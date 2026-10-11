export type NotificationBounds = {
  top: number;
  left: number;
  right: number;
  bottom: number;
};
type Snapshot = { bounds: NotificationBounds | null };
/** Original ZAt ordered registrations: an update keeps its prior position. */
export function createViewportBounds() {
  const boundaries = new Map<string, NotificationBounds>();
  const subscribers = new Set<() => void>();
  let snapshot: Snapshot = { bounds: null };
  const publish = () => {
    const bounds = [...boundaries.values()].at(-1) ?? null;
    const before = snapshot.bounds;
    if (
      bounds === before ||
      (bounds &&
        before &&
        bounds.top === before.top &&
        bounds.left === before.left &&
        bounds.right === before.right &&
        bounds.bottom === before.bottom)
    )
      return;
    snapshot = { bounds };
    for (const subscriber of subscribers) subscriber();
  };
  return {
    getSnapshot: () => snapshot,
    subscribe(callback: () => void) {
      subscribers.add(callback);
      return () => {
        subscribers.delete(callback);
      };
    },
    boundary(id: string, value: NotificationBounds | null) {
      if (value === null) boundaries.delete(id);
      else boundaries.set(id, value);
      publish();
    },
  };
}
export const notificationViewportBounds = createViewportBounds();
/** Same two ResizeObserver targets as native sxr/ZK; no history or polling. */
export function observeNotificationBoundary(id: string, element: HTMLElement) {
  let alive = true;
  const update = () => {
    if (!alive) return;
    const bounds = element.getBoundingClientRect();
    notificationViewportBounds.boundary(id, {
      top: bounds.top,
      left: bounds.left,
      right: window.innerWidth - bounds.right,
      bottom: window.innerHeight - bounds.bottom,
    });
  };
  const observer =
    typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
  observer?.observe(element);
  observer?.observe(document.documentElement);
  update();
  return () => {
    alive = false;
    observer?.disconnect();
    notificationViewportBounds.boundary(id, null);
  };
}
