import { create } from "zustand";
import { composeContextText } from "@agent-orchestrator/shared";
import type {
  FollowupSubmit,
  FollowupThread,
  FollowupStatus,
} from "@agent-orchestrator/shared";
import type { ServerNotification } from "../bindings";

export type DeliveryEcho = Pick<
  FollowupSubmit,
  "id" | "threadId" | "text" | "images"
> & {
  status: FollowupStatus | "submitting";
  turnId?: string;
};
// Display-only receipts. The existing server queue owns dispatch and persistence.
// Do not reconstruct old sent receipts on reload: history owns those messages,
// including messages removed by a rollback on another browser.
export const useCodexDeliveryStore = create<{
  entries: Record<string, DeliveryEcho>;
}>()(() => ({ entries: {} }));
const key = (threadId: string, id: string) => JSON.stringify([threadId, id]);
export function beginDeliveryEcho(
  message: Omit<FollowupSubmit, "id"> & { id: string },
) {
  useCodexDeliveryStore.setState((s) => ({
    entries: {
      ...s.entries,
      [key(message.threadId, message.id)]: {
        id: message.id,
        threadId: message.threadId,
        text: composeContextText(message.text, message.contexts),
        images: [...message.images],
        status: "submitting",
      },
    },
  }));
}
export function reconcileDeliveryEchoes(
  threadId: string,
  receipt: FollowupThread,
) {
  useCodexDeliveryStore.setState((s) => {
    const entries = { ...s.entries };
    for (const message of receipt.items) {
      const id = key(threadId, message.id);
      if (message.status === "cancelled") {
        delete entries[id];
        continue;
      }
      // Follow pending messages restored from the durable queue, but never
      // resurrect its sent archive as new transcript content.
      if (
        !entries[id] &&
        message.status !== "queued" &&
        message.status !== "sending"
      )
        continue;
      entries[id] = {
        id: message.id,
        threadId,
        text: composeContextText(message.text, message.contexts),
        images: [...message.images],
        status: message.status,
        turnId: message.turnId,
      };
    }
    return { entries };
  });
}
export function failDeliveryEcho(threadId: string, id: string) {
  useCodexDeliveryStore.setState((s) => {
    const entry = s.entries[key(threadId, id)];
    if (!entry || entry.status !== "submitting") return s;
    return {
      entries: {
        ...s.entries,
        [key(threadId, id)]: { ...entry, status: "uncertain" },
      },
    };
  });
}
export function acknowledgeDeliveryEchoes(threadId: string, ids: string[]) {
  useCodexDeliveryStore.setState((s) => {
    const entries = { ...s.entries };
    let changed = false;
    for (const id of ids) {
      const k = key(threadId, id);
      if (entries[k]) {
        delete entries[k];
        changed = true;
      }
    }
    return changed ? { entries } : s;
  });
}
export function clearDeliveryEchoes(threadId: string) {
  acknowledgeDeliveryEchoes(
    threadId,
    Object.values(useCodexDeliveryStore.getState().entries)
      .filter((e) => e.threadId === threadId)
      .map((e) => e.id),
  );
}
export function deliveredClientIds(events: ServerNotification[]) {
  const ids = new Set<string>();
  for (const event of events) {
    if (
      (event.method === "item/started" || event.method === "item/completed") &&
      event.params.item.type === "userMessage" &&
      event.params.item.clientId
    )
      ids.add(event.params.item.clientId);
    if (event.method === "turn/completed")
      for (const item of event.params.turn.items) {
        if (item.type === "userMessage" && item.clientId)
          ids.add(item.clientId);
      }
  }
  return ids;
}
