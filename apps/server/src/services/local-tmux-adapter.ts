import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";

import type {
  AgentOutputEntry,
  AgentSessionDetailResponse,
  AgentSessionRecord,
  DiscoverTmuxSessionsResponse,
  SshTarget,
  StdinAgentSessionInput,
} from "@agent-orchestrator/shared";

import { AgentSessionRegistry } from "./agent-session-registry.js";
import { DEFAULT_TERMINAL_TMUX_CAPTURE_LINES } from "../config/server-runtime-config.js";
import { quoteForPosixShell, resolveTmuxBinary } from "./runtime-compat.js";
import { buildSshArgs, formatSshDestination } from "./ssh-command.js";

const TMUX_BINARY = resolveTmuxBinary();

export type TmuxSendKeyStep =
  | { kind: "literal"; value: string }
  | { kind: "keys"; keys: string[] };

export interface TmuxSendKeyPlan {
  steps: TmuxSendKeyStep[];
  bracketedPasteOpen: boolean;
}

export interface TmuxSendKeyPlanOptions {
  bracketedPasteOpen?: boolean;
}

export interface LocalTmuxAdapterOptions {
  captureLines?: number;
}

interface TmuxPaneInfo {
  sessionName: string;
  attachedCount: number;
  windowActive: boolean;
  paneActive: boolean;
  paneId: string;
  currentCommand: string;
  currentPath: string;
}

const CONTROL_KEY_MAP = new Map<string, string>([
  ["\x01", "C-a"],
  ["\x02", "C-b"],
  ["\x03", "C-c"],
  ["\x04", "C-d"],
  ["\x05", "C-e"],
  ["\x06", "C-f"],
  ["\x07", "C-g"],
  ["\x08", "C-h"],
  ["\t", "Tab"],
  ["\n", "Enter"],
  ["\r", "Enter"],
  ["\x0b", "C-k"],
  ["\x0c", "C-l"],
  ["\x0e", "C-n"],
  ["\x0f", "C-o"],
  ["\x10", "C-p"],
  ["\x11", "C-q"],
  ["\x12", "C-r"],
  ["\x13", "C-s"],
  ["\x14", "C-t"],
  ["\x15", "C-u"],
  ["\x16", "C-v"],
  ["\x17", "C-w"],
  ["\x18", "C-x"],
  ["\x19", "C-y"],
  ["\x1a", "C-z"],
  ["\x1b", "Escape"],
  ["\x7f", "BSpace"],
]);

const CSI_KEY_MAP = new Map<string, string>([
  ["\x1b[A", "Up"],
  ["\x1b[B", "Down"],
  ["\x1b[C", "Right"],
  ["\x1b[D", "Left"],
  ["\x1b[H", "Home"],
  ["\x1b[F", "End"],
  ["\x1b[Z", "BTab"],
  ["\x1bOA", "Up"],
  ["\x1bOB", "Down"],
  ["\x1bOC", "Right"],
  ["\x1bOD", "Left"],
  ["\x1bOH", "Home"],
  ["\x1bOF", "End"],
  ["\x1bOP", "F1"],
  ["\x1bOQ", "F2"],
  ["\x1bOR", "F3"],
  ["\x1bOS", "F4"],
]);

const BRACKETED_PASTE_START = "\x1b[200~";
const BRACKETED_PASTE_END = "\x1b[201~";

