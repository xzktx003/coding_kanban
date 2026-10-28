import { threadPermissionParameters } from "./threadPermissionProjection";
import { HistoryReadScopeChangedError } from "./HistoryReadScopeChangedError";
import { captureCodexOperationScope, isCodexOperationScopeCurrent, invalidateCodexOperationScope, type CodexOperationScope } from "./codexOperationScope";
import { MutationNotStartedError } from "./MutationNotStartedError";
import { createThreadGoalState } from "./threadGoalState";
import {
  createGoalCompletionAutoClear,
  installGoalCompletionAutoClear,
  notifyGoalCompletionAutoClear,
} from "./goalCompletionAutoClear";
import {
  threadGoalClearCompleted,
  type ThreadGoalClearCompletedParams,
} from "./apiAdapt/goalCompletion";
import { threadAccess } from "./apiAdapt/codex";
import { clearGoalAnnouncements } from "@session/features/goals/goalTranscript";
import { nativeThreadSettings } from "./nativeThreadSettings";
import {
  codexRuntimeState,
  verifiedTurnDuration,
} from "@session/utils/codexRuntimeState";
import { observeSubagents } from "@session/features/subagents/store";
import {
  isCodexTranscriptDormant,
  needsCodexTranscriptRestore,
  acknowledgeCodexTranscriptRestore,
} from "./codexTranscriptActivity";
import {
  withoutToolTranscriptEvents,
  lightweightThreadForStore,
} from "./codexTranscriptVisibility";
import { clearAsyncQuestions } from "../features/async-questions/store";
import type {
  Thread,
  ThreadForkParams,
  ThreadGoalClearParams,
  ThreadGoalGetParams,
  ThreadGoalSetParams,
  ThreadListParams,
  ThreadResumeParams,
  ThreadRollbackParams,
  ThreadStartParams,
  TurnStartParams,
  UserInput,
} from "@session/bindings/v2";
import {
  useCodexStore,
  useConfigStore,
} from "@session/components/codex/stores";
import { useWorkspaceStore } from "@session/stores";
import { useSettingsStore } from "@session/stores/settings";
import { convertThreadHistoryToEvents } from "@session/utils/threadHistoryConverter";
import { mergeThreadHistory } from "@session/utils/mergeThreadHistory";
import {
  clearDeliveryEchoes,
  acknowledgeDeliveryEchoes,
  deliveredClientIds,
} from "@session/stores/useCodexDeliveryStore";
import { revealNewQuestion } from "@session/features/async-questions/arrival";
import { enqueueSessionRead, readWithDeadline } from "./sessionReadQueue";
import { mergeHistoryPage } from "./sessionHistoryPages";
import {
  setSessionChecking,
  useSessionSyncStore,
} from "../stores/useSessionSyncStore";
import {
  cachedTranscriptBaselines,
  invalidateTranscriptCache,
} from "./sessionCacheState";
import { clearTrimmedHistoryAnchor } from "./sessionTranscriptBudget";
import {
  getThreadModelSettings,
  captureThreadModelRead,
  captureThreadModelSelection,
  flushThreadModelSettings,
  setThreadModelRuntimeScope,
  hydrateThreadModel,
} from "@session/stores/useThreadModelStore";
import {
  threadStart as apiThreadStart,
  gitCreateWorktree,
  listThreads,
  skillList,
  threadCompactStart,
  threadFork,
  threadGoalClear,
  threadGoalGet,
  threadGoalSet,
  threadRead,
  threadRollback,
  turnInterrupt,
  turnStart,
  turnSteer,
} from "./apiAdapt";

const unknownGoalMutations: Set<string> = import.meta.hot?.data?.unknownGoalMutations ?? new Set();
const goalState = createThreadGoalState({
  read: (threadId, options) =>
    threadGoalGet({ threadId }, { ...options, suppressToast: true }),
  set: (params, options) => threadGoalSet(params, options),
  clear: (params, options) => threadGoalClear(params, options),
  clearCompleted: (params, options) => threadGoalClearCompleted(params, options),
  current: (threadId) => useCodexStore.getState().goalMap[threadId],
  apply: (threadId, goal) => {
    if (goal) useCodexStore.getState().setGoal(threadId, goal);
    else useCodexStore.getState().clearGoal(threadId);
    if (goal?.status === "complete")
      queueMicrotask(() => void notifyGoalCompletionAutoClear(threadId));
  },
}, unknownGoalMutations);

const resolveThreadCwd = (threadId: string): string | null => {
  const { threads } = useCodexStore.getState();
  const item = threads.find((thread) => thread.id === threadId);
  if (!item) {
    return null;
  }
  const cwd = item.cwd?.trim();
  return cwd ? cwd : null;
};

