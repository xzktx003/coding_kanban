import { composeContextText } from "@agent-orchestrator/shared";
import {
  composerDrafts,
  useComposerDraft,
  useComposerDraftStore,
} from "./v2/drafts";
import { ContextAttachments, addFileContexts } from "./v2/ContextAttachments";
import { ComposerSheet } from "./v2/ComposerSheet";
import { RichDraftEditor } from "./v2/RichDraftEditor";
import { DrawingEditor } from "./v2/DrawingEditor";
import { ComposerCommands } from "./v2/ComposerCommands";
import { ModelReasonSelector } from "./ModelReasonSelector";
import { isLargePaste, insertAtSelection } from "./v2/content";
import { Maximize2, Pencil, Code2, Search } from "lucide-react";
import {
  followupService,
  followupParameters,
} from "@session/services/followupService";
import { createSideChat } from "@session/services/conversationActions";
import { useFollowupSettingsStore } from "@session/stores/useFollowupSettingsStore";
import { FollowupQueue } from "./FollowupQueue";
import { SideChatPanel } from "./SideChatPanel";
import { ReviewDialog } from "./ReviewDialog";
import type { FollowupMode } from "@agent-orchestrator/shared";
import { useStopAction } from "../../common/useStopAction";
import { useTurnControl } from "../hooks/useTurnControl";
import {
  moveImageDraft,
  useImageAttachments,
} from "../../common/useImageAttachments";
import { ImageAttachmentStrip } from "../../common/ImageAttachmentStrip";
import { useShallow } from "zustand/react/shallow";
import { toast } from "sonner";
import {
  ArrowUp,
  Pause,
  Play,
  Square,
  Target,
  X,
  ListPlus,
  CornerDownRight,
  ClipboardCheck,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ThreadGoal } from "@session/bindings/v2";
import { AgentModelPanel } from "@session/components/agent/AgentModelPanel";
import { AgentModelTrigger } from "@session/components/agent/AgentModelTrigger";
import { useThreadGoal } from "@session/components/codex/hooks";
import {
  useCodexStore,
  useConfigStore,
} from "@session/components/codex/stores";
import { ContextWindowWidget } from "@session/components/codex/widget";
import { FileMentionPopover } from "@session/components/common";
import { Button } from "@session/components/ui/button";
import { codexService } from "@session/services/codexService";
import { useAgentCenterStore } from "@session/stores";
import { activeDraftOwner } from "@session/stores/useInputStore";
import {
  appendDraft,
  fileLinks,
  readDraft,
  sessionDraftKey,
  useSessionDraftStore,
  useSessionTextDraft,
} from "@session/stores/useSessionDraftStore";
import { useSessionNameStore } from "@session/stores/useSessionNameStore";
import { useWorkspaceStore } from "@session/stores/useWorkspaceStore";
import { AccessModePopover } from "./AccessModePopover";
import { ComposerMenu } from "./ComposerMenu";
import { ComposerToolbarProvider } from "./ComposerToolbarContext";
import { DictationButton } from "./DictationButton";
import {
  ComposerEditor,
  type ComposerEditorHandle,
} from "./editor/ComposerEditor";
import { SlashCommandDialogs } from "./SlashCommandDialogs";
import { SlashCommandPopover } from "./SlashCommandsSelector";
import type { SlashDialog } from "./slashCommands";

interface ComposerProps {
  targetLabel?: React.ReactNode;
  overrideSend?: (text: string) => void;
  onAfterSend?: (threadId: string, text: string) => void;
}

// Compact status label per goal status, mirroring
// codex-rs/tui/src/bottom_pane/footer.rs::goal_status_indicator_line.
function goalStatusLabel(status: ThreadGoal["status"]): string {
  switch (status) {
    case "active":
      return "Pursuing goal";
    case "paused":
      return "Goal paused";
    case "blocked":
      return "Goal blocked";
    case "usageLimited":
      return "Goal hit usage limits";
    case "budgetLimited":
      return "Goal unmet";
    case "complete":
      return "Goal achieved";
  }
}

