import { changeNativeQueue } from "./nativeQueueAction";
import { threadPermissionParameters } from "./threadPermissionProjection";
import {
  stableSubmissionId,
  canonicalSubmissionData,
  type SubmissionEdit,
} from "./sessionSubmissionIdentity";
export { stableSubmissionId } from "./sessionSubmissionIdentity";
import { codexRuntimeState } from "@session/utils/codexRuntimeState";
import { enqueueSessionRead, readWithDeadline } from "./sessionReadQueue";
import { create } from "zustand";
import {
  beginDeliveryEcho,
  failDeliveryEcho,
  reconcileDeliveryEchoes,
  useCodexDeliveryStore,
  uncertainDeliveryReason,
} from "../stores/useCodexDeliveryStore";
import type {
  FollowupAction,
  FollowupMode,
  FollowupSubmit,
  FollowupThread,
  ComposerContext,
  AgentMention,
} from "@agent-orchestrator/shared";
import { useCodexStore } from "../components/codex/stores";
import { assertCodexSendAccess } from "../stores/useCodexAccessStore";
import { MutationNotStartedError } from "./MutationNotStartedError";
import { readNativeOperationContext } from "./nativeOperationContext";
import { captureCodexOperationScope, isCodexOperationScopeCurrent } from "./codexOperationScope";
import {
  assertCodexThreadInput,
  codexThreadInputState,
} from "@session/features/subagents/inputIdentity";
import { subagentService } from "@session/features/subagents/service";
import {
  getThreadModelSettings,
  captureThreadModelSelection,
  assertThreadModelSelectionCurrent,
  flushThreadModelSettings,
} from "../stores/useThreadModelStore";
import {
  getJsonWithOptions,
  postJsonWithOptions,
  isExplicitRequestRejection,
} from "./apiAdapt/shared";
export const useFollowupStore = create<{
  threads: Record<string, FollowupThread>;
  errors: Record<string, string | undefined>;
}>()(() => ({ threads: {}, errors: {} }));
export function reconcileReview(id: string, data: FollowupThread) {
  const review = data.review;
  if (!review || review.status === "inProgress") return;
  useCodexStore.setState((s) => {
    const timing = s.turnTimingMap[id];
    if (
      !timing ||
      timing.status !== "inProgress" ||
      ![review.turnId, review.executionTurnId].includes(timing.turnId)
    )
      return s;
    return {
      turnTimingMap: {
        ...s.turnTimingMap,
        [id]: {
          ...timing,
          turnId: review.turnId,
          status: review.status,
          durationMs: review.durationMs ?? timing.durationMs,
        },
      },
      threadStatusMap: { ...s.threadStatusMap, [id]: { type: "idle" } },
    };
  });
}
function sameJson(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b || !a || !b) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length)
      return false;
    return a.every((item, index) => sameJson(item, b[index]));
  }
  if (typeof a !== "object") return false;
  const aRecord = a as Record<string, unknown>;
  const bRecord = b as Record<string, unknown>;
  const aKeys = Object.keys(aRecord);
  const bKeys = Object.keys(bRecord);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every(
    (key) =>
      Object.prototype.hasOwnProperty.call(bRecord, key) &&
      sameJson(aRecord[key], bRecord[key]),
  );
}
function accept(id: string, data: FollowupThread) {
  if (!Array.isArray(data.items) || !Number.isInteger(data.revision))
    throw new Error("队列服务未返回有效状态");
  const current = useFollowupStore.getState().threads[id];
  const currentRevision = current?.revision ?? -1;
  if (currentRevision > data.revision) return data;
  const unchanged =
    currentRevision === data.revision && sameJson(current, data);
  reconcileReview(id, data);
  if (!unchanged) reconcileDeliveryEchoes(id, data);
  useFollowupStore.setState((s) => {
    const staleError = s.errors[id] !== undefined;
    if (unchanged && !staleError) return s;
    return {
      threads: unchanged ? s.threads : { ...s.threads, [id]: data },
      errors: staleError ? { ...s.errors, [id]: undefined } : s.errors,
    };
  });
  return data;
}
export function followupParameters(
  threadId: string,
  settings = getThreadModelSettings(threadId || null),
): Record<string, unknown> {
  const c = settings,
    thread = useCodexStore.getState().threads.find((t) => t.id === threadId);
  const { model, reasoningEffort, serviceTier } = c;
  return {
    // Restored metadata may use an empty placeholder until its directory loads.
    // Leave the native thread's directory in effect; never borrow another project.
    cwd: thread?.cwd?.trim() ? thread.cwd : null,
    model: model || null,
    effort: reasoningEffort ?? null,
    serviceTier: serviceTier ?? null,
    ...(c.personality ? { personality: c.personality } : {}),
    ...threadPermissionParameters(c),
    ...(model
      ? {
          collaborationMode: {
            mode: c.collaborationMode,
            settings: {
              model,
              reasoning_effort: reasoningEffort,
              developer_instructions: null,
            },
          },
        }
      : {}),
  };
}
/** A lost HTTP response must reuse the same submission identity, including after refresh. */
export async function submissionId(
  owner: string,
  revision: SubmissionEdit,
  data: Omit<FollowupSubmit, "id">,
) {
  const { expectedScope: _scope, ...content } = data;
  return stableSubmissionId(owner, revision, content);
}
export const followupService = {
  async load(id: string, options?: { signal?: AbortSignal }) {
    const scope = captureCodexOperationScope();
    try {
      const data = await enqueueSessionRead(
        "status",
        `queue:${JSON.stringify(scope)}:${id}`,
        () =>
          readWithDeadline(
            (signal) =>
              getJsonWithOptions<FollowupThread>(
                "/followups?threadId=" + encodeURIComponent(id),
                { suppressToast: true, signal },
              ),
            5000,
            options?.signal,
          ),
      );
      if (!isCodexOperationScopeCurrent(scope))
        throw new Error("连接目标已切换，旧队列读取已忽略");
      return accept(id, data);
    } catch (e) {
      if (isCodexOperationScopeCurrent(scope))
        useFollowupStore.setState((s) => ({
          errors: { ...s.errors, [id]: String(e) },
        }));
      throw e;
    }
  },
  async submit(
    owner: string,
    revision: SubmissionEdit,
    threadId: string,
    text: string,
    images: string[],
    mode: FollowupMode,
    expectedTurnId?: string,
    parameters?: Record<string, unknown>,
    contexts?: ComposerContext[],
    mentions?: AgentMention[],
    settingsCapture?: ReturnType<typeof captureThreadModelSelection>,
  ) {
    const operationScope = captureCodexOperationScope();
    // Explicit child-native/retry parameters are already captured by their owner.
    // Only ordinary preference-based submissions participate in this local gate.
    const captured = settingsCapture ??
      (parameters === undefined ? captureThreadModelSelection(threadId) : undefined);
    const capturedParameters = structuredClone(parameters ??
      followupParameters(threadId, captured!.settings));
    if (captured) {
      try {
        await flushThreadModelSettings(threadId, captured);
      } catch (error) {
        throw new MutationNotStartedError(error instanceof Error ? error.message : String(error));
      }
    }
    const input = codexThreadInputState(threadId);
    if (input.kind === "child" || input.needsVerification)
      await subagentService.inspectIdentity(threadId);
    assertCodexThreadInput(threadId);
    const data = {
      ...(mode === "queue" &&
      codexRuntimeState(useCodexStore.getState(), threadId).failed
        ? { recoverAfterError: true }
        : {}),
      threadId,
      text,
      images: [...images],
      mode,
      parameters: capturedParameters,
      ...(expectedTurnId ? { expectedTurnId } : {}),
      ...(contexts?.length ? { contexts: structuredClone(contexts) } : {}),
      ...(mentions?.length ? { mentions: structuredClone(mentions) } : {}),
    };
    const id = await submissionId(owner, revision, data);
    // The server fingerprints the actual request. Canonical IDs must also send
    // canonical object order, while old retry IDs keep their original payload.
    const submittedData = id.startsWith("draft3_")
      ? canonicalSubmissionData(data)
      : data;
    if (
      Object.values(useCodexDeliveryStore.getState().entries).some(
        (e) => e.threadId === threadId && e.status === "uncertain",
      ) ||
      useFollowupStore
        .getState()
        .threads[threadId]?.items.some((item) => item.status === "uncertain")
    )
      throw new MutationNotStartedError(uncertainDeliveryReason);
    await assertCodexSendAccess(threadId);
    assertCodexThreadInput(threadId);
    if (captured) {
      try {
        assertThreadModelSelectionCurrent(captured);
      } catch (error) {
        throw new MutationNotStartedError(error instanceof Error ? error.message : String(error));
      }
    }
    if (!isCodexOperationScopeCurrent(operationScope))
      throw new MutationNotStartedError("连接目标已切换，消息尚未发送，草稿已保留");
    const nativeContext = await readNativeOperationContext();
    if (typeof nativeContext.scopeToken !== "string" || !nativeContext.scopeToken || !isCodexOperationScopeCurrent(operationScope))
      throw new MutationNotStartedError("运行服务范围尚未确认，消息未发送，草稿已保留");
    beginDeliveryEcho({ ...submittedData, id });
    const echoKey = JSON.stringify([threadId, id]);
    const submittedEcho = useCodexDeliveryStore.getState().entries[echoKey];
    if (useCodexStore.getState().currentThreadId === threadId)
      window.dispatchEvent(
        new CustomEvent("session-message-submitted", { detail: { threadId } }),
      );
    try {
      let result: FollowupThread;
      try {
        // A completed native turn does not guarantee its HTTP acknowledgement
        // arrived. Bound the wait before accepting, so a late POST stays inert.
        const response = await readWithDeadline(
            (signal) =>
              postJsonWithOptions<FollowupThread>(
                "/followups/submit",
                { ...submittedData, id, expectedScope: nativeContext.scopeToken },
                { suppressToast: true, signal },
              ),
            15_000,
          );
        if (!isCodexOperationScopeCurrent(operationScope))
          throw new Error("连接目标已切换，请核对原会话中的送达结果；草稿已保留");
        result = accept(threadId, response);
      } catch (error) {
        if (!isCodexOperationScopeCurrent(operationScope))
          throw new Error("连接目标已切换，请核对原会话中的送达结果；草稿已保留");
        if (!(error instanceof DOMException) || error.name !== "TimeoutError")
          throw error;
        const unconfirmed = () =>
          new Error(
            "消息提交确认超时，草稿已保留；请先检查队列中的送达状态，再决定是否重试。",
          );
        try {
          // Include waiting for a read worker in the budget. Never resend a
          // mutation to discover whether the original submission was accepted.
          result = await readWithDeadline(
            (signal) => followupService.load(threadId, { signal }),
            5000,
          );
        } catch {
          throw unconfirmed();
        }
        const receipt = result.items.find((message) => message.id === id || message.nativeClientUserMessageId === id);
        if (
          !receipt ||
          !["queued", "sending", "sent", "failed", "uncertain"].includes(
            receipt.status,
          )
        )
          throw unconfirmed();
      }
      const item = result.items.find((m) => m.id === id || m.nativeClientUserMessageId === id);
      if (!item) throw new Error("消息提交回执不完整");
      if (item.status === "failed" || item.status === "uncertain")
        throw new Error(
          (item.error ?? "消息未确认送达") + "；内容已保留，请在队列中处理",
        );
      return result;
    } catch (error) {
      if (isCodexOperationScopeCurrent(operationScope) ||
          useCodexDeliveryStore.getState().entries[echoKey] === submittedEcho)
        failDeliveryEcho(threadId, id, isCodexOperationScopeCurrent(operationScope) && isExplicitRequestRejection(error));
      throw error;
    }
  },
  async change(threadId: string, revision: number, action: FollowupAction) {
    if (action.type === "resume" || action.type === "pause")
      revision = (await this.load(threadId)).revision;
    try {
      return accept(threadId, await changeNativeQueue(threadId, revision, action));
    } finally {
      void this.load(threadId).catch(() => {});
    }
  },
  async stop(threadId: string, turnId: string) {
    const context = await readNativeOperationContext();
    return accept(
      threadId,
      await postJsonWithOptions<FollowupThread>(
        "/followups/stop",
        { threadId, turnId, expectedScope: context.scopeToken },
        { suppressToast: true },
      ),
    );
  },
};
