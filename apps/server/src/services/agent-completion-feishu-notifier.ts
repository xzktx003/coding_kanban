import { execFile } from "node:child_process";

import type {
  AgentSessionRecord,
  FeishuNotificationSettingsResponse,
  ListAgentSessionsResponse,
} from "@agent-orchestrator/shared";
import { isClaudeAgentKind } from "@agent-orchestrator/shared";

import {
  FeishuCompletionFileReferenceService,
  type FeishuCompletionFileReference,
} from "./feishu-completion-file-reference-service.js";

export interface FeishuCompletionEvent {
  userQuestion?: string;
  codexThreadId?: string;
  transcriptAgentKind?: string;
  transcriptSessionId?: string;
  sessionId: string;
  displayName: string;
  agentKind: string;
  workingDirectory?: string;
  summary: string;
  completedAt: string;
  completionId?: string;
  allowLocalFileReferences?: boolean;
}

export interface FeishuCompletionObservation {
  userQuestion?: string;
  codexThreadId?: string;
  transcriptAgentKind?: string;
  transcriptSessionId?: string;
  completionId: string;
  content: string;
  completedAt: string;
  shouldNotify?: boolean;
  pendingContinuationSource?: boolean;
}

export interface FeishuCompletionDeliveryMessage {
  messageId: string;
  chatId: string;
}

export interface FeishuCompletionDelivery {
  messages: FeishuCompletionDeliveryMessage[];
  referencedFiles?: FeishuCompletionFileReference[];
}

export interface FeishuCompletionSenderLike {
  send(event: FeishuCompletionEvent): Promise<FeishuCompletionDelivery | void>;
}

export interface FeishuCompletionContentResolverLike {
  resolve(event: FeishuCompletionEvent): Promise<string | null>;
  inspectLatestCompletions?(
    event: FeishuCompletionEvent,
  ): Promise<FeishuCompletionObservation[]>;
  inspectLatestCompletion?(
    event: FeishuCompletionEvent,
  ): Promise<FeishuCompletionObservation | null>;
}

interface SnapshotSourceLike {
  subscribe(
    listener: (snapshot: ListAgentSessionsResponse) => void,
  ): () => void;
}

interface FeishuNotificationSettingsReaderLike {
  get(): Pick<FeishuNotificationSettingsResponse, "configured" | "enabled">;
}

interface FeishuCompletionDeliveryRecorderLike {
  record(
    event: FeishuCompletionEvent,
    delivery: FeishuCompletionDelivery,
  ): void;
}

interface AgentCompletionFeishuNotifierOptions {
  source: SnapshotSourceLike;
  restoredSnapshot?: ListAgentSessionsResponse;
  settings: FeishuNotificationSettingsReaderLike;
  sender: FeishuCompletionSenderLike;
  deliveryRecorder?: FeishuCompletionDeliveryRecorderLike;
  contentResolver?: FeishuCompletionContentResolverLike;
  structuredCompletionProbeDelayMs?: number;
  structuredCompletionProbeIntervalMs?: number;
  logError?: (error: unknown, event: FeishuCompletionEvent) => void;
}

interface PendingCompletionProbe {
  event: FeishuCompletionEvent;
  baselineOnly: boolean;
}

function isCompletionState(
  state: AgentSessionRecord["interactionState"],
): boolean {
  return state === "idle" || state === "exited" || state === "detached";
}

function canObserveStructuredCompletion(session: AgentSessionRecord): boolean {
  const agentKind = session.agentKind.trim().toLowerCase();
  return (
    agentKind === "codex" ||
    isClaudeAgentKind(agentKind) ||
    Boolean(session.agentSessionId) ||
    (agentKind === "node" && Boolean(session.transportRef?.tmuxSession))
  );
}

function canPrepareCodexLocalFileReferences(
  session: AgentSessionRecord,
): boolean {
  const agentKind = session.agentKind.trim().toLowerCase();
  return (
    (agentKind === "codex" || agentKind === "node") &&
    canObserveStructuredCompletion(session)
  );
}

function structuredDeliveryAgentKind(event: FeishuCompletionEvent): string {
  return isClaudeAgentKind(event.agentKind) ? "claude" : "codex";
}