const MODIFIED_CURSOR_KEY_PATTERN = /^\x1b\[1;([2-8])([ABCDHF])/;
const CSI_U_KEY_PATTERN = /^\x1b\[(13);([25])u/;
const TILDE_KEY_PATTERN =
  /^\x1b\[(1|2|3|4|5|6|7|8|11|12|13|14|15|17|18|19|20|21|23|24)(?:;([2-8]))?~/;

const CSI_CURSOR_KEY_MAP = new Map<string, string>([
  ["A", "Up"],
  ["B", "Down"],
  ["C", "Right"],
  ["D", "Left"],
  ["H", "Home"],
  ["F", "End"],
]);

const TILDE_KEY_MAP = new Map<string, string>([
  ["1", "Home"],
  ["2", "IC"],
  ["3", "DC"],
  ["4", "End"],
  ["5", "PPage"],
  ["6", "NPage"],
  ["7", "Home"],
  ["8", "End"],
  ["11", "F1"],
  ["12", "F2"],
  ["13", "F3"],
  ["14", "F4"],
  ["15", "F5"],
  ["17", "F6"],
  ["18", "F7"],
  ["19", "F8"],
  ["20", "F9"],
  ["21", "F10"],
  ["23", "F11"],
  ["24", "F12"],
]);

const CSI_U_KEY_MAP = new Map<string, string>([
  ["13;2", "S-Enter"],
  ["13;5", "C-Enter"],
]);

interface ParsedTmuxKeySequence {
  key: string;
  length: number;
}

function applyXtermModifier(baseKey: string, modifierValue?: string): string {
  if (!modifierValue) {
    return baseKey;
  }

  const modifierFlags = Number.parseInt(modifierValue, 10) - 1;
  const prefixes: string[] = [];

  if ((modifierFlags & 4) !== 0) {
    prefixes.push("C");
  }

  if ((modifierFlags & 2) !== 0) {
    prefixes.push("M");
  }

  if ((modifierFlags & 1) !== 0) {
    prefixes.push("S");
  }

  return prefixes.length > 0 ? `${prefixes.join("-")}-${baseKey}` : baseKey;
}

function readTmuxKeySequence(
  input: string,
  index: number,
): ParsedTmuxKeySequence | null {
  const fixedSequence = input.slice(index, index + 3);
  const fixedKey = CSI_KEY_MAP.get(fixedSequence);

  if (fixedKey) {
    return {
      key: fixedKey,
      length: fixedSequence.length,
    };
  }

  const sequenceTail = input.slice(index);
  const modifiedCursorMatch = MODIFIED_CURSOR_KEY_PATTERN.exec(sequenceTail);

  if (modifiedCursorMatch) {
    const [, modifierValue, finalByte] = modifiedCursorMatch;
    const baseKey = CSI_CURSOR_KEY_MAP.get(finalByte);

    if (baseKey) {
      return {
        key: applyXtermModifier(baseKey, modifierValue),
        length: modifiedCursorMatch[0].length,
      };
    }
  }

  const csiUKeyMatch = CSI_U_KEY_PATTERN.exec(sequenceTail);

  if (csiUKeyMatch) {
    const [, keyCode, modifierValue] = csiUKeyMatch;
    const key = CSI_U_KEY_MAP.get(`${keyCode};${modifierValue}`);

    if (key) {
      return {
        key,
        length: csiUKeyMatch[0].length,
      };
    }
  }

  const tildeKeyMatch = TILDE_KEY_PATTERN.exec(sequenceTail);

  if (tildeKeyMatch) {
    const [, keyCode, modifierValue] = tildeKeyMatch;
    const baseKey = TILDE_KEY_MAP.get(keyCode);

    if (baseKey) {
      return {
        key: applyXtermModifier(baseKey, modifierValue),
        length: tildeKeyMatch[0].length,
      };
    }
  }

  return null;
}

function appendLiteralStep(steps: TmuxSendKeyStep[], value: string): void {
  if (!value) {
    return;
  }

  const lastStep = steps.at(-1);

  if (lastStep?.kind === "literal") {
    lastStep.value += value;
    return;
  }

  steps.push({ kind: "literal", value });
}

function appendKeyStep(steps: TmuxSendKeyStep[], key: string): void {
  const lastStep = steps.at(-1);

  if (lastStep?.kind === "keys") {
    lastStep.keys.push(key);
    return;
  }

  steps.push({ kind: "keys", keys: [key] });
}

export function buildTmuxSendKeyPlan(
  input: string,
  options: TmuxSendKeyPlanOptions = {},
): TmuxSendKeyPlan {
  const steps: TmuxSendKeyStep[] = [];
  let literalBuffer = "";
  let bracketedPasteOpen = options.bracketedPasteOpen ?? false;

  function flushLiteral(): void {
    if (!literalBuffer) {
      return;
    }

    appendLiteralStep(steps, literalBuffer);
    literalBuffer = "";
  }

  for (let index = 0; index < input.length; ) {
    if (bracketedPasteOpen) {
      const pasteEndIndex = input.indexOf(BRACKETED_PASTE_END, index);
      const pasteEndExclusive =
        pasteEndIndex === -1
          ? input.length
          : pasteEndIndex + BRACKETED_PASTE_END.length;

      appendLiteralStep(steps, input.slice(index, pasteEndExclusive));
      index = pasteEndExclusive;
      bracketedPasteOpen = pasteEndIndex === -1;
      continue;
    }

    if (input.startsWith(BRACKETED_PASTE_START, index)) {
      const pasteEndIndex = input.indexOf(
        BRACKETED_PASTE_END,
        index + BRACKETED_PASTE_START.length,
      );
      const pasteEndExclusive =
        pasteEndIndex === -1
          ? input.length
          : pasteEndIndex + BRACKETED_PASTE_END.length;

      flushLiteral();
      appendLiteralStep(steps, input.slice(index, pasteEndExclusive));
      index = pasteEndExclusive;
      bracketedPasteOpen = pasteEndIndex === -1;
      continue;
    }

    if (input.startsWith(BRACKETED_PASTE_END, index)) {
      index += BRACKETED_PASTE_END.length;
      continue;
    }

    const keySequence = readTmuxKeySequence(input, index);

    if (keySequence) {
      flushLiteral();
      appendKeyStep(steps, keySequence.key);
      index += keySequence.length;
      continue;
    }

    const currentChar = input[index];
    const controlKey = CONTROL_KEY_MAP.get(currentChar);

    if (controlKey) {
      flushLiteral();
      appendKeyStep(steps, controlKey);
      index += 1;
      continue;
    }

    literalBuffer += currentChar;
    index += 1;
  }

  flushLiteral();
  return { steps, bracketedPasteOpen };
}

export function buildTmuxSendKeySteps(input: string): TmuxSendKeyStep[] {
  return buildTmuxSendKeyPlan(input).steps;
}

export interface TmuxSessionInfo {
  sessionName: string;
  paneId: string;
  currentCommand: string;
  currentPath: string;
  isAttached: boolean;
  interactionState: "running" | "detached";
}

export function parsePaneInfo(stdout: string): TmuxPaneInfo[] {
  return stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [
        sessionName,
        attachedCount,
        windowActive,
        paneActive,
        paneId,
        currentCommand,
        currentPath,
      ] = line.split("\t");

      return {
        sessionName,
        attachedCount: Number.parseInt(attachedCount ?? "0", 10) || 0,
        windowActive: windowActive === "1",
        paneActive: paneActive === "1",
        paneId,
        currentCommand,
        currentPath,
      };
    })
    .filter(
      (paneInfo) =>
        Boolean(paneInfo.sessionName) &&
        Boolean(paneInfo.paneId) &&
        Boolean(paneInfo.currentPath),
    );
}

function pickPaneScore(paneInfo: TmuxPaneInfo): number {
  if (paneInfo.windowActive && paneInfo.paneActive) {
    return 3;
  }

  if (paneInfo.paneActive) {
    return 2;
  }

  if (paneInfo.windowActive) {
    return 1;
  }

  return 0;
}

export function summarizeTmuxSessions(
  paneInfos: TmuxPaneInfo[],
): TmuxSessionInfo[] {
  const grouped = new Map<string, TmuxPaneInfo[]>();

  for (const paneInfo of paneInfos) {
    const items = grouped.get(paneInfo.sessionName) ?? [];
    items.push(paneInfo);
    grouped.set(paneInfo.sessionName, items);
  }

  return [...grouped.entries()]
    .map(([sessionName, panes]) => {
      const chosenPane = [...panes].sort((left, right) => {
        const scoreDiff = pickPaneScore(right) - pickPaneScore(left);
        if (scoreDiff !== 0) {
          return scoreDiff;
        }

        return left.paneId.localeCompare(right.paneId);
      })[0];

      const isAttached = panes.some((pane) => pane.attachedCount > 0);

      return {
        sessionName,
        paneId: chosenPane.paneId,
        currentCommand: chosenPane.currentCommand,
        currentPath: chosenPane.currentPath,
        isAttached,
        interactionState: isAttached
          ? ("running" as const)
          : ("detached" as const),
      };
    })
    .sort((left, right) => {
      // Only sort by sessionName (宫格名)
      return left.sessionName.localeCompare(right.sessionName);
    });
}

export function isNoTmuxServerError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /no server running|failed to connect to server/i.test(message);
}

