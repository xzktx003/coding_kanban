import {
  acpStart,
  acpLoadSession,
  acpStop,
} from "@session/services/apiAdapt/acp";
import { useAcpStore } from "@session/stores/useAcpStore";
import { useWorkspaceStore } from "@session/stores/useWorkspaceStore";
import {
  rememberCurrentAcpOwner,
  findAcpRuntimeOwnerByHistory,
  openAcpRuntimeOwner,
  assertAcpRuntimeOwnerCapacity,
  useAcpRuntimeOwnersStore,
} from "@session/services/acpRuntimeOwners";
import { buildUrl } from "@session/hooks/runtime";
import {
  captureHistorySourceScope,
  isHistorySourceScopeCurrent,
} from "../history/historySourceScope";
import { runAcpSessionOperation } from "./sessionOperations";
export interface AcpStoredSource {
  sessionId: string;
  nativeSessionId?: string;
  agentId?: string;
  title: string;
  cwd: string;
  viewOnly?: boolean;
  sourceScope?: ReturnType<typeof captureHistorySourceScope>;
}
/** Explicit user action only. The previous connection stays registered and running. */
export async function continueStoredAcpSession(source: AcpStoredSource) {
  if (!source.agentId)
    throw new Error("旧记录缺少可核实Agent，请先明确选择Agent后新建上下文。");
  const agentId = source.agentId;
  const scope =
    source.sourceScope ?? captureHistorySourceScope("/api/acp/session");
  const current = () => isHistorySourceScopeCurrent(scope);
  if (!current())
    throw new Error("原记录的账号或设备范围已变化，请重新读取后继续。");
  const known = findAcpRuntimeOwnerByHistory(agentId, source.sessionId);
  if (known?.verified) {
    openAcpRuntimeOwner(known.key);
    useWorkspaceStore.getState().setCwd(known.cwd || source.cwd);
    return;
  }
  rememberCurrentAcpOwner();
  assertAcpRuntimeOwnerCapacity();
  const before = useAcpStore.getState(),
    beforeCwd = useWorkspaceStore.getState().cwd;
  let expected = {
    agentId: before.agentId,
    connectionId: before.connectionId,
    sessionId: before.sessionId,
  };
  let admitted = false;
  await runAcpSessionOperation(
    "正在为原记录启动独立Agent连接…",
    async (latest) => {
      const owns = () =>
        latest() &&
        current() &&
        useAcpStore.getState().agentId === expected.agentId &&
        useAcpStore.getState().connectionId === expected.connectionId &&
        useAcpStore.getState().sessionId === expected.sessionId;
      if (!owns()) return;
      const created = await acpStart(agentId, source.cwd);
      const discardUnused = async () => {
        // Only this explicit gesture's unused connection may be closed. An account
        // change revokes the write scope, so even cleanup must stop at that point.
        if (
          current() &&
          !Object.values(useAcpRuntimeOwnersStore.getState().owners).some(
            (owner) => owner.connectionId === created.connectionId,
          )
        )
          await acpStop(created.connectionId).catch(() => {});
      };
      if (!owns() || useWorkspaceStore.getState().cwd !== beforeCwd) {
        await discardUnused();
        return;
      }
      const historySessionId =
        created.historySessionId ?? created.session?.historySessionId;
      if (
        !created.runtimeInstance ||
        !created.connectionId ||
        (created.sessionId && !historySessionId)
      ) {
        await discardUnused();
        throw new Error("当前服务未提供可核实的独立连接与历史来源身份。");
      }
      const store = useAcpStore.getState();
      store.setEntries([]);
      store.setRunning(false);
      store.setActive(true);
      store.setAgentId(agentId);
      store.setConnection({
        connectionId: created.connectionId,
        runtimeInstance: created.runtimeInstance,
        connectionEndpoint: buildUrl("/api/acp/connection-snapshot"),
        cwd: source.cwd,
        sessionId: created.sessionId,
        historySessionId,
        agentTitle:
          created.initialize.agentInfo?.title ??
          created.initialize.agentInfo?.name ??
          agentId,
        authMethods: created.initialize.authMethods ?? [],
        canLoadSession:
          created.initialize.agentCapabilities?.loadSession === true,
        canInputImages:
          (
            created.initialize.agentCapabilities?.promptCapabilities as
              | { image?: boolean }
              | undefined
          )?.image === true,
      });
      store.applySession(created.session);
      expected = {
        agentId,
        connectionId: created.connectionId,
        sessionId: useAcpStore.getState().sessionId,
      };
      useWorkspaceStore.getState().setCwd(source.cwd);
      admitted = true;
      if (created.sessionError) throw new Error(created.sessionError);
      if (
        source.nativeSessionId &&
        created.initialize.agentCapabilities?.loadSession === true
      ) {
        useAcpStore.getState().setSessionId(source.nativeSessionId);
        expected = { ...expected, sessionId: source.nativeSessionId };
        const loaded = await acpLoadSession(
          created.connectionId,
          source.nativeSessionId,
          source.cwd,
        );
        if (!owns()) return;
        if (
          loaded.sessionId !== source.nativeSessionId ||
          !loaded.historySessionId
        )
          throw new Error("原生加载回执的目标或历史来源身份无法核实。");
        useAcpStore.getState().applySession(loaded);
        useAcpStore.setState({
          sessionCwd: source.cwd,
          inheritedHistory: null,
        });
      } else {
        // The historical source ID is not a native session ID. Legacy sources
        // without a verified native ID remain visibly separate from fresh context.
        useAcpStore.setState({
          inheritedHistory: { ...source, viewOnly: false },
        });
      }
      rememberCurrentAcpOwner();
    },
  ).catch((error) => {
    if (
      current() &&
      admitted &&
      useAcpStore.getState().connectionId === expected.connectionId
    )
      useAcpStore.setState({
        sessionTransitionError: `继续会话尚未完成：${String(error)}；原任务与记录保留，请明确核对新连接。`,
      });
    throw error;
  });
}
