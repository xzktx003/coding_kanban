import { composeContextText } from "@agent-orchestrator/shared";
import {
  composerDrafts,
  useComposerDraft,
  useComposerDraftStore,
} from "./v2/drafts";
import { ContextAttachments } from "./v2/ContextAttachments";
import { DrawingEditor } from "./v2/DrawingEditor";
import { isLargePaste, insertAtSelection } from "./v2/content";
import { ArrowUp, Square, ListPlus, CornerDownRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useSideChatStore } from "@session/stores/useSideChatStore";
import {
  sessionDraftKey,
  readDraft,
  useSessionDraftStore,
  useSessionTextDraft,
} from "@session/stores/useSessionDraftStore";
import { useFollowupSettingsStore } from "@session/stores/useFollowupSettingsStore";
import { followupService } from "@session/services/followupService";
import { useCodexStore } from "../stores";
import { codexService } from "@session/services/codexService";
import { CodexThread } from "../thread/CodexThread";
import { useImageAttachments } from "../../common/useImageAttachments";
import { ImageAttachmentStrip } from "../../common/ImageAttachmentStrip";
import { Button } from "../../ui/button";
import { FollowupQueue } from "./FollowupQueue";
import { submitIntent } from "./editor/submitIntent";
import { useStopAction } from "../../common/useStopAction";
import { useTurnControl } from "../hooks/useTurnControl";
import { ModelChangeNotice } from "./ModelChangeNotice";
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
  const storageError = useComposerDraftStore((s) => s.error);
  const [drawingId, setDrawingId] = useState<string | null>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const hasContent = !!(
    inputValue.trim() ||
    draft.paths.length ||
    contextDraft.contexts.length
  );
  const [sending, setSending] = useState(false),
    busy = useRef(false),
    settings = useFollowupSettingsStore();
  const { running, turnId } = useTurnControl(id);
  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      if (images.length) void draft.addPaths(images);
    }
    if (!useCodexStore.getState().events[id])
      void codexService.threadResume(id).catch((e) => toast.error(String(e)));
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
    if (busy.current || draft.blocked || !!storageError || !hasContent) return;
    const contexts = contextDraft.contexts;
    if (composeContextText(inputValue, contexts).length > 200_000) {
      toast.error("正文与上下文合计不能超过 200,000 字符");
      return;
    }
    const snapshot = readDraft(owner),
      ids = draft.attachments.map((a) => a.id);
    busy.current = true;
    setSending(true);
    try {
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
        snapshot.revision,
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
      composerDrafts.clearSubmitted(owner, contexts);
    } catch (e) {
      toast.error(String(e));
    } finally {
      busy.current = false;
      setSending(false);
    }
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
          aria-label="关闭侧边聊天"
          onClick={() => {
            useSideChatStore.getState().close();
            useCodexStore.getState().triggerInputFocus();
          }}
        >
          返回主会话
        </Button>
      </header>
      <div className="session-side-transcript">
        <CodexThread threadId={id} fillHeight />
      </div>
      <FollowupQueue threadId={id} turnId={turnId} />
      <ModelChangeNotice threadId={id} />
      <form
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
              id: crypto.randomUUID(),
              kind: "paste",
              name: "粘贴的文本",
              text,
            });
          }
        }}
      >
        <ContextAttachments
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
        {storageError && (
          <p role="alert">
            {storageError}
            <button type="button" onClick={composerDrafts.retryStorage}>
              重试保存上下文
            </button>
          </p>
        )}
        {drawingId && (
          <DrawingEditor
            owner={owner}
            item={draft.attachments.find((a) => a.id === drawingId)}
            attachments={draft}
            onClose={() => setDrawingId(null)}
          />
        )}
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
        <div className="session-followup-actions">
          {running && (
            <Button
              type="button"
              variant="outline"
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
              type="submit"
              disabled={
                sending || draft.blocked || !!storageError || !hasContent
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
      </form>
    </section>
  );
}
export function SideChatPanel() {
  const chat = useSideChatStore((s) => s.chat);
  return chat ? <SideChat key={chat.id} {...chat} /> : null;
}
