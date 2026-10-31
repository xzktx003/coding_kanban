import { SubagentSummary } from "@session/features/subagents/SubagentSummary";
import { sessionDraftSubmissions } from "@session/features/subagents/submissions";
import { v4 as randomUUID } from "uuid";
import { newSessionEditId } from "@session/services/sessionEditIdentity";
import { mentionDrafts } from "@session/features/subagents/mentions";
import { AgentMentionPicker } from "@session/features/subagents/AgentMentionPicker";
import { BackgroundAgentSummary } from "@session/features/subagents/BackgroundAgentSummary";
import { pluginInputDrafts } from "@session/features/plugins/pluginInputs";
import type { NativeInputMention } from "@agent-orchestrator/shared";
import { useCodexThreadInput } from "@session/hooks/useCodexThreadInput";
import { composeContextText } from "@agent-orchestrator/shared/composer-context";
import {
  composerDrafts,
  useComposerDraft,
  useComposerDraftStatus,
} from "./v2/drafts";
import { ContextAttachments, addFileContexts } from "./v2/ContextAttachments";
import { ComposerSheet } from "./v2/ComposerSheet";
import { ComposerCommands } from "./v2/ComposerCommands";
import { isLargePaste, insertAtSelection } from "./v2/content";
import { Pencil, Code2, Search } from "lucide-react";
import {
  followupService,
  followupParameters,
} from "@session/services/followupService";
import { useCodexSendBlockReason } from "@session/hooks/useCodexSendBlockReason";
import { createSideChat } from "@session/services/conversationActions";
import { useFollowupSettingsStore } from "@session/stores/useFollowupSettingsStore";
import { DeferredFollowupQueueContent as FollowupQueueContent } from "./DeferredFollowupQueue";
import { hasVisibleFollowupQueue } from "./followupQueueState";
import { ComposerRail, ComposerRailItem } from "./ComposerRail";
import { useFollowups } from "@session/hooks/useFollowups";
import { ModelChangeNotice } from "./ModelChangeNotice";
import { DeferredConversationMenu as ConversationMenu } from "./DeferredConversationMenu";

import { useQuestions } from "@session/features/async-questions/useQuestions";
import { useAsyncQuestionStore } from "@session/features/async-questions/store";
import { DeferredSideChatPanel } from "./DeferredSideChatPanel";
import { RunningTurnChanges } from "./RunningTurnChanges";
import { ComposerEnterSettings } from "./ComposerEnterSettings";
import { NativeComposerIcon } from "./NativeComposerIcon";
import { DeferredNativeModelSelector as NativeModelSelector } from "./DeferredNativeModelSelector";
import { DeferredComposerPanel } from "./DeferredComposerPanel";
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
import {
  captureThreadModelSelection,
  flushThreadModelSettings,
} from "@session/stores/useThreadModelStore";
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
import { lazy, useCallback, useEffect, useRef, useState } from "react";
import type { ThreadGoal } from "@session/bindings/v2";
import { useThreadGoal } from "@session/components/codex/hooks/useThreadGoal";
import { useCodexStore } from "@session/components/codex/stores/useCodexStore";
import { ContextWindowWidget } from "@session/components/codex/widget/ContextWindowWidget";
import { deriveContextWindowUsage } from "@session/components/codex/widget/ContextWindowWidget";
import { FileMentionPopover } from "@session/components/common/FileMentionPopover";
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
import { ComposerMenu, type ComposerMenuProps } from "./ComposerMenu";
import { ComposerToolbarProvider } from "./ComposerToolbarContext";
import { DictationButton } from "./DictationButton";
import {
  ComposerEditor,
  type ComposerEditorHandle,
} from "./editor/ComposerEditor";
import { scheduleComposerAutoFocus } from "./composerFocus";
import { useComposerFileDrop } from "./composerDrop";
import { SlashCommandDialogs } from "./SlashCommandDialogs";
import { SlashCommandPopover } from "./SlashCommandsSelector";
import type { SlashDialog } from "./slashCommands";
import { matchesSessionShortcut } from "@session/services/sessionKeyboardShortcuts";
import { isSessionInteractionVisible } from "@session/session-dom";
import { composerPrimaryAction, hasPendingComposerInput } from "./composerPrimaryAction";
import { type BrowserDictationControl, type BrowserDictationPhase } from "@session/BrowserDictationButton";
import { resumeInterruptedTurn, savedResumeReceipt, reconcileResumeReceipt, type ResumeReceipt } from "@session/services/resumeInterruptedTurn";
import { captureCodexOperationScope, isCodexOperationScopeCurrent } from "@session/services/codexOperationScope";
import { NativeQueueSettingsNotice } from "./NativeQueueSettingsNotice";
import { ExecutionLocationPicker } from "@session/features/workspace-execution/ExecutionLocationPicker";
import { RealtimeVoiceButton, type RealtimeVoiceControl } from "@session/features/realtime-voice/RealtimeVoiceButton";
import type { VoicePhase } from "@session/features/realtime-voice/controller";

