import { v4 as randomUUID } from "uuid";
import { hash as sha256 } from "fast-sha256";
import { codexRuntimeState } from "@session/utils/codexRuntimeState";
import { enqueueSessionRead, readWithDeadline } from "./sessionReadQueue";
import { create } from "zustand";
import {
  beginDeliveryEcho,
  failDeliveryEcho,
  reconcileDeliveryEchoes,
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
import { getThreadModelSettings } from "../stores/useThreadModelStore";
import { getJsonWithOptions, postJsonWithOptions } from "./apiAdapt/shared";
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
export function followupParameters(threadId: string): Record<string, unknown> {
  const c = getThreadModelSettings(threadId || null),
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
    approvalPolicy: structuredClone(c.approvalPolicy),
    approvalsReviewer: c.approvalsReviewer,
    sandboxPolicy: c.sandboxPolicy
      ? structuredClone(c.sandboxPolicy)
      : c.sandbox === "read-only"
        ? { type: "readOnly", networkAccess: c.webSearchRequest }
        : c.sandbox === "workspace-write"
          ? {
              type: "workspaceWrite",
              writableRoots: [],
              networkAccess: c.webSearchRequest,
              excludeTmpdirEnvVar: false,
              excludeSlashTmp: false,
            }
          : { type: "dangerFullAccess" },
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
  revision: number,
  data: Omit<FollowupSubmit, "id">,
) {
  return stableSubmissionId(owner, revision, data);
}
export async function stableSubmissionId(
  owner: string,
  revision: number,
  data: unknown,
) {
  const bytes = new TextEncoder().encode(
    JSON.stringify({ owner, revision, data }),
  );
  // Web Crypto digest is restricted to secure contexts. Keep the identical key
  // on LAN HTTP so retries and protocol changes cannot create another submission.
  const digest = globalThis.crypto?.subtle
    ? await globalThis.crypto.subtle.digest("SHA-256", bytes)
    : sha256(bytes);
  const key = Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  let saved: Record<string, string>;
  try {
    saved = JSON.parse(
      localStorage.getItem("kanban.session.followup-submissions") ?? "{}",
    );
  } catch {
    throw new Error("无法读取消息提交记录，请保留草稿并检查浏览器存储");
  }
  if (saved[key]) return saved[key];
  const id = randomUUID();
  saved[key] = id;
  const keys = Object.keys(saved);
  for (const old of keys.slice(0, Math.max(0, keys.length - 1000)))
    delete saved[old];
  localStorage.setItem(
    "kanban.session.followup-submissions",
    JSON.stringify(saved),
  );
  return id;
}
export const followupService = {
  async load(id: string, options?: { signal?: AbortSignal }) {
    try {
      return accept(
        id,
        await enqueueSessionRead("recent", `queue:${id}`, () =>
          readWithDeadline(
            (signal) =>
              getJsonWithOptions<FollowupThread>(
                "/followups?threadId=" + encodeURIComponent(id),
                { suppressToast: true, signal },
              ),
            5000,
            options?.signal,
          ),
        ),
      );
    } catch (e) {
      useFollowupStore.setState((s) => ({
        errors: { ...s.errors, [id]: String(e) },
      }));
      throw e;
    }
  },
  async submit(
    owner: string,
    revision: number,
    threadId: string,
    text: string,
    images: string[],
    mode: FollowupMode,
    expectedTurnId?: string,
    parameters?: Record<string, unknown>,
    contexts?: ComposerContext[],
    mentions?: AgentMention[],
  ) {
    const data = {
      ...(mode === "queue" &&
      codexRuntimeState(useCodexStore.getState(), threadId).failed
        ? { recoverAfterError: true }
        : {}),
      threadId,
      text,
      images: [...images],
      mode,
      parameters: parameters ?? followupParameters(threadId),
      ...(expectedTurnId ? { expectedTurnId } : {}),
      ...(contexts?.length ? { contexts: structuredClone(contexts) } : {}),
      ...(mentions?.length ? { mentions: structuredClone(mentions) } : {}),
    };
    const id = await submissionId(owner, revision, data);
    beginDeliveryEcho({ ...data, id });
    if (useCodexStore.getState().currentThreadId === threadId)
      window.dispatchEvent(
        new CustomEvent("session-message-submitted", { detail: { threadId } }),
      );
    try {
      let result: FollowupThread;
      try {
        // A completed native turn does not guarantee its HTTP acknowledgement
        // arrived. Bound the wait before accepting, so a late POST stays inert.
        result = accept(
          threadId,
          await readWithDeadline(
            (signal) =>
              postJsonWithOptions<FollowupThread>(
                "/followups/submit",
                { ...data, id },
                { suppressToast: true, signal },
              ),
            15_000,
          ),
        );
      } catch (error) {
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
        const receipt = result.items.find((message) => message.id === id);
        if (
          !receipt ||
          !["queued", "sending", "sent", "failed", "uncertain"].includes(
            receipt.status,
          )
        )
          throw unconfirmed();
      }
      const item = result.items.find((m) => m.id === id);
      if (!item) throw new Error("消息提交回执不完整");
      if (item.status === "failed" || item.status === "uncertain")
        throw new Error(
          (item.error ?? "消息未确认送达") + "；内容已保留，请在队列中处理",
        );
      return result;
    } catch (error) {
      failDeliveryEcho(threadId, id);
      throw error;
    }
  },
  async change(threadId: string, revision: number, action: FollowupAction) {
    if (action.type === "resume" || action.type === "pause")
      revision = (await this.load(threadId)).revision;
    try {
      return accept(
        threadId,
        await postJsonWithOptions<FollowupThread>(
          "/followups/change",
          { threadId, revision, action },
          { suppressToast: true },
        ),
      );
    } finally {
      void this.load(threadId).catch(() => {});
    }
  },
  async stop(threadId: string, turnId: string) {
    return accept(
      threadId,
      await postJsonWithOptions<FollowupThread>(
        "/followups/stop",
        { threadId, turnId },
        { suppressToast: true },
      ),
    );
  },
};
