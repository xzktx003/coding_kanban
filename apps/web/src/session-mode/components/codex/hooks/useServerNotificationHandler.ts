import { nativeThreadSettings } from "@session/services/nativeThreadSettings";
import { observeConfigNotice } from "@session/features/codex-account/config-notices";
import {
  isToolTranscriptEvent,
  withoutToolTranscriptEvent,
} from "@session/services/codexTranscriptVisibility";
import {
  isCodexTranscriptDormant,
  onCodexTranscriptReleased,
} from "@session/services/codexTranscriptActivity";
import {
  acknowledgeDeliveryEchoes,
  deliveredClientIds,
} from "@session/stores/useCodexDeliveryStore";
import { subagentParent } from "@agent-orchestrator/shared";
import { isObservedCodexThread } from "@session/services/observedCodexThreads";
import {
  observeSubagents,
  useSubagentStore,
} from "@session/features/subagents/store";
import { useSessionAttentionStore } from "@session/stores/useSessionAttentionStore";
import { revealNewQuestion } from "@session/features/async-questions/arrival";
import { useSessionNameStore } from "../../../stores/useSessionNameStore";
import { notifyDesktop } from "@session/lib/notify";
import { isSessionModeActive } from "@session/session-dom";
import { toast } from "sonner";
import { type RefObject, useCallback, useEffect, useRef } from "react";
import type { ServerNotification } from "@session/bindings/ServerNotification";
import type { AccountLoginCompletedNotification } from "@session/bindings/v2";
import { useCodexStore } from "@session/components/codex/stores";
import { allowSleep, preventSleep } from "@session/services/apiAdapt";
import {
  appendStreamingTextPreview,
  compactCodexEventPayload,
  estimateTranscriptBytes,
  createStreamingTextPreview,
  materializeStreamingTextPreview,
  STREAMING_TEXT_LIMIT,
  type StreamingTextPreview,
} from "@session/services/codexTranscriptMemoryBudget";
import { releaseSessionMemory } from "@session/services/sessionMemoryGovernor";
import { playBeep } from "@session/utils/beep";
import { shouldPlayCompletionBeep } from "./beepOnCompletion";
import {
  clearCodexRequests,
  resolveCodexServerRequest,
} from "./serverRequests";
import { useRequestUserInputStore } from "../stores/useRequestUserInputStore";
import { hydrateThreadModel } from "@session/stores/useThreadModelStore";
import { isDeltaEvent, type DeltaEvent } from "../stores/eventUtils";
import {
  notifyGoalCompletionAutoClear,
  resetGoalCompletionScope,
} from "@session/services/goalCompletionAutoClear";

export type BeepMode = "never" | "unfocused" | "always";

interface NotificationHandlerRefs {
  isCodexThreadActiveRef: RefObject<boolean>;
  taskCompleteBeepModeRef: RefObject<BeepMode>;
  preventSleepDuringTasksRef: RefObject<boolean>;
}

const PENDING_DELTA_MAX_ITEMS = 128;
const PENDING_DELTA_MAX_BYTES = 1024 * 1024;
const DELTA_BATCH_ITEMS = 32;
const DELTA_FRAME_BUDGET_MS = 4;

