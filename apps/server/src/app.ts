import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import Fastify from "fastify";

import type { TerminalHistoryDiagnosticsResponse } from "@agent-orchestrator/shared";

import {
  resolveTerminalHistoryRuntimeConfig,
  type TerminalHistoryRuntimeConfig,
} from "./config/server-runtime-config.js";
import {
  reconnectRegisteredAgentSession,
  registerAgentSessionRoutes,
} from "./routes/agent-sessions.js";
import {
  registerAppUpdateRoutes,
  type AppVersionServiceLike,
  type GitAutoUpdateServiceLike,
  type ManagedSessionRestorerLike,
} from "./routes/app-update.js";
import { registerFilesystemRoutes } from "./routes/filesystem.js";
import { registerSshHostsRoutes } from "./routes/ssh-hosts.js";
import { registerVsCodeWebProxyRoutes } from "./routes/vscode-web-proxy.js";
import { AgentSessionRegistry } from "./services/agent-session-registry.js";
import { createAgentSessionStreamEvent } from "./services/agent-session-stream.js";
import { AppVersionService } from "./services/app-version-service.js";
import { GitAutoUpdateService } from "./services/git-auto-update-service.js";
import { LocalFsService } from "./services/local-fs-service.js";
import { LocalProcessRuntimeManager } from "./services/local-process-runtime-manager.js";
import { LocalTmuxAdapter } from "./services/local-tmux-adapter.js";
import { LocalTmuxInputRouter } from "./services/local-tmux-input-router.js";
import {
  createSingleFlightManagedSessionRestorer,
  restoreManagedSessions,
} from "./services/managed-session-restorer.js";
import { PtyRuntimeManager } from "./services/pty-runtime-manager.js";
import {
  RemoteLaunchPreflight,
  type RemoteLaunchPreflightLike,
} from "./services/remote-launch-preflight.js";
import { SftpService } from "./services/sftp-service.js";
import { SshRuntimeManager } from "./services/ssh-runtime-manager.js";
import type { SessionStateStore } from "./services/session-state-store.js";
import {
  isTerminalFocusPayload,
  isTerminalMouseMotionPayload,
  isTerminalPtyControlPayload,
  sanitizeReplayForTerminal,
  stripTerminalResponsePayload,
} from "./services/terminal-control-filter.js";
import {
  resolveTerminalReplayByteLimit,
  takeUtf8Tail,
} from "./services/terminal-replay-window.js";
import { VsCodeWebManager } from "./services/vscode-web-manager.js";

interface BuildServerOptions {
  localFsService?: LocalFsService;
  sftpService?: SftpService;
  terminalHistoryConfig?: TerminalHistoryRuntimeConfig;
  vsCodeWebManager?: VsCodeWebManager;
  remoteLaunchPreflight?: RemoteLaunchPreflightLike;
  appVersionService?: AppVersionServiceLike;
  gitAutoUpdateService?: GitAutoUpdateServiceLike;
  managedSessionRestorer?: ManagedSessionRestorerLike;
  sessionStateStore?: SessionStateStore;
}

interface LocalTmuxSocketInputStateDependencies {
  localTmuxInputRouter: Pick<LocalTmuxInputRouter, "clear">;
}

export function createLocalTmuxSocketInputState(
  agentSessionId: string,
  dependencies: LocalTmuxSocketInputStateDependencies,
): {
  markInputSent(): void;
  clearOnClose(): void;
} {
  let sentLocalTmuxInput = false;

  return {
    markInputSent() {
      sentLocalTmuxInput = true;
    },
    clearOnClose() {
      if (!sentLocalTmuxInput) {
        return;
      }

      sentLocalTmuxInput = false;
      void dependencies.localTmuxInputRouter
        .clear(agentSessionId)
        .catch(() => {});
    },
  };
}

