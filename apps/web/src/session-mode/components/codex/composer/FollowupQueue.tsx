import {
  QueueReorderList,
  QueueSortableItem,
  QueueDragHandle,
} from "./QueueReorder";
import { offerUndo } from "./v2/UndoNotice";
import { useComposerRailPresent } from "./ComposerRail";
import { ComposerRailIcon } from "./ComposerRailIcon";
import { queuePreviewText } from "./queuePreviewText";
import { QueueMessagePreview } from "./QueueMessagePreview";
import { useIsMobile } from "@session/hooks/use-mobile";
import { ComposerSheet } from "./v2/ComposerSheet";
import { FollowupSnapshot } from "./v2/FollowupSnapshot";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  CornerDownRight,
  ListOrdered,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Plus,
  TriangleAlert,
  Trash2,
} from "lucide-react";
import type {
  FollowupAction,
  FollowupMessage,
} from "@agent-orchestrator/shared";
import { useFollowups } from "@session/hooks/useFollowups";
import { useFollowupSettingsStore } from "@session/stores/useFollowupSettingsStore";
import { followupService } from "@session/services/followupService";
import { Button } from "../../ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "../../ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "../../ui/dialog";
import { fileSrc } from "@session/hooks/runtime";
import { shouldSubmitOnEnter } from "./imeSubmitKey";
import {
  codexSendBlockReason,
  refreshCodexAccess,
  useCodexAccessStore,
} from "@session/stores/useCodexAccessStore";

function unresolvedReason(items: FollowupMessage[]) {
  if (items.some((m) => m.status === "uncertain"))
    return "请先核对消息是否送达，再确认重试或移除记录。";
  if (items.some((m) => m.status === "failed"))
    return "请先重试或移除失败消息，再继续队列。";
}

function queueAccessReason(
  entry:
    | ReturnType<typeof useCodexAccessStore.getState>["entries"][string]
    | undefined,
) {
  if (!codexSendBlockReason(entry)) return undefined;
  switch (entry?.access?.state) {
    case "external":
      return "会话被其他客户端占用，消息已保留；释放后可重试原消息。";
    case "releasing":
      return "会话正在释放，消息已保留；释放完成后可重试。";
    case "acquiring":
      return "正在恢复会话，消息已保留；请稍后重试。";
    default:
      return "执行占用状态尚未确认，消息已保留；请先重新核对。";
  }
}