export function buildTmuxCapturePaneArgs(
  paneId: string,
  captureLines: number,
): string[] {
  return ["capture-pane", "-p", "-t", paneId, "-S", `-${captureLines}`];
}

function pickPreview(text: string): string | undefined {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1)
    ?.slice(0, 160);
}

function buildTmuxStatusPreview(sessionInfo: TmuxSessionInfo): string {
  const stateLabel =
    sessionInfo.interactionState === "running" ? "连接中" : "detached";
  return `tmux:${sessionInfo.sessionName} · ${sessionInfo.currentCommand} · ${stateLabel}`;
}

export class LocalTmuxAdapter {
  private readonly captureLines: number;
  private readonly bracketedPasteSessionIds = new Set<string>();

  constructor(
    private readonly registry: AgentSessionRegistry,
    options: LocalTmuxAdapterOptions = {},
  ) {
    this.captureLines =
      options.captureLines ?? DEFAULT_TERMINAL_TMUX_CAPTURE_LINES;
  }

  async renameSession(
    agentSession: AgentSessionRecord,
    nextName: string,
  ): Promise<AgentSessionRecord> {
    const currentTmuxSession = agentSession.transportRef?.tmuxSession;
    if (!currentTmuxSession) {
      return this.registry.updateSession(agentSession.id, {
        displayName: nextName,
      });
    }

    const paneId = agentSession.transportRef?.tmuxPane;
    const sshTarget = agentSession.sshTarget;
    const currentTarget =
      (await this.resolvePaneSessionName(paneId, sshTarget).catch(
        () => undefined,
      )) ?? currentTmuxSession;

    if (sshTarget) {
      const remoteCommands = [
        `tmux rename-session -t ${quoteForPosixShell(currentTarget)} ${quoteForPosixShell(nextName)}`,
      ];
      if (paneId) {
        remoteCommands.push(
          `tmux select-pane -t ${quoteForPosixShell(paneId)} -T ${quoteForPosixShell(nextName)}`,
        );
      }
      await this.runRemoteCommand(sshTarget, remoteCommands.join(" && "));
    } else {
      await this.runTmux([
        "rename-session",
        "-t",
        currentTarget,
        nextName,
      ]);
      if (paneId) {
        await this.runTmux(["select-pane", "-t", paneId, "-T", nextName]);
      }
    }

    const actualTmuxSession =
      (await this.resolvePaneSessionName(paneId, sshTarget).catch(
        () => undefined,
      )) ?? nextName;
    const sshHost = sshTarget?.host ?? agentSession.transportRef?.sshHost;
    const nextRuntimeId = agentSession.transportRef?.runtimeId?.startsWith(
      "tmux:",
    )
      ? sshHost
        ? `tmux:${sshHost}:${actualTmuxSession}`
        : `tmux:${actualTmuxSession}`
      : agentSession.transportRef?.runtimeId;

    return this.registry.updateSession(agentSession.id, {
      displayName: nextName,
      workspaceId: nextName,
      transportRef: {
        tmuxSession: actualTmuxSession,
        ...(nextRuntimeId ? { runtimeId: nextRuntimeId } : {}),
      },
    });
  }

