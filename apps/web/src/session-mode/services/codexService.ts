import { codexRuntimeState } from "@session/utils/codexRuntimeState";
import { clearAsyncQuestions } from "../features/async-questions/store";
import type {
  SandboxMode,
  SandboxPolicy,
  Thread,
  ThreadForkParams,
  ThreadGoalClearParams,
  ThreadGoalSetParams,
  ThreadListParams,
  ThreadResumeParams,
  ThreadRollbackParams,
  ThreadStartParams,
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
import { clearDeliveryEchoes } from "@session/stores/useCodexDeliveryStore";
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
import {
  getThreadModelSettings,
  hydrateThreadModel,
  useThreadModelStore,
} from "@session/stores/useThreadModelStore";
import {
  threadStart as apiThreadStart,
  gitCreateWorktree,
  listThreads,
  skillList,
  threadCompactStart,
  threadFork,
  threadGoalClear,
  threadGoalSet,
  threadRead,
  threadRollback,
  turnInterrupt,
  turnStart,
  turnSteer,
} from "./apiAdapt";

const sandboxModeToPolicy = (
  mode: SandboxMode,
  networkAccess: boolean,
): SandboxPolicy => {
  switch (mode) {
    case "read-only":
      return { type: "readOnly", networkAccess };
    case "workspace-write":
      return {
        type: "workspaceWrite",
        writableRoots: [],
        networkAccess,
        excludeTmpdirEnvVar: false,
        excludeSlashTmp: false,
      };
    case "danger-full-access":
      return { type: "dangerFullAccess" };
  }
};

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
          durationMs: lastTurn.durationMs,
          status: lastTurn.status,
        }
      : undefined;

  return {
    ...(activate
      ? { currentThreadId: threadId, inputFocusTrigger: inputFocusTrigger + 1 }
      : {}),
    activeThreadIds: activeThreadIds.includes(threadId)
      ? activeThreadIds
      : [...activeThreadIds, threadId],
    threads: threads.some((t) => t.id === threadId)
      ? threads.map((t) => (t.id === threadId ? thread : t))
      : [thread, ...threads],
    events: {
      ...events,
      [threadId]: historicalEvents,
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
): Thread => {
  const historicalEvents = convertThreadHistoryToEvents(thread);
  set({
    ...syncThreadToStore(threadId, thread, historicalEvents, {
      resetCurrentTurnId: true,
    }),
  });
  return thread;
};

const pendingThreadRollbacks = new Map<
  string,
  { boundary: string; promise: Promise<Thread> }
>();
let runtimeEpoch = 0;
const pendingThreadResumes = new Map<string, Promise<void>>();
const resumeVersions = new Map<string, symbol>();
const historyControllers = new Map<string, AbortController>();
const metadataReads = new Set<string>();
function readInitialThreadMetadata(threadId: string) {
  if (getThreadModelSettings(threadId).model || metadataReads.has(threadId))
    return;
  metadataReads.add(threadId);
  const epoch = runtimeEpoch,
    revision = useThreadModelStore.getState().threads[threadId]?.revision ?? 0;
  // The runtime's metadata read currently includes full turns. Read it once in
  // the separate history lane; it must never delay recent messages or show a loader.
  void enqueueSessionRead("history", `metadata:${epoch}:${threadId}`, () =>
    readWithDeadline(
      (signal) => threadRead({ threadId }, { signal, suppressToast: true }),
      15000,
    ),
  )
    .then((response) => {
      if (runtimeEpoch !== epoch) return;
      const settings = response.thread as Thread & {
        model?: string;
        reasoningEffort?: ReturnType<
          typeof getThreadModelSettings
        >["reasoningEffort"];
      };
      hydrateThreadModel(
        threadId,
        {
          model:
            ("model" in response ? response.model : undefined) ??
            settings.model,
          modelProvider:
            ("modelProvider" in response
              ? response.modelProvider
              : undefined) ?? settings.modelProvider,
          reasoningEffort:
            "reasoningEffort" in response
              ? response.reasoningEffort
              : settings.reasoningEffort,
        },
        { revision },
      );
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
      metadataReads.delete(threadId);
    });
}
/** Invalidate responses from the previous runtime without touching drafts or history. */
export function resetCodexRuntimeState() {
  runtimeEpoch++;
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
  }));
}

