import {
  codexSendBlockReason,
  useCodexAccessStore,
} from "@session/stores/useCodexAccessStore";
import {
  useCodexDeliveryStore,
  uncertainDeliveryReason,
} from "@session/stores/useCodexDeliveryStore";
export function useCodexSendBlockReason(
  id?: string | null,
  queueUncertain = false,
) {
  const entry = useCodexAccessStore((s) => (id ? s.entries[id] : undefined));
  const echoUncertain = useCodexDeliveryStore((s) =>
    Boolean(
      id &&
      Object.values(s.entries).some(
        (e) => e.threadId === id && e.status === "uncertain",
      ),
    ),
  );
  return echoUncertain || queueUncertain
    ? uncertainDeliveryReason
    : codexSendBlockReason(entry);
}
