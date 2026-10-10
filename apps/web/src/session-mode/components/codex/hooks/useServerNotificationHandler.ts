import { nativeThreadSettings } from "@session/services/nativeThreadSettings";
import { observeConfigNotice } from "@session/features/codex-account/config-notices";
import { observeSubagents, useSubagentStore } from "@session/features/subagents/store";
import { useSessionAttentionStore } from "@session/stores/useSessionAttentionStore";
import { revealNewQuestion } from "@session/features/async-questions/arrival";
import { useSessionNameStore } from "../../../stores/useSessionNameStore";
import { notifyDesktop } from "@session/lib/notify";
import { isSessionModeActive } from "@session/session-dom";
import { toast } from "sonner";
import { type RefObject, useCallback } from "react";
import type { ServerNotification } from "@session/bindings/ServerNotification";
import type { AccountLoginCompletedNotification } from "@session/bindings/v2";
import { useCodexStore } from "@session/components/codex/stores";
import { allowSleep, preventSleep } from "@session/services/apiAdapt";
import { playBeep } from "@session/utils/beep";
import { shouldPlayCompletionBeep } from "./beepOnCompletion";
import { clearCodexRequests, resolveCodexServerRequest } from "./serverRequests";
import { useRequestUserInputStore } from "../stores/useRequestUserInputStore";
import { hydrateThreadModel } from "@session/stores/useThreadModelStore";

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
  return useCallback(
    (payload: ServerNotification) => {
      observeConfigNotice(payload);
      observeSubagents(payload);
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
        if (method === "thread/settings/updated") {
          const settings = payload.params.threadSettings;
          hydrateThreadModel(threadId, nativeThreadSettings(settings), { notify: !!useCodexStore.getState().historyLoadedMap?.[threadId] });
          return;
        }
        if (
          [
            "mcpServer/startupStatus/updated",
          ].includes(method)
        ) {
          return;
        }

        if (method === "thread/started") {
          const { cwd } = payload.params.thread;
          if (threadId && cwd) {
            useCodexStore.setState((state) => ({
              threads: state.threads.map((thread) =>
                thread.id === threadId ? { ...thread, cwd: cwd } : thread,
              ),
            }));
          }
        }

        if (method === "thread/name/updated") {
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

        if (method === "thread/tokenUsage/updated") {
          const { tokenUsage } = payload.params;
          useCodexStore.getState().setTokenUsage(threadId, tokenUsage);
        }

        if (
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
          clearCodexRequests(threadId, payload.params.turn.id);
          void allowSleep(threadId).catch((error) => {
            console.warn(
              "[useServerNotificationHandler] allowSleep failed:",
              error,
            );
          });

          const turnStatus = payload.params.turn.status;
          if (turnStatus === "completed")
            useSessionAttentionStore
              .getState()
              .complete("codex", threadId, payload.params.turn.id);
          if (
            turnStatus === "completed" &&
            !useSubagentStore.getState().nodes[threadId] &&
            (document.hidden || !document.hasFocus() || !isSessionModeActive())
          ) {
            void notifyDesktop("Codex 任务已完成", undefined, () =>
              toast.success("Codex 任务已完成"),
            );
          }
          if (
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

        if (method === "thread/closed" || method === "thread/deleted") {
          clearCodexRequests(threadId);
        }

        if (method === "thread/status/changed" && payload.params.status.type === "systemError") {
          const turn = useCodexStore.getState().turnTimingMap[threadId];
          if (turn) clearCodexRequests(threadId, turn.turnId);
        }

        if (method === "error" && !payload.params.willRetry) {
          clearCodexRequests(threadId, payload.params.turnId);
          void allowSleep(threadId).catch((error) => {
            console.warn(
              "[useServerNotificationHandler] allowSleep failed:",
              error,
            );
          });
        }

        // Forward every non-noise notification to the events slice so
        // derived state (turnTimingMap, threadStatusMap, goalMap, etc.)
        // stays in sync. The noise events are already filtered out above.
        const previousEvents = useCodexStore.getState().events[threadId] ?? [];
        useCodexStore.getState().addEvent(threadId, payload);
        revealNewQuestion(payload, previousEvents);
      }
    },
    // syncAccountState and refs are stable across renders (refs by identity,
    // syncAccountState is defined once per useCodexEvents call).
    [syncAccountState, refs],
  );
}
