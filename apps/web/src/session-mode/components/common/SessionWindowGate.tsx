import { useEffect, useState, type ReactNode } from "react";
import { restoreSessionWindow } from "@session/services/restoreSessionWindow";

export default function SessionWindowGate({
  children,
}: {
  children: ReactNode;
}) {
  const [ready, setReady] = useState(false),
    [error, setError] = useState<string | null>(null),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    void restoreSessionWindow(controller.signal).then(
      () => {
        if (!controller.signal.aborted) setReady(true);
      },
      (error) => {
        if (!controller.signal.aborted)
          setError(
            error instanceof Error ? error.message : "新窗口会话来源无法核实。",
          );
      },
    );
    return () => controller.abort();
  }, [attempt]);
  if (ready) return children;
  return (
    <div
      className="session-connection-state"
      data-session-window-gate
      role={error ? "alert" : "status"}
    >
      <h1>{error ? "无法打开原会话" : "正在核对新窗口会话…"}</h1>
      <p>{error ?? "核对运行服务、账号与原会话身份。"}</p>
      {error && (
        <button type="button" onClick={() => setAttempt((value) => value + 1)}>
          重新核对
        </button>
      )}
    </div>
  );
}
