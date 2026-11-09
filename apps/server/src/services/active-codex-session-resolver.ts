import type { AgentSessionRecord } from "@agent-orchestrator/shared";

import type { AgentSessionRegistry } from "./agent-session-registry.js";
import type { CodexSessionLocator } from "./codex-session-locator.js";

interface ActiveCodexSessionResolverDependencies {
  registry: Pick<AgentSessionRegistry, "updateSession">;
  codexSessionLocator: Pick<CodexSessionLocator, "resolve"> &
    Partial<Pick<CodexSessionLocator, "resolveTmuxPanes">>;
}

export function isRemoteAgentSession(
  session: Pick<AgentSessionRecord, "hostId" | "sshTarget">,
): boolean {
  return Boolean(
    session.sshTarget || (session.hostId && session.hostId !== "local"),
  );
}

function adoptResolvedCodexThread(
  agentSession: AgentSessionRecord,
  dependencies: ActiveCodexSessionResolverDependencies,
  activeSessionId: string | undefined,
): string | undefined {
  if (activeSessionId && activeSessionId !== agentSession.agentSessionId) {
    dependencies.registry.updateSession(agentSession.id, {
      agentSessionId: activeSessionId,
    });
  }
  return activeSessionId;
}

export function shouldRebindLocalCodexTranscript(
  session: Pick<
    AgentSessionRecord,
    "agentKind" | "hostId" | "sshTarget" | "transportRef"
  >,
): boolean {
  if (isRemoteAgentSession(session)) return false;
  if (!session.transportRef?.tmuxPane && !session.transportRef?.tmuxSession) {
    return false;
  }
  const executable = session.agentKind.trim().split(/[\\/]/).at(-1) ?? "";
  return executable === "codex" || executable.startsWith("codex-");
}

export async function rebindLocalCodexTranscripts(
  sessions: readonly AgentSessionRecord[],
  dependencies: ActiveCodexSessionResolverDependencies,
): Promise<void> {
  for (const session of sessions) {
    if (!shouldRebindLocalCodexTranscript(session)) continue;
    try {
      await resolveActiveCodexSessionId(session, dependencies, {
        historyOnly: true,
      });
    } catch {
      // One pane's process lookup must not stop the other cards.
    }
  }
}

export async function resolveActiveCodexSessionId(
  agentSession: AgentSessionRecord,
  dependencies: ActiveCodexSessionResolverDependencies,
  options: { historyOnly?: boolean } = {},
): Promise<string | undefined> {
  if (isRemoteAgentSession(agentSession)) {
    return agentSession.agentSessionId;
  }

  const tmuxSession = agentSession.transportRef?.tmuxSession;
  const rawTmuxClientProcessId = agentSession.transportRef?.processId;
  const tmuxClientProcessId =
    agentSession.connectionState === "online" &&
    typeof rawTmuxClientProcessId === "number" &&
    Number.isSafeInteger(rawTmuxClientProcessId) &&
    rawTmuxClientProcessId > 0
      ? rawTmuxClientProcessId
      : undefined;
  const tmuxTarget = agentSession.transportRef?.tmuxPane ?? tmuxSession;
  if (!tmuxTarget) {
    return agentSession.agentSessionId;
  }

  const locatorInput = {
    tmuxTarget,
    ...(tmuxSession ? { tmuxSession } : {}),
    ...(tmuxClientProcessId !== undefined ? { tmuxClientProcessId } : {}),
    workingDirectory: agentSession.workingDirectory,
  };
  let activeSessionId =
    await dependencies.codexSessionLocator.resolve(locatorInput);
  if (!activeSessionId && options.historyOnly) {
    // History may display the unique thread born with the live Codex process,
    // or the single rollout rewritten by a bare resume. Persist that exact
    // thread on the card so a later closed handle does not snap back to an
    // older registration. Ordinary input calls do not set historyOnly, so
    // this still does not grant them a guessed target.
    activeSessionId = await dependencies.codexSessionLocator.resolve({
      ...locatorInput,
      ...(agentSession.agentSessionId
        ? { historySessionId: agentSession.agentSessionId }
        : {}),
      readOnlyCompletion: true,
    });
    return adoptResolvedCodexThread(
      agentSession,
      dependencies,
      activeSessionId,
    );
  }
  if (!activeSessionId) {
    // A live tmux card can be showing a non-Codex pane. Falling back to the
    // previous pane's ID would deliver the image to the wrong conversation.
    return tmuxSession ? undefined : agentSession.agentSessionId;
  }
  if (options.historyOnly) {
    return adoptResolvedCodexThread(
      agentSession,
      dependencies,
      activeSessionId,
    );
  }
  return adoptResolvedCodexThread(agentSession, dependencies, activeSessionId);
}

export async function resolveCodexSessionIds(
  agentSession: AgentSessionRecord,
  dependencies: ActiveCodexSessionResolverDependencies,
): Promise<string[]> {
  if (isRemoteAgentSession(agentSession)) {
    return agentSession.agentSessionId ? [agentSession.agentSessionId] : [];
  }

  const tmuxSession = agentSession.transportRef?.tmuxSession;
  if (tmuxSession && dependencies.codexSessionLocator.resolveTmuxPanes) {
    const panes =
      await dependencies.codexSessionLocator.resolveTmuxPanes(tmuxSession);
    if (panes.length > 0) {
      return panes.map((pane) => pane.sessionId);
    }
  }

  const activeSessionId = await resolveActiveCodexSessionId(
    agentSession,
    dependencies,
  );
  return activeSessionId ? [activeSessionId] : [];
}

/** Verify the exact thread attached to a Feishu card before native queue delivery. */
export async function verifyBoundCodexQueueThread(
  agentSession: AgentSessionRecord,
  boundThreadId: string,
  dependencies: ActiveCodexSessionResolverDependencies,
): Promise<boolean> {
  const tmuxSession = agentSession.transportRef?.tmuxSession;
  if (
    !boundThreadId ||
    !tmuxSession ||
    isRemoteAgentSession(agentSession) ||
    !dependencies.codexSessionLocator.resolveTmuxPanes
  ) {
    return false;
  }

  // The locator's read-only recovery requires a live Codex process and either a
  // unique creation-time match or the single rollout rewritten by a bare resume.
  // Keep that proof confined to card-bound queues.
  const panes = await dependencies.codexSessionLocator.resolveTmuxPanes(
    tmuxSession,
    { readOnlyCompletion: true },
  );
  return panes.some((pane) => pane.sessionId === boundThreadId);
}
