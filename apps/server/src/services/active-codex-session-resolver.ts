import type { AgentSessionRecord } from "@agent-orchestrator/shared";

import type { AgentSessionRegistry } from "./agent-session-registry.js";
import type { CodexSessionLocator } from "./codex-session-locator.js";

interface ActiveCodexSessionResolverDependencies {
  registry: Pick<AgentSessionRegistry, "updateSession">;
  codexSessionLocator: Pick<CodexSessionLocator, "resolve">;
}

export function isRemoteAgentSession(
  session: Pick<AgentSessionRecord, "hostId" | "sshTarget">,
): boolean {
  return Boolean(
    session.sshTarget || (session.hostId && session.hostId !== "local"),
  );
}

export async function resolveActiveCodexSessionId(
  agentSession: AgentSessionRecord,
  dependencies: ActiveCodexSessionResolverDependencies,
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

  const activeSessionId = await dependencies.codexSessionLocator.resolve({
    tmuxTarget,
    ...(tmuxSession ? { tmuxSession } : {}),
    ...(tmuxClientProcessId !== undefined ? { tmuxClientProcessId } : {}),
    workingDirectory: agentSession.workingDirectory,
  });
  if (!activeSessionId) {
    // A live tmux card can be showing a non-Codex pane. Falling back to the
    // previous pane's ID would deliver the image to the wrong conversation.
    return tmuxSession ? undefined : agentSession.agentSessionId;
  }
  if (activeSessionId !== agentSession.agentSessionId) {
    dependencies.registry.updateSession(agentSession.id, {
      agentSessionId: activeSessionId,
    });
  }
  return activeSessionId;
}
