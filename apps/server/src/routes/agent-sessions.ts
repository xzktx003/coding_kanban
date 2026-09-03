import type { FastifyInstance } from "fastify";

import {
  isCodexSessionCandidate,
  isLocalCodexSessionCandidate,
  type AgentTaskDiffResponse,
  type AgentSessionRecord,
  type AgentGitSummary,
  type AgentTaskSummaryResponse,
  type OpenVsCodeWebResponse,
  type LaunchRemoteAgentInput,
  type LaunchLocalAgentInput,
  type LaunchSshPtyInput,
  type FocusAgentSessionInput,
  type PtyResizeInput,
  type RegisterAgentSessionInput,
  type ScanDirectoryInput,
  type StdinAgentSessionInput,
  type UpdateAgentSessionInput,
  type DiscoverTmuxInput,
  type AddDiscoveredTmuxInput,
  type CheckoutDiffResponse,
  type RevertGitHunkInput,
  type RevertGitHunkResponse,
} from "@agent-orchestrator/shared";
import { formatWorkingDirectory, shellQuote } from "@agent-orchestrator/shared";

import { scanAgentDirectory } from "../services/agent-scanner.js";
import { AgentSessionRegistry } from "../services/agent-session-registry.js";
import { AgentSessionInputService } from "../services/agent-session-input-service.js";
import {
  isRemoteAgentSession,
  resolveActiveCodexSessionId,
} from "../services/active-codex-session-resolver.js";
import { CodexTranscriptService } from "../services/codex-transcript-service.js";
import { summarizeCodexTranscript } from "../services/codex-transcript-service.js";
import { CodexSessionLocator } from "../services/codex-session-locator.js";
import { CodexChangeService } from "../services/codex-change-service.js";
import {
  GitHunkRevertError,
  GitChangesService,
} from "../services/git-changes-service.js";
import { LocalProcessRuntimeManager } from "../services/local-process-runtime-manager.js";
import { GitProjectSummaryService } from "../services/git-project-summary-service.js";
import { LocalTmuxAdapter } from "../services/local-tmux-adapter.js";
import { LocalTmuxInputRouter } from "../services/local-tmux-input-router.js";
import { PtyRuntimeManager } from "../services/pty-runtime-manager.js";
import type { SftpService } from "../services/sftp-service.js";
import {
  RemoteLaunchPreflightError,
  type RemoteLaunchPreflightLike,
} from "../services/remote-launch-preflight.js";
import { DEFAULT_TERMINAL_TMUX_CAPTURE_LINES } from "../config/server-runtime-config.js";
import { buildInteractiveShellCommand } from "../services/runtime-compat.js";
import { SshRuntimeManager } from "../services/ssh-runtime-manager.js";
import {
  assertValidSshTarget,
  InvalidSshTargetError,
} from "../services/ssh-command.js";
import {
  canonicalTmuxDisplayName,
  normalizeTmuxSessionName,
} from "../services/tmux-display-name.js";
import {
  UnsupportedVsCodeWebSessionError,
  VsCodeWebManager,
  VsCodeWebUnavailableError,
} from "../services/vscode-web-manager.js";
import { resolveVsCodeWebRequestTarget } from "./vscode-web-request-target.js";

const TASK_SUMMARY_CACHE_TTL_MS = 15_000;
const GIT_SUMMARY_CACHE_TTL_MS = 60_000;

interface TimedCacheEntry<T> {
  value: T;
  expiresAt: number;
}

function canProbeLocalTmuxForCodex(
  session: Pick<
    AgentSessionRecord,
    "agentKind" | "hostId" | "sshTarget" | "transportRef"
  >,
): boolean {
  if (isRemoteAgentSession(session) || !session.transportRef?.tmuxSession) {
    return false;
  }

  // Process-shaped kinds can become stale when the user switches windows in
  // one tmux session. Explicit non-Codex agent cards retain their own reader.
  const agentKind = session.agentKind.trim().toLowerCase();
  return !["claude", "copilot", "opencode"].includes(agentKind);
}

