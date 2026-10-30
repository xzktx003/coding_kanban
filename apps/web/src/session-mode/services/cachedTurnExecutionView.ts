import type { ServerNotification } from "../bindings";

// Display certainty only. No native event flags or persisted authority: disk
// cache writes keep their original protocol schema, and weak keys retain no
// transcript after its display lifetime ends.
const hotData = import.meta.hot?.data;
const unverified: WeakSet<ServerNotification> =
  hotData?.cachedTurnExecutionUnverified ??
  new WeakSet<ServerNotification>();
if (hotData) hotData.cachedTurnExecutionUnverified = unverified;
export const markCachedTurnExecutionUnverified = (
  event: ServerNotification,
) => {
  unverified.add(event);
};
export const isCachedTurnExecutionUnverified = (event: ServerNotification) =>
  unverified.has(event);
