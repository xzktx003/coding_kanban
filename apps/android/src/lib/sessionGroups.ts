import { isLocalCodexSessionCandidate } from "@agent-orchestrator/shared";
import type { AgentSessionRecord } from "@agent-orchestrator/shared";

export type AttentionGroup = "response" | "review" | "executing" | "ready";

export type MobileAttentionGroupDefinition = {
  id: AttentionGroup;
  label: string;
  description: string;
};

export const attentionGroups: MobileAttentionGroupDefinition[] = [
  { id: "response", label: "需响应", description: "等待你的回答或确认" },
  { id: "review", label: "待验收", description: "Agent 已完成，等待查看" },
  { id: "executing", label: "执行中", description: "Agent 正在处理任务" },
  { id: "ready", label: "可继续", description: "可以继续输入或检查" },
];

export const stateLabels: Record<string, string> = {
  running: "执行中",
  idle: "可继续",
  awaiting_input: "需响应",
  detached: "已分离",
  exited: "已退出",
};

function timestampValue(value?: string): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function latestActivity(session: AgentSessionRecord): number {
  return Math.max(
    timestampValue(session.lastOutputAt),
    timestampValue(session.lastHeartbeatAt),
    timestampValue(session.lastRefreshedAt),
    timestampValue(
      isLocalCodexSessionCandidate(session)
        ? session.taskSummaryUpdatedAt
        : undefined,
    ),
  );
}

export function getAttentionGroup(
  session: AgentSessionRecord,
): AttentionGroup {
  if (session.interactionState === "awaiting_input") return "response";
  if (session.hasUnreadCompletion) return "review";
  if (session.interactionState === "running") return "executing";
  return "ready";
}

function attentionRank(session: AgentSessionRecord): number {
  return attentionGroups.findIndex(
    (group) => group.id === getAttentionGroup(session),
  );
}

export function sortSessionsByAttention(
  sessions: AgentSessionRecord[],
): AgentSessionRecord[] {
  return sessions
    .map((session, index) => ({ session, index }))
    .sort((left, right) => {
      const rankDifference =
        attentionRank(left.session) - attentionRank(right.session);
      if (rankDifference !== 0) return rankDifference;

      const activityDifference =
        latestActivity(right.session) - latestActivity(left.session);
      return activityDifference !== 0
        ? activityDifference
        : left.index - right.index;
    })
    .map(({ session }) => session);
}

export function getStateLabel(session: AgentSessionRecord): string {
  const group = getAttentionGroup(session);
  if (group === "review") return "待验收";
  const label = stateLabels[session.interactionState];
  return label ?? session.interactionState;
}
