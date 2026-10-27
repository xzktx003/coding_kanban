import { newSessionEditId } from "@session/services/sessionEditIdentity";
import { composeContextText } from "@agent-orchestrator/shared";
import {
  composerDrafts,
  useComposerDraft,
  useComposerDraftStatus,
} from "./v2/drafts";
import { ContextAttachments } from "./v2/ContextAttachments";
import { DrawingEditor } from "./v2/DrawingEditor";
import { isLargePaste, insertAtSelection } from "./v2/content";
import { ArrowUp, Square, ListPlus, CornerDownRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { deleteThread } from "@session/services/apiAdapt/codex";
import { useAgentCenterStore } from "@session/stores/useAgentCenterStore";
import { useSideChatStore } from "@session/stores/useSideChatStore";
import {
  sessionDraftKey,
  readDraft,
  useSessionDraftStore,
  useSessionTextDraft,
} from "@session/stores/useSessionDraftStore";
import { useFollowupSettingsStore } from "@session/stores/useFollowupSettingsStore";
import { followupService } from "@session/services/followupService";
import { useCodexSendBlockReason } from "@session/hooks/useCodexSendBlockReason";
import { useCodexThreadInput } from "@session/hooks/useCodexThreadInput";
import { useCodexStore } from "../stores";
import { codexService } from "@session/services/codexService";
import { CodexThread } from "../thread/CodexThread";
import { useImageAttachments } from "../../common/useImageAttachments";
import { Button } from "../../ui/button";
import { FollowupQueueContent } from "./FollowupQueue";
import { submitIntent } from "./editor/submitIntent";
import { useStopAction } from "../../common/useStopAction";
import { useTurnControl } from "../hooks/useTurnControl";
import { ModelChangeNotice } from "./ModelChangeNotice";
import { ComposerSheet } from "./v2/ComposerSheet";
import { useFollowups } from "@session/hooks/useFollowups";
import { useThreadModelSettings } from "@session/hooks/useThreadModelSettings";
import { ModelReasonSelector } from "./ModelReasonSelector";
import { AccessModePopover } from "./AccessModePopover";
import { PlanSidePanel } from "@session/features/thread-workflows/PlanSidePanel";
function SideChat({
  id,
  title,
  images,
}: {
  id: string;
  title: string;
  images: string[];
}) {
  const owner = sessionDraftKey("codex", id),
    { inputValue, setInputValue } = useSessionTextDraft(owner, "codex"),
    draft = useImageAttachments(owner),
    initialized = useRef(false);
  const contextDraft = useComposerDraft(owner);
  const contextStatus = useComposerDraftStatus(owner);
  const storageError = contextStatus.error;
  const contextBusy = contextStatus.phase === "hydrating" || contextStatus.phase === "saving";
  const queueSnapshot = useFollowups(id);
  const model = useThreadModelSettings(id);
  const queued = queueSnapshot.state.items.filter(
    (m) => m.status !== "sent" && m.status !== "cancelled",
  );
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [drawingId, setDrawingId] = useState<string | null>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const focusTrigger = useSideChatStore((s) => s.focusTrigger);
  const hasContent = !!(
    inputValue.trim() ||
    draft.paths.length ||
    contextDraft.contexts.length
  );
  const [confirming, setConfirming] = useState(false);
  const [skipNext, setSkipNext] = useState(false);
  const [sending, setSending] = useState(false),
    busy = useRef(false),
    settings = useFollowupSettingsStore();
  const { running, turnId } = useTurnControl(id);
  const threadInput = useCodexThreadInput(id);
  const accessBlock = useCodexSendBlockReason(
    id,
    queueSnapshot.state.items.some((item) => item.status === "uncertain"),
  );
  useEffect(() => {
    if (!focusTrigger) return;
    editorRef.current?.focus();
  }, [focusTrigger]);
  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      if (images.length) void draft.addPaths(images);
    }
    if (!useCodexStore.getState().events[id])
      void codexService
        .loadThreadHistory(id)
        .catch((e) => toast.error(String(e)));
  }, [id]);
  const { stopping, requestStop } = useStopAction(
    id + ":" + (turnId ?? "active"),
    running,
    async () => {
      if (!turnId) throw new Error("正在同步当前任务");
      await followupService.stop(id, turnId);
    },
  );
  const send = async (opposite = false) => {
    if (
      busy.current ||
      accessBlock ||
      threadInput.blocked ||
      draft.blocked ||
      !!storageError ||
      contextBusy ||
      !hasContent
    )
      return;
    const capturedContexts = composerDrafts.capture(owner);
    const contexts = capturedContexts.contexts;
    if (composeContextText(inputValue, contexts).length > 200_000) {
      toast.error("正文与上下文合计不能超过 200,000 字符");
      return;
    }
    const snapshot = readDraft(owner),
      ids = draft.attachments.map((a) => a.id);
    busy.current = true;
    setSending(true);
    try {
      await composerDrafts.flush(owner);
      const currentDraft = readDraft(owner);
      if (currentDraft.revision !== snapshot.revision || currentDraft.writeId !== snapshot.writeId || currentDraft.text !== snapshot.text || !composerDrafts.matches(owner,capturedContexts))
        throw new Error("草稿在保存期间已变化，请核对后再发送");
      const mode = running
        ? opposite
          ? settings.mode === "queue"
            ? "steer"
            : "queue"
          : settings.mode
        : "queue";
      if (mode === "steer" && !turnId) throw new Error("正在同步当前任务");
      await followupService.submit(
        owner,
        {
          revision: snapshot.revision,
          writeId: snapshot.writeId,
          attachmentIds: ids,
          contextIds: contexts.map((context) => context.id),
        },
        id,
        inputValue.trim(),
        draft.paths,
        mode,
        turnId ?? undefined,
        undefined,
        contexts,
      );
      useSessionDraftStore.getState().clearSubmitted(owner, snapshot);
      draft.clear(ids);
      composerDrafts.clearSubmitted(owner, contexts, capturedContexts.versions);
    } catch (e) {
      toast.error(String(e));
    } finally {
      busy.current = false;
      setSending(false);
    }
  };
  const finishClose = () => {
    if (skipNext)
      localStorage.setItem("kanban.session.side-chat-close-skip", "1");
    setConfirming(false);
    const sideId = id;
    useSideChatStore.getState().close();
    useAgentCenterStore.getState().removeCard({ kind: "codex", id: sideId });
    useCodexStore.setState((state) => ({
      threads: state.threads.filter((thread) => thread.id !== sideId),
    }));
    useCodexStore.getState().triggerInputFocus();
    void deleteThread(sideId).catch(() =>
      toast.error("无法删除任务。请重试。"),
    );
  };
  const requestClose = () => {
    if (localStorage.getItem("kanban.session.side-chat-close-skip") === "1") {
      finishClose();
      return;
    }
    setConfirming(true);
  };
  return (
    <section className="session-side-chat" aria-label={title}>
      <header>
        <strong>{title}</strong>
        <span>独立会话</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="返回主会话"
          onClick={requestClose}
        >
          返回主会话
        </Button>
      </header>
      <div className="session-side-transcript">
        <CodexThread threadId={id} fillHeight />
      </div>
      <form
        className="session-compact-composer"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        onPasteCapture={(e) => {
          draft.onPaste(e);
          if (e.defaultPrevented) {
            e.stopPropagation();
            return;
          }
          const text = e.clipboardData.getData("text/plain");
          if (isLargePaste(text)) {
            e.preventDefault();
            e.stopPropagation();
            composerDrafts.add(owner, {
              id: newSessionEditId(),
              kind: "paste",
              name: "粘贴的文本",
              text,
            });
          }
        }}
      >
        {drawingId && (
          <DrawingEditor
            owner={owner}
            item={draft.attachments.find((a) => a.id === drawingId)}
            attachments={draft}
            onClose={() => setDrawingId(null)}
          />
        )}
        <div
          className="session-composer-floating"
          aria-label="侧边会话提示与待发送消息"
        >
          <ModelChangeNotice threadId={id} />
          <FollowupQueueContent
            compactShelf
            snapshot={queueSnapshot}
            threadId={id}
            turnId={turnId}
          />
        </div>
        <div className="session-composer-surface session-compact-frame">
          <div className="session-compact-body">
            <textarea
              ref={editorRef}
              autoFocus
              aria-label="侧边聊天输入"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                if (
                  window.matchMedia?.("(pointer: coarse)").matches &&
                  !e.ctrlKey &&
                  !e.metaKey
                )
                  return;
                const intent = submitIntent(
                  { ...e, isComposing: e.nativeEvent.isComposing },
                  inputValue,
                  settings.enterBehavior,
                );
                if (intent) {
                  e.preventDefault();
                  void send(intent === "opposite");
                }
              }}
            />
            <ContextAttachments
              compact
              owner={owner}
              images={draft}
              onAnnotate={(item) => setDrawingId(item.id)}
              onRestore={(text) => {
                const el = editorRef.current;
                setInputValue(
                  insertAtSelection(
                    readDraft(owner).text,
                    el?.selectionStart ?? inputValue.length,
                    el?.selectionEnd ?? inputValue.length,
                    text,
                  ),
                );
              }}
            />
          </div>
          <div className="session-composer-toolbar">
            <div className="session-composer-policy">
              <Button
                type="button"
                variant="ghost"
                aria-label="侧边输入状态与消息队列"
                onClick={() => setDetailsOpen(true)}
              >
                ＋
              </Button>
              <AccessModePopover compact threadId={id} />
            </div>
            <div className="session-compact-meta">
              <span>侧边聊天是临时聊天，关闭应用后会消失。</span>
              <span
                className="session-compact-status"
                role={
                  storageError ||
                  draft.storageError ||
                  draft.attachments.some((a) => a.status === "error")
                    ? "alert"
                    : "status"
                }
              >
                {accessBlock
                  ? accessBlock
                  : threadInput.reason
                    ? threadInput.reason
                    : storageError
                      ? "上下文保存失败，打开状态面板重试"
                      : contextBusy
                        ? contextStatus.phase === "hydrating" ? "正在恢复上下文草稿…" : "正在保存上下文草稿…"
                      : draft.storageError
                        ? "附件草稿保存失败，打开状态面板重试"
                        : draft.attachments.some((a) => a.status === "error")
                          ? "图片上传失败，点击缩略图重试"
                          : draft.blocked
                            ? "正在上传图片…"
                            : queued.length || queueSnapshot.state.paused
                              ? `待发送 ${queued.length} 条${queueSnapshot.state.paused ? " · 已暂停" : ""}`
                                : running
                                  ? "运行中"
                                  : ""}
                {threadInput.needsVerification && (
                  <button
                    type="button"
                    onClick={threadInput.recheck}
                    disabled={threadInput.rechecking}
                  >
                    重新核对
                  </button>
                )}
              </span>
            </div>
            <div className="session-composer-actions">
              <Button
                type="button"
                variant="ghost"
                className="session-model-trigger session-model-compact"
                aria-label="侧边模型与思考强度"
                onClick={() => setModelOpen(true)}
              >
                <span className="session-model-description">
                  <span className="session-model-name">
                    {model.model ?? "选择模型"}
                  </span>
                  <span className="session-model-effort">
                    {model.reasoningEffort ?? "默认"}
                  </span>
                </span>
              </Button>

              {running && (
                <Button
                  type="button"
                  variant="outline"
                  className="session-composer-stop"
                  aria-label="停止侧边任务"
                  disabled={stopping}
                  onClick={requestStop}
                >
                  <Square size={14} />
                </Button>
              )}
              {(!running || hasContent) && (
                <Button
                  aria-label={
                    running
                      ? settings.mode === "queue"
                        ? "排队侧边消息"
                        : "引导侧边任务"
                      : "发送侧边消息"
                  }
                  className="session-composer-send"
                  type="submit"
                  disabled={
                    sending ||
                    !!accessBlock ||
                    threadInput.blocked ||
                    draft.blocked ||
                    !!storageError ||
      contextBusy ||
                    !hasContent
                  }
                >
                  {running ? (
                    settings.mode === "queue" ? (
                      <ListPlus size={18} />
                    ) : (
                      <CornerDownRight size={18} />
                    )
                  ) : (
                    <ArrowUp size={18} />
                  )}
                </Button>
              )}
            </div>
          </div>
        </div>
      </form>
      {confirming && (
        <div
          className="session-side-chat-confirm"
          role="dialog"
          aria-label="关闭侧边聊天？"
        >
          <h2>关闭侧边聊天？</h2>
          <p>这个侧边聊天将被删除，且无法恢复。你确定吗？</p>
          <label>
            <input
              type="checkbox"
              checked={skipNext}
              onChange={(event) => setSkipNext(event.target.checked)}
            />
            不再询问
          </label>
          <div>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setConfirming(false)}
            >
              取消
            </Button>
            <Button type="button" onClick={finishClose}>
              关闭侧边聊天
            </Button>
          </div>
        </div>
      )}
      {detailsOpen && (
        <ComposerSheet
          title="侧边输入状态与消息队列"
          onClose={() => {
            setDetailsOpen(false);
            editorRef.current?.focus();
          }}
        >
          {storageError && (
            <p role="alert">
              {storageError}
              <button type="button" onClick={() => void composerDrafts.retryStorage().catch((error) => toast.error(String(error)))}>
                重试保存上下文
              </button>
            </p>
          )}

          {draft.storageError && (
            <p role="alert">
              {draft.storageError}
              <button type="button" onClick={draft.retryStorage}>
                重试保存附件草稿
              </button>
            </p>
          )}
          <FollowupQueueContent
            key={id}
            inlineDetails
            snapshot={queueSnapshot}
            threadId={id}
            turnId={turnId}
          />
        </ComposerSheet>
      )}
      {modelOpen && (
        <ComposerSheet
          title="侧边模型与思考强度"
          onClose={() => {
            setModelOpen(false);
            editorRef.current?.focus();
          }}
        >
          <ModelReasonSelector
            mode="panel"
            threadId={id}
            onClose={() => setModelOpen(false)}
          />
        </ComposerSheet>
      )}
    </section>
  );
}
export function SideChatPanel() {
  const chat = useSideChatStore((s) => s.chat);
  return (
    <>
      <PlanSidePanel />
      {chat ? <SideChat key={chat.id} {...chat} /> : null}
    </>
  );
}
