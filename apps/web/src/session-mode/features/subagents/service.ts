import {
  subagentParent,
  type SubagentSnapshot,
  type SubagentThread,
  type SubagentStopTarget,
  type SubagentStopResult,
} from "@agent-orchestrator/shared/session-subagents";
import { postJsonWithOptions } from "@session/services/apiAdapt/shared";
import { threadMetadata } from "@session/services/apiAdapt/codex";
import {
  enqueueSessionRead,
  readWithDeadline,
} from "@session/services/sessionReadQueue";
import {
  confirmSubagentMetadata,
  hasNewerSubagentMetadata,
  captureSubagentMetadataFence,
  resetSubagentMetadataFences,
  useSubagentStore,
  observedIds,
} from "./store";
import { boundedSubagentThread, descendants } from "./model";
import { subagentScope } from "./scope";
const pending = new Map<string, Promise<void>>();
const identityPending = new Map<
  string,
  {
    task: Promise<SubagentThread>;
    controller: AbortController;
    consumers: Set<symbol>;
    settled: boolean;
  }
>();
let epoch = 0;
let identityRead = 0;
export function resetSubagentRuntime() {
  epoch++;
  resetSubagentMetadataFences();
  pending.clear();
  for (const entry of identityPending.values()) entry.controller.abort();
  identityPending.clear();
  useSubagentStore.setState((s) => ({
    families: {},
    stopResults: {},
    identities: {},
    identityChecks: {},
    revision: s.revision + 1,
    runtimeEpoch: s.runtimeEpoch + 1,
    nodes: Object.fromEntries(
      Object.entries(s.nodes).map(([id, node]) => [
        id,
        {
          ...node,
          unavailable: true,
          verified: false,
          revision: s.revision + 1,
          metadataRevision: s.revision + 1,
          thread: {
            ...node.thread,
            status: { type: "notLoaded" },
            turns: undefined,
            canAcceptDirectInput: null,
          },
        },
      ]),
    ),
  }));
}
const current = (version: number, scope: string) =>
  version === epoch &&
  scope === subagentScope() &&
  useSubagentStore.getState().scope === scope;
const post = <T>(path: string, body: unknown) =>
  postJsonWithOptions<T>(`/subagents/${path}`, body, { suppressToast: true });
const read = <T>(path: string, body: unknown) =>
  readWithDeadline(
    (signal) =>
      postJsonWithOptions<T>(`/subagents/${path}`, body, {
        suppressToast: true,
        signal,
      }),
    15000,
  );
