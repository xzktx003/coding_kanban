import { retryEventStream } from "@session/lib/eventStream";
import {
  useSessionSyncStore,
  requestSessionHistorySync,
} from "@session/stores/useSessionSyncStore";
import { useEffect, useRef, useState } from "react";
import { authHeaders, buildUrl } from "@session/hooks/runtime";
import { useAgentInteractionVisible } from "@session/session-dom";
import {
  refreshCodexAccess,
  useCodexAccessStore,
} from "@session/stores/useCodexAccessStore";

/** Reading stays read-only. Live attachment requires this explicit user action. */
export function CodexAccessNotice({
  threadId,
  suppressStatus = false,
}: {
  threadId: string;
  suppressStatus?: boolean;
}) {
  const recovery = useSessionSyncStore((s) => s.recovering[threadId]);
  const connection = useSessionSyncStore((s) => s.connection);
  const connectionError = useSessionSyncStore((s) => s.connectionError);
  const [showReconnect, setShowReconnect] = useState(false);
  const interactionVisible = useAgentInteractionVisible();
  const interaction = useRef(interactionVisible);
  interaction.current = interactionVisible;
  const [attachPhase, setAttachPhase] = useState<
    "idle" | "pending" | "failed" | "unknown"
  >("idle");
  const [attachMessage, setAttachMessage] = useState<string | null>(null);
  const attachController = useRef<AbortController | null>(null);
  const attaching = useRef(false),
    mounted = useRef(true);
  const owner = useRef(threadId);
  owner.current = threadId;
  useEffect(() => {
    mounted.current = true;
    attaching.current = false;
    setAttachPhase("idle");
    setAttachMessage(null);
    return () => {
      mounted.current = false;
      attachController.current?.abort();
    };
  }, [threadId]);
  useEffect(() => {
    if (connection !== "reconnecting") {
      setShowReconnect(false);
      return;
    }
    const timer = setTimeout(() => setShowReconnect(true), 1000);
    return () => clearTimeout(timer);
  }, [connection]);
  const entry = useCodexAccessStore((s) => s.entries[threadId]);
  const access = entry?.access;
  useEffect(() => {
    if (access?.attached === true) {
      setAttachPhase("idle");
      setAttachMessage(null);
    }
  }, [access?.attached]);
  const error = entry?.unsupported
    ? "当前运行服务尚未启用会话自动释放"
    : entry?.error;
  const canAttach =
    access?.sharedDaemon === true &&
    access.loaded === true &&
    access.attached === false &&
    typeof access.activeTurnId === "string" &&
    access.activeTurnId.length > 0 &&
    !error;
  const attach = async () => {
    if (
      !canAttach ||
      !interactionVisible ||
      attaching.current ||
      attachPhase !== "idle"
    )
      return;
    const captured = {
      threadId,
      turnId: access.activeTurnId!,
      generation: access.generation,
    };
    const headers = authHeaders(),
      contextUrl = buildUrl("/lifecycle/context");
    const controller = new AbortController();
    attachController.current = controller;
    const timer = window.setTimeout(() => controller.abort(), 12_000);
    attaching.current = true;
    setAttachPhase("pending");
    setAttachMessage(null);
    let written = false,
      rejected = false;
    try {
      const contextResponse = await fetch(contextUrl, {
        headers,
        signal: controller.signal,
        cache: "no-store",
      });
      if (!contextResponse.ok) throw new Error("context");
      const context = (await contextResponse.json()) as {
        scopeToken?: unknown;
        namespace?: unknown;
      };
      if (
        typeof context.scopeToken !== "string" ||
        !context.scopeToken ||
        context.scopeToken.length > 512 ||
        typeof context.namespace !== "string" ||
        !context.namespace ||
        context.namespace.length > 512
      )
        throw new Error("context");
      const current =
        useCodexAccessStore.getState().entries[captured.threadId]?.access;
      if (
        controller.signal.aborted ||
        !mounted.current ||
        owner.current !== captured.threadId ||
        !interaction.current ||
        attachController.current !== controller ||
        contextUrl !== buildUrl("/lifecycle/context") ||
        headers.Authorization !== authHeaders().Authorization ||
        current?.generation !== captured.generation ||
        current?.attached !== false ||
        current.loaded !== true ||
        current.activeTurnId !== captured.turnId
      )
        throw new Error("changed");
      written = true;
      const response = await fetch(buildUrl("/lifecycle/attach"), {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({
          expectedScope: context.scopeToken,
          threadId: captured.threadId,
          expectedTurnId: captured.turnId,
        }),
        signal: controller.signal,
        cache: "no-store",
      });
      rejected = response.status >= 400 && response.status < 500;
      if (!response.ok) throw new Error("attach");
      const fresh = await refreshCodexAccess(captured.threadId);
      if (
        !mounted.current ||
        owner.current !== captured.threadId ||
        attachController.current !== controller ||
        controller.signal.aborted
      )
        return;
      if (fresh.access?.attached !== true) throw new Error("unconfirmed");
      setAttachPhase("idle");
      setAttachMessage(null);
    } catch (cause) {
      if (
        !mounted.current ||
        owner.current !== captured.threadId ||
        attachController.current !== controller
      )
        return;
      const unknown = written && !rejected;
      setAttachPhase(unknown ? "unknown" : "failed");
      setAttachMessage(
        unknown
          ? "连接结果尚未确认，请先核对状态；不会自动重试连接。"
          : cause instanceof Error && cause.message === "changed"
            ? "会话或连接已变化，请重新核对后再连接。"
            : "尚未连接实时交互，请重新核对当前任务后再连接。",
      );
    } finally {
      window.clearTimeout(timer);
      if (attachController.current === controller) {
        attachController.current = null;
        attaching.current = false;
      }
    }
  };
  useEffect(() => {
    let cancelled = false,
      inFlight = false;
    const update = async () => {
      if (inFlight || cancelled) return;
      inFlight = true;
      try {
        await refreshCodexAccess(threadId);
      } finally {
        inFlight = false;
      }
    };
    void update();
    const timer = window.setInterval(() => void update(), 2000);
    window.addEventListener("codex-access-changed", update);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("codex-access-changed", update);
    };
  }, [threadId]);
  const text =
    error ||
    attachMessage ||
    (canAttach ? "该任务正在官方服务中运行，可连接实时交互。" : undefined) ||
    (access?.state === "readonly" || access?.state === "owned"
      ? undefined
      : access?.state === "external"
        ? "其他客户端占用 · 历史可读，草稿已保留"
        : access?.reason ||
          (access?.state === "unknown"
            ? "执行状态尚未确认，草稿已保留"
            : undefined));
  // A specific history failure already owns the retry affordance. Keep metadata
  // observation mounted, but never cover that action with a second floating banner.
  if (suppressStatus) return null;
  if (connectionError || recovery || showReconnect)
    return (
      <div
        role="status"
        data-session-recovery={recovery ?? "reconnecting"}
        className="session-sync-notice"
      >
        <span>
          {connectionError ||
            (showReconnect
              ? "连接中断，正在重连"
              : recovery === "retrying"
                ? "同步延迟，正在重试"
                : "正在恢复会话同步…")}
        </span>
        <button
          type="button"
          className="underline underline-offset-2"
          onClick={() => {
            if (connectionError) retryEventStream();
            requestSessionHistorySync(threadId);
          }}
        >
          重试
        </button>
      </div>
    );
  if (!text) return null;
  return (
    <div
      role="status"
      data-codex-access={access?.state ?? "unknown"}
      className="session-sync-notice session-access-notice"
    >
      <span>{text}</span>
      {canAttach && (
        <button
          type="button"
          className="underline underline-offset-2"
          disabled={!interactionVisible || attachPhase !== "idle"}
          onClick={() => void attach()}
        >
          {attachPhase === "pending"
            ? "正在连接…"
            : attachPhase === "unknown"
              ? "连接状态待核对"
              : attachPhase === "failed"
                ? "请先核对连接状态"
                : "连接实时交互"}
        </button>
      )}
      <button
        type="button"
        className="underline underline-offset-2"
        onClick={() =>
          void refreshCodexAccess(threadId).then((fresh) => {
            if (
              !mounted.current ||
              owner.current !== threadId ||
              attaching.current
            )
              return;
            if (
              fresh.access?.attached === true ||
              (fresh.access?.loaded === true &&
                fresh.access?.activeTurnId === access?.activeTurnId)
            ) {
              setAttachPhase("idle");
              setAttachMessage(null);
            }
          })
        }
      >
        重新核对
      </button>
    </div>
  );
}
