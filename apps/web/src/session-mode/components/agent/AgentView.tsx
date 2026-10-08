import { useShallow } from "zustand/react/shallow";
import { lazy, Suspense } from "react";
import { useCodexStore } from "@session/components/codex/stores";
import { useCCStore } from "@session/stores/cc";
import { useAcpStore } from "@session/stores/useAcpStore";
import { useAgentCenterStore } from "@session/stores/useAgentCenterStore";
import { useAgentSettingsStore } from "@session/stores/useAgentSettingsStore";
import { AgentCard } from "./AgentCard";
import { AgentComposer } from "./AgentComposer";
import { AgentViewHeader } from "./AgentViewHeader";
import { SessionGroups } from "./SessionGroups";
import { SessionWelcome } from "@session/SessionWelcome";
import {
  useRestoreSessionTabs,
  useSessionTabActions,
} from "@session/hooks/useSessionTabs";

const CodexThread = lazy(() =>
  import("@session/components/codex/thread/CodexThread").then((m) => ({
    default: m.CodexThread,
  })),
);
const CCSession = lazy(
  () => import("@session/components/cc/session/CCSession"),
);
const AcpSession = lazy(() => import("@session/components/acp/AcpSession"));

/** Renders the transcript for whichever agent drives the chat pane. */
function AgentSession() {
  const { selectedAgent } = useAgentSettingsStore();
  const acpActive = useAcpStore((s) => s.active);
  if (acpActive) return <AcpSession />;
  if (selectedAgent === "cc") return <CCSession />;
  return <CodexThread />;
}

export default function AgentView() {
  useRestoreSessionTabs();
  const { closeTab } = useSessionTabActions();
  const { selectedAgent } = useAgentSettingsStore();
  const { currentThreadId } = useCodexStore(
    useShallow((s) => ({ currentThreadId: s.currentThreadId })),
  );
  const { activeSessionId } = useCCStore();
  const { active: acpActive, connectionId: acpConnectionId } = useAcpStore();
  const {
    cards: sharedCards,
    detachedCard,
    currentAgentCardId,
    currentAgentCardKind,
    cardsViewMode,
  } = useAgentCenterStore();

  // Remote unfollow must not unmount the conversation this device is still reading.
  const cards = detachedCard ? [...sharedCards, detachedCard] : sharedCards;

  // When no active thread/session, center the composer vertically
  const noActiveSession = acpActive
    ? !acpConnectionId
    : selectedAgent === "codex"
      ? !currentThreadId
      : !activeSessionId;

  return (
    <div className="session-agent-view flex flex-col min-h-0 h-full">
      {acpActive && <AgentViewHeader />}
      {!acpActive && cardsViewMode === "solo" ? (
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
          <SessionGroups />
          <div className="shrink-0 flex justify-center border-t">
            <div className="session-composer-width w-full">
              <AgentComposer />
            </div>
          </div>
        </div>
      ) : !acpActive &&
        currentAgentCardId &&
        cards.length > 0 &&
        cardsViewMode !== "solo" ? (
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
          <div className="flex-1 min-h-0 overflow-y-auto p-2">
            {cardsViewMode === "grid" && (
              // flex-wrap (not CSS grid) so each card's manually-resized width/height
              // (see useCardResize) can take effect independently, Ghostty-pane style.
              // Cards without a saved width fall back to flex-basis so they still tile
              // responsively like the old grid.
              <div className="flex flex-wrap gap-2 items-start">
                {cards.map((card) => (
                  <AgentCard
                    key={`${card.kind}-${card.id}`}
                    card={card}
                    isSelected={
                      currentAgentCardId === card.id &&
                      (!currentAgentCardKind ||
                        currentAgentCardKind === card.kind)
                    }
                    onRemove={() => void closeTab(card)}
                  />
                ))}
              </div>
            )}

            {cardsViewMode === "list" && (
              <div className="flex flex-col gap-1">
                {cards.map((card) => (
                  <AgentCard
                    key={`${card.kind}-${card.id}`}
                    card={card}
                    isSelected={
                      currentAgentCardId === card.id &&
                      (!currentAgentCardKind ||
                        currentAgentCardKind === card.kind)
                    }
                    onRemove={() => void closeTab(card)}
                    hideBody={
                      currentAgentCardId !== card.id ||
                      (!!currentAgentCardKind &&
                        currentAgentCardKind !== card.kind)
                    }
                  />
                ))}
              </div>
            )}
          </div>

          <div className="shrink-0 flex justify-center border-t">
            <div className="session-composer-width w-full">
              <AgentComposer />
            </div>
          </div>
        </div>
      ) : noActiveSession ? (
        <div className="flex flex-row flex-1 min-h-0 overflow-hidden">
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden items-center justify-center">
            <div className="session-composer-width flex flex-col gap-4 w-full">
              <AgentComposer />
              <SessionWelcome />
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
          {/* Stable solo tree: adding a task card must not remount the transcript. */}
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <Suspense fallback={null}>
              <AgentSession />
            </Suspense>
          </div>

          <div className="shrink-0 flex justify-center">
            <div className="session-composer-width w-full">
              <AgentComposer />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
