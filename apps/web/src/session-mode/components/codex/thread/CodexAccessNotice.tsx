import { useEffect, useState } from "react";
import {
  threadAccess,
  type CodexAccess,
} from "@session/services/apiAdapt/codex";
import { SessionApiError } from "@session/services/apiAdapt/shared";

/** Informational only: reading/polling never attempts to acquire execution. */
export function CodexAccessNotice({ threadId }: { threadId: string }) {
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
      ? "本项目未占用执行权，发送时会恢复原会话"
      : access?.state === "external"
        ? "其他客户端正在使用，可查看历史。待发送内容和附件已保留；对方释放后可重试。"
        : access?.reason);
  if (!text) return null;
  return (
    <p
      role="status"
      data-codex-access={access?.state ?? "unknown"}
      className="py-1 text-xs text-muted-foreground"
    >
      {text}
    </p>
  );
}
