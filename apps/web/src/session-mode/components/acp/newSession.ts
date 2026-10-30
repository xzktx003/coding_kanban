import {
  acpNewSession,
  acpStart,
  acpStop,
  type AcpSessionResult,
  type AcpStartResult,
} from "@session/services/apiAdapt/acp";
import { useAcpStore } from "@session/stores/useAcpStore";
import { useWorkspaceStore } from "@session/stores/useWorkspaceStore";
import { buildUrl } from "@session/hooks/runtime";
import {
  captureHistorySourceScope,
  isHistorySourceScopeCurrent,
} from "../history/historySourceScope";
import {
  assertAcpRuntimeOwnerCapacity,
  rememberCurrentAcpOwner,
  useAcpRuntimeOwnersStore,
} from "@session/services/acpRuntimeOwners";
import { runAcpSessionOperation } from "./sessionOperations";

function hasScopedSession(
  session: AcpSessionResult | null,
): session is AcpSessionResult & { historySessionId: string } {
  return (
    !!session &&
    typeof session.sessionId === "string" &&
    !!session.sessionId &&
    typeof session.historySessionId === "string" &&
    !!session.historySessionId &&
    session.historySessionId !== session.sessionId
  );
}
/** New chat never stops the previous task. Idle connections can host another
 * session; busy, pending or uncertain owners remain on their original connection. */
export async function acpFreshSession(connectionId: string, cwd: string) {
  const original = useAcpStore.getState();
  if (
    original.connectionId !== connectionId ||
    original.sessionTransition ||
    !original.sessionId
  )
    return false;
  const endpoint = buildUrl("/api/acp/connection-snapshot"),
    scope = captureHistorySourceScope("/api/acp/connection-snapshot"),
    workspace = useWorkspaceStore.getState().cwd,
    permissionKey = JSON.stringify([connectionId, original.sessionId]),
    independent =
      original.running ||
      !!original.permission ||
      !!original.pendingPermissions[permissionKey]?.length ||
      !!original.sessionTransitionError ||
      !!original.connectionRecovery;
  try {
    rememberCurrentAcpOwner(original);
    assertAcpRuntimeOwnerCapacity();
  } catch {
    return false;
  }
  return (
    (await runAcpSessionOperation(
      "正在新建会话，原任务继续运行…",
      async (isLatest) => {
        const owns = () => {
          const current = useAcpStore.getState();
          return (
            isLatest() &&
            isHistorySourceScopeCurrent(scope) &&
            current.active === original.active &&
            current.agentId === original.agentId &&
            current.connectionId === connectionId &&
            current.runtimeInstance === original.runtimeInstance &&
            current.sessionId === original.sessionId &&
            current.historySessionId === original.historySessionId &&
            endpoint === buildUrl("/api/acp/connection-snapshot") &&
            useWorkspaceStore.getState().cwd === workspace
          );
        };
        let created: AcpStartResult | undefined;
        const closeUnadopted = async () => {
          if (
            !created ||
            !isHistorySourceScopeCurrent(scope) ||
            endpoint !== buildUrl("/api/acp/connection-snapshot")
          )
            return;
          if (
            useAcpStore.getState().connectionId === created.connectionId ||
            Object.values(useAcpRuntimeOwnersStore.getState().owners).some(
              (owner) => owner.connectionId === created!.connectionId,
            )
          )
            return;
          await acpStop(created.connectionId).catch(() => {});
        };
        try {
          if (!owns()) return false;
          let session: AcpSessionResult;
          if (independent) {
            created = await acpStart(original.agentId, cwd);
            if (!owns()) {
              await closeUnadopted();
              return false;
            }
            const scoped = created.session && {
              ...created.session,
              historySessionId:
                created.historySessionId ?? created.session.historySessionId,
            };
            if (
              !created.connectionId ||
              created.connectionId === connectionId ||
              created.runtimeInstance !== original.runtimeInstance ||
              created.sessionError ||
              !hasScopedSession(scoped) ||
              created.sessionId !== scoped.sessionId
            ) {
              await closeUnadopted();
              return false;
            }
            session = scoped;
            const initialize = created.initialize;
            useAcpStore.getState().setConnection({
              connectionId: created.connectionId,
              runtimeInstance: created.runtimeInstance,
              connectionEndpoint: endpoint,
              sessionId: session.sessionId,
              historySessionId: session.historySessionId,
              cwd,
              agentTitle:
                initialize.agentInfo?.title ??
                initialize.agentInfo?.name ??
                original.agentId,
              authMethods: initialize.authMethods ?? [],
              canLoadSession:
                initialize.agentCapabilities?.loadSession === true,
              canInputImages:
                (
                  initialize.agentCapabilities?.promptCapabilities as
                    | { image?: boolean }
                    | undefined
                )?.image === true,
            });
          } else {
            session = await acpNewSession(connectionId, cwd);
            if (!owns()) return false;
            if (!hasScopedSession(session))
              throw new Error("新会话缺少可核验的历史来源身份");
          }
          const store = useAcpStore.getState();
          store.setEntries([]);
          store.setPermission(null);
          store.setRunning(false);
          store.applySession(session);
          useAcpStore.setState({
            sessionCwd: cwd,
            inheritedHistory: null,
            sessionTransitionError: null,
          });
          rememberCurrentAcpOwner();
          return true;
        } catch (error) {
          if (owns() && !independent)
            useAcpStore.setState({
              sessionTransitionError: `新会话尚未确认：${String(error)}。原记录已保留，请先只读核对连接，未自动重发。`,
            });
          await closeUnadopted();
          return false;
        }
      },
    )) === true
  );
}
