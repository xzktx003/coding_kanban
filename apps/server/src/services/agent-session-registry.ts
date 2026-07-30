import { randomUUID } from "node:crypto";

import {
  interactionStateOrder,
  type AgentOutputEntry,
  type AgentOutputStream,
  type AgentSessionRecord,
  type AgentSessionDetailResponse,
  type FocusAgentSessionInput,
  type ListAgentSessionsResponse,
  type RegisterAgentSessionInput,
  type StdinAgentSessionInput,
} from "@agent-orchestrator/shared";

import { DEFAULT_TERMINAL_REGISTRY_OUTPUT_ENTRIES } from "../config/server-runtime-config.js";

type SnapshotListener = (snapshot: ListAgentSessionsResponse) => void;

const DEFAULT_SNAPSHOT_THROTTLE_MS = 1_000;
const MAX_INFERENCE_WINDOW_CHARS = 4096;
const DEFAULT_IDLE_DETECTION_INTERVAL_MS = 5_000;
const DEFAULT_IDLE_THRESHOLD_MS = 15_000;

const ANSI_ESCAPE_PATTERN =
  /\u001B\][^\u0007]*(?:\u0007|\u001B\\)|\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;

function pickOutputPreview(text: string): string | undefined {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.at(-1)?.slice(0, 160);
}