function buildAgentInvocation(
  agentKind: string,
  displayName: string,
  sessionId?: string,
): string | undefined {
  if (agentKind === "shell") {
    return undefined;
  }

  if (sessionId) {
    return `${agentKind} --resume=${sessionId}`;
  }

  if (agentKind === "claude") {
    return `claude -n ${shellQuote(displayName)}`;
  }

  return agentKind;
}

function buildDirectLaunchCommand(
  agentKind: string,
  workingDirectory: string,
  displayName: string,
  sessionId?: string,
): string {
  const invocation = buildAgentInvocation(agentKind, displayName, sessionId);

  if (!invocation) {
    return "";
  }

  return `cd ${formatWorkingDirectory(workingDirectory)} && ${invocation}`;
}

function buildTmuxAttachCommand(
  tmuxSessionName: string,
  tmuxPaneId?: string,
  tmuxHistoryLimit = DEFAULT_TERMINAL_TMUX_CAPTURE_LINES,
): string {
  const normalizedTmuxSessionName = normalizeTmuxSessionName(tmuxSessionName)!;
  const tmuxPrefix = `tmux set-option -t ${shellQuote(normalizedTmuxSessionName)} history-limit ${tmuxHistoryLimit}`;

  if (tmuxPaneId) {
    return `${tmuxPrefix} \\; select-pane -t ${shellQuote(tmuxPaneId)} \\; attach -t ${shellQuote(normalizedTmuxSessionName)}`;
  }

  return `${tmuxPrefix} \\; attach -t ${shellQuote(normalizedTmuxSessionName)}`;
}

interface AgentSessionRoutesOptions {
  registry: AgentSessionRegistry;
  inputService?: Pick<AgentSessionInputService, "write">;
  processRuntimeManager: LocalProcessRuntimeManager;
  tmuxAdapter: LocalTmuxAdapter;
  localTmuxInputRouter: LocalTmuxInputRouter;
  sshRuntimeManager: SshRuntimeManager;
  ptyRuntimeManager: PtyRuntimeManager;
  remoteLaunchPreflight: RemoteLaunchPreflightLike;
  vsCodeWebManager: VsCodeWebManager;
  codexTranscriptService?: Pick<CodexTranscriptService, "read"> &
    Partial<Pick<CodexTranscriptService, "readRemote">>;
  codexSessionLocator?: Pick<CodexSessionLocator, "resolve">;
  sftpService?: Pick<
    SftpService,
    "listRecursive" | "readRange" | "readRanges" | "resolveRemotePath"
  >;
  gitProjectSummaryService?: Pick<GitProjectSummaryService, "read">;
  codexChangeService?: Pick<CodexChangeService, "read">;
  gitChangesService?: Pick<GitChangesService, "read" | "revertHunk">;
}

export interface ReconnectAgentSessionDependencies {
  registry: Pick<AgentSessionRegistry, "get">;
  tmuxAdapter: Pick<LocalTmuxAdapter, "getCaptureLines">;
  localTmuxInputRouter: Pick<LocalTmuxInputRouter, "clear">;
  ptyRuntimeManager: Pick<
    PtyRuntimeManager,
    "reconnectLocal" | "reconnectRemote"
  >;
}

interface ReconnectAgentSessionOptions {
  inputStateAlreadyCleared?: boolean;
}

function clearLocalTmuxInputState(
  agentSessionId: string,
  localTmuxInputRouter: Pick<LocalTmuxInputRouter, "clear">,
): Promise<void> {
  return localTmuxInputRouter.clear(agentSessionId);
}

