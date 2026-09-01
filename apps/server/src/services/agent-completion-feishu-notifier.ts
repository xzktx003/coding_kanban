import { execFile } from "node:child_process";

import type {
  AgentSessionRecord,
  FeishuNotificationSettingsResponse,
  ListAgentSessionsResponse,
} from "@agent-orchestrator/shared";

export interface FeishuCompletionEvent {
  sessionId: string;
  displayName: string;
  agentKind: string;
  workingDirectory?: string;
  summary: string;
  completedAt: string;
  completionId?: string;
}

export interface FeishuCompletionObservation {
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
}

export interface FeishuCompletionSenderLike {
  send(event: FeishuCompletionEvent): Promise<FeishuCompletionDelivery | void>;
}

export interface FeishuCompletionContentResolverLike {
  resolve(event: FeishuCompletionEvent): Promise<string | null>;
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
  return (
    session.agentKind.trim().toLowerCase() === "codex" ||
    Boolean(session.agentSessionId)
  );
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
          void this.#deliver(event);
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
    if (!this.#contentResolver?.inspectLatestCompletion) {
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
        !this.#observedCompletionIds.has(session.id),
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
      this.#observedCompletionIds.delete(sessionId);
      this.#deliveredCompletionIds.delete(sessionId);
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
    const inspect = this.#contentResolver?.inspectLatestCompletion;
    if (!inspect) {
      return;
    }

    let observation: FeishuCompletionObservation | null;
    try {
      observation = await inspect.call(this.#contentResolver, probe.event);
    } catch {
      this.#logError(
        new Error("Codex structured completion inspection failed"),
        probe.event,
      );
      return;
    }
    if (!this.#isActive) {
      return;
    }

    if (observation?.pendingContinuationSource) {
      return;
    }

    const sessionId = probe.event.sessionId;
    const hadBaseline = this.#observedCompletionIds.has(sessionId);
    const previousCompletionId = this.#observedCompletionIds.get(sessionId);
    this.#observedCompletionIds.set(
      sessionId,
      observation?.completionId ?? null,
    );
    if (!observation || previousCompletionId === observation.completionId) {
      return;
    }

    if (!hadBaseline && probe.baselineOnly) {
      return;
    }

    if (observation.shouldNotify === false) {
      return;
    }

    await this.#deliverObservation(probe.event, observation);
  }

  async #deliverObservation(
    event: FeishuCompletionEvent,
    observation: FeishuCompletionObservation,
  ): Promise<void> {
    if (
      this.#deliveredCompletionIds.get(event.sessionId) ===
      observation.completionId
    ) {
      return;
    }
    const deliveryKey = `${event.sessionId}:${observation.completionId}`;
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
      agentKind: "codex",
      summary: observation.content,
      completedAt: observation.completedAt,
      completionId: observation.completionId,
    };
    this.#completionDeliveryInFlight.add(deliveryKey);
    try {
      const delivery = await this.#sender.send(deliveryEvent);
      this.#recordDelivery(deliveryEvent, delivery);
      this.#deliveredCompletionIds.set(
        event.sessionId,
        observation.completionId,
      );
    } catch (error) {
      this.#logError(error, deliveryEvent);
    } finally {
      this.#completionDeliveryInFlight.delete(deliveryKey);
    }
  }

  async #deliver(event: FeishuCompletionEvent): Promise<void> {
    if (this.#contentResolver?.inspectLatestCompletion) {
      try {
        const observation =
          await this.#contentResolver.inspectLatestCompletion(event);
        if (observation) {
          if (observation.pendingContinuationSource) {
            return;
          }
          this.#observedCompletionIds.set(
            event.sessionId,
            observation.completionId,
          );
          if (observation.shouldNotify === false) {
            return;
          }
          await this.#deliverObservation(event, observation);
          return;
        }
      } catch {
        this.#logError(
          new Error("Codex structured completion inspection failed"),
          event,
        );
      }
    }

    let resolvedContent: string | null = null;
    if (this.#contentResolver) {
      try {
        resolvedContent = await this.#contentResolver.resolve(event);
      } catch {
        this.#logError(
          new Error("Codex completion content resolution failed"),
          event,
        );
      }
    }

    const deliveryEvent = resolvedContent?.trim()
      ? { ...event, agentKind: "codex", summary: resolvedContent }
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

  constructor(options: {
    nodeBinary?: string;
    scriptPath: string;
    fallbackWorkingDirectory: string;
    runCommand?: ScriptCommandRunner;
  }) {
    this.#nodeBinary = options.nodeBinary ?? process.execPath;
    this.#scriptPath = options.scriptPath;
    this.#fallbackWorkingDirectory = options.fallbackWorkingDirectory;
    this.#runCommand = options.runCommand ?? runScriptCommand;
  }

  async send(event: FeishuCompletionEvent): Promise<FeishuCompletionDelivery> {
    const notification = {
      type: "agent-turn-complete",
      "thread-id": `kanban-${event.sessionId}`,
      "turn-id": event.completionId ?? event.completedAt,
      cwd: event.workingDirectory ?? this.#fallbackWorkingDirectory,
      "agent-kind": event.agentKind,
      "display-name": event.displayName,
      "last-assistant-message": event.summary,
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
      return { messages };
    } catch {
      // execFile errors may repeat argv, which contains the task summary and cwd.
      throw new Error("Feishu notification delivery failed");
    }
  }
}
