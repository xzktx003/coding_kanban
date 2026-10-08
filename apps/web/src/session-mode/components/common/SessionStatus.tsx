import { codexRuntimeState } from "@session/utils/codexRuntimeState";
import { useShallow } from "zustand/react/shallow";
import { SessionStatusIndicator } from "./SessionStatusIndicator";
import { useCodexStore } from "../codex/stores";
import { useCCStore } from "../../stores/cc";
import { useAcpStore } from "../../stores/useAcpStore";
import {
  latestUnread,
  sessionKey,
  useSessionAttentionStore,
  type SessionKind,
} from "../../stores/useSessionAttentionStore";

export type SessionState =
  | "running"
  | "pending"
  | "unread"
  | "failed"
  | "idle"
  | "completed";
export function useSessionState(
  kind: SessionKind,
  id: string | null,
): SessionState {
  const unread = useSessionAttentionStore((s) =>
    id ? latestUnread(s.receipts[sessionKey(kind, id)]) : null,
  );
  const completed = useSessionAttentionStore((s) =>
    Boolean(id && s.receipts[sessionKey(kind, id)]?.completed.length),
  );
  const runtime = useCodexStore(useShallow(s => codexRuntimeState(s, kind === "codex" ? id : null)));
  const loading = useCCStore((s) =>
    kind === "cc" && id ? s.sessionLoadingMap[id] : false,
  );
  const messages = useCCStore((s) =>
    kind === "cc" && id ? s.sessionMessagesMap[id] : undefined,
  );
  const acpRunning = useAcpStore(
    (s) => kind === "acp" && id === `${s.agentId}:${s.sessionId}` && s.running,
  );
  const acpPending = useAcpStore(
    (s) =>
      kind === "acp" &&
      id === `${s.agentId}:${s.sessionId}` &&
      Boolean(s.permission),
  );
  const acpFailed = useAcpStore(
    (s) =>
      kind === "acp" &&
      id === `${s.agentId}:${s.sessionId}` &&
      s.entries.at(-1)?.role === "error",
  );
  if (
    runtime.pending ||
    messages?.some((m) => m.type === "permission_request" && !m.resolved) ||
    acpPending
  )
    return "pending";
  if (runtime.running || loading || acpRunning) return "running";
  if (
    runtime.failed ||
    acpFailed ||
    (messages?.at(-1)?.type === "result" &&
      (messages.at(-1) as { is_error?: boolean }).is_error)
  )
    return "failed";
  return unread ? "unread" : completed ? "completed" : "idle";
}
export function SessionStatus({
  kind,
  id,
  compact = false,
}: {
  kind: SessionKind;
  id: string | null;
  compact?: boolean;
}) {
  const state = useSessionState(kind, id);
  return <SessionStatusIndicator state={state} compact={compact} />;
}
export function UnreadDot({
  kind,
  id,
}: {
  kind: SessionKind;
  id: string | null;
}) {
  const unread = useSessionAttentionStore((s) =>
    id ? latestUnread(s.receipts[sessionKey(kind, id)]) : null,
  );
  const state = useSessionState(kind, id);
  return unread && state === "unread" ? (
    <span
      className="session-unread-dot"
      role="img"
      aria-label="有新的回复未读"
      title="有新的回复未读"
    />
  ) : null;
}
export function UnreadCount() {
  const count = useSessionAttentionStore(
    (s) => Object.values(s.receipts).filter((r) => latestUnread(r)).length,
  );
  return count ? (
    <span
      className="session-unread-count"
      title={`${count} 个会话有新回复`}
      aria-label={`${count} 个会话有新回复`}
    >
      {count}
    </span>
  ) : null;
}
