function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function canonicalTmuxDisplayName(tmuxSession: string): string {
  return tmuxSession;
}

export function normalizeTmuxSessionName(
  tmuxSession: string | undefined,
): string | undefined {
  return tmuxSession?.replace(/[.:]/g, "_");
}

export function normalizeTmuxDisplayName(
  displayName: string,
  tmuxSession?: string,
): string {
  if (!tmuxSession) {
    return displayName;
  }

  const escapedSession = escapeRegExp(tmuxSession);
  const generatedPatterns = [
    new RegExp(`^tmux:${escapedSession}$`),
    new RegExp(`^tmux:${escapedSession} \\([^\\r\\n]+\\)$`),
    new RegExp(`^tmux:${escapedSession}/[^\\r\\n]+ \\(远程: [^\\r\\n]+\\)$`),
  ];

  return generatedPatterns.some((pattern) => pattern.test(displayName))
    ? canonicalTmuxDisplayName(tmuxSession)
    : displayName;
}