const DrawingEditor = lazy(() => import("./v2/DrawingEditor").then((module) => ({ default: module.DrawingEditor })));
const RichDraftEditor = lazy(() => import("./v2/RichDraftEditor").then((module) => ({ default: module.RichDraftEditor })));
const ModelReasonSelector = lazy(() => import("./ModelReasonSelector").then((module) => ({ default: module.ModelReasonSelector })));
const ReviewDialog = lazy(() => import("./ReviewDialog").then((module) => ({ default: module.ReviewDialog })));

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
  const [reviewOpen, setReviewOpenState] = useState(false);
  const reviewScope = useRef<ReturnType<typeof captureCodexOperationScope> | null>(null);
  const setReviewOpen = (open: boolean) => { if (open) reviewScope.current = captureCodexOperationScope(); setReviewOpenState(open); };
  const dictationControl = useRef<BrowserDictationControl | null>(null);
  const [dictationPhase, setDictationPhase] = useState<BrowserDictationPhase>("idle");
  const voiceControl = useRef<RealtimeVoiceControl | null>(null);
  const [voiceState, setVoiceState] = useState<{ owner: string; phase: VoicePhase } | null>(null);
  const [resuming, setResuming] = useState<Record<string, boolean>>({});
  const [resumeReceipts, setResumeReceipts] = useState<Record<string, ResumeReceipt>>({});
  const [detailsOwner, setDetailsOwner] = useState<string | null>(null);

  const submitMode = useRef<FollowupMode | null>(null);
  const [deliveryNotice, setDeliveryNotice] = useState<{
    owner: string;
    text: string;
    resume?: boolean;
  } | null>(null);
  const [slashRequest, setSlashRequest] = useState<{ dialog: SlashDialog; owner: string; scope: ReturnType<typeof captureCodexOperationScope> } | null>(null);
  const { currentThreadId, inputFocusTrigger } = useCodexStore(
    useShallow((s) => ({
      currentThreadId: s.currentThreadId,
      inputFocusTrigger: s.inputFocusTrigger,
    })),
  );
  const cwd = useWorkspaceStore((s) => s.cwd);
  const owner = sessionDraftKey("codex", currentThreadId, cwd);
  const voicePhase = voiceState?.owner === owner ? voiceState.phase : "idle";
  const handleVoicePhase = useCallback((phase: VoicePhase) => setVoiceState(previous => previous?.owner === owner && previous.phase === phase ? previous : { owner, phase }), [owner]);
  const slashDialog = slashRequest?.owner === owner ? slashRequest.dialog : null;
  const setSlashDialog = (dialog: SlashDialog | null) => setSlashRequest(dialog ? { dialog, owner, scope: captureCodexOperationScope() } : null);
  const { enabled: goalEnabled, setEnabled: setGoalEnabled } =
    useGoalDraft(owner);
  const { collaborationMode, setCollaborationMode, settingsStorage, settingsLoading, retrySettings } =
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
  const contextStatus = useComposerDraftStatus(owner);
  const contextStorageError = contextStatus.error;
  const contextBusy =
    contextStatus.phase === "hydrating" || contextStatus.phase === "saving";
  const [pendingFiles, setPendingFiles] = useState<Record<string, number>>({});
  const [drawing, setDrawing] = useState<{ owner: string; id: string } | null>(
    null,
  );
  const [commandsOwner, setCommandsOwner] = useState<string | null>(null);
  const [modelOwner, setModelOwner] = useState<string | null>(null);
  useEffect(() => {
    setSlashDialog(null);
    setReviewOpen(false);
    setDetailsOwner(null);
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
  const settingsError = settingsStorage?.error ?? (
    settingsStorage?.status === "conflict" ? "其他页面已更新会话设置，请核对后重试" :
    settingsStorage?.status === "error" ? "无法保存会话设置" : undefined
  );
  // An existing Goal only writes Goal metadata; model preferences are unrelated.
  const existingGoalOnly = !!currentThreadId && (goalEnabled || goalTextFromPrompt(inputValue) !== null);
  const settingsBlocked = settingsLoading || settingsStorage?.status === "error" || settingsStorage?.status === "conflict";
  const blocked =
    (settingsBlocked && !existingGoalOnly) ||
    !!accessBlock ||
    directInputBlocked ||
    attachments.blocked ||
    !!contextStorageError ||
    contextBusy ||
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
        id: newSessionEditId(),
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
  const submitLabel = running
    ? preferences.mode === "queue"
      ? "加入队列"
      : "引导当前任务"
    : "发送消息";
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
  const interruptedTurn = useCodexStore((state) => {
    if (!currentThreadId || state.threadStatusMap[currentThreadId]?.type !== "idle" || !state.historyLoadedMap[currentThreadId] || state.historyLoadingMap[currentThreadId] || state.historyErrorMap[currentThreadId]) return null;
    const timing = state.turnTimingMap[currentThreadId];
    return timing?.status === "interrupted" ? timing.turnId : null;
  });
  const resumeAvailable = !!interruptedTurn && !threadGoal && !goalEnabled && !hasPendingComposerInput(queueSnapshot.state.items);
  const resumeReceipt = resumeReceipts[owner];
  const resumeUnknown = resumeReceipt?.sourceTurnId === interruptedTurn && resumeReceipt.status === "unknown";
  const resumeAccepted = resumeReceipt?.sourceTurnId === interruptedTurn && resumeReceipt.status === "accepted";
  useEffect(() => {
    if (deliveryNotice?.owner === owner && deliveryNotice.resume && resumeReceipt?.status === "accepted" && (running || !interruptedTurn)) setDeliveryNotice(null);
  }, [owner, running, interruptedTurn, resumeReceipt, deliveryNotice]);
  const primary = composerPrimaryAction({ dictation: dictationPhase, realtime: voicePhase, running, hasContent, resumeAvailable, mode: preferences.mode });
  const voiceCanSend = !!inputValue.trim() && !images.length && !richDraft.contexts.length && !goalEnabled && !contextBusy && !pendingFiles[owner] && !fileDrop.pending && !attachments.blocked;
  const voiceAction = primary === "voice-send" || primary === "voice-end" || primary === "voice-wait";
  const voiceLabel = primary === "voice-send" ? "发送到语音对话" : primary === "voice-end" ? "结束语音对话" : "正在连接或结束语音";
  useEffect(() => {
    if (!currentThreadId || !interruptedTurn) return;
    let live = true;
    try {
      void savedResumeReceipt(currentThreadId, interruptedTurn).then((saved) => {
      if (live && saved) {
        setResumeReceipts((state) => ({ ...state, [owner]: saved }));
        if (saved.status === "unknown") void reconcileResumeReceipt(saved).then((result) => {
          if (live) setResumeReceipts((state) => ({ ...state, [owner]: result }));
        }).catch(() => {});
      }
      }).catch(() => {});
    } catch { /* Explicit Resume shows storage/scope errors; never auto-writes. */ }
    return () => { live = false; };
  }, [currentThreadId, interruptedTurn, owner]);
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
  const handleVoiceAction = async () => {
    if (voicePhase !== "active" || !voiceControl.current || sendingRef.current.has(owner)) return;
    const control = voiceControl.current;
    if (!hasContent) { await control.stop(); return; }
    if (!voiceCanSend) { setDeliveryNotice({ owner, text: "语音文字只支持正文；请先移除附件或结束语音，草稿已保留。" }); return; }
    const draft = readDraft(owner), scope = captureCodexOperationScope();
    if (draft.text.length > 200_000) { setDeliveryNotice({ owner, text: "语音文字最多 200,000 字符，草稿已保留。" }); return; }
    sendingRef.current.add(owner);
    setSendingOwners(previous => ({ ...previous, [owner]: true }));
    try {
      await control.sendText(draft.text.trim());
      if (!isCodexOperationScopeCurrent(scope)) return;
      useSessionDraftStore.getState().clearSubmitted(owner, draft);
      setDeliveryNotice({ owner, text: "已发送到语音对话" });
    } catch (error) { if (isCodexOperationScopeCurrent(scope)) setDeliveryNotice({ owner, text: error instanceof Error ? error.message : "语音文字结果待核对，草稿已保留。" }); }
    finally { sendingRef.current.delete(owner); setSendingOwners(previous => ({ ...previous, [owner]: false })); }
  };
  const handleResume = async () => {
    if (!currentThreadId || !interruptedTurn || !resumeAvailable || (!resumeUnknown && blocked) || resuming[owner] || sendingRef.current.has(owner)) return;
    const target = currentThreadId, source = interruptedTurn, capturedOwner = owner;
    const scope = captureCodexOperationScope();
    const selection = captureThreadModelSelection(target);
    setResuming((state) => ({ ...state, [capturedOwner]: true }));
    try {
      let result: ResumeReceipt;
      if (resumeUnknown && resumeReceipt) result = await reconcileResumeReceipt(resumeReceipt);
      else {
        const parameters = followupParameters(target, selection.settings);
        await flushThreadModelSettings(target, selection);
        if (!isCodexOperationScopeCurrent(scope)) throw new Error("账号或运行服务已变化，请重新确认继续操作");
        result = await resumeInterruptedTurn(target, source, parameters);
      }
      setResumeReceipts((state) => ({ ...state, [capturedOwner]: result }));
      setDeliveryNotice({ owner: capturedOwner, resume: true, text: result.status === "unknown" ? "继续任务的回执待核对；再次点击只核对状态，不会重发" : result.status === "rejected" ? result.error ?? "未能继续任务，请核对当前轮次" : "已接受继续任务，正在同步运行状态" });
    } catch (error) {
      setDeliveryNotice({ owner: capturedOwner, text: error instanceof Error ? error.message : "无法继续任务" });
    } finally { setResuming((state) => ({ ...state, [capturedOwner]: false })); }
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!isSessionInteractionVisible() || !matchesSessionShortcut(event, "focus")) return;
      const target = event.target;
      if (target instanceof Element && target.closest('[role="dialog"], [role="alertdialog"], .session-rich-draft, .session-files-editor')) return;
      // Only the current public composer owns this command, never a retained
      // hidden surface or another window's draft.
      if (activeDraftOwner() !== owner || !wrapperRef.current?.isConnected) return;
      event.preventDefault();
      event.stopPropagation();
      editorRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [owner]);
  const renderConversationMenu = useCallback<
    NonNullable<ComposerMenuProps["persistentMenu"]>
  >(
    ({ triggerContainer, close, parentMenuId }) => (
      <ConversationMenu
        threadId={currentThreadId}
        draftOwner={owner}
        composerRef={formRef}
        title="当前会话"
        variant="item"
        triggerContainer={triggerContainer}
        onActionSelected={close}
        parentMenuId={parentMenuId}
        ownsGlobalShortcuts
      />
    ),
    [currentThreadId, owner],
  );

  // Desktop keeps the previous refocus behaviour. On touch devices, changing
  // tabs must not summon the soft keyboard; the user can focus the editor by
  // tapping it explicitly.
  useEffect(
    () =>
      scheduleComposerAutoFocus(
        () =>
          wrapperRef.current?.querySelector<HTMLElement>(
            '[contenteditable="true"]',
          ) ?? null,
        () => editorRef.current?.focus(),
      ),
    [currentThreadId, inputFocusTrigger],
  );

  const handleEditorSubmit = useCallback((intent?: "default" | "opposite") => {
    const mode = useFollowupSettingsStore.getState().mode;
    submitMode.current =
      intent === "opposite" ? (mode === "queue" ? "steer" : "queue") : null;
    formRef.current?.requestSubmit();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (dictationPhase === "recording") { void dictationControl.current?.finishAndSend(); return; }
    if (dictationPhase === "starting" || dictationPhase === "transcribing") return;
    if (voicePhase === "active") { void handleVoiceAction(); return; }
    if (voicePhase === "starting" || voicePhase === "stopping") return;
    const submitter = (e.nativeEvent as SubmitEvent)
      .submitter as HTMLButtonElement | null;
    const requestedMode: FollowupMode =
      submitter?.value === "replace"
        ? "replace"
        : (submitMode.current ?? preferences.mode);
    submitMode.current = null;
    const capturedThreadStart = currentThreadId
      ? undefined
      : codexService.captureThreadStart();
    const submittedGoal = goalDrafts.read(owner);
    const goalCheckpoint = threadGoalVersions.capture(currentThreadId ?? "");
    let goalClearingOwner = owner;
    const goalCommand = goalTextFromPrompt(inputValue);
    const creatingGoal = submittedGoal.enabled || goalCommand !== null;
    const settingsCapture = currentThreadId && !creatingGoal ? captureThreadModelSelection(currentThreadId) : undefined;
    let parameters: Record<string, unknown> = {};
    try {
      // Existing GoalSet changes only metadata. Unrelated unsent permission
      // preferences must not couple it to a normal turn's parameter projection.
      if (!(currentThreadId && creatingGoal))
        parameters = followupParameters(currentThreadId ?? "", settingsCapture?.settings);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "会话权限尚未确认，草稿已保留");
      return;
    }
    const text = goalCommand ?? inputValue.trim();
    const capturedContexts = composerDrafts.capture(owner);
    const submittedContexts = capturedContexts.contexts;
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
      composerDrafts.clearSubmitted(
        submittedOwner,
        submittedContexts,
        capturedContexts.versions,
      );
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
        if (settingsCapture)
          await flushThreadModelSettings(settingsCapture.threadId, settingsCapture);
        await composerDrafts.flush(owner);
        const currentDraft = readDraft(owner);
        if (
          currentDraft.revision !== snapshot.revision ||
          currentDraft.writeId !== snapshot.writeId ||
          currentDraft.text !== snapshot.text ||
          !composerDrafts.matches(owner, capturedContexts)
        )
          throw new Error("草稿在保存期间已变化，请核对当前内容后再发送");
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
            captured: capturedThreadStart,
            shouldActivate: () => activeDraftOwner() === owner,
          });
          targetThreadId = thread.id;
          parameters.cwd = thread.cwd ?? cwd;
          submittedOwner = sessionDraftKey("codex", thread.id);
          markSending(submittedOwner, true);
          useSessionDraftStore.getState().move(owner, submittedOwner);
          if (goalDrafts.move(owner, submittedOwner))
            goalClearingOwner = submittedOwner;
          mentionDrafts.move(owner, submittedOwner);
          pluginInputDrafts.move(owner, submittedOwner);
          // Follow the newly created identity before moving persisted drafts, so a storage failure
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
          await composerDrafts.move(owner, submittedOwner);
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
          {
            revision: snapshot.revision,
            writeId: snapshot.writeId,
            attachmentIds: submittedIds,
            contextIds: submittedContexts.map((context) => context.id),
          },
          targetThreadId,
          text,
          images,
          running ? requestedMode : "queue",
          running ? (currentTurnId ?? undefined) : undefined,
          parameters,
          submittedContexts,
          [...submittedMentions, ...submittedPluginMentions],
          settingsCapture,
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
      : settingsError
        ? "会话设置保存失败，打开状态面板重试"
        : settingsLoading
          ? "正在恢复会话设置…"
      : contextStorageError
        ? "上下文保存失败，打开状态面板重试"
        : contextBusy
          ? contextStatus.phase === "hydrating"
            ? "正在恢复上下文草稿…"
            : "正在保存上下文草稿…"
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
      {currentThreadId && <ModelChangeNotice threadId={currentThreadId} />}
      <ComposerRail key={owner}>
        <RunningTurnChanges threadId={currentThreadId} />
        <ComposerRailItem visible={pendingQuestions.length > 0}>
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
        </ComposerRailItem>

        <ComposerRailItem
          visible={hasVisibleFollowupQueue(currentThreadId, queueSnapshot)}
        >
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
        </ComposerRailItem>
        <ComposerRailItem visible={!!threadGoal}>
          {threadGoal && (
            <ThreadGoalCard
              key={threadGoal.threadId}
              goal={threadGoal}
              disabled={!!accessBlock || threadInput.blocked || sending}
              blockedReason={accessBlock ?? threadInput.reason ?? undefined}
            />
          )}
        </ComposerRailItem>
      </ComposerRail>
      {currentThreadId && queueSnapshot.state.authority === "native" && queueSnapshot.state.items.some((item) => item.authority === "native" && item.status === "queued") && <NativeQueueSettingsNotice key={currentThreadId} threadId={currentThreadId} />}
      {deliveryNotice?.owner === owner && (
        <p role="status" className="session-composer-delivery-notice px-4 py-1 text-xs text-muted-foreground">
          {deliveryNotice.text}
        </p>
      )}
      <DeferredSideChatPanel />
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
        <DeferredComposerPanel label="代码审查" onClose={() => setReviewOpen(false)}>
        <ReviewDialog
          threadId={currentThreadId}
          onClose={() => setReviewOpen(false)}
          targetScope={reviewScope.current ?? undefined}
        />
        </DeferredComposerPanel>
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

        <div
          data-composer-suggestion-anchor
          data-composer-layout="multiline"
          data-composer-radius-variant="default"
          data-composer-density="default"
          data-composer-surface-variant="default"
          data-file-drop-active={fileDrop.active || undefined}
          className="session-composer-surface session-compact-frame"
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
                  persistentMenu={renderConversationMenu}
                  actions={(close, conversationTrigger) => (
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
                      {conversationTrigger}
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
                                aria-label={stopping ? "正在停止" : "停止生成"}
                                disabled={stopping}
                                onClick={() => {
                                  close();
                                  void requestStop();
                                }}
                              >
                                <NativeComposerIcon name="stop" />
                                {stopping ? "正在停止…" : "停止生成"}
                              </Button>
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
                  <AccessModePopover threadId={currentThreadId} />
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
                    controlRef={dictationControl}
                    onPhaseChange={setDictationPhase}
                    disabled={voicePhase === "active" || voicePhase === "starting" || voicePhase === "stopping"}
                    onTranscript={(text, intent) => {
                      const value = readDraft(owner).text;
                      useSessionDraftStore
                        .getState()
                        .setText(owner, value ? `${value} ${text}` : text);
                      if (intent?.send && activeDraftOwner() === owner) {
                        const submitted = readDraft(owner);
                        requestAnimationFrame(() => {
                          const current = readDraft(owner);
                          if (activeDraftOwner() === owner && current.revision === submitted.revision && current.text === submitted.text) formRef.current?.requestSubmit();
                        });
                      }
                    }}
                  />
                </span>
                {currentThreadId && <RealtimeVoiceButton key={owner} threadId={currentThreadId} owner={owner} controlRef={voiceControl} onPhaseChange={handleVoicePhase} onStarting={() => dictationControl.current?.cancel()} disabled={sending || !!resuming[owner]} />}
                {voiceAction && <NativeSubmitButton type="button" aria-label={voiceLabel} title={voiceLabel} disabled={sending || primary === "voice-wait" || (primary === "voice-send" && !voiceCanSend)} loading={sending || primary === "voice-wait"} onClick={() => void handleVoiceAction()} size="icon" className="session-composer-send"><NativeComposerIcon name={primary === "voice-end" ? "stop" : "send"} /></NativeSubmitButton>}
                {(primary === "dictation-finish" || primary === "dictation-wait") && (
                  <NativeSubmitButton type="button" aria-label={primary === "dictation-finish" ? "结束听写并发送" : "正在准备听写内容"} title="结束听写并发送" disabled={blocked || primary === "dictation-wait"} loading={primary === "dictation-wait"} onClick={() => void dictationControl.current?.finishAndSend()} size="icon" className="session-composer-send">
                    <NativeComposerIcon name="send" />
                  </NativeSubmitButton>
                )}
                {primary === "resume" && (
                  <NativeSubmitButton type="button" aria-label={resumeAccepted ? "正在同步任务状态" : resumeUnknown ? "核对继续任务状态" : "继续任务"} title={resumeUnknown ? "核对继续任务状态" : "继续任务"} disabled={(!resumeUnknown && blocked) || !!resuming[owner] || resumeAccepted} loading={!!resuming[owner]} onClick={() => void handleResume()} size="icon" className="session-composer-send">
                    <NativeComposerIcon name="send" />
                  </NativeSubmitButton>
                )}
                {primary === "stop" && (
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
                {(primary === "send" || primary === "queue" || primary === "steer") && (
                  <NativeSubmitButton
                    aria-label={submitLabel}
                    title={submitLabel}
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
      <div className="flex min-w-0 items-center px-1 pt-1">
        <ExecutionLocationPicker owner={owner} disabled={sending || !!resuming[owner]} />
        {currentThreadId && <span className="truncate text-[11px] text-muted-foreground">用于新会话</span>}
      </div>
      {statusText && (
        <span
          className="session-native-composer-status"
          role={
            settingsError || contextStorageError || attachments.storageError || failedImage
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
          {settingsError && (
            <p role="alert">
              会话设置保存失败：{settingsError}
              <button type="button" onClick={() => void retrySettings().catch((error) => toast.error(String(error)))}>
                重试保存会话设置
              </button>
            </p>
          )}
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
              <button
                type="button"
                onClick={() =>
                  void composerDrafts
                    .retryStorage()
                    .catch((error) => toast.error(String(error)))
                }
              >
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
      {modelOwner === owner && (
        <ComposerSheet
          title="模型与提供商设置"
          onClose={() => setModelOwner(null)}
        >
          <DeferredComposerPanel label="模型与提供商设置" onClose={() => setModelOwner(null)}><NativeAgentSettings>
            <ModelReasonSelector mode="panel" threadId={currentThreadId} />
          </NativeAgentSettings></DeferredComposerPanel>
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
              <AccessModePopover threadId={currentThreadId} />
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
                disabled={voiceAction ? sending || primary === "voice-wait" || (primary === "voice-send" && !voiceCanSend) : primary === "resume" ? ((!resumeUnknown && blocked) || !!resuming[owner] || resumeAccepted) : sending || blocked || primary === "dictation-wait" || (!hasContent && primary !== "dictation-finish")}
                loading={sending || !!resuming[owner] || primary === "dictation-wait"}
                aria-label={voiceAction ? voiceLabel : primary === "resume" ? (resumeUnknown ? "核对继续任务状态" : "继续任务") : primary === "dictation-finish" ? "结束听写并发送" : submitLabel}
                onClick={() => voiceAction ? void handleVoiceAction() : primary === "resume" ? void handleResume() : formRef.current?.requestSubmit()}
              >
                {voiceAction ? voiceLabel : primary === "resume" ? (resumeUnknown ? "核对继续任务状态" : "继续任务") : primary === "dictation-finish" ? "结束听写并发送" : submitLabel}
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
            <DeferredComposerPanel label="展开编辑器" onClose={() => composerDrafts.setExpanded(owner, false)}><RichDraftEditor
              value={inputValue}
              onSelection={(start, end) => {
                expandedSelection.current = { start, end };
              }}
              onChange={setInputValue}
              plain={richDraft.plain}
              onPlainChange={(plain) => composerDrafts.setPlain(owner, plain)}
            /></DeferredComposerPanel>
          </div>
        </ComposerSheet>
      )}
      {drawing?.owner === owner && (
        <DeferredComposerPanel label="绘图编辑" onClose={() => setDrawing(null)}>
        <DrawingEditor
          key={owner + ":" + drawing.id}
          owner={owner}
          item={attachments.attachments.find((a) => a.id === drawing.id)}
          attachments={attachments}
          onClose={() => setDrawing(null)}
        />
        </DeferredComposerPanel>
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
          description="保存下次发送选择；原生待发队列使用线程当前设置，可在队列旁显式应用。"
          onClose={() => setSlashDialog(null)}
        >
          <DeferredComposerPanel label="模型与思考强度" onClose={() => setSlashDialog(null)}><ModelReasonSelector mode="panel" threadId={currentThreadId} /></DeferredComposerPanel>
        </ComposerSheet>
      )}
      <SlashCommandDialogs
        open={slashDialog}
        onClose={() => setSlashDialog(null)}
        threadId={currentThreadId}
        cwd={cwd}
        draftOwner={owner}
        targetScope={slashRequest?.scope}
      />
    </div>
  );
}