  async discover(): Promise<DiscoverTmuxSessionsResponse> {
    try {
      await this.runTmux(["-V"]);
    } catch {
      return {
        items: [],
        unavailable: true,
      };
    }

    let stdout = "";

    try {
      ({ stdout } = await this.runTmux([
        "list-panes",
        "-a",
        "-F",
        "#{session_name}\t#{session_attached}\t#{window_active}\t#{pane_active}\t#{pane_id}\t#{pane_current_command}\t#{pane_current_path}",
      ]));
    } catch (error) {
      if (isNoTmuxServerError(error)) {
        return {
          items: [],
          unavailable: false,
        };
      }

      throw error;
    }

    const discoveredSessions: AgentSessionRecord[] = [];

    for (const sessionInfo of summarizeTmuxSessions(parsePaneInfo(stdout))) {
      let outputPreview = buildTmuxStatusPreview(sessionInfo);

      try {
        const capture = await this.capturePane(sessionInfo.paneId);
        outputPreview = pickPreview(capture) ?? outputPreview;
      } catch {
        // Pane can disappear during discovery; keep a status-based preview.
      }

      const runtimeId = `tmux:${sessionInfo.sessionName}`;

      discoveredSessions.push({
        id: `preview:${runtimeId}`,
        workspaceId: sessionInfo.sessionName,
        hostId: "local",
        sourceType: "remote-tmux-discovered",
        agentKind: sessionInfo.currentCommand,
        displayName: `tmux:${sessionInfo.sessionName}`,
        workingDirectory: sessionInfo.currentPath,
        connectionState: "online",
        interactionState: sessionInfo.interactionState,
        stateConfidence: "medium",
        outputPreview,
        controlMode: "observe",
        transportRef: {
          tmuxSession: sessionInfo.sessionName,
          tmuxPane: sessionInfo.paneId,
          runtimeId,
        },
        lastHeartbeatAt: new Date().toISOString(),
      });
    }

    return {
      items: discoveredSessions,
      unavailable: false,
    };
  }

