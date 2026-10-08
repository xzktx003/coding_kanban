import {
  Circle,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  Clock3,
  Loader2,
} from "lucide-react";
import type { SessionState } from "./SessionStatus";

/** Shared visual vocabulary; callers supply the state they have already resolved. */
const STATES = {
  running: { label: "运行中", Icon: Loader2 },
  pending: { label: "待处理", Icon: Clock3 },
  unread: { label: "新回复", Icon: CircleCheck },
  failed: { label: "失败", Icon: CircleAlert },
  completed: { label: "已完成", Icon: CircleCheck },
  idle: { label: "空闲", Icon: Circle },
  unknown: { label: "状态待同步", Icon: CircleDashed },
};
export function SessionStatusIndicator({
  state,
  compact = false,
  showInactive = false,
}: {
  state: SessionState | "unknown";
  compact?: boolean;
  showInactive?: boolean;
}) {
  const { label, Icon } = STATES[state];
  if (
    showInactive &&
    compact &&
    ["idle", "completed", "unknown"].includes(state)
  )
    return (
      <span
        className="session-status"
        data-state={state}
        data-compact="true"
        role="img"
        aria-label={label}
        title={label}
      >
        <Icon size={15} />
      </span>
    );
  if (
    state === "unknown" ||
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
