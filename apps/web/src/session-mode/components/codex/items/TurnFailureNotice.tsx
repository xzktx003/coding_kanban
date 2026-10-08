/** A persisted turn can carry its error without replaying an `error` event. */
export function TurnFailureNotice({
  message,
  willRetry = false,
}: {
  message?: string;
  willRetry?: boolean;
}) {
  const raw = message || "未返回具体错误，请查看运行日志。";
  let detail = raw;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed?.error?.message === "string")
      detail = parsed.error.message;
    else if (typeof parsed?.message === "string") detail = parsed.message;
  } catch {
    // Most providers return plain text, not a JSON error envelope.
  }
  const oversizedArguments =
    /input\[\d+\]\.arguments/i.test(detail) && /string too long/i.test(detail);
  return (
    <div
      role="alert"
      className="rounded-md border border-destructive/40 p-3 text-sm space-y-2"
    >
      <p className="text-destructive font-medium">
        {willRetry ? "执行遇到错误，正在自动重试" : "本轮执行失败"}
      </p>
      {oversizedArguments ? (
        <p>
          历史工具调用参数过长，超过接口限制。需要修复历史上下文后再继续；直接重发同一消息仍可能失败。
        </p>
      ) : (
        <p className="whitespace-pre-wrap break-words">{detail}</p>
      )}
      {oversizedArguments && (
        <details>
          <summary className="cursor-pointer">查看错误详情</summary>
          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all">
            {raw}
          </pre>
        </details>
      )}
    </div>
  );
}
