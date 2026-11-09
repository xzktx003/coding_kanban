import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ChatgptModeApp from './ChatgptModeApp';
import { loadDesktopStatus } from './desktop-status';

vi.mock('./desktop-status', async (original) => ({ ...await original<typeof import('./desktop-status')>(), loadDesktopStatus: vi.fn() }));
beforeEach(() => vi.stubGlobal('isSecureContext', true));
afterEach(() => { cleanup(); vi.resetAllMocks(); vi.unstubAllGlobals(); });
const profileId = '43e56e8a-de3f-40fb-8cf3-7177d17d24f1', generation = 'b94128f4-288c-4c97-a5cb-891555dc8199';
it('explains HTTPS before querying or mounting the desktop in an insecure context', () => {
  vi.stubGlobal('isSecureContext', false);
  const change = vi.fn();
  render(<ChatgptModeApp active onModeChange={change} />);
  expect(screen.getByText('请使用 HTTPS 打开桌面工作区')).toBeTruthy();
  expect(loadDesktopStatus).not.toHaveBeenCalled();
  expect(screen.queryByTitle('ChatGPT Codex 工作区')).toBeNull();
  expect(screen.queryByRole('button', { name: '重新连接' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '会话' }));
  expect(change).toHaveBeenCalledWith('session');
});
it('performs no background connection when first mounted inactive', () => {
  render(<ChatgptModeApp active={false} onModeChange={vi.fn()} />);
  expect(loadDesktopStatus).not.toHaveBeenCalled();
  expect(screen.queryByTitle('ChatGPT Codex 工作区')).toBeNull();
});
it('keeps an opened original surface mounted while another mode is active', async () => {
  vi.mocked(loadDesktopStatus).mockResolvedValue({ state: 'ready', profileId, generation });
  const view = render(<ChatgptModeApp active onModeChange={vi.fn()} />);
  const frame = await screen.findByTitle('ChatGPT Codex 工作区');
  expect(frame.getAttribute('src')).toContain(`/${profileId}/${generation}/`);
  view.rerender(<ChatgptModeApp active={false} onModeChange={vi.fn()} />);
  expect(screen.getByTitle('ChatGPT Codex 工作区')).toBe(frame);
  vi.mocked(loadDesktopStatus).mockRejectedValue(new Error('temporary network error'));
  view.rerender(<ChatgptModeApp active onModeChange={vi.fn()} />);
  await waitFor(() => expect(screen.getByTitle('ChatGPT Codex 工作区')).toBe(frame));
  expect(loadDesktopStatus).toHaveBeenCalledTimes(2);
});
it('updates project persistence without replacing the iframe or its draft', async () => {
  vi.useFakeTimers();
  try {
    vi.mocked(loadDesktopStatus)
      .mockResolvedValueOnce({ state: 'ready', profileId, generation, projectPersistence: { state: 'waiting' } })
      .mockResolvedValueOnce({ state: 'ready', profileId, generation, projectPersistence: { state: 'active' } });
    render(<ChatgptModeApp active onModeChange={vi.fn()} />);
    await act(async () => {});
    const frame = screen.getByTitle('ChatGPT Codex 工作区') as HTMLIFrameElement;
    const doc = frame.contentDocument!;
    doc.open(); doc.write('<!doctype html><html><body></body></html>'); doc.close();
    const input = doc.createElement('textarea');
    input.value = '未提交的本地草稿';
    doc.body.append(input);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(screen.getByTitle('ChatGPT Codex 工作区')).toBe(frame);
    expect(frame.contentDocument!.querySelector('textarea')).toBe(input);
    expect(input.value).toBe('未提交的本地草稿');
    expect(screen.getByText('项目快照正常')).toBeTruthy();
  } finally { vi.useRealTimers(); }
});
it('discards late metadata when hidden and retries only on an explicit action', async () => {
  let finish: ((status: { state: 'ready'; profileId: string; generation: string }) => void) | undefined;
  vi.mocked(loadDesktopStatus).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const view = render(<ChatgptModeApp active onModeChange={vi.fn()} />);
  view.rerender(<ChatgptModeApp active={false} onModeChange={vi.fn()} />);
  finish!({ state: 'ready', profileId, generation });
  await waitFor(() => expect(screen.queryByTitle('ChatGPT Codex 工作区')).toBeNull());
  vi.mocked(loadDesktopStatus).mockResolvedValue({ state: 'unconfigured' });
  view.rerender(<ChatgptModeApp active onModeChange={vi.fn()} />);
  expect(await screen.findByText('桌面工作区尚未连接')).toBeTruthy();
  const calls = vi.mocked(loadDesktopStatus).mock.calls.length;
  fireEvent.click(screen.getByRole('button', { name: '重新连接' }));
  await waitFor(() => expect(loadDesktopStatus).toHaveBeenCalledTimes(calls + 1));
});
it('retains mode switching when the host is unavailable', async () => {
  vi.mocked(loadDesktopStatus).mockRejectedValue(new Error('offline'));
  const change = vi.fn(); render(<ChatgptModeApp active onModeChange={change} />);
  expect(await screen.findByText('暂时无法连接桌面工作区')).toBeTruthy();
  expect(screen.queryByRole('link', { name: '登录工作台' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '终端' }));
  expect(change).toHaveBeenCalledWith('terminal');
});

it('shows only a fixed same-origin login link on an unauthenticated status', async () => {
  vi.mocked(loadDesktopStatus).mockResolvedValue({state:'unauthenticated'});
  render(<ChatgptModeApp active onModeChange={vi.fn()} />);
  const link=await screen.findByRole('link',{name:'登录工作台'});
  expect(link.getAttribute('href')).toBe('/__chatgpt-candidate-login');
  expect(screen.getByText('请输入工作台访问口令后继续。')).toBeTruthy();
  expect(screen.queryByTitle('ChatGPT Codex 工作区')).toBeNull();
  expect(screen.queryByRole('button',{name:'重新连接'})).toBeNull();
  expect(loadDesktopStatus).toHaveBeenCalledTimes(1);
});
