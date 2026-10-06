import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
const api = vi.hoisted(() => ({ canonicalizePath: vi.fn(async (path: string) => path), readDirectory: vi.fn(async () => []), getHomeDirectory: vi.fn(async () => '/home/user') }));
vi.mock('@session/services/apiAdapt', () => api);
vi.mock('@session/browser-opener', () => ({ openUrl: vi.fn() }));
vi.mock('@session/hooks/runtime', () => ({ isTauri: () => false, isDesktopTauri: () => false }));
import { BrowserProjects } from '../features/ProjectSelector/BrowserProjects';
import { WebPreview } from '../features/web-preview/WebPreview';
import { useWebviewStore } from '../stores/useWebViewStore';
beforeEach(() => { vi.clearAllMocks(); useWebviewStore.setState({ history: [], index: -1 }); });
describe('browser workflows', () => {
  it('navigates to a typed server directory and selects only after it loads', async () => {
    const select = vi.fn(); render(<BrowserProjects cwd={null} onAddProject={select} />);
    const input = await screen.findByLabelText('服务器目录路径');
    fireEvent.change(input, { target: { value: '/tmp/my-project' } });
    fireEvent.submit(input.closest('form')!);
    await waitFor(() => expect(api.readDirectory).toHaveBeenCalledWith('/tmp/my-project'));
    fireEvent.click(screen.getByText('选择当前目录'));
    expect(select).toHaveBeenCalledWith('/tmp/my-project');
  });
  it('shows directory failures without losing the last valid directory', async () => {
    render(<BrowserProjects cwd='/project' onAddProject={vi.fn()} />);
    await screen.findByText('选择当前目录');
    api.canonicalizePath.mockRejectedValueOnce(new Error('Permission denied'));
    const input = screen.getByLabelText('服务器目录路径');
    fireEvent.change(input, { target: { value: '/restricted' } }); fireEvent.submit(input.closest('form')!);
    expect(await screen.findByRole('alert')).toBeTruthy();
  });
  it('opens the first manually entered URL without a prop URL', () => {
    render(<WebPreview />);
    const input = screen.getByPlaceholderText('输入网址…');
    fireEvent.change(input, { target: { value: 'https://example.com' } }); fireEvent.submit(input.closest('form')!);
    expect(useWebviewStore.getState().history).toEqual(['https://example.com/']);
  });
  it('rejects executable preview URLs', () => {
    render(<WebPreview />);
    const input = screen.getByPlaceholderText('输入网址…');
    fireEvent.change(input, { target: { value: 'javascript:alert(1)' } }); fireEvent.submit(input.closest('form')!);
    expect(useWebviewStore.getState().history).toEqual([]);
    expect(screen.getByRole('alert')).toBeTruthy();
  });
});
