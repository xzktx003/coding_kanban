import { useAcpStore } from "@session/stores/useAcpStore";
import { toast } from "@session/components/ui/use-toast";

let revision = 0;
const pending = new Map<string, number>();
const requests = new Map<string, Promise<boolean>>();
const confirmedSettings = new Map<string, () => void>();

export function hasPendingAcpSettings(state = useAcpStore.getState()) {
  const prefix =
    JSON.stringify([state.connectionId, state.sessionId]).slice(0, -1) + ",";
  return Object.keys(state.pendingSettingChanges).some((key) =>
    key.startsWith(prefix),
  );
}

/** A rejection belongs to the captured session and latest choice of this field. */
export async function applyAcpSessionSetting(
  field: string,
  update: () => void,
  revert: () => void,
  request: (connectionId: string, sessionId: string) => Promise<unknown>,
) {
  const original = useAcpStore.getState();
  if (
    !original.connectionId ||
    !original.sessionId ||
    original.sessionTransition ||
    original.sessionTransitionError
  )
    return false;
  const connectionId = original.connectionId;
  const sessionId = original.sessionId;
  const key = JSON.stringify([
    original.connectionId,
    original.sessionId,
    field,
  ]);
  const version = ++revision;
  pending.set(key, version);
  if (!confirmedSettings.has(key)) confirmedSettings.set(key, revert);
  useAcpStore.setState((state) => ({
    pendingSettingChanges: { ...state.pendingSettingChanges, [key]: version },
  }));
  const ownsChoice = () => {
    const current = useAcpStore.getState();
    return (
      pending.get(key) === version &&
      current.connectionId === original.connectionId &&
      current.sessionId === original.sessionId &&
      current.agentId === original.agentId &&
      !current.sessionTransition &&
      !current.sessionTransitionError
    );
  };
  update();
  const perform = async () => {
    if (!ownsChoice()) return false;
    try {
      await request(connectionId, sessionId);
      confirmedSettings.set(key, update);
      return ownsChoice();
    } catch (error) {
      if (ownsChoice()) {
        (confirmedSettings.get(key) ?? revert)();
        toast({
          title: "Agent 未接受此设置",
          description: String(error),
          variant: "destructive",
        });
      }
      return false;
    }
  };
  const before = requests.get(key);
  const result = before ? before.catch(() => false).then(perform) : perform();
  requests.set(key, result);
  try {
    return await result;
  } finally {
    if (pending.get(key) === version) pending.delete(key);
    if (requests.get(key) === result) {
      requests.delete(key);
      confirmedSettings.delete(key);
    }
    useAcpStore.setState((state) => {
      if (state.pendingSettingChanges[key] !== version) return state;
      const { [key]: _finished, ...pendingSettingChanges } =
        state.pendingSettingChanges;
      return { pendingSettingChanges };
    });
  }
}