const generateWorktreeKey = (): string => {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return `thread-${crypto.randomUUID()}`;
  }
  return `thread-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

/** Build the agents config fragment to inject into thread config params. */
const buildAgentsConfigFragment = (): Record<string, unknown> => {
  const { agentsMaxThreads, agentsMaxDepth } = useSettingsStore.getState();
  return {
    "features.multi_agents": true,
    "agents.max_threads": agentsMaxThreads,
    "agents.max_depth": agentsMaxDepth,
  };
};

/** Build UserInput[] from text + image paths, ensuring at least one entry. */
const buildUserInputs = (input: string, images: string[] = []): UserInput[] => {
  const userInputs: UserInput[] = [];

  if (input.trim()) {
    userInputs.push({ type: "text", text: input, text_elements: [] });
  }

  for (const imagePath of images) {
    userInputs.push({ type: "localImage", path: imagePath });
  }

  // If both are empty, send an empty text input as a fallback.
  if (userInputs.length === 0) {
    userInputs.push({ type: "text", text: "", text_elements: [] });
  }

  return userInputs;
};

const getThreadPreviewFromInput = (userInputs: UserInput[]): string => {
  for (const item of userInputs) {
    if (item.type !== "text") {
      continue;
    }
    const text = item.text.trim();
    if (text) {
      return text;
    }
  }
  return "";
};

/** Synchronizes thread data to the Zustand store with consistent logic */
const syncThreadToStore = (
  threadId: string,
  thread: Thread,
  historicalEvents: any[],
  options: {
    resetCurrentTurnId?: boolean;
    activate?: boolean;
    force?: boolean;
  } = {},
) => {
  const { resetCurrentTurnId = false, activate = true } = options;
  const {
    activeThreadIds,
    events,
    threads,
    inputFocusTrigger,
    threadStatusMap,
    turnTimingMap,
  } = useCodexStore.getState();
  const lastTurn = thread.turns.at(-1);
  const previous = turnTimingMap[threadId];
  const preserve =
    !options.force &&
    previous &&
    lastTurn &&
    ((previous.turnId === lastTurn.id &&
      previous.status !== "inProgress" &&
      lastTurn.status === "inProgress") ||
      (previous.turnId !== lastTurn.id &&
        typeof lastTurn.startedAt === "number" &&
        previous.startedAtMs > lastTurn.startedAt * 1000));
  const timing = preserve
    ? previous
    : lastTurn
      ? {
          turnId: lastTurn.id,
          startedAtMs:
            typeof lastTurn.startedAt === "number"
              ? lastTurn.startedAt * 1000
              : previous?.turnId === lastTurn.id
                ? previous.startedAtMs
                : 0,
          durationMs: verifiedTurnDuration(
            lastTurn.durationMs,
            previous?.turnId === lastTurn.id ? previous.durationMs : undefined,
          ),
          status: lastTurn.status,
        }
      : undefined;
  // Operational subagent discovery must precede the chat-only projection.
  // Do not retain command/output events just to feed the independent panel.
  for (const turn of thread.turns)
    for (const item of turn.items)
      if (
        item.type === "collabAgentToolCall" ||
        item.type === "subAgentActivity"
      )
        observeSubagents({
          method: "item/completed",
          params: {
            threadId,
            turnId: turn.id,
            item,
            completedAtMs: 0,
          },
        });
  const lightweightThread = lightweightThreadForStore(thread);

  return {
    ...(activate
      ? { currentThreadId: threadId, inputFocusTrigger: inputFocusTrigger + 1 }
      : {}),
    activeThreadIds: activeThreadIds.includes(threadId)
      ? activeThreadIds
      : [...activeThreadIds, threadId],
    threads: threads.some((t) => t.id === threadId)
      ? threads.map((t) => (t.id === threadId ? lightweightThread : t))
      : [lightweightThread, ...threads],
    events: isCodexTranscriptDormant(threadId)
      ? events
      : {
          ...events,
          [threadId]: withoutToolTranscriptEvents(historicalEvents),
        },
    historyLoadedMap: {
      ...useCodexStore.getState().historyLoadedMap,
      [threadId]: true,
    },
    ...(!preserve && thread.status
      ? { threadStatusMap: { ...threadStatusMap, [threadId]: thread.status } }
      : {}),
    ...(timing
      ? { turnTimingMap: { ...turnTimingMap, [threadId]: timing } }
      : {}),
    ...(activate
      ? {
          currentTurnId:
            !resetCurrentTurnId && timing?.status === "inProgress"
              ? timing.turnId
              : null,
        }
      : {}),
  };
};

/** Shared logic for thread fork/rollback: sync the updated thread to the store and return it. */
const applyThreadMutation = (
  set: typeof useCodexStore.setState,
  threadId: string,
  thread: Thread,
  activate = true,
): Thread => {
  const historicalEvents = convertThreadHistoryToEvents(thread);
  set({
    ...syncThreadToStore(threadId, thread, historicalEvents, {
      resetCurrentTurnId: true,
      activate,
    }),
  });
  return thread;
};

const pendingThreadRollbacks = new Map<
  string,
  { boundary: string; promise: Promise<Thread> }
>();
let runtimeEpoch = 0;
function invalidateThreadSettingsScope() {
  invalidateCodexOperationScope();
  setThreadModelRuntimeScope(String(captureCodexOperationScope().revision));
}
/** Capture a new chat's destination and configuration before local async preparation. */
function captureThreadStart() {
  const {
    model, modelProvider, approvalPolicy, approvalsReviewer, sandbox,
    reasoningEffort, serviceTier, collaborationMode, webSearchRequest,
    threadCwdMode,
  } = useConfigStore.getState();
  return {
    epoch: runtimeEpoch,
    scope: captureCodexOperationScope(),
    cwd: useWorkspaceStore.getState().cwd,
    config: structuredClone({
      model, modelProvider, approvalPolicy, approvalsReviewer, sandbox,
      reasoningEffort, serviceTier, collaborationMode, webSearchRequest,
      threadCwdMode,
    }),
    agentsConfig: structuredClone(buildAgentsConfigFragment()),
  };
}
let goalCompletionRuntimeEpoch: number = import.meta.hot?.data?.goalCompletionRuntimeEpoch ?? 0;
const goalCompletionAttempts: Map<string, number> = import.meta.hot?.data?.goalCompletionAttempts ?? new Map();
let goalCompletionAuthorityKnown: boolean = import.meta.hot?.data?.goalCompletionAuthorityKnown ?? useCodexStore.getState().hasAccount !== null;
const goalCompletionAutoClear = createGoalCompletionAutoClear({
  current: threadId => useCodexStore.getState().goalMap[threadId],
  scope: () => {
    const state = useCodexStore.getState();
    return JSON.stringify([goalCompletionRuntimeEpoch, state.accountNamespace, state.hasAccount, state.account?.type]);
  },
  canAttempt: threadId => {
    const state = useCodexStore.getState();
    const status = state.threadStatusMap[threadId] ?? state.threads.find(thread => thread.id === threadId)?.status;
    return goalCompletionAuthorityKnown && status?.type === "idle" && !codexRuntimeState(state, threadId).running && !goalState.isMutating(threadId) && !goalState.isOutcomeUnknown(threadId);
  },
  // Read the raw ownership response so a missing/invalid generation cannot be
  // normalized to an apparently authoritative zero by a UI status adapter.
  access: (threadId, signal) => readWithDeadline(
    accessSignal => threadAccess(threadId, false, accessSignal), 4000, signal,
  ),
  clear: params => goalState.clearCompleted(params),
}, goalCompletionAttempts);

function resetThreadGoalScope(clearViews = true) {
  goalState.reset();
  goalCompletionAutoClear.reset();
  clearGoalAnnouncements();
  if (clearViews)
    useCodexStore.setState(state => ({ goalMap: {}, completedGoalMap: {}, goalScopeVersion: state.goalScopeVersion + 1 }));
}
const stopGoalCompletionAutoClear = installGoalCompletionAutoClear({
  observe: threadId => goalCompletionAutoClear.observe(threadId),
  reset: () => {
    // A same-valued notification revokes pending authority, but says nothing
    // about whether the last read-only goal belongs to a different account.
    goalCompletionAuthorityKnown = false;
    invalidateThreadSettingsScope();
    goalState.cancel();
    goalCompletionAutoClear.cancel();
    clearGoalAnnouncements();
  },
  confirm: () => {
    goalCompletionAuthorityKnown = useCodexStore.getState().hasAccount !== null;
    if (goalCompletionAuthorityKnown)
      useCodexStore.setState(state => ({ goalScopeVersion: state.goalScopeVersion + 1 }));
  },
});
const stopGoalAccountScope = useCodexStore.subscribe((state, previous) => {
  if (state.accountNamespace !== previous.accountNamespace ||
      state.hasAccount !== previous.hasAccount || state.account?.type !== previous.account?.type) {
    goalCompletionAuthorityKnown = state.hasAccount !== null;
    invalidateThreadSettingsScope();
    resetThreadGoalScope();
  }
});
if (import.meta.hot) import.meta.hot.dispose(data => {
  invalidateCodexOperationScope();
  data.goalCompletionRuntimeEpoch = goalCompletionRuntimeEpoch;
  data.goalCompletionAttempts = goalCompletionAttempts;
  data.goalCompletionAuthorityKnown = goalCompletionAuthorityKnown;
  data.unknownGoalMutations = unknownGoalMutations;
  stopGoalCompletionAutoClear();
  stopGoalAccountScope();
  goalCompletionAutoClear.cancel();
  goalState.cancel();
});
const pendingThreadResumes = new Map<string, { promise: Promise<void>; scope: CodexOperationScope }>();
// The shared promise always reports a discarded snapshot. Each consumer wraps
// it separately: UI navigation keeps its silent-cancellation contract, while
// the followed-history scheduler must not count cancellation as a completed read.
async function consumeHistoryRead(promise: Promise<void>, reportScopeChanges = false) {
  try {
    await promise;
  } catch (error) {
    if (!reportScopeChanges && error instanceof HistoryReadScopeChangedError) return;
    throw error;
  }
}
const resumeVersions = new Map<string, symbol>();
const historyControllers = new Map<string, AbortController>();
const metadataReads = new Map<string, CodexOperationScope>();

export function cancelCodexHistoryRead(threadId: string) {
  resumeVersions.delete(threadId);
  pendingThreadResumes.delete(threadId);
  const controller = historyControllers.get(threadId);
  if (controller) {
    historyControllers.delete(threadId);
    controller.abort();
  }
  if (useSessionSyncStore.getState().checking[threadId])
    setSessionChecking(threadId, false);
  useCodexStore.setState((state) =>
    state.historyLoadingMap[threadId]
      ? {
          historyLoadingMap: {
            ...state.historyLoadingMap,
            [threadId]: false,
          },
        }
      : state,
  );
}

function readInitialThreadMetadata(threadId: string) {
  const existingScope = metadataReads.get(threadId);
  if (getThreadModelSettings(threadId).model || (existingScope && isCodexOperationScopeCurrent(existingScope)))
    return;
  const scope = captureCodexOperationScope();
  metadataReads.set(threadId, scope);
  const epoch = runtimeEpoch,
    readToken = captureThreadModelRead(threadId);
  // The runtime's metadata read currently includes full turns. Read it once in
  // the separate history lane; it must never delay recent messages or show a loader.
  void enqueueSessionRead("history", `metadata:${epoch}:${scope.revision}:${threadId}`, () =>
    readWithDeadline(
      (signal) => threadRead({ threadId }, { signal, suppressToast: true }),
      15000,
    ),
  )
    .then((response) => {
      if (runtimeEpoch !== epoch || !isCodexOperationScopeCurrent(scope)) return;
      const settings = response.thread as Thread & {
        model?: string;
        reasoningEffort?: ReturnType<
          typeof getThreadModelSettings
        >["reasoningEffort"];
      };
      hydrateThreadModel(threadId, nativeThreadSettings(response, settings), {
        readToken,
      });
      useCodexStore.setState((s) => {
        const existing = s.threads.find((t) => t.id === threadId);
        if (!existing) return s;
        const merged = {
          ...existing,
          ...settings,
          turns: existing.turns,
          status: existing.status,
        };
        const changed = Object.keys(settings).some(
          (key) =>
            !["turns", "status"].includes(key) &&
            JSON.stringify(existing[key as keyof Thread]) !==
              JSON.stringify(settings[key as keyof Thread]),
        );
        return changed
          ? { threads: s.threads.map((t) => (t.id === threadId ? merged : t)) }
          : s;
      });
    })
    .catch(() => {
      if (metadataReads.get(threadId) === scope) metadataReads.delete(threadId);
    });
}
/** Invalidate responses from the previous runtime without touching drafts or history. */
export function resetCodexRuntimeState() {
  runtimeEpoch++;
  invalidateThreadSettingsScope();
  goalCompletionRuntimeEpoch++;
  goalCompletionAuthorityKnown = false;
  resetThreadGoalScope(false);
  pendingThreadResumes.clear();
  resumeVersions.clear();
  for (const controller of historyControllers.values()) controller.abort();
  historyControllers.clear();
  metadataReads.clear();
  useSessionSyncStore.setState({
    checking: {},
    recovering: {},
    earlierLoading: {},
  });
  useCodexStore.setState((state) => ({
    activeThreadIds: [],
    streamingAgentMessages: {},
    currentTurnId: null,
    threadStatusMap: {},
    turnTimingMap: {},
    threads: state.threads.map((thread) => ({
      ...thread,
      status: { type: "notLoaded" as const },
    })),
    historyLoadedMap: {},
    historyLoadingMap: {},
    historyErrorMap: {},
    retryNoticeMap: {},
    goalMap: {},
    completedGoalMap: {},
    goalScopeVersion: state.goalScopeVersion + 1,
  }));
}

export const codexService = {
  async loadThreads(
    cwd: string | null,
    archived: boolean = false,
    sortKey: "created_at" | "updated_at" = "updated_at",
  ) {
    const epoch = runtimeEpoch;
    try {
      const params: ThreadListParams = {
        cursor: null,
        limit: 20,
        modelProviders: null,
        archived,
        sortKey,
        cwd,
        useStateDbOnly: true,
      };
      const response = await listThreads(params);
      if (epoch !== runtimeEpoch) return;
      const workingDirThreads = response.data;
      const nextCursor = response.nextCursor ?? null;
      const { setThreads, setThreadListNextCursor } = useCodexStore.getState();
      setThreads(workingDirThreads);
      setThreadListNextCursor(nextCursor);
    } catch (error: unknown) {
      if (epoch !== runtimeEpoch) return;
      console.error("[CodexService] Failed to load threads:", error);
      useCodexStore.getState().setThreadListNextCursor(null);
      useCodexStore.getState().setThreads([]);
    }
  },
  async setCurrentThread(threadId: string | null) {
    // Cached histories switch immediately. Missing histories load read-only;
    // only execution operations acquire a native thread instance.
    const set = useCodexStore.setState;
    try {
      if (!threadId) {
        set((state) => ({
          currentThreadId: null,
          currentTurnId: null,
          inputFocusTrigger: state.inputFocusTrigger + 1,
        }));
        return;
      }

      const state = useCodexStore.getState();

      if (state.historyLoadedMap[threadId]) {
        // Live thread — derive the active turn id from streaming events so the
        // Stop button works correctly when a turn is in progress.
        const threadEvents = state.events[threadId] ?? [];
        let activeTurnId: string | null = null;
        for (let i = threadEvents.length - 1; i >= 0; i--) {
          const e = threadEvents[i];
          if (e.method === "turn/started") {
            activeTurnId = (e.params as { turn: { id: string } }).turn.id;
            break;
          }
          if (e.method === "turn/completed" || e.method === "error") {
            break;
          }
        }
        set((state) => ({
          currentThreadId: threadId,
          currentTurnId: activeTurnId,
          inputFocusTrigger: state.inputFocusTrigger + 1,
        }));
        if (!state.activeThreadIds.includes(threadId)) {
          // A passive cached transcript is already usable. Verification must
          // stay read-only and must not delay navigation or acquire a writer.
          void codexService
            .loadThreadHistory(threadId, undefined, {
              recent: true,
              background: true,
            })
            .catch(() => {}); // The owning history store retains the retryable error.
        }
      } else {
        // Uncached — select the view and read history without acquiring execution.
        set((state) => ({
          currentThreadId: threadId,
          currentTurnId: null,
          inputFocusTrigger: state.inputFocusTrigger + 1,
        }));
        await codexService.loadThreadHistory(threadId, undefined, {
          recent: true,
        });
      }
    } catch (error: unknown) {
      console.error("[CodexService] setCurrentThread error:", error);
      throw error;
    }
  },
  captureThreadStart,
  async threadStart(options?: {
    shouldActivate?: () => boolean;
    captured?: ReturnType<typeof captureThreadStart>;
  }) {
    const set = useCodexStore.setState;
    const captured = options?.captured ?? captureThreadStart();
    const epoch = captured.epoch;
    try {
      if (epoch !== runtimeEpoch || !isCodexOperationScopeCurrent(captured.scope))
        throw new Error("连接目标已切换，尚未创建会话；草稿已保留，请核对原连接后重试。");
      const {
        model,
        modelProvider,
        approvalPolicy,
        approvalsReviewer,
        sandbox,
        reasoningEffort,
        serviceTier,
        collaborationMode,
        webSearchRequest,
        threadCwdMode,
      } = captured.config;
      const { cwd } = captured;
      let threadCwd = cwd;
      if (threadCwdMode === "worktree" && cwd) {
        const prepared = await readWithDeadline(async (signal) => {
          const result = await gitCreateWorktree(cwd, generateWorktreeKey(), {
            signal,
          });
          if (signal.aborted) throw signal.reason;
          return result;
        }, 60_000);
        if (epoch !== runtimeEpoch || !isCodexOperationScopeCurrent(captured.scope)) {
          throw new Error(
            "连接目标已切换，创建结果未确认，请先核对原连接的会话列表及工作区状态。",
          );
        }
        threadCwd = prepared.worktree_path;
      }
      const params: ThreadStartParams = {
        model: model || null,
        modelProvider,
        serviceTier,
        cwd: threadCwd,
        approvalPolicy,
        approvalsReviewer,
        sandbox,
        baseInstructions: null,
        developerInstructions: null,
        config: {
          // Scoped to this thread: exposes native clarification questions in
          // default mode without changing the user's CLI feature settings.
          "features.default_mode_request_user_input": true,
          model_reasoning_effort: reasoningEffort,
          show_raw_agent_reasoning: false,
          model_reasoning_summary: "auto",
          web_search_request: webSearchRequest,
          view_image_tool: true,
          // Inject user-configured multi-agent limits.
          ...captured.agentsConfig,
        },
      };
      const response = await readWithDeadline(async (signal) => {
        const result = await apiThreadStart(params, { signal });
        // A late response cannot activate a thread or hydrate its model settings.
        if (signal.aborted) throw signal.reason;
        return result;
      }, 30_000);
      if (epoch !== runtimeEpoch || !isCodexOperationScopeCurrent(captured.scope)) {
        throw new Error(
          "连接目标已切换，创建结果未确认，请先核对原连接的会话列表及工作区状态。",
        );
      }
      const thread = response.thread;
      hydrateThreadModel(
        thread.id,
        nativeThreadSettings(response, {
          model,
          modelProvider,
          reasoningEffort,
          serviceTier,
          approvalPolicy,
          approvalsReviewer,
          sandbox,
          webSearchRequest,
          collaborationMode,
        }),
      );

      set({
        ...syncThreadToStore(thread.id, thread, [], {
          activate: options?.shouldActivate?.() ?? true,
        }),
      });

      console.log("[CodexService] threadStart completed successfully");
      return thread;
    } catch (error: unknown) {
      console.error("[CodexService] threadStart error:", error);
      if (error instanceof DOMException && error.name === "TimeoutError") {
        throw new Error(
          "创建会话结果未确认，请先核对会话列表及工作区状态；不会自动重发。",
        );
      }
      throw error;
    }
  },
  /** @deprecated Use loadThreadHistory. This alias is read-only too. */
  async threadResume(
    threadId: string,
    overrides?: Omit<ThreadResumeParams, "threadId">,
    options?: { background?: boolean },
  ) {
    return codexService.loadThreadHistory(threadId, overrides, options);
  },
  async loadThreadHistory(
    threadId: string,
    overrides?: Omit<ThreadResumeParams, "threadId">,
    options?: {
      background?: boolean;
      recent?: boolean;
      signal?: AbortSignal;
      cursor?: string;
      /** Seeking a search hit must not move the contiguous older-history boundary. */
      preserveEarlierCursor?: boolean;
      afterTurnId?: string;
      /** Internal scheduler only: a revoked snapshot must leave its revision pending. */
      reportScopeChanges?: boolean;
    },
  ) {
    const scope = captureCodexOperationScope();
    // Recovery follows existing event-driven history reads; it never adds a
    // transcript poll or acquires a native execution instance.
    if (!options?.cursor) void goalState.read(threadId).catch(() => undefined);
    const precedingRead = !overrides
      ? pendingThreadResumes.get(threadId)
      : undefined;
    if (precedingRead && isCodexOperationScopeCurrent(precedingRead.scope)) {
      if (!options?.cursor) return consumeHistoryRead(precedingRead.promise, options?.reportScopeChanges);
      // An opaque target cursor is a different page. Let the bounded current
      // read settle, then request that page rather than reusing its response.
      await precedingRead.promise.catch(() => undefined);
      if (!isCodexOperationScopeCurrent(scope)) {
        if (options?.reportScopeChanges) throw new HistoryReadScopeChangedError();
        return;
      }
      if (options?.signal?.aborted)
        throw (
          options.signal.reason ?? new DOMException("Aborted", "AbortError")
        );
    }
    const version = Symbol(threadId);
    resumeVersions.set(threadId, version);
    const controller = new AbortController();
    historyControllers.set(threadId, controller);
    const cancel = () => controller.abort(options?.signal?.reason);
    if (options?.signal?.aborted) cancel();
    else options?.signal?.addEventListener("abort", cancel, { once: true });
    const restoringEvicted = needsCodexTranscriptRestore(threadId);
    const cached =
      !restoringEvicted &&
      Boolean(useCodexStore.getState().historyLoadedMap[threadId]);
    useCodexStore.setState((state) =>
      state.historyLoadingMap[threadId] === !cached &&
      !state.historyErrorMap[threadId]
        ? state
        : {
            historyLoadingMap: {
              ...state.historyLoadingMap,
              [threadId]: !cached,
            },
            historyErrorMap: {
              ...state.historyErrorMap,
              [threadId]: undefined,
            },
          },
    );
    setSessionChecking(threadId, true);
    const pending = (async () => {
      const baseline = useCodexStore.getState();
      const modelReadToken = captureThreadModelRead(threadId);
      const response = await enqueueSessionRead(
        options?.recent ? "recent" : "history",
        `${runtimeEpoch}:${scope.revision}:${threadId}`,
        () =>
          readWithDeadline(
            (signal) =>
              threadRead(
                {
                  threadId,
                  ...(options?.recent
                    ? {
                        recent: true,
                        ...(options.cursor
                          ? { cursor: options.cursor }
                          : options.afterTurnId
                            ? { afterTurnId: options.afterTurnId }
                            : !restoringEvicted &&
                                baseline.turnTimingMap[threadId]?.turnId
                              ? {
                                  afterTurnId:
                                    baseline.turnTimingMap[threadId].turnId,
                                }
                              : {}),
                      }
                    : {}),
                },
                { suppressToast: options?.background, signal },
              ),
            // Recent pages use the serialized independent reader: its existing
            // 120s queue/read deadline plus up to 4s owned-process cleanup.
            // A 5s client cutoff abandoned valid pages and fed retry congestion.
            options?.recent ? 125_000 : 15_000,
            controller.signal,
          ),
        controller.signal,
      );
      if (!isCodexOperationScopeCurrent(scope)) throw new HistoryReadScopeChangedError();
      if (resumeVersions.get(threadId) !== version) return;
      const page = "historyPage" in response ? response.historyPage : undefined;
      const existingThread = useCodexStore
        .getState()
        .threads.find((t) => t.id === threadId);
      const thread = {
        ...(existingThread ?? {
          preview: "",
          cwd: "",
          createdAt: 0,
          updatedAt: 0,
          name: null,
          modelProvider: "",
          status: { type: "notLoaded" },
        }),
        ...response.thread,
      } as Thread;
      // Recent native versions expose settings on the read-only Thread object.
      // Missing fields keep the existing per-thread choice; CLI changes hydrate
      // only if the user has not changed their selection during this request.
      const settings = thread as typeof thread & {
        model?: string;
        reasoningEffort?: ReturnType<
          typeof getThreadModelSettings
        >["reasoningEffort"];
      };
      hydrateThreadModel(threadId, nativeThreadSettings(response, settings), {
        readToken: modelReadToken,
        notify: !!baseline.historyLoadedMap[threadId],
      });
      const itemPage = page && "itemPage" in page && page.itemPage;
      const historicalEvents = convertThreadHistoryToEvents(thread).filter(
        (event) => !itemPage || event.method !== "turn/completed",
      );
      // Receipt acknowledgement must not require a mounted transcript.
      if (isCodexTranscriptDormant(threadId)) {
        const delivered = deliveredClientIds(historicalEvents);
        if (delivered.size) acknowledgeDeliveryEchoes(threadId, [...delivered]);
      }
      const current = useCodexStore.getState();
      const beforeEvents =
        baseline.events[threadId] ??
        cachedTranscriptBaselines.get(threadId) ??
        [];
      const reconciledEvents = page
        ? mergeHistoryPage(
            historicalEvents,
            beforeEvents,
            current.events[threadId] ?? [],
            thread.turns.map((t) => t.id),
            page.earlier,
            !!itemPage,
          )
        : mergeThreadHistory(
            historicalEvents,
            beforeEvents,
            current.events[threadId] ?? [],
          );
      // A response belongs to its thread even if the user has since selected another.
      const restored = syncThreadToStore(threadId, thread, reconciledEvents, {
        activate: !options?.background && current.currentThreadId === threadId,
      });
      useSessionSyncStore.setState((s) =>
        options?.preserveEarlierCursor ||
        (page &&
          !restoringEvicted &&
          baseline.historyLoadedMap[threadId] &&
          !("truncated" in page && page.truncated) &&
          !options?.cursor &&
          !options?.afterTurnId &&
          s.cursors[threadId] !== undefined)
          ? s
          : { cursors: { ...s.cursors, [threadId]: page?.nextCursor ?? null } },
      );
      if (options?.afterTurnId && page) clearTrimmedHistoryAnchor(threadId);
      const unchanged =
        page &&
        current.historyLoadedMap[threadId] &&
        reconciledEvents === current.events[threadId] &&
        JSON.stringify(restored.turnTimingMap?.[threadId]) ===
          JSON.stringify(current.turnTimingMap[threadId]);
      if (!unchanged)
        useCodexStore.setState({
          ...restored,
          ...(itemPage
            ? {
                turnTimingMap: current.turnTimingMap,
                currentTurnId: current.currentTurnId,
              }
            : {}),
          ...(page ? { threadStatusMap: current.threadStatusMap } : {}),
          ...(!itemPage &&
          options?.background &&
          current.currentThreadId === threadId
            ? {
                currentTurnId:
                  restored.turnTimingMap?.[threadId]?.status === "inProgress"
                    ? restored.turnTimingMap[threadId].turnId
                    : null,
              }
            : {}),
          ...(current.threadStatusMap[threadId] !==
          baseline.threadStatusMap[threadId]
            ? { threadStatusMap: current.threadStatusMap }
            : {}),
          ...(current.turnTimingMap[threadId] !==
          baseline.turnTimingMap[threadId]
            ? {
                turnTimingMap: current.turnTimingMap,
                ...(current.currentThreadId === threadId
                  ? { currentTurnId: current.currentTurnId }
                  : {}),
              }
            : {}),
        });
      // A warm read can discover a question before its delayed SSE event.
      // Cold history and earlier pages stay passive; source IDs and presentation
      // state retain collapse/replay protection in the shared arrival handler.
      if (
        options?.background &&
        options.recent &&
        baseline.historyLoadedMap[threadId] &&
        !options.cursor &&
        !unchanged
      )
        for (const event of historicalEvents)
          revealNewQuestion(event, beforeEvents);
      cachedTranscriptBaselines.delete(threadId);
      acknowledgeCodexTranscriptRestore(threadId);
      if (page) readInitialThreadMetadata(threadId);
    })();
    if (!overrides) pendingThreadResumes.set(threadId, { promise: pending, scope });
    try {
      await pending;
    } catch (error: unknown) {
      if (!isCodexOperationScopeCurrent(scope)) {
        if (options?.reportScopeChanges) throw new HistoryReadScopeChangedError();
        return;
      }
      if (resumeVersions.get(threadId) !== version) return;
      if (resumeVersions.get(threadId) === version)
        useCodexStore.setState((state) => ({
          historyErrorMap: {
            ...state.historyErrorMap,
            [threadId]: error instanceof Error ? error.message : String(error),
          },
        }));
      console.error("[CodexService] threadResume error:", error);
      throw error;
    } finally {
      options?.signal?.removeEventListener("abort", cancel);
      if (historyControllers.get(threadId) === controller)
        historyControllers.delete(threadId);
      if (resumeVersions.get(threadId) === version) {
        resumeVersions.delete(threadId);
        useCodexStore.setState((state) =>
          state.historyLoadingMap[threadId] === false
            ? state
            : {
                historyLoadingMap: {
                  ...state.historyLoadingMap,
                  [threadId]: false,
                },
              },
        );
        setSessionChecking(threadId, false);
      }
      if (pendingThreadResumes.get(threadId)?.promise === pending)
        pendingThreadResumes.delete(threadId);
    }
  },
  async loadEarlierHistory(threadId: string) {
    const state = useSessionSyncStore.getState();
    if (
      (!state.trimmedHistoryAnchors[threadId] && !state.cursors[threadId]) ||
      state.earlierLoading[threadId]
    )
      return;
    const scope = captureCodexOperationScope();
    useSessionSyncStore.setState((s) => ({
      earlierLoading: { ...s.earlierLoading, [threadId]: true },
      earlierErrors: { ...s.earlierErrors, [threadId]: "" },
    }));
    try {
      const precedingRead = pendingThreadResumes.get(threadId);
      if (precedingRead && isCodexOperationScopeCurrent(precedingRead.scope))
        await precedingRead.promise.catch(() => undefined);
      if (!isCodexOperationScopeCurrent(scope)) return;
      // A concurrent read can change the recovery anchor or page boundary.
      const latest = useSessionSyncStore.getState();
      const cursor = latest.cursors[threadId];
      const trimmedAnchor = latest.trimmedHistoryAnchors[threadId];
      if (!trimmedAnchor && !cursor) return;
      await codexService.loadThreadHistory(threadId, undefined, {
        background: true,
        recent: true,
        ...(trimmedAnchor
          ? { afterTurnId: trimmedAnchor }
          : cursor
            ? { cursor }
            : {}),
      });
    } catch (error) {
      useSessionSyncStore.setState((s) => ({
        earlierErrors: { ...s.earlierErrors, [threadId]: String(error) },
      }));
    } finally {
      useSessionSyncStore.setState((s) => ({
        earlierLoading: { ...s.earlierLoading, [threadId]: false },
      }));
    }
  },
  async threadFork(
    threadId: string,
    boundary: { lastTurnId?: string; beforeTurnId?: string } = {},
  ) {
    const { lastTurnId, beforeTurnId } = boundary;
    if (
      (lastTurnId !== undefined && beforeTurnId !== undefined) ||
      [lastTurnId, beforeTurnId].some(
        (value) =>
          value !== undefined && (!value.trim() || /[\x00-\x1f]/.test(value)),
      )
    )
      throw new MutationNotStartedError("无效或冲突的分支轮次边界。");
    const timing = useCodexStore.getState().turnTimingMap[threadId];
    if (
      lastTurnId &&
      timing?.turnId === lastTurnId &&
      timing.status === "inProgress"
    )
      throw new MutationNotStartedError(
        "不能从尚未结束的轮次创建包含该轮的分支。",
      );
    const set = useCodexStore.setState;
    const scope = captureCodexOperationScope();
    try {
      const params: ThreadForkParams = {
        threadId,
        ...(lastTurnId !== undefined ? { lastTurnId } : {}),
        ...(beforeTurnId !== undefined ? { beforeTurnId } : {}),
        deferGoalContinuation: true,
      };
      const response = await threadFork(params);
      if (!isCodexOperationScopeCurrent(scope))
        throw new Error("连接或账号已变化，分支结果未确认，请核对原连接，勿重复创建分支。");
      hydrateThreadModel(
        response.thread.id,
        nativeThreadSettings(response, response.thread),
      );
      return applyThreadMutation(
        set,
        response.thread.id,
        response.thread,
        lastTurnId === undefined && beforeTurnId === undefined,
      );
    } catch (error: unknown) {
      console.error("[CodexService] threadFork error:", error);
      throw error;
    }
  },
  async threadRollback(
    threadId: string,
    numTurns: number,
    beforeTurnId?: string,
  ) {
    const existing = pendingThreadRollbacks.get(threadId);
    const boundary = beforeTurnId ?? String(numTurns);
    if (existing) {
      if (existing.boundary === boundary) return existing.promise;
      throw new MutationNotStartedError("回滚正在进行，请等待完成后再编辑。");
    }
    const state = useCodexStore.getState();
    if (codexRuntimeState(state, threadId).running) {
      throw new MutationNotStartedError("请先停止当前任务，再回滚编辑消息。");
    }
    if (!Number.isInteger(numTurns) || numTurns < 1)
      throw new MutationNotStartedError("无效的回滚轮数。");
    const pending = (async () => {
      const params: ThreadRollbackParams & { beforeTurnId?: string } = {
        threadId,
        numTurns,
        ...(beforeTurnId ? { beforeTurnId } : {}),
      };
      const response = await threadRollback(params);
      clearAsyncQuestions(threadId);
      clearDeliveryEchoes(threadId);
      // A pre-rollback history request must not restore discarded turns later.
      invalidateTranscriptCache(`codex:${threadId}`);
      resumeVersions.delete(threadId);
      cachedTranscriptBaselines.delete(threadId);
      setSessionChecking(threadId, false);
      useSessionSyncStore.setState((s) => ({
        cursors: { ...s.cursors, [threadId]: null },
      }));
      const active = useCodexStore.getState().currentThreadId === threadId;
      useCodexStore.setState(
        syncThreadToStore(
          threadId,
          response.thread,
          convertThreadHistoryToEvents(response.thread),
          { resetCurrentTurnId: active, activate: active, force: true },
        ),
      );
      useCodexStore.setState((state) => {
        const turnTimingMap = { ...state.turnTimingMap };
        const retryNoticeMap = { ...state.retryNoticeMap };
        delete turnTimingMap[threadId];
        delete retryNoticeMap[threadId];
        const lastTurn = response.thread.turns.at(-1);
        if (lastTurn)
          turnTimingMap[threadId] = {
            turnId: lastTurn.id,
            startedAtMs: (lastTurn.startedAt ?? 0) * 1000,
            durationMs: verifiedTurnDuration(lastTurn.durationMs),
            status: lastTurn.status,
          };
        return {
          turnTimingMap,
          retryNoticeMap,
          ...(response.thread.status
            ? {
                threadStatusMap: {
                  ...state.threadStatusMap,
                  [threadId]: response.thread.status,
                },
              }
            : {}),
          historyLoadingMap: { ...state.historyLoadingMap, [threadId]: false },
          historyErrorMap: { ...state.historyErrorMap, [threadId]: undefined },
        };
      });
      return response.thread;
    })();
    pendingThreadRollbacks.set(threadId, { boundary, promise: pending });
    try {
      return await pending;
    } finally {
      if (pendingThreadRollbacks.get(threadId)?.promise === pending)
        pendingThreadRollbacks.delete(threadId);
    }
  },
  async turnStart(
    threadId: string,
    input: string,
    images: string[] = [],
    clientUserMessageId?: string,
    userInputOverride?: UserInput[],
    configOverride?: Pick<
      TurnStartParams,
      | "cwd"
      | "model"
      | "effort"
      | "serviceTier"
      | "approvalPolicy"
      | "approvalsReviewer"
      | "sandboxPolicy"
      | "collaborationMode"
      | "personality"
    >,
  ) {
    const set = useCodexStore.setState;
    const epoch = runtimeEpoch;
    const scope = captureCodexOperationScope();
    const timingAtRequest = useCodexStore.getState().turnTimingMap[threadId];
    try {
      const userInputs = structuredClone(
        userInputOverride ?? buildUserInputs(input, images),
      );
      const capturedConfig = configOverride
        ? structuredClone(
            Object.fromEntries(
              [
                "cwd",
                "model",
                "effort",
                "serviceTier",
                "approvalPolicy",
                "approvalsReviewer",
                "sandboxPolicy",
                "collaborationMode",
                "personality",
              ]
                .filter((key) =>
                  Object.prototype.hasOwnProperty.call(configOverride, key),
                )
                .map((key) => [
                  key,
                  configOverride[key as keyof typeof configOverride],
                ]),
            ),
          )
        : {};

      const settingsCapture = configOverride ? undefined : captureThreadModelSelection(threadId);
      if (settingsCapture) {
        try {
          await flushThreadModelSettings(threadId, settingsCapture);
        } catch (error) {
          throw new MutationNotStartedError(String(error));
        }
        if (epoch !== runtimeEpoch || !isCodexOperationScopeCurrent(scope))
          throw new MutationNotStartedError("连接目标已切换，请核对会话设置后再发送");
      }
      // An explicit override is a complete, previously captured snapshot (Goal
      // first turn / rollback retry), not a partial merge with today's UI defaults.
      // Omitted settings, including cwd, remain omitted so native inheritance wins.
      let parameters = capturedConfig;
      if (settingsCapture) {
        const {
          model, reasoningEffort, serviceTier, collaborationMode, personality,
        } = settingsCapture.settings;
        parameters = {
        cwd: resolveThreadCwd(threadId),
        ...threadPermissionParameters(settingsCapture.settings),
        ...(model ? { serviceTier } : {}),
        model: model || null,
        effort: reasoningEffort ?? null,
        ...(personality ? { personality } : {}),
        // Mode is a turn/start field, not a thread/start config key. Explicit
        // default also lets an existing planned thread leave planning mode.
        ...(model
          ? {
              collaborationMode: {
                mode: collaborationMode,
                settings: {
                  model,
                  reasoning_effort: reasoningEffort,
                  developer_instructions: null,
                },
              },
            }
          : {}),
        };
      }
      if (epoch !== runtimeEpoch || !isCodexOperationScopeCurrent(scope))
        throw new MutationNotStartedError("连接或账号已变化，请核对会话后再发送");
      const response = await turnStart({
        threadId,
        ...(clientUserMessageId ? { clientUserMessageId } : {}),
        input: userInputs,
        ...parameters,
      });

      if (epoch !== runtimeEpoch || !isCodexOperationScopeCurrent(scope))
        throw new Error("会话服务已重启，请核对消息结果");
      const preview = getThreadPreviewFromInput(userInputs);
      set((state) => {
        const latest = state.turnTimingMap[threadId];
        // Streaming may finish this turn (or start another) before HTTP returns.
        const accept =
          latest === timingAtRequest ||
          (latest?.turnId === response.turn.id &&
            latest.status === "inProgress");
        return {
          ...(accept && state.currentThreadId === threadId
            ? {
                currentTurnId:
                  response.turn.status === "inProgress"
                    ? response.turn.id
                    : null,
              }
            : {}),
          ...(accept
            ? {
                threadStatusMap: {
                  ...state.threadStatusMap,
                  [threadId]:
                    response.turn.status === "inProgress"
                      ? { type: "active" as const, activeFlags: [] }
                      : response.turn.status === "failed"
                        ? { type: "systemError" as const }
                        : { type: "idle" as const },
                },
                turnTimingMap: {
                  ...state.turnTimingMap,
                  [threadId]: {
                    turnId: response.turn.id,
                    startedAtMs:
                      (response.turn.startedAt ?? Date.now() / 1000) * 1000,
                    durationMs: verifiedTurnDuration(
                      response.turn.durationMs,
                      state.turnTimingMap[threadId]?.turnId === response.turn.id
                        ? state.turnTimingMap[threadId].durationMs
                        : undefined,
                    ),
                    status: response.turn.status,
                  },
                },
              }
            : {}),
          threads: state.threads.map((thread) => {
            if (thread.id !== threadId) {
              return thread;
            }
            if (thread.preview.trim() || !preview) {
              return thread;
            }
            return {
              ...thread,
              preview,
            };
          }),
        };
      });
      return response.turn;
    } catch (error: unknown) {
      console.error("[CodexService] turnStart error:", error);
      throw error;
    }
  },
  async turnSteer(
    threadId: string,
    expectedTurnId: string,
    input: string,
    images: string[] = [],
    clientUserMessageId?: string,
  ) {
    try {
      const userInputs = buildUserInputs(input, images);

      const response = await turnSteer({
        threadId,
        ...(clientUserMessageId ? { clientUserMessageId } : {}),
        expectedTurnId,
        input: userInputs,
      });

      return response;
    } catch (error: unknown) {
      console.error("[CodexService] turnSteer error:", error);
      throw error;
    }
  },
  async turnInterrupt(threadId: string, turnId: string) {
    const set = useCodexStore.setState;
    try {
      await turnInterrupt({ threadId, turnId });
      // Completion notifications drive the button back to Send. An ACK is not
      // proof that execution ended, and must never mutate a newly selected turn.
      set((state) =>
        state.currentThreadId === threadId && state.currentTurnId === turnId
          ? { currentTurnId: null }
          : {},
      );
    } catch (error: unknown) {
      console.error("[CodexService] turnInterrupt error:", error);
      throw error;
    }
  },
  async listSkills(cwd: string | null) {
    if (!cwd) return [];
    try {
      const response = await skillList(cwd);
      return response.data;
    } catch (error: unknown) {
      console.error("[CodexService] listSkills error:", error);
      throw error;
    }
  },
  async threadGoalSet(params: ThreadGoalSetParams) {
    try {
      return await goalState.set(params);
    } catch (error: unknown) {
      console.error("[CodexService] threadGoalSet error:", error);
      throw error;
    }
  },
  /** Before objective materialization; a canonical read never resumes this submit. */
  assertThreadGoalReady(threadId: string) { goalState.assertReady(threadId); },
  async threadGoalGet(params: ThreadGoalGetParams) {
    return goalState.read(params.threadId);
  },
  async threadGoalClearCompleted(params: ThreadGoalClearCompletedParams) {
    return goalState.clearCompleted(params);
  },
  async threadCompact(threadId: string) {
    try {
      return await threadCompactStart({ threadId });
    } catch (error: unknown) {
      console.error("[CodexService] threadCompact error:", error);
      throw error;
    }
  },
  async threadGoalClear(params: ThreadGoalClearParams) {
    try {
      return await goalState.clear(params);
    } catch (error: unknown) {
      console.error("[CodexService] threadGoalClear error:", error);
      throw error;
    }
  },
};
