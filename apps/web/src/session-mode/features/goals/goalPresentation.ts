import type { ThreadGoal, ThreadGoalStatus } from "@session/bindings/v2";

/** Native /goal also works without selecting goal mode first. */
export function goalTextFromPrompt(input: string): string | null {
  const match = /^\/goal(?:\s+([\s\S]*))?$/.exec(input.trim());
  return match ? (match[1] ?? "").trim() : null;
}

// VS Code oFi / Lie / rFi / dFi. Goal budgets are displayed, never inferred
// from model context usage and never reset by a status change.
export function goalNextStatus(
  status: ThreadGoalStatus,
): "active" | "paused" | null {
  switch (status) {
    case "active":
      return "paused";
    case "paused":
    case "blocked":
    case "usageLimited":
      return "active";
    case "budgetLimited":
    case "complete":
      return null;
  }
}

export function goalDuration(milliseconds: number): string {
  const seconds = Math.floor(Math.max(milliseconds, 0) / 1000);
  const values = [
    Math.floor(seconds / 86400),
    Math.floor(seconds / 3600) % 24,
    Math.floor(seconds / 60) % 60,
    seconds % 60,
  ];
  return (
    values
      .map((value, i) => (value ? `${value}${["d", "h", "m", "s"][i]}` : ""))
      .filter(Boolean)
      .join(" ") || "0s"
  );
}

export function goalCounter(
  goal: ThreadGoal,
  now: number,
  locale: string,
): string {
  if (
    (goal.status === "active" || goal.status === "budgetLimited") &&
    goal.tokenBudget !== null
  ) {
    const format = new Intl.NumberFormat(locale, {
      notation: "compact",
      maximumFractionDigits: 1,
    });
    return `${format.format(goal.tokensUsed)} / ${format.format(goal.tokenBudget)}`;
  }
  return goalDuration(
    goal.timeUsedSeconds * 1000 +
      (goal.status === "active" ? now - goal.updatedAt * 1000 : 0),
  );
}

const en = {
  status: {
    active: "Pursuing goal",
    paused: "Paused goal",
    blocked: "Goal stalled",
    usageLimited: "Goal usage limited",
    budgetLimited: "Goal limited",
    complete: "Goal achieved",
  },
  goal: "Goal",
  edit: "Edit goal",
  clear: "Clear goal",
  pause: "Pause goal",
  resume: "Resume goal",
  cancel: "Cancel",
  save: "Save",
  close: "Close dialog",
  draft: "Goal",
  cancelDraft: "Clear goal",
  replaceTitle: "Replace current goal?",
  replaceSubtitle:
    "This will keep the chat but replace the saved goal with your current composer text",
  replace: "Replace goal",
  resumePausedTitle: "Resume paused goal?",
  resumeTitle: "Resume goal?",
  resumeConfirm: "Resume goal",
  resumeSubtitle:
    "ChatGPT will keep working toward this goal when the chat is idle",
  keepPaused: "Keep paused",
  notNow: "Not now",
  loadError: "Failed to load goal objective",
  saveError: "Failed to save goal objective",
  statusError: "Failed to update goal",
  clearError: "Failed to clear goal",
  setError: "Failed to set goal",
  materializeError: "Failed to load goal attachments",
  cleanupError: "Goal attachments could not be cleaned up",
  cleanupRetry: "Retry cleanup",
};
const zh: typeof en = {
  status: {
    active: "进行中的目标",
    paused: "已暂停的目标",
    blocked: "目标已停滞",
    usageLimited: "目标使用受限",
    budgetLimited: "目标受限",
    complete: "已达成目标",
  },
  goal: "目标",
  edit: "编辑目标",
  clear: "清除目标",
  pause: "暂停目标",
  resume: "恢复目标",
  cancel: "取消",
  save: "保存",
  close: "关闭对话框",
  draft: "目标",
  cancelDraft: "明确目标",
  replaceTitle: "替换当前目标吗？",
  replaceSubtitle: "这会保留聊天，但会用你当前在输入框中的文本替换已保存的目标",
  replace: "替换目标",
  resumePausedTitle: "恢复已暂停的目标吗？",
  resumeTitle: "恢复目标？",
  resumeConfirm: "继续目标",
  resumeSubtitle: "聊天处于空闲状态时，ChatGPT 会继续推进此目标",
  keepPaused: "保持已暂停",
  notNow: "以后再说",
  loadError: "未成功加载目标",
  saveError: "未成功保存目标",
  statusError: "无法更新目标",
  clearError: "无法清除目标",
  setError: "无法设置目标",
  materializeError: "未能加载目标附件",
  cleanupError: "目标附件暂未清理",
  cleanupRetry: "重试清理",
};

export function goalStrings(locale: string) {
  return locale.startsWith("zh") ? zh : en;
}
