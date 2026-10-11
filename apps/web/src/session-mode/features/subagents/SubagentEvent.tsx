import { useId } from "react";
import { NativeCommandChevron } from "@session/components/codex/presentation/NativeCommandIcons";
import { NativeCadencedShimmer } from "@session/components/codex/presentation/NativeCadencedShimmer";
import { useTranscriptState } from "@session/components/codex/thread/rowState";
import { openSubagents } from "./service";
import { useSubagentStore } from "./store";
import "./subagents.css";

// VSIX sites-end-resource: LC action/status messages from the original zh-CN
// bundle. Aliases share native sendInput wording; wait has no visible row.
const actionLabels: Record<string, readonly string[]> = {
  spawnAgent: ["创建中", "已创建", "创建失败"],
  sendInput: ["正在发送消息", "已发送消息", "无法发送消息"],
  resumeAgent: ["正在恢复", "已恢复", "无法恢复"],
  closeAgent: ["正在关闭", "已关闭", "无法关闭"],
  interruptAgent: ["正在中断", "已中断", "中断未成功"],
  listAgents: ["房源", "挂牌", "列出未成功"],
};
const actionAlias: Record<string, string> = {
  sendMessage: "sendInput",
  followupTask: "sendInput",
};
function actionLabel(tool: string, status: string) {
  if (status === "interrupted") return "已中断";
  const index = ["inProgress", "completed", "failed"].indexOf(status);
  return index < 0
    ? "子任务活动"
    : (actionLabels[actionAlias[tool] ?? tool]?.[index] ?? "子任务活动");
}
/** Native jS(agentPath), before selecting the fallback name. */
function pathName(path: unknown) {
  if (typeof path !== "string") return null;
  const last = path
    .split("/")
    .map((s) => s.trim())
    .filter((s) => s && s !== "root")
    .at(-1);
  const name = last
    ?.replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return name ? name[0].toUpperCase() + name.slice(1) : null;
}

export function SubagentEvent({ root, item }: { root: string; item: any }) {
  const nodes = useSubagentStore((s) => s.nodes);
  const labelId = useId();
  const [expanded, setExpanded] = useTranscriptState(
    `native-collaboration:${item.id}`,
    false,
  );
  if (item.type === "collabAgentToolCall" && item.tool === "wait") return null;
  const open = (id: string) => {
    let parent = root;
    const seen = new Set<string>();
    while (nodes[parent] && !seen.has(parent)) {
      seen.add(parent);
      parent = nodes[parent].parentId;
    }
    openSubagents(parent, id);
  };
  if (item.type === "subAgentActivity") {
    const name = pathName(item.agentPath) ?? "智能体";
    if (item.kind === "interacted")
      return (
        <div className="codex-native-subagent-activity">
          {pathName(item.agentPath)
            ? `已向 ${name} 发送消息`
            : "已向父代理发送消息"}
        </div>
      );
    const statuses: Record<string, string> = {
      started: "开始工作",
      completed: "已完成",
      interrupted: "已中断",
    };
    const label = `${name} ${statuses[item.kind] ?? "已更新"}`;
    return (
      <button
        type="button"
        className="codex-native-subagent-activity"
        aria-label={`打开子智能体 ${name}`}
        onClick={() => open(item.agentThreadId)}
      >
        {label}
      </button>
    );
  }
  const ids = [
    ...new Set<string>([
      ...(item.receiverThreadIds ?? []),
      ...(item.receiverThreads ?? []).map((receiver: any) => receiver.threadId),
      ...Object.keys(item.agentsStates ?? {}),
    ]),
  ];
  const label = actionLabel(item.tool, item.status);
  return (
    <div className="codex-activity-group codex-native-activity-group">
      <div className="codex-native-activity-header">
        <button
          type="button"
          className="codex-native-activity-disclosure"
          aria-labelledby={labelId}
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        />
        <span className="codex-command-summary-content" id={labelId}>
          {item.status === "inProgress" ? (
            <NativeCadencedShimmer>{label}</NativeCadencedShimmer>
          ) : (
            label
          )}
          {ids.length ? `${ids.length} 个智能体` : ""}
        </span>
        <NativeCommandChevron
          className="codex-command-chevron"
          data-expanded={expanded}
        />
      </div>
      {expanded && (
        <div className="codex-activity-body">
          {ids.map((id) => (
            <div key={id}>
              {label}{" "}
              <button type="button" onClick={() => open(id)}>
                {nodes[id]?.thread.agentNickname ??
                  nodes[id]?.thread.name ??
                  id.slice(0, 8)}
              </button>
            </div>
          ))}
          {item.prompt && <p className="line-clamp-2">{item.prompt}</p>}
        </div>
      )}
    </div>
  );
}
