import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ChatgptModeApp from './ChatgptModeApp';
import { loadDesktopStatus } from './desktop-status';

const recovery = vi.hoisted(() => ({ current: true, reload: vi.fn() }));
vi.mock('./desktop-status', async (original) => ({ ...await original<typeof import('./desktop-status')>(), loadDesktopStatus: vi.fn() }));
vi.mock('./DesktopSurface', () => ({
  default: (props: { profileId: string; generation: string; reconnectError?: boolean; onReconnect?: (request: { isCurrent: () => boolean; reload: () => void }) => void }) => (<>
    {props.reconnectError && <span>连接状态暂时无法读取，原界面仍保留</span>}
    <button data-testid="surface-retry" onClick={() => props.onReconnect?.({ isCurrent: () => recovery.current, reload: recovery.reload })}>
      {props.profileId}/{props.generation}
    </button>
  </>),
}));

const profileId = '43e56e8a-de3f-40fb-8cf3-7177d17d24f1';
const generation = 'b94128f4-288c-4c97-a5cb-891555dc8199';
const nextGeneration = 'abc82834-23b6-4993-aad3-de845be2e9e4';
beforeEach(() => { vi.stubGlobal('isSecureContext', true); recovery.current = true; recovery.reload.mockReset(); });
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

it('checks the profile only after an explicit surface reconnect and switches to the new generation', async () => {
  vi.mocked(loadDesktopStatus).mockResolvedValueOnce({ state: 'ready', profileId, generation })
    .mockResolvedValueOnce({ state: 'ready', profileId, generation: nextGeneration });
  render(<ChatgptModeApp active onModeChange={vi.fn()} />);
  const retry = await screen.findByTestId('surface-retry');
  expect(retry.textContent).toContain(generation);
  expect(loadDesktopStatus).toHaveBeenCalledTimes(1);
  fireEvent.click(retry);
  await waitFor(() => expect(screen.getByTestId('surface-retry').textContent).toContain(nextGeneration));
  expect(loadDesktopStatus).toHaveBeenCalledTimes(2);
  expect(recovery.reload).not.toHaveBeenCalled();
});

it('reloads the current surface once when its profile has not changed', async () => {
  vi.mocked(loadDesktopStatus).mockResolvedValue({ state: 'ready', profileId, generation });
  render(<ChatgptModeApp active onModeChange={vi.fn()} />);
  fireEvent.click(await screen.findByTestId('surface-retry'));
  await waitFor(() => expect(recovery.reload).toHaveBeenCalledTimes(1));
});

it('ignores an old reconnect result after the originating surface is no longer current', async () => {
  let finish!: (value: { state: 'ready'; profileId: string; generation: string }) => void;
  vi.mocked(loadDesktopStatus).mockResolvedValueOnce({ state: 'ready', profileId, generation })
    .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  render(<ChatgptModeApp active onModeChange={vi.fn()} />);
  fireEvent.click(await screen.findByTestId('surface-retry'));
  recovery.current = false;
  finish({ state: 'ready', profileId, generation: nextGeneration });
  await waitFor(() => expect(loadDesktopStatus).toHaveBeenCalledTimes(2));
  expect(screen.getByTestId('surface-retry').textContent).toContain(generation);
  expect(recovery.reload).not.toHaveBeenCalled();
});

it('retains the original surface if a user-requested reconnect cannot read the profile', async () => {
  vi.mocked(loadDesktopStatus).mockResolvedValueOnce({ state: 'ready', profileId, generation })
    .mockRejectedValueOnce(new Error('offline'));
  render(<ChatgptModeApp active onModeChange={vi.fn()} />);
  fireEvent.click(await screen.findByTestId('surface-retry'));
  expect(await screen.findByText('连接状态暂时无法读取，原界面仍保留')).toBeTruthy();
  expect(screen.getByTestId('surface-retry').textContent).toContain(generation);
  expect(recovery.reload).not.toHaveBeenCalled();
});

it('keeps the already mounted surface and never reloads on an unauthenticated reconnect result', async () => {
  vi.mocked(loadDesktopStatus).mockResolvedValueOnce({state:'ready',profileId,generation})
    .mockResolvedValueOnce({state:'unauthenticated'});
  render(<ChatgptModeApp active onModeChange={vi.fn()} />);
  const surface=await screen.findByTestId('surface-retry');
  fireEvent.click(surface);
  expect(await screen.findByText('连接状态暂时无法读取，原界面仍保留')).toBeTruthy();
  expect(screen.getByTestId('surface-retry')).toBe(surface);
  expect(screen.queryByRole('link',{name:'登录工作台'})).toBeNull();
  expect(recovery.reload).not.toHaveBeenCalled();
});
