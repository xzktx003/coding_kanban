import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ProjectPersistenceIndicator from './ProjectPersistenceIndicator';
import { loadDesktopStatus, type ProjectPersistenceState } from './desktop-status';

vi.mock('./desktop-status', async (original) => ({ ...await original<typeof import('./desktop-status')>(), loadDesktopStatus: vi.fn() }));

const profileId = '43e56e8a-de3f-40fb-8cf3-7177d17d24f1';
const generation = 'b94128f4-288c-4c97-a5cb-891555dc8199';
const nextGeneration = 'abc82834-23b6-4993-aad3-de845be2e9e4';
const ready = (state?: ProjectPersistenceState, next = generation) => ({
  state: 'ready' as const, profileId, generation: next,
  ...(state === undefined ? {} : { projectPersistence: { state } }),
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); vi.resetAllMocks(); });

it('shows precise states and treats a missing legacy field as unknown', () => {
  const labels = [
    ['active', '项目快照正常'], ['waiting', '项目保存等待中'],
    ['disabled', '项目保存未启用'], ['unsupported', '项目保存不支持'],
    ['error', '项目保存异常'], ['unknown', '项目保存状态未知'],
    [undefined, '项目保存状态未知'],
  ] as const;
  for (const [value, label] of labels) {
    const view = render(<ProjectPersistenceIndicator active status={ready(value)} />);
    expect(screen.getByRole('status').textContent).toContain(label);
    expect(screen.getByRole('status').textContent).not.toContain('/private');
    view.unmount();
  }
});

it('polls at 30 seconds only for the mounted, active matching profile', async () => {
  vi.mocked(loadDesktopStatus).mockResolvedValue(ready('active'));
  const view = render(<ProjectPersistenceIndicator active status={ready('waiting')} />);
  expect(loadDesktopStatus).not.toHaveBeenCalled();
  await act(async () => { await vi.advanceTimersByTimeAsync(29_999); });
  expect(loadDesktopStatus).not.toHaveBeenCalled();
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(loadDesktopStatus).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('status').textContent).toContain('项目快照正常');
  view.rerender(<ProjectPersistenceIndicator active={false} status={ready('waiting')} />);
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  expect(loadDesktopStatus).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('status')).toBeNull();
});

it('cancels and discards a late response after hiding; reactivation checks afresh', async () => {
  let finish!: (value: ReturnType<typeof ready>) => void;
  vi.mocked(loadDesktopStatus).mockImplementationOnce(() => new Promise(resolve => { finish = resolve as typeof finish; }))
    .mockResolvedValueOnce(ready('error'));
  const view = render(<ProjectPersistenceIndicator active status={ready('waiting')} />);
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  const signal = vi.mocked(loadDesktopStatus).mock.calls[0][0]!;
  view.rerender(<ProjectPersistenceIndicator active={false} status={ready('waiting')} />);
  expect(signal.aborted).toBe(true);
  await act(async () => { finish(ready('active')); });
  view.rerender(<ProjectPersistenceIndicator active status={ready('waiting')} />);
  await act(async () => {});
  expect(loadDesktopStatus).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('status').textContent).toContain('项目保存异常');
  expect(screen.getByRole('status').textContent).not.toContain('项目快照正常');
});

it('marks a changed profile unknown and only recovers the original identity', async () => {
  vi.mocked(loadDesktopStatus).mockResolvedValueOnce(ready('active', nextGeneration)).mockResolvedValueOnce(ready('waiting'));
  render(<ProjectPersistenceIndicator active status={ready('active')} />);
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  expect(screen.getByRole('status').textContent).toContain('项目保存状态未知');
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  expect(loadDesktopStatus).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('status').textContent).toContain('项目保存等待中');
});

it('rechecks an unavailable profile without reopening or following another host', async () => {
  vi.mocked(loadDesktopStatus).mockResolvedValueOnce({ state: 'unavailable' }).mockResolvedValueOnce(ready('error'));
  render(<ProjectPersistenceIndicator active status={ready('active')} />);
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  expect(screen.getByRole('status').textContent).toContain('项目保存状态未知');
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  expect(loadDesktopStatus).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('status').textContent).toContain('项目保存异常');
});

it('rejects a late response after profile generation changes', async () => {
  let finish!: (value: ReturnType<typeof ready>) => void;
  vi.mocked(loadDesktopStatus).mockImplementationOnce(() => new Promise(resolve => { finish = resolve as typeof finish; }));
  const view = render(<ProjectPersistenceIndicator active status={ready('waiting')} />);
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  view.rerender(<ProjectPersistenceIndicator active status={ready('error', nextGeneration)} />);
  await act(async () => { finish(ready('active')); });
  expect(screen.getByRole('status').textContent).toContain('项目保存异常');
  expect(screen.getByRole('status').textContent).not.toContain('项目快照正常');
});

it('times out without overlap and discards a response arriving after timeout', async () => {
  let finish!: (value: ReturnType<typeof ready>) => void;
  vi.mocked(loadDesktopStatus).mockImplementationOnce(() => new Promise(resolve => { finish = resolve as typeof finish; }))
    .mockResolvedValueOnce(ready('waiting'));
  render(<ProjectPersistenceIndicator active status={ready('active')} />);
  await act(async () => { await vi.advanceTimersByTimeAsync(40_000); });
  expect(vi.mocked(loadDesktopStatus).mock.calls[0][0]!.aborted).toBe(true);
  expect(screen.getByRole('status').textContent).toContain('项目保存状态未知');
  await act(async () => { finish(ready('active')); });
  expect(screen.getByRole('status').textContent).toContain('项目保存状态未知');
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  expect(loadDesktopStatus).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('status').textContent).toContain('项目保存等待中');
});

it('stops while the browser document is hidden and refreshes on return', async () => {
  let visible = true;
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visible ? 'visible' : 'hidden');
  vi.mocked(loadDesktopStatus).mockResolvedValue(ready('error'));
  render(<ProjectPersistenceIndicator active status={ready('active')} />);
  visible = false;
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  expect(loadDesktopStatus).not.toHaveBeenCalled();
  visible = true;
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
  expect(loadDesktopStatus).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('status').textContent).toContain('项目保存异常');
  visibility.mockRestore();
});