function completionEventForSession(
  session: AgentSessionRecord,
  completedAt: string,
): FeishuCompletionEvent {
  return {
    sessionId: session.id,
    displayName: session.displayName,
    agentKind: session.agentKind,
    ...(session.workingDirectory
      ? { workingDirectory: session.workingDirectory }
      : {}),
    summary:
      session.lastAgentMessageSummary ??
      session.outputPreview ??
      "任务已经完成，请打开 Coding Kanban 查看结果。",
    completedAt,
    ...(canPrepareCodexLocalFileReferences(session) &&
    !session.sshTarget &&
    (!session.hostId || session.hostId === "local") &&
    session.workingDirectory
      ? { allowLocalFileReferences: true }
      : {}),
  };
}

export function collectFeishuCompletionEvents(
  previous: ListAgentSessionsResponse,
  current: ListAgentSessionsResponse,
): FeishuCompletionEvent[] {
  const previousById = new Map(
    previous.items.map((session) => [session.id, session]),
  );

  return current.items
    .filter((session) => {
      const earlier = previousById.get(session.id);
      return (
        earlier?.interactionState === "running" &&
        isCompletionState(session.interactionState)
      );
    })
    .map((session) => completionEventForSession(session, current.updatedAt));
}

export class AgentCompletionFeishuNotifier {
  readonly #source: SnapshotSourceLike;
  readonly #settings: FeishuNotificationSettingsReaderLike;
  readonly #sender: FeishuCompletionSenderLike;
  readonly #deliveryRecorder?: FeishuCompletionDeliveryRecorderLike;
  readonly #contentResolver?: FeishuCompletionContentResolverLike;
  readonly #structuredCompletionProbeDelayMs: number;
  readonly #structuredCompletionProbeIntervalMs: number;
  readonly #logError: (error: unknown, event: FeishuCompletionEvent) => void;
  readonly #armedSessionIds = new Set<string>();
  readonly #pendingRestoreSessionIds = new Set<string>();
  readonly #observedCompletionIds = new Map<string, string | null>();
  readonly #deliveredCompletionIds = new Map<string, string>();
  readonly #baselinedSessionIds = new Set<string>();
  readonly #observedSessionIds = new Set<string>();
  readonly #completionProbeTimers = new Map<string, NodeJS.Timeout>();
  readonly #lastCompletionProbeAt = new Map<string, number>();
  readonly #completionProbeInFlight = new Set<string>();
  readonly #pendingCompletionProbes = new Map<string, PendingCompletionProbe>();
  readonly #completionDeliveryInFlight = new Set<string>();
  #previousSnapshot: ListAgentSessionsResponse | null = null;
  #stop: (() => void) | null = null;
  #isActive = false;