function normalizeTerminalText(text: string): string {
  return text
    .replace(ANSI_ESCAPE_PATTERN, "")
    .replace(/\u0007/g, "")
    .replace(/\r/g, "\n")
    .replace(/[\t\f\v ]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function mergeScreenWindow(previous: string, incoming: string): string {
  const normalizedIncoming = normalizeTerminalText(incoming);

  if (!normalizedIncoming) {
    return previous;
  }

  if (
    previous === normalizedIncoming ||
    previous.endsWith(normalizedIncoming) ||
    previous.endsWith(`\n${normalizedIncoming}`)
  ) {
    return previous;
  }

  const merged = previous
    ? `${previous}\n${normalizedIncoming}`
    : normalizedIncoming;

  return merged.slice(-MAX_INFERENCE_WINDOW_CHARS);
}

function byInteractionState(
  left: AgentSessionRecord,
  right: AgentSessionRecord,
  getSessionOrder: (agentSessionId: string) => number,
): number {
  // Only sort by displayName (宫格名)
  return left.displayName.localeCompare(right.displayName);
}

export class AgentSessionRegistry {
  private readonly sessions = new Map<string, AgentSessionRecord>();
  private readonly outputEntries = new Map<string, AgentOutputEntry[]>();
  private readonly screenWindows = new Map<string, string>();
  private readonly sessionOrder = new Map<string, number>();
  private readonly listeners = new Set<SnapshotListener>();
  private pendingSnapshotTimer: NodeJS.Timeout | null = null;
  private idleDetectionTimer: NodeJS.Timeout | null = null;
  private activeAgentSessionId: string | null = null;
  private lastSnapshotEmittedAt = 0;
  private nextSessionOrder = 0;
  private readonly idleThresholdMs: number;
  private readonly idleDetectionIntervalMs: number;

  constructor(
    private readonly snapshotThrottleMs = DEFAULT_SNAPSHOT_THROTTLE_MS,
    private readonly maxOutputEntries = DEFAULT_TERMINAL_REGISTRY_OUTPUT_ENTRIES,
    idleThresholdMs = DEFAULT_IDLE_THRESHOLD_MS,
    idleDetectionIntervalMs = DEFAULT_IDLE_DETECTION_INTERVAL_MS,
  ) {
    this.idleThresholdMs = idleThresholdMs;
    this.idleDetectionIntervalMs = idleDetectionIntervalMs;
  }

  list(): ListAgentSessionsResponse {
    return {
      items: [...this.sessions.values()].sort((left, right) =>
        byInteractionState(left, right, this.getSessionOrder),
      ),
      activeAgentSessionId: this.activeAgentSessionId,
      updatedAt: new Date().toISOString(),
    };
  }

  restore(snapshot: ListAgentSessionsResponse): void {
    this.sessions.clear();
    this.outputEntries.clear();
    this.screenWindows.clear();
    this.sessionOrder.clear();
    this.nextSessionOrder = 0;

    for (const persisted of snapshot.items) {
      const tmuxSession = persisted.transportRef?.tmuxSession;
      const restored: AgentSessionRecord = {
        ...persisted,
        connectionState: "offline",
        interactionState: tmuxSession ? "detached" : "exited",
        stateConfidence: "high",
        outputPreview: tmuxSession
          ? "服务已更新，等待恢复 tmux 会话"
          : "direct 会话无法保留原 PTY，需要手动恢复",
        transportRef: persisted.transportRef
          ? {
              tmuxSession: persisted.transportRef.tmuxSession,
              tmuxPane: persisted.transportRef.tmuxPane,
              sshHost: persisted.transportRef.sshHost,
              sshPort: persisted.transportRef.sshPort,
              sshUsername: persisted.transportRef.sshUsername,
            }
          : undefined,
      };

      this.sessions.set(restored.id, restored);
      this.outputEntries.set(restored.id, []);
      this.screenWindows.set(restored.id, "");
      this.sessionOrder.set(restored.id, this.nextSessionOrder);
      this.nextSessionOrder += 1;
    }

    this.activeAgentSessionId =
      snapshot.activeAgentSessionId &&
      this.sessions.has(snapshot.activeAgentSessionId)
        ? snapshot.activeAgentSessionId
        : null;
    this.emitSnapshot();
  }

  subscribe(listener: SnapshotListener): () => void {
    this.listeners.add(listener);
    this.startIdleDetection();
    this.sweepIdleSessions();
    listener(this.list());

    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) {
        this.clearPendingSnapshot();
        this.stopIdleDetection();
      }
    };
  }

  get(agentSessionId: string): AgentSessionRecord {
    const agentSession = this.sessions.get(agentSessionId);

    if (!agentSession) {
      throw new Error(`Unknown agent session: ${agentSessionId}`);
    }

    return agentSession;
  }

  has(agentSessionId: string): boolean {
    return this.sessions.has(agentSessionId);
  }

  getDetail(agentSessionId: string): AgentSessionDetailResponse {
    return {
      agentSession: this.get(agentSessionId),
      outputEntries: this.outputEntries.get(agentSessionId) ?? [],
    };
  }

  register(input: RegisterAgentSessionInput): AgentSessionRecord {
    const now = new Date().toISOString();

    const agentSession: AgentSessionRecord = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      hostId: input.hostId,
      sourceType: input.sourceType,
      agentKind: input.agentKind,
      displayName: input.displayName,
      workingDirectory: input.workingDirectory,
      connectionState: input.connectionState ?? "online",
      interactionState: input.interactionState ?? "idle",
      stateConfidence: input.stateConfidence,
      outputPreview: input.outputPreview,
      controlMode: input.controlMode,
      lastHeartbeatAt: now,
      lastOutputAt: input.outputPreview ? now : undefined,
      transportRef: input.transportRef,
      agentSessionId: input.agentSessionId,
      sshTarget: input.sshTarget,
      remoteCommand: input.remoteCommand,
    };

    this.sessions.set(agentSession.id, agentSession);
    this.outputEntries.set(agentSession.id, []);
    this.screenWindows.set(agentSession.id, "");
    this.sessionOrder.set(agentSession.id, this.nextSessionOrder);
    this.nextSessionOrder += 1;

    if (!this.activeAgentSessionId) {
      this.activeAgentSessionId = agentSession.id;
    }

    this.emitSnapshot();

    return agentSession;
  }

  findByRuntimeId(runtimeId: string): AgentSessionRecord | undefined {
    return [...this.sessions.values()].find(
      ({ transportRef }) => transportRef?.runtimeId === runtimeId,
    );
  }

  upsertByTransportRef(
    runtimeId: string,
    input: RegisterAgentSessionInput,
  ): AgentSessionRecord {
    const existingSession = [...this.sessions.values()].find(
      ({ transportRef }) => transportRef?.runtimeId === runtimeId,
    );

    if (!existingSession) {
      return this.register(input);
    }

    const nextSession: AgentSessionRecord = {
      ...existingSession,
      ...input,
      id: existingSession.id,
      controlMode: input.controlMode ?? existingSession.controlMode,
      transportRef: {
        ...existingSession.transportRef,
        ...input.transportRef,
      },
      lastHeartbeatAt: new Date().toISOString(),
    };

    this.sessions.set(existingSession.id, nextSession);
    this.emitSnapshot();

    return nextSession;
  }

  focus(input: FocusAgentSessionInput): ListAgentSessionsResponse {
    if (!this.sessions.has(input.agentSessionId)) {
      throw new Error(`Unknown agent session: ${input.agentSessionId}`);
    }

    this.activeAgentSessionId = input.agentSessionId;
    this.emitSnapshot();

    return this.list();
  }

  writeToSession(
    agentSessionId: string,
    input: StdinAgentSessionInput,
  ): AgentSessionRecord {
    this.noteUserInput(agentSessionId, input.input);

    const agentSession = this.get(agentSessionId);

    const now = new Date().toISOString();
    const nextSession: AgentSessionRecord = {
      ...agentSession,
      lastHeartbeatAt: now,
      outputPreview: input.input.trim()
        ? `Last input: ${input.input.trim()}`
        : agentSession.outputPreview,
    };

    this.sessions.set(agentSessionId, nextSession);
    this.pushOutputEntry(agentSessionId, {
      id: randomUUID(),
      timestamp: now,
      stream: "system",
      text: `> ${input.input.trim() || "[empty input]"}`,
    });
    this.emitSnapshot();

    return nextSession;
  }

  appendOutput(
    agentSessionId: string,
    text: string,
    stream: AgentOutputStream,
  ): AgentSessionRecord {
    const agentSession = this.get(agentSessionId);
    const now = new Date().toISOString();
    const outputPreview = pickOutputPreview(text) ?? agentSession.outputPreview;
    const nextScreenWindow = mergeScreenWindow(
      this.screenWindows.get(agentSessionId) ?? "",
      text,
    );
    const screenChanged =
      stream !== "system" &&
      nextScreenWindow !== (this.screenWindows.get(agentSessionId) ?? "");

    if (screenChanged) {
      this.screenWindows.set(agentSessionId, nextScreenWindow);
    }

    const shouldKeepRunningState =
      screenChanged &&
      agentSession.interactionState !== "idle" &&
      this.shouldKeepRunningState(agentSession);

    const nextSession: AgentSessionRecord = {
      ...agentSession,
      lastHeartbeatAt: now,
      lastOutputAt: screenChanged ? now : agentSession.lastOutputAt,
      outputPreview: screenChanged ? outputPreview : agentSession.outputPreview,
      interactionState: shouldKeepRunningState
        ? "running"
        : agentSession.interactionState,
      stateConfidence: shouldKeepRunningState
        ? "medium"
        : agentSession.stateConfidence,
      lastRefreshedAt: now,
    };

    this.sessions.set(agentSessionId, nextSession);
    this.pushOutputEntry(agentSessionId, {
      id: randomUUID(),
      timestamp: now,
      stream,
      text,
    });
    this.emitSnapshotSoon();

    return nextSession;
  }

  replaceOutputEntries(
    agentSessionId: string,
    entries: AgentOutputEntry[],
  ): AgentSessionDetailResponse {
    this.get(agentSessionId);
    this.outputEntries.set(
      agentSessionId,
      entries.slice(-this.maxOutputEntries),
    );
    this.emitSnapshot();

    return this.getDetail(agentSessionId);
  }

  getOutputEntryLimit(): number {
    return this.maxOutputEntries;
  }

  syncCapturedScreen(
    agentSessionId: string,
    screenText: string,
  ): AgentSessionRecord {
    const agentSession = this.get(agentSessionId);
    const normalizedScreen = normalizeTerminalText(screenText).slice(
      -MAX_INFERENCE_WINDOW_CHARS,
    );
    const previousScreen = this.screenWindows.get(agentSessionId) ?? "";
    const nowMs = Date.now();

    if (normalizedScreen !== previousScreen) {
      this.screenWindows.set(agentSessionId, normalizedScreen);
    }

    const screenChanged = normalizedScreen !== previousScreen;
    const now = new Date(nowMs).toISOString();
    const shouldKeepRunningState =
      agentSession.controlMode !== "observe" && screenChanged;

    return this.updateSession(agentSessionId, {
      interactionState:
        agentSession.controlMode === "observe"
          ? "detached"
          : shouldKeepRunningState
            ? "running"
            : agentSession.interactionState,
      stateConfidence:
        agentSession.controlMode === "observe"
          ? "high"
          : shouldKeepRunningState
            ? "medium"
            : agentSession.stateConfidence,
      lastHeartbeatAt: now,
      lastOutputAt: screenChanged ? now : agentSession.lastOutputAt,
      lastRefreshedAt: now,
    });
  }

  updateSession(
    agentSessionId: string,
    updater: Partial<AgentSessionRecord>,
  ): AgentSessionRecord {
    const agentSession = this.get(agentSessionId);
    const nextSession: AgentSessionRecord = {
      ...agentSession,
      ...updater,
      id: agentSession.id,
      controlMode: updater.controlMode ?? agentSession.controlMode,
      transportRef: {
        ...agentSession.transportRef,
        ...updater.transportRef,
      },
    };

    this.sessions.set(agentSessionId, nextSession);
    this.emitSnapshot();

    return nextSession;
  }

  markExited(
    agentSessionId: string,
    exitCode: number | null,
    signal: NodeJS.Signals | null,
  ): AgentSessionRecord {
    const exitSummary =
      exitCode !== null
        ? `Process exited with code ${exitCode}`
        : `Process exited with signal ${signal ?? "unknown"}`;

    const nextSession = this.updateSession(agentSessionId, {
      connectionState: "offline",
      interactionState: "exited",
      stateConfidence: "high",
      outputPreview: exitSummary,
      lastHeartbeatAt: new Date().toISOString(),
      lastRefreshedAt: new Date().toISOString(),
    });

    this.pushOutputEntry(agentSessionId, {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      stream: "system",
      text: exitSummary,
    });
    this.emitSnapshot();

    return nextSession;
  }

  remove(agentSessionId: string): void {
    this.sessions.delete(agentSessionId);
    this.outputEntries.delete(agentSessionId);
    this.screenWindows.delete(agentSessionId);
    this.sessionOrder.delete(agentSessionId);
    if (this.activeAgentSessionId === agentSessionId) {
      this.activeAgentSessionId = null;
    }
    this.emitSnapshot();
  }

  private pushOutputEntry(
    agentSessionId: string,
    outputEntry: AgentOutputEntry,
  ): void {
    const currentEntries = this.outputEntries.get(agentSessionId) ?? [];
    currentEntries.push(outputEntry);
    this.outputEntries.set(
      agentSessionId,
      currentEntries.slice(-this.maxOutputEntries),
    );
  }

  private getSessionOrder = (agentSessionId: string): number =>
    this.sessionOrder.get(agentSessionId) ?? Number.MAX_SAFE_INTEGER;

  private emitSnapshot(): void {
    this.clearPendingSnapshot();
    this.emitSnapshotNow();
  }

  private emitSnapshotNow(): void {
    this.lastSnapshotEmittedAt = Date.now();
    const snapshot = this.list();

    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }

  private emitSnapshotSoon(): void {
    if (this.listeners.size === 0) {
      return;
    }

    if (this.snapshotThrottleMs <= 0) {
      this.emitSnapshotNow();
      return;
    }

    const elapsedMs = Date.now() - this.lastSnapshotEmittedAt;
    if (elapsedMs >= this.snapshotThrottleMs) {
      this.emitSnapshotNow();
      return;
    }

    if (this.pendingSnapshotTimer) {
      return;
    }

    const delayMs = this.snapshotThrottleMs - elapsedMs;
    this.pendingSnapshotTimer = setTimeout(() => {
      this.pendingSnapshotTimer = null;
      this.emitSnapshotNow();
    }, delayMs);
    this.pendingSnapshotTimer.unref();
  }

  private clearPendingSnapshot(): void {
    if (!this.pendingSnapshotTimer) {
      return;
    }

    clearTimeout(this.pendingSnapshotTimer);
    this.pendingSnapshotTimer = null;
  }

  noteUserInput(agentSessionId: string, input: string): AgentSessionRecord {
    const agentSession = this.get(agentSessionId);

    if (agentSession.interactionState === "exited") {
      return agentSession;
    }

    return this.updateSession(agentSessionId, {
      interactionState: "running",
      stateConfidence: "medium",
      lastHeartbeatAt: new Date().toISOString(),
    });
  }

  private shouldKeepRunningState(agentSession: AgentSessionRecord): boolean {
    return (
      agentSession.connectionState === "online" &&
      agentSession.sourceType !== "remote-tmux-discovered"
    );
  }

  private startIdleDetection(): void {
    if (this.idleDetectionTimer) {
      return;
    }

    this.idleDetectionTimer = setInterval(
      () => this.sweepIdleSessions(),
      this.idleDetectionIntervalMs,
    );
    this.idleDetectionTimer.unref();
  }

  private stopIdleDetection(): void {
    if (!this.idleDetectionTimer) {
      return;
    }

    clearInterval(this.idleDetectionTimer);
    this.idleDetectionTimer = null;
  }

  private sweepIdleSessions(): void {
    const now = Date.now();
    let changed = false;

    for (const [id, session] of this.sessions) {
      if (
        session.interactionState !== "running" ||
        session.connectionState !== "online"
      ) {
        continue;
      }

      const lastActivity = session.lastOutputAt ?? session.lastHeartbeatAt;
      if (!lastActivity) {
        continue;
      }

      const elapsed = now - new Date(lastActivity).getTime();
      if (elapsed >= this.idleThresholdMs) {
        this.sessions.set(id, {
          ...session,
          interactionState: "idle",
          stateConfidence: "low",
        });
        changed = true;
      }
    }

    if (changed) {
      this.emitSnapshot();
    }
  }
}
