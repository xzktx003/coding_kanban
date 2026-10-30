import {
  noteAcpOwnerEvent,
  refreshKnownAcpRuntimeOwners,
} from "@session/services/acpRuntimeOwners";
import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";
import { isDesktopTauri } from "@session/hooks/runtime";
import { openEventStream } from "@session/lib/eventStream";
import { useAcpStore } from "@session/stores/useAcpStore";
import { applyAcpUpdate } from "./applyUpdate";
import {
  acknowledgeAcpPrompt,
  foldPersistentAcpUpdate,
} from "@session/services/acpTranscriptIdentity";
import {
  providerTranscriptKey,
  trackProviderTranscript,
  updateProviderTranscript,
  useProviderTranscriptStore,
  isProviderTranscriptDormant,
} from "@session/services/sessionProviderTranscriptState";
import { refreshAcpTranscript } from "@session/services/acpTranscriptRead";
import { requestAcpConnectionRecovery } from "@session/services/acpConnectionRecoveryPointer";

type AcpEventPayload = {
  connectionId: string;
  agentId: string;
  running?: boolean;
  deliveryUnknown?: boolean;
  lifecycleUnknown?: boolean;
  pendingRequestIds?: string[];
  kind:
    | "update"
    | "permission"
    | "stderr"
    | "exited"
    | "notification"
    | "prompt-persisted"
    | "execution-state";
  historySourceId?: number;
  historySessionId?:string;
  runtimeInstance?:string;
  clientMessageId?: string;
  sourceRows?: Array<{ historySourceId: number; partIndex: number }>;
  /** Set on `update` and `permission`: which session on the connection it came from. */
  sessionId?: string;
  update?: Record<string, unknown>;
  requestId?: string;
  toolCall?: Record<string, unknown>;
  options?: Array<{ optionId: string; name: string; kind?: string }>;
  line?: string;
};

/**
 * Bridges backend `acp-message` events (Tauri event / SSE) into the ACP store.
 * Mirrors the CC listener: Tauri events on desktop, `/api/events` SSE elsewhere.
 */
