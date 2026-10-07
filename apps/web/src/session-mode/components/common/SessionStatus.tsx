import {
  Circle,
  CircleAlert,
  CircleCheck,
  Clock3,
  Loader2,
} from "lucide-react";
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
  const codex = useCodexStore((s) =>
    kind === "codex" && id ? s.threadStatusMap[id] : undefined,
  );
  const failed = useCodexStore((s) =>
    kind === "codex" && id ? s.turnTimingMap[id]?.status === "failed" : false,
  );
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
    (codex?.type === "active" && codex.activeFlags.length) ||
    messages?.some((m) => m.type === "permission_request" && !m.resolved) ||
    acpPending
  )
    return "pending";
  if (codex?.type === "active" || loading || acpRunning) return "running";
  if (
    failed ||
    acpFailed ||
    (messages?.at(-1)?.type === "result" &&
      (messages.at(-1) as { is_error?: boolean }).is_error)
  )
    return "failed";
  return unread ? "unread" : completed ? "completed" : "idle";
}
const STATES = {
  running: { label: "运行中", Icon: Loader2 },
  pending: { label: "待处理", Icon: Clock3 },
  unread: { label: "新回复", Icon: CircleCheck },
  failed: { label: "失败", Icon: CircleAlert },
  completed: { label: "已读", Icon: CircleCheck },
  idle: { label: "空闲", Icon: Circle },
};
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
  const { label, Icon } = STATES[state];
  if (
    state === "idle" ||
    state === "completed" ||
    (!compact && state === "unread")
  )
    return null;
  if (compact && state === "running")
    return (
      <span
        className="session-status"
        data-state="running"
        data-compact="true"
        aria-label="运行中"
        title="运行中"
      >
        <Loader2 size={15} className="session-status-spin" />
      </span>
    );
  if (compact)
    return ["unread", "pending", "failed"].includes(state) ? (
      <span
        className="session-status-dot"
        data-state={state}
        role="img"
        aria-label={state === "unread" ? "有新的回复未读" : label}
        title={state === "unread" ? "有新的回复未读" : label}
      />
    ) : null;
  return (
    <span
      className="session-status"
      data-state={state}
      data-compact={compact}
      title={label}
      aria-label={label}
    >
      <Icon
        size={compact ? 14 : 13}
        className={state === "running" ? "session-status-spin" : ""}
      />
      {!compact && <span>{label}</span>}
    </span>
  );
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
