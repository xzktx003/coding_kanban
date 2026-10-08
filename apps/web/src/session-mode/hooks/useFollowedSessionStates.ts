import { codexRuntimeState } from "@session/utils/codexRuntimeState";
import { useShallow } from "zustand/react/shallow";
import { collectQuestions, latestQuestionTurn } from "../features/async-questions/model";
import { EMPTY_SESSION, pendingQuestions, useAsyncQuestionStore, withConfirmed } from "../features/async-questions/store";
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
  questions?: number;
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
      events: s.events,
      currentThreadId: s.currentThreadId,
      currentTurnId: s.currentTurnId,
    })),
  );
  const cc = useCCStore(
    useShallow((s) => ({
      loading: s.sessionLoadingMap,
      messages: s.sessionMessagesMap,
    })),
  );
  const receipts = useSessionAttentionStore((s) => s.receipts);
  const questionSessions = useAsyncQuestionStore(s => s.sessions);
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
        const runtime = codexRuntimeState({ ...codex, threadStatusMap: codex.statuses, turnTimingMap: codex.timing }, card.id);
        if (runtime.failed) state = "failed";
        else if (runtime.pending || (!runtime.finished && pendingIds.has(card.id))) state = "pending";
        else if (runtime.running) state = "running";
        else if (unread) state = "unread";
        else if (finished) state = "completed";
        else if (runtime.known) state = "idle";
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
    const session = questionSessions[card.id] ?? EMPTY_SESSION;
    const latestTurnId = latestQuestionTurn(codex.events[card.id] ?? [], card.id,
      codex.timing[card.id]?.turnId ?? (codex.currentThreadId === card.id ? codex.currentTurnId : null) ??
      codex.threads.find(t => t.id === card.id)?.turns?.at(-1)?.id);
    const questionCount = connection === "ready" && card.kind === "codex"
      ? pendingQuestions(withConfirmed(collectQuestions(codex.events[card.id] ?? [], card.id), session), session, latestTurnId).length : 0;
    return { card, state, questions: questionCount };
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
    questionCount: rows.reduce((sum, row) => sum + (row.questions ?? 0), 0),
    complete:
      connection === "ready" && sharedTabsInitialized && counts.unknown === 0,
  };
}
