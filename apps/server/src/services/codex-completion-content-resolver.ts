import type {
  AgentSessionRecord,
  AgentTranscriptResponse,
} from "@agent-orchestrator/shared";
import { isClaudeAgentKind } from "@agent-orchestrator/shared";

import type {
  FeishuCompletionEvent,
  FeishuCompletionObservation,
} from "./agent-completion-feishu-notifier.js";
import {
  isRemoteAgentSession,
  resolveActiveCodexSessionId,
} from "./active-codex-session-resolver.js";
import type { AgentSessionRegistry } from "./agent-session-registry.js";
import type {
  ClaudeTranscriptService,
  ClaudeTurnCompletion,
  ReadClaudeTranscriptInput,
} from "./claude-transcript-service.js";
import type {
  CodexTranscriptService,
  ReadRemoteTranscriptInput,
  ReadTranscriptInput,
} from "./codex-transcript-service.js";
import type { CodexSessionLocator } from "./codex-session-locator.js";

interface CodexCompletionContentResolverOptions {
  registry: Pick<AgentSessionRegistry, "get" | "updateSession">;
  codexSessionLocator: Pick<CodexSessionLocator, "resolve"> &
    Partial<Pick<CodexSessionLocator, "resolveTmuxPanes">>;
  codexTranscriptService: Pick<CodexTranscriptService, "read"> &
    Partial<
      Pick<
        CodexTranscriptService,
        "readRemote" | "readLatestCompletion" | "readLatestRemoteCompletion"
      >
    >;
  claudeTranscriptService?: Partial<
    Pick<
      ClaudeTranscriptService,
      | "read"
      | "readRemote"
      | "readLatestCompletion"
      | "readLatestRemoteCompletion"
      | "readLatestCompletionForSession"
      | "resolveSessionId"
    >
  >;
}

interface CachedSessionResolution {
  signature: string;
  sessionId?: string;
  expiresAt: number;
}

const SESSION_RESOLUTION_CACHE_MS = 30_000;

function canResolveCodexTranscript(session: AgentSessionRecord): boolean {
  const agentKind = session.agentKind.trim().toLowerCase();
  if (agentKind === "codex") {
    return true;
  }

  if (isRemoteAgentSession(session) || !session.transportRef?.tmuxSession) {
    return false;
  }

  // Shell-labelled tmux cards can currently be displaying a Codex pane.
  return (
    !isClaudeAgentKind(agentKind) &&
    !["copilot", "opencode"].includes(agentKind)
  );
}

function canResolveClaudeTranscript(session: AgentSessionRecord): boolean {
  return isClaudeAgentKind(session.agentKind);
}

function lastAssistantOutput(
  transcript: AgentTranscriptResponse,
): string | null {
  if (!transcript.available) {
    return null;
  }

  const entry = [...transcript.entries]
    .reverse()
    .find((candidate) => candidate.kind === "assistant");
  return entry?.text.trim() ? entry.text : null;
}

function claudeInputForSession(
  session: AgentSessionRecord,
): ReadClaudeTranscriptInput {
  return {
    ...(session.agentSessionId ? { sessionId: session.agentSessionId } : {}),
    ...(session.workingDirectory
      ? { workingDirectory: session.workingDirectory }
      : {}),
    ...(session.transportRef?.tmuxSession
      ? { tmuxSession: session.transportRef.tmuxSession }
      : {}),
    ...(session.transportRef?.tmuxPane
      ? { tmuxPane: session.transportRef.tmuxPane }
      : {}),
  };
}

export class CodexCompletionContentResolver {
  readonly #registry: Pick<AgentSessionRegistry, "get" | "updateSession">;
  readonly #codexSessionLocator: Pick<CodexSessionLocator, "resolve"> &
    Partial<Pick<CodexSessionLocator, "resolveTmuxPanes">>;
  readonly #codexTranscriptService: Pick<CodexTranscriptService, "read"> &
    Partial<
      Pick<
        CodexTranscriptService,
        "readRemote" | "readLatestCompletion" | "readLatestRemoteCompletion"
      >
    >;
  readonly #claudeTranscriptService?: Partial<
    Pick<
      ClaudeTranscriptService,
      | "read"
      | "readRemote"
      | "readLatestCompletion"
      | "readLatestRemoteCompletion"
      | "readLatestCompletionForSession"
      | "resolveSessionId"
    >
  >;
  readonly #sessionResolutionCache = new Map<string, CachedSessionResolution>();