  constructor(options: AgentCompletionFeishuNotifierOptions) {
    this.#source = options.source;
    this.#settings = options.settings;
    this.#sender = options.sender;
    this.#deliveryRecorder = options.deliveryRecorder;
    this.#contentResolver = options.contentResolver;
    this.#structuredCompletionProbeDelayMs = Math.max(
      0,
      options.structuredCompletionProbeDelayMs ?? 500,
    );
    this.#structuredCompletionProbeIntervalMs = Math.max(
      0,
      options.structuredCompletionProbeIntervalMs ?? 2_000,
    );
    this.#logError = options.logError ?? (() => {});
    for (const session of options.restoredSnapshot?.items ?? []) {
      if (session.interactionState === "running") {
        this.#armedSessionIds.add(session.id);
      }
      if (session.transportRef?.tmuxSession) {
        this.#pendingRestoreSessionIds.add(session.id);
      }
    }
  }

  start(): () => void {
    if (this.#stop) {
      return this.#stop;
    }

    this.#isActive = true;
    const unsubscribe = this.#source.subscribe((snapshot) => {
      const previous = this.#previousSnapshot;
      this.#previousSnapshot = snapshot;
      this.#observeStructuredCompletions(previous, snapshot);
      if (!previous) {
        if (this.#pendingRestoreSessionIds.size === 0) {
          for (const session of snapshot.items) {
            if (session.interactionState === "running") {
              this.#armedSessionIds.add(session.id);
            }
          }
        }
        return;
      }

      const previousById = new Map(
        previous.items.map((session) => [session.id, session]),
      );
      for (const session of snapshot.items) {
        const previousSession = previousById.get(session.id);
        if (
          session.interactionState === "running" &&
          previousSession?.interactionState !== "running"
        ) {
          if (!this.#pendingRestoreSessionIds.delete(session.id)) {
            this.#armedSessionIds.add(session.id);
          }
        } else if (!previousSession && session.interactionState === "running") {
          this.#armedSessionIds.add(session.id);
        }
      }

      for (const event of collectFeishuCompletionEvents(previous, snapshot)) {
        if (!this.#armedSessionIds.delete(event.sessionId)) {
          continue;
        }
        try {
          const settings = this.#settings.get();
          if (!settings.configured || !settings.enabled) {
            continue;
          }
          const session = snapshot.items.find(
            (candidate) => candidate.id === event.sessionId,
          );
          void this.#deliver(
            event,
            session ? canObserveStructuredCompletion(session) : false,
          );
        } catch (error) {
          this.#logError(error, event);
        }
      }
    });

    this.#stop = () => {
      this.#isActive = false;
      unsubscribe();
      this.#stop = null;
      this.#previousSnapshot = null;
      this.#armedSessionIds.clear();
      this.#pendingRestoreSessionIds.clear();
      this.#observedCompletionIds.clear();
      this.#deliveredCompletionIds.clear();
      this.#baselinedSessionIds.clear();
      this.#observedSessionIds.clear();
      for (const timer of this.#completionProbeTimers.values()) {
        clearTimeout(timer);
      }
      this.#completionProbeTimers.clear();
      this.#lastCompletionProbeAt.clear();
      this.#completionProbeInFlight.clear();
      this.#pendingCompletionProbes.clear();
      this.#completionDeliveryInFlight.clear();
    };
    return this.#stop;
  }

  #observeStructuredCompletions(
    previous: ListAgentSessionsResponse | null,
    current: ListAgentSessionsResponse,
  ): void {
    if (
      !this.#contentResolver?.inspectLatestCompletions &&
      !this.#contentResolver?.inspectLatestCompletion
    ) {
      return;
    }

    const previousById = new Map(
      previous?.items.map((session) => [session.id, session]) ?? [],
    );
    const currentIds = new Set(current.items.map((session) => session.id));
    for (const session of current.items) {
      this.#observedSessionIds.add(session.id);
      if (!canObserveStructuredCompletion(session)) {
        continue;
      }
      const earlier = previousById.get(session.id);
      const shouldProbe =
        !earlier ||
        earlier.lastOutputAt !== session.lastOutputAt ||
        earlier.agentSessionId !== session.agentSessionId ||
        earlier.interactionState !== session.interactionState ||
        earlier.connectionState !== session.connectionState ||
        earlier.transportRef?.tmuxPane !== session.transportRef?.tmuxPane ||
        earlier.transportRef?.processId !== session.transportRef?.processId;
      if (!shouldProbe) {
        continue;
      }

      this.#scheduleCompletionProbe(
        completionEventForSession(session, current.updatedAt),
        !this.#baselinedSessionIds.has(session.id),
        earlier ? this.#structuredCompletionProbeDelayMs : 0,
      );
    }

    for (const sessionId of this.#observedSessionIds) {
      if (currentIds.has(sessionId)) {
        continue;
      }
      const timer = this.#completionProbeTimers.get(sessionId);
      if (timer) {
        clearTimeout(timer);
      }
      this.#completionProbeTimers.delete(sessionId);
      this.#lastCompletionProbeAt.delete(sessionId);
      this.#clearCompletionState(sessionId);
      this.#baselinedSessionIds.delete(sessionId);
      this.#observedSessionIds.delete(sessionId);
      this.#pendingCompletionProbes.delete(sessionId);
    }
  }

  #scheduleCompletionProbe(
    event: FeishuCompletionEvent,
    baselineOnly: boolean,
    delayMs: number,
  ): void {
    const existingTimer = this.#completionProbeTimers.get(event.sessionId);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.#completionProbeTimers.delete(event.sessionId);
    }

    const elapsedSinceLastProbe =
      Date.now() - (this.#lastCompletionProbeAt.get(event.sessionId) ?? 0);
    const effectiveDelayMs = Math.max(
      delayMs,
      this.#structuredCompletionProbeIntervalMs - elapsedSinceLastProbe,
    );

    if (effectiveDelayMs <= 0) {
      this.#queueCompletionProbe({ event, baselineOnly });
      return;
    }

    const timer = setTimeout(() => {
      this.#completionProbeTimers.delete(event.sessionId);
      this.#queueCompletionProbe({ event, baselineOnly });
    }, effectiveDelayMs);
    timer.unref();
    this.#completionProbeTimers.set(event.sessionId, timer);
  }

  #queueCompletionProbe(probe: PendingCompletionProbe): void {
    const sessionId = probe.event.sessionId;
    if (this.#completionProbeInFlight.has(sessionId)) {
      const pending = this.#pendingCompletionProbes.get(sessionId);
      this.#pendingCompletionProbes.set(sessionId, {
        event: probe.event,
        baselineOnly: pending
          ? pending.baselineOnly && probe.baselineOnly
          : probe.baselineOnly,
      });
      return;
    }

    this.#completionProbeInFlight.add(sessionId);
    this.#lastCompletionProbeAt.set(sessionId, Date.now());
    void this.#runCompletionProbe(probe).finally(() => {
      this.#completionProbeInFlight.delete(sessionId);
      const pending = this.#pendingCompletionProbes.get(sessionId);
      this.#pendingCompletionProbes.delete(sessionId);
      if (pending && this.#isActive) {
        this.#queueCompletionProbe(pending);
      }
    });
  }

  async #runCompletionProbe(probe: PendingCompletionProbe): Promise<void> {
    let observations: FeishuCompletionObservation[];
    try {
      observations = await this.#inspectLatestCompletions(probe.event);
    } catch {
      this.#logError(
        new Error("Agent structured completion inspection failed"),
        probe.event,
      );
      return;
    }
    if (!this.#isActive) {
      return;
    }

    const sessionId = probe.event.sessionId;
    const establishBaseline =
      probe.baselineOnly && !this.#baselinedSessionIds.has(sessionId);
    this.#baselinedSessionIds.add(sessionId);
    for (const observation of observations) {
      if (observation.pendingContinuationSource) {
        continue;
      }
      const streamKey = this.#completionStreamKey(sessionId, observation);
      const hadBaseline = this.#observedCompletionIds.has(streamKey);
      const previousCompletionId = this.#observedCompletionIds.get(streamKey);
      this.#observedCompletionIds.set(streamKey, observation.completionId);
      if (previousCompletionId === observation.completionId) {
        continue;
      }
      if (!hadBaseline && establishBaseline) {
        continue;
      }
      if (observation.shouldNotify === false) {
        continue;
      }
      await this.#deliverObservation(probe.event, observation);
    }
  }

  async #deliverObservation(
    event: FeishuCompletionEvent,
    observation: FeishuCompletionObservation,
  ): Promise<void> {
    const streamKey = this.#completionStreamKey(event.sessionId, observation);
    if (
      this.#deliveredCompletionIds.get(streamKey) === observation.completionId
    ) {
      return;
    }
    const deliveryKey = `${streamKey}:${observation.completionId}`;
    if (this.#completionDeliveryInFlight.has(deliveryKey)) {
      return;
    }

    let settings: Pick<
      FeishuNotificationSettingsResponse,
      "configured" | "enabled"
    >;
    try {
      settings = this.#settings.get();
    } catch (error) {
      this.#logError(error, event);
      return;
    }
    if (!settings.configured || !settings.enabled) {
      return;
    }

    const deliveryEvent: FeishuCompletionEvent = {
      ...event,
      agentKind: structuredDeliveryAgentKind(event),
      summary: observation.content,
      ...(observation.userQuestion
        ? { userQuestion: observation.userQuestion }
        : {}),
      ...(observation.codexThreadId
        ? { codexThreadId: observation.codexThreadId }
        : {}),
      ...(observation.transcriptAgentKind
        ? { transcriptAgentKind: observation.transcriptAgentKind }
        : {}),
      ...(observation.transcriptSessionId
        ? { transcriptSessionId: observation.transcriptSessionId }
        : {}),
      completedAt: observation.completedAt,
      completionId: observation.completionId,
    };
    this.#completionDeliveryInFlight.add(deliveryKey);
    try {
      const delivery = await this.#sender.send(deliveryEvent);
      this.#recordDelivery(deliveryEvent, delivery);
      this.#deliveredCompletionIds.set(streamKey, observation.completionId);
    } catch (error) {
      this.#logError(error, deliveryEvent);
    } finally {
      this.#completionDeliveryInFlight.delete(deliveryKey);
    }
  }

  async #deliver(
    event: FeishuCompletionEvent,
    requiresStructuredCompletion: boolean,
  ): Promise<void> {
    if (
      this.#contentResolver?.inspectLatestCompletions ||
      this.#contentResolver?.inspectLatestCompletion
    ) {
      try {
        const observations = await this.#inspectLatestCompletions(event);
        if (observations.length > 0) {
          this.#baselinedSessionIds.add(event.sessionId);
          for (const observation of observations) {
            if (observation.pendingContinuationSource) {
              continue;
            }
            const streamKey = this.#completionStreamKey(
              event.sessionId,
              observation,
            );
            const previousCompletionId =
              this.#observedCompletionIds.get(streamKey);
            const wasObserved = this.#observedCompletionIds.has(streamKey);
            this.#observedCompletionIds.set(
              streamKey,
              observation.completionId,
            );
            if (
              this.#contentResolver.inspectLatestCompletions &&
              wasObserved &&
              previousCompletionId === observation.completionId
            ) {
              continue;
            }
            if (observation.shouldNotify === false) {
              continue;
            }
            await this.#deliverObservation(event, observation);
          }
          return;
        }
      } catch {
        this.#logError(
          new Error("Agent structured completion inspection failed"),
          event,
        );
      }
    }

    if (requiresStructuredCompletion) {
      return;
    }

    let resolvedContent: string | null = null;
    if (this.#contentResolver) {
      try {
        resolvedContent = await this.#contentResolver.resolve(event);
      } catch {
        this.#logError(
          new Error("Agent completion content resolution failed"),
          event,
        );
      }
    }

    const deliveryEvent = resolvedContent?.trim()
      ? {
          ...event,
          agentKind: structuredDeliveryAgentKind(event),
          summary: resolvedContent,
        }
      : event;
    try {
      const delivery = await this.#sender.send(deliveryEvent);
      this.#recordDelivery(deliveryEvent, delivery);
    } catch (error) {
      this.#logError(error, deliveryEvent);
    }
  }

  #recordDelivery(
    event: FeishuCompletionEvent,
    delivery: FeishuCompletionDelivery | void,
  ): void {
    if (!delivery || delivery.messages.length === 0) {
      return;
    }
    try {
      this.#deliveryRecorder?.record(event, delivery);
    } catch (error) {
      this.#logError(error, event);
    }
  }

  async #inspectLatestCompletions(
    event: FeishuCompletionEvent,
  ): Promise<FeishuCompletionObservation[]> {
    if (this.#contentResolver?.inspectLatestCompletions) {
      return this.#contentResolver.inspectLatestCompletions(event);
    }
    const observation =
      await this.#contentResolver?.inspectLatestCompletion?.(event);
    return observation ? [observation] : [];
  }

  #completionStreamKey(
    sessionId: string,
    observation: FeishuCompletionObservation,
  ): string {
    if (observation.transcriptSessionId) {
      return `${sessionId}\u0000${observation.transcriptAgentKind ?? "agent"}\u0000${observation.transcriptSessionId}`;
    }
    return observation.codexThreadId
      ? `${sessionId}\u0000${observation.codexThreadId}`
      : sessionId;
  }

  #clearCompletionState(sessionId: string): void {
    const prefix = `${sessionId}\u0000`;
    for (const key of this.#observedCompletionIds.keys()) {
      if (key === sessionId || key.startsWith(prefix)) {
        this.#observedCompletionIds.delete(key);
      }
    }
    for (const key of this.#deliveredCompletionIds.keys()) {
      if (key === sessionId || key.startsWith(prefix)) {
        this.#deliveredCompletionIds.delete(key);
      }
    }
  }
}

