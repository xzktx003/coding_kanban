import * as pty from "node-pty";
import { execFile, execFileSync } from "node:child_process";
import { devNull } from "node:os";
import { delimiter, dirname, normalize } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";

import type {
  AgentSessionRecord,
  LaunchLocalAgentInput,
  LaunchSshPtyInput,
} from "@agent-orchestrator/shared";

import { AgentSessionRegistry } from "./agent-session-registry.js";
import {
  DEFAULT_TERMINAL_SCROLLBACK_BYTES,
  DEFAULT_TERMINAL_TMUX_CAPTURE_LINES,
} from "../config/server-runtime-config.js";
import { resolveCopilotBinary } from "./copilot-binary.js";
import { resolveLocalWorkingDirectory } from "./resolve-local-working-directory.js";
import {
  quoteForPosixShell,
  resolvePreferredShell,
  resolveTmuxBinary,
} from "./runtime-compat.js";
import { buildSshArgs, formatSshDestination } from "./ssh-command.js";
import {
  getTerminalProtocolQueryResponseKinds,
  getTerminalProtocolResponses,
  isTerminalProtocolResponsePayload,
  sanitizeReplayForTerminal,
  type TerminalProtocolResponseKind,
} from "./terminal-control-filter.js";
import { normalizeTmuxSessionName } from "./tmux-display-name.js";

type PtyDataListener = (data: string) => void;
const execFileAsync = promisify(execFile);
const TMUX_CLIENT_READY_TIMEOUT_MS = 1_000;
const TMUX_CLIENT_READY_POLL_MS = 20;
const TERMINAL_PROTOCOL_REPLY_TIMEOUT_MS = 250;

export interface PtyRuntimeManagerOptions {
  maxScrollbackBytes?: number;
  tmuxCaptureLines?: number;
}

export interface PtyScrollbackDiagnostics {
  activeSessions: number;
  maxScrollbackBytes: number;
  totalScrollbackBytes: number;
  totalDroppedScrollbackBytes: number;
  totalDroppedScrollbackChunks: number;
  truncatedSessionCount: number;
  sessions: Array<{
    agentSessionId: string;
    scrollbackBytes: number;
    scrollbackChunks: number;
    droppedScrollbackBytes: number;
    droppedScrollbackChunks: number;
  }>;
}

export interface PtyScrollbackState {
  scrollback: string[];
  scrollbackBytes: number;
  droppedScrollbackBytes: number;
  droppedScrollbackChunks: number;
}

interface PtyHandle extends PtyScrollbackState {
  ptyProcess: pty.IPty;
  dataListeners: Set<PtyDataListener>;
  localTmuxClientReady: boolean;
  localTmuxClientReadyWait?: Promise<boolean>;
  localTmuxSessionName?: string;
  stripAlternateScreen: boolean;
  terminalProtocolQueryRemainder: string;
}

interface PendingTerminalProtocolReplies {
  completion: Promise<void>;
  expectedKinds: TerminalProtocolResponseKind[];
  resolve: () => void;
  timeout: ReturnType<typeof setTimeout>;
}

export interface PtyRuntimeWriteOptions {
  terminalProtocolResponse?: boolean;
}

export function appendPtyScrollback(
  state: PtyScrollbackState,
  data: string,
  maxScrollbackBytes: number,
): void {
  state.scrollback.push(data);
  state.scrollbackBytes += Buffer.byteLength(data, "utf8");

  while (
    state.scrollbackBytes > maxScrollbackBytes &&
    state.scrollback.length > 1
  ) {
    const removed = state.scrollback.shift()!;
    const removedBytes = Buffer.byteLength(removed, "utf8");
    state.scrollbackBytes -= removedBytes;
    state.droppedScrollbackBytes += removedBytes;
    state.droppedScrollbackChunks += 1;
  }
}

export function buildRemoteTmuxCaptureCommand(
  tmuxSessionName: string,
  tmuxPaneId: string | undefined,
  tmuxCaptureLines: number,
): string {
  const target = tmuxPaneId ?? tmuxSessionName;

  return [
    `tmux set-option -t ${quoteForPosixShell(tmuxSessionName)} history-limit ${tmuxCaptureLines} 2>/dev/null || true`,
    `tmux capture-pane -p -t ${quoteForPosixShell(target)} -S -${tmuxCaptureLines}`,
  ].join("; ");
}

