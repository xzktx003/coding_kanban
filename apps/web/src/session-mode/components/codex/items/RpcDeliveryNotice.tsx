import { useRpcDeliveryStore, rpcKey, type RpcIdentity } from '../stores/rpcLifecycle';
import { reconcileEventStream } from '@session/lib/eventStream';
export function RpcDeliveryNotice({ request }: { request: RpcIdentity }) {
  const state = useRpcDeliveryStore(s => s.states[rpcKey(request)]);
  if (!state) return null;
  return <div role={state.phase === "submitting" ? "status" : "alert"} className="text-sm text-muted-foreground">
    {state.message}
    {state.phase === 'uncertain' && <button type="button" className="underline ml-2" onClick={reconcileEventStream}>核对状态</button>}
  </div>;
}
