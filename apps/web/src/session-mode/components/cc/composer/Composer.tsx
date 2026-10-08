import { useStopAction } from "../../common/useStopAction";
import {
  moveImageDraft,
  useImageAttachments,
} from "../../common/useImageAttachments";
import { ImageAttachmentStrip } from "../../common/ImageAttachmentStrip";
import { CircleStop, Send } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { AgentModelPanel } from "@session/components/agent/AgentModelPanel";
import { AgentModelTrigger } from "@session/components/agent/AgentModelTrigger";
import { CCPermissionModeSelect } from "@session/components/cc/composer";
import { FileMentionPopover } from "@session/components/common";
import { Button } from "@session/components/ui/button";
import { useCCSessionManager } from "@session/hooks/useCCSessionManager";
import { ccInterrupt, ccSendMessage } from "@session/services";
import { useAgentCenterStore, useWorkspaceStore } from "@session/stores";
import {
  appendDraft,
  fileLinks,
  readDraft,
  sessionDraftKey,
  useSessionDraftStore,
  useSessionTextDraft,
} from "@session/stores/useSessionDraftStore";
import { useCCStore } from "@session/stores/cc";
import { CCAttachmentButton } from "./CCAttachmentButton";
import { CCSkillsPopover } from "./CCSkillsPopover";
import { CCSlashCommandPopover } from "./CCSlashCommandPopover";

const CC_INPUT_FOCUS_EVENT = "cc-input-focus-request";

interface ComposerProps {
  targetLabel?: React.ReactNode;
  /** When provided, overrides the normal send — called instead of creating a session. */
  overrideSend?: (text: string) => void;
  onAfterSend?: (sessionId: string, text: string) => void;
}

