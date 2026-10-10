import { withoutToolTranscriptEvent } from "@session/services/codexTranscriptVisibility";
import { isCodexTranscriptDormant } from "@session/services/codexTranscriptActivity";
import { acceptTurnStart } from "@session/utils/codexRuntimeState";
import type { StateCreator } from "zustand";
import type { ServerNotification } from "@session/bindings";
import type { ThreadGoal, ThreadTokenUsage } from "@session/bindings/v2";
import {
  appendStreamingTextPreview,
  createStreamingTextPreview,
  copyTranscriptText,
  estimateTranscriptBytes,
  materializeStreamingTextPreview,
  STREAMING_TEXT_SEGMENT_CHARS,
  STREAMING_TEXT_LIMIT,
  type StreamingTextPreview,
} from "@session/services/codexTranscriptMemoryBudget";
import { recordTranscriptTraffic } from "@session/services/sessionMemoryPressure";
import { appendTranscriptEvent, type DeltaEvent } from "./eventUtils";
import type { CodexStore, EventsSlice, TurnTiming } from "./types";

function appendTextSegments(
  segments: string[],
  current: string,
  delta: string,
) {
  const combined = `${current}${delta}`;
  const completeLength =
    Math.floor(combined.length / STREAMING_TEXT_SEGMENT_CHARS) *
    STREAMING_TEXT_SEGMENT_CHARS;
  if (!completeLength) return { segments, current: combined };
  const nextSegments = [...segments];
  for (
    let offset = 0;
    offset < completeLength;
    offset += STREAMING_TEXT_SEGMENT_CHARS
  )
    nextSegments.push(
      copyTranscriptText(
        combined.slice(offset, offset + STREAMING_TEXT_SEGMENT_CHARS),
      ),
    );
  return {
    segments: nextSegments,
    current: copyTranscriptText(combined.slice(completeLength)),
  };
}

export const createEventsSlice: StateCreator<
  CodexStore,
  [],
  [],
  EventsSlice