// Encapsulates all business logic for handling incoming ServerNotification
// events (thread/turn/account/item updates). Transport-agnostic: used by
// both the Tauri listener path and the SSE bridge path.
export function useServerNotificationHandler(
  refs: NotificationHandlerRefs,
  syncAccountState: (refreshToken: boolean) => Promise<void>,
) {
  // This is admission control, not another transcript cache. Frame suspension
  // must not bypass the display budget by retaining arbitrary item identities.
  const pendingDeltas = useRef(
    new Map<
      number,
      {
        key: string;
        threadId: string;
        event: DeltaEvent;
        preview?: StreamingTextPreview;
        bytes: number;
      }
    >(),
  );
  const pendingBytes = useRef(0);
  const pendingSerial = useRef(0);
  const lastPending = useRef<number | null>(null);
  const deltaFrame = useRef<number | null>(null);

  const flushPendingDeltas = useCallback(function flush(
    threadId?: string,
    mode: "all" | "frame" | "pressure" = "all",
  ) {
    const started = performance.now();
    do {
      const batch: Array<{ threadId: string; event: DeltaEvent }> = [];
      for (const [key, pending] of pendingDeltas.current) {
        if (threadId && pending.threadId !== threadId) continue;
        pendingDeltas.current.delete(key);
        pendingBytes.current -= pending.bytes;
        if (lastPending.current === key) lastPending.current = null;
        if (!isCodexTranscriptDormant(pending.threadId)) {
          batch.push({
            threadId: pending.threadId,
            event: pending.preview
              ? ({
                  ...pending.event,
                  params: {
                    ...pending.event.params,
                    delta: materializeStreamingTextPreview(pending.preview),
                  },
                } as DeltaEvent)
              : pending.event,
          });
        }
        if (batch.length >= DELTA_BATCH_ITEMS) break;
      }
      if (!batch.length) break;
      // Only combine adjacent deliveries. Grouping all live deltas before all
      // reasoning deltas would reorder an interleaved native stream.
      for (let offset = 0; offset < batch.length; ) {
        const first = batch[offset]!;
        const live = first.event.method === "item/agentMessage/delta";
        let end = offset + 1;
        while (
          end < batch.length &&
          batch[end]!.threadId === first.threadId &&
          (batch[end]!.event.method === "item/agentMessage/delta") === live
        )
          end++;
        const events = batch.slice(offset, end).map((entry) => entry.event);
        const store = useCodexStore.getState();
        if (live) store.setStreamingAgentDeltas(first.threadId, events);
        else store.addTranscriptDeltas(first.threadId, events);
        offset = end;
      }
      // The normal governor is timer-driven. A suspended-frame burst must not
      // move unlimited pending data into the store before that timer can run.
      // At most one bounded batch is published before existing retention runs.
      if (mode === "pressure") {
        releaseSessionMemory();
        break;
      }
      if (
        mode === "frame" &&
        performance.now() - started >= DELTA_FRAME_BUDGET_MS
      )
        break;
    } while (pendingDeltas.current.size);

    if (!pendingDeltas.current.size) {
      pendingBytes.current = 0;
      lastPending.current = null;
      if (deltaFrame.current !== null) cancelAnimationFrame(deltaFrame.current);
      deltaFrame.current = null;
    } else if (mode === "frame" && deltaFrame.current === null) {
      deltaFrame.current = requestAnimationFrame(() => {
        deltaFrame.current = null;
        flush(undefined, "frame");
      });
    }
  }, []);

  const queueDelta = useCallback(
    (threadId: string, event: DeltaEvent) => {
      if (isCodexTranscriptDormant(threadId)) return;
      const boundedEvent = compactCodexEventPayload(event) as DeltaEvent;
      const params = boundedEvent.params as typeof boundedEvent.params & {
        summaryIndex?: number;
        contentIndex?: number;
      };
      const key = JSON.stringify([
        threadId,
        boundedEvent.method,
        params.turnId,
        params.itemId,
        params.summaryIndex ?? null,
        params.contentIndex ?? null,
      ]);
      for (;;) {
        const tail =
          lastPending.current === null
            ? undefined
            : pendingDeltas.current.get(lastPending.current);
        const existing = tail?.key === key ? tail : undefined;
        let merged = boundedEvent;
        let preview: StreamingTextPreview | undefined;
        if (boundedEvent.method === "item/agentMessage/delta") {
          const delta = boundedEvent.params.delta;
          preview = existing?.preview;
          let text = delta;
          if (preview) {
            preview = appendStreamingTextPreview(preview, delta);
            text = "";
          } else {
            const combined = `${existing?.event.params.delta ?? ""}${delta}`;
            if (combined.length > STREAMING_TEXT_LIMIT) {
              preview = createStreamingTextPreview(combined);
              text = "";
            } else text = combined;
          }
          merged = {
            ...boundedEvent,
            params: { ...boundedEvent.params, delta: text },
          };
        } else if (existing) {
          merged = compactCodexEventPayload({
            ...boundedEvent,
            params: {
              ...boundedEvent.params,
              delta: `${existing.event.params.delta}${boundedEvent.params.delta}`,
            },
          } as DeltaEvent) as DeltaEvent;
        }
        const entry = {
          key,
          threadId,
          event: merged,
          ...(preview ? { preview } : {}),
        };
        const bytes = estimateTranscriptBytes(entry);
        const projectedBytes =
          pendingBytes.current - (existing?.bytes ?? 0) + bytes;
        const projectedItems = pendingDeltas.current.size + (existing ? 0 : 1);
        if (
          pendingDeltas.current.size &&
          (projectedBytes > PENDING_DELTA_MAX_BYTES ||
            projectedItems > PENDING_DELTA_MAX_ITEMS)
        ) {
          flushPendingDeltas(undefined, "pressure");
          if (isCodexTranscriptDormant(threadId)) return;
          continue;
        }
        const serial = existing
          ? lastPending.current!
          : ++pendingSerial.current;
        pendingDeltas.current.set(serial, { ...entry, bytes });
        pendingBytes.current = projectedBytes;
        lastPending.current = serial;
        // A single native identity may itself exceed the queue allowance. It is
        // delivered immediately rather than retained behind a suspended frame.
        if (bytes > PENDING_DELTA_MAX_BYTES)
          flushPendingDeltas(undefined, "pressure");
        break;
      }
      if (pendingDeltas.current.size && deltaFrame.current === null) {
        deltaFrame.current = requestAnimationFrame(() => {
          deltaFrame.current = null;
          flushPendingDeltas(undefined, "frame");
        });
      }
    },
    [flushPendingDeltas],
  );

  useEffect(() => () => flushPendingDeltas(), [flushPendingDeltas]);
  useEffect(
    () =>
      onCodexTranscriptReleased((id) => {
        // Hidden pages may never execute their queued frame.
        for (const [key, pending] of pendingDeltas.current) {
          if (pending.threadId !== id) continue;
          pendingDeltas.current.delete(key);
          pendingBytes.current -= pending.bytes;
          if (lastPending.current === key) lastPending.current = null;
        }
        if (!pendingDeltas.current.size) {
          pendingBytes.current = 0;
          if (deltaFrame.current !== null)
            cancelAnimationFrame(deltaFrame.current);
          deltaFrame.current = null;
        }
      }),
    [],
  );

  return useCallback(
    (payload: ServerNotification) => {
      observeConfigNotice(payload);
      const method = payload.method;
      // Private reasoning is never retained, even when an older source emits it.
      if (method === "item/reasoning/textDelta") return;
      if (method === "serverRequest/resolved") {
        resolveCodexServerRequest(
          payload.params.threadId,
          payload.params.requestId,
        );
        return;
      }
      let threadId = null;
      if (method === "thread/started") {
        threadId = payload.params.thread.id;
      } else if ("threadId" in payload.params) {
        threadId = payload.params.threadId;
      }
      if (threadId && !isDeltaEvent(payload) && !isToolTranscriptEvent(payload))
        flushPendingDeltas(threadId);

      if (method === "account/updated") {
        resetGoalCompletionScope();
        void syncAccountState(true);
      }

      if (method === "account/login/completed") {
        const loginCompleted =
          payload.params as AccountLoginCompletedNotification;
        if (loginCompleted.success) {
          void syncAccountState(true);
        }
      }

      if (threadId) {
        const parent =
          method === "thread/started"
            ? subagentParent(payload.params.thread)
            : null;
        const observed =
          isObservedCodexThread(threadId) ||
          (parent !== null && isObservedCodexThread(parent));
        if (observed) {
          observeSubagents(payload);
          if (isCodexTranscriptDormant(threadId)) {
            const delivered = deliveredClientIds([payload]);
            if (delivered.size)
              acknowledgeDeliveryEchoes(threadId, [...delivered]);
          }
        }

        // Pending RPCs have their own stores and may outlive display membership.
        // Expiration must still follow the exact native thread/turn identity.
        if (method === "turn/completed")
          clearCodexRequests(threadId, payload.params.turn.id);
        else if (method === "thread/closed" || method === "thread/deleted")
          clearCodexRequests(threadId);
        else if (method === "error" && !payload.params.willRetry)
          clearCodexRequests(threadId, payload.params.turnId);
        else if (
          method === "thread/status/changed" &&
          payload.params.status.type === "systemError"
        ) {
          const turn = useCodexStore.getState().turnTimingMap[threadId];
          if (turn) clearCodexRequests(threadId, turn.turnId);
        }

        const known =
          observed ||
          !!useCodexStore.getState().historyLoadedMap?.[threadId] ||
          useCodexStore
            .getState()
            .threads.some((thread) => thread.id === threadId);
        if (method === "thread/goal/updated" || method === "thread/goal/cleared") {
          // Completion is small lifecycle metadata. A known read-only history
          // keeps its badge even when its transcript is no longer observed.
          if (known) {
            useCodexStore.getState().addEvent(threadId, payload);
            if (method === "thread/goal/updated" && payload.params.goal.status === "complete")
              void notifyGoalCompletionAutoClear(threadId);
          }
          return;
        }
        if (method === "thread/settings/updated" && known) {
          const settings = payload.params.threadSettings;
          hydrateThreadModel(threadId, nativeThreadSettings(settings), {
            notify: !!useCodexStore.getState().historyLoadedMap?.[threadId],
          });
          return;
        }
        if (["mcpServer/startupStatus/updated"].includes(method)) {
          return;
        }

        if (method === "thread/started" && known) {
          const { cwd } = payload.params.thread;
          if (threadId && cwd) {
            useCodexStore.setState((state) => ({
              threads: state.threads.map((thread) =>
                thread.id === threadId ? { ...thread, cwd: cwd } : thread,
              ),
            }));
          }
        }

        if (method === "thread/name/updated" && known) {
          const { threadName } = payload.params;
          if (threadName)
            useSessionNameStore
              .getState()
              .initializeName("codex", threadId, threadName);
          useCodexStore.setState((state) => ({
            threads: state.threads.map((thread) =>
              thread.id === threadId
                ? { ...thread, name: threadName ?? null }
                : thread,
            ),
          }));
        }

        if (observed && method === "thread/tokenUsage/updated") {
          const { tokenUsage } = payload.params;
          useCodexStore.getState().setTokenUsage(threadId, tokenUsage);
        }

        if (
          observed &&
          refs.preventSleepDuringTasksRef.current &&
          method === "turn/started"
        ) {
          void preventSleep(threadId).catch((error) => {
            console.warn(
              "[useServerNotificationHandler] preventSleep failed:",
              error,
            );
          });
        }

        if (method === "turn/completed") {
          void allowSleep(threadId).catch((error) => {
            console.warn(
              "[useServerNotificationHandler] allowSleep failed:",
              error,
            );
          });

          const turnStatus = payload.params.turn.status;
          if (known && turnStatus === "completed")
            useSessionAttentionStore
              .getState()
              .complete("codex", threadId, payload.params.turn.id);
          if (
            known &&
            turnStatus === "completed" &&
            !useSubagentStore.getState().nodes[threadId] &&
            (document.hidden || !document.hasFocus() || !isSessionModeActive())
          ) {
            void notifyDesktop("Codex 任务已完成", undefined, () =>
              toast.success("Codex 任务已完成"),
            );
          }
          if (
            known &&
            turnStatus === "completed" &&
            !useSubagentStore.getState().nodes[threadId] &&
            shouldPlayCompletionBeep(
              refs.taskCompleteBeepModeRef.current,
              refs.isCodexThreadActiveRef.current,
            )
          ) {
            playBeep();
          }
        }

        if (method === "error" && !payload.params.willRetry) {
          void allowSleep(threadId).catch((error) => {
            console.warn(
              "[useServerNotificationHandler] allowSleep failed:",
              error,
            );
          });
        }

        // Lifecycle cleanup also runs after a task leaves display membership.
        // Only observed tasks retain transcript bodies and derived execution state.
        if (!observed) {
          if (known && method === "thread/status/changed" && payload.params.status.type === "idle" &&
              useCodexStore.getState().goalMap[threadId]?.status === "complete") {
            // Retain only the small idle authority input for an already known
            // completed goal; never reattach a dormant transcript to clear it.
            useCodexStore.setState(state => state.threadStatusMap[threadId]?.type === "idle" ? state : {
              threadStatusMap: { ...state.threadStatusMap, [threadId]: payload.params.status },
            });
            void notifyGoalCompletionAutoClear(threadId);
          }
          return;
        }
        const displayPayload = withoutToolTranscriptEvent(payload);
        if (!displayPayload) return;
        if (isDeltaEvent(displayPayload)) {
          queueDelta(threadId, displayPayload);
          return;
        }
        const previousEvents = useCodexStore.getState().events[threadId] ?? [];
        useCodexStore.getState().addEvent(threadId, displayPayload);
        if (method === "turn/completed" ||
            (method === "thread/status/changed" && payload.params.status.type === "idle"))
          void notifyGoalCompletionAutoClear(threadId);
        revealNewQuestion(displayPayload, previousEvents);
      }
    },
    // syncAccountState and refs are stable across renders (refs by identity,
    // syncAccountState is defined once per useCodexEvents call).
    [flushPendingDeltas, queueDelta, syncAccountState, refs],
  );
}
