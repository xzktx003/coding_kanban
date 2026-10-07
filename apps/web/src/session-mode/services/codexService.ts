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
import {
  threadStart as apiThreadStart,
  gitCreateWorktree,
  listThreads,
  skillList,
  threadCompactStart,
  threadFork,
  threadGoalClear,
  threadGoalSet,
  threadResume,
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
    ...(thread.status
      ? { threadStatusMap: { ...threadStatusMap, [threadId]: thread.status } }
      : {}),
    ...(lastTurn
      ? {
          turnTimingMap: {
            ...turnTimingMap,
            [threadId]: {
              turnId: lastTurn.id,
              startedAtMs: (lastTurn.startedAt ?? 0) * 1000,
              durationMs: lastTurn.durationMs,
              status: lastTurn.status,
            },
          },
        }
      : {}),
    ...(activate
      ? {
          currentTurnId:
            !resetCurrentTurnId && lastTurn?.status === "inProgress"
              ? lastTurn.id
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
const pendingThreadResumes = new Map<string, Promise<void>>();
const resumeVersions = new Map<string, symbol>();

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
    // Live threads (already in activeThreadIds with cached events) just
    // switch view + derive activeTurnId. Dormant threads are resumed
    // automatically so the agent process is ready for the next message.
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

      if (state.activeThreadIds.includes(threadId) && state.events[threadId]) {
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
      } else {
        // Dormant — switch view and resume the agent process immediately.
        set((state) => ({
          currentThreadId: threadId,
          currentTurnId: null,
          inputFocusTrigger: state.inputFocusTrigger + 1,
        }));
        await codexService.threadResume(threadId);
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
      if (!model && response.model)
        useConfigStore.getState().setModel(response.model);

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
  async threadResume(
    threadId: string,
    overrides?: Omit<ThreadResumeParams, "threadId">,
  ) {
    if (!overrides && pendingThreadResumes.has(threadId))
      return pendingThreadResumes.get(threadId);
    const version = Symbol(threadId);
    resumeVersions.set(threadId, version);
    useCodexStore.setState((state) => ({
      historyLoadingMap: { ...state.historyLoadingMap, [threadId]: true },
      historyErrorMap: { ...state.historyErrorMap, [threadId]: undefined },
    }));
    const pending = (async () => {
      const response = await threadResume({
        threadId,
        ...overrides,
        config: {
          "features.default_mode_request_user_input": true,
          ...overrides?.config,
        },
      });
      if (resumeVersions.get(threadId) !== version) return;
      const historicalEvents = convertThreadHistoryToEvents(response.thread);
      // A response belongs to its thread even if the user has since selected another.
      useCodexStore.setState(
        syncThreadToStore(threadId, response.thread, historicalEvents, {
          activate: useCodexStore.getState().currentThreadId === threadId,
        }),
      );
    })();
    if (!overrides) pendingThreadResumes.set(threadId, pending);
    try {
      await pending;
    } catch (error: unknown) {
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
      if (resumeVersions.get(threadId) === version) {
        resumeVersions.delete(threadId);
        useCodexStore.setState((state) => ({
          historyLoadingMap: { ...state.historyLoadingMap, [threadId]: false },
        }));
      }
      if (pendingThreadResumes.get(threadId) === pending)
        pendingThreadResumes.delete(threadId);
    }
  },
  async threadFork(threadId: string) {
    const set = useCodexStore.setState;
    try {
      const params: ThreadForkParams = {
        threadId,
      };
      const response = await threadFork(params);
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
    if (
      state.threadStatusMap[threadId]?.type === "active" ||
      state.turnTimingMap[threadId]?.status === "inProgress"
    ) {
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
      // A pre-rollback history request must not restore discarded turns later.
      resumeVersions.delete(threadId);
      const active = useCodexStore.getState().currentThreadId === threadId;
      useCodexStore.setState(
        syncThreadToStore(
          threadId,
          response.thread,
          convertThreadHistoryToEvents(response.thread),
          { resetCurrentTurnId: active, activate: active },
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
  async turnStart(threadId: string, input: string, images: string[] = []) {
    const set = useCodexStore.setState;
    const timingAtRequest = useCodexStore.getState().turnTimingMap[threadId];
    try {
      const userInputs = buildUserInputs(input, images);

      const {
        model,
        reasoningEffort,
        approvalPolicy,
        sandbox,
        webSearchRequest,
        collaborationMode,
      } = useConfigStore.getState();

      const response = await turnStart({
        threadId,
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
  ) {
    try {
      const userInputs = buildUserInputs(input, images);

      const response = await turnSteer({
        threadId,
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
