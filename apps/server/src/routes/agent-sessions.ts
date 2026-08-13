import type { FastifyInstance } from "fastify";

import type {
  AgentSessionRecord,
  OpenVsCodeWebResponse,
  LaunchRemoteAgentInput,
  LaunchLocalAgentInput,
  LaunchSshPtyInput,
  FocusAgentSessionInput,
  PtyResizeInput,
  RegisterAgentSessionInput,
  ScanDirectoryInput,
  StdinAgentSessionInput,
  UpdateAgentSessionInput,
  DiscoverTmuxInput,
  AddDiscoveredTmuxInput,
} from "@agent-orchestrator/shared";
import { shellQuote, formatWorkingDirectory } from "@agent-orchestrator/shared";

import { scanAgentDirectory } from "../services/agent-scanner.js";
import { AgentSessionRegistry } from "../services/agent-session-registry.js";
import { CodexTranscriptService } from "../services/codex-transcript-service.js";
import { LocalProcessRuntimeManager } from "../services/local-process-runtime-manager.js";
import { LocalTmuxAdapter } from "../services/local-tmux-adapter.js";
import { LocalTmuxInputRouter } from "../services/local-tmux-input-router.js";
import { PtyRuntimeManager } from "../services/pty-runtime-manager.js";
import {
  RemoteLaunchPreflightError,
  type RemoteLaunchPreflightLike,
} from "../services/remote-launch-preflight.js";
import { DEFAULT_TERMINAL_TMUX_CAPTURE_LINES } from "../config/server-runtime-config.js";
import {
  buildInteractiveShellCommand,
  buildTmuxCommand,
  quoteForPosixShell,
} from "../services/runtime-compat.js";
import { SshRuntimeManager } from "../services/ssh-runtime-manager.js";
import { canonicalTmuxDisplayName } from "../services/tmux-display-name.js";
import {
  isTerminalFocusPayload,
  isTerminalPtyControlPayload,
  stripTerminalResponsePayload,
} from "../services/terminal-control-filter.js";
import {
  UnsupportedVsCodeWebSessionError,
  VsCodeWebManager,
  VsCodeWebUnavailableError,
} from "../services/vscode-web-manager.js";
import { resolveVsCodeWebRequestTarget } from "./vscode-web-request-target.js";

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

function buildTmuxLaunchCommand(
  agentKind: string,
  workingDirectory: string,
  displayName: string,
  tmuxSessionName: string,
  sessionId?: string,
  tmuxHistoryLimit = DEFAULT_TERMINAL_TMUX_CAPTURE_LINES,
): string {
  const tmuxPrefix = `tmux set-option -g history-limit ${tmuxHistoryLimit} \\; new-session`;

  if (agentKind === "shell") {
    return `${tmuxPrefix} -s ${shellQuote(tmuxSessionName)} -c ${formatWorkingDirectory(workingDirectory)}`;
  }

  return `${tmuxPrefix} -s ${shellQuote(tmuxSessionName)} ${buildTmuxCommand(buildDirectLaunchCommand(agentKind, workingDirectory, displayName, sessionId), true)}`;
}

function buildTmuxAttachCommand(
  tmuxSessionName: string,
  tmuxPaneId?: string,
  tmuxHistoryLimit = DEFAULT_TERMINAL_TMUX_CAPTURE_LINES,
): string {
  const tmuxPrefix = `tmux set-option -t ${shellQuote(tmuxSessionName)} history-limit ${tmuxHistoryLimit}`;

  if (tmuxPaneId) {
    return `${tmuxPrefix} \\; select-pane -t ${shellQuote(tmuxPaneId)} \\; attach -t ${shellQuote(tmuxSessionName)}`;
  }

  return `${tmuxPrefix} \\; attach -t ${shellQuote(tmuxSessionName)}`;
}

interface AgentSessionRoutesOptions {
  registry: AgentSessionRegistry;
  processRuntimeManager: LocalProcessRuntimeManager;
  tmuxAdapter: LocalTmuxAdapter;
  localTmuxInputRouter: LocalTmuxInputRouter;
  sshRuntimeManager: SshRuntimeManager;
  ptyRuntimeManager: PtyRuntimeManager;
  remoteLaunchPreflight: RemoteLaunchPreflightLike;
  vsCodeWebManager: VsCodeWebManager;
  codexTranscriptService?: Pick<CodexTranscriptService, "read">;
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
    codexTranscriptService = new CodexTranscriptService(),
  } = options;

  fastify.get("/api/health", async () => ({ status: "ok" }));

  fastify.get("/api/agent-sessions", async () => registry.list());

  fastify.get<{ Params: { id: string } }>(
    "/api/agent-sessions/:id/transcript",
    async (request) => {
      const agentSession = registry.get(request.params.id);
      if (
        agentSession.sshTarget ||
        (agentSession.hostId && agentSession.hostId !== "local")
      ) {
        return {
          available: false,
          agentKind: "codex" as const,
          sessionId: null,
          matchedBy: null,
          updatedAt: null,
          entries: [],
          message: "首版完整记录仅支持本机会话。",
        };
      }

      return codexTranscriptService.read({
        sessionId: agentSession.agentSessionId,
        workingDirectory: agentSession.workingDirectory,
      });
    },
  );

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
    async (request) => registry.focus(request.body),
  );

  fastify.patch<{ Params: { id: string }; Body: UpdateAgentSessionInput }>(
    "/api/agent-sessions/:id",
    async (request, reply) => {
      const { displayName, hidden } = request.body ?? {};
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
        await remoteLaunchPreflight.check(request.body);
        const agentSession = ptyRuntimeManager.launchRemote(request.body);
        reply.code(201);
        return agentSession;
      } catch (error) {
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
    async (request) => {
      const agentSession = registry.get(request.params.id);
      const sanitizedInput = stripTerminalResponsePayload(request.body.input);
      if (!sanitizedInput) {
        return agentSession;
      }

      const sanitizedBody = { input: sanitizedInput };

      if (agentSession.sourceType === "remote-tmux-discovered") {
        return tmuxAdapter.writeInput(agentSession, sanitizedBody);
      }

      if (
        agentSession.sourceType === "remote-connect" &&
        agentSession.transportRef?.runtimeId?.startsWith("ssh:")
      ) {
        return sshRuntimeManager.writeInput(request.params.id, sanitizedBody);
      }

      if (agentSession.transportRef?.tmuxSession && !agentSession.sshTarget) {
        if (isTerminalFocusPayload(sanitizedInput)) {
          return agentSession;
        }

        if (isTerminalPtyControlPayload(sanitizedInput)) {
          return localTmuxInputRouter.write(agentSession, sanitizedBody, {
            forcePty: true,
          });
        }

        return localTmuxInputRouter.write(agentSession, sanitizedBody);
      }

      if (ptyRuntimeManager.has(request.params.id)) {
        ptyRuntimeManager.write(request.params.id, sanitizedInput);
        return registry.get(request.params.id);
      }

      return processRuntimeManager.writeInput(request.params.id, sanitizedBody);
    },
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
