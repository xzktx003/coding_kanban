export function emptySendGuard({
  hasContent,
  threadId,
  workspace,
}: {
  hasContent: boolean;
  threadId: string | null;
  workspace: string | null;
}) {
  if (threadId || workspace) return null;
  return {
    title: "无法发送消息",
    message: "请先打开文件夹或工作区",
  };
}
