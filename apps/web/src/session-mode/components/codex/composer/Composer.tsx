import { SubagentSummary } from "@session/features/subagents/SubagentSummary";
import { sessionDraftSubmissions } from "@session/features/subagents/submissions";
import { v4 as randomUUID } from "uuid";
import { mentionDrafts } from "@session/features/subagents/mentions";
import { AgentMentionPicker } from "@session/features/subagents/AgentMentionPicker";
import { BackgroundAgentSummary } from "@session/features/subagents/BackgroundAgentSummary";
import { pluginInputDrafts } from "@session/features/plugins/pluginInputs";
import type { NativeInputMention } from "@agent-orchestrator/shared";
import { useCodexThreadInput } from "@session/hooks/useCodexThreadInput";
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
import { Pencil, Code2, Search } from "lucide-react";
import {
  followupService,
  followupParameters,
} from "@session/services/followupService";
import { useCodexSendBlockReason } from "@session/hooks/useCodexSendBlockReason";
import { createSideChat } from "@session/services/conversationActions";
import { useFollowupSettingsStore } from "@session/stores/useFollowupSettingsStore";
import { FollowupQueueContent } from "./FollowupQueue";
import { useFollowups } from "@session/hooks/useFollowups";
import { ModelChangeNotice } from "./ModelChangeNotice";
import { ConversationMenu } from "./ConversationMenu";

import { useThreadModelStore } from "@session/stores/useThreadModelStore";
import { useQuestions } from "@session/features/async-questions/useQuestions";
import { useAsyncQuestionStore } from "@session/features/async-questions/store";
import { SideChatPanel } from "./SideChatPanel";
import { ReviewDialog } from "./ReviewDialog";
import { RunningTurnChanges } from "./RunningTurnChanges";
import { ComposerEnterSettings } from "./ComposerEnterSettings";
import { NativeComposerIcon } from "./NativeComposerIcon";
import { NativeModelSelector } from "./NativeModelSelector";
import { NativeAgentSettings } from "./NativeAgentSettings";
import { goalDrafts, useGoalDraft } from "./goalDrafts";
import {
  GoalConfirmation,
  ThreadGoalCard,
} from "@session/features/goals/ThreadGoalCard";
import { GoalIcon } from "@session/features/goals/GoalIcon";
import {
  goalStrings,
  goalTextFromPrompt,
} from "@session/features/goals/goalPresentation";
import {
  materializeGoalDraft,
  isGoalSubmissionUncertain,
} from "@session/features/goals/goalMaterialization";
import { appendGoalAnnouncement } from "@session/features/goals/goalTranscript";
import { cleanupRejectedGoal } from "@session/features/goals/goalCleanup";
import { threadGoalVersions } from "@session/services/threadGoalState";
import { useTranslation } from "react-i18next";
import { useThreadModelSettings } from "@session/hooks/useThreadModelSettings";
import { CloudTasksPanel } from "@session/features/codex-host/CloudTasksPanel";
import { CodexHostPanel } from "@session/features/codex-host/CodexHostPanel";
import "./composer-native.css";
import { NativeSubmitButton } from "./NativeSubmitButton";
import { nativeComposerPlaceholder } from "./nativeComposerPlaceholder";
import type { FollowupMode } from "@agent-orchestrator/shared";
import { useStopAction } from "../../common/useStopAction";
import { useTurnControl } from "../hooks/useTurnControl";
import {
  moveImageDraft,
  useImageAttachments,
} from "../../common/useImageAttachments";
import { useShallow } from "zustand/react/shallow";
import { toast } from "sonner";
import {
  Square,
  X,
  ListPlus,
  CornerDownRight,
  ClipboardCheck,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ThreadGoal } from "@session/bindings/v2";
import { useThreadGoal } from "@session/components/codex/hooks";
import { useCodexStore } from "@session/components/codex/stores";
import { ContextWindowWidget } from "@session/components/codex/widget";
import { deriveContextWindowUsage } from "@session/components/codex/widget/ContextWindowWidget";
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
import { shouldAutoFocusComposer } from "./composerFocus";
import { useComposerFileDrop } from "./composerDrop";
import { SlashCommandDialogs } from "./SlashCommandDialogs";
import { SlashCommandPopover } from "./SlashCommandsSelector";
import type { SlashDialog } from "./slashCommands";