export function useAcpEvents(_connectionId: string | null) {
  useEffect(() => {
    const handle = (payload: AcpEventPayload) => {
      noteAcpOwnerEvent(payload);
      const store = useAcpStore.getState();
      const connectionId = store.connectionId;
      if (!connectionId || payload.connectionId !== connectionId) return;
      if (payload.agentId && payload.agentId !== store.agentId) return;
      if(payload.runtimeInstance&&store.runtimeInstance&&payload.runtimeInstance!==store.runtimeInstance)return;
      if(payload.historySessionId&&store.historySessionId&&payload.historySessionId!==store.historySessionId&&payload.sessionId===store.sessionId)return;
      if (
        payload.kind === "execution-state" &&
        (!payload.sessionId || payload.sessionId === store.sessionId)
      ) {
        const key = JSON.stringify([store.connectionId, store.sessionId]);
        const ids = Array.isArray(payload.pendingRequestIds)
          ? new Set(payload.pendingRequestIds)
          : null;
        const permissions = (store.pendingPermissions[key] ?? []).filter(
          (item) => !ids || ids.has(item.requestId),
        );
        useAcpStore.setState({
          running: payload.running === true || payload.deliveryUnknown === true,
          ...(payload.deliveryUnknown || payload.lifecycleUnknown
            ? {
                sessionTransitionError:
                  "已有操作的原生回执尚未确认，请先只读核对当前任务。",
              }
            : store.sessionTransitionError ===
                "已有操作的原生回执尚未确认，请先只读核对当前任务。"
              ? { sessionTransitionError: null }
              : {}),
          pendingPermissions: {
            ...store.pendingPermissions,
            [key]: permissions,
          },
          permission: permissions[0] ?? null,
        });
        return;
      }
      if (payload.kind === "permission") {
        store.setPermission({
          connectionId: payload.connectionId,
          sessionId: payload.sessionId ?? store.sessionId ?? undefined,
          requestId: payload.requestId!,
          title: (payload.toolCall?.title as string) ?? "Permission requested",
          toolKind: payload.toolCall?.kind as string | undefined,
          options: payload.options ?? [],
        });
        return;
      }
      // One process can host several sessions — drop the ones this pane is not
      // showing. Read the open session from the store rather than closing over
      // it: `session/load` replays its transcript the moment the pane switches,
      // before a re-render could resubscribe with the new id. Connection-wide
      // events (`exited`, `stderr`) carry no session and always pass.
      if (
        payload.sessionId &&
        store.sessionId &&
        payload.sessionId !== store.sessionId
      )
        return;

      if (
        payload.kind === "prompt-persisted" &&
        store.sessionId &&
        typeof payload.clientMessageId === "string" &&
        Array.isArray(payload.sourceRows)
      ) {
        const owner = providerTranscriptKey(
          "acp",
          store.sessionId,
          store.agentId,
          connectionId,
        );
        trackProviderTranscript(owner, "acp", store.sessionId);
        const next = acknowledgeAcpPrompt(
          store.entries,
          payload.clientMessageId,
          payload.sourceRows,
        );
        if (next !== store.entries && !isProviderTranscriptDormant(owner))
          store.setEntries(next);
        const boundary = Math.max(
          0,
          ...payload.sourceRows.map((row) =>
            Number.isSafeInteger(row.historySourceId) ? row.historySourceId : 0,
          ),
        );
        updateProviderTranscript(owner, {
          historySourceId: Math.max(
            boundary,
            useProviderTranscriptStore.getState().entries[owner]
              ?.historySourceId ?? 0,
          ),
        });
        return;
      }

      if (payload.kind === "exited") {
        const owner = store.sessionId
          ? providerTranscriptKey(
              "acp",
              store.sessionId,
              store.agentId,
              connectionId,
            )
          : null;
        if (!owner || !isProviderTranscriptDormant(owner))
          store.addEntry({
            id: `exit-${Date.now()}`,
            role: "error",
            text: "Agent process exited.",
          });
        useAcpStore.setState({
          running: false,
          connectionRecovery: "failed",
          sessionTransitionError: "Agent服务已退出，请显式重启后继续。",
        });
        return;
      }

      // Some agents report login links (device-flow OAuth) on stderr or as a
      // bare notification rather than in the `authenticate` response, which
      // carries nothing back. Only worth surfacing while a sign-in is pending.
      if (payload.kind === "stderr" && store.authenticating && payload.line) {
        store.appendAuthNotice(payload.line);
        return;
      }
      if (payload.kind === "notification" && store.authenticating) {
        const text = JSON.stringify(payload).match(/https?:\/\/\S+/)?.[0];
        if (text) store.appendAuthNotice(text);
        return;
      }

      if (payload.kind !== "update" || !payload.update) return;
      if (
        store.sessionId &&
        Number.isSafeInteger(payload.historySourceId) &&
        Number(payload.historySourceId) > 0
      ) {
        const owner = providerTranscriptKey(
          "acp",
          store.sessionId,
          store.agentId,
          connectionId,
        );
        trackProviderTranscript(owner, "acp", store.sessionId);
        const sourceId = Number(payload.historySourceId);
        if (
          sourceId <=
          (useProviderTranscriptStore.getState().entries[owner]
            ?.historySourceId ?? 0)
        )
          return;
        if (!isProviderTranscriptDormant(owner)) {
          const next = foldPersistentAcpUpdate(
            store.entries,
            payload.update,
            sourceId,
            store.chunkSealed,
          );
          if (next !== store.entries) store.setEntries(next);
          else applyAcpUpdate(payload.update as Record<string, any>);
        } else if (
          ["current_mode_update", "config_option_update"].includes(
            String(payload.update.sessionUpdate),
          )
        ) {
          applyAcpUpdate(payload.update as Record<string, any>);
        }
        updateProviderTranscript(owner, { historySourceId: sourceId });
      } else {
        // Legacy runtimes do not tag source rows. They still cannot restore a
        // reclaimed body through a late event; control metadata stays live.
        const owner = store.sessionId
          ? providerTranscriptKey(
              "acp",
              store.sessionId,
              store.agentId,
              connectionId,
            )
          : null;
        if (
          !owner ||
          !isProviderTranscriptDormant(owner) ||
          ["current_mode_update", "config_option_update"].includes(
            String(payload.update.sessionUpdate),
          )
        )
          applyAcpUpdate(payload.update as Record<string, any>);
      }
    };

    if (isDesktopTauri()) {
      const unlisten = listen<AcpEventPayload>("acp-message", (e) =>
        handle(e.payload),
      );
      return () => {
        void unlisten.then((fn) => fn());
      };
    }

    const restore = () => {
      void refreshKnownAcpRuntimeOwners();
      const current = useAcpStore.getState();
      const connectionId = current.connectionId;
      if (!connectionId || !current.sessionId) return;
      const owner = providerTranscriptKey(
        "acp",
        current.sessionId,
        current.agentId,
        connectionId,
      );
      trackProviderTranscript(owner, "acp", current.sessionId);
      updateProviderTranscript(owner, { restoreNeeded: true });
      // Pending permission/task metadata is independent of body reclamation.
      if (current.runtimeInstance) requestAcpConnectionRecovery();
      if (!isProviderTranscriptDormant(owner))
        void refreshAcpTranscript(
          {
            agentId: current.agentId,
            connectionId,
            sessionId: current.sessionId,
          },
          undefined,
          "background",
        ).catch(() => {});
    };
    return openEventStream({
      agents: ["acp"],
      onResync: restore,
      onEvent: (envelope) => {
        if (envelope.event === "acp-message")
          handle(envelope.payload as AcpEventPayload);
      },
    });
  }, []);
}
