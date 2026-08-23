import type {
  AgentSessionRecord,
  StdinAgentSessionInput,
} from "@agent-orchestrator/shared";

import type { AgentSessionRegistry } from "./agent-session-registry.js";
import type { LocalTmuxAdapter } from "./local-tmux-adapter.js";
import type { TmuxClientPromptBinding } from "./local-tmux-adapter.js";
import {
  isTerminalMouseMotionPayload,
  isTerminalProtocolResponsePayload,
} from "./terminal-control-filter.js";
import type {
  PtyRuntimeManager,
  PtyRuntimeWriteOptions,
} from "./pty-runtime-manager.js";

interface LocalTmuxInputRouterDependencies {
  registry: Pick<AgentSessionRegistry, "get">;
  tmuxAdapter: Pick<LocalTmuxAdapter, "clearInputState" | "writeInput"> &
    Partial<Pick<LocalTmuxAdapter, "getClientPromptBinding">>;
  ptyRuntimeManager: Pick<PtyRuntimeManager, "has"> & {
    write(
      agentSessionId: string,
      input: string,
      options?: PtyRuntimeWriteOptions,
    ): void | Promise<void>;
  } & Partial<Pick<PtyRuntimeManager, "waitForTmuxClientReady">>;
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

function requiresTmuxPaneAdapter(input: string): boolean {
  // tmux clients without extended-keys support consume CSI-u modified keys
  // before they reach the active pane. send-keys -l preserves these bytes.
  return /^(?:\x1b\[\d+(?:;\d+)+u)+$/u.test(input);
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
export class LocalTmuxInputRouter {
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
    if (isTerminalMouseMotionPayload(input.input)) {
      return Promise.resolve(this.dependencies.registry.get(agentSession.id));
    }

    if (isTerminalProtocolResponsePayload(input.input)) {
      return this.writeTerminalProtocolResponse(agentSession, input);
    }

    return this.enqueue(agentSession.id, () =>
      this.writeNow(agentSession, input, options),
    );
  }

  clear(agentSessionId: string): Promise<void> {
    return this.enqueue(agentSessionId, async () => {
      const hadPendingPrefix =
        this.pendingPrefixSessionIds.delete(agentSessionId);
      const hadClientPrompt =
        this.clientPromptBySessionId.delete(agentSessionId);

      try {
        if (
          (hadPendingPrefix || hadClientPrompt) &&
          this.dependencies.ptyRuntimeManager.has(agentSessionId)
        ) {
          // Escape cancels tmux's one-shot prefix state. Ctrl+C is reserved
          // for an open tmux command/confirm prompt; sending it for a bare
          // prefix can leak an interrupt into the active pane instead.
          const cleanupInputs = [
            ...(hadPendingPrefix ? ["\x1b"] : []),
            ...(hadClientPrompt ? ["\x03"] : []),
          ];
          for (const cleanupInput of cleanupInputs) {
            try {
              await this.dependencies.ptyRuntimeManager.write(
                agentSessionId,
                cleanupInput,
              );
            } catch {
              // The PTY can exit between has() and write(); state cleanup must
              // still complete so reconnect and delete operations can proceed.
            }
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
    const ptyAvailable = ptyRuntimeManager.has(agentSession.id);
    const ptyReady = await this.isAttachedTmuxClientReady(
      agentSession.id,
      ptyAvailable,
    );

    // Scrollback replay can reach the browser before `tmux attach` has
    // finished. Do not send early bytes to the shell that is about to exec
    // tmux; the pane adapter preserves them until the client is available.
    if (ptyAvailable && !ptyReady) {
      return this.writeThroughAdapter(agentSession, input);
    }

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
      (ptyReady && !requiresTmuxPaneAdapter(input.input)) ||
      options.forcePty === true ||
      hadClientPrompt ||
      hadPendingPrefix ||
      isPrefixInput ||
      isClientEscapeInput ||
      isClientCancelInput;

    if (shouldUsePty) {
      if (!ptyReady) {
        this.pendingPrefixSessionIds.delete(agentSession.id);
        this.clientPromptBySessionId.delete(agentSession.id);
        return options.forcePty || hadClientPrompt || openedClientPrompt
          ? registry.get(agentSession.id)
          : this.writeThroughAdapter(agentSession, input);
      }

      await ptyRuntimeManager.write(agentSession.id, input.input);
      return registry.get(agentSession.id);
    }

    try {
      return await this.writeThroughAdapter(agentSession, input);
    } catch (error) {
      if (!ptyRuntimeManager.has(agentSession.id)) {
        throw error;
      }

      await ptyRuntimeManager.write(agentSession.id, input.input);
      return registry.get(agentSession.id);
    }
  }

  private async writeTerminalProtocolResponse(
    agentSession: AgentSessionRecord,
    input: StdinAgentSessionInput,
  ): Promise<AgentSessionRecord> {
    const { ptyRuntimeManager, registry } = this.dependencies;
    const ptyAvailable = ptyRuntimeManager.has(agentSession.id);
    const ptyReady = await this.isAttachedTmuxClientReady(
      agentSession.id,
      ptyAvailable,
    );

    // Before `tmux attach` owns the client PTY, a terminal response would be
    // interpreted by the launch shell. Dropping it is safer than falling back
    // to send-keys; the runtime's pending query will release on its timeout.
    if (!ptyReady) {
      return registry.get(agentSession.id);
    }

    await ptyRuntimeManager.write(agentSession.id, input.input, {
      terminalProtocolResponse: true,
    });
    return registry.get(agentSession.id);
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

  private async isAttachedTmuxClientReady(
    agentSessionId: string,
    ptyAvailable: boolean,
  ): Promise<boolean> {
    if (!ptyAvailable) {
      return false;
    }

    const waiter = this.dependencies.ptyRuntimeManager.waitForTmuxClientReady;
    if (!waiter) {
      return true;
    }

    try {
      return await waiter.call(
        this.dependencies.ptyRuntimeManager,
        agentSessionId,
      );
    } catch {
      return false;
    }
  }

  private writeThroughAdapter(
    agentSession: AgentSessionRecord,
    input: StdinAgentSessionInput,
  ): Promise<AgentSessionRecord> {
    if (
      this.dependencies.ptyRuntimeManager.has(agentSession.id) &&
      agentSession.transportRef?.tmuxSession
    ) {
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

    return this.dependencies.tmuxAdapter.writeInput(agentSession, input);
  }
}
