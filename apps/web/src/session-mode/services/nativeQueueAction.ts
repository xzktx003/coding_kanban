import type {
  FollowupAction,
  FollowupThread,
} from "@agent-orchestrator/shared";
import { v5 as uuidV5 } from "uuid";
import { newSessionEditId } from "./sessionEditIdentity";
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
import { readWithDeadline } from "./sessionReadQueue";
import { OperationReceiptJournal } from "./operationReceiptJournal";
type Saved = {
  id: string;
  namespace: string;
  threadId: string;
  target: string;
  fingerprint: string;
  status: "accepted" | "rejected" | "unknown";
  at?: number;
};
const key = "session-native-queue-actions-v1";
const inflight = new Map<
  string,
  { fingerprint: string; promise: Promise<FollowupThread> }
>();
function valid(value: unknown): Saved {
  const row = value as Saved;
  if (
    !row ||
    !["accepted", "rejected", "unknown"].includes(row.status) ||
    [row.id, row.namespace, row.threadId, row.target, row.fingerprint].some(
      (value) => typeof value !== "string" || !value || value.length > 1024,
    ) ||
    (row.at !== undefined && (!Number.isSafeInteger(row.at) || row.at < 0))
  )
    throw new Error("队列操作回执损坏，请先核对已有操作");
  return row;
}
const journal = new OperationReceiptJournal<Saved>(
  key,
  (row) => row.id,
  valid,
  (a, b) =>
    ["namespace", "threadId", "target", "fingerprint"].every(
      (field) => a[field as keyof Saved] === b[field as keyof Saved],
    ),
);
const read = () => journal.read(),
  save = (row: Saved) => journal.save(row);
/** A later click can reconcile an unknown step; it cannot replay that mutation. */
export async function changeNativeQueue(
  threadId: string,
  revision: number,
  action: FollowupAction,
): Promise<FollowupThread> {
  const scope = captureCodexOperationScope(),
    context = await readNativeOperationContext();
  if (!isCodexOperationScopeCurrent(scope))
    throw new Error("账号或运行服务已变化，请重新确认");
  const target = JSON.stringify([
    action.type,
    "id" in action ? action.id : "token" in action ? action.token : null,
  ]);
  const owner = JSON.stringify([context.namespace, threadId, target]),
    fingerprint = uuidV5(JSON.stringify(action), uuidV5.URL);
  const current = inflight.get(owner);
  if (current) {
    if (current.fingerprint !== fingerprint)
      throw new Error("此队列消息仍有操作待核对；本次新修改尚未提交");
    return current.promise;
  }
  const work = (async () => {
    const previous = read()
      .reverse()
      .find(
        (row) =>
          row.namespace === context.namespace &&
          row.threadId === threadId &&
          row.target === target &&
          row.status === "unknown",
      );
    const intent = previous ?? {
      id: newSessionEditId(),
      namespace: context.namespace,
      threadId,
      target,
      fingerprint,
      status: "unknown" as const,
    };
    if (!previous) save(intent);
    let response: FollowupThread;
    try {
      response = await readWithDeadline(
        (signal) =>
          previous
            ? getJsonWithOptions<FollowupThread>(
                `/followups/actions?threadId=${encodeURIComponent(threadId)}&operationId=${encodeURIComponent(intent.id)}&expectedScope=${encodeURIComponent(context.scopeToken)}`,
                { signal, suppressToast: true },
              )
            : postJsonWithOptions<FollowupThread>(
                "/followups/change",
                {
                  operationId: intent.id,
                  threadId,
                  revision,
                  action,
                  expectedScope: context.scopeToken,
                },
                { signal, suppressToast: true },
              ),
        15_000,
      );
      const receipt = response.operation;
      if (
        (response.authority === "native" &&
          (!receipt || receipt.id !== intent.id)) ||
        (receipt &&
          !["accepted", "rejected", "unknown"].includes(receipt.status))
      )
        throw new Error("队列操作回执身份不匹配");
      save({ ...intent, status: receipt?.status ?? "accepted" });
    } catch (error) {
      save({
        ...intent,
        status:
          !previous && isExplicitRequestRejection(error)
            ? "rejected"
            : "unknown",
      });
      throw error;
    }
    if (!isCodexOperationScopeCurrent(scope))
      throw new Error("账号或运行服务已变化，原队列回执已保留");
    if (previous && previous.fingerprint !== fingerprint)
      throw new Error(
        "原操作已核对；本次新修改尚未提交，请查看当前队列后重新执行",
      );
    if (response.operation && response.operation.status !== "accepted")
      throw new Error(
        response.operation.error ?? "队列操作结果待核对，内容已保留；不会重发",
      );
    return response;
  })();
  const admitted = { fingerprint, promise: work };
  inflight.set(owner, admitted);
  try {
    return await work;
  } finally {
    if (inflight.get(owner) === admitted) inflight.delete(owner);
  }
}
