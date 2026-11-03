const SAFETY_BLOCK =
  /blocked by our safety systems|potentially unintended activity|misalignment_policy_violation/i;

export const PROVIDER_SAFETY_BLOCK_HINT =
  "模型服务商的安全系统拒绝了这次请求。同一会话里只发「继续」会带上刚才被拒绝的上下文，仍然会被拒绝。请新开一个会话，或改写这次要做的事后再发送。";

export function isProviderSafetyBlock(
  message: string | null | undefined,
  errorInfo?: unknown,
): boolean {
  return (
    (typeof message === "string" && SAFETY_BLOCK.test(message)) ||
    (typeof errorInfo === "string" && SAFETY_BLOCK.test(errorInfo))
  );
}

export function isBareContinuation(text: string): boolean {
  return /^(继续|继续任务|continue|go on|keep going)[.!！。]?$/i.test(text.trim());
}

export function threadBlockedByProviderSafety(
  events: readonly { method?: string; params?: any }[],
): boolean {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (
      event?.method === "error" &&
      event.params?.willRetry === false &&
      isProviderSafetyBlock(
        event.params?.error?.message,
        event.params?.error?.codexErrorInfo,
      )
    )
      return true;
    if (event?.method === "turn/completed") {
      const turn = event.params?.turn;
      if (
        turn?.status === "failed" &&
        isProviderSafetyBlock(turn.error?.message, turn.error?.codexErrorInfo)
      )
        return true;
      if (turn?.status === "completed" || turn?.status === "failed") return false;
    }
  }
  return false;
}
