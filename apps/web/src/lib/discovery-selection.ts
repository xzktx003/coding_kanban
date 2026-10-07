import type {
  AgentSessionRecord,
  ScanResult,
} from "@agent-orchestrator/shared";

export function scanResultSelectionKey(result: ScanResult): string {
  return JSON.stringify([
    result.sshTarget?.host ?? "local",
    result.sshTarget?.port ?? null,
    result.sshTarget?.username ?? null,
    result.agentKind,
    result.sessionId ?? null,
    result.tmuxSession ?? null,
    result.tmuxPane ?? null,
    result.workingDirectory,
    result.historyPath ?? null,
    result.pid ?? null,
    // Old scanners may omit native IDs; their named target disambiguates
    // otherwise identical paths without replacing real identity with a label.
    result.sessionId || result.tmuxSession || result.historyPath || result.pid
      ? null
      : result.displayName,
  ]);
}

export function tmuxSelectionKey(session: AgentSessionRecord): string {
  return JSON.stringify([
    session.sshTarget?.host ?? session.hostId ?? "local",
    session.sshTarget?.port ?? null,
    session.sshTarget?.username ?? null,
    session.transportRef?.tmuxSession ?? session.id,
    session.transportRef?.tmuxPane ?? null,
  ]);
}

/** Resolve against the original scan, never against a filtered display index. */
export function selectedDiscoveryItems<T>(
  items: readonly T[],
  selected: ReadonlySet<string>,
  key: (item: T) => string,
): T[] {
  return items.filter((item) => selected.has(key(item)));
}
