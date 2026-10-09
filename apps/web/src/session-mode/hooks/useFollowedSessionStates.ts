import { pendingIdentity } from "@session/features/subagents/pending";
import { childState, descendants } from "@session/features/subagents/model";
import { useSubagentStore } from "@session/features/subagents/store";
import { codexRuntimeState } from "@session/utils/codexRuntimeState";
import type { ServerNotification } from "@session/bindings";
import { useShallow } from "zustand/react/shallow";
import {
  collectQuestions,
  latestQuestionTurn,
} from "../features/async-questions/model";
import {
  EMPTY_SESSION,
  pendingQuestions,
  useAsyncQuestionStore,
  withConfirmed,
} from "../features/async-questions/store";
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
const EMPTY_EVENTS: readonly ServerNotification[] = [];

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
  const cc = useCCStore(
    useShallow((s) => ({
      loading: s.sessionLoadingMap,
      messages: s.sessionMessagesMap,
    })),
  );
  const receipts = useSessionAttentionStore((s) => s.receipts);
  const questionSessions = useAsyncQuestionStore((s) => s.sessions);
  const approvals = useApprovalStore((s) => s.pendingApprovals);
  const permissions = usePermissionsStore((s) => s.pendingRequests);
  const questions = useRequestUserInputStore((s) => s.pendingRequests);
  const elicitations = useElicitationStore((s) => s.pendingRequests);
  const subagents = useSubagentStore((s) => s.nodes);
  const families = useSubagentStore((s) => s.families);
  const followedCodexIds = [
    ...new Set(
      cards
        .filter((card) => card.kind === "codex")
        .flatMap((card) => [
          card.id,
          ...descendants(subagents, card.id).map((node) => node.thread.id),
        ]),
    ),
  ];
  const codexEvents = useCodexStore(
    useShallow((s) =>
      followedCodexIds.map((id) => s.events[id] ?? EMPTY_EVENTS),
    ),
  );
  const codexStatuses = useCodexStore(
    useShallow((s) => followedCodexIds.map((id) => s.threadStatusMap[id])),
  );
  const codexTiming = useCodexStore(
    useShallow((s) => followedCodexIds.map((id) => s.turnTimingMap[id])),
  );
  const codexThreads = useCodexStore(
    useShallow((s) =>
      followedCodexIds.map(
        (id) => s.threads.find((thread) => thread.id === id) ?? null,
      ),
    ),
  );
  const codexCurrent = useCodexStore(
    useShallow((s) => ({
      currentThreadId: s.currentThreadId,
      currentTurnId: s.currentTurnId,
    })),
  );
  const eventById = new Map(
    followedCodexIds.map((id, index) => [id, codexEvents[index]]),
  );
  const statusById = Object.fromEntries(
    followedCodexIds.map((id, index) => [id, codexStatuses[index]]),
  );
  const timingById = Object.fromEntries(
    followedCodexIds.map((id, index) => [id, codexTiming[index]]),
  );
  const threads = codexThreads.filter((thread) => thread !== null);
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
        const runtime = codexRuntimeState(
          {
            ...codexCurrent,
            threads,
            threadStatusMap: statusById,
            turnTimingMap: timingById,
          },
          card.id,
        );
        const children = descendants(subagents, card.id);
        const familyPending = children.some((n) => pendingIds.has(n.thread.id));
        const familyRunning = children.some(
          (n) =>
            childState(
              {
                ...n,
                thread: {
                  ...n.thread,
                  status: statusById[n.thread.id] ?? n.thread.status,
                },
              },
              timingById[n.thread.id],
              0,
            ) === "running",
        );
        const familyUnknown =
          children.some((n) => n.unavailable) ||
          (children.length > 0 && families[card.id]?.complete === false);
        if (familyPending) state = "pending";
        else if (runtime.failed) state = "failed";
        else if (
          runtime.pending ||
          (!runtime.finished && pendingIds.has(card.id))
        )
          state = "pending";
        else if (runtime.running || familyRunning) state = "running";
        else if (familyUnknown) state = "unknown";
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
    const latestTurnId = latestQuestionTurn(
      eventById.get(card.id) ?? EMPTY_EVENTS,
      card.id,
      timingById[card.id]?.turnId ??
        (codexCurrent.currentThreadId === card.id
          ? codexCurrent.currentTurnId
          : null) ??
        threads.find((t) => t.id === card.id)?.turns?.at(-1)?.id,
    );
    const familyIds = new Set([
      card.id,
      ...descendants(subagents, card.id).map((n) => n.thread.id),
    ]);
    const nativeQuestions = [
      ...new Map(
        questions
          .filter((r) => familyIds.has(r.threadId))
          .map((r) => [pendingIdentity(r), r]),
      ).values(),
    ].reduce((count, r) => count + r.questions.length, 0);
    const questionCount =
      connection === "ready" && card.kind === "codex"
        ? pendingQuestions(
            withConfirmed(
              collectQuestions(eventById.get(card.id) ?? EMPTY_EVENTS, card.id),
              session,
            ),
            session,
            latestTurnId,
          ).length + nativeQuestions
        : 0;
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
      connection === "ready" &&
      sharedTabsInitialized &&
      counts.unknown === 0 &&
      cards.every(
        (card) =>
          card.kind !== "codex" || families[card.id]?.complete !== false,
      ),
  };
}
