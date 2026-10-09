import { acpCancel, acpNewSession } from "@session/services/apiAdapt/acp";
import { useAcpStore } from "@session/stores/useAcpStore";
import { runAcpSessionOperation } from "./sessionOperations";

/**
 * Start another session on a live connection, reusing the running agent
 * process instead of spawning the CLI again. Returns false when the connection
 * cannot serve one. Failure never authorizes stopping or restarting the process.
 */
export async function acpFreshSession(
  connectionId: string,
  cwd: string,
  { allowInterrupt = false }: { allowInterrupt?: boolean } = {},
) {
  const original = useAcpStore.getState();
  if (
    original.connectionId !== connectionId ||
    (original.running && !allowInterrupt)
  )
    return false;
  return (
    (await runAcpSessionOperation("正在新建会话…", async (ownsSelection) => {
      const ownsIdentity = () => {
        const current = useAcpStore.getState();
        return (
          ownsSelection() &&
          current.connectionId === connectionId &&
          current.sessionId === original.sessionId &&
          current.agentId === original.agentId &&
          current.active === original.active
        );
      };
      if (!ownsIdentity()) return false;
      const store = useAcpStore.getState();
      try {
        if (store.running) {
          if (!allowInterrupt || !original.running || !original.sessionId)
            return false;
          // Keep context and never issue session/new when cancellation fails.
          await acpCancel(connectionId, original.sessionId);
          if (!ownsIdentity()) return false;
        }
        const session = await acpNewSession(connectionId, cwd);
        if (!ownsIdentity()) return false;
        store.setEntries([]);
        store.setPermission(null);
        store.setRunning(false);
        store.applySession(session);
        useAcpStore.setState({ sessionCwd: cwd });
        return true;
      } catch (error) {
        console.error("acp: failed to open a new session", error);
        return false;
      }
    })) === true
  );
}
