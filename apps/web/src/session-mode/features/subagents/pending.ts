import { descendants, type SubagentNode } from "./model";
export type PendingIdentity = {
  threadId: string;
  requestId: string | number;
  turnId?: string | null;
  itemId?: string | null;
  requestToken?: string;
};
export const pendingIdentity = (r: PendingIdentity) =>
  JSON.stringify([r.threadId, r.requestId, r.turnId, r.itemId, r.requestToken]);
/** Parent IDs group UI notifications only; replies retain the original RPC identity. */
export function pendingFamilies(
  nodes: Record<string, SubagentNode>,
  roots: string[],
  requests: PendingIdentity[],
) {
  return roots
    .map((root) => {
      const ids = new Set(descendants(nodes, root).map((n) => n.thread.id));
      return {
        root,
        requests: [
          ...new Map(
            requests
              .filter((r) => ids.has(r.threadId))
              .map((r) => [pendingIdentity(r), r]),
          ).values(),
        ],
      };
    })
    .filter((group) => group.requests.length);
}
