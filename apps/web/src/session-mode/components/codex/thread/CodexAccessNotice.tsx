import {
  useSessionSyncStore,
  requestSessionHistorySync,
} from "@session/stores/useSessionSyncStore";
import { useEffect, useState } from "react";
import {
  threadAccess,
  type CodexAccess,
} from "@session/services/apiAdapt/codex";
import { SessionApiError } from "@session/services/apiAdapt/shared";

/** Informational only: reading/polling never attempts to acquire execution. */
export function CodexAccessNotice({ threadId }: { threadId: string }) {
  const recovery = useSessionSyncStore((s) => s.recovering[threadId]);
  const connection = useSessionSyncStore((s) => s.connection);
  const [showReconnect, setShowReconnect] = useState(false);
  useEffect(() => {
    if (connection !== "reconnecting") {
      setShowReconnect(false);
      return;
    }
    const timer = setTimeout(() => setShowReconnect(true), 1000);
    return () => clearTimeout(timer);
  }, [connection]);
  const [access, setAccess] = useState<CodexAccess | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false,
      inFlight = false;
    const update = async () => {
      if (inFlight || cancelled) return;
      inFlight = true;
      try {
        const result = await threadAccess(threadId);
        if (!cancelled) {
          setAccess(result);
          setError("");
        }
      } catch (e) {
        if (!cancelled) {
          setAccess(null);
          setError(
            e instanceof SessionApiError && e.status === 404
              ? "当前运行服务尚未启用会话自动释放"
              : "执行占用状态暂时无法确认",
          );
        }
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
    (access?.state === "readonly"
      ? "只读查看，发送时恢复原会话"
      : access?.state === "external"
        ? "其他客户端占用 · 历史可读，草稿已保留"
        : access?.reason);
  if (recovery || showReconnect)
    return (
      <div
        role="status"
        data-session-recovery={recovery ?? "reconnecting"}
        className="session-sync-notice"
      >
        <span>
          {showReconnect
            ? "连接中断，正在重连"
            : recovery === "retrying"
              ? "同步延迟，正在重试"
              : "正在恢复会话同步…"}
        </span>
        <button
          type="button"
          className="underline underline-offset-2"
          onClick={() => requestSessionHistorySync(threadId)}
        >
          重试
        </button>
      </div>
    );
  if (!text) return null;
  return (
    <p
      role="status"
      data-codex-access={access?.state ?? "unknown"}
      className="session-sync-notice session-access-notice"
    >
      {text}
    </p>
  );
}