export function buildServer(): {
  app: ReturnType<typeof Fastify>;
  registry: AgentSessionRegistry;
};
export function buildServer(options: BuildServerOptions): {
  app: ReturnType<typeof Fastify>;
  registry: AgentSessionRegistry;
};
export function buildServer(options: BuildServerOptions = {}): {
  app: ReturnType<typeof Fastify>;
  registry: AgentSessionRegistry;
} {
  const app = Fastify({ logger: true });
  const terminalHistoryConfig =
    options.terminalHistoryConfig ??
    resolveTerminalHistoryRuntimeConfig(process.env);
  const registry = new AgentSessionRegistry(
    undefined,
    terminalHistoryConfig.terminalRegistryOutputEntries,
  );
  const restoredSnapshot = options.sessionStateStore?.load();
  if (restoredSnapshot) {
    registry.restore(restoredSnapshot);
  }
  const processRuntimeManager = new LocalProcessRuntimeManager(registry);
  const tmuxAdapter = new LocalTmuxAdapter(registry, {
    captureLines: terminalHistoryConfig.terminalTmuxCaptureLines,
  });
  const sshRuntimeManager = new SshRuntimeManager(registry);
  const ptyRuntimeManager = new PtyRuntimeManager(registry, {
    maxScrollbackBytes: terminalHistoryConfig.terminalScrollbackBytes,
    tmuxCaptureLines: terminalHistoryConfig.terminalTmuxCaptureLines,
  });
  const localTmuxInputRouter = new LocalTmuxInputRouter({
    registry,
    tmuxAdapter,
    ptyRuntimeManager,
  });
  const localFsService = options.localFsService ?? new LocalFsService();
  const sftpService = options.sftpService ?? new SftpService();
  const vsCodeWebManager = options.vsCodeWebManager ?? new VsCodeWebManager();
  const remoteLaunchPreflight =
    options.remoteLaunchPreflight ?? new RemoteLaunchPreflight();
  const appVersionService =
    options.appVersionService ??
    new AppVersionService({
      sourceRoot: process.cwd(),
    });
  const gitAutoUpdateService =
    options.gitAutoUpdateService ??
    new GitAutoUpdateService({
      sourceRoot: process.cwd(),
      intervalMinutes: null,
    });
  const managedSessionRestorer =
    options.managedSessionRestorer ??
    createManagedSessionRestorer({
      registry,
      tmuxAdapter,
      localTmuxInputRouter,
      ptyRuntimeManager,
    });

  const stopSessionStatePersistence = options.sessionStateStore
    ? registry.subscribe((snapshot) => {
        try {
          options.sessionStateStore?.save(snapshot);
        } catch (error) {
          app.log.error(
            { err: error },
            "Failed to persist agent session state",
          );
        }
      })
    : null;
  if (stopSessionStatePersistence) {
    app.addHook("onClose", async () => {
      stopSessionStatePersistence();
    });
  }

  app.register(cors, {
    origin: true,
  });

  app.register(websocket);

  app.register(async (instance) => {
    await registerAgentSessionRoutes(instance, {
      registry,
      processRuntimeManager,
      tmuxAdapter,
      localTmuxInputRouter,
      sshRuntimeManager,
      ptyRuntimeManager,
      remoteLaunchPreflight,
      vsCodeWebManager,
      sftpService,
    });
    await registerAppUpdateRoutes(instance, {
      appVersionService,
      gitAutoUpdateService,
      managedSessionRestorer,
    });

    await registerSshHostsRoutes(instance);
    await registerFilesystemRoutes(instance, {
      localFsService,
      sftpService,
    });
    await registerVsCodeWebProxyRoutes(instance, {
      vsCodeWebManager,
    });

    instance.get("/api/diagnostics/terminal-history", async () => {
      const response: TerminalHistoryDiagnosticsResponse = {
        timestamp: new Date().toISOString(),
        pty: ptyRuntimeManager.getScrollbackDiagnostics(),
        registry: {
          maxOutputEntries: registry.getOutputEntryLimit(),
        },
        tmux: {
          captureLines: tmuxAdapter.getCaptureLines(),
        },
      };

      return response;
    });

    instance.get("/ws/agent-sessions", { websocket: true }, (socket) => {
      let previousSnapshot: ReturnType<AgentSessionRegistry["list"]> | null =
        null;
      const unsubscribe = registry.subscribe((snapshot) => {
        const event = createAgentSessionStreamEvent(previousSnapshot, snapshot);
        previousSnapshot = snapshot;
        socket.send(JSON.stringify(event));
      });

      socket.on("close", () => {
        unsubscribe();
      });
    });

    instance.get<{
      Params: { id: string };
      Querystring: { replayBytes?: string };
    }>(
      "/ws/agent-sessions/:id/terminal",
      { websocket: true },
      (socket, request) => {
        const { id } = request.params;
        const replayByteLimit = resolveTerminalReplayByteLimit(
          request.query.replayBytes,
          terminalHistoryConfig.terminalScrollbackBytes,
        );
        const localTmuxSocketInputState = createLocalTmuxSocketInputState(id, {
          localTmuxInputRouter,
        });

        const buildTerminalControlFrame = (
          event: "replay" | "replay-complete",
          data?: string,
        ) =>
          JSON.stringify({
            __agentOrchestrator: "terminal-control",
            event,
            data,
          });

        let replaying = true;
        const bufferedLiveFrames: string[] = [];
        let unsubscribe = () => {};
        if (ptyRuntimeManager.has(id)) {
          unsubscribe = ptyRuntimeManager.subscribe(
            id,
            (data) => {
              if (replaying) {
                bufferedLiveFrames.push(data);
                return;
              }

              socket.send(data);
            },
            { replay: false },
          );

          const replay = takeUtf8Tail(
            sanitizeReplayForTerminal(ptyRuntimeManager.getScrollback(id)),
            replayByteLimit,
          );
          if (replay) {
            socket.send(buildTerminalControlFrame("replay", replay));
          }
        } else if (registry.has(id)) {
          const replay = takeUtf8Tail(
            sanitizeReplayForTerminal(
              registry
                .getDetail(id)
                .outputEntries.map((entry) => entry.text)
                .join(""),
            ),
            replayByteLimit,
          );
          if (replay) {
            socket.send(buildTerminalControlFrame("replay", replay));
          }
        } else {
          socket.close(4004, "没有找到 PTY 会话");
          return;
        }
        socket.send(buildTerminalControlFrame("replay-complete"));
        replaying = false;

        for (const frame of bufferedLiveFrames) {
          socket.send(frame);
        }
        bufferedLiveFrames.length = 0;

        socket.on("message", (message: Buffer | string) => {
          const writeToRuntime = (payload: string) => {
            const sanitizedPayload = stripTerminalResponsePayload(payload);
            if (!sanitizedPayload) {
              return;
            }

            const session = registry.has(id) ? registry.get(id) : null;
            if (session?.transportRef?.tmuxSession && !session.sshTarget) {
              if (isTerminalFocusPayload(sanitizedPayload)) {
                return;
              }

              if (isTerminalMouseMotionPayload(sanitizedPayload)) {
                return;
              }

              if (isTerminalPtyControlPayload(sanitizedPayload)) {
                localTmuxSocketInputState.markInputSent();
                void localTmuxInputRouter
                  .write(
                    session,
                    { input: sanitizedPayload },
                    { forcePty: true },
                  )
                  .catch(() => {});
                return;
              }

              localTmuxSocketInputState.markInputSent();
              void localTmuxInputRouter
                .write(session, { input: sanitizedPayload })
                .catch(() => {});
              return;
            }

            void ptyRuntimeManager.write(id, sanitizedPayload).catch(() => {
              // The browser can still flush a final input frame after the
              // PTY has exited or the session has been deleted.
            });
          };

          const text =
            typeof message === "string" ? message : message.toString("utf8");

          if (text.startsWith('{"type":"resize"')) {
            try {
              const parsed = JSON.parse(text) as {
                type: string;
                cols: number;
                rows: number;
              };

              ptyRuntimeManager.resize(id, parsed.cols, parsed.rows);
            } catch {
              /* ignore malformed resize */
            }

            return;
          }

          if (text.startsWith('{"type":"binary"')) {
            try {
              const parsed = JSON.parse(text) as {
                type: string;
                data: string;
              };

              const payload = Buffer.from(parsed.data, "base64").toString(
                "latin1",
              );
              writeToRuntime(payload);
            } catch {
              /* ignore malformed binary frame */
            }

            return;
          }

          writeToRuntime(text);
        });

        socket.on("close", () => {
          unsubscribe();
          localTmuxSocketInputState.clearOnClose();
        });
      },
    );
  });

  app.addHook("onClose", () => {
    ptyRuntimeManager.dispose();
  });
  app.addHook("onClose", () => {
    return vsCodeWebManager.dispose();
  });
  app.addHook("onReady", () => {
    gitAutoUpdateService.start();
  });
  app.addHook("onClose", () => {
    gitAutoUpdateService.stop();
  });

  return { app, registry };
}

