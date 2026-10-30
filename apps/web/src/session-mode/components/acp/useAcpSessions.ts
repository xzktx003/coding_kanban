import { useCallback, useEffect, useRef, useState } from "react";
import {
  type AcpSessionRecord,
  acpDeleteSession,
  acpListSessions,
} from "@session/services/apiAdapt/acp";
import { useWorkspaceStore } from "@session/stores";
import { useAcpStore } from "@session/stores/useAcpStore";
import { acpFreshSession } from "./newSession";
import {
  findAcpRuntimeOwnerByHistory,
  openAcpRuntimeOwner,
} from "@session/services/acpRuntimeOwners";
import {
  captureHistorySourceScope,
  isHistorySourceScopeCurrent,
  watchHistorySourceScope,
} from "../history/historySourceScope";

/**
 * The persisted ACP sessions of one project directory, plus the actions the
 * sidebar needs. Sessions are stored by the backend as they run: ACP has no
 * listing RPC of its own.
 */
export function useAcpSessions(directory: string) {
  const setCwd = useWorkspaceStore((s) => s.setCwd);
  const { sessionId, entries } = useAcpStore();
  const [sessions, setSessions] = useState<AcpSessionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);
  const listScope = useRef<ReturnType<typeof captureHistorySourceScope> | null>(
    null,
  );
  const stopScope = useRef<(() => void) | null>(null);

  useEffect(() => {
    setSessions([]);
  }, [directory]);

  const refresh = useCallback(async () => {
    const request = ++requestRef.current;
    if (!directory) {
      setSessions([]);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    const scope = captureHistorySourceScope("/api/acp/sessions");
    stopScope.current?.();
    listScope.current = scope;
    stopScope.current = watchHistorySourceScope(scope, () => {
      requestRef.current++;
      setSessions([]);
      setLoading(false);
      setError("连接或账号已变化，请重新读取会话列表。");
    });
    try {
      const result = await acpListSessions(directory);
      if (request === requestRef.current && isHistorySourceScopeCurrent(scope))
        setSessions(result);
    } catch (e) {
      if (request === requestRef.current)
        setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, [directory]);

  // Re-list when the workspace changes, and after a turn lands in the store so
  // a new session shows up with its title.
  // biome-ignore lint/correctness/useExhaustiveDependencies: deliberate re-list triggers, not values refresh reads
  useEffect(() => {
    void refresh();
    return () => {
      requestRef.current++;
      stopScope.current?.();
      stopScope.current = null;
    };
  }, [refresh, sessionId, entries.length]);

  // History selection never changes an ACP process or its native context.
  const open = useCallback(
    async (record: AcpSessionRecord) => {
      if (
        listScope.current &&
        !isHistorySourceScopeCurrent(listScope.current)
      ) {
        setError("连接或账号已变化，请重新读取会话列表。");
        return;
      }
      const original = useAcpStore.getState();
      if (
        original.connectionId &&
        original.agentId === record.agentId &&
        (original as { historySessionId?: string | null }).historySessionId ===
          record.sessionId
      ) {
        setCwd(original.sessionCwd ?? record.cwd);
        useAcpStore.setState({
          sessionCwd: original.sessionCwd ?? record.cwd,
          inheritedHistory: null,
        });
        return;
      }
      const nativeId = (
        record as AcpSessionRecord & { nativeSessionId?: string }
      ).nativeSessionId;
      const live = findAcpRuntimeOwnerByHistory(
        record.agentId,
        record.sessionId,
      );
      if (live?.verified) {
        setCwd(live.cwd || record.cwd);
        openAcpRuntimeOwner(live.key);
        return;
      }
      useAcpStore.setState({
        inheritedHistory: {
          sessionId: record.sessionId,
          agentId: record.agentId,
          title: record.title || record.sessionId,
          cwd: record.cwd,
          viewOnly: true,
          nativeSessionId: nativeId,
          sourceScope:
            listScope.current ?? captureHistorySourceScope("/api/acp/session"),
        },
      });
    },
    [setCwd],
  );

  const remove = useCallback(
    async (record: AcpSessionRecord) => {
      const scope =
        listScope.current ?? captureHistorySourceScope("/api/acp/sessions");
      if (!isHistorySourceScopeCurrent(scope))
        throw new Error("连接或账号已变化，请重新读取会话列表。");
      const original = useAcpStore.getState();
      const owner = findAcpRuntimeOwnerByHistory(
        record.agentId,
        record.sessionId,
      );
      if (
        owner &&
        (!owner.verified || owner.running || owner.pendingCount || owner.error)
      )
        throw new Error(
          "该会话仍有任务、审批或未核实状态，请先返回原连接明确处理。",
        );
      if (
        original.agentId === record.agentId &&
        (original.historySessionId === record.sessionId ||
          (!original.historySessionId &&
            original.sessionId === record.sessionId))
      ) {
        if (
          original.running ||
          original.permission ||
          Object.values(original.pendingPermissions).some(
            (rows) => rows.length,
          ) ||
          original.sessionTransitionError
        )
          throw new Error("当前任务仍在运行，请先显式停止任务再删除记录。");
        if (original.sessionTransition)
          throw new Error("会话正在切换，请完成后重试。");
        // Establish a usable replacement before irreversibly removing history.
        // No restart or interruption is authorized by deletion.
        const cwd = useWorkspaceStore.getState().cwd;
        const replaced =
          original.connectionId && cwd
            ? await acpFreshSession(original.connectionId, cwd)
            : false;
        if (!replaced)
          throw new Error(
            "无法创建新会话，原记录已保留。请先新建或重新连接，再删除记录。",
          );
      }
      if (!isHistorySourceScopeCurrent(scope))
        throw new Error("连接或账号已变化，原记录已保留；请重新读取后删除。");
      await acpDeleteSession(record.sessionId);
      void refresh();
    },
    [refresh],
  );

  return {
    sessions,
    opening: null,
    loading,
    error,
    refresh,
    open,
    remove,
    confirmation: null,
  };
}
