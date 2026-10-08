import { create } from 'zustand';
import { SessionApiError } from '@session/services/apiAdapt/shared';

export type RpcIdentity = { threadId: string; requestId: string | number; turnId?: string | null; itemId?: string | null; requestToken?: string };
let generation = 0;
export const rpcKey = (r: RpcIdentity) => JSON.stringify([generation, r.threadId, r.requestId, r.turnId, r.itemId, r.requestToken]);
export const rpcRequestContext = (r: RpcIdentity) => ({ threadId: r.threadId, requestId: r.requestId, turnId: r.turnId ?? null, itemId: r.itemId ?? null, ...(r.requestToken ? { requestToken: r.requestToken } : {}) });
export const sameRpc = (a: RpcIdentity, b: RpcIdentity) => rpcKey(a) === rpcKey(b);
export const useRpcDeliveryStore = create<{ states: Record<string, { phase: 'submitting' | 'uncertain' | 'failed'; message: string }> }>(() => ({ states: {} }));
export function resetRpcLifecycle() { generation++; useRpcDeliveryStore.setState({ states: {} }); }
export function reconcileRpcDeliveries(requests: RpcIdentity[]) {
  const keys = new Set(requests.map(rpcKey));
  useRpcDeliveryStore.setState(s => ({ states: Object.fromEntries(Object.entries(s.states).filter(([key]) => keys.has(key))) }));
}
function rejected(error: unknown) {
  if (error instanceof SessionApiError) return error.status >= 400 && error.status < 500 && error.status !== 408;
  if (error instanceof Error && error.message.startsWith('Request failed: {')) {
    try { return [-32600,-32601,-32602].includes(JSON.parse(error.message.slice(16)).code); } catch { return false; }
  }
  return false;
}
/** Only a confirmed reply removes a card. A lost response cannot authorize another send. */
export async function deliverRpc(request: RpcIdentity, send: () => Promise<unknown>, confirm: () => void) {
  const key = rpcKey(request), epoch = generation;
  const previous = useRpcDeliveryStore.getState().states[key];
  if (previous?.phase === 'submitting') return;
  if (previous?.phase === 'uncertain') throw new Error('回答送达尚未确认，请先核对状态，避免重复提交');
  const record = (phase: 'submitting' | 'uncertain' | 'failed', message: string) => {
    if (epoch === generation) useRpcDeliveryStore.setState(s => ({ states: { ...s.states, [key]: { phase, message } } }));
  };
  record('submitting', '正在提交回答');
  try {
    await send();
    if (epoch !== generation) return;
    confirm();
    useRpcDeliveryStore.setState(s => { const states = { ...s.states }; delete states[key]; return { states }; });
  } catch (error) {
    record(rejected(error) ? 'failed' : 'uncertain', rejected(error) ? '回答发送失败，内容已保留，可以重试。' : '回答送达尚未确认，内容已保留。请核对状态，避免重复提交。');
    throw error;
  }
}
