import type { GuardianApprovalReview } from "@session/bindings/v2/GuardianApprovalReview";
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};
const text = (value: unknown) => (typeof value === "string" ? value : "");
/** Original zIi action summary; only actual public action fields are interpolated. */
export function nativeAutomaticReviewActionLabel(
  value: unknown,
  language = "zh",
) {
  const action = object(value),
    chinese = language.startsWith("zh");
  switch (action.type) {
    case "command":
      return text(action.command);
    case "execve":
      return [
        text(action.program),
        ...(Array.isArray(action.argv)
          ? action.argv.filter((arg): arg is string => typeof arg === "string")
          : []),
      ].join(" ");
    case "writeStdin":
      return chinese
        ? `向进程 ${action.processId} 发送输入：${text(action.stdin)}`
        : `Send input to process ${action.processId}: ${text(action.stdin)}`;
    case "applyPatch": {
      const files = Array.isArray(action.files) ? action.files : [];
      return files.length === 1
        ? chinese
          ? `正在编辑 ${files[0]}`
          : `Editing ${files[0]}`
        : chinese
          ? `正在编辑 ${files.length} 个文件`
          : `Editing ${files.length} files`;
    }
    case "networkAccess":
      return chinese
        ? `通过网络访问 ${text(action.target)}`
        : `Network access to ${text(action.target)}`;
    case "mcpToolCall": {
      const connector = text(action.connectorName) || text(action.server),
        tool = text(action.toolName);
      return chinese
        ? `${connector} 上的 MCP ${tool}`
        : `MCP ${tool} on ${connector}`;
    }
    case "requestPermissions":
      return action.reason == null
        ? chinese
          ? "权限请求"
          : "Permission request"
        : chinese
          ? `权限请求：${text(action.reason)}`
          : `Permission request: ${text(action.reason)}`;
    default:
      return chinese ? "请求" : "Request";
  }
}
export function nativeAutomaticReviewTitle(
  review: GuardianApprovalReview,
  language = "zh",
) {
  const chinese = language.startsWith("zh");
  return {
    inProgress: chinese ? "自动审核中" : "Auto-reviewing",
    approved: chinese ? "自动审核已批准" : "Auto-review approved",
    denied:
      review.riskLevel === "high"
        ? chinese
          ? "自动审核已拒绝高风险操作"
          : "Auto-review denied high risk"
        : chinese
          ? "自动审核已拒绝"
          : "Auto-review denied",
    timedOut: chinese ? "自动审核超时" : "Auto-review timed out",
    aborted: chinese ? "自动审核已停止" : "Auto-review stopped",
  }[review.status];
}
export function nativeAutomaticReviewRationale(
  review: GuardianApprovalReview,
  language = "zh",
) {
  if (review.rationale?.trim()) return review.rationale.trim();
  const chinese = language.startsWith("zh");
  if (review.status === "inProgress")
    return chinese
      ? "经过精心提示的审查智能体正在审查此请求，随后 ChatGPT 才会运行它"
      : "A carefully prompted reviewer agent is reviewing this request before ChatGPT runs it";
  if (review.status === "aborted")
    return chinese
      ? "经过精心提示的审查智能体在 ChatGPT 运行此请求前已停止审查此请求"
      : "A carefully prompted reviewer agent stopped reviewing this request before ChatGPT ran it";
  if (review.status === "timedOut")
    return chinese
      ? "经过精心提示的审查智能体在 ChatGPT 运行此请求前已超时。"
      : "A carefully prompted reviewer agent timed out before ChatGPT ran this request";
  return chinese
    ? "经优化提示的审查智能体已审查此请求。"
    : "A carefully prompted reviewer agent reviewed this request.";
}
