import { useLayoutEffect, type RefObject } from "react";
import { SessionAgentBadge } from "../common/SessionAgentBadge";
import { SessionStatusIndicator } from "../common/SessionStatusIndicator";
import { useSessionProject } from "./SessionIdentity";
import { Check, ChevronDown, Folder, Loader2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { useCodexStore } from "../codex/stores";
import { useSessionName } from "../../stores/useSessionNameStore";
import {
  agentCardKey,
  useAgentCenterStore,
} from "../../stores/useAgentCenterStore";
import {
  splitGroups,
  useSessionSplitStore,
} from "../../stores/useSessionSplitStore";
import { useLayoutStore } from "../../stores/useLayoutStore";
import { useSessionTabActions } from "../../hooks/useSessionTabs";
import {
  SESSION_STATE_LABELS,
  useFollowedSessionStates,
  type FollowedSessionRow,
  type SessionConnectionState,
} from "../../hooks/useFollowedSessionStates";

function SessionMenuRow({
  row,
  groupNumber,
  disabled = false,
  selectTab,
}: {
  row: FollowedSessionRow;
  groupNumber?: number;
  disabled?: boolean;
  selectTab: ReturnType<typeof useSessionTabActions>["selectTab"];
}) {
  const { card, state } = row;
  const native = useCodexStore((s) =>
    card.kind === "codex"
      ? s.threads.find((t) => t.id === card.id)?.name
      : undefined,
  );
  const title = useSessionName(
    card.kind,
    card.id,
    native || card.preview || card.id.slice(0, 12),
  );
  const project = useSessionProject(card);
  const selected = useAgentCenterStore(
    (s) =>
      s.currentAgentCardId === card.id && s.currentAgentCardKind === card.kind,
  );
  return (
    <DropdownMenuItem
      className="session-followed-row"
      disabled={disabled}
      data-state={state}
      data-session-key={agentCardKey(card)}
      data-selected={selected}
      aria-current={selected ? "page" : undefined}
      textValue={title}
      onSelect={() => {
        useLayoutStore.getState().setView("agent");
        void selectTab(card).then(() => {
          if (state === "pending" || row.questions)
            window.dispatchEvent(
              new CustomEvent("session-locate-request", {
                detail: { kind: card.kind, id: card.id },
              }),
            );
        });
      }}
    >
      <span className="session-followed-agent">
        <SessionAgentBadge kind={card.kind} />
      </span>
      <span className="session-followed-content">
        <span className="session-followed-main">
          <span className="session-followed-title" title={title}>
            {title}
          </span>
          <span className="session-followed-status" data-state={state}>
            <SessionStatusIndicator state={state} compact showInactive />
            <span>{SESSION_STATE_LABELS[state]}</span>
          </span>
        </span>
        <span className="session-followed-meta">
          <span
            className="session-followed-path"
            title={project.path || "这条会话尚无项目目录"}
          >
            <Folder size={12} aria-hidden="true" />
            <span>{project.label}</span>
          </span>
          {groupNumber ? (
            <span className="session-followed-group">窗口组 {groupNumber}</span>
          ) : null}
          {selected && (
            <Check
              className="session-followed-selected"
              size={13}
              aria-label="当前会话"
            />
          )}
        </span>
        {row.questions ? (
          <span className="session-followed-question">
            {row.questions} 个问题待答
          </span>
        ) : null}
      </span>
    </DropdownMenuItem>
  );
}
export function FollowedSessionsMenuBody({
  status = "ready",
  summary = false,
  menuRef,
  focusFirst = false,
}: {
  status?: SessionConnectionState;
  summary?: boolean;
  menuRef: RefObject<HTMLDivElement | null>;
  focusFirst?: boolean;
}) {
  const { rows, counts, complete, questionCount } =
    useFollowedSessionStates(status);
  const { selectTab } = useSessionTabActions();
  useLayoutEffect(() => {
    if (!focusFirst) return;
    const frame = requestAnimationFrame(() => {
      const menu = menuRef.current;
      if (!menu?.isConnected) return;
      const active = menu.ownerDocument.activeElement;
      if (active !== menu && !menu.contains(active)) return;
      menu
        .querySelector<HTMLElement>('[role="menuitem"]:not([data-disabled])')
        ?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [focusFirst, menuRef]);
  const tree = useSessionSplitStore((s) => s.tree);
  const groups = splitGroups(tree);
  const syncError = useAgentCenterStore((s) => s.tabSyncError);
  const ordered = summary
    ? [...rows].sort(
        (a, b) =>
          [
            "pending",
            "running",
            "failed",
            "unread",
            "unknown",
            "idle",
            "completed",
          ].indexOf(a.state) -
          [
            "pending",
            "running",
            "failed",
            "unread",
            "unknown",
            "idle",
            "completed",
          ].indexOf(b.state),
      )
    : rows;
  return (
    <>
      <div className="session-followed-header">
        <DropdownMenuLabel className="session-followed-heading">
          {summary ? "关注会话状态" : "全部关注会话"}
          <span className="session-followed-count">{rows.length}</span>
        </DropdownMenuLabel>
        <p className="session-menu-note">
          {questionCount > 0 && <>问题待答 {questionCount} · </>}
          仅统计关注会话 · 运行中 {status === "ready"
            ? counts.running
            : "未知"}{" "}
          · 待确认{" "}
          {status === "ready" && (complete || counts.pending)
            ? counts.pending
            : "未知"}
        </p>
        {(!complete || syncError) && (
          <p className="session-menu-note" role="status">
            {status !== "ready"
              ? "连接恢复后更新状态"
              : syncError
                ? "关注列表同步待重试"
                : "部分状态尚未同步"}
          </p>
        )}
      </div>
      <DropdownMenuGroup
        className="session-followed-list"
        aria-label="关注会话列表"
      >
        {ordered.length ? (
          ordered.map((row) => (
            <SessionMenuRow
              key={agentCardKey(row.card)}
              row={row}
              selectTab={selectTab}
              disabled={status !== "ready"}
              groupNumber={
                groups.length > 1
                  ? groups.findIndex((g) =>
                      g.keys.includes(agentCardKey(row.card)),
                    ) + 1
                  : undefined
              }
            />
          ))
        ) : (
          <p className="session-menu-note">
            还没有关注会话；打开会话后会加入标签。
          </p>
        )}
      </DropdownMenuGroup>
      {!summary && groups.length > 1 && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>切换窗口组</DropdownMenuLabel>
          {groups.map((g, i) => {
            const row = rows.find((r) => agentCardKey(r.card) === g.selected);
            return (
              <DropdownMenuItem
                key={g.id}
                disabled={status !== "ready"}
                onSelect={() => {
                  useSessionSplitStore.getState().focusGroup(g.id);
                  if (row) {
                    useLayoutStore.getState().setView("agent");
                    void selectTab(row.card);
                  }
                }}
              >
                窗口组 {i + 1} · {g.keys.length} 个会话
              </DropdownMenuItem>
            );
          })}
        </>
      )}
    </>
  );
}
