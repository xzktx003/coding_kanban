import type {
  SubagentSnapshot,
  SubagentThread,
  SubagentStopTarget,
  SubagentStopResult,
} from "@agent-orchestrator/shared";
import { postJsonWithOptions } from "@session/services/apiAdapt/shared";
import { useLayoutStore } from "@session/stores/useLayoutStore";
import { reconcileNodes } from "./model";
import { useSubagentStore, observedIds } from "./store";
import { subagentScope } from "./scope";
const pending = new Map<string, Promise<void>>();
let epoch = 0;
export function resetSubagentRuntime() {
  epoch++;
  pending.clear();
  useSubagentStore.setState((s) => ({
    families: {},
    stopResults: {},
    revision: s.revision + 1,
    runtimeEpoch: s.runtimeEpoch + 1,
    nodes: Object.fromEntries(
      Object.entries(s.nodes).map(([id, node]) => [
        id,
        {
          ...node,
          unavailable: true,
          revision: s.revision + 1,
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
export const subagentService = {
  refresh(root: string): Promise<void> {
    const version = epoch,
      scope = subagentScope();
    if (useSubagentStore.getState().scope !== scope) return Promise.resolve();
    if (pending.has(root)) return pending.get(root)!;
    const baseline = useSubagentStore.getState().revision;
    useSubagentStore.setState((s) => ({
      families: {
        ...s.families,
        [root]: {
          ...s.families[root],
          complete: s.families[root]?.complete ?? false,
          checkedAt: s.families[root]?.checkedAt ?? 0,
          loading: true,
        },
      },
    }));
    const task = post<SubagentSnapshot>("snapshot", {
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
        useSubagentStore.getState().apply(root, result, baseline);
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
    const result = await post<{
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
    useSubagentStore.setState((s) => ({
      nodes: reconcileNodes(
        s.nodes,
        result.threads ?? [result.thread],
        baseline,
      ),
    }));
    return result.thread;
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
    const result = await post<{
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
  if (selected !== undefined)
    useSubagentStore.setState((s) => ({
      selection: { ...s.selection, [root]: selected },
    }));
  const layout = useLayoutStore.getState();
  layout.setActiveRightPanelTab("subagents");
  layout.setRightPanelOpen(true);
  void subagentService.refresh(root);
}
