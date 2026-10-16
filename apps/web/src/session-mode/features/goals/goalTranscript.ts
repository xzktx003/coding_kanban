import { useCallback, useSyncExternalStore } from "react";
import type { ThreadGoal } from "@session/bindings/v2";
import {
  isCodexTranscriptDormant,
  onCodexTranscriptReleased,
} from "@session/services/codexTranscriptActivity";

export const GOAL_TRANSCRIPT_LIMITS = Object.freeze({
  threads: 32,
  perThread: 8,
  objectiveCodePoints: 4000,
});

/** Bbn's local completed /goal text, deliberately not a Turn or notification. */
export interface GoalAnnouncement {
  readonly kind: "goal-announcement";
  readonly key: string;
  readonly threadId: string;
  readonly text: string;
  readonly status: "completed";
  readonly nativeTurnId: null;
  readonly goalUpdatedAt: number;
  /** The last genuine native turn observed when GoalSet was acknowledged. */
  readonly afterTurnId: string | null;
}

export interface GoalAnnouncementInput {
  threadId: string;
  goal: Pick<ThreadGoal, "threadId" | "objective" | "updatedAt">;
  source: "existing-thread-goal-set" | "new-thread-first-turn" | "goal-edit";
  afterTurnId: string | null;
}

const EMPTY: readonly GoalAnnouncement[] = Object.freeze([]);
const validIdentity = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= 160 &&
  !/[\x00-\x1f]/.test(value);

/** Bounded disposable view state. No persistence, timers, native writes or events. */
export class GoalTranscriptStore {
  private readonly entries = new Map<string, readonly GoalAnnouncement[]>();
  private readonly listeners = new Set<() => void>();
  private sequence = 0;

  get size() {
    return this.entries.size;
  }
  getSnapshot = (threadId: string): readonly GoalAnnouncement[] =>
    this.entries.get(threadId) ?? EMPTY;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private notify() {
    for (const listener of [...this.listeners]) listener();
  }

  append(input: GoalAnnouncementInput): boolean {
    if (
      input.source !== "existing-thread-goal-set" ||
      !validIdentity(input.threadId) ||
      !input.goal ||
      input.goal.threadId !== input.threadId ||
      typeof input.goal.objective !== "string" ||
      !input.goal.objective.trim() ||
      !Number.isFinite(input.goal.updatedAt) ||
      input.goal.updatedAt < 0 ||
      (input.afterTurnId !== null && !validIdentity(input.afterTurnId))
    )
      return false;
    const codepoints = Array.from(input.goal.objective);
    if (codepoints.length > GOAL_TRANSCRIPT_LIMITS.objectiveCodePoints)
      return false;
    // Join detaches a short accepted objective from a potentially larger parent
    // string; no expanded objective or attachment bytes live in this store.
    const text = `/goal ${codepoints.join("")}`;
    const previous = this.entries.get(input.threadId) ?? EMPTY;
    const last = previous.at(-1);
    // Vbn only deduplicates the latest local synthetic turn. A later genuine
    // native turn changes afterTurnId; A→B→A must also remain three messages.
    if (
      last &&
      last.text === text &&
      last.goalUpdatedAt === input.goal.updatedAt &&
      last.afterTurnId === input.afterTurnId
    )
      return false;
    const entry: GoalAnnouncement = Object.freeze({
      kind: "goal-announcement",
      key: `goal-view-${++this.sequence}`,
      threadId: input.threadId,
      text,
      status: "completed",
      nativeTurnId: null,
      goalUpdatedAt: input.goal.updatedAt,
      afterTurnId: input.afterTurnId,
    });
    this.entries.delete(input.threadId);
    this.entries.set(
      input.threadId,
      Object.freeze([
        ...previous.slice(-(GOAL_TRANSCRIPT_LIMITS.perThread - 1)),
        entry,
      ]),
    );
    while (this.entries.size > GOAL_TRANSCRIPT_LIMITS.threads)
      this.entries.delete(this.entries.keys().next().value!);
    this.notify();
    return true;
  }

  clear(threadId?: string): void {
    if (threadId !== undefined) {
      if (!this.entries.delete(threadId)) return;
    } else {
      if (!this.entries.size) return;
      this.entries.clear();
    }
    this.notify();
  }
}

const goalTranscriptStore = new GoalTranscriptStore();
export const getGoalAnnouncements = (threadId: string) =>
  goalTranscriptStore.getSnapshot(threadId);
export const clearGoalAnnouncements = (threadId?: string) =>
  goalTranscriptStore.clear(threadId);
export const appendGoalAnnouncement = (input: GoalAnnouncementInput): boolean =>
  !isCodexTranscriptDormant(input.threadId) &&
  goalTranscriptStore.append(input);

export function useGoalAnnouncements(
  threadId: string,
): readonly GoalAnnouncement[] {
  const snapshot = useCallback(
    () => getGoalAnnouncements(threadId),
    [threadId],
  );
  return useSyncExternalStore(
    goalTranscriptStore.subscribe,
    snapshot,
    snapshot,
  );
}

// Reuse the existing 60-second body-consumer lifecycle. Background completion
// and history updates never reacquire a released announcement body.
const stopRelease = onCodexTranscriptReleased(clearGoalAnnouncements);
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    stopRelease();
    clearGoalAnnouncements();
  });
