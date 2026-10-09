import {
  acpAuthenticate,
  acpCancel,
  acpNewSession,
} from "@session/services/apiAdapt/acp";
import { useAcpStore } from "@session/stores/useAcpStore";
import { toast } from "@session/components/ui/use-toast";
import { runAcpSessionOperation } from "./sessionOperations";

/** Authentication refreshes native session controls; it owns the whole transition. */
export async function authenticateAcpSession(
  connectionId: string,
  methodId: string,
  cwd: string,
  { allowInterrupt = false }: { allowInterrupt?: boolean } = {},
) {
  const original = useAcpStore.getState();
  if (
    original.connectionId !== connectionId ||
    original.authenticating ||
    (original.running && !allowInterrupt)
  )
    return false;
  return (
    (await runAcpSessionOperation("正在登录并刷新会话…", async (isLatest) => {
      const ownsIdentity = () => {
        const current = useAcpStore.getState();
        return (
          isLatest() &&
          current.connectionId === connectionId &&
          current.sessionId === original.sessionId &&
          current.agentId === original.agentId &&
          current.active === original.active
        );
      };
      if (!ownsIdentity()) return false;
      const store = useAcpStore.getState();
      store.setAuthenticating(methodId);
      let authenticated = false;
      try {
        if (store.running) {
          if (!allowInterrupt || !original.running || !original.sessionId)
            return false;
          await acpCancel(connectionId, original.sessionId);
          if (!ownsIdentity()) return false;
        }
        await acpAuthenticate(connectionId, methodId);
        if (!ownsIdentity()) return false;
        authenticated = true;
        store.setSelectedAuthMethod(methodId);
        const session = await acpNewSession(connectionId, cwd);
        if (!ownsIdentity()) return false;
        store.setEntries([]);
        store.setPermission(null);
        store.setRunning(false);
        store.applySession(session);
        useAcpStore.setState({ sessionCwd: cwd });
        return true;
      } catch (error) {
        if (ownsIdentity())
          toast({
            title: authenticated
              ? "登录请求已接受，会话刷新失败"
              : "登录未完成",
            description: `${String(error)}。当前会话记录和草稿已保留，Agent 服务未重启。`,
            variant: "destructive",
          });
        return false;
      } finally {
        const current = useAcpStore.getState();
        if (
          current.connectionId === connectionId &&
          current.authenticating === methodId
        )
          store.setAuthenticating(null);
      }
    })) === true
  );
}
