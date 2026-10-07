import { useSessionState } from "../common/SessionStatus";
import { useShallow } from "zustand/react/shallow";
import type {
  CCMessage,
  PermissionRequestMessage,
} from "@session/components/cc/types/messages";
import {
  useApprovalStore,
  useCodexStore,
  useRequestUserInputStore,
} from "@session/components/codex/stores";
import type { ApprovalRequest } from "@session/components/codex/stores/useApprovalStore";
import type { RequestUserInputRequest } from "@session/components/codex/stores/useRequestUserInputStore";
import { useSessionTabActions } from "@session/hooks/useSessionTabs";
import { useCCStore } from "@session/stores/cc";
import type { AgentCenterCard } from "@session/stores/useAgentCenterStore";
import { AgentCardHeader } from "./AgentCardHeader";
import { CCAgentCard } from "./CcAgentCard";
import { CodexAgentCard } from "./CodexAgentCard";

type AgentStatus = "running" | "pending" | "idle";

export interface AgentCardProps {
  card: AgentCenterCard;
  onRemove: () => void;
  isSelected: boolean;
  // When true, only the header is rendered (used by the list view).
  hideBody?: boolean;
}

export function AgentCard({
  card,
  onRemove,
  isSelected,
  hideBody = false,
}: AgentCardProps) {
  const { selectTab } = useSessionTabActions();
  const { sessionLoadingMap, sessionMessagesMap, activeSessionIds } =
    useCCStore();
  const { threadStatusMap } = useCodexStore(
    useShallow((s) => ({ threadStatusMap: s.threadStatusMap })),
  );
  const { pendingApprovals } = useApprovalStore();
  const { pendingRequests } = useRequestUserInputStore();
  const codexStatus =
    card.kind === "codex" ? threadStatusMap[card.id] : undefined;
  const running =
    card.kind === "codex"
      ? codexStatus?.type === "active" && codexStatus.activeFlags.length === 0
      : activeSessionIds.includes(card.id) && !!sessionLoadingMap[card.id];

  const pending =
    card.kind === "codex"
      ? codexStatus?.type === "active" && codexStatus.activeFlags.length > 0
      : (sessionMessagesMap[card.id] ?? []).some(
          (m: CCMessage): m is PermissionRequestMessage =>
            m.type === "permission_request" && !m.resolved,
        ) ||
        pendingApprovals.some((a: ApprovalRequest) => a.threadId === card.id) ||
        pendingRequests.some(
          (r: RequestUserInputRequest) => r.threadId === card.id,
        );

  const status: AgentStatus = running
    ? "running"
    : pending
      ? "pending"
      : "idle";

  const visualState = useSessionState(card.kind, card.id);
  const header = (
    <AgentCardHeader
      card={card}
      onClose={onRemove}
      onSelect={() => void selectTab(card)}
      status={status}
    />
  );

  // List view: render header only, no body/footer.
  if (hideBody) {
    const attentionBorder = isSelected
      ? "ring-2 ring-primary/60 border-primary/30"
      : "border";
    return (
      <div
        data-session-card={card.id}
        data-attention={visualState}
        data-selected={isSelected}
        className={`rounded-lg bg-background overflow-hidden ${attentionBorder}`}
      >
        {header}
      </div>
    );
  }

  if (card.kind === "codex") {
    return (
      <CodexAgentCard
        card={card as AgentCenterCard & { kind: "codex" }}
        onRemove={onRemove}
        header={header}
        isSelected={isSelected}
      />
    );
  }

  return (
    <CCAgentCard
      card={card as AgentCenterCard & { kind: "cc" }}
      onRemove={onRemove}
      header={header}
      isSelected={isSelected}
    />
  );
}
