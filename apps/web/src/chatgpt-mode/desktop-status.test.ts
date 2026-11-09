import { describe, expect, it, vi } from 'vitest';
import { loadDesktopStatus, desktopSurfaceUrl } from './desktop-status';

const profileId = '43e56e8a-de3f-40fb-8cf3-7177d17d24f1';
const generation = 'b94128f4-288c-4c97-a5cb-891555dc8199';
describe('desktop host status', () => {
  it('reads only the fixed same-origin metadata endpoint', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ state: 'ready', profileId, generation })));
    const controller = new AbortController();
    const status = await loadDesktopStatus(controller.signal, fetcher);
    expect(fetcher).toHaveBeenCalledWith('/api/chatgpt-desktop/status', { signal: controller.signal, credentials: 'same-origin', cache: 'no-store' });
    expect(desktopSurfaceUrl(status)).toBe(`/chatgpt-desktop/${profileId}/${generation}/webview/index.html`);
  });
  it('requires both exact runtime identities and ignores no server-supplied navigation', async () => {
    for (const value of [null, {}, { state: 'ready', profileId }, { state: 'ready', profileId, generation: '../other' }, { state: 'ready', profileId, generation, url: 'https://external.invalid' }]) {
      await expect(loadDesktopStatus(undefined, vi.fn().mockResolvedValue(new Response(JSON.stringify(value))))).rejects.toThrow();
    }
    expect(desktopSurfaceUrl({ state: 'unconfigured' })).toBeNull();
    expect(desktopSurfaceUrl({ state: 'unavailable', reasonCode: 'PROCESS_CHANGED' })).toBeNull();
  });
  it('bounds the response before parsing and propagates HTTP failures', async () => {
    await expect(loadDesktopStatus(undefined, vi.fn().mockResolvedValue(new Response('x'.repeat(8193))))).rejects.toThrow(/大/);
    await expect(loadDesktopStatus(undefined, vi.fn().mockResolvedValue(new Response('{}', { status: 503 })))).rejects.toThrow();
    await expect(loadDesktopStatus(undefined, vi.fn().mockResolvedValue(new Response('{')))).rejects.toThrow();
  });
  it('reads explicit unconfigured and unavailable metadata from the matching HTTP states', async () => {
    const read = (state: string, status: number) => loadDesktopStatus(undefined, vi.fn().mockResolvedValue(new Response(JSON.stringify({ state, reasonCode: state === 'unconfigured' ? 'not_configured' : 'profile_unavailable' }), { status })));
    expect(await read('unconfigured', 404)).toEqual({ state: 'unconfigured' });
    expect(await read('unavailable', 503)).toEqual({ state: 'unavailable', reasonCode: 'profile_unavailable' });
    await expect(read('ready', 404)).rejects.toThrow();
  });
  it('accepts the exact persistence state for ready profiles and supports legacy responses', async () => {
    const read = (value: unknown) => loadDesktopStatus(undefined, vi.fn().mockResolvedValue(new Response(JSON.stringify(value))));
    const legacy = { state: 'ready', profileId, generation };
    expect(await read(legacy)).toEqual(legacy);
    for (const state of ['disabled', 'waiting', 'active', 'unsupported', 'error', 'unknown']) {
      expect(await read({ ...legacy, projectPersistence: { state } })).toEqual({ ...legacy, projectPersistence: { state } });
    }
  });
  it('rejects malformed persistence metadata and values outside a ready profile', async () => {
    const ready = { state: 'ready', profileId, generation };
    for (const projectPersistence of [null, [], {}, 'active', { state: 'ACTIVE' }, { state: 'future' }, { state: 'active', path: '/private' }, { state: 'active', extra: true }]) {
      await expect(loadDesktopStatus(undefined, vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...ready, projectPersistence }))))).rejects.toThrow();
    }
    for (const state of ['unconfigured', 'unavailable']) {
      const code = state === 'unconfigured' ? 404 : 503;
      await expect(loadDesktopStatus(undefined, vi.fn().mockResolvedValue(new Response(JSON.stringify({ state, projectPersistence: { state: 'active' } }), { status: code })))).rejects.toThrow();
    }
  });
});

it('distinguishes only an HTTP 401 from ordinary network and server failures', async () => {
  const unauthorized = vi.fn().mockResolvedValue(new Response('{"redirect":"https://evil.invalid"}', {status: 401, headers:{location:'https://evil.invalid'}}));
  expect(await loadDesktopStatus(undefined, unauthorized)).toEqual({state:'unauthenticated'});
  await expect(loadDesktopStatus(undefined, vi.fn().mockRejectedValue(new Error('offline')))).rejects.toThrow('offline');
  await expect(loadDesktopStatus(undefined, vi.fn().mockResolvedValue(new Response('{}',{status:403})))).rejects.toThrow();
});