  constructor(options: CodexCompletionContentResolverOptions) {
    this.#registry = options.registry;
    this.#codexSessionLocator = options.codexSessionLocator;
    this.#codexTranscriptService = options.codexTranscriptService;
    this.#claudeTranscriptService = options.claudeTranscriptService;
  }

  async resolve(event: FeishuCompletionEvent): Promise<string | null> {
    const session = this.#registry.get(event.sessionId);
    if (canResolveClaudeTranscript(session)) {
      return this.#resolveClaude(session);
    }
    if (!canResolveCodexTranscript(session)) {
      return null;
    }

    const sessionId = await this.#resolveSessionId(session);
    const localTmuxWithoutSessionId =
      !isRemoteAgentSession(session) &&
      Boolean(session.transportRef?.tmuxSession) &&
      !sessionId;
    if (localTmuxWithoutSessionId) {
      return null;
    }

    let transcript: AgentTranscriptResponse;
    if (isRemoteAgentSession(session)) {
      if (!session.sshTarget || !this.#codexTranscriptService.readRemote) {
        return null;
      }
      const input: ReadRemoteTranscriptInput = {
        sshTarget: session.sshTarget,
        ...(sessionId ? { sessionId } : {}),
        ...(session.workingDirectory
          ? { workingDirectory: session.workingDirectory }
          : {}),
        limit: 30,
      };
      transcript = await this.#codexTranscriptService.readRemote(input);
    } else {
      const input: ReadTranscriptInput = {
        ...(sessionId ? { sessionId } : {}),
        ...(session.workingDirectory
          ? { workingDirectory: session.workingDirectory }
          : {}),
        limit: 30,
      };
      transcript = this.#codexTranscriptService.read(input);
    }

    return lastAssistantOutput(transcript);
  }

  async inspectLatestCompletion(
    event: FeishuCompletionEvent,
  ): Promise<FeishuCompletionObservation | null> {
    const session = this.#registry.get(event.sessionId);
    if (canResolveClaudeTranscript(session)) {
      return this.#inspectLatestClaudeCompletion(session);
    }
    if (!canResolveCodexTranscript(session)) {
      return null;
    }

    const sessionId = await this.#resolveSessionId(session);
    if (
      !isRemoteAgentSession(session) &&
      session.transportRef?.tmuxSession &&
      !sessionId
    ) {
      return null;
    }

    if (isRemoteAgentSession(session)) {
      if (
        !session.sshTarget ||
        !this.#codexTranscriptService.readLatestRemoteCompletion
      ) {
        return null;
      }
      const input: ReadRemoteTranscriptInput = {
        sshTarget: session.sshTarget,
        ...(sessionId ? { sessionId } : {}),
        ...(session.workingDirectory
          ? { workingDirectory: session.workingDirectory }
          : {}),
      };
      const completion =
        await this.#codexTranscriptService.readLatestRemoteCompletion(input);
      return completion && sessionId
        ? {
            ...completion,
            codexThreadId: sessionId,
            transcriptAgentKind: "codex",
            transcriptSessionId: sessionId,
          }
        : completion;
    }

    if (!this.#codexTranscriptService.readLatestCompletion) {
      return null;
    }
    const input: ReadTranscriptInput = {
      ...(sessionId ? { sessionId } : {}),
      ...(session.workingDirectory
        ? { workingDirectory: session.workingDirectory }
        : {}),
    };
    const completion = this.#codexTranscriptService.readLatestCompletion(input);
    return completion && sessionId
      ? {
          ...completion,
          codexThreadId: sessionId,
          transcriptAgentKind: "codex",
          transcriptSessionId: sessionId,
        }
      : completion;
  }

