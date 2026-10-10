/** Literal zh-CN messages from enabled main VSIX 26.51002.51308 N8. */
export function nativeReasoningLabel(effort: string | null | undefined) {
  return (
    (
      {
        none: "无",
        minimal: "极低",
        low: "轻度",
        medium: "中",
        high: "高",
        xhigh: "极高",
        max: "Max",
        ultra: "Ultra",
        persistent: "持续",
      } as Record<string, string>
    )[effort ?? ""] ??
    effort ??
    "默认"
  );
}
