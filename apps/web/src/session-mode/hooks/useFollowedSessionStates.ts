import { useShallow } from "zustand/react/shallow";
import {
  useAgentCenterStore,
  type AgentCenterCard,
} from "../stores/useAgentCenterStore";
import {
  useCodexStore,
  useApprovalStore,
  usePermissionsStore,
  useRequestUserInputStore,
  useElicitationStore,
} from "../components/codex/stores";
import { useCCStore } from "../stores/cc";
import {
  latestUnread,
  sessionKey,
  useSessionAttentionStore,
} from "../stores/useSessionAttentionStore";
import type { SessionState } from "../components/common/SessionStatus";
export type FollowedSessionState = SessionState | "unknown";
export type SessionConnectionState = "checking" | "ready" | "offline";
export type FollowedSessionRow = {
  card: AgentCenterCard;
  state: FollowedSessionState;
};
export const SESSION_STATE_LABELS: Record<FollowedSessionState, string> = {
  pending: "待确认",
  running: "运行中",
  failed: "失败",
  unread: "新回复",
  completed: "已完成",
  idle: "空闲",
  unknown: "状态待同步",
};

/** Read existing state only: following/navigation must never create an Agent. */
export function useFollowedSessionStates(
  connection: SessionConnectionState = "ready",
) {
  const { cards, sharedTabsInitialized } = useAgentCenterStore(
    useShallow((s) => ({
      cards: s.cards,
      sharedTabsInitialized: s.sharedTabsInitialized,
    })),
  );
  const codex = useCodexStore(
    useShallow((s) => ({
      statuses: s.threadStatusMap,
      threads: s.threads,
      timing: s.turnTimingMap,
    })),
  );
  const cc = useCCStore(
    useShallow((s) => ({
      loading: s.sessionLoadingMap,
      messages: s.sessionMessagesMap,
    })),
  );
  const receipts = useSessionAttentionStore((s) => s.receipts);
  const approvals = useApprovalStore((s) => s.pendingApprovals);
  const permissions = usePermissionsStore((s) => s.pendingRequests);
  const questions = useRequestUserInputStore((s) => s.pendingRequests);
  const elicitations = useElicitationStore((s) => s.pendingRequests);
  const pendingIds = new Set(
    [...approvals, ...permissions, ...questions, ...elicitations].map(
      (r) => r.threadId,
    ),
  );
  const rows: FollowedSessionRow[] = cards.map((card) => {
    let state: FollowedSessionState = "unknown";
    if (connection === "ready") {
      const receipt = receipts[sessionKey(card.kind, card.id)];
      const unread = Boolean(latestUnread(receipt));
      const finished = Boolean(receipt?.completed.length);
      if (card.kind === "codex") {
        const status =
          codex.statuses[card.id] ??
          codex.threads.find((t) => t.id === card.id)?.status;
        if (
          pendingIds.has(card.id) ||
          (status?.type === "active" && status.activeFlags.length > 0)
        )
          state = "pending";
        else if (status?.type === "active") state = "running";
        else if (codex.timing[card.id]?.status === "failed") state = "failed";
        else if (unread) state = "unread";
        else if (finished) state = "completed";
        else if (status) state = "idle";
      } else {
        const messages = cc.messages[card.id];
        if (
          messages?.some((m) => m.type === "permission_request" && !m.resolved)
        )
          state = "pending";
        else if (cc.loading[card.id]) state = "running";
        else if (
          messages?.at(-1)?.type === "result" &&
          (messages.at(-1) as { is_error?: boolean }).is_error
        )
          state = "failed";
        else if (unread) state = "unread";
        else if (finished) state = "completed";
        else if (messages || Object.hasOwn(cc.loading, card.id)) state = "idle";
      }
    }
    return { card, state };
  });
  const counts: Record<FollowedSessionState, number> = {
    pending: 0,
    running: 0,
    failed: 0,
    unread: 0,
    completed: 0,
    idle: 0,
    unknown: 0,
  };
  for (const row of rows) counts[row.state]++;
  return {
    rows,
    counts,
    complete:
      connection === "ready" && sharedTabsInitialized && counts.unknown === 0,
  };
}
