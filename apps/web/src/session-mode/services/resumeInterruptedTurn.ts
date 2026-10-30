import {
  getJsonWithOptions,
  postJsonWithOptions,
  isExplicitRequestRejection,
} from "./apiAdapt/shared";
import { readWithDeadline } from "./sessionReadQueue";
import {
  captureCodexOperationScope,
  isCodexOperationScopeCurrent,
} from "./codexOperationScope";
import { newSessionEditId } from "./sessionEditIdentity";

export interface ResumeReceipt {
  operationId: string;
  threadId: string;
  sourceTurnId: string;
  status: "accepted" | "rejected" | "unknown";
  turnId?: string;
  error?: string;
}
const storageKey = "session-resume-receipts-v1";
interface SavedReceipt extends ResumeReceipt {
  namespace: string;
}
function read(): SavedReceipt[] {
  try {
    const data = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
    if (
      !Array.isArray(data) ||
      data.length > 50 ||
      data.some(
        (row) =>
          !row ||
          [row.namespace, row.operationId, row.threadId, row.sourceTurnId].some(
            (value) =>
              typeof value !== "string" || !value || value.length > 4096,
          ) ||
          !["accepted", "rejected", "unknown"].includes(row.status),
      )
    )
      throw new Error("invalid receipt");
    return data;
  } catch {
    throw new Error("无法读取继续任务的回执，请先恢复浏览器存储");
  }
}
function write(receipt: ResumeReceipt, namespace: string) {
  const rows = read().filter((row) => row.operationId !== receipt.operationId);
  // Store only bounded receipt metadata, never message content or permissions.
  const saved: SavedReceipt = {
    namespace,
    operationId: receipt.operationId,
    threadId: receipt.threadId,
    sourceTurnId: receipt.sourceTurnId,
    status: receipt.status,
    ...(receipt.turnId ? { turnId: receipt.turnId } : {}),
  };
  const next = [...rows, saved];
  while (next.length > 50) {
    const settled = next.findIndex(
      (row) =>
        row.status !== "unknown" && row.operationId !== saved.operationId,
    );
    if (settled < 0) throw new Error("待核对的继续任务过多，请先核对已有回执");
    next.splice(settled, 1);
  }
  localStorage.setItem(storageKey, JSON.stringify(next));
}
export async function lifecycleContext(): Promise<{
  namespace: string;
  scopeToken: string;
}> {
  const value = await readWithDeadline(
    (signal) =>
      getJsonWithOptions<{ namespace: string; scopeToken: string }>(
        "/lifecycle/context",
        { signal, suppressToast: true },
      ),
    10_000,
  );
  if (
    !value ||
    typeof value.namespace !== "string" ||
    !value.namespace ||
    typeof value.scopeToken !== "string" ||
    !value.scopeToken
  )
    throw new Error("账号与运行范围尚未确认，请稍后继续");
  return value;
}
export async function savedResumeReceipt(
  threadId: string,
  sourceTurnId: string,
): Promise<ResumeReceipt | undefined> {
  const { namespace: account } = await lifecycleContext();
  return read()
    .reverse()
    .find(
      (row) =>
        row.namespace === account &&
        row.threadId === threadId &&
        row.sourceTurnId === sourceTurnId,
    );
}
function checked(receipt: unknown, expected: ResumeReceipt): ResumeReceipt {
  const row = receipt as Partial<ResumeReceipt> | null;
  if (
    !row ||
    row.operationId !== expected.operationId ||
    row.threadId !== expected.threadId ||
    !["accepted", "rejected", "unknown"].includes(row.status ?? "")
  )
    throw new Error("继续任务的回执身份不匹配，需核对状态");
  return {
    ...expected,
    status: row.status!,
    ...(typeof row.turnId === "string" ? { turnId: row.turnId } : {}),
    ...(typeof row.error === "string"
      ? { error: row.error.slice(0, 1000) }
      : {}),
  };
}
export async function reconcileResumeReceipt(
  receipt: ResumeReceipt,
): Promise<ResumeReceipt> {
  const scope = captureCodexOperationScope(),
    { namespace: account, scopeToken } = await lifecycleContext();
  const response = await readWithDeadline(
    (signal) =>
      getJsonWithOptions<unknown>(
        `/lifecycle/resume?operationId=${encodeURIComponent(receipt.operationId)}&expectedScope=${encodeURIComponent(scopeToken)}`,
        { signal, suppressToast: true },
      ),
    10_000,
  );
  if (!isCodexOperationScopeCurrent(scope))
    throw new Error("账号或运行服务已变化，继续任务状态待核对");
  const result = checked(response, receipt);
  write(result, account);
  return result;
}
export async function resumeInterruptedTurn(
  threadId: string,
  sourceTurnId: string,
  parameters: Record<string, unknown>,
): Promise<ResumeReceipt> {
  const scope = captureCodexOperationScope(),
    { namespace: account, scopeToken } = await lifecycleContext();
  if (!isCodexOperationScopeCurrent(scope))
    throw new Error("账号或运行服务已变化，请重新确认继续操作");
  const existing = read()
    .reverse()
    .find(
      (row) =>
        row.namespace === account &&
        row.threadId === threadId &&
        row.sourceTurnId === sourceTurnId,
    );
  // A lost receipt is reconciled using GET. The same gesture must never start
  // another empty turn, including after a refresh or an accepted stale UI.
  if (existing && existing.status !== "rejected")
    return reconcileResumeReceipt(existing);
  const pending: ResumeReceipt = {
    operationId: newSessionEditId(),
    threadId,
    sourceTurnId,
    status: "unknown",
  };
  write(pending, account); // A durable receipt identity precedes the write.
  try {
    const response = await readWithDeadline(
      (signal) =>
        postJsonWithOptions<unknown>(
          "/lifecycle/resume",
          {
            operationId: pending.operationId,
            threadId,
            sourceTurnId,
            parameters,
            expectedScope: scopeToken,
          },
          { suppressToast: true, signal },
        ),
      30_000,
    );
    if (!isCodexOperationScopeCurrent(scope)) return pending;
    const result = checked(response, pending);
    write(result, account);
    return result;
  } catch (error) {
    const result: ResumeReceipt = {
      ...pending,
      status: isExplicitRequestRejection(error) ? "rejected" : "unknown",
      error: error instanceof Error ? error.message : "继续任务状态待核对",
    };
    write(result, account);
    return result;
  }
}
