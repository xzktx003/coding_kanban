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
  createStreamingTextPreview,
  materializeStreamingTextPreview,
  STREAMING_TEXT_LIMIT,
  type StreamingTextPreview,
} from "@session/services/codexTranscriptMemoryBudget";
import { playBeep } from "@session/utils/beep";
import { shouldPlayCompletionBeep } from "./beepOnCompletion";
import {
  clearCodexRequests,
  resolveCodexServerRequest,
} from "./serverRequests";
import { useRequestUserInputStore } from "../stores/useRequestUserInputStore";
import { hydrateThreadModel } from "@session/stores/useThreadModelStore";
import { isDeltaEvent, type DeltaEvent } from "../stores/eventUtils";

export type BeepMode = "never" | "unfocused" | "always";

interface NotificationHandlerRefs {
  isCodexThreadActiveRef: RefObject<boolean>;
  taskCompleteBeepModeRef: RefObject<BeepMode>;
  preventSleepDuringTasksRef: RefObject<boolean>;
}

// Encapsulates all business logic for handling incoming ServerNotification
// events (thread/turn/account/item updates). Transport-agnostic: used by
// both the Tauri listener path and the SSE bridge path.
export function useServerNotificationHandler(
  refs: NotificationHandlerRefs,
  syncAccountState: (refreshToken: boolean) => Promise<void>,
) {
  const pendingDeltas = useRef(
    new Map<
      string,
      { threadId: string; event: DeltaEvent; preview?: StreamingTextPreview }
    >(),
  );
  const deltaFrame = useRef<number | null>(null);

  const flushPendingDeltas = useCallback((threadId?: string) => {
    const batches = new Map<string, DeltaEvent[]>();
    for (const [key, pending] of pendingDeltas.current) {
      if (threadId && pending.threadId !== threadId) continue;
      pendingDeltas.current.delete(key);
      if (isCodexTranscriptDormant(pending.threadId)) continue;
      const batch = batches.get(pending.threadId);
      const event = pending.preview
        ? ({
            ...pending.event,
            params: {
              ...pending.event.params,
              delta: materializeStreamingTextPreview(pending.preview),
            },
          } as DeltaEvent)
        : pending.event;
      if (batch) batch.push(event);
      else batches.set(pending.threadId, [event]);
    }
    for (const [id, events] of batches) {
      const liveMessages = events.filter(
        (event) => event.method === "item/agentMessage/delta",
      );
      const transcriptDeltas = events.filter(
        (event) => event.method !== "item/agentMessage/delta",
      );
      const store = useCodexStore.getState();
      if (liveMessages.length) store.setStreamingAgentDeltas(id, liveMessages);
      if (transcriptDeltas.length)
        store.addTranscriptDeltas(id, transcriptDeltas);
    }

    if (!pendingDeltas.current.size && deltaFrame.current !== null) {
      cancelAnimationFrame(deltaFrame.current);
      deltaFrame.current = null;
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
      const existing = pendingDeltas.current.get(key);
      if (boundedEvent.method === "item/agentMessage/delta") {
        const delta = boundedEvent.params.delta;
        const previousText =
          existing?.event.method === "item/agentMessage/delta"
            ? existing.event.params.delta
            : "";
        let preview = existing?.preview;
        let mergedText = delta;
        if (preview) {
          preview = appendStreamingTextPreview(preview, delta);
          mergedText = "";
        } else {
          const combined = `${previousText}${delta}`;
          if (combined.length > STREAMING_TEXT_LIMIT) {
            preview = createStreamingTextPreview(combined);
            mergedText = "";
          } else {
            mergedText = combined;
          }
        }
        pendingDeltas.current.set(key, {
          threadId,
          event: {
            ...boundedEvent,
            params: { ...boundedEvent.params, delta: mergedText },
          },
          ...(preview ? { preview } : {}),
        });
      } else {
        const merged = existing
          ? ({
              ...boundedEvent,
              params: {
                ...boundedEvent.params,
                delta: `${existing.event.params.delta}${boundedEvent.params.delta}`,
              },
            } as DeltaEvent)
          : boundedEvent;
        pendingDeltas.current.set(key, {
          threadId,
          event: compactCodexEventPayload(merged) as DeltaEvent,
        });
      }

      if (deltaFrame.current === null) {
        deltaFrame.current = requestAnimationFrame(() => {
          deltaFrame.current = null;
          flushPendingDeltas();
        });
      }
    },
    [flushPendingDeltas],
  );

  useEffect(() => () => flushPendingDeltas(), [flushPendingDeltas]);
  useEffect(
    () =>
      onCodexTranscriptReleased((id) => {
        // Hidden documents may never run the queued animation frame. Release its
        // payloads immediately instead of waiting for a future visible frame.
        for (const [key, pending] of pendingDeltas.current) {
          if (pending.threadId === id) pendingDeltas.current.delete(key);
        }
        if (!pendingDeltas.current.size && deltaFrame.current !== null) {
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
        if (!observed) return;
        const displayPayload = withoutToolTranscriptEvent(payload);
        if (!displayPayload) return;
        if (isDeltaEvent(displayPayload)) {
          queueDelta(threadId, displayPayload);
          return;
        }
        const previousEvents = useCodexStore.getState().events[threadId] ?? [];
        useCodexStore.getState().addEvent(threadId, displayPayload);
        revealNewQuestion(displayPayload, previousEvents);
      }
    },
    // syncAccountState and refs are stable across renders (refs by identity,
    // syncAccountState is defined once per useCodexEvents call).
    [flushPendingDeltas, queueDelta, syncAccountState, refs],
  );
}
