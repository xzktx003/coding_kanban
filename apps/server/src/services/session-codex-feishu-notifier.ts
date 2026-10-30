import { readFile } from "node:fs/promises";

import type {
  FeishuCompletionEvent,
  FeishuCompletionDelivery,
  FeishuCompletionSenderLike,
} from "./agent-completion-feishu-notifier.js";
import { writeDurableJson } from "./durable-json.js";

interface SettingsLike {
  get(): { configured: boolean; enabled: boolean };
}

interface SessionCodexFeishuNotifierOptions {
  file?: string;
  settings: SettingsLike;
  sender: FeishuCompletionSenderLike;
  deliveryRecorder?: {
    record(
      event: FeishuCompletionEvent,
      delivery: FeishuCompletionDelivery,
    ): void;
  };
  readThread(id: string, turnId?: string): Promise<any>;
  beforeSend?: (target: {
    threadId: string;
    turnId: string;
  }) => Promise<"ready" | "wait" | "superseded">;
  logError?: (error: unknown, event?: FeishuCompletionEvent) => void;
  retryIntervalMs?: number;
}

interface RuntimeEvent {
  seq: number;
  event: string;
  payload: any;
}

interface PendingNotification {
  key: string;
  threadId: string;
  turnId: string;
  eventTurn: any;
  enqueuedAt: string;
}

interface PersistedSessionCodexFeishuNotifierState {
  version: 1;
  instance?: string;
  cursor?: number;
  pending: Record<string, PendingNotification>;
  sent: Record<string, true>;
  skipped: Record<string, true>;
}

const STATE_VERSION = 1;
const DEFAULT_RETRY_INTERVAL_MS = 30_000;
const MAX_COMPLETED_KEYS = 1000;

class CompletionNotReadyError extends Error {}

function emptyState(): PersistedSessionCodexFeishuNotifierState {
  return {
    version: STATE_VERSION,
    pending: {},
    sent: {},
    skipped: {},
  };
}

function asObject(value: unknown): Record<string, any> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : null;
}

function turnStatus(turn: any): string | undefined {
  if (typeof turn?.status === "string") return turn.status;
  if (typeof turn?.status?.type === "string") return turn.status.type;
  return undefined;
}

function normalizeThread(readResult: any): Record<string, any> | null {
  return asObject(readResult?.thread) ?? asObject(readResult);
}

function isSubagentThread(thread: Record<string, any>): boolean {
  return (
    typeof thread.parentThreadId === "string" ||
    thread.source?.subAgent != null ||
    thread.source?.sub_agent != null
  );
}