  async getDetail(
    agentSession: AgentSessionRecord,
  ): Promise<AgentSessionDetailResponse> {
    const paneId = agentSession.transportRef?.tmuxPane;

    if (!paneId) {
      return this.registry.getDetail(agentSession.id);
    }

    const capture = await this.capturePane(paneId);
    const outputEntries: AgentOutputEntry[] = capture
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-this.captureLines)
      .map((line) => ({
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        stream: "stdout",
        text: line,
      }));

    return this.registry.replaceOutputEntries(agentSession.id, outputEntries);
  }

  async writeInput(
    agentSession: AgentSessionRecord,
    input: StdinAgentSessionInput,
  ): Promise<AgentSessionRecord> {
    if (agentSession.controlMode !== "control") {
      throw new Error("tmux session is observe-only until takeover is enabled");
    }

    const paneId =
      agentSession.transportRef?.tmuxPane ??
      agentSession.transportRef?.tmuxSession;

    if (!paneId) {
      throw new Error(
        `No tmux target found for agent session: ${agentSession.id}`,
      );
    }

    const plan = buildTmuxSendKeyPlan(input.input, {
      bracketedPasteOpen: this.bracketedPasteSessionIds.has(agentSession.id),
    });

    if (plan.bracketedPasteOpen) {
      this.bracketedPasteSessionIds.add(agentSession.id);
    } else {
      this.bracketedPasteSessionIds.delete(agentSession.id);
    }

    for (const step of plan.steps) {
      if (step.kind === "literal") {
        await this.runTmux(["send-keys", "-t", paneId, "-l", step.value]);
      } else {
        await this.runTmux(["send-keys", "-t", paneId, ...step.keys]);
      }
    }

    return this.registry.writeToSession(agentSession.id, input);
  }

  async takeOver(
    agentSession: AgentSessionRecord,
  ): Promise<AgentSessionDetailResponse> {
    const detail = await this.getDetail(agentSession);
    this.registry.updateSession(agentSession.id, {
      controlMode: "control",
      stateConfidence: "medium",
      lastRefreshedAt: new Date().toISOString(),
    });
    const currentAgentSession = this.registry.syncCapturedScreen(
      agentSession.id,
      detail.outputEntries.map(({ text }) => text).join("\n"),
    );

    return {
      agentSession: currentAgentSession,
      outputEntries: detail.outputEntries,
    };
  }

  async release(
    agentSession: AgentSessionRecord,
  ): Promise<AgentSessionDetailResponse> {
    const detail = await this.getDetail(agentSession);
    const currentAgentSession = this.registry.updateSession(agentSession.id, {
      controlMode: "observe",
      interactionState: "detached",
      stateConfidence: "high",
      lastRefreshedAt: new Date().toISOString(),
    });

    return {
      agentSession: currentAgentSession,
      outputEntries: detail.outputEntries,
    };
  }

  async refresh(
    agentSession: AgentSessionRecord,
  ): Promise<AgentSessionDetailResponse> {
    const detail = await this.getDetail(agentSession);
    const combinedOutput = detail.outputEntries
      .map(({ text }) => text)
      .join("\n");
    const outputPreview =
      pickPreview(combinedOutput) ?? agentSession.outputPreview;

    const currentAgentSession = this.registry.updateSession(agentSession.id, {
      outputPreview,
      lastRefreshedAt: new Date().toISOString(),
      stateConfidence: "medium",
    });

    const syncedAgentSession = this.registry.syncCapturedScreen(
      currentAgentSession.id,
      combinedOutput,
    );

    return {
      agentSession: syncedAgentSession,
      outputEntries: detail.outputEntries,
    };
  }

  private async capturePane(paneId: string): Promise<string> {
    const { stdout } = await this.runTmux(
      buildTmuxCapturePaneArgs(paneId, this.captureLines),
    );

    return stdout;
  }

  private async resolvePaneSessionName(
    paneId: string | undefined,
    sshTarget?: SshTarget,
  ): Promise<string | undefined> {
    if (!paneId) {
      return undefined;
    }

    if (sshTarget) {
      const stdout = await this.runRemoteCommand(
        sshTarget,
        `tmux display-message -p -t ${quoteForPosixShell(paneId)} ${quoteForPosixShell("#{session_name}")}`,
      );
      return stdout.trim() || undefined;
    }

    const { stdout } = await this.runTmux([
      "display-message",
      "-p",
      "-t",
      paneId,
      "#{session_name}",
    ]);
    return stdout.trim() || undefined;
  }

  getCaptureLines(): number {
    return this.captureLines;
  }

  async discoverRemote(
    sshTarget: SshTarget,
  ): Promise<DiscoverTmuxSessionsResponse> {
    const tmuxCmd =
      "tmux list-panes -a -F '#{session_name}\t#{session_attached}\t#{window_active}\t#{pane_active}\t#{pane_id}\t#{pane_current_command}\t#{pane_current_path}'";

    let stdout: string;
    try {
      stdout = await this.runRemoteCommand(sshTarget, tmuxCmd);
    } catch (error) {
      if (isNoTmuxServerError(error)) {
        return { items: [], unavailable: false };
      }

      return { items: [], unavailable: true };
    }

    if (!stdout.trim()) {
      return { items: [], unavailable: false };
    }

    const discoveredSessions: AgentSessionRecord[] = [];

    for (const sessionInfo of summarizeTmuxSessions(parsePaneInfo(stdout))) {
      const hostId = sshTarget.host;
      const runtimeId = `tmux:${hostId}:${sessionInfo.sessionName}`;

      discoveredSessions.push({
        id: `preview:${runtimeId}`,
        workspaceId: sessionInfo.sessionName,
        hostId,
        sourceType: "remote-tmux-discovered",
        agentKind: sessionInfo.currentCommand,
        displayName: `tmux:${sessionInfo.sessionName}`,
        workingDirectory: sessionInfo.currentPath,
        connectionState: "online",
        interactionState: sessionInfo.interactionState,
        stateConfidence: "medium",
        outputPreview: buildTmuxStatusPreview(sessionInfo),
        controlMode: "observe",
        transportRef: {
          tmuxSession: sessionInfo.sessionName,
          tmuxPane: sessionInfo.paneId,
          runtimeId,
          sshHost: sshTarget.host,
          sshPort: sshTarget.port,
          sshUsername: sshTarget.username,
        },
        sshTarget,
        lastHeartbeatAt: new Date().toISOString(),
      });
    }

    return { items: discoveredSessions, unavailable: false };
  }

  async killSession(
    tmuxSessionName: string,
    sshTarget?: SshTarget,
  ): Promise<void> {
    if (sshTarget) {
      await this.runRemoteCommand(
        sshTarget,
        `tmux kill-session -t ${quoteForPosixShell(tmuxSessionName)}`,
      );
    } else {
      await this.runTmux(["kill-session", "-t", tmuxSessionName]);
    }
  }

  private runRemoteCommand(
    sshTarget: SshTarget,
    command: string,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const args = buildSshArgs(sshTarget, {
        batchMode: true,
        connectTimeoutSeconds: 5,
        remoteCommand: command,
      });

      const childProcess = spawn("ssh", args, {
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      childProcess.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });
      childProcess.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });

      childProcess.on("error", reject);
      childProcess.on("close", (code) => {
        if (code !== 0) {
          reject(
            new Error(
              stderr ||
                `ssh exited with code ${code}: ${formatSshDestination(
                  sshTarget,
                )}`,
            ),
          );
          return;
        }
        resolve(stdout.trim());
      });
    });
  }

  private runTmux(args: string[]): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const env = {
        ...(process.env as Record<string, string | undefined>),
      };
      delete env.TMUX;
      delete env.TMUX_PANE;

      const childProcess = spawn(TMUX_BINARY, args, {
        stdio: ["ignore", "pipe", "pipe"],
        env: env as Record<string, string>,
      });

      let stdout = "";
      let stderr = "";

      childProcess.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });

      childProcess.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });

      childProcess.on("error", reject);
      childProcess.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(stderr || `tmux exited with code ${code}`));
          return;
        }

        resolve({ stdout, stderr });
      });
    });
  }
}
