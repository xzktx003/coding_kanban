import { afterEach, expect, it, vi } from 'vitest';
vi.mock('@session/hooks/runtime', () => ({ isDesktopTauri: () => false }));
import { notifyDesktop } from './notify';
afterEach(() => vi.unstubAllGlobals());
it('uses granted browser notifications', async () => {
 const Notification = Object.assign(vi.fn(), { permission: 'granted', requestPermission: vi.fn() }); vi.stubGlobal('Notification', Notification);
 const fallback = vi.fn(); await notifyDesktop('Completed', 'task', fallback);
 expect(Notification).toHaveBeenCalledWith('Completed', expect.objectContaining({ body: 'task' })); expect(fallback).not.toHaveBeenCalled();
});
it('does not request notification permission from a background event', async () => {
 const Notification = Object.assign(vi.fn(), { permission: 'default', requestPermission: vi.fn() }); vi.stubGlobal('Notification', Notification);
 const fallback = vi.fn(); await notifyDesktop('Completed', 'task', fallback);
 expect(Notification.requestPermission).not.toHaveBeenCalled(); expect(fallback).toHaveBeenCalledOnce();
});
