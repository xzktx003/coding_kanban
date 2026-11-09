export type ProjectPersistenceState = 'disabled' | 'waiting' | 'active' | 'unsupported' | 'error' | 'unknown';
export type DesktopReadyStatus = { state: 'ready'; profileId: string; generation: string; projectPersistence?: { state: ProjectPersistenceState } };
export type DesktopStatus =
  | { state: 'unauthenticated' }
  | { state: 'unconfigured' }
  | { state: 'unavailable'; reasonCode?: string }
  | DesktopReadyStatus;

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const MAX_STATUS_BYTES = 8192;

function parseStatus(value: unknown): DesktopStatus {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('工作区状态无效');
  const item = value as Record<string, unknown>;
  if (Object.keys(item).some(key => !['state', 'profileId', 'generation', 'reasonCode', 'projectPersistence'].includes(key))) throw new Error('工作区状态无效');
  if (item.state === 'ready' && typeof item.profileId === 'string' && uuid.test(item.profileId) && typeof item.generation === 'string' && uuid.test(item.generation)) {
    const ready: DesktopReadyStatus = { state: 'ready', profileId: item.profileId, generation: item.generation };
    if (!Object.hasOwn(item, 'projectPersistence')) return ready;
    const value = item.projectPersistence;
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 1 || !Object.hasOwn(value, 'state')) throw new Error('工作区状态无效');
    const state = (value as Record<string, unknown>).state;
    if (state !== 'disabled' && state !== 'waiting' && state !== 'active' && state !== 'unsupported' && state !== 'error' && state !== 'unknown') throw new Error('工作区状态无效');
    return { ...ready, projectPersistence: { state } };
  }
  if (Object.hasOwn(item, 'projectPersistence')) throw new Error('工作区状态无效');
  if (item.state === 'unconfigured') return { state: 'unconfigured' };
  if (item.state === 'unavailable' && (item.reasonCode === undefined || typeof item.reasonCode === 'string' && /^[A-Za-z_]{1,80}$/.test(item.reasonCode))) return { state: 'unavailable', reasonCode: item.reasonCode as string | undefined };
  throw new Error('工作区状态无效');
}

export async function loadDesktopStatus(signal?: AbortSignal, fetcher: typeof fetch = fetch): Promise<DesktopStatus> {
  const response = await fetcher('/api/chatgpt-desktop/status', { signal, credentials: 'same-origin', cache: 'no-store' });
  if (response.status === 401) {
    void response.body?.cancel().catch(() => {});
    return { state: 'unauthenticated' };
  }
  if (![200, 404, 503].includes(response.status) || !response.body) throw new Error('暂时无法读取工作区状态');
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0, text = '';
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > MAX_STATUS_BYTES) throw new Error('工作区状态响应过大');
      text += decoder.decode(next.value, { stream: true });
    }
    text += decoder.decode();
    const status = parseStatus(JSON.parse(text));
    const expected = status.state === 'ready' ? 200 : status.state === 'unconfigured' ? 404 : 503;
    if (response.status !== expected) throw new Error('工作区状态与响应不一致');
    return status;
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export function desktopSurfaceUrl(status: DesktopStatus): string | null {
  return status.state === 'ready' ? `/chatgpt-desktop/${status.profileId}/${status.generation}/webview/index.html` : null;
}