export async function reconnectRegisteredAgentSession(
  agentSessionId: string,
  dependencies: ReconnectAgentSessionDependencies,
  options: ReconnectAgentSessionOptions = {},
): Promise<AgentSessionRecord> {
  const { registry, tmuxAdapter, localTmuxInputRouter, ptyRuntimeManager } =
    dependencies;
  const session = registry.get(agentSessionId);

  if (!options.inputStateAlreadyCleared) {
    await clearLocalTmuxInputState(agentSessionId, localTmuxInputRouter);
  }

  if (session.sshTarget && session.transportRef?.tmuxSession) {
    return ptyRuntimeManager.reconnectRemote(agentSessionId, {
      workspaceId: session.workspaceId,
      displayName: session.displayName,
      agentKind: session.agentKind,
      sshTarget: session.sshTarget,
      remoteCommand: buildTmuxAttachCommand(
        session.transportRef.tmuxSession,
        session.transportRef.tmuxPane,
        tmuxAdapter.getCaptureLines(),
      ),
      workingDirectory: session.workingDirectory,
      tmuxSessionName: session.transportRef.tmuxSession,
      tmuxPaneId: session.transportRef.tmuxPane,
    });
  }

  if (session.sshTarget && session.remoteCommand) {
    return ptyRuntimeManager.reconnectRemote(agentSessionId, {
      workspaceId: session.workspaceId,
      displayName: session.displayName,
      agentKind: session.agentKind,
      sshTarget: session.sshTarget,
      remoteCommand: session.remoteCommand,
      workingDirectory: session.workingDirectory,
      tmuxSessionName: session.transportRef?.tmuxSession,
      tmuxPaneId: session.transportRef?.tmuxPane,
    });
  }

  const command = session.transportRef?.tmuxSession
    ? buildTmuxAttachCommand(
        session.transportRef.tmuxSession,
        session.transportRef.tmuxPane,
        tmuxAdapter.getCaptureLines(),
      )
    : session.agentSessionId
      ? buildDirectLaunchCommand(
          session.agentKind,
          session.workingDirectory ?? "~",
          session.displayName,
          session.agentSessionId,
        )
      : buildDirectLaunchCommand(
          session.agentKind,
          session.workingDirectory ?? "~",
          session.displayName,
        );

  return ptyRuntimeManager.reconnectLocal(agentSessionId, {
    workspaceId: session.workspaceId,
    displayName: session.displayName,
    agentKind: session.agentKind,
    command,
    workingDirectory: session.workingDirectory,
    tmuxSessionName: session.transportRef?.tmuxSession,
    tmuxPaneId: session.transportRef?.tmuxPane,
  });
}