function createManagedSessionRestorer({
  registry,
  tmuxAdapter,
  localTmuxInputRouter,
  ptyRuntimeManager,
}: {
  registry: AgentSessionRegistry;
  tmuxAdapter: LocalTmuxAdapter;
  localTmuxInputRouter: LocalTmuxInputRouter;
  ptyRuntimeManager: PtyRuntimeManager;
}): ManagedSessionRestorerLike {
  return createSingleFlightManagedSessionRestorer(async () => {
    let localDiscovery: ReturnType<LocalTmuxAdapter["discover"]> | undefined;
    const remoteDiscoveries = new Map<
      string,
      ReturnType<LocalTmuxAdapter["discoverRemote"]>
    >();

    return restoreManagedSessions({
      sessions: registry.list().items,
      isConnected: (agentSessionId) => ptyRuntimeManager.has(agentSessionId),
      resolveTmuxTarget: async (session) => {
        const tmuxSession = session.transportRef?.tmuxSession;
        if (!tmuxSession) {
          return null;
        }

        const discovery = session.sshTarget
          ? (() => {
              const key = JSON.stringify(session.sshTarget);
              const existing = remoteDiscoveries.get(key);
              if (existing) {
                return existing;
              }
              const created = tmuxAdapter.discoverRemote(session.sshTarget);
              remoteDiscoveries.set(key, created);
              return created;
            })()
          : (localDiscovery ??= tmuxAdapter.discover());
        const result = await discovery;
        const matched = result.items.find(
          (item) => item.transportRef?.tmuxSession === tmuxSession,
        );
        if (!matched) {
          return null;
        }

        return {
          tmuxSession,
          tmuxPane: matched.transportRef?.tmuxPane,
        };
      },
      clearInputState: (agentSessionId) =>
        localTmuxInputRouter.clear(agentSessionId),
      reconnect: async (session, target) => {
        registry.updateSession(session.id, {
          transportRef: {
            tmuxSession: target.tmuxSession,
            tmuxPane: target.tmuxPane,
          },
        });
        await reconnectRegisteredAgentSession(
          session.id,
          {
            registry,
            tmuxAdapter,
            localTmuxInputRouter,
            ptyRuntimeManager,
          },
          {
            inputStateAlreadyCleared: true,
          },
        );
      },
    });
  });
}
