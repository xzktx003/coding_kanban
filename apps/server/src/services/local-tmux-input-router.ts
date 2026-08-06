import type {
  AgentSessionRecord,
  StdinAgentSessionInput,
} from "@agent-orchestrator/shared";

import type { AgentSessionRegistry } from "./agent-session-registry.js";
import type { LocalTmuxAdapter } from "./local-tmux-adapter.js";
import type { TmuxClientPromptBinding } from "./local-tmux-adapter.js";
import type { PtyRuntimeManager } from "./pty-runtime-manager.js";

interface LocalTmuxInputRouterDependencies {
  registry: Pick<AgentSessionRegistry, "get">;
  tmuxAdapter: Pick<LocalTmuxAdapter, "clearInputState" | "writeInput"> &
    Partial<Pick<LocalTmuxAdapter, "getClientPromptBinding">>;
  ptyRuntimeManager: Pick<PtyRuntimeManager, "has" | "write">;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
}

interface LocalTmuxInputOptions {
  forcePty?: boolean;
}

function isTmuxPrefixInput(input: string): boolean {
  return input === "\x01" || input === "\x02";
}

function isTmuxClientEscapeInput(input: string): boolean {
  return input === "\x1b";
}

function isTmuxClientCancelInput(input: string): boolean {
  return input === "\x03";
}

function containsTmuxClientPromptTerminator(input: string): boolean {
  return /[\r\n\x03]/u.test(input);
}

const DEFAULT_TMUX_CLIENT_PROMPT_INPUTS = new Set([
  "\x06",
  "$",
  "'",
  ",",
  ".",
  "/",
  ":",
  "f",
]);
const TMUX_CLIENT_INPUT_SETTLE_MS = 50;

export class LocalTmuxInputRouter {
  private readonly clientInputSettleDeadlineBySessionId = new Map<
    string,
    number
  >();
  private readonly clientPromptBySessionId = new Map<
    string,
    TmuxClientPromptBinding
  >();
  private readonly pendingPrefixSessionIds = new Set<string>();
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
      const hadClientPrompt =
        this.clientPromptBySessionId.delete(agentSessionId);
      this.clientInputSettleDeadlineBySessionId.delete(agentSessionId);

      try {
        if (
          (hadPendingPrefix || hadClientPrompt) &&
          this.dependencies.ptyRuntimeManager.has(agentSessionId)
        ) {
          try {
            this.dependencies.ptyRuntimeManager.write(agentSessionId, "\x03");
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
    const now = this.dependencies.now?.() ?? Date.now();
    const clientPrompt = this.clientPromptBySessionId.get(agentSession.id);
    const hadClientPrompt = clientPrompt !== undefined;
    const hadPendingPrefix = this.pendingPrefixSessionIds.has(agentSession.id);
    const isPrefixInput = isTmuxPrefixInput(input.input);
    const isClientEscapeInput = isTmuxClientEscapeInput(input.input);
    const isClientCancelInput = isTmuxClientCancelInput(input.input);
    const prefixCommandInput = input.input.slice(0, 1);
    const openedClientPrompt =
      hadPendingPrefix &&
      (await this.getClientPromptBinding(prefixCommandInput));

    if (hadPendingPrefix) {
      this.pendingPrefixSessionIds.delete(agentSession.id);
    } else if (!hadClientPrompt && isPrefixInput) {
      this.pendingPrefixSessionIds.add(agentSession.id);
    }

    if (
      openedClientPrompt &&
      !containsTmuxClientPromptTerminator(input.input.slice(1))
    ) {
      this.clientPromptBySessionId.set(agentSession.id, openedClientPrompt);
    } else if (
      clientPrompt === "confirm-before" ||
      (clientPrompt === "command-prompt" &&
        containsTmuxClientPromptTerminator(input.input))
    ) {
      this.clientPromptBySessionId.delete(agentSession.id);
    }

    const shouldUsePty =
      options.forcePty === true ||
      hadClientPrompt ||
      hadPendingPrefix ||
      isPrefixInput ||
      isClientEscapeInput ||
      isClientCancelInput;

    if (shouldUsePty) {
      if (!ptyRuntimeManager.has(agentSession.id)) {
        this.clientInputSettleDeadlineBySessionId.delete(agentSession.id);
        this.pendingPrefixSessionIds.delete(agentSession.id);
        this.clientPromptBySessionId.delete(agentSession.id);
        return options.forcePty || hadClientPrompt || openedClientPrompt
          ? registry.get(agentSession.id)
          : this.writeThroughAdapter(agentSession, input);
      }

      ptyRuntimeManager.write(agentSession.id, input.input);
      if (isClientEscapeInput || isClientCancelInput) {
        this.clientInputSettleDeadlineBySessionId.set(
          agentSession.id,
          now + TMUX_CLIENT_INPUT_SETTLE_MS,
        );
      }
      return registry.get(agentSession.id);
    }

    const clientSettle = this.waitForClientInputToSettle(agentSession.id);
    if (clientSettle) {
      await clientSettle;
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

  private async getClientPromptBinding(
    input: string,
  ): Promise<TmuxClientPromptBinding | null> {
    if (!input) {
      return null;
    }

    const detector = this.dependencies.tmuxAdapter.getClientPromptBinding;
    if (!detector) {
      return DEFAULT_TMUX_CLIENT_PROMPT_INPUTS.has(input)
        ? "command-prompt"
        : null;
    }

    try {
      return await detector.call(this.dependencies.tmuxAdapter, input);
    } catch {
      return DEFAULT_TMUX_CLIENT_PROMPT_INPUTS.has(input)
        ? "command-prompt"
        : null;
    }
  }

  private waitForClientInputToSettle(
    agentSessionId: string,
  ): Promise<void> | undefined {
    const deadline =
      this.clientInputSettleDeadlineBySessionId.get(agentSessionId);
    if (deadline === undefined) {
      return undefined;
    }

    this.clientInputSettleDeadlineBySessionId.delete(agentSessionId);
    const remaining = deadline - (this.dependencies.now?.() ?? Date.now());
    if (remaining <= 0) {
      return undefined;
    }

    if (this.dependencies.sleep) {
      return this.dependencies.sleep(remaining);
    }

    return new Promise<void>((resolve) => {
      setTimeout(resolve, remaining);
    });
  }

  private writeThroughAdapter(
    agentSession: AgentSessionRecord,
    input: StdinAgentSessionInput,
  ): Promise<AgentSessionRecord> {
    if (
      !this.dependencies.ptyRuntimeManager.has(agentSession.id) ||
      !agentSession.transportRef?.tmuxSession
    ) {
      return this.dependencies.tmuxAdapter.writeInput(agentSession, input);
    }

    // The attached client can change its active pane without sending a mouse
    // or prefix event through this router. Target the session while it is live
    // so keyboard input always follows the pane currently shown in the PTY.
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
