import { useSessionAttentionStore } from "../stores/useSessionAttentionStore";
import { useEffect } from "react";
import { toast } from "sonner";
import { openEventStream, type EventEnvelope } from "../lib/eventStream";
import { notifyDesktop } from "../lib/notify";
import { isDesktopTauri } from "../hooks/runtime";
import { useCCStore } from "../stores/cc";
import type { CCMessage, SystemMessage } from "../components/cc/types/messages";
let active = false;
export const hasCCGlobalBridge = () => active;
interface PermissionPayload {
  requestId: string;
  sessionId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  alwaysAllowTarget?: "project" | "session";
}
export function handleCCBackgroundEvent(event: EventEnvelope) {
  if (event.event !== "cc-message" && event.event !== "cc-permission-request")
    return;
  const permission =
    event.event === "cc-permission-request"
      ? (event.payload as PermissionPayload)
      : null;
  const message = permission
    ? ({ type: "permission_request", ...permission } as CCMessage)
    : (event.payload as CCMessage);
  const id =
    permission?.sessionId ?? (message as { session_id?: string }).session_id;
  if (!id) return;
  const store = useCCStore.getState();
  if (
    id !== store.activeSessionId &&
    !(id in store.sessionLoadingMap) &&
    !(id in store.sessionMessagesMap)
  )
    return;
  store.addMessageToSession(id, message);
  if (message.type === "result" && !message.is_error)
    useSessionAttentionStore
      .getState()
      .complete(
        "cc",
        id,
        message.uuid || `${message.duration_ms}:${message.num_turns}`,
      );
  if (permission && (document.hidden || id !== store.activeSessionId)) {
    void notifyDesktop("Claude 正在等待你的批准", undefined, () =>
      toast.info("Claude 正在等待你的批准，请打开对应会话。"),
    );
  }
  if (
    id === store.activeSessionId &&
    message.type === "system" &&
    (message as SystemMessage).subtype === "init"
  ) {
    const commands = (message as SystemMessage).slash_commands;
    if (Array.isArray(commands)) store.setSlashCommands(commands);
  }
  if (
    message.type === "result" &&
    !message.is_error &&
    (document.hidden || id !== store.activeSessionId)
  )
    void notifyDesktop("Claude 任务已完成", undefined, () =>
      toast.success("Claude 任务已完成"),
    );
}
export function useCCBackgroundEvents() {
  useEffect(() => {
    if (isDesktopTauri()) return;
    active = true;
    const close = openEventStream({
      agents: ["cc"],
      onEvent: handleCCBackgroundEvent,
    });
    return () => {
      active = false;
      close();
    };
  }, []);
}
