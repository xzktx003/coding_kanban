import { retryEventStream } from "@session/lib/eventStream";
import {
  useSessionSyncStore,
  requestSessionHistorySync,
} from "@session/stores/useSessionSyncStore";
import { useEffect, useState } from "react";
import {
  refreshCodexAccess,
  useCodexAccessStore,
} from "@session/stores/useCodexAccessStore";

/** Informational only: reading/polling never attempts to acquire execution. */
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
  const error = entry?.unsupported
    ? "当前运行服务尚未启用会话自动释放"
    : entry?.error;
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
      <button
        type="button"
        className="underline underline-offset-2"
        onClick={() => void refreshCodexAccess(threadId)}
      >
        重新核对
      </button>
    </div>
  );
}
