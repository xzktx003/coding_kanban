import { offerUndo } from "./v2/UndoNotice";
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
  Trash2,
} from "lucide-react";
import type {
  FollowupAction,
  FollowupMessage,
} from "@agent-orchestrator/shared";
import { useFollowups } from "@session/hooks/useFollowups";
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

type QueueProps = {
  threadId: string | null;
  turnId: string | null;
  onSideChat?: (message: FollowupMessage) => void;
};
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
  const { state, error } = snapshot;
  const [busy, setBusy] = useState(false),
    [expanded, setExpanded] = useState(false),
    [editing, setEditing] = useState<string | null>(null),
    [text, setText] = useState(""),
    [confirm, setConfirm] = useState<FollowupAction | null>(null);
  const editRef = useRef<HTMLTextAreaElement>(null),
    focusEditAfterClose = useRef(false);
  useEffect(() => {
    if (editing) {
      const frame = requestAnimationFrame(() => editRef.current?.focus());
      return () => cancelAnimationFrame(frame);
    }
  }, [editing]);
  const items = state.items.filter(
    (m) => m.status !== "sent" && m.status !== "cancelled",
  );
  const change = async (action: FollowupAction) => {
    if (!threadId || busy) return;
    setBusy(true);
    try {
      const result = await followupService.change(
        threadId,
        state.revision,
        action,
      );
      if (
        (action.type === "delete" || action.type === "edit") &&
        result.undo &&
        result.undo.token !== state.undo?.token &&
        result.undo.kind === action.type
      ) {
        const token = result.undo.token,
          target = threadId;
        offerUndo(
          action.type === "delete" ? "已删除排队消息" : "已修改排队消息",
          async () => {
            const latest = await followupService.load(target);
            await followupService.change(target, latest.revision, {
              type: "undo",
              token,
            });
          },
        );
      }
      setEditing(null);
      setConfirm(null);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  };
  const remove = (m: FollowupMessage) =>
    m.status === "uncertain"
      ? setConfirm({ type: "delete", id: m.id })
      : void change({ type: "delete", id: m.id });
  const move = (index: number, offset: number) => {
    const ids = items.map((m) => m.id);
    [ids[index], ids[index + offset]] = [ids[index + offset], ids[index]];
    void change({ type: "reorder", ids });
  };
  if (!threadId || (!items.length && !state.paused && !error)) return null;
  const visible = expanded || inlineDetails ? items : items.slice(0, 1);
  const queueList = (
    <ol className="session-queue-list">
      {visible.map((m, index) => (
        <li
          key={m.id}
          data-followup-id={m.id}
          data-status={m.status}
          draggable={!busy && !editing && m.status === "queued"}
          onDragStart={(e) =>
            e.dataTransfer.setData("application/x-followup", m.id)
          }
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const from = e.dataTransfer.getData("application/x-followup"),
              ids = items.map((x) => x.id);
            if (!ids.includes(from) || from === m.id) return;
            ids.splice(ids.indexOf(from), 1);
            ids.splice(ids.indexOf(m.id), 0, from);
            void change({ type: "reorder", ids });
          }}
        >
          <div className="session-queue-row">
            <ListOrdered
              className="session-queue-symbol"
              size={16}
              aria-hidden="true"
            />
            {compactShelf && !expanded && !inlineDetails ? (
              <button
                type="button"
                className="session-followup-text session-queue-preview"
                title={m.text || "图片消息"}
                aria-label={
                  items.length > 1
                    ? `还有 ${items.length - 1} 条待发送`
                    : "查看发送配置与上下文"
                }
                onClick={() => setExpanded(true)}
              >
                {m.text || "图片消息"}
              </button>
            ) : (
              <p className="session-followup-text" title={m.text || "图片消息"}>
                {m.text || "图片消息"}
              </p>
            )}
            {!!m.images.length && (
              <span className="session-queue-attachment-count">
                图片 {m.images.length}
              </span>
            )}
            {m.status === "queued" && turnId && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-label="立即引导"
                disabled={busy}
                onClick={() =>
                  void change({
                    type: "steer",
                    id: m.id,
                    expectedTurnId: turnId,
                  })
                }
              >
                <CornerDownRight size={15} />
                引导
              </Button>
            )}
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="session-queue-delete"
              aria-label="删除排队消息"
              title="删除排队消息"
              disabled={busy || m.status === "sending"}
              onClick={() => remove(m)}
            >
              <Trash2 size={15} />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label={`排队消息 ${index + 1} 的更多操作`}
                  disabled={busy}
                >
                  <MoreHorizontal size={18} />
                </Button>
              </DropdownMenuTrigger>
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
                <DropdownMenuItem
                  disabled={m.status === "sending" || m.status === "uncertain"}
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
                    复制到侧边聊天
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
                      disabled={index === 0}
                      onSelect={() => move(index, -1)}
                    >
                      <ArrowUp />
                      上移消息 {index + 1}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={index === items.length - 1}
                      onSelect={() => move(index, 1)}
                    >
                      <ArrowDown />
                      下移消息 {index + 1}
                    </DropdownMenuItem>
                  </>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() =>
                    void change({ type: state.paused ? "resume" : "pause" })
                  }
                >
                  {state.paused ? <Play /> : <Pause />}
                  {state.paused ? "继续队列" : "暂停队列"}
                </DropdownMenuItem>
                {items.length > 1 && (
                  <DropdownMenuItem
                    onSelect={() => setConfirm({ type: "clear" })}
                  >
                    <Trash2 />
                    清空队列
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
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
                    e.key === "Enter" &&
                    !e.nativeEvent.isComposing
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
          {!!m.images.length && (
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
              {(m.status === "failed" || m.status === "uncertain") && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    m.status === "uncertain"
                      ? setConfirm({
                          type: "retry",
                          id: m.id,
                          confirmUncertain: true,
                        })
                      : void change({ type: "retry", id: m.id })
                  }
                >
                  {m.error?.startsWith("SESSION_OWNED_ELSEWHERE") ? "重新连接并发送" : "重试发送"}
                </Button>
              )}
            </div>
          )}
        </li>
      ))}
    </ol>
  );
  return (
    <section
      className={`session-followup-queue ${inlineDetails ? "session-queue-detail" : "session-queue-shelf"}`}
      aria-label="消息队列"
    >
      {error && (
        <p role="status" className="session-queue-status">
          队列连接暂不可用，正在重试。
          <button
            type="button"
            onClick={() =>
              void followupService
                .load(threadId)
                .catch((e) => toast.error(String(e)))
            }
          >
            重试连接
          </button>
        </p>
      )}
      {state.paused && (
        <div className="session-queue-status" role="status">
          <Pause size={14} />
          <span title={state.paused}>{state.paused}</span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => void change({ type: "resume" })}
          >
            <Play size={14} />
            继续队列
          </Button>
        </div>
      )}
      {(inlineDetails || !expanded) && items.length > 0 && queueList}
      {expanded && !inlineDetails && (
        <ComposerSheet
          title={`待发送消息 · ${items.length}`}
          description="按顺序发送；配置来自入队时的快照。"
          onClose={() => {
            setExpanded(false);
            setEditing(null);
          }}
        >
          <section className="session-followup-queue session-queue-detail">
            {queueList}
            <Button
              type="button"
              disabled={busy}
              onClick={() =>
                void change({ type: state.paused ? "resume" : "pause" })
              }
            >
              {state.paused ? "继续队列" : "暂停队列"}
            </Button>
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
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setConfirm(null);
        }}
      >
        <DialogContent>
          <DialogTitle>
            {confirm?.type === "clear"
              ? "清空待发送队列？"
              : confirm?.type === "retry"
                ? "确认消息未送达？"
                : "移除队列消息记录？"}
          </DialogTitle>
          <DialogDescription>
            {confirm?.type === "clear"
              ? "移除所有尚未发送的消息，当前任务继续运行。"
              : "请先查看对话，确认消息是否已经被接收。重复发送可能再次执行同一任务。"}
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
              disabled={busy}
              onClick={() => confirm && void change(confirm)}
            >
              {confirm?.type === "retry" ? "确认未送达并重试" : "确认移除"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