interface ScriptCommandOptions {
  timeout: number;
  encoding: "utf8";
  maxBuffer: number;
  windowsHide: true;
}

type ScriptCommandRunner = (
  binary: string,
  args: string[],
  options: ScriptCommandOptions,
) => Promise<{ stdout: string }>;

function runScriptCommand(
  binary: string,
  args: string[],
  options: ScriptCommandOptions,
): Promise<{ stdout: string }> {
  return new Promise((resolve, reject) => {
    execFile(binary, args, options, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({ stdout });
    });
  });
}

export class ScriptFeishuCompletionSender implements FeishuCompletionSenderLike {
  readonly #nodeBinary: string;
  readonly #scriptPath: string;
  readonly #fallbackWorkingDirectory: string;
  readonly #runCommand: ScriptCommandRunner;
  readonly #quickRepliesAvailable: () => boolean;
  readonly #fileReferences: Pick<
    FeishuCompletionFileReferenceService,
    "prepare"
  >;

  constructor(options: {
    nodeBinary?: string;
    scriptPath: string;
    fallbackWorkingDirectory: string;
    runCommand?: ScriptCommandRunner;
    quickRepliesAvailable?: () => boolean;
    fileReferences?: Pick<FeishuCompletionFileReferenceService, "prepare">;
  }) {
    this.#nodeBinary = options.nodeBinary ?? process.execPath;
    this.#scriptPath = options.scriptPath;
    this.#fallbackWorkingDirectory = options.fallbackWorkingDirectory;
    this.#runCommand = options.runCommand ?? runScriptCommand;
    this.#quickRepliesAvailable =
      options.quickRepliesAvailable ?? (() => false);
    this.#fileReferences =
      options.fileReferences ?? new FeishuCompletionFileReferenceService();
  }

