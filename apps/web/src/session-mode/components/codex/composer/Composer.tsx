import { useStopAction } from "../../common/useStopAction";
import { useTurnControl } from "../hooks/useTurnControl";
import {
  moveImageDraft,
  useImageAttachments,
} from "../../common/useImageAttachments";
import { ImageAttachmentStrip } from "../../common/ImageAttachmentStrip";
import { useShallow } from "zustand/react/shallow";
import { toast } from "sonner";
import { ArrowUp, Pause, Play, Square, Target, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ThreadGoal } from "@session/bindings/v2";
import { AgentModelPanel } from "@session/components/agent/AgentModelPanel";
import { AgentModelTrigger } from "@session/components/agent/AgentModelTrigger";
import { useThreadGoal } from "@session/components/codex/hooks";
import { useCodexStore } from "@session/components/codex/stores";
import { ContextWindowWidget } from "@session/components/codex/widget";
import { FileMentionPopover } from "@session/components/common";
import { Button } from "@session/components/ui/button";
import { fileSrc } from "@session/hooks/runtime";
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

export function Composer({ overrideSend, onAfterSend }: ComposerProps) {
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
  const appendFileLinks = useCallback(
    (paths: string[]) => {
      if (paths.length) appendDraft(owner, fileLinks(paths, cwd));
    },
    [owner, cwd],
  );
  const { addAgentCard, setCurrentAgentCardId } = useAgentCenterStore();
  const attachments = useImageAttachments(owner);
  const images = attachments.paths;
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
      await codexService.turnInterrupt(currentThreadId, currentTurnId);
    },
  );
  // Actual goal state for the current thread, driven by thread/goal/updated
  // (mirrors codex-rs/tui's GoalStatusIndicator, which is derived purely
  // from ThreadGoal.status rather than a local UI toggle).
  const threadGoal = useThreadGoal();

  const editorRef = useRef<ComposerEditorHandle>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refocus the composer whenever the thread switches or a focus request is raised
  useEffect(() => {
    editorRef.current?.focus();
  }, [currentThreadId, inputFocusTrigger]);

  const handleEditorSubmit = useCallback(() => {
    formRef.current?.requestSubmit();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = inputValue.trim();
    if (
      attachments.blocked ||
      sendingRef.current.has(owner) ||
      (!text && images.length === 0)
    )
      return;
    const submittedIds = attachments.attachments.map((a) => a.id);
    const snapshot = readDraft(owner);
    let submittedOwner = owner;
    const clearSubmitted = () =>
      useSessionDraftStore.getState().clearSubmitted(submittedOwner, snapshot);
    const markSending = (key: string, value: boolean) => {
      if (value) sendingRef.current.add(key);
      else sendingRef.current.delete(key);
      setSendingOwners((previous) => ({ ...previous, [key]: value }));
    };
    markSending(owner, true);
    try {
      if (running && currentThreadId && currentTurnId) {
        await codexService.turnSteer(
          currentThreadId,
          currentTurnId,
          text,
          images,
        );
        clearSubmitted();
        attachments.clear(submittedIds);
        return;
      }
      if (running) {
        toast.error("尚未获取当前任务，请稍后重试");
        return;
      }
      if (overrideSend) {
        overrideSend(text);
        clearSubmitted();
        return;
      }
      let targetThreadId = currentThreadId;
      if (!targetThreadId) {
        const thread = await codexService.threadStart({
          shouldActivate: () => activeDraftOwner() === owner,
        });
        targetThreadId = thread.id;
        submittedOwner = sessionDraftKey("codex", thread.id);
        markSending(submittedOwner, true);
        useSessionDraftStore.getState().move(owner, submittedOwner);
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
          objective: text,
        });
        setGoalEnabled(false);
        clearSubmitted();
        return;
      }
      // Continuing an existing session never replaces its name with this message.
      if (activeDraftOwner() === submittedOwner)
        setCurrentAgentCardId(targetThreadId, "codex");
      onAfterSend?.(targetThreadId, text);
      await codexService.turnStart(targetThreadId, text, images);
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
    <div>
      <form
        ref={formRef}
        onSubmit={handleSubmit}
        onPasteCapture={attachments.onPaste}
        className="pb-[env(safe-area-inset-bottom)] bg-background"
      >
        <FileMentionPopover
          input={inputValue}
          setInput={setInputValue}
          editorRef={editorRef}
          triggerElement={wrapperRef.current}
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
          className="max-w-3xl mx-2 sm:mx-auto border rounded-xl bg-background shadow-sm focus-within:ring-1 focus-within:ring-ring transition-all overflow-hidden"
        >
          <ImageAttachmentStrip draft={attachments} />

          <div ref={wrapperRef} className="max-h-64 overflow-y-auto px-3 pt-3">
            <ComposerEditor
              key={owner}
              ref={editorRef}
              value={inputValue}
              onChange={setInputValue}
              onSubmit={handleEditorSubmit}
              placeholder={
                goalEnabled ? "输入目标…" : "描述你想完成的任务… / $ @"
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

          <div className="flex items-center justify-between px-1 bg-muted/20 border-t">
            <ComposerToolbarProvider className="session-composer-toolbar flex items-center justify-between w-full">
              <div className="session-composer-policy flex items-center">
                <ComposerMenu
                  onImagesSelected={attachments.addPaths}
                  onFilesSelected={appendFileLinks}
                  onInsertMention={handleInsertMention}
                />
                <AccessModePopover />
                {/* Draft mode: entering a new goal, not yet set on the thread. */}
                {goalEnabled && !threadGoal && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setGoalEnabled(false)}
                    title="Cancel goal draft"
                    className="group relative ml-1 h-8 w-8 text-blue-600 hover:bg-blue-50"
                  >
                    {/* Target Icon: Visible by default, shrinks/fades on hover */}
                    <Target className="h-4 w-4 transition-all duration-200 group-hover:scale-0 group-hover:opacity-0" />

                    {/* X Icon: Hidden by default, grows/fades in on hover */}
                    <X className="absolute h-4 w-4 scale-0 opacity-0 transition-all duration-200 group-hover:scale-100 group-hover:opacity-100" />
                  </Button>
                )}
                {/* A goal is actually set on the thread: allow pause/resume and clear
                    based on its real status, matching /goal pause|resume|clear in the TUI. */}
                {threadGoal && (
                  <>
                    {(threadGoal.status === "active" ||
                      threadGoal.status === "paused") && (
                      <Button
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
              <div className="session-composer-actions flex items-center gap-2">
                <ContextWindowWidget />
                <AgentModelPanel trigger={<AgentModelTrigger />} />
                <DictationButton
                  onTranscript={(text) => {
                    setInputValue(inputValue ? `${inputValue} ${text}` : text);
                  }}
                />
                {running ? (
                  <Button
                    aria-label={stopping ? "正在停止" : "停止生成"}
                    onClick={requestStop}
                    disabled={stopping}
                    title={stopping ? "正在停止…" : "停止生成"}
                    variant="destructive"
                    size="icon"
                    className="h-10 w-10 md:h-8 md:w-8 rounded-full"
                  >
                    <Square className="w-4 h-4" />
                  </Button>
                ) : (
                  <Button
                    aria-label="发送消息"
                    type="submit"
                    disabled={
                      sending ||
                      attachments.blocked ||
                      (!inputValue.trim() && images.length === 0)
                    }
                    size="icon"
                    className="h-10 w-10 md:h-8 md:w-8 rounded-full"
                  >
                    <ArrowUp className="w-4 h-4" />
                  </Button>
                )}
              </div>
            </ComposerToolbarProvider>
          </div>
        </div>
      </form>
      <SlashCommandDialogs
        open={slashDialog}
        onClose={() => setSlashDialog(null)}
      />
    </div>
  );
}
