import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { MoreHorizontal, Plus, X } from "lucide-react";
import { useCodexStore } from "@session/components/codex/stores";
import { useSessionTabActions } from "@session/hooks/useSessionTabs";
import {
  agentCardKey,
  selectedAgentCard,
  useAgentCenterStore,
  type AgentCenterCard,
} from "@session/stores/useAgentCenterStore";
import { useSessionName } from "@session/stores/useSessionNameStore";
import { NewAgentButton } from "../common/NewAgentButton";
import { RenameSessionButton } from "../common/RenameSessionButton";
import { SessionStatus, UnreadDot } from "../common/SessionStatus";
import {
  splitGroups,
  useSessionSplitStore,
} from "@session/stores/useSessionSplitStore";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { useIsMobile } from "@session/hooks/use-mobile";
import { MobileProjectButton } from "./MobileSessionTools";
import { FollowedSessionsMenu } from "./FollowedSessionsMenu";
export const sessionTabDrag: { key: string | null } = { key: null };

function SessionTab({
  card,
  selected,
  tabbable,
  onSelect,
  onClose,
  onKeyDown,
}: {
  card: AgentCenterCard;
  selected: boolean;
  tabbable: boolean;
  onSelect: () => void;
  onClose: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
}) {
  const renameRef = useRef<HTMLSpanElement>(null);
  const groups = splitGroups(useSessionSplitStore((s) => s.tree));
  const nativeTitle = useCodexStore((s) =>
    card.kind === "codex"
      ? (() => {
          const thread = s.threads.find((t) => t.id === card.id);
          return thread?.name || thread?.preview;
        })()
      : undefined,
  );
  const title = useSessionName(
    card.kind,
    card.id,
    nativeTitle || card.preview || card.id.slice(0, 12),
    nativeTitle || undefined,
  );
  return (
    <>
      <button
        type="button"
        role="tab"
        aria-selected={selected}
        tabIndex={tabbable ? 0 : -1}
        className="session-tab-select"
        data-tab-key={agentCardKey(card)}
        title={`${card.kind === "codex" ? "Codex" : "Claude"} · ${title}\n${card.cwd ?? ""}\n拖动排序；Alt+Shift+左右键移动标签`}
        onClick={onSelect}
        onKeyDown={onKeyDown}
      >
        <span className="session-tab-agent">
          {card.kind === "codex" ? "Codex" : "Claude"}
        </span>
        <span className="session-tab-title">{title}</span>
        <UnreadDot kind={card.kind} id={card.id} />
        <SessionStatus kind={card.kind} id={card.id} compact />
      </button>
      <span className="session-tab-actions" ref={renameRef}>
        <RenameSessionButton kind={card.kind} id={card.id} title={title} />
        <button
          type="button"
          className="session-tab-close"
          title="关闭标签，后台任务继续运行"
          aria-label={`关闭标签：${title}`}
          onClick={onClose}
        >
          <X size={13} />
        </button>
      </span>
      {selected && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="session-tab-mobile-menu"
              aria-label={`标签操作：${title}`}
            >
              <MoreHorizontal size={16} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onSelect={() =>
                renameRef.current
                  ?.querySelector<HTMLButtonElement>("button")
                  ?.click()
              }
            >
              改名
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onClose}>关闭标签</DropdownMenuItem>
            {groups.length > 1 &&
              groups.map(
                (g, i) =>
                  !g.keys.includes(agentCardKey(card)) && (
                    <DropdownMenuItem
                      key={g.id}
                      onSelect={() => {
                        useSessionSplitStore
                          .getState()
                          .place(agentCardKey(card), g.id, "center");
                        onSelect();
                      }}
                    >
                      移动到窗口组 {i + 1}
                    </DropdownMenuItem>
                  ),
              )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </>
  );
}

export function SessionTabs({ groupId }: { groupId?: string } = {}) {
  const mobile = useIsMobile();
  const tabs = useAgentCenterStore();
  const active = selectedAgentCard(tabs);
  const layout = useSessionSplitStore();
  const ownGroup = groupId
    ? splitGroups(layout.tree).find((g) => g.id === groupId)
    : undefined;
  const visibleCards = ownGroup
    ? ownGroup.keys
        .map(
          (key) =>
            tabs.cards.find((c) => agentCardKey(c) === key) ??
            (tabs.detachedCard && agentCardKey(tabs.detachedCard) === key
              ? tabs.detachedCard
              : undefined),
        )
        .filter((c): c is AgentCenterCard => Boolean(c))
    : tabs.cards;
  const activeKey = ownGroup
    ? layout.activeGroupId === groupId && !active
      ? null
      : ownGroup.selected
    : active
      ? agentCardKey(active)
      : null;
  const { selectTab, closeTab } = useSessionTabActions();
  const strip = useRef<HTMLDivElement>(null);
  const dragKey = useRef<string | null>(null);
  const [dropKey, setDropKey] = useState<string | null>(null);
  const focusTab = (key: string | null) =>
    requestAnimationFrame(() => {
      const button = Array.from(
        strip.current?.querySelectorAll<HTMLButtonElement>("[role=tab]") ?? [],
      ).find((el) => el.dataset.tabKey === key);
      if (button) button.focus();
      else if (!key)
        strip.current?.parentElement
          ?.querySelector<HTMLButtonElement>(":scope > button")
          ?.focus();
    });
  useEffect(() => {
    const selected = strip.current?.querySelector<HTMLElement>(
      "[aria-selected=true]",
    )?.parentElement;
    // Scroll only the strip; scrollIntoView would also move the surrounding workspace.
    const container = strip.current;
    if (!selected || !container) return;
    const reveal = () => {
      const bounds = selected.getBoundingClientRect(),
        parent = container.getBoundingClientRect();
      if (bounds.left < parent.left)
        container.scrollLeft -= parent.left - bounds.left;
      else if (bounds.right > parent.right)
        container.scrollLeft += bounds.right - parent.right;
    };
    reveal();
    const observer = new ResizeObserver(reveal);
    observer.observe(container);
    return () => observer.disconnect();
  }, [activeKey, tabs.cards]);

  const close = (card: AgentCenterCard) => {
    void closeTab(card);
    const next = selectedAgentCard(useAgentCenterStore.getState());
    focusTab(next ? agentCardKey(next) : null);
  };
  const keyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    card: AgentCenterCard,
    index: number,
  ) => {
    const direction =
      event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
    if (event.key === "Delete") {
      event.preventDefault();
      event.stopPropagation();
      close(card);
      return;
    }
    if (!direction && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    event.stopPropagation();
    if (event.altKey && event.shiftKey && direction) {
      const target = visibleCards[index + direction];
      if (target) {
        tabs.moveCard(card, target);
        if (groupId)
          layout.place(
            agentCardKey(card),
            groupId,
            "center",
            direction < 0 ? agentCardKey(target) : ownGroup?.keys[index + 2],
          );
      }
      focusTab(agentCardKey(card));
      return;
    }
    const target =
      visibleCards[
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? visibleCards.length - 1
            : (index + direction + visibleCards.length) % visibleCards.length
      ];
    if (target) {
      void selectTab(target);
      focusTab(agentCardKey(target));
    }
  };
  return (
    <div className="session-tabs">
      {mobile && <MobileProjectButton />}
      <div
        className="session-tab-strip"
        role="tablist"
        aria-label="关注会话"
        ref={strip}
        onDragOver={(event) => {
          if (!sessionTabDrag.key) return;
          const bounds = event.currentTarget.getBoundingClientRect();
          if (event.clientX < bounds.left + 28)
            event.currentTarget.scrollLeft -= 18;
          else if (event.clientX > bounds.right - 28)
            event.currentTarget.scrollLeft += 18;
        }}
      >
        {visibleCards.map((card, index) => {
          const key = agentCardKey(card);
          return (
            <div
              key={key}
              className="session-tab"
              data-active={key === activeKey}
              data-drop={key === dropKey}
              draggable
              onDragStart={(event) => {
                dragKey.current = key;
                sessionTabDrag.key = key;
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("application/x-session-tab", key);
              }}
              onDragOver={(event) => {
                if (!sessionTabDrag.key) return;
                event.preventDefault();
                setDropKey(key);
              }}
              onDrop={(event) => {
                event.preventDefault();
                const source = tabs.cards.find(
                  (c) => agentCardKey(c) === sessionTabDrag.key,
                );
                if (source) {
                  tabs.moveCard(source, card);
                  if (groupId) {
                    layout.place(agentCardKey(source), groupId, "center", key);
                    void selectTab(source);
                  }
                }
                dragKey.current = null;
                sessionTabDrag.key = null;
                setDropKey(null);
              }}
              onDragEnd={() => {
                dragKey.current = null;
                sessionTabDrag.key = null;
                setDropKey(null);
              }}
            >
              <SessionTab
                card={card}
                selected={key === activeKey}
                tabbable={key === activeKey || (!activeKey && index === 0)}
                onSelect={() => {
                  if (groupId) layout.focusGroup(groupId);
                  void selectTab(card);
                }}
                onClose={() => close(card)}
                onKeyDown={(event) => keyDown(event, card, index)}
              />
            </div>
          );
        })}
        {!activeKey && <span className="session-tab-draft">新聊天</span>}
        {activeKey &&
          !tabs.cards.some((card) => agentCardKey(card) === activeKey) && (
            <span className="session-tab-draft">当前会话未关注</span>
          )}
      </div>
      <FollowedSessionsMenu />
      <span
        className="session-new-tab"
        onClickCapture={() => {
          if (groupId) layout.focusGroup(groupId);
        }}
      >
        <NewAgentButton icon={Plus} />
      </span>
    </div>
  );
}
