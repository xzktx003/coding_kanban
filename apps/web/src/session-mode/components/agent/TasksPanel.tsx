import { useShallow } from "zustand/react/shallow";
import { useCallback, useMemo } from "react";
import { useCodexStore } from "@session/components/codex/stores";
import { useSessionTabActions } from "@session/hooks/useSessionTabs";
import { useAgentCenterStore } from "@session/stores";
import { useCCStore } from "@session/stores/cc";
import type { AgentCenterCard } from "@session/stores/useAgentCenterStore";
import { AgentCard } from "./AgentCard";

function ColumnLabel({
  dot,
  label,
  count,
}: {
  dot?: "green" | "muted";
  label: string;
  count: number;
}) {
  return (
    <div className="flex items-center gap-1.5 px-2 py-1 border-b shrink-0 bg-muted/20">
      {dot && (
        <span
          className={`h-1.5 w-1.5 rounded-full shrink-0 ${dot === "green" ? "bg-green-500" : "bg-muted-foreground/40"}`}
        />
      )}
      <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
        {label}
      </span>
      <span className="text-[10px] text-muted-foreground/50 ml-auto">
        {count}
      </span>
    </div>
  );
}

export default function TasksPanel() {
  const { cards, currentAgentCardId, currentAgentCardKind } =
    useAgentCenterStore();
  const { sessionLoadingMap } = useCCStore();
  const { threadStatusMap } = useCodexStore(
    useShallow((s) => ({ threadStatusMap: s.threadStatusMap })),
  );
  const { selectTab, closeTab } = useSessionTabActions();

  const isRunning = useCallback(
    (card: AgentCenterCard) =>
      card.kind === "codex"
        ? threadStatusMap[card.id]?.type === "active"
        : !!sessionLoadingMap[card.id],
    [threadStatusMap, sessionLoadingMap],
  );

  const handleRemove = (card: AgentCenterCard) => {
    void closeTab(card);
  };

  const selectCard = (card: AgentCenterCard) => {
    void selectTab(card);
  };

  const runningCards = useMemo(
    () => cards.filter((c) => isRunning(c)),
    [cards, isRunning],
  );

  const idleCards = useMemo(
    () => cards.filter((c) => !isRunning(c)),
    [cards, isRunning],
  );

  return (
    <div className="flex flex-row h-full w-full min-w-0 overflow-hidden">
      {/* Running section */}
      <div className="flex-1 min-w-0 flex flex-col border-r border-white/10">
        <ColumnLabel dot="green" label="Running" count={runningCards.length} />
        <div className="flex-1 min-h-0 overflow-y-auto p-2 flex flex-col gap-2">
          {runningCards.length === 0 ? (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground/40 py-4">
              No running agents
            </div>
          ) : (
            runningCards.map((card) => (
              <div
                key={card.id}
                role="button"
                tabIndex={0}
                onClick={() => selectCard(card)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    selectCard(card);
                  }
                }}
                className="cursor-pointer"
              >
                <AgentCard
                  card={card}
                  onRemove={() => handleRemove(card)}
                  isSelected={
                    card.id === currentAgentCardId &&
                    (!currentAgentCardKind ||
                      card.kind === currentAgentCardKind)
                  }
                />
              </div>
            ))
          )}
        </div>
      </div>

      {/* Idle section */}
      <div className="flex-1 min-w-0 flex flex-col">
        <ColumnLabel dot="muted" label="Idle" count={idleCards.length} />
        <div className="flex-1 min-h-0 overflow-y-auto p-2 flex flex-col gap-2">
          {idleCards.length === 0 ? (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground/40 py-4">
              No idle agents
            </div>
          ) : (
            idleCards.map((card) => (
              <div
                key={card.id}
                role="button"
                tabIndex={0}
                onClick={() => selectCard(card)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    selectCard(card);
                  }
                }}
                className="cursor-pointer"
              >
                <AgentCard
                  card={card}
                  onRemove={() => handleRemove(card)}
                  isSelected={
                    card.id === currentAgentCardId &&
                    (!currentAgentCardKind ||
                      card.kind === currentAgentCardKind)
                  }
                />
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
