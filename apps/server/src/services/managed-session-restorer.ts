import type {
  AgentSessionRecord,
  RestoreManagedSessionsResponse,
} from "@agent-orchestrator/shared";

export interface ResolvedTmuxTarget {
  tmuxSession: string;
  tmuxPane?: string;
}

export interface RestoreManagedSessionsOptions {
  sessions: AgentSessionRecord[];
  isConnected(agentSessionId: string): boolean;
  resolveTmuxTarget(
    session: AgentSessionRecord,
  ): Promise<ResolvedTmuxTarget | null>;
  clearInputState(agentSessionId: string): Promise<void> | void;
  reconnect(
    session: AgentSessionRecord,
    target: ResolvedTmuxTarget,
  ): Promise<void>;
}

export interface ManagedSessionRestorer {
  restore(): Promise<RestoreManagedSessionsResponse>;
}

function failureMessage(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : "恢复失败";
}

export async function restoreManagedSessions({
  sessions,
  isConnected,
  resolveTmuxTarget,
  clearInputState,
  reconnect,
}: RestoreManagedSessionsOptions): Promise<RestoreManagedSessionsResponse> {
  const result: RestoreManagedSessionsResponse = {
    restoredIds: [],
    alreadyConnectedIds: [],
    manualRecoveryIds: [],
    failed: [],
  };

  for (const session of sessions) {
    if (!session.transportRef?.tmuxSession) {
      result.manualRecoveryIds.push(session.id);
      continue;
    }

    if (isConnected(session.id)) {
      result.alreadyConnectedIds.push(session.id);
      continue;
    }

    try {
      const target = await resolveTmuxTarget(session);
      if (!target) {
        result.failed.push({
          agentSessionId: session.id,
          displayName: session.displayName,
          error: "tmux 会话不存在或当前不可访问",
        });
        continue;
      }

      await clearInputState(session.id);
      await reconnect(session, target);
      result.restoredIds.push(session.id);
    } catch (error) {
      result.failed.push({
        agentSessionId: session.id,
        displayName: session.displayName,
        error: failureMessage(error),
      });
    }
  }

  return result;
}

export function createSingleFlightManagedSessionRestorer(
  restore: () => Promise<RestoreManagedSessionsResponse>,
): ManagedSessionRestorer {
  let inFlight: Promise<RestoreManagedSessionsResponse> | null = null;

  return {
    restore() {
      if (inFlight) {
        return inFlight;
      }

      const operation = restore();
      inFlight = operation;
      void operation.then(
        () => {
          if (inFlight === operation) {
            inFlight = null;
          }
        },
        () => {
          if (inFlight === operation) {
            inFlight = null;
          }
        },
      );
      return operation;
    },
  };
}
