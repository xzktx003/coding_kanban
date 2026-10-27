import type { Thread } from "@session/bindings/v2";
import type { AgentCenterCard } from "@session/stores/useAgentCenterStore";
import { useAgentCenterStore } from "@session/stores/useAgentCenterStore";
import { useCodexStore } from "@session/components/codex/stores";
import { useAgentSettingsStore } from "@session/stores/useAgentSettingsStore";
import { useWorkspaceStore } from "@session/stores/useWorkspaceStore";
import { useLayoutStore } from "@session/stores/useLayoutStore";
import { useAcpStore } from "@session/stores/useAcpStore";
import { threadRead } from "@session/services/apiAdapt/codex";
import { readWithDeadline } from "@session/services/sessionReadQueue";
import { captureCodexOperationScope, isCodexOperationScopeCurrent } from "@session/services/codexOperationScope";
import { useSessionNavigationGuard } from "@session/services/sessionNavigationGuard";
import {
  hydrateThreadModel,
  captureThreadModelRead,
} from "@session/stores/useThreadModelStore";
import { nativeThreadSettings } from "@session/services/nativeThreadSettings";
import { isSessionInteractionVisible } from "@session/session-dom";
import { convertThreadHistoryToEvents } from "@session/utils/threadHistoryConverter";
import { mergeThreadHistory } from "@session/utils/mergeThreadHistory";
import { useThreadLinkStore, type ThreadLinkTarget } from "./threadLinkStore";

const boundedId = (value: unknown): value is string =>
  typeof value === "string" &&
  value.trim().length > 0 &&
  value.length <= 512 &&
  !/[\u0000-\u001f]/.test(value);
function selection(viewOverride?: string) {
  const codex = useCodexStore.getState(),
    tabs = useAgentCenterStore.getState(),
    acp = useAcpStore.getState();
  return JSON.stringify([
    codex.currentThreadId,
    useAgentSettingsStore.getState().selectedAgent,
    tabs.currentAgentCardKind,
    tabs.currentAgentCardId,
    useWorkspaceStore.getState().cwd,
    viewOverride ?? useLayoutStore.getState().view,
    acp.active,
    acp.sessionId,
    isSessionInteractionVisible(),
  ]);
}
function validateThread(thread: Thread, chosen: ThreadLinkTarget) {
  if (!thread || thread.id !== chosen.threadId)
    throw new Error("会话链接未返回所选原生会话，未打开其他会话。");
  if (
    typeof thread.cwd !== "string" ||
    !thread.cwd.trim() ||
    thread.cwd.length > 4096 ||
    /[\u0000-\u001f]/.test(thread.cwd)
  )
    throw new Error("会话链接未返回有效的原项目目录，请重新读取历史。");
  if (!Array.isArray(thread.turns) || !thread.turns.length)
    throw new Error("会话链接没有可供查看的历史，请确认会话仍然可用。");
  if (
    thread.turns.length > 10_000 ||
    thread.turns.some(
      (turn) => !turn || !boundedId(turn.id) || !Array.isArray(turn.items),
    )
  )
    throw new Error("会话历史无效或过长，未打开链接。");
  if (chosen.turnId && !thread.turns.some((turn) => turn.id === chosen.turnId))
    throw new Error("会话链接所指轮次不可用，未跳到其他轮次。");
}
/** Initial account confirmation belongs to the existing read deadline. This
 * observes current state only; it never refreshes credentials or starts a task. */
