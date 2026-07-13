export function formatSessionLaunchError(
  error: unknown,
  sessionName: string,
): string {
  const detail =
    error instanceof Error && error.message.trim()
      ? error.message.trim()
      : sessionName;

  return `创建失败：${detail}`;
}
