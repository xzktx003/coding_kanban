import type { FollowupMessage } from "@agent-orchestrator/shared";
export function FollowupSnapshot({ message }: { message: FollowupMessage }) {
  if (message.authority === "native") return <div className="session-followup-snapshot" aria-label="官方队列执行设置"><p>由官方服务排队，按线程当前设置执行。修改线程模型与权限会影响尚未开始的消息。</p><small>图片 {message.images.length} · 用户输入保留在官方队列</small></div>;
  const p = message.parameters,
    policy = p.sandboxPolicy as { type?: string } | undefined,
    mode = p.collaborationMode as { mode?: string } | undefined;
  const permission =
    policy?.type === "dangerFullAccess"
      ? "完全访问"
      : policy?.type === "workspaceWrite"
        ? "工作区写入"
        : policy?.type === "readOnly"
          ? "只读"
          : (policy?.type ?? "未指定");
  return (
    <div className="session-followup-snapshot" aria-label="入队时的发送配置">
      <div className="session-followup-badges">
        <span>Codex · {String(p.model ?? "服务默认模型")}</span>
        <span>思考强度：{String(p.effort ?? "默认")}</span>
        <span>{permission}</span>
        <span>{mode?.mode === "plan" ? "计划模式" : "执行模式"}</span>
      </div>
      <p>使用入队时的配置，后续设置不会改变本条消息。</p>
      <small>
        项目：{String(p.cwd ?? "当前会话目录")} · 图片 {message.images.length} ·
        上下文 {message.contexts?.length ?? 0}
      </small>
      {message.contexts?.map((c) => (
        <details key={c.id}>
          <summary>
            {c.name}
            {c.range ? ` · L${c.range.start}–${c.range.end}` : ""}
          </summary>
          <small>{c.path ?? c.sourceThreadId}</small>
          <pre>{c.text}</pre>
        </details>
      ))}
    </div>
  );
}
