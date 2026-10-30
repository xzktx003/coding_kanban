import {
  markAcpRuntimeOwnerFailed,
  useAcpRuntimeOwnersStore,
} from "./acpRuntimeOwners";
import { useAcpStore } from "../stores/useAcpStore";
import { useWorkspaceStore } from "../stores/useWorkspaceStore";
import { usePairingStore } from "../stores/usePairingStore";
import { acpReadConnectionSnapshot } from "./apiAdapt/acp";
import {
  ACP_CONNECTION_POINTER_KEY,
  prepareSavedAcpConnection,
  readAcpConnectionPointer,
  type AcpConnectionPointer,
} from "./acpConnectionRecoveryPointer";
import { refreshAcpTranscript } from "./acpTranscriptRead";
import { runAcpSessionOperation } from "../components/acp/sessionOperations";
import { buildUrl } from "../hooks/runtime";
import { readWithDeadline } from "./sessionReadQueue";

export { requestAcpConnectionRecovery } from "./acpConnectionRecoveryPointer";
/** A refresh observes an existing runtime owner; it cannot create or load one. */
export function startAcpConnectionRecovery() {
  let stopped = false,
    working = false,
    controller: AbortController | null = null,
    lastSaved = "";
  prepareSavedAcpConnection();
  function persist() {
    if (stopped || working) return;
    const state = useAcpStore.getState();
    if (
      !state.connectionId ||
      !state.sessionId ||
      !state.runtimeInstance ||
      !state.connectionEndpoint ||
      state.connectionEndpoint !== buildUrl("/api/acp/connection-snapshot")
    )
      return;
    const pointer: AcpConnectionPointer = {
      version: 1,
      endpoint: state.connectionEndpoint,
      runtimeInstance: state.runtimeInstance,
      agentId: state.agentId,
      connectionId: state.connectionId,
      sessionId: state.sessionId,
      ...(state.historySessionId?{historySessionId:state.historySessionId}:{}),
      active: state.active,
    };
    const raw = JSON.stringify(pointer);
    if (raw === lastSaved) return;
    try {
      sessionStorage.setItem(ACP_CONNECTION_POINTER_KEY, raw);
      lastSaved = raw;
    } catch {
      /* The live owner remains valid when device pointer storage is unavailable. */
    }
  }
  async function recover(recheck = false) {
    if (stopped || working) return;
    const pointer = readAcpConnectionPointer(),
      before = useAcpStore.getState();
    if (
      !pointer ||
      (!pointer.active && !before.active) ||
      (!recheck && before.connectionId) ||
      before.agentId !== pointer.agentId ||
      (before.connectionId &&
        (before.connectionId !== pointer.connectionId ||
          before.sessionId !== pointer.sessionId ||
          before.runtimeInstance !== pointer.runtimeInstance))
    )
      return;
    working = true;
    controller = new AbortController();
    const abort = controller;
    useAcpStore.setState({
      active: true,
      connectionRecovery: "recovering",
      sessionTransitionError: null,
    });
    try {
      await runAcpSessionOperation(
        "正在恢复已有 Agent 连接…",
        async (isLatest) => {
          const owns = () =>
            !stopped &&
            !abort.signal.aborted &&
            isLatest() &&
            useAcpStore.getState().active &&
            useAcpStore.getState().agentId === pointer.agentId &&
            useAcpStore.getState().connectionId === before.connectionId &&
            useAcpStore.getState().sessionId === before.sessionId &&
            useAcpStore.getState().runtimeInstance === before.runtimeInstance &&
            pointer.endpoint === buildUrl("/api/acp/connection-snapshot");
          try {
            const revision = () =>
              Object.values(useAcpRuntimeOwnersStore.getState().owners).find(
                (owner) =>
                  owner.endpoint === pointer.endpoint &&
                  owner.runtimeInstance === pointer.runtimeInstance &&
                  owner.connectionId === pointer.connectionId &&
                  owner.sessionId === pointer.sessionId,
              )?.eventRevision ?? 0;
            let snapshot:
              | Awaited<ReturnType<typeof acpReadConnectionSnapshot>>
              | undefined;
            for (let attempt = 0; attempt < 3; attempt++) {
              const beforeEvents = revision();
              snapshot = await readWithDeadline(
                (signal) =>
                  acpReadConnectionSnapshot(
                    pointer.connectionId,
                    pointer.sessionId,
                    pointer.runtimeInstance,
                    { signal, suppressToast: true },
                  ),
                10_000,
                abort.signal,
              );
              if (!owns()) return;
              if (beforeEvents === revision()) break;
              snapshot = undefined;
            }
            if (!snapshot)
              throw new Error("已有会话的审批状态正在变化，请重试只读核对。");
            if (!owns()) return;
            if (
              snapshot.runtimeInstance !== pointer.runtimeInstance ||
              snapshot.connectionId !== pointer.connectionId ||
              snapshot.agentId !== pointer.agentId ||
              snapshot.sessionId !== pointer.sessionId ||
              typeof snapshot.historySessionId!=="string" || !snapshot.historySessionId || snapshot.historySessionId===snapshot.sessionId ||
              (pointer.historySessionId!==undefined&&pointer.historySessionId!==snapshot.historySessionId) ||
              !snapshot.cwd?.startsWith("/") ||
              !snapshot.initialize ||
              snapshot.session?.sessionId !== pointer.sessionId ||
              !Array.isArray(snapshot.permissions)
            )
              throw new Error("服务返回的 Agent 连接身份与保存目标不一致。");
            const state = useAcpStore.getState();
            if (before.connectionId) {
              const key = JSON.stringify([
                snapshot.connectionId,
                snapshot.sessionId,
              ]);
              const old = before.pendingPermissions[key] ?? [];
              const now = state.pendingPermissions[key] ?? [];
              const oldIds = new Set(old.map((item) => item.requestId)),
                nowIds = new Set(now.map((item) => item.requestId));
              const observed = snapshot.permissions
                .filter(
                  (item) =>
                    !oldIds.has(item.requestId) || nowIds.has(item.requestId),
                )
                .map((item) => ({
                  connectionId: snapshot.connectionId,
                  sessionId: item.sessionId,
                  requestId: item.requestId,
                  title: item.toolCall?.title ?? "Permission requested",
                  toolKind: item.toolCall?.kind,
                  options: item.options,
                }));
              const seen = new Set(observed.map((item) => item.requestId));
              const permissions = [
                ...observed,
                ...now.filter(
                  (item) =>
                    !oldIds.has(item.requestId) && !seen.has(item.requestId),
                ),
              ];
              state.applySession(snapshot.session);
              useAcpStore.setState({
                running: snapshot.running || snapshot.deliveryUnknown,
                connectionRecovery: null,
                pendingPermissions: {
                  ...state.pendingPermissions,
                  [key]: permissions,
                },
                permission: permissions[0] ?? null,
                sessionTransitionError:
                  snapshot.deliveryUnknown || snapshot.lifecycleUnknown
                    ? "已有操作的原生回执尚未确认，未自动重发或新建会话。请先核对当前任务。"
                    : null,
              });
              return;
            }
            state.setConnection({
              historySessionId:snapshot.historySessionId,
              connectionId: snapshot.connectionId,
              runtimeInstance: snapshot.runtimeInstance,
              connectionEndpoint: pointer.endpoint,
              sessionId: snapshot.sessionId,
              cwd: snapshot.cwd,
              agentTitle:
                snapshot.initialize.agentInfo?.title ??
                snapshot.initialize.agentInfo?.name ??
                snapshot.agentId,
              authMethods: snapshot.initialize.authMethods ?? [],
              canLoadSession:
                snapshot.initialize.agentCapabilities?.loadSession === true,
              canInputImages:
                (
                  snapshot.initialize.agentCapabilities?.promptCapabilities as
                    | { image?: boolean }
                    | undefined
                )?.image === true,
            });
            state.applySession(snapshot.session);
            useAcpStore.setState({
              sessionCwd: snapshot.cwd,
              running: snapshot.running || snapshot.deliveryUnknown,
              connectionRecovery: null,
              ...(snapshot.deliveryUnknown || snapshot.lifecycleUnknown
                ? {
                    sessionTransitionError:
                      "已有操作的原生回执尚未确认，未自动重发或新建会话。请先核对当前任务。",
                  }
                : {}),
            });
            useWorkspaceStore.getState().setCwd(snapshot.cwd);
            for (const permission of snapshot.permissions)
              state.setPermission({
                connectionId: snapshot.connectionId,
                sessionId: permission.sessionId,
                requestId: permission.requestId,
                title: permission.toolCall?.title ?? "Permission requested",
                toolKind: permission.toolCall?.kind,
                options: permission.options,
              });
            void refreshAcpTranscript({
              agentId: pointer.agentId,
              connectionId: pointer.connectionId,
              sessionId: pointer.sessionId,
              historySessionId:snapshot.historySessionId,
            }).catch(() => {});
          } catch (reason) {
            if (!owns()) return;
            markAcpRuntimeOwnerFailed(
              pointer.connectionId,
              pointer.sessionId,
              String(reason),
            );
            useAcpStore.setState({
              connectionRecovery: "failed",
              connecting: false,
              sessionTransitionError: `无法恢复已有 Agent 连接：${reason instanceof Error ? reason.message : String(reason)}。未启动替代服务，草稿和原任务状态保留。`,
            });
          }
        },
      );
    } finally {
      working = false;
      if (controller === abort) controller = null;
      const current = useAcpStore.getState();
      if (
        current.connectionRecovery === "recovering" &&
        (!current.active || current.agentId !== pointer.agentId)
      )
        useAcpStore.setState({ connectionRecovery: null });
      persist();
    }
  }
  const stopStore = useAcpStore.subscribe((next, before) => {
    if (next.restartNonce !== before.restartNonce) {
      controller?.abort();
      try {
        sessionStorage.removeItem(ACP_CONNECTION_POINTER_KEY);
      } catch {}
      lastSaved = "";
      return;
    }
    if (
      working &&
      (!next.active || next.agentId !== readAcpConnectionPointer()?.agentId)
    )
      controller?.abort();
    if (before.active && !next.active) {
      const pointer = readAcpConnectionPointer();
      if (pointer)
        try {
          const raw = JSON.stringify({ ...pointer, active: false });
          sessionStorage.setItem(ACP_CONNECTION_POINTER_KEY, raw);
          lastSaved = raw;
        } catch {}
    }
    persist();
  });
  const retry = () => {
    if (!working) void recover(true);
  };
  const stopPairing = usePairingStore.subscribe(() => {
    if (!readAcpConnectionPointer()) {
      controller?.abort();
      useAcpStore.setState({
        connectionId: null,
        sessionId: null,
        connectionEndpoint: null,
        runtimeInstance: null,
        entries: [],
        permission: null,
        running: false,
        connectionRecovery: "failed",
        sessionTransitionError: "目标设备已改变，请重新核对 Agent 连接。",
      });
    }
  });
  window.addEventListener("session-acp-recovery-retry", retry);
  window.addEventListener("session-runtime-restarted", retry);
  void recover();
  persist();
  return () => {
    stopped = true;
    controller?.abort();
    stopStore();
    stopPairing();
    window.removeEventListener("session-acp-recovery-retry", retry);
    window.removeEventListener("session-runtime-restarted", retry);
  };
}
