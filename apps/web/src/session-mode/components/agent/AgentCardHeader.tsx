import { useSessionSplitStore } from "../../stores/useSessionSplitStore";
import { SessionStatus, UnreadDot } from "../common/SessionStatus";
import { useCodexStore } from "../codex/stores";
import { RenameSessionButton } from "../common/RenameSessionButton";
import { useSessionName } from "../../stores/useSessionNameStore";
import { X, ArrowUpDown } from "lucide-react";
import { SessionIdentityTitle, SessionProjectLabel } from "./SessionIdentity";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import {
  useAgentCenterStore,
  agentCardKey,
  type AgentCenterCard,
} from "@session/stores/useAgentCenterStore";

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
  const cards = useAgentCenterStore((s) => s.cards);
  const index = cards.findIndex((c) => agentCardKey(c) === agentCardKey(card));
  const move = (offset: number) => {
    const target = cards[index + offset];
    if (!target) return;
    useAgentCenterStore.getState().moveCard(card, target);
    useSessionSplitStore
      .getState()
      .reorderWithinGroups(
        useAgentCenterStore.getState().cards.map(agentCardKey),
      );
  };
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
      aria-label={onSelect ? `选择会话：${title}` : undefined}
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
      <div className="session-card-identity">
        <div className="session-identity-main">
          <SessionIdentityTitle kind={card.kind} title={title} />
        </div>
        <SessionProjectLabel card={card} />
      </div>
      <UnreadDot kind={card.kind} id={card.id} />
      <SessionStatus kind={card.kind} id={card.id} />
      <RenameSessionButton kind={card.kind} id={card.id} title={title} />
      {index >= 0 && (
        <span
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="session-card-reorder"
                aria-label={`排列会话：${title}`}
                title="排列会话"
              >
                <ArrowUpDown size={14} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              onClick={(e) => e.stopPropagation()}
            >
              <DropdownMenuItem
                disabled={index === 0}
                onSelect={() => move(-1)}
              >
                向前移动
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={index === cards.length - 1}
                onSelect={() => move(1)}
              >
                向后移动
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      )}
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
