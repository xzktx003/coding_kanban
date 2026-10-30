import { create } from "zustand";
import { composeContextText } from "@agent-orchestrator/shared/composer-context";
import type {
  FollowupSubmit,
  FollowupThread,
  FollowupStatus,
} from "@agent-orchestrator/shared";
import type { ServerNotification } from "../bindings";
export const uncertainDeliveryReason =
  "有消息送达结果待确认，请先核对会话或队列，草稿已保留";

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
const sameImages = (a: string[], b: string[]) =>
  a.length === b.length && a.every((image, index) => image === b[index]);
const sameEcho = (a: DeliveryEcho, b: DeliveryEcho) =>
  a.id === b.id &&
  a.threadId === b.threadId &&
  a.text === b.text &&
  a.status === b.status &&
  a.turnId === b.turnId &&
  sameImages(a.images, b.images);
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
    let entries = s.entries;
    let changed = false;
    for (const message of receipt.items) {
      const logicalId = message.nativeClientUserMessageId ?? message.id;
      const id = key(threadId, logicalId);
      // Official queue acceptance does not prove execution. Once a pending
      // entry leaves that queue, native events/history own its visible message;
      // metadata receipts must not manufacture an empty or cancelled echo.
      if (message.receiptOnly || (message.authority === "native" && message.nativeQueuedSubmissionId)) {
        if (entries[id]) {
          if (!changed) entries = { ...entries };
          delete entries[id];
          changed = true;
        }
        continue;
      }
      // Accepted delivery wins over a delayed negative queue snapshot. Model
      // failure belongs to the real turn and must never retract its user input.
      if (
        (message.status === "failed" || message.status === "cancelled") &&
        (entries[id]?.status === "sent" || entries[id]?.turnId)
      )
        continue;
      if (message.status === "failed" && !message.turnId) {
        if (entries[id]) {
          if (!changed) entries = { ...entries };
          delete entries[id];
          changed = true;
        }
        continue;
      }
      if (message.status === "cancelled") {
        if (entries[id]) {
          entries = { ...entries };
          delete entries[id];
          changed = true;
        }
        continue;
      }
      // Follow pending messages restored from the durable queue, but never
      // resurrect its sent archive as new transcript content.
      if (
        !entries[id] &&
        message.authority === "native"
      ) continue;
      if (
        !entries[id] &&
        message.status !== "queued" &&
        message.status !== "sending"
      )
        continue;
      const next = {
        id: logicalId,
        threadId,
        text: composeContextText(message.text, message.contexts),
        images: [...message.images],
        status:
          message.status === "failed" && message.turnId
            ? ("sent" as const)
            : message.status,
        turnId: message.turnId,
      };
      if (entries[id] && sameEcho(entries[id], next)) continue;
      if (!changed) entries = { ...entries };
      entries[id] = next;
      changed = true;
    }
    return changed ? { entries } : s;
  });
}
export function failDeliveryEcho(
  threadId: string,
  id: string,
  rejected = false,
) {
  useCodexDeliveryStore.setState((s) => {
    const entry = s.entries[key(threadId, id)];
    if (!entry || entry.status === "sent" || entry.turnId) return s;
    if (rejected) {
      const entries = { ...s.entries };
      delete entries[key(threadId, id)];
      return { entries };
    }
    if (entry.status !== "submitting") return s;
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
