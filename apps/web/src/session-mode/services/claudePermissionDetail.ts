import { ccReadPermissionDetail } from "./apiAdapt/cc";
import type { PermissionRequestMessage } from "../components/cc/types/messages";
/** Explicit user read, bounded to the runtime's 8 MiB retained-input ceiling. */
export async function readClaudePermissionInput(
  request: PermissionRequestMessage,
  signal?: AbortSignal,
) {
  if (
    !request.recoveryRuntimeInstance ||
    !request.inputAvailable ||
    !request.inputRevision
  )
    throw new Error(request.inputError ?? "完整审批参数不可用，可拒绝此请求。");
  let offset = 0,
    bytes = 0;
  const parts: string[] = [],
    encoder = new TextEncoder();
  for (let pages = 0; pages < 2048; pages++) {
    const page = await ccReadPermissionDetail(
      request.sessionId,
      request.requestId,
      request.recoveryRuntimeInstance,
      offset,
      request.inputRevision,
      signal,
    );
    if (signal?.aborted) throw signal.reason;
    if (
      page.itemRevision !== request.inputRevision ||
      page.format !== "json" ||
      typeof page.text !== "string" ||
      !page.text.length ||
      encoder.encode(JSON.stringify(page)).length > 65536
    )
      throw new Error("审批参数详情身份或分片无效");
    parts.push(page.text);
    bytes += encoder.encode(page.text).length;
    if (bytes > 8 * 1024 * 1024)
      throw new Error("审批参数超过可安全展示的预算");
    if (page.nextOffset === null) {
      const input: unknown = JSON.parse(parts.join(""));
      if (!input || typeof input !== "object" || Array.isArray(input))
        throw new Error("审批参数格式无效");
      return input as Record<string, unknown>;
    }
    if (
      !Number.isInteger(page.nextOffset) ||
      page.nextOffset <= offset ||
      page.nextOffset !== offset + page.text.length
    )
      throw new Error("审批参数详情游标无效");
    offset = page.nextOffset;
  }
  throw new Error("审批参数详情分页超过安全预算");
}
