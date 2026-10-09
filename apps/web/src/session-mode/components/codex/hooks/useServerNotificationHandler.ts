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
    new Map<string, { threadId: string; event: DeltaEvent }>(),
  );
  const deltaFrame = useRef<number | null>(null);

  const flushPendingDeltas = useCallback((threadId?: string) => {
    const batches = new Map<string, DeltaEvent[]>();
    for (const [key, pending] of pendingDeltas.current) {
      if (threadId && pending.threadId !== threadId) continue;
      pendingDeltas.current.delete(key);
      const batch = batches.get(pending.threadId);
      if (batch) batch.push(pending.event);
      else batches.set(pending.threadId, [pending.event]);
    }
    for (const [id, events] of batches)
      useCodexStore.getState().addTranscriptDeltas(id, events);

    if (!pendingDeltas.current.size && deltaFrame.current !== null) {
      cancelAnimationFrame(deltaFrame.current);
      deltaFrame.current = null;
    }
  }, []);

  const queueDelta = useCallback(
    (threadId: string, event: DeltaEvent) => {
      const params = event.params as typeof event.params & {
        summaryIndex?: number;
        contentIndex?: number;
      };
      const key = JSON.stringify([
        threadId,
        event.method,
        params.turnId,
        params.itemId,
        params.summaryIndex ?? null,
        params.contentIndex ?? null,
      ]);
      const previous = pendingDeltas.current.get(key)?.event;
      const merged = previous
        ? ({
            ...event,
            params: {
              ...event.params,
              delta: `${previous.params.delta}${event.params.delta}`,
            },
          } as DeltaEvent)
        : event;
      pendingDeltas.current.set(key, { threadId, event: merged });

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

  return useCallback(
    (payload: ServerNotification) => {
      const method = payload.method;
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
      if (threadId && !isDeltaEvent(payload)) flushPendingDeltas(threadId);

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
        if (observed) observeSubagents(payload);

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
          hydrateThreadModel(
            threadId,
            {
              model: settings.model,
              modelProvider: settings.modelProvider,
              reasoningEffort: settings.effort,
            },
            { notify: !!useCodexStore.getState().historyLoadedMap?.[threadId] },
          );
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
        if (isDeltaEvent(payload)) {
          queueDelta(threadId, payload);
          return;
        }
        const previousEvents = useCodexStore.getState().events[threadId] ?? [];
        useCodexStore.getState().addEvent(threadId, payload);
        revealNewQuestion(payload, previousEvents);
      }
    },
    // syncAccountState and refs are stable across renders (refs by identity,
    // syncAccountState is defined once per useCodexEvents call).
    [flushPendingDeltas, queueDelta, syncAccountState, refs],
  );
}