> = (set) => ({
  events: {},
  streamingAgentMessages: {},
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
    const visibleEvent = withoutToolTranscriptEvent(event);
    if (!visibleEvent) return;
    event = visibleEvent;
    set((state: CodexStore) => {
      const existingEvents = state.events[threadId] || [];
      let filteredEvents = existingEvents;
      let streamingAgentMessages = state.streamingAgentMessages ?? {};
      const streaming = streamingAgentMessages[threadId];
      const clearStreaming = () => {
        if (streamingAgentMessages === state.streamingAgentMessages)
          streamingAgentMessages = { ...streamingAgentMessages };
        delete streamingAgentMessages[threadId];
      };
      if (
        streaming &&
        event.method === "item/completed" &&
        event.params.turnId === streaming.turnId &&
        event.params.item.type === "agentMessage" &&
        event.params.item.id === streaming.itemId
      ) {
        clearStreaming();
      } else if (
        streaming &&
        event.method === "turn/completed" &&
        event.params.turn.id === streaming.turnId
      ) {
        const hasFinalSnapshot = event.params.turn.items.some(
          (item) =>
            item.type === "agentMessage" && item.id === streaming.itemId,
        );
        const partialText = streaming.preview
          ? materializeStreamingTextPreview(streaming.preview)
          : `${streaming.segments.join("")}${streaming.current}`;
        if (!hasFinalSnapshot && partialText) {
          // Some interrupted turns omit item/completed. Preserve the partial
          // answer once as a transcript delta before releasing its live buffer.
          filteredEvents = appendTranscriptEvent(filteredEvents, {
            method: "item/agentMessage/delta",
            params: {
              threadId,
              turnId: streaming.turnId,
              itemId: streaming.itemId,
              delta: partialText,
            },
          } as ServerNotification);
        }
        clearStreaming();
      } else if (
        streaming &&
        ((event.method === "error" &&
          !event.params.willRetry &&
          event.params.turnId === streaming.turnId) ||
          (event.method === "thread/status/changed" &&
            event.params.status.type === "systemError" &&
            state.turnTimingMap[threadId]?.turnId === streaming.turnId))
      ) {
        const partialText = streaming.preview
          ? materializeStreamingTextPreview(streaming.preview)
          : `${streaming.segments.join("")}${streaming.current}`;
        if (partialText)
          filteredEvents = appendTranscriptEvent(filteredEvents, {
            method: "item/agentMessage/delta",
            params: {
              threadId,
              turnId: streaming.turnId,
              itemId: streaming.itemId,
              delta: partialText,
            },
          } as ServerNotification);
        clearStreaming();
      }
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
      if (event.method === "turn/diff/updated") {
        const newTurnId = event.params.turnId;
        filteredEvents = existingEvents.filter((e) => {
          if (e.method !== "turn/diff/updated") return true;
          const existingTurnId = e.params.turnId;
          return existingTurnId !== newTurnId;
        });
      }

      const nextThreadEvents =
        isRetryNotice || isCodexTranscriptDormant(threadId)
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

      let goalMap = state.goalMap;
      if (event.method === "thread/goal/updated") {
        goalMap = { ...goalMap, [threadId]: event.params.goal };
      } else if (event.method === "thread/goal/cleared") {
        const newGoalMap = { ...goalMap };
        delete newGoalMap[threadId];
        goalMap = newGoalMap;
      }

      if (
        !eventsChanged &&
        streamingAgentMessages === state.streamingAgentMessages &&
        threadStatusMap === state.threadStatusMap &&
        turnTimingMap === state.turnTimingMap &&
        currentTurnId === state.currentTurnId &&
        retryNoticeMap === state.retryNoticeMap &&
        goalMap === state.goalMap
      )
        return state;

      return {
        ...(eventsChanged ? { events: newEvents } : {}),
        ...(streamingAgentMessages !== state.streamingAgentMessages
          ? { streamingAgentMessages }
          : {}),
        threadStatusMap,
        turnTimingMap,
        currentTurnId,
        retryNoticeMap,
        goalMap,
      };
    });
  },

  addTranscriptDeltas: (threadId: string, events: DeltaEvent[]) => {
    if (!events.length || isCodexTranscriptDormant(threadId)) return;
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

  setStreamingAgentDeltas: (threadId: string, events: DeltaEvent[]) => {
    if (!events.length || isCodexTranscriptDormant(threadId)) return;
    set((state: CodexStore) => {
      let current = state.streamingAgentMessages?.[threadId];
      for (const event of events) {
        if (event.method !== "item/agentMessage/delta") continue;
        recordTranscriptTraffic(estimateTranscriptBytes(event));
        const sameItem =
          current?.turnId === event.params.turnId &&
          current.itemId === event.params.itemId;
        const delta = event.params.delta;
        if (!delta) continue;
        let segments: string[] = [];
        let currentText = "";
        let length = delta.length;
        let preview: StreamingTextPreview | undefined;
        if (sameItem && current?.preview) {
          preview = appendStreamingTextPreview(current.preview, delta);
          length = STREAMING_TEXT_LIMIT;
        } else if (sameItem && current) {
          length = current.length + delta.length;
          if (length > STREAMING_TEXT_LIMIT) {
            const text = `${current.segments.join("")}${current.current}${delta}`;
            preview = createStreamingTextPreview(text);
            length = STREAMING_TEXT_LIMIT;
          } else {
            const appended = appendTextSegments(
              current.segments,
              current.current,
              delta,
            );
            segments = appended.segments;
            currentText = appended.current;
          }
        } else {
          if (delta.length > STREAMING_TEXT_LIMIT) {
            preview = createStreamingTextPreview(delta);
            length = STREAMING_TEXT_LIMIT;
          } else {
            const appended = appendTextSegments([], "", delta);
            segments = appended.segments;
            currentText = appended.current;
          }
        }
        current = {
          turnId: event.params.turnId,
          itemId: event.params.itemId,
          segments,
          current: currentText,
          length,
          ...(preview ? { preview } : {}),
        };
      }
      if (!current || current === state.streamingAgentMessages?.[threadId])
        return state;
      return {
        streamingAgentMessages: {
          ...(state.streamingAgentMessages ?? {}),
          [threadId]: current,
        },
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