function contentText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((part) => {
        if (typeof part === "string") return part;
        if (!part || typeof part !== "object") return "";
        const candidate = part as Record<string, unknown>;
        return typeof candidate.text === "string"
          ? candidate.text
          : typeof candidate.content === "string"
            ? candidate.content
            : "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function agentMessageText(item: any): string {
  return (
    contentText(item?.text) ||
    contentText(item?.message) ||
    contentText(item?.content) ||
    contentText(item?.payload?.text) ||
    contentText(item?.payload?.message) ||
    contentText(item?.payload?.content)
  ).trim();
}

function itemKind(item: any): string {
  return String(item?.type ?? item?.kind ?? item?.payload?.type ?? "");
}

function itemPhase(item: any): string | undefined {
  const phase = item?.phase ?? item?.payload?.phase;
  return typeof phase === "string" ? phase : undefined;
}

function finalAnswerFromTurn(turn: any): string | null {
  const items = Array.isArray(turn?.items) ? turn.items : [];
  const agentMessages = items.filter(
    (item: unknown) => itemKind(item) === "agentMessage",
  );
  const finalMessages = agentMessages.filter(
    (item: unknown) => itemPhase(item) === "final_answer",
  );
  const source =
    finalMessages.length > 0
      ? finalMessages
      : agentMessages.filter((item: unknown) => itemPhase(item) === undefined);
  const text = source
    .map((item: unknown) => agentMessageText(item))
    .filter(Boolean)
    .join("\n\n")
    .trim();
  return text || null;
}

function displayName(thread: Record<string, any>, threadId: string): string {
  if (typeof thread.name === "string" && thread.name.trim()) {
    return thread.name.trim();
  }
  return `Codex 会话 ${threadId.slice(0, 8)}`;
}

function workingDirectory(thread: Record<string, any>): string | undefined {
  const cwd = thread.cwd ?? thread.workingDirectory ?? thread.source?.cwd;
  return typeof cwd === "string" && cwd.trim() ? cwd : undefined;
}

function completedAt(eventTurn: any, historyTurn: any): string {
  for (const value of [
    historyTurn?.completedAt,
    historyTurn?.completed_at,
    eventTurn?.completedAt,
    eventTurn?.completed_at,
  ]) {
    if (typeof value === "string" && value.trim()) return value;
  }
  return new Date().toISOString();
}

function compactCompletedKeys(state: PersistedSessionCodexFeishuNotifierState) {
  for (const field of ["sent", "skipped"] as const) {
    const entries = Object.entries(state[field]);
    if (entries.length <= MAX_COMPLETED_KEYS) continue;
    state[field] = Object.fromEntries(
      entries.slice(entries.length - MAX_COMPLETED_KEYS),
    );
  }
}

function validateState(value: any): PersistedSessionCodexFeishuNotifierState {
  if (
    value?.version !== STATE_VERSION ||
    !asObject(value.pending) ||
    !asObject(value.sent) ||
    !asObject(value.skipped) ||
    (value.instance != null && typeof value.instance !== "string") ||
    (value.cursor != null && !Number.isSafeInteger(value.cursor))
  ) {
    throw new Error("session Codex Feishu notifier state is invalid");
  }
  return {
    version: STATE_VERSION,
    instance: value.instance,
    cursor: value.cursor,
    pending: value.pending,
    sent: value.sent,
    skipped: value.skipped,
  };
}

export class SessionCodexFeishuNotifier {
  readonly #file?: string;
  readonly #settings: SettingsLike;
  readonly #deliveryRecorder: SessionCodexFeishuNotifierOptions["deliveryRecorder"];
  readonly #sender: FeishuCompletionSenderLike;
  readonly #readThread: (id: string, turnId?: string) => Promise<any>;
  readonly #beforeSend: SessionCodexFeishuNotifierOptions["beforeSend"];
  readonly #logError: (error: unknown, event?: FeishuCompletionEvent) => void;
  readonly #retryIntervalMs: number;
  #state: PersistedSessionCodexFeishuNotifierState = emptyState();
  #loaded = false;
  #broken = false;
  #serial: Promise<unknown> = Promise.resolve();
  #timer: ReturnType<typeof setTimeout> | undefined;
  #sending: Promise<void> | undefined;
  #attempt:
    | { threadId: string; turnId: string; cancelled: boolean }
    | undefined;
  #closed = false;

  constructor(options: SessionCodexFeishuNotifierOptions) {
    this.#file = options.file;
    this.#settings = options.settings;
    this.#sender = options.sender;
    this.#deliveryRecorder = options.deliveryRecorder;
    this.#readThread = options.readThread;
    this.#beforeSend = options.beforeSend;
    this.#logError = options.logError ?? (() => {});
    this.#retryIntervalMs =
      options.retryIntervalMs ?? DEFAULT_RETRY_INTERVAL_MS;
  }

  async cursor(instance: string): Promise<number | undefined> {
    return this.#run(async () => {
      if (this.#broken) return undefined;
      this.#scheduleSend();
      return this.#state.instance === instance ? this.#state.cursor : undefined;
    });
  }

  async observe(instance: string, event: RuntimeEvent): Promise<void> {
    const parsed = this.#turnFromEvent(event);
    if (!parsed) return;
    if (
      event.payload.method === "turn/started" &&
      !(
        this.#state.instance === instance &&
        this.#state.cursor !== undefined &&
        event.seq <= this.#state.cursor
      ) &&
      this.#attempt?.threadId === parsed.threadId &&
      this.#attempt.turnId !== parsed.turnId
    ) {
      // Invalidate synchronously: an event can arrive after the sender captured
      // its serial barrier, before that barrier's continuation or disk commit.
      this.#attempt.cancelled = true;
    }
    await this.#run(async () => {
      if (this.#broken || this.#closed) return;
      const { key, threadId, turnId, eventTurn } = parsed;
      const next = structuredClone(this.#state);
      if (next.instance !== instance) {
        next.instance = instance;
        delete next.cursor;
      }
      if (next.cursor !== undefined && event.seq <= next.cursor) return;
      next.cursor = event.seq;
      if (event.payload.method === "turn/started") {
        // A new turn supersedes any undelivered answer from an earlier turn.
        // Reuse the durable pending set/cursor instead of retaining a thread map.
        for (const pending of Object.values(next.pending)) {
          if (pending.threadId === threadId && pending.turnId !== turnId) {
            delete next.pending[pending.key];
            next.skipped[pending.key] = true;
          }
        }
        compactCompletedKeys(next);
        await this.#commit(next);
        return;
      }
      if (next.sent[key] || next.skipped[key] || next.pending[key]) {
        await this.#commit(next);
        return;
      }
      const settings = this.#settings.get();
      if (!settings.configured || !settings.enabled) {
        next.skipped[key] = true;
        compactCompletedKeys(next);
        await this.#commit(next);
        return;
      }
      next.pending[key] = {
        key,
        threadId,
        turnId,
        eventTurn,
        enqueuedAt: new Date().toISOString(),
      };
      compactCompletedKeys(next);
      await this.#commit(next);
      this.#scheduleSend();
    });
  }

  async drain(): Promise<void> {
    await this.#serial;
    if (Object.keys(this.#state.pending).length > 0) this.#scheduleSend();
    await this.#sending;
    await this.#serial;
  }

  async close(): Promise<void> {
    this.#closed = true;
    clearTimeout(this.#timer);
    this.#timer = undefined;
    await this.#serial.catch(() => {});
  }

  #run<T>(work: () => Promise<T>): Promise<T> {
    const task = this.#serial.then(async () => {
      await this.#load();
      return work();
    });
    this.#serial = task.catch(() => {});
    return task;
  }

  async #load(): Promise<void> {
    if (this.#loaded) return;
    if (!this.#file) {
      this.#loaded = true;
      return;
    }
    try {
      this.#state = validateState(
        JSON.parse(await readFile(this.#file, "utf8")),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        this.#state = emptyState();
      } else {
        this.#broken = true;
        this.#logError(error);
      }
    }
    this.#loaded = true;
  }

  async #commit(next: PersistedSessionCodexFeishuNotifierState): Promise<void> {
    if (this.#file) await writeDurableJson(this.#file, next);
    this.#state = next;
  }

  #turnFromEvent(event: RuntimeEvent): {
    key: string;
    threadId: string;
    turnId: string;
    eventTurn: any;
  } | null {
    if (
      !Number.isSafeInteger(event.seq) ||
      event.event !== "codex:notification" ||
      !["turn/completed", "turn/started"].includes(event.payload?.method)
    ) {
      return null;
    }
    const params = event.payload?.params;
    const threadId =
      typeof params?.threadId === "string" ? params.threadId : "";
    const eventTurn = params?.turn;
    const turnId = typeof eventTurn?.id === "string" ? eventTurn.id : "";
    if (
      !threadId ||
      !turnId ||
      (event.payload.method === "turn/completed" &&
        turnStatus(eventTurn) !== "completed")
    ) {
      return null;
    }
    return {
      key: `${threadId}:${turnId}`,
      threadId,
      turnId,
      eventTurn,
    };
  }

  async #buildFeishuEvent(
    pending: PendingNotification,
  ): Promise<FeishuCompletionEvent | null> {
    const readResult = await this.#readThread(pending.threadId, pending.turnId);
    const thread = normalizeThread(readResult);
    if (!thread || thread.id !== pending.threadId) {
      throw new CompletionNotReadyError("target thread is not ready");
    }
    if (isSubagentThread(thread)) {
      return null;
    }
    const turns = Array.isArray(thread.turns) ? thread.turns : [];
    const historyTurn = turns.find((turn) => turn?.id === pending.turnId);
    if (!historyTurn) {
      throw new CompletionNotReadyError("target turn is not visible yet");
    }
    const status = turnStatus(historyTurn);
    if (status === "failed" || status === "interrupted") {
      return null;
    }
    if (status !== "completed") {
      throw new CompletionNotReadyError("target turn is not completed yet");
    }
    const threadState = turnStatus(thread);
    if (threadState !== undefined && threadState !== "idle") {
      throw new CompletionNotReadyError("target thread is not idle yet");
    }
    const summary =
      finalAnswerFromTurn(historyTurn) ??
      finalAnswerFromTurn(pending.eventTurn);
    if (!summary) {
      if (
        !Array.isArray(historyTurn.items) ||
        (historyTurn.itemsView !== undefined &&
          historyTurn.itemsView !== "full")
      ) {
        throw new CompletionNotReadyError(
          "target turn output is not visible yet",
        );
      }
      return null;
    }
    return {
      sessionId: `session-codex:${pending.threadId}`,
      sessionModeThreadId: pending.threadId,
      ...(typeof readResult?.sessionModeContext?.scope === "string" && typeof readResult?.sessionModeContext?.namespace === "string" ? { sessionModeScope: readResult.sessionModeContext.scope, sessionModeNamespace: readResult.sessionModeContext.namespace } : {}),
      displayName: displayName(thread, pending.threadId),
      agentKind: "codex",
      workingDirectory: workingDirectory(thread),
      summary,
      completedAt: completedAt(pending.eventTurn, historyTurn),
      completionId: pending.turnId,
    };
  }

  #scheduleSend(): void {
    if (this.#closed || this.#broken || this.#sending) return;
    clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#sending = this.#sendPending()
      .catch((error) => this.#logError(error))
      .finally(() => {
        this.#sending = undefined;
        this.#attempt = undefined;
        if (
          !this.#closed &&
          !this.#broken &&
          Object.keys(this.#state.pending).length > 0
        ) {
          this.#timer = setTimeout(
            () => this.#scheduleSend(),
            this.#retryIntervalMs,
          );
          this.#timer.unref();
        }
      });
  }

  async #sendPending(): Promise<void> {
    while (!this.#closed && !this.#broken) {
      await this.#serial;
      const snapshot = Object.values(this.#state.pending);
      if (!snapshot.length) return;
      const snapshotKeys = new Set(snapshot.map((pending) => pending.key));
      let progressed = false;
      for (const pending of snapshot) {
        if (this.#closed || this.#broken) return;
        if (!this.#state.pending[pending.key]) continue;
        const settings = this.#settings.get();
        if (!settings.configured || !settings.enabled) {
          await this.#markSkipped(pending.key);
          progressed = true;
          continue;
        }
        const attempt = {
          threadId: pending.threadId,
          turnId: pending.turnId,
          cancelled: false,
        };
        this.#attempt = attempt;
        let event: FeishuCompletionEvent | null;
        try {
          const readiness = this.#beforeSend
            ? await this.#beforeSend({
                threadId: pending.threadId,
                turnId: pending.turnId,
              })
            : "ready";
          await this.#serial;
          if (this.#closed || this.#broken) return;
          if (attempt.cancelled || !this.#state.pending[pending.key]) continue;
          if (readiness === "superseded") {
            await this.#markSkipped(pending.key);
            progressed = true;
            continue;
          }
          if (readiness !== "ready") continue;
          event = await this.#buildFeishuEvent(pending);
        } catch (error) {
          if (!(error instanceof CompletionNotReadyError)) {
            this.#logError(error);
          }
          continue;
        }
        await this.#serial;
        if (this.#closed || this.#broken) return;
        if (attempt.cancelled || !this.#state.pending[pending.key]) continue;
        if (!event) {
          await this.#markSkipped(pending.key);
          progressed = true;
          continue;
        }
        let readiness: "ready" | "wait" | "superseded";
        try {
          readiness = this.#beforeSend
            ? await this.#beforeSend({
                threadId: pending.threadId,
                turnId: pending.turnId,
              })
            : "ready";
        } catch (error) {
          this.#logError(error, event);
          continue;
        }
        // A started event can arrive while history/the delivery gate is reading.
        // Finish its durable invalidation before considering the actual send.
        await this.#serial;
        if (this.#closed || this.#broken) return;
        if (attempt.cancelled || !this.#state.pending[pending.key]) continue;
        if (readiness === "superseded") {
          await this.#markSkipped(pending.key);
          progressed = true;
          continue;
        }
        if (readiness !== "ready") continue;
        const freshSettings = this.#settings.get();
        if (!freshSettings.configured || !freshSettings.enabled) {
          await this.#markSkipped(pending.key);
          progressed = true;
          continue;
        }
        if (attempt.cancelled) continue;
        try {
          const delivery = await this.#sender.send(event);
          if (this.#closed || this.#broken) return;
          if (delivery) this.#deliveryRecorder?.record(event, delivery);
        } catch (error) {
          this.#logError(error, event);
          continue;
        }
        if (this.#closed || this.#broken) return;
        await this.#markSent(pending.key);
        progressed = true;
      }
      if (
        !progressed &&
        Object.keys(this.#state.pending).every((key) => snapshotKeys.has(key))
      )
        return;
    }
  }

  async #markSent(key: string): Promise<void> {
    await this.#run(async () => {
      if (!this.#state.pending[key]) return;
      const next = structuredClone(this.#state);
      delete next.pending[key];
      next.sent[key] = true;
      compactCompletedKeys(next);
      await this.#commit(next);
    });
  }

  async #markSkipped(key: string): Promise<void> {
    await this.#run(async () => {
      if (!this.#state.pending[key]) return;
      const next = structuredClone(this.#state);
      delete next.pending[key];
      next.skipped[key] = true;
      compactCompletedKeys(next);
      await this.#commit(next);
    });
  }
}
