import { buildUrl } from "../hooks/runtime";
import { useAcpStore } from "../stores/useAcpStore";
export const ACP_CONNECTION_POINTER_KEY =
  "kanban.session.acp.connection-pointer.v1";
export interface AcpConnectionPointer {
  version: 1;
  endpoint: string;
  runtimeInstance: string;
  agentId: string;
  connectionId: string;
  sessionId: string;
  historySessionId?:string;
  active: boolean;
}
export function readAcpConnectionPointer(): AcpConnectionPointer | null {
  try {
    const value = JSON.parse(
      sessionStorage.getItem(ACP_CONNECTION_POINTER_KEY) ?? "null",
    );
    if (
      !value ||
      value.version !== 1 ||
      value.endpoint !== buildUrl("/api/acp/connection-snapshot") ||
      typeof value.active !== "boolean" ||
      ["runtimeInstance", "agentId", "connectionId", "sessionId"].some(
        (key) =>
          typeof value[key] !== "string" ||
          !value[key] ||
          value[key].length > 512 ||
          /[\x00-\x1f]/.test(value[key]),
      )
    )
      return null;
    return value;
  } catch {
    return null;
  }
}
/** Layout-phase UI barrier only. No network, native load or Agent creation. */
export function prepareSavedAcpConnection() {
  const pointer = readAcpConnectionPointer(),
    state = useAcpStore.getState();
  if (state.active && (state.connectionId || state.connectionRecovery))
    return true;
  if (
    !pointer?.active ||
    state.connectionId ||
    state.sessionTransition ||
    state.connectionRecovery ||
    state.restartNonce > 0
  )
    return false;
  useAcpStore.setState({
    active: true,
    agentId: pointer.agentId,
    historySessionId:pointer.historySessionId??null,
    connectionRecovery: "recovering",
    sessionTransition: { version: -1, label: "正在恢复已有 Agent 连接…" },
    sessionTransitionError: null,
    connecting: false,
  });
  return true;
}
export function requestAcpConnectionRecovery() {
  window.dispatchEvent(new Event("session-acp-recovery-retry"));
}
/** An explicit provider choice may re-observe its saved owner before any auto-connect effect. */
export function activateAcpAgent(agentId: string) {
  const pointer = readAcpConnectionPointer(),
    state = useAcpStore.getState();
  const recover =
    !!pointer && pointer.agentId === agentId && !state.connectionId;
  useAcpStore.setState({
    active: true,
    agentId,
    ...(recover
      ? {
          connectionRecovery: "recovering" as const,
          sessionTransition: { version: -1, label: "正在恢复已有 Agent 连接…" },
          sessionTransitionError: null,
        }
      : {}),
  });
  if (recover) requestAcpConnectionRecovery();
}
