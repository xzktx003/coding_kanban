import type {
  AgentSessionRecord,
  StdinAgentSessionInput,
} from "@agent-orchestrator/shared";

import type { AgentSessionRegistry } from "./agent-session-registry.js";
import type { LocalTmuxAdapter } from "./local-tmux-adapter.js";
import type { PtyRuntimeManager } from "./pty-runtime-manager.js";

interface LocalTmuxInputRouterDependencies {
  registry: Pick<AgentSessionRegistry, "get">;
  tmuxAdapter: Pick<LocalTmuxAdapter, "clearInputState" | "writeInput">;
  ptyRuntimeManager: Pick<PtyRuntimeManager, "has" | "write">;
}

interface LocalTmuxInputOptions {
  forcePty?: boolean;
}

function isTmuxPrefixInput(input: string): boolean {
  return input === "\x01" || input === "\x02";
}

export class LocalTmuxInputRouter {
  private readonly pendingPrefixSessionIds = new Set<string>();
  private readonly followClientActivePaneSessionIds = new Set<string>();
  private readonly writeQueues = new Map<string, Promise<void>>();

  constructor(
    private readonly dependencies: LocalTmuxInputRouterDependencies,
  ) {}

  write(
    agentSession: AgentSessionRecord,
    input: StdinAgentSessionInput,
    options: LocalTmuxInputOptions = {},
  ): Promise<AgentSessionRecord> {
    return this.enqueue(agentSession.id, () =>
      this.writeNow(agentSession, input, options),
    );
  }

  clear(agentSessionId: string): Promise<void> {
    return this.enqueue(agentSessionId, () => {
      const hadPendingPrefix =
        this.pendingPrefixSessionIds.delete(agentSessionId);
      this.followClientActivePaneSessionIds.delete(agentSessionId);

      try {
        if (
          hadPendingPrefix &&
          this.dependencies.ptyRuntimeManager.has(agentSessionId)
        ) {
          try {
            this.dependencies.ptyRuntimeManager.write(agentSessionId, "\x1b");
          } catch {
            // The PTY can exit between has() and write(); state cleanup must
            // still complete so reconnect and delete operations can proceed.
          }
        }
      } finally {
        this.dependencies.tmuxAdapter.clearInputState(agentSessionId);
      }
    });
  }

  private enqueue<Result>(
    agentSessionId: string,
    operationFactory: () => Promise<Result> | Result,
  ): Promise<Result> {
    const previous = this.writeQueues.get(agentSessionId) ?? Promise.resolve();
    const operation = previous.catch(() => {}).then(operationFactory);
    const queueTail = operation.then(
      () => undefined,
      () => undefined,
    );

    this.writeQueues.set(agentSessionId, queueTail);
    void queueTail.then(() => {
      if (this.writeQueues.get(agentSessionId) === queueTail) {
        this.writeQueues.delete(agentSessionId);
      }
    });

    return operation;
  }

  private async writeNow(
    agentSession: AgentSessionRecord,
    input: StdinAgentSessionInput,
    options: LocalTmuxInputOptions,
  ): Promise<AgentSessionRecord> {
    const { registry, tmuxAdapter, ptyRuntimeManager } = this.dependencies;
    const hadPendingPrefix = this.pendingPrefixSessionIds.has(agentSession.id);
    const isPrefixInput = isTmuxPrefixInput(input.input);

    if (hadPendingPrefix) {
      this.pendingPrefixSessionIds.delete(agentSession.id);
    } else if (isPrefixInput) {
      this.pendingPrefixSessionIds.add(agentSession.id);
    }

    const shouldUsePty =
      options.forcePty === true || hadPendingPrefix || isPrefixInput;

    if (shouldUsePty) {
      if (!ptyRuntimeManager.has(agentSession.id)) {
        this.pendingPrefixSessionIds.delete(agentSession.id);
        return options.forcePty
          ? registry.get(agentSession.id)
          : this.writeThroughAdapter(agentSession, input);
      }

      ptyRuntimeManager.write(agentSession.id, input.input);
      if (options.forcePty === true || hadPendingPrefix) {
        this.followClientActivePaneSessionIds.add(agentSession.id);
      }
      return registry.get(agentSession.id);
    }

    try {
      return await this.writeThroughAdapter(agentSession, input);
    } catch (error) {
      if (!ptyRuntimeManager.has(agentSession.id)) {
        throw error;
      }

      ptyRuntimeManager.write(agentSession.id, input.input);
      return registry.get(agentSession.id);
    }
  }

  private writeThroughAdapter(
    agentSession: AgentSessionRecord,
    input: StdinAgentSessionInput,
  ): Promise<AgentSessionRecord> {
    if (
      !this.followClientActivePaneSessionIds.has(agentSession.id) ||
      !agentSession.transportRef
    ) {
      return this.dependencies.tmuxAdapter.writeInput(agentSession, input);
    }

    const { tmuxPane: _fixedPane, ...activePaneTarget } =
      agentSession.transportRef;
    return this.dependencies.tmuxAdapter.writeInput(
      {
        ...agentSession,
        transportRef: activePaneTarget,
      },
      input,
    );
  }
}
