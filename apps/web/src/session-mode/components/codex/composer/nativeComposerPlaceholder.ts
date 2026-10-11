export function nativeComposerPlaceholder({
  goal,
  plan,
  threadId,
}: {
  goal?: boolean;
  plan?: boolean;
  threadId: string | null;
}) {
  // Native nOi / composer.placeholder.*. The bundled zh-CN plan string says
  // "套餐"; the source message is a task plan, so the visible text stays 计划.
  if (goal) return "描述你的目标，定义可衡量的成果，以获得最佳效果";
  if (plan) return "描述你的任务以生成计划…";
  // Native wU identifies a local follow-up by conversation identity, even
  // before its first turn has produced timing or transcript metadata.
  return threadId !== null
    ? "提出后续变更要求"
    : "可向 Codex 询问任何问题。输入 @ 使用插件或提及文件";
}
