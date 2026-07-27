import * as pty from "node-pty";
import { execFileSync } from "node:child_process";
import { devNull } from "node:os";
import { delimiter, dirname, normalize } from "node:path";

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
import { sanitizeReplayForTerminal } from "./terminal-control-filter.js";

type PtyDataListener = (data: string) => void;

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
  stripAlternateScreen: boolean;
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
    const shell = resolvePreferredShell();
    const resolvedWorkingDirectory = resolveLocalWorkingDirectory(
      input.workingDirectory,
    );
    const spawnPlan = buildLocalSpawnPlan(shell, input);
    this.configureLocalTmuxHistory(input.tmuxSessionName);
    const tmuxScrollback = this.captureLocalTmuxScrollback(input);

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
        tmuxSession: input.tmuxSessionName,
        tmuxPane: input.tmuxPaneId,
        runtimeId: `pty:${ptyProcess.pid}`,
      },
    });

    const handle = this.createHandle(ptyProcess, {
      stripAlternateScreen: Boolean(input.tmuxSessionName),
    });

    this.handles.set(agentSession.id, handle);
    this.seedScrollback(agentSession.id, handle, tmuxScrollback);

    ptyProcess.onData((data: string) => {
      if (!this.registry.has(agentSession.id)) {
        return;
      }

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
    const tmuxScrollback = this.captureRemoteTmuxScrollback(input);
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
        tmuxSession: input.tmuxSessionName,
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
      stripAlternateScreen: Boolean(input.tmuxSessionName),
    });

    this.handles.set(agentSession.id, handle);
    this.seedScrollback(agentSession.id, handle, tmuxScrollback);

    ptyProcess.onData((data: string) => {
      if (!this.registry.has(agentSession.id)) {
        return;
      }

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
      this.handles.delete(agentSession.id);

      if (!this.registry.has(agentSession.id)) {
        return;
      }

      this.registry.markExited(agentSession.id, exitCode, null);
    });

    return this.registry.get(agentSession.id);
  }

  write(agentSessionId: string, data: string): void {
    const handle = this.handles.get(agentSessionId);

    if (!handle) {
      throw new Error(`没有找到 PTY 运行时: ${agentSessionId}`);
    }

    this.registry.noteUserInput(agentSessionId, data);
    handle.ptyProcess.write(data);
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

  kill(agentSessionId: string): void {
    const handle = this.handles.get(agentSessionId);
    if (handle) {
      handle.ptyProcess.kill();
      this.handles.delete(agentSessionId);
    }
  }

  reconnectRemote(
    agentSessionId: string,
    input: LaunchSshPtyInput,
  ): AgentSessionRecord {
    this.kill(agentSessionId);
    const tmuxScrollback = this.captureRemoteTmuxScrollback(input);

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
      stripAlternateScreen: Boolean(input.tmuxSessionName),
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
        tmuxSession: input.tmuxSessionName,
        tmuxPane: input.tmuxPaneId,
        runtimeId: `ssh-pty:${ptyProcess.pid}`,
        sshHost: input.sshTarget.host,
        sshPort: input.sshTarget.port,
        sshUsername: input.sshTarget.username,
      },
    });

    ptyProcess.onData((data: string) => {
      if (!this.registry.has(agentSessionId)) {
        return;
      }

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

    const shell = resolvePreferredShell();
    const resolvedWorkingDirectory = resolveLocalWorkingDirectory(
      input.workingDirectory,
    );
    const spawnPlan = buildLocalSpawnPlan(shell, input);
    this.configureLocalTmuxHistory(input.tmuxSessionName);
    const tmuxScrollback = this.captureLocalTmuxScrollback(input);
    const ptyProcess = pty.spawn(spawnPlan.file, spawnPlan.args, {
      name: "xterm-256color",
      cols: 120,
      rows: 30,
      cwd: resolvedWorkingDirectory,
      env: spawnPlan.env,
    });

    const handle = this.createHandle(ptyProcess, {
      stripAlternateScreen: Boolean(input.tmuxSessionName),
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
        tmuxSession: input.tmuxSessionName,
        tmuxPane: input.tmuxPaneId,
        runtimeId: `pty:${ptyProcess.pid}`,
      },
    });

    ptyProcess.onData((data: string) => {
      if (!this.registry.has(agentSessionId)) {
        return;
      }

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
    options: { stripAlternateScreen?: boolean } = {},
  ): PtyHandle {
    return {
      ptyProcess,
      dataListeners: new Set(),
      droppedScrollbackBytes: 0,
      droppedScrollbackChunks: 0,
      scrollback: [],
      scrollbackBytes: 0,
      stripAlternateScreen: Boolean(options.stripAlternateScreen),
    };
  }

  private appendScrollback(handle: PtyHandle, data: string): void {
    appendPtyScrollback(handle, data, this.maxScrollbackBytes);
  }

  private normalizePtyOutput(handle: PtyHandle, data: string): string {
    return handle.stripAlternateScreen
      ? stripAlternateScreenSwitches(data)
      : data;
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