export function Composer({
  overrideSend,
  onAfterSend,
  targetLabel,
}: ComposerProps = {}) {
  const {
    activeSessionId,
    isConnected,
    isLoading: loading,
    sessionLoadingMap,
    addMessage,
    setLoading,
    setConnected,
  } = useCCStore();
  const isLoading =
    loading || !!(activeSessionId && sessionLoadingMap[activeSessionId]);
  const cwd = useWorkspaceStore((s) => s.cwd);
  const owner = sessionDraftKey("cc", activeSessionId, cwd);
  const { inputValue: input, setInputValue: setInput } = useSessionTextDraft(
    owner,
    "cc",
  );
  const { setCurrentAgentCardId } = useAgentCenterStore();
  const { handleNewSession } = useCCSessionManager();

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const isComposing = useRef(false);
  const attachments = useImageAttachments(owner);
  const images = attachments.paths;

  // Callback ref captures the wrapper element as soon as it mounts,
  // avoiding an extra render caused by state+effect.
  const [triggerEl, setTriggerEl] = useState<HTMLElement | null>(null);
  const wrapperRef = useCallback((node: HTMLDivElement | null) => {
    setTriggerEl(node);
  }, []);

  useEffect(() => {
    const handleFocusRequest = () => {
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
      });
    };
    window.addEventListener(CC_INPUT_FOCUS_EVENT, handleFocusRequest);
    return () =>
      window.removeEventListener(CC_INPUT_FOCUS_EVENT, handleFocusRequest);
  }, []);

  const handleSendMessage = useCallback(
    async (messageText?: string) => {
      const text = (messageText ?? input).trim();
      if ((!text && images.length === 0) || isLoading || attachments.blocked)
        return;
      const submittedIds = attachments.attachments.map((a) => a.id);
      const snapshot = readDraft(owner);

      if (overrideSend) {
        useSessionDraftStore.getState().clearSubmitted(owner, snapshot);
        overrideSend(text);
        return;
      }

      const pendingImages = images;

      if (!activeSessionId) {
        let createdOwner = owner;
        let createdId: string | null = null;
        const accepted = await handleNewSession(
          text,
          pendingImages,
          async (id) => {
            createdId = id;
            createdOwner = sessionDraftKey("cc", id);
            useSessionDraftStore.getState().move(owner, createdOwner);
            await moveImageDraft(owner, createdOwner);
          },
        );
        if (!accepted) return;
        useSessionDraftStore.getState().clearSubmitted(createdOwner, snapshot);
        attachments.clear(submittedIds);
        if (createdId) onAfterSend?.(createdId, text);
        return;
      }

      setCurrentAgentCardId(activeSessionId);
      addMessage({ type: "user", text });
      setLoading(true);
      onAfterSend?.(activeSessionId, text);

      try {
        await ccSendMessage(activeSessionId, text, pendingImages);
        useSessionDraftStore.getState().clearSubmitted(owner, snapshot);
        attachments.clear(submittedIds);
        if (
          !isConnected &&
          useCCStore.getState().activeSessionId === activeSessionId
        )
          setConnected(true);
      } catch (error) {
        console.error("[CCInput] Failed to send message:", error);
        useCCStore.getState().setSessionLoading(activeSessionId, false);
        if (useCCStore.getState().activeSessionId === activeSessionId)
          addMessage({
            type: "assistant",
            message: { content: [{ type: "text", text: `Error: ${error}` }] },
          });
      }
    },
    [
      input,
      images,
      attachments,
      isLoading,
      activeSessionId,
      isConnected,
      addMessage,
      setInput,
      setLoading,
      setConnected,
      handleNewSession,
      setCurrentAgentCardId,
      onAfterSend,
      overrideSend,
    ],
  );

  const { stopping, requestStop } = useStopAction(
    activeSessionId,
    isLoading,
    async () => {
      if (!activeSessionId) throw new Error("尚未获取当前会话");
      await ccInterrupt(activeSessionId);
      // Update the captured session only; failures keep the task running and retryable.
      useCCStore.getState().setSessionLoading(activeSessionId, false);
    },
  );

  const handleSend = useCallback(() => {
    if (!isLoading) {
      handleSendMessage();
    }
  }, [isLoading, input, handleSendMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        if (
          isComposing.current ||
          (e.nativeEvent as KeyboardEvent & { isComposing?: boolean })
            .isComposing
        ) {
          return;
        }
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  return (
    <>
      <div className="shrink-0">
        <div className="relative group session-cc-composer session-compact-composer">
          <div
            ref={wrapperRef}
            onPasteCapture={attachments.onPaste}
            className="session-composer-surface session-compact-frame"
          >
            <div className="session-compact-body">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                onCompositionStart={() => {
                  isComposing.current = true;
                }}
                onCompositionEnd={() => {
                  setTimeout(() => {
                    isComposing.current = false;
                  }, 50);
                }}
                placeholder="Ask Claude to do anything..."
                rows={1}
                className="w-full resize-none overflow-y-auto bg-transparent px-3 pt-3 pb-11 text-base md:text-sm outline-none placeholder:text-muted-foreground min-h-16 max-h-48"
              />
              <ImageAttachmentStrip key={owner} compact draft={attachments} />
            </div>
            <div className="session-composer-toolbar">
              <div className="session-composer-policy">
                <CCAttachmentButton
                  onFilesSelected={(paths) => {
                    if (paths.length) appendDraft(owner, fileLinks(paths, cwd));
                  }}
                  onImagesSelected={attachments.addPaths}
                />
                <CCPermissionModeSelect />
              </div>

              <div className="session-compact-meta">
                {targetLabel}
                <span
                  className="session-compact-status"
                  role={
                    attachments.storageError ||
                    attachments.attachments.some((a) => a.status === "error")
                      ? "alert"
                      : "status"
                  }
                >
                  {attachments.storageError
                    ? "附件草稿保存失败，点击附件重试"
                    : attachments.attachments.some((a) => a.status === "error")
                      ? "图片上传失败，点击缩略图重试"
                      : attachments.blocked
                        ? "正在上传图片…"
                        : isLoading
                          ? "运行中"
                          : ""}
                </span>
              </div>
              <div className="session-composer-actions">
                <AgentModelPanel trigger={<AgentModelTrigger compact />} />
                <Button
                  onClick={isLoading ? requestStop : handleSend}
                  aria-label={
                    isLoading
                      ? stopping
                        ? "正在停止"
                        : "停止生成"
                      : "发送消息"
                  }
                  title={
                    isLoading
                      ? stopping
                        ? "正在停止…"
                        : "停止生成"
                      : "发送消息"
                  }
                  size="icon"
                  className="session-composer-send"
                  variant={isLoading ? "destructive" : "default"}
                  disabled={
                    isLoading
                      ? stopping
                      : attachments.blocked ||
                        (!input.trim() && images.length === 0)
                  }
                >
                  {isLoading ? (
                    <CircleStop className="h-3.5 w-3.5" />
                  ) : (
                    <Send className="h-3.5 w-3.5" />
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <CCSlashCommandPopover
        input={input}
        setInput={setInput}
        editorRef={textareaRef}
        triggerElement={triggerEl}
      />

      <CCSkillsPopover
        input={input}
        setInput={setInput}
        editorRef={textareaRef}
        triggerElement={triggerEl}
      />

      <FileMentionPopover
        input={input}
        setInput={setInput}
        editorRef={textareaRef}
        triggerElement={triggerEl}
      />
    </>
  );
}
