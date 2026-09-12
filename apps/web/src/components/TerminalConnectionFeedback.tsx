export type TerminalConnectionPhase =
  | "connecting"
  | "connected"
  | "reconnecting";

export function TerminalConnectionFeedback({
  phase,
  onRetry,
}: {
  phase: TerminalConnectionPhase;
  onRetry: () => void;
}) {
  if (phase === "connected") {
    return null;
  }

  const reconnecting = phase === "reconnecting";

  return (
    <div
      className={`terminal-connection-feedback terminal-connection-feedback--${phase}`}
      role={reconnecting ? "alert" : "status"}
    >
      <span>{reconnecting ? "终端连接失败，正在重试" : "正在连接终端…"}</span>
      {reconnecting && (
        <button onClick={onRetry} type="button">
          立即重试
        </button>
      )}
    </div>
  );
}