  async send(event: FeishuCompletionEvent): Promise<FeishuCompletionDelivery> {
    let summary = event.summary;
    let referencedFiles: FeishuCompletionFileReference[] = [];
    if (
      event.allowLocalFileReferences &&
      event.codexThreadId &&
      event.workingDirectory
    ) {
      try {
        const prepared = await this.#fileReferences.prepare({
          content: event.summary,
          workingDirectory: event.workingDirectory,
        });
        summary = prepared.content;
        referencedFiles = prepared.references;
      } catch {
        // File affordances must never block the completion notification.
      }
    }
    const notification = {
      type: "agent-turn-complete",
      "thread-id": `kanban-${event.sessionId}`,
      "turn-id": event.completionId ?? event.completedAt,
      cwd: event.workingDirectory ?? this.#fallbackWorkingDirectory,
      "agent-kind": event.agentKind,
      "display-name": event.displayName,
      "last-assistant-message": summary,
      ...(event.userQuestion ? { "user-question": event.userQuestion } : {}),
      ...(event.codexThreadId || event.transcriptSessionId
        ? { "records-available": true }
        : {}),
      ...(this.#canOfferQuickReplies(event)
        ? { "quick-replies-available": true }
        : {}),
      ...(event.transcriptAgentKind
        ? { "transcript-agent-kind": event.transcriptAgentKind }
        : {}),
      ...(event.transcriptSessionId
        ? { "transcript-session-id": event.transcriptSessionId }
        : {}),
      ...(referencedFiles.length > 0
        ? { "referenced-files": referencedFiles }
        : {}),
    };

    try {
      const { stdout } = await this.#runCommand(
        this.#nodeBinary,
        [this.#scriptPath, "--kanban", JSON.stringify(notification)],
        {
          encoding: "utf8",
          maxBuffer: 64 * 1024,
          timeout: 300_000,
          windowsHide: true,
        },
      );
      const parsed = JSON.parse(stdout) as {
        status?: unknown;
        messages?: unknown;
      };
      if (parsed.status !== "sent" || !Array.isArray(parsed.messages)) {
        throw new Error("invalid delivery result");
      }
      const messages = parsed.messages.flatMap((message) => {
        if (!message || typeof message !== "object") {
          return [];
        }
        const candidate = message as Record<string, unknown>;
        return typeof candidate.messageId === "string" &&
          typeof candidate.chatId === "string"
          ? [
              {
                messageId: candidate.messageId,
                chatId: candidate.chatId,
              },
            ]
          : [];
      });
      return {
        messages,
        ...(referencedFiles.length > 0 ? { referencedFiles } : {}),
      };
    } catch {
      // execFile errors may repeat argv, which contains the task summary and cwd.
      throw new Error("Feishu notification delivery failed");
    }
  }

  #canOfferQuickReplies(event: FeishuCompletionEvent): boolean {
    if (
      event.agentKind.trim().toLowerCase() !== "codex" ||
      !event.codexThreadId?.trim()
    ) {
      return false;
    }
    try {
      return this.#quickRepliesAvailable();
    } catch {
      return false;
    }
  }
}