export function stripAlternateScreenSwitches(data: string): string {
  return data.replace(/\u001b\[\?(?:1047|1048|1049)[hl]/g, "");
}
export { sanitizeReplayForTerminal } from "./terminal-control-filter.js";

interface LocalPtySpawnPlan {
  file: string;
  args: string[];
  env: Record<string, string>;
  sendInitialCommand: boolean;
}

function buildPtyEnv(agentKind?: string): Record<string, string> {
  const env = { ...(process.env as Record<string, string | undefined>) };

  for (const key of Object.keys(env)) {
    if (/^npm_config_/i.test(key)) {
      delete env[key];
    }
  }

  // Prevent "sessions should be nested with care" error when the server
  // itself runs inside a tmux session and a PTY tries to run `tmux attach`.
  delete env.TMUX;
  delete env.TMUX_PANE;

  if (agentKind === "copilot") {
    env.NPM_CONFIG_USERCONFIG = devNull;
    env.NPM_CONFIG_GLOBALCONFIG = devNull;
    env.npm_config_userconfig = devNull;
    env.npm_config_globalconfig = devNull;
  }

  const preferredCopilot = resolveCopilotBinary(env);
  if (preferredCopilot) {
    const preferredDir = dirname(preferredCopilot);
    const pathEntries = (env.PATH ?? "").split(delimiter).filter(Boolean);
    const normalizedPreferredDir = normalize(preferredDir);
    const remainingEntries = pathEntries.filter(
      (entry) => normalize(entry) !== normalizedPreferredDir,
    );

    env.PATH = [preferredDir, ...remainingEntries].join(delimiter);
  }

  return Object.fromEntries(
    Object.entries(env).filter(([, value]) => value !== undefined),
  ) as Record<string, string>;
}

function parseDirectCopilotArgs(command: string): string[] | null {
  const match = command
    .trim()
    .match(/^(?:cd\s+.+\s+&&\s+)?copilot(?:\s+(--resume=\S+))?$/);

  if (!match) {
    return null;
  }

  return match[1] ? [match[1]] : [];
}

export function buildLocalSpawnPlan(
  shell: string,
  input: LaunchLocalAgentInput,
): LocalPtySpawnPlan {
  if (input.tmuxSessionName && input.command) {
    return {
      file: "/bin/sh",
      args: ["-c", `exec ${input.command}`],
      env: buildPtyEnv(input.agentKind),
      sendInitialCommand: false,
    };
  }

  if (
    input.agentKind === "copilot" &&
    !input.tmuxSessionName &&
    input.command
  ) {
    const directArgs = parseDirectCopilotArgs(input.command);
    if (directArgs) {
      const env = buildPtyEnv("copilot");
      return {
        file: resolveCopilotBinary(env) ?? "copilot",
        args: directArgs,
        env,
        sendInitialCommand: false,
      };
    }
  }

  if (input.command) {
    return {
      file: "/bin/sh",
      args: ["-c", input.command],
      env: buildPtyEnv(input.agentKind),
      sendInitialCommand: false,
    };
  }

  return {
    file: shell,
    args: [],
    env: buildPtyEnv(),
    sendInitialCommand: true,
  };
}

export class PtyRuntimeManager {
  private readonly pendingTerminalProtocolReplies = new Map<
    string,
    PendingTerminalProtocolReplies
  >();
  private readonly writeQueues = new Map<string, Promise<void>>();
  private readonly handles = new Map<string, PtyHandle>();
  private readonly maxScrollbackBytes: number;
  private readonly tmuxCaptureLines: number;

  constructor(
    private readonly registry: AgentSessionRegistry,
    options: PtyRuntimeManagerOptions = {},
  ) {
    this.maxScrollbackBytes =
      options.maxScrollbackBytes ?? DEFAULT_TERMINAL_SCROLLBACK_BYTES;
    this.tmuxCaptureLines =
      options.tmuxCaptureLines ?? DEFAULT_TERMINAL_TMUX_CAPTURE_LINES;
  }

  launch(input: LaunchLocalAgentInput): AgentSessionRecord {
    const tmuxSessionName = normalizeTmuxSessionName(input.tmuxSessionName);
    const normalizedInput = { ...input, tmuxSessionName };
    const shell = resolvePreferredShell();
    const resolvedWorkingDirectory = resolveLocalWorkingDirectory(
      input.workingDirectory,
    );
    const spawnPlan = buildLocalSpawnPlan(shell, normalizedInput);
    this.configureLocalTmuxHistory(tmuxSessionName);
    const tmuxScrollback = this.captureLocalTmuxScrollback(normalizedInput);

    const ptyProcess = pty.spawn(spawnPlan.file, spawnPlan.args, {
      name: "xterm-256color",
      cols: 120,
      rows: 30,
      cwd: resolvedWorkingDirectory,
      env: spawnPlan.env,
    });

    const agentSession = this.registry.register({
      workspaceId: input.workspaceId,
      hostId: input.hostId ?? "local",
      sourceType: "local",
      agentKind: input.agentKind,
      displayName: input.displayName,
      workingDirectory: resolvedWorkingDirectory,
      connectionState: "online",
      interactionState: "running",
      stateConfidence: "medium",
      outputPreview: `启动中: ${input.command}`,
      controlMode: "control",
      transportRef: {
        processId: ptyProcess.pid,
        tmuxSession: tmuxSessionName,
        tmuxPane: input.tmuxPaneId,
        runtimeId: `pty:${ptyProcess.pid}`,
      },
    });

    const handle = this.createHandle(ptyProcess, {
      localTmuxSessionName: tmuxSessionName,
      stripAlternateScreen: Boolean(tmuxSessionName),
    });

    this.handles.set(agentSession.id, handle);
    this.seedScrollback(agentSession.id, handle, tmuxScrollback);

    ptyProcess.onData((data: string) => {
      if (
        this.handles.get(agentSession.id) !== handle ||
        !this.registry.has(agentSession.id)
      ) {
        return;
      }

      this.noteTerminalProtocolQueries(agentSession.id, handle, data);

      const output = this.normalizePtyOutput(handle, data);
      if (!output) {
        return;
      }

      this.appendScrollback(handle, output);

      for (const listener of handle.dataListeners) {
        listener(output);
      }

      this.registry.appendOutput(agentSession.id, output, "stdout");
    });

    ptyProcess.onExit(({ exitCode }) => {
      if (this.handles.get(agentSession.id) !== handle) {
        return;
      }

      this.handles.delete(agentSession.id);

      if (!this.registry.has(agentSession.id)) {
        return;
      }

      this.registry.markExited(agentSession.id, exitCode, null);
    });

    // Send initial command if provided
    if (spawnPlan.sendInitialCommand && input.command) {
      ptyProcess.write(input.command + "\n");
    }

    return this.registry.get(agentSession.id);
  }

  launchRemote(input: LaunchSshPtyInput): AgentSessionRecord {
    const tmuxSessionName = normalizeTmuxSessionName(input.tmuxSessionName);
    const normalizedInput = { ...input, tmuxSessionName };
    const tmuxScrollback = this.captureRemoteTmuxScrollback(normalizedInput);
    const args = buildSshArgs(input.sshTarget, {
      requestTty: true,
      remoteCommand: input.remoteCommand,
    });
    const userHost = formatSshDestination(input.sshTarget);

    const ptyProcess = pty.spawn("ssh", args, {
      name: "xterm-256color",
      cols: 120,
      rows: 30,
      cwd: process.env.HOME ?? process.cwd(),
      env: buildPtyEnv(),
    });

    const agentSession = this.registry.register({
      workspaceId: input.workspaceId,
      hostId: input.sshTarget.host,
      sourceType: "remote-connect",
      agentKind: input.agentKind,
      displayName: input.displayName,
      workingDirectory: input.workingDirectory,
      connectionState: "online",
      interactionState: "running",
      stateConfidence: "medium",
      outputPreview: `SSH → ${userHost}: ${input.remoteCommand}`,
      controlMode: "control",
      transportRef: {
        processId: ptyProcess.pid,
        tmuxSession: tmuxSessionName,
        tmuxPane: input.tmuxPaneId,
        runtimeId: `ssh-pty:${ptyProcess.pid}`,
        sshHost: input.sshTarget.host,
        sshPort: input.sshTarget.port,
        sshUsername: input.sshTarget.username,
      },
      agentSessionId: input.agentSessionId,
      sshTarget: input.sshTarget,
      remoteCommand: input.remoteCommand,
    });

    const handle = this.createHandle(ptyProcess, {
      stripAlternateScreen: Boolean(tmuxSessionName),
    });

    this.handles.set(agentSession.id, handle);
    this.seedScrollback(agentSession.id, handle, tmuxScrollback);

    ptyProcess.onData((data: string) => {
      if (
        this.handles.get(agentSession.id) !== handle ||
        !this.registry.has(agentSession.id)
      ) {
        return;
      }

      this.noteTerminalProtocolQueries(agentSession.id, handle, data);

      const output = this.normalizePtyOutput(handle, data);
      if (!output) {
        return;
      }

      this.appendScrollback(handle, output);

      for (const listener of handle.dataListeners) {
        listener(output);
      }

      this.registry.appendOutput(agentSession.id, output, "stdout");
    });

    ptyProcess.onExit(({ exitCode }) => {
      if (this.handles.get(agentSession.id) !== handle) {
        return;
      }

      this.handles.delete(agentSession.id);

      if (!this.registry.has(agentSession.id)) {
        return;
      }

      this.registry.markExited(agentSession.id, exitCode, null);
    });

    return this.registry.get(agentSession.id);
  }

  write(
    agentSessionId: string,
    data: string,
    options: PtyRuntimeWriteOptions = {},
  ): Promise<void> {
    if (
      options.terminalProtocolResponse ||
      isTerminalProtocolResponsePayload(data)
    ) {
      return this.writeTerminalProtocolResponse(agentSessionId, data);
    }

    const previous = this.writeQueues.get(agentSessionId) ?? Promise.resolve();
    const operation = previous.catch(() => {}).then(async () => {
      const handle = this.handles.get(agentSessionId);

      if (!handle) {
        throw new Error(`没有找到 PTY 运行时: ${agentSessionId}`);
      }

      // A terminal query must receive its full reply before a competing REST
      // request or keypress reaches the line discipline. Otherwise a CPR can
      // be split around text, yielding input such as "5Rnode".
      await this.waitForTerminalProtocolReplies(agentSessionId);

      this.registry.noteUserInput(agentSessionId, data);
      handle.ptyProcess.write(data);
    });
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

  resize(agentSessionId: string, cols: number, rows: number): void {
    const handle = this.handles.get(agentSessionId);

    if (!handle) {
      return;
    }

    handle.ptyProcess.resize(cols, rows);

    try {
      // Some interactive programs, especially ssh -> tmux, only propagate the
      // new window size after the foreground process receives SIGWINCH.
      process.kill(handle.ptyProcess.pid, "SIGWINCH");
    } catch {
      /* ignore processes that have already exited */
    }
  }

  getScrollback(agentSessionId: string): string {
    const handle = this.handles.get(agentSessionId);

    if (!handle) {
      throw new Error(`没有找到 PTY 运行时: ${agentSessionId}`);
    }

    return handle.scrollback.join("");
  }

  subscribe(
    agentSessionId: string,
    listener: PtyDataListener,
    options?: { replay?: boolean },
  ): () => void {
    const handle = this.handles.get(agentSessionId);

    if (!handle) {
      throw new Error(`没有找到 PTY 运行时: ${agentSessionId}`);
    }

    // Replay scrollback buffer to the new subscriber
    if (options?.replay !== false && handle.scrollback.length > 0) {
      const replay = sanitizeReplayForTerminal(handle.scrollback.join(""));
      if (replay) {
        listener(replay);
      }
    }

    handle.dataListeners.add(listener);

    return () => {
      handle.dataListeners.delete(listener);
    };
  }

  has(agentSessionId: string): boolean {
    return this.handles.has(agentSessionId);
  }

  async waitForTmuxClientReady(agentSessionId: string): Promise<boolean> {
    const handle = this.handles.get(agentSessionId);

    if (!handle) {
      return false;
    }

    if (!handle.localTmuxSessionName || handle.localTmuxClientReady) {
      return true;
    }

    if (!handle.localTmuxClientReadyWait) {
      const wait = this.waitForLocalTmuxClient(
        agentSessionId,
        handle,
        handle.localTmuxSessionName,
      );
      handle.localTmuxClientReadyWait = wait;
      void wait.finally(() => {
        if (this.handles.get(agentSessionId) === handle) {
          handle.localTmuxClientReadyWait = undefined;
        }
      });
    }

    return handle.localTmuxClientReadyWait;
  }

  kill(agentSessionId: string): void {
    const handle = this.handles.get(agentSessionId);
    if (handle) {
      handle.ptyProcess.kill();
      this.handles.delete(agentSessionId);
    }
    this.writeQueues.delete(agentSessionId);
    this.clearTerminalProtocolReplies(agentSessionId);
  }

  dispose(): void {
    const handles = Array.from(this.handles.values());
    this.handles.clear();
    this.writeQueues.clear();
    this.clearAllTerminalProtocolReplies();

    for (const handle of handles) {
      try {
        handle.ptyProcess.kill();
      } catch {
        // Shutdown must continue even if a PTY exited between collection and kill.
      }
    }
  }

  reconnectRemote(
    agentSessionId: string,
    input: LaunchSshPtyInput,
  ): AgentSessionRecord {
    this.kill(agentSessionId);
    const tmuxSessionName = normalizeTmuxSessionName(input.tmuxSessionName);
    const normalizedInput = { ...input, tmuxSessionName };
    const tmuxScrollback = this.captureRemoteTmuxScrollback(normalizedInput);

    const args = buildSshArgs(input.sshTarget, {
      requestTty: true,
      remoteCommand: input.remoteCommand,
    });
    const userHost = formatSshDestination(input.sshTarget);

    const ptyProcess = pty.spawn("ssh", args, {
      name: "xterm-256color",
      cols: 120,
      rows: 30,
      cwd: process.env.HOME ?? process.cwd(),
      env: buildPtyEnv(),
    });

    const handle = this.createHandle(ptyProcess, {
      stripAlternateScreen: Boolean(tmuxSessionName),
    });
    this.handles.set(agentSessionId, handle);
    this.seedScrollback(agentSessionId, handle, tmuxScrollback);

    this.registry.updateSession(agentSessionId, {
      connectionState: "online",
      interactionState: "running",
      stateConfidence: "medium",
      outputPreview: `重新连接中: SSH → ${userHost}`,
      transportRef: {
        processId: ptyProcess.pid,
        tmuxSession: tmuxSessionName,
        tmuxPane: input.tmuxPaneId,
        runtimeId: `ssh-pty:${ptyProcess.pid}`,
        sshHost: input.sshTarget.host,
        sshPort: input.sshTarget.port,
        sshUsername: input.sshTarget.username,
      },
    });

    ptyProcess.onData((data: string) => {
      if (
        this.handles.get(agentSessionId) !== handle ||
        !this.registry.has(agentSessionId)
      ) {
        return;
      }

      this.noteTerminalProtocolQueries(agentSessionId, handle, data);

      const output = this.normalizePtyOutput(handle, data);
      if (!output) {
        return;
      }

      this.appendScrollback(handle, output);
      for (const listener of handle.dataListeners) {
        listener(output);
      }
      this.registry.appendOutput(agentSessionId, output, "stdout");
    });

    ptyProcess.onExit(({ exitCode }) => {
      if (this.handles.get(agentSessionId) !== handle) {
        return;
      }

      this.handles.delete(agentSessionId);

      if (!this.registry.has(agentSessionId)) {
        return;
      }

      this.registry.markExited(agentSessionId, exitCode, null);
    });

    return this.registry.get(agentSessionId);
  }

  reconnectLocal(
    agentSessionId: string,
    input: LaunchLocalAgentInput,
  ): AgentSessionRecord {
    this.kill(agentSessionId);

    const tmuxSessionName = normalizeTmuxSessionName(input.tmuxSessionName);
    const normalizedInput = { ...input, tmuxSessionName };

    const shell = resolvePreferredShell();
    const resolvedWorkingDirectory = resolveLocalWorkingDirectory(
      input.workingDirectory,
    );
    const spawnPlan = buildLocalSpawnPlan(shell, normalizedInput);
    this.configureLocalTmuxHistory(tmuxSessionName);
    const tmuxScrollback = this.captureLocalTmuxScrollback(normalizedInput);
    const ptyProcess = pty.spawn(spawnPlan.file, spawnPlan.args, {
      name: "xterm-256color",
      cols: 120,
      rows: 30,
      cwd: resolvedWorkingDirectory,
      env: spawnPlan.env,
    });

    const handle = this.createHandle(ptyProcess, {
      localTmuxSessionName: tmuxSessionName,
      stripAlternateScreen: Boolean(tmuxSessionName),
    });
    this.handles.set(agentSessionId, handle);
    this.seedScrollback(agentSessionId, handle, tmuxScrollback);

    this.registry.updateSession(agentSessionId, {
      connectionState: "online",
      interactionState: "running",
      stateConfidence: "medium",
      outputPreview: `重新连接中: ${input.command}`,
      workingDirectory: resolvedWorkingDirectory,
      transportRef: {
        processId: ptyProcess.pid,
        tmuxSession: tmuxSessionName,
        tmuxPane: input.tmuxPaneId,
        runtimeId: `pty:${ptyProcess.pid}`,
      },
    });

    ptyProcess.onData((data: string) => {
      if (
        this.handles.get(agentSessionId) !== handle ||
        !this.registry.has(agentSessionId)
      ) {
        return;
      }

      this.noteTerminalProtocolQueries(agentSessionId, handle, data);

      const output = this.normalizePtyOutput(handle, data);
      if (!output) {
        return;
      }

      this.appendScrollback(handle, output);
      for (const listener of handle.dataListeners) {
        listener(output);
      }
      this.registry.appendOutput(agentSessionId, output, "stdout");
    });

    ptyProcess.onExit(({ exitCode }) => {
      if (this.handles.get(agentSessionId) !== handle) {
        return;
      }

      this.handles.delete(agentSessionId);

      if (!this.registry.has(agentSessionId)) {
        return;
      }

      this.registry.markExited(agentSessionId, exitCode, null);
    });

    if (spawnPlan.sendInitialCommand && input.command) {
      ptyProcess.write(input.command + "\n");
    }

    return this.registry.get(agentSessionId);
  }

  getScrollbackDiagnostics(): PtyScrollbackDiagnostics {
    const sessions = [...this.handles.entries()].map(
      ([agentSessionId, handle]) => ({
        agentSessionId,
        droppedScrollbackBytes: handle.droppedScrollbackBytes,
        droppedScrollbackChunks: handle.droppedScrollbackChunks,
        scrollbackBytes: handle.scrollbackBytes,
        scrollbackChunks: handle.scrollback.length,
      }),
    );

    return {
      activeSessions: sessions.length,
      maxScrollbackBytes: this.maxScrollbackBytes,
      sessions,
      totalDroppedScrollbackBytes: sessions.reduce(
        (sum, session) => sum + session.droppedScrollbackBytes,
        0,
      ),
      totalDroppedScrollbackChunks: sessions.reduce(
        (sum, session) => sum + session.droppedScrollbackChunks,
        0,
      ),
      totalScrollbackBytes: sessions.reduce(
        (sum, session) => sum + session.scrollbackBytes,
        0,
      ),
      truncatedSessionCount: sessions.filter(
        (session) => session.droppedScrollbackChunks > 0,
      ).length,
    };
  }

  private createHandle(
    ptyProcess: pty.IPty,
    options: {
      localTmuxSessionName?: string;
      stripAlternateScreen?: boolean;
    } = {},
  ): PtyHandle {
    return {
      ptyProcess,
      dataListeners: new Set(),
      droppedScrollbackBytes: 0,
      droppedScrollbackChunks: 0,
      localTmuxClientReady: false,
      localTmuxSessionName: options.localTmuxSessionName,
      scrollback: [],
      scrollbackBytes: 0,
      stripAlternateScreen: Boolean(options.stripAlternateScreen),
      terminalProtocolQueryRemainder: "",
    };
  }

  private appendScrollback(handle: PtyHandle, data: string): void {
    appendPtyScrollback(handle, data, this.maxScrollbackBytes);
  }

  private noteTerminalProtocolQueries(
    agentSessionId: string,
    handle: PtyHandle,
    data: string,
  ): void {
    const combined = `${handle.terminalProtocolQueryRemainder}${data}`;
    const remainder =
      combined.match(/\u001b(?:\[(?:\?)?[\d;]*)?$/u)?.[0] ?? "";
    handle.terminalProtocolQueryRemainder = remainder;
    const completeData = remainder
      ? combined.slice(0, Math.max(0, combined.length - remainder.length))
      : combined;
    const expectedKinds = getTerminalProtocolQueryResponseKinds(completeData);

    if (expectedKinds.length === 0) {
      return;
    }

    const pending = this.pendingTerminalProtocolReplies.get(agentSessionId);
    if (pending) {
      pending.expectedKinds.push(...expectedKinds);
      return;
    }

    let resolve!: () => void;
    const completion = new Promise<void>((done) => {
      resolve = done;
    });
    const timeout = setTimeout(() => {
      const current = this.pendingTerminalProtocolReplies.get(agentSessionId);
      if (!current || current.completion !== completion) {
        return;
      }

      this.pendingTerminalProtocolReplies.delete(agentSessionId);
      current.resolve();
    }, TERMINAL_PROTOCOL_REPLY_TIMEOUT_MS);
    timeout.unref();

    this.pendingTerminalProtocolReplies.set(agentSessionId, {
      completion,
      expectedKinds,
      resolve,
      timeout,
    });
  }

  private waitForTerminalProtocolReplies(agentSessionId: string): Promise<void> {
    return (
      this.pendingTerminalProtocolReplies.get(agentSessionId)?.completion ??
      Promise.resolve()
    );
  }

  private writeTerminalProtocolResponse(
    agentSessionId: string,
    data: string,
  ): Promise<void> {
    const pending = this.pendingTerminalProtocolReplies.get(agentSessionId);
    if (!pending) {
      // Responses are only meaningful for a query emitted by this PTY. An
      // xterm instance can finish an old handshake after reconnect, and
      // forwarding that stale reply writes escape fragments into the shell.
      return Promise.resolve();
    }

    const responses = getTerminalProtocolResponses(data);
    const matchingPayload = responses
      .filter((response) => {
        if (pending.expectedKinds[0] !== response.kind) {
          return false;
        }

        pending.expectedKinds.shift();
        return true;
      })
      .map((response) => response.payload)
      .join("");

    if (!matchingPayload) {
      return Promise.resolve();
    }

    const handle = this.handles.get(agentSessionId);
    if (!handle) {
      return Promise.reject(new Error(`没有找到 PTY 运行时: ${agentSessionId}`));
    }

    this.registry.noteUserInput(agentSessionId, matchingPayload);
    handle.ptyProcess.write(matchingPayload);
    this.resolveTerminalProtocolReplies(agentSessionId);
    return Promise.resolve();
  }

  private resolveTerminalProtocolReplies(agentSessionId: string): void {
    const pending = this.pendingTerminalProtocolReplies.get(agentSessionId);
    if (!pending) {
      return;
    }

    if (pending.expectedKinds.length > 0) {
      return;
    }

    this.clearTerminalProtocolReplies(agentSessionId);
  }

  private clearTerminalProtocolReplies(agentSessionId: string): void {
    const pending = this.pendingTerminalProtocolReplies.get(agentSessionId);
    if (!pending) {
      return;
    }

    this.pendingTerminalProtocolReplies.delete(agentSessionId);
    clearTimeout(pending.timeout);
    pending.resolve();
  }

  private clearAllTerminalProtocolReplies(): void {
    for (const agentSessionId of this.pendingTerminalProtocolReplies.keys()) {
      this.clearTerminalProtocolReplies(agentSessionId);
    }
  }

  private normalizePtyOutput(handle: PtyHandle, data: string): string {
    return handle.stripAlternateScreen
      ? stripAlternateScreenSwitches(data)
      : data;
  }

  private async waitForLocalTmuxClient(
    agentSessionId: string,
    handle: PtyHandle,
    tmuxSessionName: string,
  ): Promise<boolean> {
    const deadline = Date.now() + TMUX_CLIENT_READY_TIMEOUT_MS;

    while (
      Date.now() < deadline &&
      this.handles.get(agentSessionId) === handle
    ) {
      if (
        await this.isLocalTmuxClientAttached(
          tmuxSessionName,
          handle.ptyProcess.pid,
        )
      ) {
        handle.localTmuxClientReady = true;
        return true;
      }

      await sleep(TMUX_CLIENT_READY_POLL_MS);
    }

    return false;
  }

  private async isLocalTmuxClientAttached(
    tmuxSessionName: string,
    ptyProcessId: number,
  ): Promise<boolean> {
    try {
      const { stdout } = await execFileAsync(
        resolveTmuxBinary(),
        ["list-clients", "-t", tmuxSessionName, "-F", "#{client_pid}"],
        {
          encoding: "utf8",
          env: buildPtyEnv(),
          timeout: TMUX_CLIENT_READY_POLL_MS * 4,
        },
      );

      return String(stdout)
        .split("\n")
        .some((clientPid) => Number.parseInt(clientPid, 10) === ptyProcessId);
    } catch {
      return false;
    }
  }

  private configureLocalTmuxHistory(tmuxSessionName?: string): void {
    if (!tmuxSessionName) {
      return;
    }

    try {
      execFileSync(
        resolveTmuxBinary(),
        [
          "set-option",
          "-t",
          tmuxSessionName,
          "history-limit",
          String(this.tmuxCaptureLines),
        ],
        {
          stdio: "ignore",
          env: buildPtyEnv(),
        },
      );
    } catch {}
  }

  private captureLocalTmuxScrollback(input: LaunchLocalAgentInput): string {
    if (!input.tmuxSessionName) {
      return "";
    }

    const target = input.tmuxPaneId ?? input.tmuxSessionName;

    try {
      return execFileSync(
        resolveTmuxBinary(),
        ["capture-pane", "-p", "-t", target, "-S", `-${this.tmuxCaptureLines}`],
        {
          encoding: "utf8",
          env: buildPtyEnv(),
          maxBuffer: Math.max(
            this.maxScrollbackBytes,
            this.tmuxCaptureLines * 1024,
          ),
        },
      );
    } catch {
      return "";
    }
  }

  private captureRemoteTmuxScrollback(input: LaunchSshPtyInput): string {
    if (!input.tmuxSessionName) {
      return "";
    }

    try {
      return execFileSync(
        "ssh",
        buildSshArgs(input.sshTarget, {
          batchMode: true,
          connectTimeoutSeconds: 5,
          remoteCommand: buildRemoteTmuxCaptureCommand(
            input.tmuxSessionName,
            input.tmuxPaneId,
            this.tmuxCaptureLines,
          ),
        }),
        {
          encoding: "utf8",
          env: buildPtyEnv(),
          maxBuffer: Math.max(
            this.maxScrollbackBytes,
            this.tmuxCaptureLines * 1024,
          ),
        },
      );
    } catch {
      return "";
    }
  }

  private seedScrollback(
    agentSessionId: string,
    handle: PtyHandle,
    scrollback: string,
  ): void {
    if (!scrollback.trim()) {
      return;
    }

    const normalizedScrollback = scrollback.endsWith("\n")
      ? scrollback
      : `${scrollback}\n`;

    this.appendScrollback(handle, normalizedScrollback);
    this.registry.appendOutput(agentSessionId, normalizedScrollback, "stdout");
  }
}
