export function shortenPath(path?: string): string {
  if (!path) return "未提供工作目录";
  return path.replace(/^\/(?:data\d+\/)?home\/[^/]+/, "~");
}

export function formatActivityTime(
  timestamp?: number,
  locale: "zh" | "en" = "zh",
): string {
  if (!timestamp) return locale === "zh" ? "暂无活动时间" : "No activity time";
  const date = new Date(timestamp);
  return date.toLocaleString(locale === "zh" ? "zh-CN" : "en-US", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function timeAgo(timestamp?: number, locale: "zh" | "en" = "zh"): string {
  if (!timestamp) return "";
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return locale === "zh" ? "刚刚" : "just now";
  if (minutes < 60) return locale === "zh" ? `${minutes} 分钟前` : `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return locale === "zh" ? `${hours} 小时前` : `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return locale === "zh" ? `${days} 天前` : `${days}d ago`;
}