export async function registerAgentSessionRoutes(
  fastify: FastifyInstance,
  options: AgentSessionRoutesOptions,
): Promise<void> {
  const {
    registry,
    processRuntimeManager,
    tmuxAdapter,
    localTmuxInputRouter,
    sshRuntimeManager,
    ptyRuntimeManager,
    remoteLaunchPreflight,
    vsCodeWebManager,
    sftpService,
    codexTranscriptService = new CodexTranscriptService({
      remoteFileAccess: sftpService,
    }),
    codexSessionLocator = new CodexSessionLocator(),
    gitProjectSummaryService = new GitProjectSummaryService(),
    codexChangeService = new CodexChangeService(),
    gitChangesService = new GitChangesService(),
  } = options;
  const inputService =
    options.inputService ??
    new AgentSessionInputService({
      registry,
      tmuxAdapter,
      localTmuxInputRouter,
      sshRuntimeManager,
      ptyRuntimeManager,
      processRuntimeManager,
    });
  const taskSummaryCache = new Map<
    string,
    TimedCacheEntry<AgentTaskSummaryResponse>
  >();
  const taskSummaryInFlight = new Map<
    string,
    Promise<AgentTaskSummaryResponse>
  >();
  const gitSummaryCache = new Map<string, TimedCacheEntry<AgentGitSummary>>();
  const gitSummaryInFlight = new Map<string, Promise<AgentGitSummary>>();

  const resolveCodexSessionId = async (
    agentSession: AgentSessionRecord,
  ): Promise<string | undefined> =>
    resolveActiveCodexSessionId(agentSession, {
      registry,
      codexSessionLocator,
    });

  const resolveCodexWorkingDirectory = (
    agentSession: AgentSessionRecord,
    sessionId: string | undefined,
  ): string | undefined => {
    const hasTmuxSession = Boolean(agentSession.transportRef?.tmuxSession);
    return hasTmuxSession && !sessionId && !isRemoteAgentSession(agentSession)
      ? undefined
      : agentSession.workingDirectory;
  };

  fastify.get("/api/health", async () => ({ status: "ok" }));

  fastify.get("/api/agent-sessions", async () => registry.list());

  fastify.get<{ Params: { id: string } }>(
    "/api/agent-sessions/:id/git-summary",
    async (request): Promise<AgentGitSummary> => {
      const agentSession = registry.get(request.params.id);
      const isRemote =
        Boolean(agentSession.sshTarget) ||
        Boolean(agentSession.hostId && agentSession.hostId !== "local");
      if (isRemote) {
        return {
          available: false,
          projectName: agentSession.workingDirectory
            ?.split("/")
            .filter(Boolean)
            .at(-1),
          unavailableReason: "远端 Git 信息暂不可用",
          updatedAt: new Date().toISOString(),
        };
      }

      const cached = gitSummaryCache.get(agentSession.id);
      if (cached && cached.expiresAt > Date.now()) return cached.value;
      const pending = gitSummaryInFlight.get(agentSession.id);
      if (pending) return pending;

      const readPromise = (async () => {
        const summary = await gitProjectSummaryService.read(
          agentSession.workingDirectory,
        );
        const cachedSummaryChanged =
          summary.available &&
          (agentSession.projectName !== summary.projectName ||
            agentSession.repositoryRoot !== summary.repositoryRoot ||
            agentSession.gitBranch !== summary.branch ||
            agentSession.gitChangedFiles !== summary.changedFiles ||
            agentSession.gitAddedLines !== summary.addedLines ||
            agentSession.gitDeletedLines !== summary.deletedLines ||
            agentSession.gitIsWorktree !== summary.isWorktree);
        if (cachedSummaryChanged) {
          registry.updateSession(agentSession.id, {
            projectName: summary.projectName,
            repositoryRoot: summary.repositoryRoot,
            gitBranch: summary.branch,
            gitChangedFiles: summary.changedFiles,
            gitAddedLines: summary.addedLines,
            gitDeletedLines: summary.deletedLines,
            gitIsWorktree: summary.isWorktree,
            gitSummaryUpdatedAt: summary.updatedAt ?? undefined,
          });
        }
        gitSummaryCache.set(agentSession.id, {
          value: summary,
          expiresAt: Date.now() + GIT_SUMMARY_CACHE_TTL_MS,
        });
        return summary;
      })();
      gitSummaryInFlight.set(agentSession.id, readPromise);
      try {
        return await readPromise;
      } finally {
        gitSummaryInFlight.delete(agentSession.id);
      }
    },
  );

  fastify.post<{
    Params: { id: string };
    Body: RevertGitHunkInput;
  }>(
    "/api/agent-sessions/:id/git-changes/revert-hunk",
    async (
      request,
      reply,
    ): Promise<RevertGitHunkResponse | { error: string }> => {
      const agentSession = registry.get(request.params.id);
      const isRemote =
        Boolean(agentSession.sshTarget) ||
        Boolean(agentSession.hostId && agentSession.hostId !== "local");
      if (isRemote) {
        reply.code(400);
        return { error: "远端 Git 改动块暂不支持还原" };
      }

      const { path, hunkIndex, hunkHeader } = request.body ?? {};
      if (typeof path !== "string" || !path.trim()) {
        reply.code(400);
        return { error: "缺少要还原的文件路径" };
      }
      if (!Number.isInteger(hunkIndex) || hunkIndex < 0) {
        reply.code(400);
        return { error: "改动块序号无效" };
      }
      if (typeof hunkHeader !== "string" || !hunkHeader.trim()) {
        reply.code(400);
        return { error: "缺少改动块标识" };
      }

      try {
        return await gitChangesService.revertHunk(
          agentSession.workingDirectory,
          path,
          hunkIndex,
          hunkHeader,
        );
      } catch (error) {
        if (error instanceof GitHunkRevertError) {
          reply.code(error.statusCode);
          return { error: error.message };
        }
        throw error;
      }
    },
  );

  fastify.get<{ Params: { id: string } }>(
    "/api/agent-sessions/:id/git-changes",
    async (request): Promise<CheckoutDiffResponse> => {
      const agentSession = registry.get(request.params.id);
      const isRemote =
        Boolean(agentSession.sshTarget) ||
        Boolean(agentSession.hostId && agentSession.hostId !== "local");
      if (isRemote) {
        return {
          available: false,
          scope: "checkout",
          changedFiles: 0,
          addedLines: 0,
          deletedLines: 0,
          files: [],
          generatedAt: new Date().toISOString(),
          unavailableReason: "远端 Git Diff 暂不可用",
        };
      }
      return gitChangesService.read(agentSession.workingDirectory);
    },
  );

  fastify.get<{ Params: { id: string } }>(
    "/api/agent-sessions/:id/task-changes",
    async (request): Promise<AgentTaskDiffResponse> => {
      const agentSession = registry.get(request.params.id);
      if (!isLocalCodexSessionCandidate(agentSession)) {
        return {
          available: false,
          scope: "task",
          agentKind: "codex",
          sessionId: null,
          matchedBy: null,
          confidence: "unavailable",
          changedFiles: 0,
          addedLines: 0,
          deletedLines: 0,
          files: [],
          generatedAt: new Date().toISOString(),
          unavailableReason: "本次任务变更仅支持本机 Codex 会话",
        };
      }
      const sessionId = await resolveCodexSessionId(agentSession);
      return codexChangeService.read({
        sessionId,
        workingDirectory: resolveCodexWorkingDirectory(agentSession, sessionId),
      });
    },
  );

  fastify.get<{ Params: { id: string } }>(
    "/api/agent-sessions/:id/task-summary",
    async (request): Promise<AgentTaskSummaryResponse> => {
      const agentSession = registry.get(request.params.id);
      if (!isLocalCodexSessionCandidate(agentSession)) {
        return { available: false, updatedAt: null };
      }

      const sessionId = await resolveCodexSessionId(agentSession);
      const summaryCacheKey = `${agentSession.id}:${sessionId ?? "active-pane-unavailable"}`;

      const cached = taskSummaryCache.get(summaryCacheKey);
      if (cached && cached.expiresAt > Date.now()) return cached.value;
      const pending = taskSummaryInFlight.get(summaryCacheKey);
      if (pending) return pending;

      const readPromise = (async () => {
        const transcript = codexTranscriptService.read({
          sessionId,
          workingDirectory: resolveCodexWorkingDirectory(
            agentSession,
            sessionId,
          ),
        });
        if (!transcript.available) {
          return { available: false, updatedAt: transcript.updatedAt };
        }

        const summaries = summarizeCodexTranscript(transcript.entries);
        const summaryUpdatedAt =
          transcript.updatedAt ?? new Date().toISOString();
        const cachedSummaryChanged =
          agentSession.lastUserMessageSummary !==
            summaries.lastUserMessageSummary ||
          agentSession.lastAgentMessageSummary !==
            summaries.lastAgentMessageSummary ||
          agentSession.taskSummaryUpdatedAt !== summaryUpdatedAt;
        if (cachedSummaryChanged) {
          registry.updateSession(agentSession.id, {
            ...summaries,
            taskSummaryUpdatedAt: summaryUpdatedAt,
          });
        }

        return {
          available: true,
          ...summaries,
          updatedAt: summaryUpdatedAt,
        };
      })();
      taskSummaryInFlight.set(summaryCacheKey, readPromise);
      try {
        const summary = await readPromise;
        taskSummaryCache.set(summaryCacheKey, {
          value: summary,
          expiresAt: Date.now() + TASK_SUMMARY_CACHE_TTL_MS,
        });
        return summary;
      } finally {
        taskSummaryInFlight.delete(summaryCacheKey);
      }
    },
  );

  fastify.get<{
    Params: { id: string };
    Querystring: { cursor?: string; limit?: string };
  }>("/api/agent-sessions/:id/transcript", async (request) => {
    const agentSession = registry.get(request.params.id);
    if (
      !isCodexSessionCandidate(agentSession) &&
      !canProbeLocalTmuxForCodex(agentSession)
    ) {
      return {
        available: false,
        agentKind: "codex" as const,
        sessionId: null,
        matchedBy: null,
        updatedAt: null,
        entries: [],
        hasMore: false,
        nextCursor: null,
        message: "当前会话没有可读取的 Codex 记录。",
      };
    }

    const sessionId = await resolveCodexSessionId(agentSession);
    const requestedLimit = Number(request.query.limit);
    if (isRemoteAgentSession(agentSession)) {
      if (!agentSession.sshTarget || !codexTranscriptService.readRemote) {
        return {
          available: false,
          agentKind: "codex" as const,
          sessionId: null,
          matchedBy: null,
          updatedAt: null,
          entries: [],
          hasMore: false,
          nextCursor: null,
          message: "当前远端会话没有可用的 Codex 历史读取通道。",
        };
      }

      return codexTranscriptService.readRemote({
        sshTarget: agentSession.sshTarget,
        ...(sessionId ? { sessionId } : {}),
        ...(resolveCodexWorkingDirectory(agentSession, sessionId)
          ? {
              workingDirectory: resolveCodexWorkingDirectory(
                agentSession,
                sessionId,
              ),
            }
          : {}),
        ...(request.query.cursor ? { cursor: request.query.cursor } : {}),
        ...(Number.isSafeInteger(requestedLimit)
          ? { limit: requestedLimit }
          : {}),
      });
    }

    return codexTranscriptService.read({
      sessionId,
      workingDirectory: resolveCodexWorkingDirectory(agentSession, sessionId),
      ...(request.query.cursor ? { cursor: request.query.cursor } : {}),
      ...(Number.isSafeInteger(requestedLimit)
        ? { limit: requestedLimit }
        : {}),
    });
  });

  fastify.get<{ Params: { id: string } }>(
    "/api/agent-sessions/:id",
    async (request) => {
      const agentSession = registry.get(request.params.id);

      if (agentSession.sourceType === "remote-tmux-discovered") {
        return tmuxAdapter.getDetail(agentSession);
      }

      return registry.getDetail(request.params.id);
    },
  );

  fastify.post<{ Body: RegisterAgentSessionInput }>(
    "/api/agent-sessions/register",
    async (request, reply) => {
      const agentSession = registry.register(request.body);
      reply.code(201);
      return agentSession;
    },
  );

  fastify.post<{ Body: FocusAgentSessionInput }>(
    "/api/agent-sessions/focus",
    async (request, reply) => {
      registry.focus(request.body);
      reply.code(204);
    },
  );

  fastify.patch<{ Params: { id: string }; Body: UpdateAgentSessionInput }>(
    "/api/agent-sessions/:id",
    async (request, reply) => {
      const { displayName, hidden, hasUnreadCompletion } = request.body ?? {};
      let agentSession = registry.get(request.params.id);
      const updates: Partial<AgentSessionRecord> = {};

      if (displayName !== undefined) {
        const trimmed = displayName.trim();
        if (!trimmed) {
          reply.code(400);
          return { error: "displayName cannot be empty" };
        }

        if (agentSession.transportRef?.tmuxSession) {
          agentSession = await tmuxAdapter.renameSession(agentSession, trimmed);
        } else {
          updates.displayName = trimmed;
        }
      }

      if (hidden !== undefined) {
        updates.hidden = Boolean(hidden);
      }

      if (hasUnreadCompletion !== undefined) {
        if (
          hasUnreadCompletion &&
          (agentSession.interactionState === "running" ||
            agentSession.interactionState === "awaiting_input")
        ) {
          reply.code(409);
          return {
            error: "Only completed or ready sessions can be marked unread",
          };
        }
        updates.hasUnreadCompletion = Boolean(hasUnreadCompletion);
      }

      if (Object.keys(updates).length === 0) {
        return agentSession;
      }

      return registry.updateSession(agentSession.id, updates);
    },
  );

  fastify.post<{ Body: LaunchLocalAgentInput }>(
    "/api/agent-launch/local",
    async (request, reply) => {
      const agentSession = processRuntimeManager.launch(request.body);
      reply.code(201);
      return agentSession;
    },
  );

  fastify.post<{ Body: LaunchRemoteAgentInput }>(
    "/api/agent-launch/remote",
    async (request, reply) => {
      const agentSession = sshRuntimeManager.launch(request.body);
      reply.code(201);
      return agentSession;
    },
  );

  fastify.post<{ Body: LaunchLocalAgentInput }>(
    "/api/agent-launch/pty",
    async (request, reply) => {
      const agentSession = ptyRuntimeManager.launch(request.body);
      reply.code(201);
      return agentSession;
    },
  );

  fastify.post<{ Body: LaunchSshPtyInput }>(
    "/api/agent-launch/ssh-pty",
    async (request, reply) => {
      try {
        assertValidSshTarget(request.body?.sshTarget);
        await remoteLaunchPreflight.check(request.body);
        const agentSession = ptyRuntimeManager.launchRemote(request.body);
        reply.code(201);
        return agentSession;
      } catch (error) {
        if (error instanceof InvalidSshTargetError) {
          reply.code(400);
          return {
            error: "SSH 连接参数无效",
            code: "INVALID_SSH_TARGET",
          };
        }

        if (error instanceof RemoteLaunchPreflightError) {
          reply.code(error.httpStatus);
          return { error: error.message, code: error.code };
        }

        throw error;
      }
    },
  );

  fastify.post<{ Params: { id: string }; Body: PtyResizeInput }>(
    "/api/agent-sessions/:id/resize",
    async (request) => {
      ptyRuntimeManager.resize(
        request.params.id,
        request.body.cols,
        request.body.rows,
      );

      return { ok: true };
    },
  );

  fastify.post<{ Body: DiscoverTmuxInput }>(
    "/api/agent-discovery/tmux/scan",
    async (request) => {
      const { sshTarget } = request.body ?? {};
      if (sshTarget) {
        return tmuxAdapter.discoverRemote(sshTarget);
      }
      return tmuxAdapter.discover();
    },
  );

  fastify.post<{ Body: AddDiscoveredTmuxInput }>(
    "/api/agent-discovery/tmux/add",
    async (request, reply) => {
      const {
        tmuxSession,
        tmuxPane,
        workingDirectory,
        agentKind,
        interactionState,
        outputPreview,
        sshTarget,
      } = request.body;

      const hostId = sshTarget?.host ?? "local";
      const runtimeId = sshTarget
        ? `tmux:${hostId}:${tmuxSession}`
        : `tmux:${tmuxSession}`;
      const canonicalDisplayName = canonicalTmuxDisplayName(tmuxSession);

      if (interactionState === "running") {
        const existingSession = registry.findByRuntimeId(runtimeId);

        if (existingSession && ptyRuntimeManager.has(existingSession.id)) {
          reply.code(201);
          return existingSession;
        }

        if (existingSession) {
          registry.remove(existingSession.id);
        }

        const attachedSession = sshTarget
          ? ptyRuntimeManager.launchRemote({
              workspaceId: tmuxSession,
              displayName: canonicalDisplayName,
              agentKind,
              sshTarget,
              remoteCommand: buildInteractiveShellCommand(
                buildTmuxAttachCommand(
                  tmuxSession,
                  tmuxPane,
                  tmuxAdapter.getCaptureLines(),
                ),
              ),
              workingDirectory,
              tmuxSessionName: tmuxSession,
              tmuxPaneId: tmuxPane,
            })
          : ptyRuntimeManager.launch({
              workspaceId: tmuxSession,
              hostId,
              displayName: canonicalDisplayName,
              agentKind,
              command: buildTmuxAttachCommand(
                tmuxSession,
                tmuxPane,
                tmuxAdapter.getCaptureLines(),
              ),
              workingDirectory,
              tmuxSessionName: tmuxSession,
              tmuxPaneId: tmuxPane,
            });

        reply.code(201);
        return attachedSession;
      }

      const agentSession = registry.upsertByTransportRef(runtimeId, {
        workspaceId: tmuxSession,
        hostId,
        sourceType: "remote-tmux-discovered",
        agentKind,
        displayName: canonicalDisplayName,
        workingDirectory,
        connectionState: "online",
        interactionState: interactionState ?? "detached",
        stateConfidence: "medium",
        outputPreview,
        controlMode: "observe",
        transportRef: {
          tmuxSession,
          ...(tmuxPane ? { tmuxPane } : {}),
          runtimeId,
          ...(sshTarget && {
            sshHost: sshTarget.host,
            sshPort: sshTarget.port,
            sshUsername: sshTarget.username,
          }),
        },
        ...(sshTarget && { sshTarget }),
      });

      reply.code(201);
      return agentSession;
    },
  );

  fastify.post<{ Params: { id: string } }>(
    "/api/agent-sessions/:id/tmux/kill",
    async (request, reply) => {
      const { id } = request.params;
      const session = registry.get(id);
      const tmuxSessionName = session.transportRef?.tmuxSession;
      if (!tmuxSessionName) {
        reply.code(400);
        return { error: "Session has no tmux session reference" };
      }
      await clearLocalTmuxInputState(id, localTmuxInputRouter);
      ptyRuntimeManager.kill(id);
      await tmuxAdapter.killSession(tmuxSessionName, session.sshTarget);
      registry.remove(id);
      reply.code(204);
    },
  );

  fastify.post<{ Params: { id: string } }>(
    "/api/agent-sessions/:id/tmux/takeover",
    async (request) => {
      const agentSession = registry.get(request.params.id);
      return tmuxAdapter.takeOver(agentSession);
    },
  );

  fastify.post<{ Params: { id: string } }>(
    "/api/agent-sessions/:id/tmux/release",
    async (request) => {
      const agentSession = registry.get(request.params.id);
      return tmuxAdapter.release(agentSession);
    },
  );

  fastify.post<{ Params: { id: string } }>(
    "/api/agent-sessions/:id/tmux/refresh",
    async (request) => {
      const agentSession = registry.get(request.params.id);
      return tmuxAdapter.refresh(agentSession);
    },
  );

  fastify.post<{ Params: { id: string }; Body: StdinAgentSessionInput }>(
    "/api/agent-sessions/:id/stdin",
    async (request) =>
      inputService.write(request.params.id, request.body.input),
  );

  fastify.post<{ Body: ScanDirectoryInput }>(
    "/api/agent-discovery/scan",
    async (request) => scanAgentDirectory(request.body),
  );

  fastify.post<{ Params: { id: string } }>(
    "/api/agent-sessions/:id/vscode-web",
    async (
      request,
      reply,
    ): Promise<OpenVsCodeWebResponse | { error: string }> => {
      const session = registry.get(request.params.id);
      const { requestHost, requestProtocol } =
        resolveVsCodeWebRequestTarget(request);

      try {
        return await vsCodeWebManager.ensureSession(session, {
          requestHost,
          requestProtocol,
        });
      } catch (error) {
        if (error instanceof UnsupportedVsCodeWebSessionError) {
          reply.code(400);
          return { error: error.message };
        }

        if (error instanceof VsCodeWebUnavailableError) {
          reply.code(503);
          return { error: error.message };
        }

        throw error;
      }
    },
  );

  fastify.delete<{ Params: { id: string } }>(
    "/api/agent-sessions/:id",
    async (request, reply) => {
      const { id } = request.params;
      const session = registry.get(id);

      await vsCodeWebManager.stopSession(id);

      if (
        session.sourceType === "remote-tmux-discovered" &&
        session.controlMode === "control"
      ) {
        await tmuxAdapter.release(session);
      }

      await clearLocalTmuxInputState(id, localTmuxInputRouter);
      ptyRuntimeManager.kill(id);
      registry.remove(id);
      reply.code(204);
    },
  );

  fastify.post<{ Params: { id: string } }>(
    "/api/agent-sessions/:id/reconnect",
    async (request) =>
      reconnectRegisteredAgentSession(request.params.id, {
        registry,
        tmuxAdapter,
        localTmuxInputRouter,
        ptyRuntimeManager,
      }),
  );
}
