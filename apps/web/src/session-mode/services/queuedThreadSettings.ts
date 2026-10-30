import { lifecycleContext } from "./resumeInterruptedTurn";
import {
  getJsonWithOptions,
  postJsonWithOptions,
  isExplicitRequestRejection,
} from "./apiAdapt/shared";
import {
  captureCodexOperationScope,
  isCodexOperationScopeCurrent,
} from "./codexOperationScope";
import { newSessionEditId } from "./sessionEditIdentity";
import { readWithDeadline } from "./sessionReadQueue";

export interface QueuedSettingsReceipt {
  operationId: string;
  threadId: string;
  status: "accepted" | "rejected" | "unknown";
  error?: string;
}
interface Saved extends QueuedSettingsReceipt {
  namespace: string;
}
const key = "session-queued-settings-receipts-v1";
function read(): Saved[] {
  const rows: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
  if (
    !Array.isArray(rows) ||
    rows.length > 50 ||
    rows.some(
      (row) =>
        !row ||
        [row.namespace, row.operationId, row.threadId].some(
          (value) => typeof value !== "string" || !value || value.length > 4096,
        ) ||
        !["accepted", "rejected", "unknown"].includes(row.status),
    )
  )
    throw new Error("队列设置回执损坏，请先核对运行状态");
  return rows;
}
function save(value: Saved) {
  const { namespace, operationId, threadId, status } = value;
  const rows = [
    ...read().filter((row) => row.operationId !== operationId),
    { namespace, operationId, threadId, status },
  ];
  while (rows.length > 50) {
    const settled = rows.findIndex(
      (row) => row.operationId !== operationId && row.status !== "unknown",
    );
    if (settled < 0) throw new Error("待核对的设置操作过多，请先核对已有结果");
    rows.splice(settled, 1);
  }
  localStorage.setItem(key, JSON.stringify(rows));
}
export async function applyQueuedThreadSettings(
  threadId: string,
  parameters: Record<string, unknown>,
): Promise<QueuedSettingsReceipt> {
  const scope = captureCodexOperationScope(),
    context = await lifecycleContext();
  if (!isCodexOperationScopeCurrent(scope))
    throw new Error("账号或运行服务已变化，请重新确认");
  const previous = read()
    .reverse()
    .find(
      (row) =>
        row.namespace === context.namespace &&
        row.threadId === threadId &&
        row.status === "unknown",
    );
  const intent: Saved = previous ?? {
    namespace: context.namespace,
    operationId: newSessionEditId(),
    threadId,
    status: "unknown",
  };
  if (!previous) save(intent);
  try {
    const response = previous
      ? await readWithDeadline(
          (signal) =>
            getJsonWithOptions<QueuedSettingsReceipt>(
              `/lifecycle/settings?operationId=${encodeURIComponent(intent.operationId)}&expectedScope=${encodeURIComponent(context.scopeToken)}`,
              { signal, suppressToast: true },
            ),
          10_000,
        )
      : await readWithDeadline(
          (signal) =>
            postJsonWithOptions<QueuedSettingsReceipt>(
              "/lifecycle/settings",
              {
                operationId: intent.operationId,
                threadId,
                expectedScope: context.scopeToken,
                parameters,
              },
              { signal, suppressToast: true },
            ),
          30_000,
        );
    if (!isCodexOperationScopeCurrent(scope)) return intent;
    if (
      !response ||
      response.operationId !== intent.operationId ||
      response.threadId !== threadId ||
      !["accepted", "rejected", "unknown"].includes(response.status)
    )
      throw new Error("队列设置回执不匹配");
    const result = {
      ...intent,
      status: response.status,
      ...(response.error ? { error: response.error.slice(0, 1000) } : {}),
    };
    save(result);
    return result;
  } catch (error) {
    const result: Saved = {
      ...intent,
      status:
        !previous && isExplicitRequestRejection(error) ? "rejected" : "unknown",
      error: error instanceof Error ? error.message : "设置结果待核对",
    };
    save(result);
    return result;
  }
}
