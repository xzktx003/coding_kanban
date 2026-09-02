import type { AgentSessionRecord } from "@agent-orchestrator/shared";

import type { AgentSessionRegistry } from "./agent-session-registry.js";
import type { LocalProcessRuntimeManager } from "./local-process-runtime-manager.js";
import type { LocalTmuxAdapter } from "./local-tmux-adapter.js";
import type { LocalTmuxInputRouter } from "./local-tmux-input-router.js";
import type { PtyRuntimeManager } from "./pty-runtime-manager.js";
import type { SshRuntimeManager } from "./ssh-runtime-manager.js";
import {
  isTerminalFocusPayload,
  isTerminalPtyControlPayload,
  stripTerminalResponsePayload,
} from "./terminal-control-filter.js";

interface AgentSessionInputServiceOptions {
  registry: Pick<AgentSessionRegistry, "get">;
  tmuxAdapter: Pick<LocalTmuxAdapter, "writeInput">;
  localTmuxInputRouter: Pick<LocalTmuxInputRouter, "write">;
  sshRuntimeManager: Pick<SshRuntimeManager, "writeInput">;
  ptyRuntimeManager: Pick<PtyRuntimeManager, "has" | "write">;
  processRuntimeManager: Pick<LocalProcessRuntimeManager, "writeInput">;
}

const BRACKETED_PASTE_START = "\x1b[200~";
const BRACKETED_PASTE_END = "\x1b[201~";

/**
 * Keep multiline prompts together when they are written to an interactive
 * terminal. The submit key is intentionally sent separately by writePrompt.
 */
export function buildInteractivePromptInput(prompt: string): string {
  if (prompt.includes("\n")) {
    return `${BRACKETED_PASTE_START}${prompt}${BRACKETED_PASTE_END}`;
  }
  return prompt;
}

export class AgentSessionInputService {
  constructor(private readonly options: AgentSessionInputServiceOptions) {}

  async write(sessionId: string, input: string): Promise<AgentSessionRecord> {
    const agentSession = this.options.registry.get(sessionId);
    const sanitizedInput = stripTerminalResponsePayload(input);
    if (!sanitizedInput) {
      return agentSession;
    }

    const sanitizedBody = { input: sanitizedInput };
    if (agentSession.sourceType === "remote-tmux-discovered") {
      return this.options.tmuxAdapter.writeInput(agentSession, sanitizedBody);
    }
    if (
      agentSession.sourceType === "remote-connect" &&
      agentSession.transportRef?.runtimeId?.startsWith("ssh:")
    ) {
      return this.options.sshRuntimeManager.writeInput(
        sessionId,
        sanitizedBody,
      );
    }
    if (agentSession.transportRef?.tmuxSession && !agentSession.sshTarget) {
      if (isTerminalFocusPayload(sanitizedInput)) {
        return agentSession;
      }
      if (isTerminalPtyControlPayload(sanitizedInput)) {
        return this.options.localTmuxInputRouter.write(
          agentSession,
          sanitizedBody,
          { forcePty: true },
        );
      }
      return this.options.localTmuxInputRouter.write(
        agentSession,
        sanitizedBody,
      );
    }
    if (this.options.ptyRuntimeManager.has(sessionId)) {
      await this.options.ptyRuntimeManager.write(sessionId, sanitizedInput);
      return this.options.registry.get(sessionId);
    }
    return this.options.processRuntimeManager.writeInput(
      sessionId,
      sanitizedBody,
    );
  }

  /**
   * Deliver a prompt and submit it using the terminal semantics supported by
   * the target runtime. Interactive PTY/tmux sessions need a distinct Enter
   * write because some TUI clients consume a same-packet CR as plain input.
   * Legacy direct process/SSH pipes instead receive one newline-delimited
   * payload so they do not get an extra blank command.
   */
  async writePrompt(
    sessionId: string,
    prompt: string,
  ): Promise<AgentSessionRecord> {
    const agentSession = this.options.registry.get(sessionId);
    const isInteractiveTerminal =
      this.options.ptyRuntimeManager.has(sessionId) ||
      agentSession.sourceType === "remote-tmux-discovered" ||
      Boolean(agentSession.transportRef?.tmuxSession);

    if (!isInteractiveTerminal) {
      return this.write(sessionId, `${prompt}\n`);
    }

    await this.write(sessionId, buildInteractivePromptInput(prompt));
    return this.write(sessionId, "\r");
  }
}