export function Composer({ overrideSend, onAfterSend, targetLabel }: ComposerProps) {
  const preferences = useFollowupSettingsStore();
  const { collaborationMode, setCollaborationMode } = useConfigStore();
  const [reviewOpen, setReviewOpen] = useState(false);

  const submitMode = useRef<FollowupMode | null>(null);
  const [deliveryNotice, setDeliveryNotice] = useState<{
    owner: string;
    text: string;
  } | null>(null);
  const [slashDialog, setSlashDialog] = useState<SlashDialog | null>(null);
  const { currentThreadId, inputFocusTrigger, goalEnabled, setGoalEnabled } =
    useCodexStore(
      useShallow((s) => ({
        currentThreadId: s.currentThreadId,
        inputFocusTrigger: s.inputFocusTrigger,
        goalEnabled: s.goalEnabled,
        setGoalEnabled: s.setGoalEnabled,
      })),
    );
  const cwd = useWorkspaceStore((s) => s.cwd);
  const owner = sessionDraftKey("codex", currentThreadId, cwd);
  const { inputValue, setInputValue } = useSessionTextDraft(owner, "codex");
  const richDraft = useComposerDraft(owner);
  const contextStorageError = useComposerDraftStore((s) => s.error);
  const [pendingFiles, setPendingFiles] = useState<Record<string, number>>({});
  const [drawing, setDrawing] = useState<{ owner: string; id: string } | null>(
    null,
  );
  const [commandsOwner, setCommandsOwner] = useState<string | null>(null);
  useEffect(() => {
    setSlashDialog(null);
    setReviewOpen(false);
  }, [owner]);
  const appendFileLinks = useCallback(
    (paths: string[]) => {
      setPendingFiles((s) => ({ ...s, [owner]: (s[owner] ?? 0) + 1 }));
      void addFileContexts(owner, paths)
        .catch((e) => toast.error(String(e)))
        .finally(() =>
          setPendingFiles((s) => ({
            ...s,
            [owner]: Math.max(0, (s[owner] ?? 1) - 1),
          })),
        );
    },
    [owner],
  );
  const { addAgentCard, setCurrentAgentCardId } = useAgentCenterStore();
  const attachments = useImageAttachments(owner);
  const images = attachments.paths;
  const blocked =
    attachments.blocked || !!contextStorageError || !!pendingFiles[owner];
  const hasContent = !!(
    inputValue.trim() ||
    images.length ||
    richDraft.contexts.length
  );
  const handlePaste = (event: React.ClipboardEvent) => {
    attachments.onPaste(event);
    if (event.defaultPrevented) {
      event.stopPropagation();
      return;
    }
    const text = event.clipboardData.getData("text/plain");
    if (isLargePaste(text)) {
      event.preventDefault();
      event.stopPropagation();
      composerDrafts.add(owner, {
        id: crypto.randomUUID(),
        kind: "paste",
        name: "粘贴的文本",
        text,
      });
    }
  };
  const [sendingOwners, setSendingOwners] = useState<Record<string, boolean>>(
    {},
  );
  const sendingRef = useRef(new Set<string>());
  const sending = sendingOwners[owner] ?? false;
  const { running, turnId: currentTurnId } = useTurnControl();
  const { stopping, requestStop } = useStopAction(
    currentThreadId ? `${currentThreadId}:${currentTurnId ?? "active"}` : null,
    running,
    async () => {
      if (!currentThreadId || !currentTurnId)
        throw new Error("尚未获取当前任务，请稍后重试");
      await followupService.stop(currentThreadId, currentTurnId);
    },
  );
  // Actual goal state for the current thread, driven by thread/goal/updated
  // (mirrors codex-rs/tui's GoalStatusIndicator, which is derived purely
  // from ThreadGoal.status rather than a local UI toggle).
  const threadGoal = useThreadGoal();
  const hasContextUsage = useCodexStore(
    (s) => !!currentThreadId && !!s.tokenUsageMap[currentThreadId],
  );

  const editorRef = useRef<ComposerEditorHandle>(null);
  const expandedSelection = useRef({
    start: inputValue.length,
    end: inputValue.length,
  });
  const wrapperRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refocus the composer whenever the thread switches or a focus request is raised
  useEffect(() => {
    editorRef.current?.focus();
  }, [currentThreadId, inputFocusTrigger]);

  const handleEditorSubmit = useCallback((intent?: "default" | "opposite") => {
    const mode = useFollowupSettingsStore.getState().mode;
    submitMode.current =
      intent === "opposite" ? (mode === "queue" ? "steer" : "queue") : null;
    formRef.current?.requestSubmit();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const submitter = (e.nativeEvent as SubmitEvent)
      .submitter as HTMLButtonElement | null;
    const requestedMode: FollowupMode =
      submitter?.value === "replace"
        ? "replace"
        : (submitMode.current ?? preferences.mode);
    submitMode.current = null;
    const parameters = followupParameters(currentThreadId ?? "");
    const text = inputValue.trim();
    const submittedContexts = richDraft.contexts;
    const completeText = composeContextText(text, submittedContexts);
    if (
      blocked ||
      sendingRef.current.has(owner) ||
      (!completeText && images.length === 0)
    )
      return;
    if (
      completeText.length > 200_000 ||
      submittedContexts.length > 32 ||
      images.length > 8
    ) {
      toast.error(
        "消息过长或附件过多：正文与引用合计最多 200,000 字符、32 项上下文、8 张图片；请分批发送",
      );
      return;
    }
    const submittedIds = attachments.attachments.map((a) => a.id);
    const snapshot = readDraft(owner);
    let submittedOwner = owner;
    const clearSubmitted = () => {
      const current = readDraft(submittedOwner);
      const unchanged =
        current.revision === snapshot.revision &&
        current.text === snapshot.text;
      useSessionDraftStore.getState().clearSubmitted(submittedOwner, snapshot);
      composerDrafts.clearSubmitted(submittedOwner, submittedContexts);
      if (unchanged) composerDrafts.setExpanded(submittedOwner, false);
    };
    const markSending = (key: string, value: boolean) => {
      if (value) sendingRef.current.add(key);
      else sendingRef.current.delete(key);
      setSendingOwners((previous) => ({ ...previous, [key]: value }));
    };
    markSending(owner, true);
    try {
      if (running && requestedMode !== "queue" && !currentTurnId)
        throw new Error("正在同步当前任务，请稍后引导或停止");
      if (running && goalEnabled)
        throw new Error("当前任务运行中，请先取消目标草稿再发送追加消息");
      if (overrideSend) {
        overrideSend(completeText);
        clearSubmitted();
        return;
      }
      let targetThreadId = currentThreadId;
      if (!targetThreadId) {
        const thread = await codexService.threadStart({
          shouldActivate: () => activeDraftOwner() === owner,
        });
        targetThreadId = thread.id;
        parameters.cwd = thread.cwd ?? cwd;
        submittedOwner = sessionDraftKey("codex", thread.id);
        markSending(submittedOwner, true);
        useSessionDraftStore.getState().move(owner, submittedOwner);
        composerDrafts.move(owner, submittedOwner);
        // Follow the newly created identity before moving attachments, so a storage failure
        // leaves a visible retry destination instead of creating a second session.
        useSessionNameStore.getState().initializeName("codex", thread.id, text);
        addAgentCard(
          {
            kind: "codex",
            id: thread.id,
            preview: text,
            worktreePath: thread.cwd?.includes("/.codexia/worktrees/")
              ? thread.cwd
              : undefined,
            cwd: thread.cwd ?? cwd,
          },
          {
            activate:
              activeDraftOwner() === owner ||
              activeDraftOwner() === submittedOwner,
          },
        );
        await moveImageDraft(owner, submittedOwner);
      }
      if (goalEnabled) {
        await codexService.threadGoalSet({
          threadId: targetThreadId,
          objective: completeText,
        });
        setGoalEnabled(false);
        clearSubmitted();
        return;
      }
      // Continuing an existing session never replaces its name with this message.
      if (activeDraftOwner() === submittedOwner)
        setCurrentAgentCardId(targetThreadId, "codex");
      onAfterSend?.(targetThreadId, text);
      const accepted = await followupService.submit(
        submittedOwner,
        snapshot.revision,
        targetThreadId,
        text,
        images,
        running ? requestedMode : "queue",
        running ? (currentTurnId ?? undefined) : undefined,
        parameters,
        submittedContexts,
      );
      setDeliveryNotice({
        owner: submittedOwner,
        text:
          running && requestedMode === "steer"
            ? "引导已提交"
            : running && requestedMode === "replace"
              ? "正在停止，结束后发送新请求"
              : accepted.paused
                ? "消息已入队，队列暂停中"
                : "消息已接收，将按顺序发送",
      });
      clearSubmitted();
      attachments.clear(submittedIds);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "发送失败，输入已保留，请重试",
      );
    } finally {
      markSending(owner, false);
      if (submittedOwner !== owner) markSending(submittedOwner, false);
    }
  };

  // Toggle the goal between active and paused, matching the TUI's `/goal pause`
  // and `/goal resume` commands (see codex-rs/tui/src/chatwidget/goal_menu.rs).
  const handleToggleGoalPause = async () => {
    if (!currentThreadId || !threadGoal) {
      return;
    }
    const nextStatus = threadGoal.status === "active" ? "paused" : "active";
    try {
      await codexService.threadGoalSet({
        threadId: currentThreadId,
        status: nextStatus,
      });
    } catch (error) {
      console.error("Failed to update goal status:", error);
    }
  };

  // Append a `$mention` (optionally followed by a starter prompt) from the plus
  // menu. The editor turns the known mention text back into a chip via its
  // external-value sync, so this only has to deal with plain strings.
  const handleInsertMention = (text: string) => {
    const separator = !inputValue || /\s$/.test(inputValue) ? "" : " ";
    setInputValue(`${inputValue}${separator}${text} `);
    editorRef.current?.focus();
  };

  // Clear the goal server-side. Local goalMap state is updated via the
  // thread/goal/cleared notification once the server confirms, so we don't
  // optimistically mutate the store here (avoids it being resurrected by a
  // late thread/goal/updated event).
  const handleClearGoal = async () => {
    setGoalEnabled(false);
    if (!currentThreadId) {
      return;
    }
    try {
      await codexService.threadGoalClear({ threadId: currentThreadId });
    } catch (error) {
      console.error("Failed to clear goal:", error);
    }
  };

  return (
    <div className="session-codex-composer">
      <FollowupQueue
        key={currentThreadId ?? "new"}
        threadId={currentThreadId}
        turnId={currentTurnId}
        onSideChat={(message) => {
          if (currentThreadId)
            void createSideChat(
              currentThreadId,
              composeContextText(message.text, message.contexts),
              message.images,
            ).catch((e) => toast.error(String(e)));
        }}
      />
      {deliveryNotice?.owner === owner && (
        <p role="status" className="sr-only">
          {deliveryNotice.text}
        </p>
      )}
      <SideChatPanel />
      {reviewOpen && (
        <ReviewDialog
          threadId={currentThreadId}
          onClose={() => setReviewOpen(false)}
        />
      )}
      <form
        ref={formRef}
        onSubmit={handleSubmit}
        onPasteCapture={handlePaste}
        className="session-composer-form pb-[env(safe-area-inset-bottom)]"
      >
        <FileMentionPopover
          input={inputValue}
          setInput={setInputValue}
          editorRef={editorRef}
          triggerElement={wrapperRef.current}
          onFileSelected={(path) => appendFileLinks([path])}
        />
        <SlashCommandPopover
          input={inputValue}
          setInputValue={setInputValue}
          editorRef={editorRef}
          triggerElement={wrapperRef.current}
          onOpenDialog={setSlashDialog}
        />

        <div
          data-composer-suggestion-anchor
          className="session-composer-surface"
        >
          {targetLabel}
          <ContextAttachments
            key={owner}
            owner={owner}
            images={attachments}
            onAnnotate={(item) => setDrawing({ owner, id: item.id })}
            onRestore={(text) => editorRef.current?.insertText(text)}
          />
          {contextStorageError && (
            <p role="alert" className="session-context-warning">
              {contextStorageError}
              <button type="button" onClick={composerDrafts.retryStorage}>
                重试保存上下文
              </button>
            </p>
          )}
          {!!pendingFiles[owner] && <p role="status">正在读取文件快照…</p>}
          {collaborationMode === "plan" && (
            <div className="session-composer-mode">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setCollaborationMode("default")}
                aria-label="取消规划模式"
              >
                规划模式
                <X size={12} />
              </Button>
            </div>
          )}

          <div ref={wrapperRef} className="session-composer-editor">
            <ComposerEditor
              key={owner}
              ref={editorRef}
              value={inputValue}
              onChange={setInputValue}
              onSubmit={handleEditorSubmit}
              placeholder={
                goalEnabled
                  ? "输入目标…"
                  : running
                    ? "继续补充…"
                    : "描述你想完成的任务…"
              }
            />
          </div>

          {threadGoal && (
            <div className="flex items-center gap-1.5 px-3 pb-1 text-xs text-muted-foreground">
              <Target className="h-3 w-3 shrink-0" />
              <span className="truncate">
                {goalStatusLabel(threadGoal.status)}
              </span>
              {threadGoal.status !== "complete" && (
                <span className="truncate text-muted-foreground/70">
                  · {threadGoal.objective}
                </span>
              )}
            </div>
          )}

          {(goalEnabled || threadGoal) && (
            <div className="session-composer-goal-tools">
              {/* Draft mode: entering a new goal, not yet set on the thread. */}
              {goalEnabled && !threadGoal && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setGoalEnabled(false)}
                  aria-label="取消目标草稿"
                  title="取消目标草稿"
                  className="group relative h-8 px-2 text-muted-foreground"
                >
                  <span>目标草稿</span>
                  <X className="h-3 w-3" />
                </Button>
              )}
              {/* A goal is actually set on the thread: allow pause/resume and clear
                    based on its real status, matching /goal pause|resume|clear in the TUI. */}
              {threadGoal && (
                <>
                  {(threadGoal.status === "active" ||
                    threadGoal.status === "paused") && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={handleToggleGoalPause}
                      title={
                        threadGoal.status === "active"
                          ? "Pause goal"
                          : "Resume goal"
                      }
                      className="ml-1 h-8 w-8 text-blue-600 hover:bg-blue-50"
                    >
                      {threadGoal.status === "active" ? (
                        <Pause className="h-4 w-4" />
                      ) : (
                        <Play className="h-4 w-4" />
                      )}
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={handleClearGoal}
                    title="Clear goal"
                    className="h-8 w-8 text-blue-600 hover:bg-blue-50"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </>
              )}
            </div>
          )}
          <div className="session-composer-bottom">
            <ComposerToolbarProvider className="session-composer-toolbar flex items-center justify-between w-full">
              <div className="session-composer-policy flex items-center">
                <ComposerMenu
                  onImagesSelected={attachments.addPaths}
                  onFilesSelected={appendFileLinks}
                  onInsertMention={handleInsertMention}
                  actions={(close) => (
                    <>
                      <Button
                        type="button"
                        variant="ghost"
                        className="justify-start"
                        onClick={() => {
                          close();
                          setDrawing({ owner, id: "sketch" });
                        }}
                      >
                        <Pencil size={16} />
                        画草图
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        className="justify-start"
                        onClick={() => {
                          close();
                          composerDrafts.setExpanded(owner, true);
                        }}
                      >
                        <Code2 size={16} />
                        代码与长文编辑
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        className="justify-start"
                        onClick={() => {
                          close();
                          setCommandsOwner(owner);
                        }}
                      >
                        <Search size={16} />
                        快捷命令
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        className="justify-start"
                        disabled={!currentThreadId}
                        onClick={() => {
                          close();
                          setReviewOpen(true);
                        }}
                      >
                        <ClipboardCheck size={16} />
                        代码审查
                      </Button>
                      {hasContextUsage && (
                        <div className="session-composer-context">
                          <ContextWindowWidget />
                          <span>上下文使用量</span>
                        </div>
                      )}
                      {running && (
                        <>
                          <span className="session-composer-menu-label">
                            发送方式
                          </span>
                          <label className="session-send-preference">
                            默认
                            <select
                              aria-label="运行中发送方式"
                              value={preferences.mode}
                              onChange={(e) =>
                                preferences.setMode(
                                  e.target.value as "queue" | "steer",
                                )
                              }
                            >
                              <option value="queue">排队</option>
                              <option value="steer">引导</option>
                            </select>
                          </label>
                          {hasContent && (
                            <>
                              <Button
                                type="button"
                                variant="ghost"
                                className="justify-start"
                                disabled={sending || blocked || !currentTurnId}
                                onClick={() => {
                                  submitMode.current =
                                    preferences.mode === "queue"
                                      ? "steer"
                                      : "queue";
                                  formRef.current?.requestSubmit();
                                  close();
                                }}
                              >
                                <CornerDownRight size={16} />
                                {preferences.mode === "queue"
                                  ? "立即引导当前任务"
                                  : "将草稿加入队列"}
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                className="justify-start"
                                aria-label="停止并发送新请求"
                                disabled={
                                  sending ||
                                  stopping ||
                                  blocked ||
                                  !currentTurnId
                                }
                                onClick={() => {
                                  submitMode.current = "replace";
                                  formRef.current?.requestSubmit();
                                  close();
                                }}
                              >
                                <Square size={15} />
                                停止并发送当前草稿
                              </Button>
                            </>
                          )}
                        </>
                      )}
                      <span className="session-composer-menu-label">
                        附件与工具
                      </span>
                    </>
                  )}
                />
                <AccessModePopover compact />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="session-composer-expand"
                  aria-label="展开编辑"
                  onClick={() => composerDrafts.setExpanded(owner, true)}
                >
                  <Maximize2 size={18} />
                </Button>
              </div>
              <div className="session-composer-actions flex items-center gap-2">
                <AgentModelPanel trigger={<AgentModelTrigger compact />} />
                <span className="session-composer-desktop-voice">
                  <DictationButton
                    onTranscript={(text) => {
                      setInputValue(
                        inputValue ? `${inputValue} ${text}` : text,
                      );
                    }}
                  />
                </span>
                {running && (
                  <Button
                    type="button"
                    aria-label={stopping ? "正在停止" : "停止生成"}
                    onClick={requestStop}
                    disabled={stopping}
                    title={stopping ? "正在停止…" : "停止生成并暂停队列"}
                    variant="ghost"
                    size="icon"
                    className={`session-composer-stop ${hasContent ? "" : "is-primary"}`}
                  >
                    <Square className="w-4 h-4" />
                  </Button>
                )}
                {(!running || hasContent) && (
                  <Button
                    aria-label={
                      running
                        ? preferences.mode === "queue"
                          ? "排队消息"
                          : "引导当前任务"
                        : "发送消息"
                    }
                    title={
                      running
                        ? "Ctrl/Cmd+Shift+Enter 临时切换排队与引导"
                        : "发送消息"
                    }
                    type="submit"
                    disabled={
                      sending ||
                      blocked ||
                      !hasContent ||
                      (running &&
                        preferences.mode === "steer" &&
                        !currentTurnId)
                    }
                    size="icon"
                    className="session-composer-send"
                  >
                    {running ? (
                      <span aria-hidden="true">
                        {preferences.mode === "queue" ? "排队" : "引导"}
                      </span>
                    ) : (
                      <ArrowUp className="w-4 h-4" />
                    )}
                  </Button>
                )}
              </div>
            </ComposerToolbarProvider>
          </div>
        </div>
      </form>
      {running && hasContent && (
        <p className="session-composer-hint">
          {preferences.mode === "queue"
            ? "本轮结束后发送"
            : "发送将引导当前任务"}
          <span>
            Ctrl/⌘ Shift Enter {preferences.mode === "queue" ? "引导" : "排队"}
          </span>
        </p>
      )}
      {richDraft.expanded && (
        <ComposerSheet
          full
          title="展开编辑"
          description="返回会保留正文、上下文与代码；发送方式沿用当前设置。"
          onClose={() => composerDrafts.setExpanded(owner, false)}
          footer={
            <>
              <AccessModePopover compact />
              <AgentModelPanel trigger={<AgentModelTrigger compact />} />
              {running && (
                <Button
                  type="button"
                  aria-label="停止生成"
                  variant="ghost"
                  className="session-expanded-stop"
                  disabled={stopping}
                  onClick={requestStop}
                >
                  <Square size={18} />
                </Button>
              )}
              <Button
                type="button"
                className="session-v2-primary session-expanded-submit"
                disabled={sending || blocked || !hasContent}
                onClick={() => formRef.current?.requestSubmit()}
              >
                {running
                  ? preferences.mode === "queue"
                    ? "加入队列"
                    : "引导当前任务"
                  : "发送消息"}
              </Button>
            </>
          }
        >
          <div onPasteCapture={handlePaste}>
            <ContextAttachments
              owner={owner}
              images={attachments}
              onAnnotate={(item) => setDrawing({ owner, id: item.id })}
              onRestore={(text) => {
                const value = readDraft(owner).text;
                setInputValue(
                  insertAtSelection(
                    value,
                    expandedSelection.current.start,
                    expandedSelection.current.end,
                    text,
                  ),
                );
              }}
            />
            <RichDraftEditor
              value={inputValue}
              onSelection={(start, end) => {
                expandedSelection.current = { start, end };
              }}
              onChange={setInputValue}
              plain={richDraft.plain}
              onPlainChange={(plain) => composerDrafts.setPlain(owner, plain)}
            />
          </div>
        </ComposerSheet>
      )}
      {drawing?.owner === owner && (
        <DrawingEditor
          key={owner + ":" + drawing.id}
          owner={owner}
          item={attachments.attachments.find((a) => a.id === drawing.id)}
          attachments={attachments}
          onClose={() => setDrawing(null)}
        />
      )}
      {commandsOwner === owner && (
        <ComposerCommands
          onClose={() => setCommandsOwner(null)}
          onOpenDialog={setSlashDialog}
        />
      )}
      {(slashDialog === "model" || slashDialog === "effort") && (
        <ComposerSheet
          title="模型与思考强度"
          description="只影响新提交的消息；已排队消息保留原配置。"
          onClose={() => setSlashDialog(null)}
        >
          <ModelReasonSelector mode="panel" />
        </ComposerSheet>
      )}
      <SlashCommandDialogs
        open={slashDialog}
        onClose={() => setSlashDialog(null)}
      />
    </div>
  );
}