function waitForInitialAccount(requestId: number, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      unsubscribeAccount();
      unsubscribeLink();
      signal.removeEventListener("abort", abort);
    };
    const finish = (ready: boolean) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(ready);
    };
    const abort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("账号确认尚未完成，会话链接读取已取消，请重试。"));
    };
    const check = () => {
      if (useThreadLinkStore.getState().requestId !== requestId) finish(false);
      else if (useCodexStore.getState().hasAccount !== null) finish(true);
    };
    const unsubscribeAccount = useCodexStore.subscribe(check);
    const unsubscribeLink = useThreadLinkStore.subscribe(check);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    else check();
  });
}
/** Opening a link reads history only. Ownership is acquired later solely by explicit execution operations. */
export async function openThreadLink(
  chosen: ThreadLinkTarget,
  selectTab: (card: AgentCenterCard) => void | Promise<void>,
): Promise<boolean> {
  let scope = captureCodexOperationScope();
  const source = Object.freeze({ ...chosen });
  if (
    !boundedId(source.threadId) ||
    (source.turnId !== undefined && !boundedId(source.turnId))
  )
    throw new Error("会话链接无效。");
  const intent = selection();
  let baseline = useCodexStore.getState().events[source.threadId] ?? [];
  let modelReadToken = captureThreadModelRead(source.threadId);
  const requestId = useThreadLinkStore.getState().requestId + 1;
  useThreadLinkStore.setState({
    requestId,
    loading: true,
    error: null,
    target: null,
  });
  try {
    const response = await readWithDeadline(
      async (signal) => {
        if (scope.hasAccount === null) {
          if (!(await waitForInitialAccount(requestId, signal))) return null;
          // The first successful account observation invalidates the initial
          // unknown scope. Capture only before sending, never after a response.
          // Keep the original navigation intent even if the user moved meanwhile.
          scope = captureCodexOperationScope();
          baseline = useCodexStore.getState().events[source.threadId] ?? [];
          modelReadToken = captureThreadModelRead(source.threadId);
        }
        return threadRead(
          { threadId: source.threadId },
          { signal, suppressToast: true },
        );
      },
      15_000,
    );
    if (!response) return false;
    if (!isCodexOperationScopeCurrent(scope))
      throw new Error("连接目标已切换，旧会话链接读取已忽略。");
    validateThread(response.thread, source);
    if (useThreadLinkStore.getState().requestId !== requestId) return false;
    hydrateThreadModel(
      source.threadId,
      nativeThreadSettings(response, response.thread),
      {
        readToken: modelReadToken,
        notify: !!useCodexStore.getState().historyLoadedMap[source.threadId],
      },
    );
    // Cache under the actual identity without activating input, adding interest, or replacing live events.
    const historical = convertThreadHistoryToEvents(response.thread);
    const cachedTurns = response.thread.turns;
    useCodexStore.setState((state) => ({
      threads: state.threads.some((thread) => thread.id === source.threadId)
        ? state.threads.map((thread) =>
            thread.id === source.threadId
              ? {
                  ...thread,
                  ...response.thread,
                  turns: cachedTurns,
                  ...(state.threadStatusMap[source.threadId]
                    ? { status: state.threadStatusMap[source.threadId] }
                    : {}),
                }
              : thread,
          )
        : [{ ...response.thread, turns: cachedTurns }, ...state.threads],
      events: {
        ...state.events,
        [source.threadId]: mergeThreadHistory(
          historical,
          baseline,
          state.events[source.threadId] ?? [],
        ),
      },
      historyLoadedMap: { ...state.historyLoadedMap, [source.threadId]: true },
      historyLoadingMap: {
        ...state.historyLoadingMap,
        [source.threadId]: false,
      },
      historyErrorMap: {
        ...state.historyErrorMap,
        [source.threadId]: undefined,
      },
    }));
    if (selection() !== intent) {
      useThreadLinkStore.setState({
        loading: false,
        retainedThreadId: source.threadId,
        error:
          "输入目标在读取链接期间已改变；历史已缓存，未自动加入关注或切换会话。",
      });
      return false;
    }
    const commitIntent = selection("agent");
    return await new Promise<boolean>((resolve, reject) => {
      let entered = false;
      let unsubscribe = () => {};
      useLayoutStore.getState().setView("agent", () => {
        entered = true;
        unsubscribe();
        if (
          useThreadLinkStore.getState().requestId !== requestId ||
          selection() !== commitIntent || !isCodexOperationScopeCurrent(scope)
        ) {
          if (useThreadLinkStore.getState().requestId === requestId)
            useThreadLinkStore.setState({
              loading: false,
              error: "当前输入目标已改变，未自动加入关注或切换会话。",
              target: null,
            });
          resolve(false);
          return;
        }
        const card: AgentCenterCard = {
          kind: "codex",
          id: source.threadId,
          cwd: response.thread.cwd,
          preview: response.thread.name || response.thread.preview,
        };
        useAgentCenterStore.getState().addAgentCard(card, { activate: false });
        useThreadLinkStore.setState({
          loading: false,
          target: source.turnId
            ? { threadId: source.threadId, turnId: source.turnId }
            : null,
        });
        try {
          Promise.resolve(selectTab(card)).then(() => resolve(true), reject);
        } catch (error) {
          reject(error);
        }
      });
      if (entered) return;
      const guard = useSessionNavigationGuard.getState().pending;
      if (!guard) {
        useThreadLinkStore.setState({ loading: false });
        resolve(false);
        return;
      }
      unsubscribe = useSessionNavigationGuard.subscribe((state) => {
        if (state.pending === guard) return;
        // Confirmation clears pending immediately before executing its callback.
        // Defer this cancellation check until that synchronous callback has run.
        queueMicrotask(() => {
          if (entered) return;
          unsubscribe();
          if (useThreadLinkStore.getState().requestId === requestId)
            useThreadLinkStore.setState({
              loading: false,
              error: null,
              target: null,
            });
          resolve(false);
        });
      });
    });
  } catch (error) {
    if (useThreadLinkStore.getState().requestId === requestId)
      useThreadLinkStore.setState({
        loading: false,
        error: error instanceof Error ? error.message : String(error),
        target: null,
      });
    throw error;
  }
}
