import { useEffect, useState } from "react";

import type { AgentGitSummary, AgentSessionRecord } from "@agent-orchestrator/shared";

import { getAgentGitSummary } from "../lib/api";

interface AgentGridGitSummaryProps {
  session: AgentSessionRecord;
}

function initialSummary(session: AgentSessionRecord): AgentGitSummary | null {
  if (!session.projectName) return null;
  return {
    available: true,
    projectName: session.projectName,
    repositoryRoot: session.repositoryRoot,
    branch: session.gitBranch,
    isGitRepository: Boolean(session.gitBranch),
    isWorktree: session.gitIsWorktree,
    changedFiles: session.gitChangedFiles,
    addedLines: session.gitAddedLines,
    deletedLines: session.gitDeletedLines,
    updatedAt: session.gitSummaryUpdatedAt ?? null,
  };
}

export function AgentGridGitSummary({ session }: AgentGridGitSummaryProps) {
  const [summary, setSummary] = useState<AgentGitSummary | null>(() =>
    initialSummary(session),
  );

  useEffect(() => {
    let cancelled = false;
    void getAgentGitSummary(session.id)
      .then((nextSummary) => {
        if (!cancelled) setSummary(nextSummary);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [session.id, session.lastOutputAt, session.workingDirectory]);

  if (!summary?.projectName && !summary?.unavailableReason) return null;

  const branchLabel = summary.branch
    ? `${summary.branch}${summary.isWorktree ? " · worktree" : ""}`
    : summary.head
      ? `detached@${summary.head}`
      : null;

  return (
    <div className="grid-card-git-summary">
      <span className="grid-card-git-project" title={summary.repositoryRoot}>
        📁 {summary.projectName}
      </span>
      {summary.isGitRepository ? (
        <span className="grid-card-git-details">
          <span title={summary.branch}>{branchLabel}</span>
          {summary.changedFiles ? (
            <>
              <span>{summary.changedFiles} 文件</span>
              <span className="grid-card-git-added">+{summary.addedLines ?? 0}</span>
              <span className="grid-card-git-deleted">-{summary.deletedLines ?? 0}</span>
            </>
          ) : (
            <span className="grid-card-git-clean">✓ 干净</span>
          )}
        </span>
      ) : (
        <span className="grid-card-git-details">
          {summary.unavailableReason ?? "非 Git 工作目录"}
        </span>
      )}
    </div>
  );
}