interface ComposerProps {
  targetLabel?: React.ReactNode;
  overrideSend?: (text: string) => void;
  onAfterSend?: (threadId: string, text: string) => void;
}

export function Composer({
  overrideSend,
  onAfterSend,
  targetLabel,
}: ComposerProps) {
  const { i18n } = useTranslation();
  const goalLabels = goalStrings(i18n.language);
  const [goalReplacement, setGoalReplacement] = useState<{
    owner: string;
    goal: ThreadGoal;
    objective: string;
    submit: () => Promise<void>;
  } | null>(null);
  const preferences = useFollowupSettingsStore();
  const [reviewOpen, setReviewOpen] = useState(false);
  const [detailsOwner, setDetailsOwner] = useState<string | null>(null);

  const submitMode = useRef<FollowupMode | null>(null);
  const [deliveryNotice, setDeliveryNotice] = useState<{
    owner: string;
    text: string;
  } | null>(null);
  const [slashDialog, setSlashDialog] = useState<SlashDialog | null>(null);
  const { currentThreadId, inputFocusTrigger } = useCodexStore(
    useShallow((s) => ({
      currentThreadId: s.currentThreadId,
      inputFocusTrigger: s.inputFocusTrigger,
    })),
  );
  const cwd = useWorkspaceStore((s) => s.cwd);
  const owner = sessionDraftKey("codex", currentThreadId, cwd);
  const { enabled: goalEnabled, setEnabled: setGoalEnabled } =
    useGoalDraft(owner);
  const { collaborationMode, setCollaborationMode } =
    useThreadModelSettings(currentThreadId);
  useEffect(() => {
    if (activeDraftOwner() === owner)
      goalDrafts.migrateLegacy(owner, useCodexStore.getState().goalEnabled);
  }, [owner]);
  const { inputValue, setInputValue } = useSessionTextDraft(owner, "codex");
  useEffect(
    () => pluginInputDrafts.prune(owner, inputValue),
    [owner, inputValue],
  );
  const richDraft = useComposerDraft(owner);
  const contextStorageError = useComposerDraftStore((s) => s.error);
  const [pendingFiles, setPendingFiles] = useState<Record<string, number>>({});
  const [drawing, setDrawing] = useState<{ owner: string; id: string } | null>(
    null,
  );
  const [commandsOwner, setCommandsOwner] = useState<string | null>(null);
  const [hostOwner, setHostOwner] = useState<string | null>(null);
  const [cloudOwner, setCloudOwner] = useState<string | null>(null);
  const [modelOwner, setModelOwner] = useState<string | null>(null);
  useEffect(() => {
    setSlashDialog(null);
    setReviewOpen(false);
    setDetailsOwner(null);
    setHostOwner(null);
    setCloudOwner(null);
    setModelOwner(null);
    setGoalReplacement(null);
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
  const threadInput = useCodexThreadInput(currentThreadId);
  const nativeChild = useCodexStore((s) =>
    s.threads.find((t) => t.id === currentThreadId),
  );
  const hostCwd = nativeChild?.cwd ?? cwd;
  const directInputBlocked = threadInput.blocked;
  const fileDrop = useComposerFileDrop(owner, {
    addImages: attachments.addFiles,
    disabled: directInputBlocked || !!contextStorageError,
  });
  const queueSnapshot = useFollowups(currentThreadId);
  const accessBlock = useCodexSendBlockReason(
    currentThreadId,
    queueSnapshot.state.items.some((item) => item.status === "uncertain"),
  );
  const blocked =
    !!accessBlock ||
    directInputBlocked ||
    attachments.blocked ||
    !!contextStorageError ||
    !!pendingFiles[owner] ||
    fileDrop.pending;
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
        id: randomUUID(),
        kind: "paste",
        name: "粘贴的文本",
        text,
      });
    }
  };
  const [sendingOwners, setSendingOwners] = useState<Record<string, boolean>>(
    {},
  );
  const sendingRef = useRef(sessionDraftSubmissions);
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
  // Native snapshots and ordered notifications own the saved goal; draft mode
  // only controls the next submission, never its status or budget.
  const threadGoal = useThreadGoal();
  const hasContextUsage = useCodexStore(
    (s) =>
      !!currentThreadId &&
      deriveContextWindowUsage(s.tokenUsageMap[currentThreadId]) !== null,
  );

  const editorRef = useRef<ComposerEditorHandle>(null);
  const expandedSelection = useRef({
    start: inputValue.length,
    end: inputValue.length,
  });
  const wrapperRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  // Desktop keeps the previous refocus behaviour. On touch devices, changing
  // tabs must not summon the soft keyboard; the user can focus the editor by
  // tapping it explicitly.
  useEffect(() => {
    if (!shouldAutoFocusComposer()) return;
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
    const submittedGoal = goalDrafts.read(owner);
    const goalCheckpoint = threadGoalVersions.capture(currentThreadId ?? "");
    let goalClearingOwner = owner;
    const goalCommand = goalTextFromPrompt(inputValue);
    const creatingGoal = submittedGoal.enabled || goalCommand !== null;
    const text = goalCommand ?? inputValue.trim();
    const submittedContexts = richDraft.contexts;
    const submittedMentions = mentionDrafts.read(owner);
    const submittedPluginMentions = pluginInputDrafts.read(owner, text);
    const completeText = composeContextText(text, submittedContexts);
    if (goalCommand === "" && !submittedContexts.length && !images.length) {
      setCollaborationMode("default");
      setGoalEnabled(true);
      setInputValue("");
      editorRef.current?.focus();
      return;
    }
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
      mentionDrafts.clear(submittedOwner, submittedMentions);
      pluginInputDrafts.clear(submittedOwner, submittedPluginMentions);
      if (unchanged) composerDrafts.setExpanded(submittedOwner, false);
    };
    const markSending = (key: string, value: boolean) => {
      if (value) sendingRef.current.add(key);
      else sendingRef.current.delete(key);
      setSendingOwners((previous) => ({ ...previous, [key]: value }));
    };
    const finishGoalDraft = () => {
      goalDrafts.complete(goalClearingOwner, submittedGoal);
      clearSubmitted();
      attachments.clear(submittedIds);
    };
    const submitCaptured = async () => {
      if (sendingRef.current.has(owner)) return;
      markSending(owner, true);
      let materialized: Awaited<
        ReturnType<typeof materializeGoalDraft>
      > | null = null;
      let goalRequestStarted = false;
      let firstGoalTurnAccepted = false;
      try {
        if (
          !creatingGoal &&
          running &&
          requestedMode !== "queue" &&
          !currentTurnId
        )
          throw new Error("正在同步当前任务，请稍后引导或停止");
        if (overrideSend) {
          overrideSend(completeText);
          clearSubmitted();
          return;
        }
        if (creatingGoal) {
          if (currentThreadId)
            codexService.assertThreadGoalReady(currentThreadId);
          materialized = await materializeGoalDraft({
            objective: composeContextText(
              text,
              submittedContexts.filter((context) => context.kind !== "paste"),
            ),
            pastedTexts: submittedContexts
              .filter((context) => context.kind === "paste")
              .map((context) => context.text),
            images: [...images],
            mentions: [...submittedMentions, ...submittedPluginMentions],
          });
          if (!threadGoalVersions.sameRuntime(goalCheckpoint))
            throw new Error("连接目标已切换，请核对目标草稿后重试");
        }
        let targetThreadId = currentThreadId;
        const newGoalThread = !targetThreadId && creatingGoal;
        if (!targetThreadId) {
          const thread = await codexService.threadStart({
            shouldActivate: () => activeDraftOwner() === owner,
          });
          targetThreadId = thread.id;
          parameters.cwd = thread.cwd ?? cwd;
          submittedOwner = sessionDraftKey("codex", thread.id);
          markSending(submittedOwner, true);
          useSessionDraftStore.getState().move(owner, submittedOwner);
          if (goalDrafts.move(owner, submittedOwner))
            goalClearingOwner = submittedOwner;
          composerDrafts.move(owner, submittedOwner);
          mentionDrafts.move(owner, submittedOwner);
          pluginInputDrafts.move(owner, submittedOwner);
          // Follow the newly created identity before moving attachments, so a storage failure
          // leaves a visible retry destination instead of creating a second session.
          useSessionNameStore
            .getState()
            .initializeName("codex", thread.id, text);
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
        if (materialized) {
          if (!threadGoalVersions.sameRuntime(goalCheckpoint))
            throw new Error("连接目标已切换，请核对目标草稿后重试");
          if (currentThreadId) {
            const currentGoal =
              useCodexStore.getState().goalMap[currentThreadId];
            if (
              currentGoal?.objective !== threadGoal?.objective ||
              currentGoal?.status !== threadGoal?.status ||
              currentGoal?.createdAt !== threadGoal?.createdAt
            )
              throw new Error("目标状态已更新，请核对后再替换");
          }
          goalRequestStarted = true;
          if (newGoalThread) {
            // The native first submission is a /goal turn. Only its accepted
            // receipt enables the saved goal; existing chats only need GoalSet.
            await codexService.turnStart(
              targetThreadId,
              `/goal ${materialized.objective}`,
              [],
              randomUUID(),
              undefined,
              parameters,
            );
            firstGoalTurnAccepted = true;
            // The first /goal message is already accepted even if the later
            // metadata write fails. Clear only that captured draft and keep files.
            finishGoalDraft();
          }
          if (!threadGoalVersions.sameRuntime(goalCheckpoint))
            throw new Error("连接目标已切换，请核对原连接的目标状态");
          const receipt = await codexService.threadGoalSet({
            threadId: targetThreadId,
            objective: materialized.objective,
            status: "active",
          });
          if (!newGoalThread && receipt.goal) {
            const state = useCodexStore.getState();
            appendGoalAnnouncement({
              threadId: targetThreadId,
              goal: receipt.goal,
              source: "existing-thread-goal-set",
              afterTurnId:
                state.turnTimingMap[targetThreadId]?.turnId ??
                state.threads
                  .find((thread) => thread.id === targetThreadId)
                  ?.turns.at(-1)?.id ??
                null,
            });
          }
          materialized = null;
          if (!firstGoalTurnAccepted) finishGoalDraft();
          return;
        }
        // Continuing an existing session never replaces its name with this message.
        if (activeDraftOwner() === submittedOwner)
          setCurrentAgentCardId(targetThreadId, "codex");
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
          [...submittedMentions, ...submittedPluginMentions],
        );
        onAfterSend?.(targetThreadId, text);
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
        if (
          materialized &&
          !firstGoalTurnAccepted &&
          (!goalRequestStarted || !isGoalSubmissionUncertain(error))
        )
          await cleanupRejectedGoal(materialized, goalLabels);
        if (creatingGoal)
          toast.error(
            goalRequestStarted
              ? goalLabels.setError
              : goalLabels.materializeError,
            {
              description: error instanceof Error ? error.message : undefined,
            },
          );
        else
          toast.error(
            error instanceof Error
              ? error.message
              : "发送失败，输入已保留，请重试",
          );
      } finally {
        markSending(owner, false);
        if (submittedOwner !== owner) markSending(submittedOwner, false);
      }
    };
    if (
      creatingGoal &&
      threadGoal &&
      (threadGoal.objective !== completeText ||
        images.length ||
        submittedContexts.some((context) => context.kind === "paste"))
    ) {
      setGoalReplacement({
        owner,
        goal: threadGoal,
        objective: completeText,
        submit: submitCaptured,
      });
      return;
    }
    await submitCaptured();
  };

  // Append a `$mention` (optionally followed by a starter prompt) from the plus
  // menu. The editor turns the known mention text back into a chip via its
  // external-value sync, so this only has to deal with plain strings.
  const handleInsertMention = (text: string, mention?: NativeInputMention) => {
    if (mention) pluginInputDrafts.add(owner, mention);
    const separator = !inputValue || /\s$/.test(inputValue) ? "" : " ";
    setInputValue(`${inputValue}${separator}${text} `);
    editorRef.current?.focus();
  };

  const queued = queueSnapshot.state.items.filter(
    (m) => m.status !== "sent" && m.status !== "cancelled",
  );
  const modelEntry = useThreadModelStore((s) =>
    currentThreadId ? s.threads[currentThreadId] : undefined,
  );
  const { questions, pending: pendingQuestions } = useQuestions(
    currentThreadId ?? "",
  );
  const failedImage = attachments.attachments.find((a) => a.status === "error");
  const uploading = attachments.attachments.filter(
    (a) => a.status === "uploading",
  ).length;
  const statusText = accessBlock
    ? accessBlock
    : threadInput.reason
      ? threadInput.reason
      : contextStorageError
        ? "上下文保存失败，打开状态面板重试"
        : attachments.storageError
          ? "附件草稿保存失败，打开状态面板重试"
          : !attachments.hydrated
            ? "正在恢复附件草稿…"
            : failedImage
              ? "图片上传失败，点击缩略图重试"
              : pendingFiles[owner] || fileDrop.pending
                ? "正在读取文件快照…"
                : uploading
                  ? `正在上传 ${uploading} 张图片…`
                  : pendingQuestions.length
                    ? "正在等待你的回答"
                    : queued.some(
                          (m) =>
                            m.status === "failed" || m.status === "uncertain",
                        )
                      ? "队列有消息需要处理"
                      : queueSnapshot.error
                        ? "队列连接暂不可用，正在重试"
                        : queued.length || queueSnapshot.state.paused
                          ? `待发送 ${queued.length} 条${queueSnapshot.state.paused ? " · 已暂停" : ""}`
                          : modelEntry?.notice && !modelEntry.notice.dismissed
                            ? `模型已从 ${modelEntry.notice.from} 更改为 ${modelEntry.notice.to}。`
                            : collaborationMode === "plan"
                              ? "规划模式"
                              : goalEnabled
                                ? "目标草稿"
                                : threadGoal
                                  ? goalLabels.status[threadGoal.status]
                                  : running
                                    ? hasContent
                                      ? preferences.mode === "queue"
                                        ? "本轮结束后发送"
                                        : "发送将引导当前任务"
                                      : "运行中"
                                    : "";
  return (
    <div
      className="session-codex-composer session-compact-composer session-native-composer"
      data-owner-thread={currentThreadId ?? undefined}
      data-draft-owner={owner}
    >
      <div
        className="session-composer-floating"
        aria-label="会话提示与待发送消息"
      >
        <RunningTurnChanges threadId={currentThreadId} />
        {pendingQuestions.length > 0 && (
          <button
            type="button"
            className="session-async-notice"
            aria-label={`回答问题 · ${pendingQuestions.length}`}
            onClick={() => {
              const first = pendingQuestions[0];
              useAsyncQuestionStore.getState().open(
                currentThreadId!,
                questions.filter((q) => q.sourceId === first.sourceId),
                first.id,
              );
            }}
          >
            <span>正在等待你的回答</span>
          </button>
        )}

        {currentThreadId && <ModelChangeNotice threadId={currentThreadId} />}
        <FollowupQueueContent
          compactShelf
          snapshot={queueSnapshot}
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
      </div>
      {deliveryNotice?.owner === owner && (
        <p role="status" className="sr-only">
          {deliveryNotice.text}
        </p>
      )}
      <SideChatPanel />
      {goalReplacement?.owner === owner && (
        <GoalConfirmation
          kind="replace"
          goal={goalReplacement.goal}
          objective={goalReplacement.objective}
          onCancel={() => setGoalReplacement(null)}
          onConfirm={() => {
            const replacement = goalReplacement;
            setGoalReplacement(null);
            const current =
              useCodexStore.getState().goalMap[replacement.goal.threadId];
            if (
              !current ||
              current.objective !== replacement.goal.objective ||
              current.status !== replacement.goal.status ||
              current.createdAt !== replacement.goal.createdAt
            ) {
              toast.error("目标状态已更新，请核对后再替换");
              return;
            }
            void replacement.submit();
          }}
        />
      )}
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
        onDragOverCapture={fileDrop.onDragOver}
        onDragLeaveCapture={fileDrop.onDragLeave}
        onDropCapture={fileDrop.onDrop}
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

        {threadGoal && (
          <ThreadGoalCard
            key={threadGoal.threadId}
            goal={threadGoal}
            disabled={!!accessBlock || threadInput.blocked || sending}
            blockedReason={accessBlock ?? threadInput.reason ?? undefined}
          />
        )}

        <div
          data-composer-suggestion-anchor
          data-composer-layout="multiline"
          data-composer-radius-variant="default"
          data-composer-density="default"
          data-composer-surface-variant="default"
          data-file-drop-active={fileDrop.active || undefined}
          className="session-composer-surface session-compact-frame"
          data-has-thread-goal={!!threadGoal || undefined}
        >
          {fileDrop.active && (
            <div className="session-composer-drop-hint" role="status">
              松开以添加附件
            </div>
          )}
          <div className="session-compact-body">
            <div ref={wrapperRef} className="session-native-editor-slot">
              <ComposerEditor
                owner={owner}
                key={owner}
                ref={editorRef}
                value={inputValue}
                onChange={setInputValue}
                onSubmit={handleEditorSubmit}
                placeholder={nativeComposerPlaceholder({
                  goal: goalEnabled,
                  plan: collaborationMode === "plan",
                  threadId: currentThreadId,
                })}
              />
            </div>

            <ContextAttachments
              compact
              key={owner}
              owner={owner}
              images={attachments}
              onAnnotate={(item) => setDrawing({ owner, id: item.id })}
              onRestore={(text) => editorRef.current?.insertText(text)}
            />
          </div>
          <div className="session-composer-bottom">
            <ComposerToolbarProvider className="session-composer-toolbar flex items-center justify-between w-full">
              <div className="session-composer-policy flex items-center">
                <ComposerMenu
                  owner={owner}
                  onImageFilesSelected={attachments.addFiles}
                  onImagesSelected={attachments.addPaths}
                  onFilesSelected={appendFileLinks}
                  onInsertMention={handleInsertMention}
                  onGoal={() => {
                    setCollaborationMode("default");
                    setGoalEnabled(true);
                    editorRef.current?.focus();
                  }}
                  actions={(close) => (
                    <>
                      <Button
                        type="button"
                        variant="ghost"
                        className="justify-start"
                        onClick={() => {
                          close();
                          setModelOwner(owner);
                        }}
                      >
                        <NativeComposerIcon name="chat" />
                        模型与提供商设置
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        className="justify-start"
                        onClick={() => {
                          close();
                          setCloudOwner(owner);
                        }}
                      >
                        <NativeComposerIcon name="chat" />
                        Codex 云任务
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        className="justify-start"
                        onClick={() => {
                          close();
                          setHostOwner(owner);
                        }}
                      >
                        <Code2 size={16} />
                        VS Code 上下文
                      </Button>
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
                      <Button
                        type="button"
                        variant="ghost"
                        className="justify-start"
                        onClick={() => {
                          close();
                          composerDrafts.setExpanded(owner, true);
                        }}
                      >
                        <NativeComposerIcon
                          name="expand"
                          width={16}
                          height={16}
                        />
                        展开编辑
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        className="justify-start"
                        onClick={() => {
                          close();
                          setDetailsOwner(owner);
                        }}
                      >
                        <ListPlus size={16} />
                        输入状态与消息队列
                      </Button>
                      <ConversationMenu
                        threadId={currentThreadId}
                        draftOwner={owner}
                        title="当前会话"
                        variant="item"
                      />
                      <AgentMentionPicker
                        root={currentThreadId}
                        owner={owner}
                      />
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
                {goalEnabled ? (
                  <button
                    type="button"
                    className="session-goal-draft"
                    aria-label={goalLabels.cancelDraft}
                    onClick={() => setGoalEnabled(false)}
                  >
                    <span className="session-goal-draft-symbol">
                      <GoalIcon name="draft-target" />
                      <GoalIcon name="draft-circle-xmark" />
                    </span>
                    <span>{goalLabels.draft}</span>
                  </button>
                ) : (
                  <AccessModePopover compact threadId={currentThreadId} />
                )}
                <SubagentSummary root={currentThreadId} />
              </div>
              <div className="session-composer-actions flex items-center gap-2">
                <NativeModelSelector
                  threadId={currentThreadId}
                  draftOwner={owner}
                />
                <span className="session-native-dictation">
                  <NativeComposerIcon name="microphone" />
                  <DictationButton
                    key={owner}
                    onTranscript={(text) => {
                      const value = readDraft(owner).text;
                      useSessionDraftStore
                        .getState()
                        .setText(owner, value ? `${value} ${text}` : text);
                    }}
                  />
                </span>
                {running && (
                  <NativeSubmitButton
                    type="button"
                    aria-label={stopping ? "正在停止" : "停止生成"}
                    onClick={requestStop}
                    disabled={stopping}
                    loading={stopping}
                    title={stopping ? "正在停止…" : "停止生成"}
                    variant="ghost"
                    size="icon"
                    className="session-composer-stop is-primary"
                  >
                    <NativeComposerIcon name="stop" />
                  </NativeSubmitButton>
                )}
                {(!running || hasContent) && (
                  <NativeSubmitButton
                    aria-label="发送消息"
                    title="发送消息"
                    type="submit"
                    loading={sending}
                    disabled={sending || blocked || !hasContent}
                    size="icon"
                    className="session-composer-send"
                  >
                    <NativeComposerIcon name="send" />
                  </NativeSubmitButton>
                )}
              </div>
            </ComposerToolbarProvider>
          </div>
        </div>
      </form>
      {statusText && (
        <span
          className="session-native-composer-status"
          role={
            contextStorageError || attachments.storageError || failedImage
              ? "alert"
              : "status"
          }
          title={statusText}
        >
          {statusText}
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
      )}
      {detailsOwner === owner && (
        <ComposerSheet
          title="输入状态与消息队列"
          description="查看本会话的发送配置、状态及待发送消息。"
          onClose={() => {
            setDetailsOwner(null);
            editorRef.current?.focus();
          }}
        >
          <ComposerEnterSettings />
          {attachments.storageError && (
            <p role="alert">
              附件草稿保存失败：{attachments.storageError}
              <button type="button" onClick={attachments.retryStorage}>
                重试保存附件草稿
              </button>
            </p>
          )}
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

          {running && hasContent && (
            <p className="session-composer-hint">
              {preferences.mode === "queue"
                ? "本轮结束后发送"
                : "发送将引导当前任务"}
              <span>
                Ctrl/⌘ Shift Enter{" "}
                {preferences.mode === "queue" ? "引导" : "排队"}
              </span>
            </p>
          )}
          <FollowupQueueContent
            inlineDetails
            snapshot={queueSnapshot}
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

          <BackgroundAgentSummary threadId={currentThreadId} />
          {!statusText && <p>暂无待处理状态。</p>}
        </ComposerSheet>
      )}
      {hostOwner === owner && (
        <ComposerSheet
          title="VS Code 上下文"
          description="从本会话的编辑工作区添加活动文件和选区。"
          onClose={() => setHostOwner(null)}
        >
          {hostCwd ? (
            <CodexHostPanel
              owner={{
                cwd: hostCwd,
                threadId: currentThreadId,
                draftOwner: owner,
              }}
            />
          ) : (
            <p role="status">先选择本会话的项目，再连接编辑器上下文。</p>
          )}
        </ComposerSheet>
      )}
      {cloudOwner === owner && (
        <ComposerSheet
          title="Codex 云任务"
          description="检查当前账号与环境能力，再明确创建或委派任务。"
          onClose={() => setCloudOwner(null)}
        >
          {hostCwd ? (
            <CloudTasksPanel
              owner={{
                cwd: hostCwd,
                threadId: currentThreadId,
                draftOwner: owner,
              }}
            />
          ) : (
            <p role="status">先选择本会话项目，再使用云任务。</p>
          )}
        </ComposerSheet>
      )}
      {modelOwner === owner && (
        <ComposerSheet
          title="模型与提供商设置"
          onClose={() => setModelOwner(null)}
        >
          <NativeAgentSettings>
            <ModelReasonSelector mode="panel" threadId={currentThreadId} />
          </NativeAgentSettings>
        </ComposerSheet>
      )}
      {richDraft.expanded && (
        <ComposerSheet
          full
          title="展开编辑"
          description="返回会保留正文、上下文与代码；发送方式沿用当前设置。"
          onClose={() => composerDrafts.setExpanded(owner, false)}
          returnFocus={() => editorRef.current?.focus()}
          footer={
            <>
              <AccessModePopover compact threadId={currentThreadId} />
              <NativeModelSelector
                threadId={currentThreadId}
                draftOwner={owner}
              />
              {running && (
                <NativeSubmitButton
                  type="button"
                  aria-label={stopping ? "正在停止" : "停止生成"}
                  variant="ghost"
                  className="session-expanded-stop"
                  disabled={stopping}
                  loading={stopping}
                  onClick={requestStop}
                >
                  <NativeComposerIcon name="stop" />
                </NativeSubmitButton>
              )}
              <NativeSubmitButton
                type="button"
                className="session-v2-primary session-expanded-submit"
                disabled={sending || blocked || !hasContent}
                loading={sending}
                aria-label={
                  running
                    ? preferences.mode === "queue"
                      ? "加入队列"
                      : "引导当前任务"
                    : "发送消息"
                }
                onClick={() => formRef.current?.requestSubmit()}
              >
                {running
                  ? preferences.mode === "queue"
                    ? "加入队列"
                    : "引导当前任务"
                  : "发送消息"}
              </NativeSubmitButton>
            </>
          }
        >
          <div
            onPasteCapture={handlePaste}
            onDragOverCapture={fileDrop.onDragOver}
            onDragLeaveCapture={fileDrop.onDragLeave}
            onDropCapture={fileDrop.onDrop}
          >
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