type QueueProps = {
  threadId: string | null;
  turnId: string | null;
  onSideChat?: (message: FollowupMessage) => void;
};
import { hasVisibleFollowupQueue } from "./followupQueueState";
import {
  captureCodexOperationScope,
  isCodexOperationScopeCurrent,
} from "@session/services/codexOperationScope";
import { useCodexStore } from "../stores/useCodexStore";
import { useAgentSettingsStore } from "@session/stores/useAgentSettingsStore";
import { useAcpStore } from "@session/stores/useAcpStore";
export { hasVisibleFollowupQueue } from "./followupQueueState";
export function FollowupQueue(props: QueueProps) {
  const snapshot = useFollowups(props.threadId);
  return <FollowupQueueContent {...props} snapshot={snapshot} />;
}
export function FollowupQueueContent({
  threadId,
  turnId,
  onSideChat,
  snapshot,
  inlineDetails = false,
  compactShelf = false,
}: QueueProps & {
  snapshot: ReturnType<typeof useFollowups>;
  inlineDetails?: boolean;
  compactShelf?: boolean;
}) {
  const railPresent = useComposerRailPresent();
  const mobile = useIsMobile();
  const { state } = snapshot;
  const nativeAuthority = state.authority === "native";
  const access = useCodexAccessStore((s) =>
    threadId ? s.entries[threadId] : undefined,
  );
  const accessBlock = queueAccessReason(access);
  // Official rows end their menu with a queueing toggle, so the default
  // follow-up behaviour is reachable from the queue itself, not only settings.
  const queueingOn = useFollowupSettingsStore((s) => s.mode) === "queue";
  const setFollowupMode = useFollowupSettingsStore((s) => s.setMode);
  const unresolved = unresolvedReason(state.items);
  const resumeBlock = unresolved || accessBlock;
  const [busy, setBusy] = useState(false),
    [expanded, setExpanded] = useState(false),
    [editing, setEditing] = useState<string | null>(null),
    [text, setText] = useState(""),
    [confirm, setConfirm] = useState<FollowupAction | null>(null);
  const editRef = useRef<HTMLTextAreaElement>(null),
    focusEditAfterClose = useRef(false),
    changing = useRef(false);
  useEffect(() => {
    if (editing) {
      const frame = requestAnimationFrame(() => editRef.current?.focus());
      return () => cancelAnimationFrame(frame);
    }
  }, [editing]);
  useEffect(() => {
    setConfirm(null);
    setEditing(null);
    setExpanded(false);
  }, [threadId]);
  const items = state.items.filter(
    (m) => m.status !== "sent" && m.status !== "cancelled",
  );
  const needsMigration =
    nativeAuthority &&
    items.some((item) => item.authority === "legacy") &&
    !items.some((item) => !!item.nativeQueuedSubmissionId);

  const change = async (action: FollowupAction) => {
    if (!threadId || changing.current || !railPresent) return;
    const sends = ["resume", "retry", "steer", "migrate", "undo"].includes(
      action.type,
    );
    if (sends && accessBlock) return;
    if (action.type === "resume" && unresolved) return;
    changing.current = true;
    setBusy(true);
    try {
      let revision = state.revision;
      if (action.type === "resume") {
        const latest = await followupService.load(threadId);
        if (unresolvedReason(latest.items)) return;
        revision = latest.revision;
      }
      // Read metadata immediately before an action that can dispatch work. A
      // release only enables the user's retry; it never resends automatically.
      if (sends && queueAccessReason(await refreshCodexAccess(threadId)))
        return;
      const result = await followupService.change(threadId, revision, action);
      if (
        (action.type === "delete" || action.type === "edit") &&
        result.undo &&
        result.undo.token !== state.undo?.token &&
        result.undo.kind === action.type
      ) {
        const token = result.undo.token,
          target = threadId,
          scope = captureCodexOperationScope(),
          nativeDeletion = nativeAuthority && result.undo.kind === "delete";
        offerUndo(
          action.type === "delete" ? "已删除排队消息" : "已修改排队消息",
          async () => {
            const current = () =>
              isCodexOperationScopeCurrent(scope) &&
              useCodexStore.getState().currentThreadId === target &&
              useAgentSettingsStore.getState().selectedAgent === "codex" &&
              !useAcpStore.getState().active;
            if (nativeDeletion && !current())
              throw new Error(
                "请先打开原会话，并重新核对账号或运行服务后再恢复保存的消息",
              );
            const latest = await followupService.load(target);
            if (nativeDeletion) {
              const access = await refreshCodexAccess(target),
                reason = queueAccessReason(access);
              if (reason) throw new Error(reason);
              if (!current())
                throw new Error("原会话或账号范围已变化，保存的消息尚未恢复");
            }
            await followupService.change(target, latest.revision, {
              type: "undo",
              token,
              ...(nativeDeletion ? { confirmExecution: true } : {}),
            });
          },
          nativeDeletion
            ? {
                title: "恢复保存的排队消息？",
                description:
                  "使用原会话当前线程设置，将保存内容加入官方队列末尾；空闲时会立即执行。必要时会恢复原生会话，已有待发内容也可能开始执行。结果未知时不会自动补偿或重发。",
                actionLabel: "确认加入队列并执行",
              }
            : undefined,
        );
      }
      setEditing(null);
      setConfirm(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      changing.current = false;
      setBusy(false);
    }
  };
  const remove = (m: FollowupMessage) =>
    m.status === "uncertain"
      ? setConfirm({ type: "delete", id: m.id })
      : void change({ type: "delete", id: m.id });
  const canReorder =
    !busy &&
    !editing &&
    railPresent &&
    !snapshot.error &&
    items.length > 1 &&
    items.every(
      (message) =>
        message.status === "queued" &&
        (!nativeAuthority || !!message.nativeQueuedSubmissionId),
    );
  const queueStatus = state.paused ? (
    <div className="session-queue-status" role="status">
      <Pause size={14} />
      <span className="session-queue-pause-reason">
        <span>
          {state.paused === "interrupted" ||
          state.paused === "由于你中断了当前响应，队列已暂停"
            ? "当前响应已中断，队列已暂停"
            : state.paused}
        </span>
        {(accessBlock || unresolved) && (
          <small>{accessBlock || unresolved}</small>
        )}
      </span>
      {unresolved ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setExpanded(true)}
        >
          {state.items.some((m) => m.status === "uncertain")
            ? "核对送达状态"
            : "处理失败消息"}
        </Button>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={busy || !!resumeBlock}
          title={resumeBlock}
          onClick={() =>
            needsMigration ? setExpanded(true) : void change({ type: "resume" })
          }
        >
          <Play size={14} />
          {needsMigration
            ? "处理旧队列"
            : nativeAuthority && access?.access?.loaded === false
              ? "恢复并继续"
              : "继续"}
        </Button>
      )}
    </div>
  ) : null;
  const move = (index: number, offset: number) => {
    if (!canReorder || index + offset < 0 || index + offset >= items.length)
      return;
    const ids = items.map((m) => m.id);
    [ids[index], ids[index + offset]] = [ids[index + offset], ids[index]];
    void change({ type: "reorder", ids });
  };
  if (!threadId || !hasVisibleFollowupQueue(threadId, snapshot)) return null;
  const visible =
    expanded || inlineDetails || (compactShelf && !mobile)
      ? items
      : items.slice(0, 1);
  const queueList = (
    <QueueReorderList
      identity={JSON.stringify([threadId, state.revision])}
      ids={visible.map((message) => message.id)}
      enabled={canReorder && visible.length > 1}
      onReorder={(ids) => void change({ type: "reorder", ids })}
      header={queueStatus}
    >
      {visible.map((m, index) => (
        <QueueSortableItem key={m.id} id={m.id} status={m.status}>
          <div className="session-queue-row">
            <div className="session-queue-main">
              <QueueDragHandle position={index + 1}>
                {compactShelf ? (
                  <ComposerRailIcon
                    name="queue"
                    className="session-queue-symbol"
                  />
                ) : (
                  <ListOrdered
                    className="session-queue-symbol"
                    size={16}
                    aria-hidden="true"
                  />
                )}
              </QueueDragHandle>
              {(m.status === "failed" || m.status === "uncertain") && (
                <button
                  type="button"
                  className="session-queue-warning"
                  aria-label={
                    m.status === "uncertain"
                      ? "无法确认消息是否已送达。请先查看对话，再删除这条已保存的消息。"
                      : "这条排队中的消息未能发送"
                  }
                  aria-description={
                    m.status === "uncertain"
                      ? undefined
                      : "重试、编辑或删除该消息以继续发送排队的消息"
                  }
                  title={
                    m.status === "uncertain"
                      ? "无法确认消息是否已送达。请先查看对话，再删除这条已保存的消息。"
                      : "这条排队中的消息未能发送\n重试、编辑或删除该消息以继续发送排队的消息"
                  }
                  onClick={() => setExpanded(true)}
                >
                  <TriangleAlert
                    data-queue-warning-icon=""
                    size={12}
                    aria-hidden="true"
                  />
                </button>
              )}
              {compactShelf && !mobile && !expanded && !inlineDetails ? (
                <QueueMessagePreview
                  text={m.text}
                  imagePath={m.images[0]}
                  summary={queuePreviewText(m)}
                  position={index + 1}
                  threadId={threadId}
                  disabled={!!editing}
                />
              ) : compactShelf && !expanded && !inlineDetails ? (
                <button
                  type="button"
                  className="session-followup-text session-queue-preview"
                  title={queuePreviewText(m)}
                  aria-label={
                    items.length > 1 && mobile
                      ? `还有 ${items.length - 1} 条待发送`
                      : items.length > 1
                        ? `查看排队消息 ${index + 1} 的发送配置与上下文`
                        : "查看发送配置与上下文"
                  }
                  onClick={() => setExpanded(true)}
                >
                  {queuePreviewText(m)}
                </button>
              ) : (
                <p
                  className="session-followup-text"
                  title={queuePreviewText(m)}
                >
                  {queuePreviewText(m)}
                </p>
              )}
              {!!m.images.length &&
                !(compactShelf && !mobile && !expanded && !inlineDetails) && (
                  <span className="session-queue-attachment-count">
                    图片 {m.images.length}
                  </span>
                )}
            </div>
            <div className="session-queue-actions">
              {m.status === "queued" &&
                turnId &&
                (!nativeAuthority || !!m.nativeQueuedSubmissionId) && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-label="立即引导"
                    aria-description="提交，但不中断模型运行"
                    title="提交，但不中断模型运行"
                    disabled={busy || !!accessBlock}
                    onClick={() =>
                      nativeAuthority
                        ? setConfirm({
                            type: "steer",
                            id: m.id,
                            expectedTurnId: turnId,
                          })
                        : void change({
                            type: "steer",
                            id: m.id,
                            expectedTurnId: turnId,
                          })
                    }
                  >
                    {compactShelf ? (
                      <ComposerRailIcon name="steer" />
                    ) : (
                      <CornerDownRight size={15} />
                    )}
                    引导
                  </Button>
                )}
              {m.authority === "legacy" &&
                ["queued", "failed"].includes(m.status) &&
                !m.turnId && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={busy || !!accessBlock}
                    onClick={() =>
                      setConfirm({
                        type: "migrate",
                        id: m.id,
                        confirmThreadSettings: true,
                      })
                    }
                  >
                    迁入官方队列
                  </Button>
                )}
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="session-queue-delete"
                aria-label="删除排队的消息"
                title="删除排队的消息"
                disabled={busy || m.status === "sending"}
                onClick={() => remove(m)}
              >
                {compactShelf ? (
                  <ComposerRailIcon name="delete" />
                ) : (
                  <Trash2 size={15} />
                )}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={`排队消息操作 ${index + 1}`}
                    disabled={busy}
                  >
                    {compactShelf ? (
                      <ComposerRailIcon name="more" />
                    ) : (
                      <MoreHorizontal size={18} />
                    )}
                  </Button>
                </DropdownMenuTrigger>
                {railPresent && (
                  <DropdownMenuContent
                    className="session-composer-menu session-queue-menu"
                    align="end"
                    side="top"
                    collisionPadding={12}
                    onCloseAutoFocus={(e) => {
                      if (focusEditAfterClose.current) {
                        e.preventDefault();
                        focusEditAfterClose.current = false;
                        requestAnimationFrame(() => editRef.current?.focus());
                      }
                    }}
                  >
                    {(!nativeAuthority ||
                      (m.authority === "native" &&
                        !m.id.startsWith("review_") &&
                        (m.id.startsWith("action_") || !m.receiptOnly))) &&
                      (m.status === "failed" || m.status === "uncertain") && (
                        <DropdownMenuItem
                          disabled={busy || !!accessBlock}
                          aria-label="尝试重新发送这条排队中的消息。如果重试一直失败，可编辑或删除它"
                          title="尝试重新发送这条排队中的消息。如果重试一直失败，可编辑或删除它"
                          onSelect={() =>
                            nativeAuthority || m.status === "uncertain"
                              ? setConfirm({
                                  type: "retry",
                                  id: m.id,
                                  confirmUncertain: true,
                                })
                              : void change({ type: "retry", id: m.id })
                          }
                        >
                          重试
                        </DropdownMenuItem>
                      )}
                    <DropdownMenuItem
                      disabled={
                        m.status === "sending" ||
                        m.status === "uncertain" ||
                        (nativeAuthority && !m.nativeQueuedSubmissionId)
                      }
                      onSelect={() => {
                        focusEditAfterClose.current = true;
                        setEditing(m.id);
                        setText(m.text);
                      }}
                    >
                      <Pencil />
                      编辑消息
                    </DropdownMenuItem>
                    {!inlineDetails && (
                      <DropdownMenuItem onSelect={() => setExpanded(true)}>
                        查看发送配置与上下文
                      </DropdownMenuItem>
                    )}
                    {onSideChat && (
                      <DropdownMenuItem onSelect={() => onSideChat(m)}>
                        <Plus />
                        在侧边聊天中打开
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem
                      disabled={m.status === "sending"}
                      onSelect={() => remove(m)}
                    >
                      <Trash2 />
                      删除消息
                    </DropdownMenuItem>
                    {items.length > 1 && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          disabled={!canReorder || index === 0}
                          onSelect={() => move(index, -1)}
                        >
                          <ArrowUp />
                          上移消息 {index + 1}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={!canReorder || index === items.length - 1}
                          onSelect={() => move(index, 1)}
                        >
                          <ArrowDown />
                          下移消息 {index + 1}
                        </DropdownMenuItem>
                      </>
                    )}
                    {state.paused && (
                      <DropdownMenuItem
                        disabled={busy || !!resumeBlock}
                        title={resumeBlock}
                        onSelect={() =>
                          needsMigration
                            ? setExpanded(true)
                            : void change({ type: "resume" })
                        }
                      >
                        <Play />
                        {needsMigration
                          ? "处理旧队列"
                          : nativeAuthority && access?.access?.loaded === false
                            ? "恢复并继续"
                            : "继续"}
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="session-queue-mode-toggle"
                      onSelect={() =>
                        setFollowupMode(queueingOn ? "steer" : "queue")
                      }
                    >
                      <ListOrdered />
                      {queueingOn ? "关闭排队" : "启用队列模式"}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                )}
              </DropdownMenu>
            </div>
          </div>
          {(expanded || inlineDetails) && <FollowupSnapshot message={m} />}
          {editing === m.id && (
            <div className="session-queue-edit">
              <textarea
                ref={editRef}
                aria-label="编辑排队消息"
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.stopPropagation();
                    setEditing(null);
                  }
                  if (
                    (e.ctrlKey || e.metaKey) &&
                    shouldSubmitOnEnter({
                      key: e.key,
                      isComposing: e.nativeEvent.isComposing,
                      keyCode: e.keyCode,
                    })
                  ) {
                    e.preventDefault();
                    void change({ type: "edit", id: m.id, text });
                  }
                }}
              />
              <div>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setEditing(null)}
                >
                  取消编辑
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={
                    busy ||
                    (!text.trim() && !m.images.length && !m.contexts?.length)
                  }
                  onClick={() => void change({ type: "edit", id: m.id, text })}
                >
                  保存消息
                </Button>
              </div>
            </div>
          )}
          {!!m.images.length &&
            (!compactShelf || expanded || inlineDetails) && (
              <div className="session-followup-images">
                {m.images.map((path, i) => (
                  <a
                    key={path + i}
                    href={fileSrc(path)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <img src={fileSrc(path)} alt={`排队附件 ${i + 1}`} />
                  </a>
                ))}
              </div>
            )}
          {m.status !== "queued" && (
            <div className="session-queue-status" role="status">
              <span>
                {m.status === "sending"
                  ? "正在发送"
                  : m.status === "uncertain"
                    ? "送达待确认"
                    : "发送失败"}
                {m.error && `：${m.error}`}
              </span>
              {(!nativeAuthority ||
                (m.authority === "native" &&
                  !m.id.startsWith("review_") &&
                  (m.id.startsWith("action_") || !m.receiptOnly))) &&
                (m.status === "failed" || m.status === "uncertain") && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={busy || !!accessBlock}
                    aria-description="尝试重新发送这条排队中的消息。如果重试一直失败，可编辑或删除它"
                    title={
                      accessBlock ||
                      "尝试重新发送这条排队中的消息。如果重试一直失败，可编辑或删除它"
                    }
                    onClick={() =>
                      nativeAuthority || m.status === "uncertain"
                        ? setConfirm({
                            type: "retry",
                            id: m.id,
                            confirmUncertain: true,
                          })
                        : void change({ type: "retry", id: m.id })
                    }
                  >
                    重试
                  </Button>
                )}
            </div>
          )}
        </QueueSortableItem>
      ))}
    </QueueReorderList>
  );
  return (
    <section
      className={`session-followup-queue ${inlineDetails ? "session-queue-detail" : "session-queue-shelf"}`}
      aria-label="消息队列"
    >
      {(inlineDetails || !expanded) &&
        (items.length > 0 || state.paused) &&
        queueList}
      {railPresent && expanded && !inlineDetails && (
        <ComposerSheet
          title={`待发送消息 · ${items.length}`}
          description={
            nativeAuthority
              ? "官方队列按线程设置执行；旧队列保留原快照并等待明确迁移。"
              : "按顺序发送；配置来自入队时的快照。"
          }
          onClose={() => {
            setExpanded(false);
            setEditing(null);
          }}
        >
          <section className="session-followup-queue session-queue-detail">
            {(accessBlock || unresolved) && (
              <p className="session-queue-status" role="status">
                {accessBlock || unresolved}
              </p>
            )}
            {queueList}
          </section>
        </ComposerSheet>
      )}
      {!compactShelf && !inlineDetails && items.length === 1 && (
        <button
          type="button"
          className="session-queue-expand"
          onClick={() => setExpanded(true)}
        >
          查看发送配置与上下文 <ChevronDown size={14} />
        </button>
      )}
      {!compactShelf && !inlineDetails && items.length > 1 && (
        <button
          type="button"
          className="session-queue-expand"
          aria-expanded={expanded}
          onClick={() => {
            setExpanded(!expanded);
            setEditing(null);
          }}
        >
          {expanded
            ? `收起队列 · 共 ${items.length} 条`
            : `还有 ${items.length - 1} 条待发送`}
          <ChevronDown size={14} />
        </button>
      )}
      <Dialog
        open={railPresent && confirm !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setConfirm(null);
        }}
      >
        <DialogContent>
          <DialogTitle>
            {confirm?.type === "undo"
              ? "恢复保存的排队消息？"
              : confirm?.type === "steer"
                ? "将排队消息用于当前轮次？"
                : confirm?.type === "retry" && nativeAuthority
                  ? "恢复保存的消息？"
                  : confirm?.type === "migrate"
                    ? "迁入官方共享队列？"
                    : confirm?.type === "clear"
                      ? "清空待发送队列？"
                      : confirm?.type === "retry"
                        ? "确认消息未送达？"
                        : "移除队列消息记录？"}
          </DialogTitle>
          <DialogDescription>
            {confirm?.type === "undo" ||
            (confirm?.type === "retry" && nativeAuthority)
              ? "使用当前线程设置，将保存内容加入官方队列末尾；空闲时会立即执行。必要时会恢复原生会话，已有待发内容也可能开始执行。请先检查对话与队列，确认原操作不会造成重复执行。结果未知时不会自动补偿或重发。"
              : confirm?.type === "steer"
                ? "先将这条消息移出官方队列，再引导上述当前轮次。其他客户端仍可能改变队列；任一步失败或结果未知都会停止并保留原内容，不会自动补偿或重发。"
                : confirm?.type === "migrate"
                  ? "这会将旧消息的模型与权限应用到当前线程，影响尚未开始的官方排队消息；内容随即可能开始执行。原消息与配置记录仍保留，未知回执不会重发。"
                  : confirm?.type === "clear"
                    ? "移除所有尚未发送的消息，当前任务继续运行。"
                    : "请先查看对话，确认消息是否已经被接收。重复发送可能再次执行同一任务。"}
            {confirm?.type === "retry" && accessBlock && (
              <span className="session-queue-confirm-reason">
                {accessBlock}
              </span>
            )}
          </DialogDescription>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => setConfirm(null)}
            >
              取消
            </Button>
            <Button
              type="button"
              disabled={busy || (confirm?.type === "retry" && !!accessBlock)}
              onClick={() => confirm && void change(confirm)}
            >
              {confirm?.type === "undo" ||
              (confirm?.type === "retry" && nativeAuthority)
                ? "确认加入队列并执行"
                : confirm?.type === "steer"
                  ? "确认引导当前轮次"
                  : confirm?.type === "migrate"
                    ? "确认设置并迁入"
                    : confirm?.type === "retry"
                      ? "确认未送达并重试"
                      : "确认移除"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
