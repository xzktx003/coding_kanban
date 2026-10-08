import { openSubagents } from "./service";
import { useSubagentStore } from "./store";
export function SubagentEvent({ root, item }: { root: string; item: any }) {
  const nodes = useSubagentStore((s) => s.nodes);
  const ids: string[] =
    item.type === "subAgentActivity"
      ? [item.agentThreadId]
      : [
          ...new Set<string>([
            ...(item.receiverThreadIds ?? []),
            ...Object.keys(item.agentsStates ?? {}),
          ]),
        ];
  const labels: Record<string, string> = {
    spawnAgent: "创建子任务",
    sendInput: "向子任务发送指令",
    resumeAgent: "恢复子任务",
    wait: "等待子任务",
    closeAgent: "关闭子任务",
  };
  return (
    <div className="session-subagent-summary">
      <small>
        {labels[item.tool] ?? "子任务活动"} · {item.status ?? item.kind}
      </small>
      {ids.map((id) => (
        <button
          type="button"
          key={id}
          onClick={() => {
            let parent = root;
            const seen = new Set<string>();
            while (nodes[parent] && !seen.has(parent)) {
              seen.add(parent);
              parent = nodes[parent].parentId;
            }
            openSubagents(parent, id);
          }}
        >
          {nodes[id]?.thread.agentNickname ??
            nodes[id]?.thread.name ??
            id.slice(0, 8)}
        </button>
      ))}
      {item.prompt && (
        <p className="line-clamp-2 text-xs text-muted-foreground">
          {item.prompt}
        </p>
      )}
    </div>
  );
}
