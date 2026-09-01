import type {
  AgentSessionRecord,
  AgentTranscriptResponse,
} from "@agent-orchestrator/shared";

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
  CodexTranscriptService,
  ReadRemoteTranscriptInput,
  ReadTranscriptInput,
} from "./codex-transcript-service.js";
import type { CodexSessionLocator } from "./codex-session-locator.js";

interface CodexCompletionContentResolverOptions {
  registry: Pick<AgentSessionRegistry, "get" | "updateSession">;
  codexSessionLocator: Pick<CodexSessionLocator, "resolve">;
  codexTranscriptService: Pick<CodexTranscriptService, "read"> &
    Partial<
      Pick<
        CodexTranscriptService,
        "readRemote" | "readLatestCompletion" | "readLatestRemoteCompletion"
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
  return !["claude", "copilot", "opencode"].includes(agentKind);
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

export class CodexCompletionContentResolver {
  readonly #registry: Pick<AgentSessionRegistry, "get" | "updateSession">;
  readonly #codexSessionLocator: Pick<CodexSessionLocator, "resolve">;
  readonly #codexTranscriptService: Pick<CodexTranscriptService, "read"> &
    Partial<
      Pick<
        CodexTranscriptService,
        "readRemote" | "readLatestCompletion" | "readLatestRemoteCompletion"
      >
    >;
  readonly #sessionResolutionCache = new Map<string, CachedSessionResolution>();

  constructor(options: CodexCompletionContentResolverOptions) {
    this.#registry = options.registry;
    this.#codexSessionLocator = options.codexSessionLocator;
    this.#codexTranscriptService = options.codexTranscriptService;
  }

  async resolve(event: FeishuCompletionEvent): Promise<string | null> {
    const session = this.#registry.get(event.sessionId);
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
      return this.#codexTranscriptService.readLatestRemoteCompletion(input);
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
    return this.#codexTranscriptService.readLatestCompletion(input);
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
    this.#sessionResolutionCache.set(session.id, {
      signature,
      ...(sessionId ? { sessionId } : {}),
      expiresAt: now + SESSION_RESOLUTION_CACHE_MS,
    });
    return sessionId;
  }
}
