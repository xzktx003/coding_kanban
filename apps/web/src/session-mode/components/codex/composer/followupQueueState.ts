import type { useFollowups } from "@session/hooks/useFollowups";

export function hasVisibleFollowupQueue(threadId: string | null, snapshot: ReturnType<typeof useFollowups>) {
  return !!threadId && (snapshot.state.items.some(message => message.status !== "sent" && message.status !== "cancelled") || !!snapshot.state.paused || !!snapshot.error);
}