export const subagentService = {
  /** Coalesced, cancellable read-only identity recovery; never resumes a thread. */
  inspectIdentity(
    threadId: string,
    signal?: AbortSignal,
  ): Promise<SubagentThread> {
    const version = epoch,
      scope = subagentScope();
    if (!current(version, scope))
      return Promise.reject(new Error("会话服务已切换，请重新核对"));
    if (signal?.aborted)
      return Promise.reject(new DOMException("Aborted", "AbortError"));
    let entry = identityPending.get(threadId);
    if (!entry) {
      const baseline = useSubagentStore.getState().revision;
      const observationFence = captureSubagentMetadataFence();
      const controller = new AbortController();
      useSubagentStore.setState((s) => ({
        identityChecks: { ...s.identityChecks, [threadId]: { loading: true } },
      }));
      const task = enqueueSessionRead(
        "recent",
        `identity:${version}:${threadId}:${++identityRead}`,
        () =>
          readWithDeadline(
            (readSignal) =>
              threadMetadata(threadId, {
                signal: readSignal,
                suppressToast: true,
              }),
            5000,
            controller.signal,
          ),
      )
        .then((response) => {
          if (!current(version, scope) || controller.signal.aborted)
            throw new Error("运行实例已改变，旧身份结果已忽略");
          if (response.thread?.id !== threadId)
            throw new Error("线程身份尚未确认，请重新核对");
          confirmSubagentMetadata(
            [response.thread],
            baseline,
            observationFence,
          );
          // A newer native event may revoke permission while this read is in flight.
          // Return the accepted current identity, never the stale raw response.
          return (
            useSubagentStore.getState().identities[threadId]?.thread ??
            response.thread
          );
        })
        .catch((error) => {
          if (current(version, scope) && !controller.signal.aborted)
            useSubagentStore.setState((s) => ({
              identityChecks: {
                ...s.identityChecks,
                [threadId]: { loading: false, error: String(error) },
              },
            }));
          throw error;
        })
        .finally(() => {
          const running = identityPending.get(threadId);
          if (running?.task !== task) return;
          running.settled = true;
          identityPending.delete(threadId);
          if (current(version, scope))
            useSubagentStore.setState((s) => {
              const check = s.identityChecks[threadId];
              return check?.loading
                ? {
                    identityChecks: {
                      ...s.identityChecks,
                      [threadId]: { ...check, loading: false },
                    },
                  }
                : s;
            });
        });
      entry = { task, controller, consumers: new Set(), settled: false };
      identityPending.set(threadId, entry);
    }
    const chosen = entry;
    const consumer = Symbol(threadId);
    chosen.consumers.add(consumer);
    let aborted: (() => void) | undefined;
    return new Promise((resolve, reject) => {
      aborted = () => reject(new DOMException("Aborted", "AbortError"));
      signal?.addEventListener("abort", aborted, { once: true });
      chosen.task.then(resolve, reject);
    }).finally(() => {
      if (aborted) signal?.removeEventListener("abort", aborted);
      chosen.consumers.delete(consumer);
      if (!chosen.settled && !chosen.consumers.size) {
        chosen.controller.abort();
        if (identityPending.get(threadId) === chosen) {
          identityPending.delete(threadId);
          if (current(version, scope))
            useSubagentStore.setState((s) => ({
              identityChecks: {
                ...s.identityChecks,
                [threadId]: { loading: false },
              },
            }));
        }
      }
    }) as Promise<SubagentThread>;
  },
  refresh(root: string): Promise<void> {
    const version = epoch,
      scope = subagentScope();
    if (useSubagentStore.getState().scope !== scope) return Promise.resolve();
    if (pending.has(root)) return pending.get(root)!;
    const baseline = useSubagentStore.getState().revision;
    const observationFence = captureSubagentMetadataFence();
    useSubagentStore.setState((s) =>
      s.families[root]?.complete && !s.families[root]?.error
        ? s
        : {
            families: {
              ...s.families,
              [root]: {
                ...s.families[root],
                complete: s.families[root]?.complete ?? false,
                checkedAt: s.families[root]?.checkedAt ?? 0,
                loading: true,
              },
            },
          },
    );
    const task = read<SubagentSnapshot>("snapshot", {
      rootId: root,
      observedIds: observedIds(root),
    })
      .then((result) => {
        if (!current(version, scope)) return;
        if (
          !Array.isArray(result?.threads) ||
          typeof result.complete !== "boolean" ||
          !Array.isArray(result.errors)
        )
          throw new Error("子任务响应无效，状态尚未确认");
        useSubagentStore
          .getState()
          .apply(root, result, baseline, observationFence);
      })
      .catch((e) => {
        if (!current(version, scope)) return;
        useSubagentStore.setState((s) => ({
          families: {
            ...s.families,
            [root]: {
              ...s.families[root],
              complete: false,
              checkedAt: s.families[root]?.checkedAt ?? 0,
              loading: false,
              error: String(e),
            },
          },
        }));
      })
      .finally(() => {
        if (pending.get(root) === task) pending.delete(root);
      });
    pending.set(root, task);
    return task;
  },
  async verify(root: string, threadId: string) {
    const version = epoch,
      scope = subagentScope();
    if (!current(version, scope))
      throw new Error("会话服务已切换，请重新确认子任务");
    const baseline = useSubagentStore.getState().revision;
    const observationFence = captureSubagentMetadataFence();
    const result = await read<{
      thread: SubagentThread;
      threads?: SubagentThread[];
    }>("verify", {
      rootId: root,
      threadId,
    });
    if (!current(version, scope))
      throw new Error("运行实例已改变，操作尚未发送，请重新确认");
    if (result.thread?.id !== threadId)
      throw new Error("子任务身份尚未确认，未开放历史或输入");
    const nodes = useSubagentStore.getState().nodes;
    const latest = nodes[threadId];
    if (hasNewerSubagentMetadata(threadId, baseline, observationFence)) {
      const observed = boundedSubagentThread(result.thread);
      if (
        latest?.verified &&
        !latest.unavailable &&
        latest.parentId === subagentParent(observed) &&
        JSON.stringify(latest.thread.source ?? null) ===
          JSON.stringify(observed.source ?? null) &&
        (latest.thread.canAcceptDirectInput ?? null) ===
          (observed.canAcceptDirectInput ?? null) &&
        descendants(nodes, root).some((node) => node.thread.id === threadId)
      )
        return latest.thread;
      throw new Error("子任务身份或权限已更新，请重新确认");
    }
    confirmSubagentMetadata(
      result.threads ?? [result.thread],
      baseline,
      observationFence,
    );
    const node = useSubagentStore.getState().nodes[threadId];
    if (
      !node?.verified ||
      node.unavailable ||
      !descendants(useSubagentStore.getState().nodes, root).some(
        (node) => node.thread.id === threadId,
      )
    )
      throw new Error("子任务身份尚未确认，未开放历史或输入");
    return node.thread;
  },
  async stop(root: string, targets: SubagentStopTarget[]) {
    const version = epoch,
      scope = subagentScope();
    if (!current(version, scope))
      throw new Error("会话服务已切换，未发送停止请求");
    const result = await post<{ results: SubagentStopResult[] }>("stop", {
      rootId: root,
      targets,
    });
    if (!current(version, scope))
      throw new Error("运行实例已改变，原停止回执需重新核对");
    useSubagentStore.setState((s) => ({
      stopResults: { ...s.stopResults, [root]: result.results },
    }));
    await this.refresh(root);
    return result.results;
  },
  async roles(root: string) {
    const version = epoch,
      scope = subagentScope();
    if (!current(version, scope))
      throw new Error("会话服务已切换，请重新读取角色");
    const result = await read<{
      roles: { name: string; description: string }[];
    }>("roles", { rootId: root });
    if (!current(version, scope))
      throw new Error("运行实例已改变，请重新读取角色");
    if (
      !Array.isArray(result.roles) ||
      result.roles.some(
        (r) => typeof r?.name !== "string" || typeof r.description !== "string",
      )
    )
      throw new Error("角色配置尚未确认，请稍后重试");
    return result;
  },
};
export function openSubagents(root: string, selected?: string | null) {
  useSubagentStore.setState((s) => ({
    panelRoot: root,
    selection:
      selected === undefined
        ? s.selection
        : { ...s.selection, [root]: selected },
  }));
  void subagentService.refresh(root);
}

export function closeSubagents() {
  useSubagentStore.setState({ panelRoot: null });
}
