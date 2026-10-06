import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  ccNewSession: vi.fn(async () => 'ready-before-wait'),
  ccSendMessage: vi.fn(async () => {}),
  ccResumeSession: vi.fn(),
  ccGetSessionMessages: vi.fn(),
  gitCreateWorktree: vi.fn(),
}));
vi.mock('@session/services', () => api);
vi.mock('@session/services/apiAdapt/git', () => api);
vi.mock('@session/hooks/runtime', () => ({ isDesktopTauri: () => false }));
vi.mock('@session/lib/eventStream', () => ({
  openEventStream: (options: { onOpen?: () => void }) => {
    queueMicrotask(() => options.onOpen?.());
    return () => {};
  },
}));

import { useCCSessionListener, useCCPermissionListener } from '@session/components/cc/hooks';
import { useCCStore } from '@session/stores/cc';
import { useWorkspaceStore } from '@session/stores/useWorkspaceStore';
import { useCCSessionManager } from './useCCSessionManager';
import { CC_LISTENER_READY_EVENT, CC_PERMISSION_LISTENER_READY_EVENT, isCCListenerReady } from '@session/lib/ccListenerReadiness';

it('sends the first message when an already connected stream signals before the wait starts', async () => {
  useWorkspaceStore.setState({ cwd: '/project' });
  useCCStore.setState({
    activeSessionId: null,
    isLoading: false,
    options: { ...useCCStore.getState().options, worktreeMode: 'local' },
  });
  const { result, unmount } = renderHook(() => {
    useCCSessionListener();
    useCCPermissionListener();
    return useCCSessionManager();
  });
  let sent = false;
  await act(async () => {
    const send = result.current.handleNewSession('first message');
    // Flush the store update so listeners mount before the manager's zero-delay wait.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await act(async () => {});
    sent = Boolean(await send);
  });
  expect(sent).toBe(true);
  expect(api.ccSendMessage).toHaveBeenCalledWith('ready-before-wait', 'first message', []);
  expect(isCCListenerReady(CC_LISTENER_READY_EVENT, 'ready-before-wait')).toBe(true);
  unmount();
  expect(isCCListenerReady(CC_LISTENER_READY_EVENT, 'ready-before-wait')).toBe(false);
  expect(isCCListenerReady(CC_PERMISSION_LISTENER_READY_EVENT, 'ready-before-wait')).toBe(false);
}, 12000);