  async inspectLatestCompletions(
    event: FeishuCompletionEvent,
  ): Promise<FeishuCompletionObservation[]> {
    const session = this.#registry.get(event.sessionId);
    if (canResolveClaudeTranscript(session)) {
      const completion = await this.#inspectLatestClaudeCompletion(session);
      return completion ? [completion] : [];
    }
    if (!canResolveCodexTranscript(session)) {
      return [];
    }

    const tmuxSession = session.transportRef?.tmuxSession;
    if (
      isRemoteAgentSession(session) ||
      !tmuxSession ||
      !this.#codexSessionLocator.resolveTmuxPanes ||
      !this.#codexTranscriptService.readLatestCompletion
    ) {
      const completion = await this.inspectLatestCompletion(event);
      return completion ? [completion] : [];
    }

    const panes = await this.#codexSessionLocator.resolveTmuxPanes(tmuxSession);
    if (panes.length === 0) {
      const completion = await this.inspectLatestCompletion(event);
      return completion ? [completion] : [];
    }

    return panes.flatMap((pane) => {
      try {
        const completion = this.#codexTranscriptService.readLatestCompletion!({
          sessionId: pane.sessionId,
          ...(pane.workingDirectory
            ? { workingDirectory: pane.workingDirectory }
            : session.workingDirectory
              ? { workingDirectory: session.workingDirectory }
              : {}),
        });
        return completion
          ? [
              {
                ...completion,
                codexThreadId: pane.sessionId,
                transcriptAgentKind: "codex",
                transcriptSessionId: pane.sessionId,
              },
            ]
          : [];
      } catch {
        return [];
      }
    });
  }

  async #resolveSessionId(
    session: AgentSessionRecord,
  ): Promise<string | undefined> {
    const signature = [
      session.agentSessionId ?? "",
      session.transportRef?.tmuxSession ?? "",
      session.transportRef?.tmuxPane ?? "",
      session.transportRef?.processId ?? "",
      session.workingDirectory ?? "",
    ].join("\u0000");
    const cached = this.#sessionResolutionCache.get(session.id);
    const now = Date.now();
    if (cached && cached.signature === signature && cached.expiresAt > now) {
      return cached.sessionId;
    }

    const sessionId = await resolveActiveCodexSessionId(session, {
      registry: this.#registry,
      codexSessionLocator: this.#codexSessionLocator,
    });
    if (sessionId) {
      this.#sessionResolutionCache.set(session.id, {
        signature,
        sessionId,
        expiresAt: now + SESSION_RESOLUTION_CACHE_MS,
      });
    } else {
      this.#sessionResolutionCache.delete(session.id);
    }
    return sessionId;
  }

  async #resolveClaude(session: AgentSessionRecord): Promise<string | null> {
    if (!this.#claudeTranscriptService?.read) {
      return null;
    }
    if (isRemoteAgentSession(session)) {
      if (!session.sshTarget || !this.#claudeTranscriptService.readRemote) {
        return null;
      }
      const transcript = await this.#claudeTranscriptService.readRemote({
        ...claudeInputForSession(session),
        sshTarget: session.sshTarget,
        limit: 30,
      });
      return lastAssistantOutput(transcript);
    }
    const transcript = await this.#claudeTranscriptService.read({
      ...claudeInputForSession(session),
      limit: 30,
    });
    return lastAssistantOutput(transcript);
  }

  async #inspectLatestClaudeCompletion(
    session: AgentSessionRecord,
  ): Promise<FeishuCompletionObservation | null> {
    const completion = await this.#readLatestClaudeCompletion(session);
    if (!completion) {
      return null;
    }
    const resolvedSessionId =
      completion.sessionId ||
      (await this.#claudeTranscriptService?.resolveSessionId?.(session));
    return {
      completionId: completion.completionId,
      content: completion.content,
      completedAt: completion.completedAt,
      ...(completion.userQuestion
        ? { userQuestion: completion.userQuestion }
        : {}),
      ...(resolvedSessionId
        ? {
            transcriptAgentKind: "claude",
            transcriptSessionId: resolvedSessionId,
          }
        : {}),
    };
  }

  async #readLatestClaudeCompletion(
    session: AgentSessionRecord,
  ): Promise<ClaudeTurnCompletion | null> {
    const service = this.#claudeTranscriptService;
    if (!service) {
      return null;
    }
    if (service.readLatestCompletionForSession) {
      return service.readLatestCompletionForSession(session);
    }
    const input = claudeInputForSession(session);
    if (isRemoteAgentSession(session)) {
      if (!session.sshTarget || !service.readLatestRemoteCompletion) {
        return null;
      }
      return service.readLatestRemoteCompletion({
        ...input,
        sshTarget: session.sshTarget,
      });
    }
    if (!service.readLatestCompletion) {
      return null;
    }
    return service.readLatestCompletion(input);
  }
}
