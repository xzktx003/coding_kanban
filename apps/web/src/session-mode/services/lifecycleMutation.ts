import {
  getJsonWithOptions,
  postJsonWithOptions,
  isExplicitRequestRejection,
} from "./apiAdapt/shared";
import { readNativeOperationContext } from "./nativeOperationContext";
import {
  captureCodexOperationScope,
  isCodexOperationScopeCurrent,
} from "./codexOperationScope";
import { newSessionEditId } from "./sessionEditIdentity";
import { readWithDeadline } from "./sessionReadQueue";
import type { ReviewStartResponse } from "../bindings/v2";
import { v5 as uuidV5 } from "uuid";
import { OperationReceiptJournal } from "./operationReceiptJournal";
type Kind = "archive" | "rename" | "review";
type Receipt = {
  operationId: string;
  threadId: string;
  status: "accepted" | "rejected" | "unknown" | "archived" | "blocked";
  error?: string;
  reconciled?: boolean;
} & Partial<ReviewStartResponse>;
type Saved = Pick<Receipt, "operationId" | "threadId" | "status"> & {
  kind: Kind;
  namespace: string;
  fingerprint?: string;
  at?: number;
};
const storageKey = "session-lifecycle-mutations-v1";
const pending = new Map<
  string,
  { fingerprint: string; promise: Promise<Receipt> }
>();
export class LifecycleMutationUnknownError extends Error {
  constructor(message: string) {
    super(`${message}；操作结果待核对，不会重复执行。`);
  }
}
const journal = new OperationReceiptJournal<Saved>(
  storageKey,
  (row) => row.operationId,
  (value) => {
    const row = value as Saved;
    if (
      !row ||
      !["archive", "rename", "review"].includes(row.kind) ||
      !["accepted", "rejected", "unknown", "archived", "blocked"].includes(
        row.status,
      ) ||
      [row.operationId, row.threadId, row.namespace].some(
        (value) => typeof value !== "string" || !value || value.length > 512,
      ) ||
      (row.fingerprint !== undefined &&
        (typeof row.fingerprint !== "string" ||
          row.fingerprint.length > 128)) ||
      (row.at !== undefined && (!Number.isSafeInteger(row.at) || row.at < 0))
    )
      throw new Error("会话操作回执损坏，请先核对已有操作");
    return row;
  },
  (a, b) =>
    a.kind === b.kind &&
    a.threadId === b.threadId &&
    a.namespace === b.namespace &&
    (a.fingerprint === undefined ||
      b.fingerprint === undefined ||
      a.fingerprint === b.fingerprint),
);
const read = () => journal.read(),
  save = (row: Saved) => journal.save(row);
export async function hasPendingLifecycleMutation(
  kind: Kind,
  threadId: string,
): Promise<boolean> {
  const scope = captureCodexOperationScope(),
    context = await readNativeOperationContext();
  if (!isCodexOperationScopeCurrent(scope))
    throw new Error("账号或运行服务已变化，请重新确认");
  return read().some(
    (row) =>
      row.kind === kind &&
      row.threadId === threadId &&
      row.namespace === context.namespace &&
      row.status === "unknown",
  );
}
/** Metadata-only outbox. Unknown requests may only read their original receipt. */
export async function lifecycleMutation(
  kind: Kind,
  threadId: string,
  parameters: Record<string, unknown>,
): Promise<Receipt> {
  const scope = captureCodexOperationScope(),
    context = await readNativeOperationContext();
  if (!isCodexOperationScopeCurrent(scope))
    throw new Error("账号或运行服务已变化，请重新确认");
  const key = JSON.stringify([context.namespace, kind, threadId]);
  const fingerprint = uuidV5(JSON.stringify(parameters), uuidV5.URL);
  const inflight = pending.get(key);
  if (inflight) {
    if (inflight.fingerprint !== fingerprint)
      throw new Error("原会话操作仍待核对；本次新修改尚未提交");
    return inflight.promise;
  }
  const work = (async () => {
    const previous = read()
      .reverse()
      .find(
        (row) =>
          row.kind === kind &&
          row.threadId === threadId &&
          row.namespace === context.namespace &&
          row.status === "unknown",
      );
    const intent: Saved = previous ?? {
      namespace: context.namespace,
      kind,
      operationId: newSessionEditId(),
      threadId,
      fingerprint,
      status: "unknown",
    };
    if (!previous) save(intent); // A failed storage write prevents the native mutation.
    let result: Receipt;
    const path = kind === "review" ? "/followups/review" : `/lifecycle/${kind}`;
    try {
      result = await readWithDeadline(
        (signal) =>
          previous
            ? getJsonWithOptions<Receipt>(
                `${path}?operationId=${encodeURIComponent(intent.operationId)}&threadId=${encodeURIComponent(threadId)}&expectedScope=${encodeURIComponent(context.scopeToken)}`,
                { signal, suppressToast: true },
              )
            : postJsonWithOptions<Receipt>(
                path,
                {
                  ...parameters,
                  operationId: intent.operationId,
                  threadId,
                  expectedScope: context.scopeToken,
                },
                { signal, suppressToast: true },
              ),
        30_000,
      );
      if (
        !result ||
        result.operationId !== intent.operationId ||
        result.threadId !== threadId ||
        !["accepted", "rejected", "unknown", "archived", "blocked"].includes(
          result.status,
        )
      )
        throw new Error("会话操作回执身份不匹配");
    } catch (error) {
      const rejected = !previous && isExplicitRequestRejection(error);
      save({ ...intent, status: rejected ? "rejected" : "unknown" });
      if (rejected) throw error;
      throw new LifecycleMutationUnknownError(
        error instanceof Error ? error.message : "会话操作回执不可用",
      );
    }
    save({ ...intent, status: result.status });
    if (!isCodexOperationScopeCurrent(scope))
      throw new Error("账号或运行服务已变化，原会话回执已保留");
    if (result.status === "unknown")
      throw new LifecycleMutationUnknownError(
        result.error ?? "尚未收到操作回执",
      );
    if (!["accepted", "archived"].includes(result.status))
      throw new Error(result.error ?? "操作未接受，内容已保留");
    if (previous && kind !== "review" && previous.fingerprint !== fingerprint)
      throw new Error(
        "原操作已核对；本次新修改尚未提交，请查看当前会话后重新执行",
      );
    return { ...result, reconciled: !!previous };
  })();
  const admitted = { fingerprint, promise: work };
  pending.set(key, admitted);
  try {
    return await work;
  } finally {
    if (pending.get(key) === admitted) pending.delete(key);
  }
}
