import { useCCStore } from "../stores/cc";
import { useAgentCenterStore } from "../stores/useAgentCenterStore";
import { buildUrl } from "../hooks/runtime";
import { ccReadSessionSnapshot, ccResumeSession } from "./apiAdapt/cc";
import { SessionApiError } from "./apiAdapt/shared";
import {
  claudeConnectionOwner,
  claudeEventSequence,
  useClaudeConnectionStore,
} from "./claudeConnectionIdentity";
import type { CcAgentOptionsPayload } from "../types/cc/agentOptions";
import type { PermissionRequestMessage } from "../components/cc/types/messages";
import { readWithDeadline } from "./sessionReadQueue";
import { admitClaudeTranscript } from "./providerTranscriptAdmission";

/** Metadata-only observation. Selecting/restoring a card never creates a Query. */
export async function refreshClaudeConnection(
  id: string,
  cwd: string,
  signal?: AbortSignal,
) {
  const endpoint = buildUrl("/api/cc/session-snapshot"),
    sequence = claudeEventSequence(id),
    previous = claudeConnectionOwner(id);
  try {
    const snapshot = await readWithDeadline(
      (s) => ccReadSessionSnapshot(id, cwd, { signal: s, suppressToast: true }),
      10000,
      signal,
    );
    const currentOwner = claudeConnectionOwner(id);
    if (
      signal?.aborted ||
      endpoint !== buildUrl("/api/cc/session-snapshot") ||
      (currentOwner !== previous &&
        (!currentOwner ||
          currentOwner.runtimeInstance !== snapshot.runtimeInstance ||
          currentOwner.cwd !== snapshot.cwd ||
          currentOwner.eventSessionId !== snapshot.eventSessionId))
    )
      throw new Error("Claude 连接恢复目标已改变，请重试");
    if (
      snapshot.sessionId !== id ||
      snapshot.cwd !== cwd ||
      !snapshot.runtimeInstance ||
      !snapshot.eventSessionId ||
      !Array.isArray(snapshot.permissions) ||
      typeof snapshot.running !== "boolean" ||
      typeof snapshot.connected !== "boolean"
    )
      throw new Error("Claude 连接恢复身份无效");
    const newer = sequence !== claudeEventSequence(id);
    useClaudeConnectionStore.setState((s) => {
      const owner = {
        endpoint,
        sessionId: id,
        eventSessionId: snapshot.eventSessionId,
        nativeSessionId: snapshot.nativeSessionId,
        runtimeInstance: snapshot.runtimeInstance,
        cwd,
        running: newer
          ? !!useCCStore.getState().sessionLoadingMap[id]
          : snapshot.running,
        connected: snapshot.connected,
      };
      const warning = snapshot.historyRecoveryError;
      if (
        s.errors[id] === warning &&
        JSON.stringify(s.owners[id]) === JSON.stringify(owner)
      )
        return s;
      const errors = { ...s.errors };
      if (warning) errors[id] = warning;
      else delete errors[id];
      return { errors, owners: { ...s.owners, [id]: owner } };
    });
    if (sequence !== claudeEventSequence(id)) return snapshot;
    const state = useCCStore.getState(),
      current = state.sessionMessagesMap[id] ?? [];
    const pendingIds = new Set(snapshot.permissions.map((p) => p.requestId));
    const retained = current.filter(
      (m) =>
        m.type !== "permission_request" ||
        m.resolved ||
        pendingIds.has(m.requestId),
    );
    const existing = new Map(
      current
        .filter(
          (m): m is PermissionRequestMessage => m.type === "permission_request",
        )
        .map((m) => [m.requestId, m]),
    );
    const additions = snapshot.permissions
      .filter((p) => !existing.has(p.requestId))
      .map((p) => ({
        type: "permission_request" as const,
        ...p,
        sessionId: id,
        recoveryRuntimeInstance: snapshot.runtimeInstance,
      }));
    const messages =
      retained.length === current.length && !additions.length
        ? current
        : admitClaudeTranscript(id, [...retained, ...additions], current);
    useCCStore.setState((s) => {
      const active = s.activeSessionId === id,
        known = s.activeSessionIds.includes(id),
        changed = messages !== current;
      if (
        s.sessionLoadingMap[id] === snapshot.running &&
        known &&
        !changed &&
        (!active ||
          (s.isLoading === snapshot.running &&
            s.isConnected === snapshot.connected &&
            s.messages === messages))
      )
        return s;
      return {
        sessionLoadingMap:
          s.sessionLoadingMap[id] === snapshot.running
            ? s.sessionLoadingMap
            : { ...s.sessionLoadingMap, [id]: snapshot.running },
        ...(changed
          ? { sessionMessagesMap: { ...s.sessionMessagesMap, [id]: messages } }
          : {}),
        ...(active
          ? {
              isLoading: snapshot.running,
              isConnected: snapshot.connected,
              messages,
            }
          : {}),
        activeSessionIds: known
          ? s.activeSessionIds
          : [...s.activeSessionIds, id],
      };
    });
    return snapshot;
  } catch (error) {
    if (!signal?.aborted && endpoint === buildUrl("/api/cc/session-snapshot")) {
      const owner = claudeConnectionOwner(id);
      if (owner === previous)
        useClaudeConnectionStore.setState((s) => ({
          errors: {
            ...s.errors,
            [id]:
              error instanceof SessionApiError && error.status === 404
                ? "此会话只有历史记录，发送时将显式恢复连接。"
                : error instanceof SessionApiError && error.status === 409
                  ? "运行实例或会话目录已变化，请刷新页面后重新核对；未创建替代连接。"
                  : `无法核对 Claude 实时状态：${error instanceof Error ? error.message : String(error)}。未创建替代连接。`,
          },
          ...(owner
            ? {
                owners: {
                  ...s.owners,
                  [id]: {
                    ...owner,
                    error:
                      error instanceof Error ? error.message : String(error),
                  },
                },
              }
            : {}),
        }));
    }
    throw error;
  }
}
const sendingOwners = new Map<string, Promise<void>>();
/** Called only by a user send/resume gesture; an existing owner is reused. */
export async function ensureClaudeSessionForSend(
  id: string,
  cwd: string,
  options: CcAgentOptionsPayload,
) {
  const key = JSON.stringify([buildUrl("/api/cc/session-snapshot"), id, cwd]);
  const pending = sendingOwners.get(key);
  if (pending) return pending;
  const task = (async () => {
    try {
      await refreshClaudeConnection(id, cwd);
    } catch (error) {
      if (!(error instanceof SessionApiError) || error.status !== 404)
        throw error;
      await ccResumeSession(id, options);
      await refreshClaudeConnection(id, cwd);
    }
  })();
  sendingOwners.set(key, task);
  try {
    await task;
  } finally {
    if (sendingOwners.get(key) === task) sendingOwners.delete(key);
  }
}
export function claudeSessionDirectory(id: string) {
  const card = useAgentCenterStore
    .getState()
    .cards.find((c) => c.kind === "cc" && c.id === id);
  return claudeConnectionOwner(id)?.cwd ?? card?.worktreePath ?? card?.cwd;
}