export const codexService = {
  async loadThreads(
    cwd: string | null,
    archived: boolean = false,
    sortKey: "created_at" | "updated_at" = "updated_at",
  ) {
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
      const workingDirThreads = response.data;
      const nextCursor = response.nextCursor ?? null;
      const { setThreads, setThreadListNextCursor } = useCodexStore.getState();
      setThreads(workingDirThreads);
      setThreadListNextCursor(nextCursor);
    } catch (error: unknown) {
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
  async threadStart(options?: { shouldActivate?: () => boolean }) {
    const set = useCodexStore.setState;
    try {
      const {
        model,
        modelProvider,
        approvalPolicy,
        sandbox,
        reasoningEffort,
        webSearchRequest,
        threadCwdMode,
      } = useConfigStore.getState();
      const { cwd } = useWorkspaceStore.getState();
      let threadCwd = cwd;
      if (threadCwdMode === "worktree" && cwd) {
        const prepared = await gitCreateWorktree(cwd, generateWorktreeKey());
        threadCwd = prepared.worktree_path;
      }
      const params: ThreadStartParams = {
        model: model || null,
        modelProvider,
        cwd: threadCwd,
        approvalPolicy,
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
          ...buildAgentsConfigFragment(),
        },
      };
      const response = await apiThreadStart(params);
      const thread = response.thread;
      hydrateThreadModel(thread.id, {
        model: response.model || model,
        modelProvider: response.modelProvider ?? modelProvider,
        reasoningEffort:
          response.reasoningEffort === undefined
            ? reasoningEffort
            : response.reasoningEffort,
      });

      set({
        ...syncThreadToStore(thread.id, thread, [], {
          activate: options?.shouldActivate?.() ?? true,
        }),
      });

      console.log("[CodexService] threadStart completed successfully");
      return thread;
    } catch (error: unknown) {
      console.error("[CodexService] threadStart error:", error);
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
    },
  ) {
    if (!overrides && pendingThreadResumes.has(threadId))
      return pendingThreadResumes.get(threadId);
    const version = Symbol(threadId);
    resumeVersions.set(threadId, version);
    const controller = new AbortController();
    historyControllers.set(threadId, controller);
    const cancel = () => controller.abort(options?.signal?.reason);
    if (options?.signal?.aborted) cancel();
    else options?.signal?.addEventListener("abort", cancel, { once: true });
    const cached =
      useCodexStore.getState().historyLoadedMap[threadId] ||
      (useCodexStore.getState().events[threadId]?.length ?? 0) > 0;
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
      const modelRevision =
        useThreadModelStore.getState().threads[threadId]?.revision ?? 0;
      const response = await enqueueSessionRead(
        options?.recent ? "recent" : "history",
        `${runtimeEpoch}:${threadId}`,
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
                          : baseline.turnTimingMap[threadId]?.turnId
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
            options?.recent ? 5000 : 15000,
            controller.signal,
          ),
      );
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
      hydrateThreadModel(
        threadId,
        {
          model:
            ("model" in response ? response.model : undefined) ??
            settings.model,
          modelProvider:
            ("modelProvider" in response
              ? response.modelProvider
              : undefined) ??
            (settings.modelProvider || undefined),
          reasoningEffort:
            "reasoningEffort" in response &&
            response.reasoningEffort !== undefined
              ? response.reasoningEffort
              : settings.reasoningEffort,
        },
        {
          revision: modelRevision,
          notify: !!baseline.historyLoadedMap[threadId],
        },
      );
      const historicalEvents = convertThreadHistoryToEvents(thread);
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
        page &&
        baseline.historyLoadedMap[threadId] &&
        !options?.cursor &&
        s.cursors[threadId] !== undefined
          ? s
          : { cursors: { ...s.cursors, [threadId]: page?.nextCursor ?? null } },
      );
      const unchanged =
        page &&
        current.historyLoadedMap[threadId] &&
        reconciledEvents === current.events[threadId] &&
        JSON.stringify(restored.turnTimingMap?.[threadId]) ===
          JSON.stringify(current.turnTimingMap[threadId]);
      if (!unchanged)
        useCodexStore.setState({
          ...restored,
          ...(page ? { threadStatusMap: current.threadStatusMap } : {}),
          ...(options?.background && current.currentThreadId === threadId
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
      if (page) readInitialThreadMetadata(threadId);
    })();
    if (!overrides) pendingThreadResumes.set(threadId, pending);
    try {
      await pending;
    } catch (error: unknown) {
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
      if (pendingThreadResumes.get(threadId) === pending)
        pendingThreadResumes.delete(threadId);
    }
  },
  async loadEarlierHistory(threadId: string) {
    const state = useSessionSyncStore.getState();
    const cursor = state.cursors[threadId];
    if (
      !cursor ||
      state.earlierLoading[threadId] ||
      pendingThreadResumes.has(threadId)
    )
      return;
    useSessionSyncStore.setState((s) => ({
      earlierLoading: { ...s.earlierLoading, [threadId]: true },
      earlierErrors: { ...s.earlierErrors, [threadId]: "" },
    }));
    try {
      await codexService.loadThreadHistory(threadId, undefined, {
        background: true,
        recent: true,
        cursor,
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
  async threadFork(threadId: string) {
    const set = useCodexStore.setState;
    try {
      const params: ThreadForkParams = {
        threadId,
      };
      const response = await threadFork(params);
      hydrateThreadModel(response.thread.id, response);
      return applyThreadMutation(set, response.thread.id, response.thread);
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
      throw new Error("回滚正在进行，请等待完成后再编辑。");
    }
    const state = useCodexStore.getState();
    if (codexRuntimeState(state, threadId).running) {
      throw new Error("请先停止当前任务，再回滚编辑消息。");
    }
    if (!Number.isInteger(numTurns) || numTurns < 1)
      throw new Error("无效的回滚轮数。");
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
            durationMs: lastTurn.durationMs,
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
  ) {
    const set = useCodexStore.setState;
    const epoch = runtimeEpoch;
    const timingAtRequest = useCodexStore.getState().turnTimingMap[threadId];
    try {
      const userInputs = buildUserInputs(input, images);

      const { approvalPolicy, sandbox, webSearchRequest, collaborationMode } =
        useConfigStore.getState();
      const { model, reasoningEffort } = getThreadModelSettings(threadId);

      const response = await turnStart({
        threadId,
        ...(clientUserMessageId ? { clientUserMessageId } : {}),
        input: userInputs,
        cwd: resolveThreadCwd(threadId),
        approvalPolicy,
        sandboxPolicy: sandboxModeToPolicy(sandbox, webSearchRequest),
        model: model || null,
        effort: reasoningEffort ?? null,
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
      });

      if (epoch !== runtimeEpoch)
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
                    durationMs: response.turn.durationMs,
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
      const response = await threadGoalSet(params);
      return response;
    } catch (error: unknown) {
      console.error("[CodexService] threadGoalSet error:", error);
      throw error;
    }
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
      const response = await threadGoalClear(params);
      return response;
    } catch (error: unknown) {
      console.error("[CodexService] threadGoalClear error:", error);
      throw error;
    }
  },
};
