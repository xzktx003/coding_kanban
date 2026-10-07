import { SessionStatus, UnreadDot } from "../common/SessionStatus";
import { useCodexStore } from "../codex/stores";
import { RenameSessionButton } from "../common/RenameSessionButton";
import { useSessionName } from "../../stores/useSessionNameStore";
import { X } from "lucide-react";
import { SessionAgentBadge } from "@session/components/common/SessionAgentBadge";
import type { AgentCenterCard } from "@session/stores/useAgentCenterStore";

type AgentStatus = "running" | "pending" | "idle";

interface AgentCardHeaderProps {
  card: AgentCenterCard;
  onClose?: () => void;
  onSelect?: () => void;
  status?: AgentStatus;
}
export function AgentCardHeader({
  card,
  onClose,
  onSelect,
  status = "idle",
}: AgentCardHeaderProps) {
  const nativeName = useCodexStore((s) => {
    const thread =
      card.kind === "codex"
        ? s.threads.find((thread) => thread.id === card.id)
        : undefined;
    return thread?.name || thread?.preview;
  });
  const title = useSessionName(
    card.kind,
    card.id,
    nativeName || card.preview || card.id.slice(0, 12),
    nativeName || undefined,
  );

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: role and tabIndex are applied together with the handler, both gated on onSelect
    <div
      className="session-card-header flex items-center gap-2 px-3 py-2 border-b bg-muted/30 shrink-0"
      role={onSelect ? "button" : undefined}
      tabIndex={onSelect ? 0 : undefined}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (
          e.target === e.currentTarget &&
          onSelect &&
          (e.key === "Enter" || e.key === " ")
        ) {
          e.preventDefault();
          onSelect();
        }
      }}
      style={onSelect ? { cursor: "pointer" } : undefined}
    >
      <SessionAgentBadge kind={card.kind} />
      <span className="session-card-title text-sm text-foreground truncate flex-1 min-w-0">
        {title}
      </span>
      <UnreadDot kind={card.kind} id={card.id} />
      <SessionStatus kind={card.kind} id={card.id} />
      <RenameSessionButton kind={card.kind} id={card.id} title={title} />
      {onClose && (
        <button
          type="button"
          className="session-card-close"
          aria-label="关闭标签"
          title="关闭标签，后台任务继续运行"
          onClick={(event) => {
            event.stopPropagation();
            onClose();
          }}
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}
