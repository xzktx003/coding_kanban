import { useEffect, useState } from "react";

import type { AgentTaskSummaryResponse } from "@agent-orchestrator/shared";

import { getAgentTaskSummary } from "../lib/api";

interface AgentGridTaskSummaryProps {
  agentSessionId: string;
  agentKind: string;
  supportsStructuredSummary?: boolean;
  initialAgentSummary?: string;
  initialUserSummary?: string;
  refreshKey: string;
}

const EMPTY_SUMMARY: AgentTaskSummaryResponse = {
  available: false,
  updatedAt: null,
};

export function AgentGridTaskSummary({
  agentSessionId,
  agentKind,
  supportsStructuredSummary = agentKind === "codex",
  initialAgentSummary,
  initialUserSummary,
  refreshKey,
}: AgentGridTaskSummaryProps) {
  const [summary, setSummary] = useState<AgentTaskSummaryResponse>(() => ({
    available: Boolean(initialUserSummary || initialAgentSummary),
    lastUserMessageSummary: initialUserSummary,
    lastAgentMessageSummary: initialAgentSummary,
    updatedAt: null,
  }));

  useEffect(() => {
    if (!supportsStructuredSummary) {
      setSummary(EMPTY_SUMMARY);
      return;
    }

    let cancelled = false;
    void getAgentTaskSummary(agentSessionId)
      .then((nextSummary) => {
        if (!cancelled) setSummary(nextSummary);
      })
      .catch(() => {
        if (!cancelled) setSummary(EMPTY_SUMMARY);
      });

    return () => {
      cancelled = true;
    };
  }, [agentSessionId, refreshKey, supportsStructuredSummary]);

  if (
    !summary.available ||
    (!summary.lastUserMessageSummary && !summary.lastAgentMessageSummary)
  ) {
    return null;
  }

  return (
    <div className="grid-card-task-summary">
      {summary.lastUserMessageSummary && (
        <div className="grid-card-task-summary-row">
          <span>任务</span>
          <p>{summary.lastUserMessageSummary}</p>
        </div>
      )}
      {summary.lastAgentMessageSummary && (
        <div className="grid-card-task-summary-row grid-card-task-summary-row--agent">
          <span>回复</span>
          <p>{summary.lastAgentMessageSummary}</p>
        </div>
      )}
    </div>
  );
}
