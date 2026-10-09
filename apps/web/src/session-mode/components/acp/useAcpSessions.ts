import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "@session/components/ui/use-toast";
import {
  type AcpSessionRecord,
  acpDeleteSession,
  acpGetSession,
  acpListSessions,
  acpLoadSession,
  acpNewSession,
  acpStart,
  acpCancel,
  acpStop,
} from "@session/services/apiAdapt/acp";
import { useWorkspaceStore } from "@session/stores";
import { useAcpStore } from "@session/stores/useAcpStore";
import { applyAcpUpdate } from "./applyUpdate";
import { acpFreshSession } from "./newSession";
import { runAcpSessionOperation } from "./sessionOperations";
import { useSessionActionConfirmation } from "../common/useSessionActionConfirmation";

/**
 * The persisted ACP sessions of one project directory, plus the actions the
 * sidebar needs. Sessions are stored by the backend as they run: ACP has no
 * listing RPC of its own.
 */
export function useAcpSessions(directory: string) {
  const setCwd = useWorkspaceStore((s) => s.setCwd);
  const { ask, confirmation } = useSessionActionConfirmation();
  const { sessionId, entries } = useAcpStore();
  const [sessions, setSessions] = useState<AcpSessionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);
  const [opening, setOpening] = useState<string | null>(null);
  const openingVersion = useRef(0);

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
    try {
      const result = await acpListSessions(directory);
      if (request === requestRef.current) setSessions(result);
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
    };
  }, [refresh, sessionId, entries.length]);

  /**
   * Open a stored session. Agents that advertise `loadSession` get a real
   * resume; for the others the transcript is replayed locally as history and
   * the new prompt starts a fresh agent-side session.
   */
  const open = useCallback(
    async (record: AcpSessionRecord) => {
      const original = useAcpStore.getState();
      const originalCwd = useWorkspaceStore.getState().cwd;
      const switchingAgent =
        !!original.connectionId && original.agentId !== record.agentId;
      if (
        original.running &&
        original.sessionId === record.sessionId &&
        original.agentId === record.agentId &&
        !switchingAgent
      ) {
        // The persisted record confirms the already running session's project.
        // Returning to it is navigation, not a native load or interruption.
        setCwd(record.cwd);
        useAcpStore.setState({ sessionCwd: record.cwd });
        return;
      }
      const mustInterrupt = original.running || switchingAgent;
      if (mustInterrupt) {
        const accepted = await ask({
          title: switchingAgent
            ? "切换 Agent 并打开历史？"
            : "中断任务并打开历史？",
          description: switchingAgent
            ? "打开此历史会关闭当前 Agent 服务。会话记录和草稿会保留。"
            : "当前任务会被中断。会话记录和草稿会保留，取消后继续原任务。",
          confirmLabel: switchingAgent ? "关闭服务并打开" : "中断并打开",
        });
        const current = useAcpStore.getState();
        if (
          !accepted ||
          current.connectionId !== original.connectionId ||
          current.sessionId !== original.sessionId ||
          current.agentId !== original.agentId ||
          current.active !== original.active ||
          useWorkspaceStore.getState().cwd !== originalCwd
        )
          return;
      }
      const version = ++openingVersion.current;
      openingVersion.current = version;
      setOpening(record.sessionId);
      setCwd(record.cwd);
      await runAcpSessionOperation(
        `正在恢复 ${record.title || record.sessionId}…`,
        async (isLatest) => {
          const store = useAcpStore.getState();
          const ownsSelection = () =>
            isLatest() &&
            useWorkspaceStore.getState().cwd === record.cwd &&
            useAcpStore.getState().active === store.active;
          try {
            if (store.running || switchingAgent) {
              if (
                !mustInterrupt ||
                store.connectionId !== original.connectionId ||
                store.sessionId !== original.sessionId ||
                store.agentId !== original.agentId
              )
                return;
              try {
                if (switchingAgent && original.connectionId)
                  await acpStop(original.connectionId);
                else if (original.connectionId && original.sessionId)
                  await acpCancel(original.connectionId, original.sessionId);
                else throw new Error("当前任务缺少明确的连接身份");
              } catch (error) {
                if (ownsSelection())
                  toast({
                    title: "无法打开历史",
                    description: `中断失败，原任务保持不变：${String(error)}`,
                    variant: "destructive",
                  });
                return;
              }
              if (
                !ownsSelection() ||
                useAcpStore.getState().connectionId !== original.connectionId ||
                useAcpStore.getState().sessionId !== original.sessionId
              )
                return;
              store.setRunning(false);
              if (switchingAgent) {
                const transition = useAcpStore.getState().sessionTransition;
                store.reset();
                useAcpStore.setState({ sessionTransition: transition });
              }
            }
            let connectionId = switchingAgent ? null : store.connectionId;
            let canLoadSession = store.canLoadSession;
            // Whether the connection was spawned right here, in which case it
            // already carries a fresh session from `session/new`.
            let startedFresh = false;

            // Only a different agent (or no live process) needs its own connection:
            // cwd is a session-level parameter, so the running process can serve a
            // session in another project too.
            if (!connectionId || store.agentId !== record.agentId) {
              const res = await acpStart(record.agentId, record.cwd);
              if (!ownsSelection()) {
                if (useAcpStore.getState().connectionId !== res.connectionId)
                  await acpStop(res.connectionId).catch(() => {});
                return;
              }
              connectionId = res.connectionId;
              canLoadSession =
                res.initialize.agentCapabilities?.loadSession === true;
              store.setAgentId(record.agentId);
              store.setConnection({
                connectionId: res.connectionId,
                cwd: record.cwd,
                sessionId: res.sessionId,
                agentTitle:
                  res.initialize.agentInfo?.title ??
                  res.initialize.agentInfo?.name ??
                  record.agentId,
                authMethods: res.initialize.authMethods ?? [],
                canLoadSession,
                canInputImages:
                  (
                    res.initialize.agentCapabilities?.promptCapabilities as
                      | { image?: boolean }
                      | undefined
                  )?.image === true,
              });
              store.applySession(res.session);
              startedFresh = true;
            }

            store.setEntries([]);

            if (canLoadSession) {
              // The agent replays the transcript as live `session/update` events,
              // so the pane must already point at this session or the replay is
              // filtered out as belonging to another one.
              store.setSessionId(record.sessionId);
              const session = await acpLoadSession(
                connectionId,
                record.sessionId,
                record.cwd,
              );
              if (
                !ownsSelection() ||
                useAcpStore.getState().connectionId !== connectionId ||
                useAcpStore.getState().sessionId !== record.sessionId
              )
                return;
              store.applySession({ ...session, sessionId: record.sessionId });
              useAcpStore.setState({ sessionCwd: record.cwd });
            } else {
              // The agent cannot resume this session, so the stored transcript is
              // shown as history only. The next prompt needs a session the agent
              // process actually knows — reuse the one it was just started with,
              // else open a new one, so prompts do not target the dead id.
              if (!startedFresh) {
                const nextSession = await acpNewSession(
                  connectionId,
                  record.cwd,
                );
                if (!ownsSelection()) return;
                store.applySession(nextSession);
                useAcpStore.setState({ sessionCwd: record.cwd });
              }
              const updates = await acpGetSession(record.sessionId);
              if (!ownsSelection()) return;
              for (const update of updates) {
                applyAcpUpdate(update as Record<string, any>);
              }
            }
          } catch (e) {
            if (!ownsSelection()) return;
            // Replay temporarily selects the destination. A rejected load must
            // not erase the original transcript or pretend the old task ended.
            const current = useAcpStore.getState();
            if (
              !switchingAgent &&
              store.canLoadSession &&
              current.connectionId === store.connectionId &&
              current.sessionId === record.sessionId
            ) {
              store.setSessionId(store.sessionId);
              useAcpStore.setState({
                entries: store.entries,
                sessionCwd: store.sessionCwd,
                running: store.running,
              });
            }
            useAcpStore.setState({
              sessionTransitionError: `恢复会话失败：${String(e)}。请重新打开该会话重试。`,
            });
            toast({
              title: "Failed to open session",
              description: String(e),
              variant: "destructive",
            });
          } finally {
            if (openingVersion.current === version) setOpening(null);
          }
        },
      );
      if (openingVersion.current === version) setOpening(null);
    },
    [setCwd, ask],
  );

  const remove = useCallback(
    async (record: AcpSessionRecord) => {
      const original = useAcpStore.getState();
      if (
        original.agentId === record.agentId &&
        original.sessionId === record.sessionId
      ) {
        if (original.running)
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
      await acpDeleteSession(record.sessionId);
      void refresh();
    },
    [refresh],
  );

  return {
    sessions,
    opening,
    loading,
    error,
    refresh,
    open,
    remove,
    confirmation,
  };
}
