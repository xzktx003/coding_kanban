import {
  subagentParent,
  normalizeSubagentThread,
  type SubagentThread,
  type SubagentSnapshot,
  type SubagentStopTarget,
  type SubagentStopResult,
} from "@agent-orchestrator/shared";
type Call = (method: string, params: Record<string, unknown>) => Promise<any>;
export class CodexSubagents {
  private reads = new Map<string, Promise<SubagentThread>>();
  constructor(private call: Call) {}
  metadata(id: string): Promise<SubagentThread> {
    const existing = this.reads.get(id);
    if (existing) return existing;
    const pending = this.call("thread/metadata", { threadId: id })
      .then((result) => {
        if (result?.thread?.id !== id) throw new Error("线程身份未确认");
        return normalizeSubagentThread(result.thread as SubagentThread);
      })
      .finally(() => this.reads.delete(id));
    this.reads.set(id, pending);
    return pending;
  }
  async verify(
    root: string,
    id: string,
    record?: (thread: SubagentThread) => void,
  ): Promise<SubagentThread> {
    if (root === id) throw new Error("主会话不属于子任务操作范围");
    const seen = new Set<string>();
    let next = id,
      first: SubagentThread | undefined;
    const ancestors: SubagentThread[] = [];
    while (next !== root) {
      if (seen.has(next) || seen.size >= 64)
        throw new Error("子任务所属关系存在循环或过深");
      seen.add(next);
      const thread = await this.metadata(next);
      ancestors.push(thread);
      first ??= thread;
      const parent = subagentParent(thread);
      if (!parent) throw new Error("子任务所属关系未确认");
      next = parent;
    }
    for (const thread of ancestors) record?.(thread);
    return first!;
  }
  async discover(root: string, observed: string[]): Promise<SubagentSnapshot> {
    const nodes = new Map<string, SubagentThread>(),
      errors: string[] = [],
      unavailableIds: string[] = [];
    let complete = true;
    const pages = async (filter: Record<string, unknown>) => {
      const cursors = new Set<string>();
      let cursor: string | null = null;
      for (let page = 0; page < 100; page++) {
        const result = await this.call("thread/list", {
          sourceKinds: ["subAgentThreadSpawn"],
          ...filter,
          cursor,
          limit: 200,
          archived: false,
          useStateDbOnly: true,
        });
        if (!Array.isArray(result?.data)) throw new Error("子任务列表响应无效");
        for (const thread of result.data as SubagentThread[])
          if (
            typeof thread?.id === "string" &&
            thread.id !== root &&
            subagentParent(thread)
          )
            nodes.set(thread.id, normalizeSubagentThread(thread));
        if (result.nextCursor == null) return;
        if (
          typeof result.nextCursor !== "string" ||
          cursors.has(result.nextCursor)
        )
          throw new Error("子任务分页游标循环");
        cursors.add(result.nextCursor);
        cursor = result.nextCursor;
      }
      throw new Error("子任务分页未完成");
    };
    try {
      await pages({ ancestorThreadId: root });
    } catch (error) {
      // Capability fallback only; outages never initiate a broad scan.
      if (
        /unsupported|unknown field|invalid.*ancestor|not supported/i.test(
          String(error),
        )
      ) {
        try {
          const visited = new Set<string>(),
            queue = [root];
          while (queue.length && visited.size < 1000) {
            const parent = queue.shift()!;
            if (visited.has(parent)) continue;
            visited.add(parent);
            await pages({ parentThreadId: parent });
            for (const node of nodes.values())
              if (subagentParent(node) === parent) queue.push(node.id);
          }
          if (queue.length) throw new Error("子任务层级查询未完成");
        } catch (e) {
          complete = false;
          errors.push(String(e));
        }
      } else {
        complete = false;
        errors.push(String(error));
      }
    }
    // Events can outrun the state DB. Repair only observed IDs, with bounded concurrency.
    const missing = [...new Set(observed)].filter(
      (id) => id !== root && !nodes.has(id),
    );
    let index = 0;
    await Promise.all(
      [0, 1].map(async () => {
        while (index < missing.length) {
          const id = missing[index++];
          try {
            await this.verify(root, id, (thread) =>
              nodes.set(thread.id, thread),
            );
          } catch (e) {
            complete = false;
            unavailableIds.push(id);
            errors.push(`${id}: ${String(e)}`);
          }
        }
      }),
    );
    const belongs = (id: string) => {
      const seen = new Set<string>();
      let next: string | null = id;
      while (next !== root && next) {
        if (seen.has(next)) return false;
        seen.add(next);
        next = subagentParent(nodes.get(next) ?? { id: next });
      }
      return next === root;
    };
    const threads = [...nodes.values()].filter((n) => belongs(n.id));
    // Reconnects may have missed turn/started. Capture the real active turn
    // read-only so stop scope is precise rather than guessed from an active dot.
    let activeIndex = 0;
    const active = threads.filter(
      (t) => t.status?.type === "active" && !t.turns?.length,
    );
    await Promise.all(
      [0, 1].map(async () => {
        while (activeIndex < active.length) {
          const thread = active[activeIndex++];
          try {
            const page = await this.call("thread/turns/list", {
              threadId: thread.id,
              limit: 1,
              sortDirection: "desc",
              itemsView: "full",
            });
            if (!Array.isArray(page.data)) throw new Error("运行轮次尚未确认");
            thread.turns = page.data;
          } catch (e) {
            complete = false;
            errors.push(`${thread.id}: ${String(e)}`);
          }
        }
      }),
    );
    return { threads, complete, errors, unavailableIds, checkedAt: Date.now() };
  }
  async stop(
    root: string,
    targets: SubagentStopTarget[],
    stop: (id: string, turn: string) => Promise<unknown>,
  ): Promise<SubagentStopResult[]> {
    const results: SubagentStopResult[] = [];
    for (const target of targets) {
      let dispatched = false;
      try {
        const thread = await this.verify(root, target.threadId);
        let turns = thread.turns;
        if (!turns?.length) {
          const page = await this.call("thread/turns/list", {
            threadId: target.threadId,
            limit: 1,
            sortDirection: "desc",
            itemsView: "full",
          });
          turns = page.data;
        }
        const current = turns?.at(-1);
        if (current?.id !== target.turnId || current.status !== "inProgress") {
          results.push({
            ...target,
            phase: "superseded",
            message: "原执行已结束或当前轮次已改变，未发送停止请求",
          });
          continue;
        }
        dispatched = true;
        await stop(target.threadId, target.turnId);
        results.push({ ...target, phase: "requested" });
      } catch (e) {
        const message = String(e);
        results.push({
          ...target,
          phase:
            dispatched &&
            /DELIVERY_UNKNOWN|timeout|fetch failed|回执|连接失败/i.test(message)
              ? "uncertain"
              : "failed",
          message: dispatched ? message : `尚未发送停止请求：${message}`,
        });
      }
    }
    return results;
  }
}
