import { renderHook, act } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ watchDirectory: vi.fn(), unwatchDirectory: vi.fn(async () => {}) }));
vi.mock('@session/services/apiAdapt/filesystem', () => api);
import { useDirWatch } from './useDirWatch';
it('releases a watch that starts after its component unmounts', async () => {
 let complete!: () => void; api.watchDirectory.mockImplementation(() => new Promise<void>(resolve => { complete = resolve; }));
 const { unmount } = renderHook(() => useDirWatch('/project', vi.fn()));
 unmount(); expect(api.unwatchDirectory).not.toHaveBeenCalled();
 await act(async () => complete());
 expect(api.unwatchDirectory).toHaveBeenCalledExactlyOnceWith('/project');
});
