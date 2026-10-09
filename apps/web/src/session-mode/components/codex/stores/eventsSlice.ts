import { acceptTurnStart } from "@session/utils/codexRuntimeState";
import type { StateCreator } from "zustand";
import type { ServerNotification } from "@session/bindings";
import type { ThreadGoal, ThreadTokenUsage } from "@session/bindings/v2";
import { appendTranscriptEvent, type DeltaEvent } from "./eventUtils";
import type { CodexStore, EventsSlice, TurnTiming } from "./types";

export const createEventsSlice: StateCreator<
  CodexStore,
  [],
  [],
  EventsSlice
> = (set) => ({
  events: {},
  historyLoadedMap: {},
  historyLoadingMap: {},
  historyErrorMap: {},
  threadStatusMap: {},
  turnTimingMap: {},
  commandStatusMap: {},
  commandDurationMap: {},
  retryNoticeMap: {},
  tokenUsageMap: {},
  goalMap: {},
  goalEnabled: false,

  addEvent: (threadId: string, event: ServerNotification) => {
    set((state: CodexStore) => {
      const existingEvents = state.events[threadId] || [];
      // Replayed starts cannot regress a finalized snapshot or its status maps.
      // Item identity includes the turn so a later execution remains independent.
      if (
        event.method === "item/started" &&
        event.params.item.type === "commandExecution" &&
        existingEvents.some(
          (previous) =>
            previous.method === "item/completed" &&
            previous.params.threadId === event.params.threadId &&
            previous.params.turnId === event.params.turnId &&
            previous.params.item.id === event.params.item.id &&
            previous.params.item.type === "commandExecution",
        )
      )
        return state;

      // Each retry emits another error, so keeping them out of the transcript
      // is what stops "Reconnecting... 1/5" from stacking up five lines.
      let isRetryNotice = false;
      let retryNoticeMap = state.retryNoticeMap;
      if (event.method === "error" && event.params.willRetry) {
        isRetryNotice = true;
        retryNoticeMap = {
          ...retryNoticeMap,
          [threadId]: event.params.error.message,
        };
      } else if (retryNoticeMap[threadId] !== undefined) {
        const { [threadId]: _cleared, ...rest } = retryNoticeMap;
        retryNoticeMap = rest;
      }

      // Deduplicate turn/diff/updated events
      // If this is a turn/diff/updated event, remove previous ones with the same turnId
      let filteredEvents = existingEvents;
      if (event.method === "turn/diff/updated") {
        const newTurnId = event.params.turnId;
        filteredEvents = existingEvents.filter((e) => {
          if (e.method !== "turn/diff/updated") return true;
          const existingTurnId = e.params.turnId;
          return existingTurnId !== newTurnId;
        });
      }

      const nextThreadEvents = isRetryNotice
        ? existingEvents
        : appendTranscriptEvent(filteredEvents, event);
      const newEvents =
        isRetryNotice || nextThreadEvents === existingEvents
          ? state.events
          : {
              ...state.events,
              [threadId]: nextThreadEvents,
            };
      const eventsChanged = newEvents !== state.events;

      let threadStatusMap = state.threadStatusMap;
      if (event.method === "thread/status/changed") {
        threadStatusMap = {
          ...threadStatusMap,
          [threadId]: event.params.status,
        };
      }

      // Turn events own timing; systemError also ends progress when completion
      // was lost. An ordinary thread status alone cannot revive a finished turn.
      let turnTimingMap = state.turnTimingMap;
      let currentTurnId = state.currentTurnId;
      if (event.method === "turn/started") {
        const { turn } = event.params;
        if (!acceptTurnStart(turnTimingMap[threadId], turn)) return state;
        if (threadStatusMap[threadId]?.type === "systemError")
          threadStatusMap = {
            ...threadStatusMap,
            [threadId]: { type: "active", activeFlags: [] },
          };
        if (state.currentThreadId === threadId) currentTurnId = turn.id;
        turnTimingMap = {
          ...turnTimingMap,
          [threadId]: {
            turnId: turn.id,
            startedAtMs:
              typeof turn.startedAt === "number"
                ? turn.startedAt * 1000
                : turnTimingMap[threadId]?.turnId === turn.id
                  ? turnTimingMap[threadId].startedAtMs
                  : Date.now(),
            durationMs: null,
            status: "inProgress",
          } satisfies TurnTiming,
        };
      } else if (event.method === "turn/completed") {
        const { turn } = event.params;
        const existing = turnTimingMap[threadId];
        // Only update if this completion matches the turn we're tracking (or we have none tracked).
        if (!existing || existing.turnId === turn.id) {
          if (state.currentThreadId === threadId && currentTurnId === turn.id)
            currentTurnId = null;
          turnTimingMap = {
            ...turnTimingMap,

            [threadId]: {
              turnId: turn.id,
              startedAtMs:
                existing?.startedAtMs ??
                (typeof turn.startedAt === "number"
                  ? turn.startedAt * 1000
                  : Date.now()),
              durationMs: turn.durationMs,
              status: turn.status === "inProgress" ? "completed" : turn.status,
            },
          };
        }
      } else if (
        event.method === "thread/status/changed" &&
        event.params.status.type === "systemError"
      ) {
        const existing = turnTimingMap[threadId];
        if (existing?.status === "inProgress") {
          turnTimingMap = {
            ...turnTimingMap,
            [threadId]: {
              ...existing,
              durationMs: Date.now() - existing.startedAtMs,
              status: "failed",
            },
          };
        }
        if (state.currentThreadId === threadId) currentTurnId = null;
      } else if (event.method === "error") {
        // A non-retryable error may arrive without any turn/completed, so mark
        // the turn failed here or the UI shows "Working..." forever.
        const existing = turnTimingMap[threadId];
        if (
          (!existing ||
            (existing.turnId === event.params.turnId &&
              existing.status === "inProgress")) &&
          !event.params.willRetry
        ) {
          threadStatusMap = {
            ...threadStatusMap,
            [threadId]: { type: "systemError" },
          };
          if (
            state.currentThreadId === threadId &&
            currentTurnId === event.params.turnId
          )
            currentTurnId = null;
          turnTimingMap = {
            ...turnTimingMap,
            [threadId]: {
              turnId: event.params.turnId,
              startedAtMs: existing?.startedAtMs ?? Date.now(),
              durationMs: existing ? Date.now() - existing.startedAtMs : null,
              status: "failed",
            },
          };
        }
      }

      // Update command status map
      let commandStatusMap = state.commandStatusMap;
      let commandDurationMap = state.commandDurationMap;
      let goalMap = state.goalMap;
      if (event.method === "thread/goal/updated") {
        goalMap = { ...goalMap, [threadId]: event.params.goal };
      } else if (event.method === "thread/goal/cleared") {
        const newGoalMap = { ...goalMap };
        delete newGoalMap[threadId];
        goalMap = newGoalMap;
      }
      if (
        event.method === "item/started" &&
        event.params.item?.type === "commandExecution"
      ) {
        commandStatusMap = {
          ...commandStatusMap,
          [event.params.item.id]: event.params.item.status,
        };
      } else if (
        event.method === "item/completed" &&
        event.params.item?.type === "commandExecution"
      ) {
        commandStatusMap = {
          ...commandStatusMap,
          [event.params.item.id]: event.params.item.status,
        };
        commandDurationMap = {
          ...commandDurationMap,
          [event.params.item.id]: event.params.item.durationMs,
        };
      }

      return {
        ...(eventsChanged ? { events: newEvents } : {}),
        threadStatusMap,
        turnTimingMap,
        currentTurnId,
        commandStatusMap,
        commandDurationMap,
        retryNoticeMap,
        goalMap,
      };
    });
  },

  addTranscriptDeltas: (threadId: string, events: DeltaEvent[]) => {
    if (!events.length) return;
    set((state: CodexStore) => {
      const existingEvents = state.events[threadId] ?? [];
      let nextEvents = existingEvents;
      for (const event of events)
        nextEvents = appendTranscriptEvent(nextEvents, event);

      let retryNoticeMap = state.retryNoticeMap;
      if (retryNoticeMap[threadId] !== undefined) {
        const { [threadId]: _cleared, ...rest } = retryNoticeMap;
        retryNoticeMap = rest;
      }
      if (
        nextEvents === existingEvents &&
        retryNoticeMap === state.retryNoticeMap
      )
        return state;
      return {
        ...(nextEvents !== existingEvents
          ? { events: { ...state.events, [threadId]: nextEvents } }
          : {}),
        retryNoticeMap,
      };
    });
  },

  setTokenUsage: (threadId: string, data: ThreadTokenUsage) => {
    set((state: CodexStore) => ({
      tokenUsageMap: {
        ...state.tokenUsageMap,
        [threadId]: data,
      },
    }));
  },

  setGoal: (threadId: string, goal: ThreadGoal) => {
    set((state: CodexStore) => ({
      goalMap: {
        ...state.goalMap,
        [threadId]: goal,
      },
    }));
  },

  clearGoal: (threadId: string) => {
    set((state: CodexStore) => {
      const newGoalMap = { ...state.goalMap };
      delete newGoalMap[threadId];
      return { goalMap: newGoalMap };
    });
  },

  setGoalEnabled: (goalEnabled: boolean) => {
    set({ goalEnabled });
  },
});
