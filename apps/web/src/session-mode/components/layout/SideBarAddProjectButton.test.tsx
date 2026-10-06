import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const openDialog = vi.fn();
const isDesktopTauri = vi.fn();

vi.mock('@session/services/codexService', () => ({ codexService: { setCurrentThread: vi.fn(async () => {}) } }));
vi.mock('@session/browser-dialog', () => ({ open: (...args: unknown[]) => openDialog(...args) }));
vi.mock('@session/hooks/runtime', () => ({ isDesktopTauri: () => isDesktopTauri() }));
vi.mock('@session/features/ProjectSelector', () => ({
  BrowserProjects: ({ onAddProject }: { onAddProject: (path: string) => void }) => (
    <button type="button" onClick={() => onAddProject('/projects/browser-picked')}>
      Choose browser project
    </button>
  ),
}));

import { useWorkspaceStore } from '@session/stores/useWorkspaceStore';
import { SideBarAddProjectButton } from './SideBarAddProjectButton';

beforeEach(() => {
  vi.clearAllMocks();
  useWorkspaceStore.setState({ projects: [], historyProjects: [], cwd: '/projects/current' });
});

describe('SideBarAddProjectButton', () => {
  it('opens the browser picker and selects its project outside desktop Tauri', async () => {
    isDesktopTauri.mockReturnValue(false);

    render(<SideBarAddProjectButton />);
    fireEvent.click(screen.getByTitle('添加项目'));

    expect(screen.getByText('浏览服务器目录并选择要添加的项目。')).toBeTruthy();
    expect(openDialog).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Choose browser project'));
    await waitFor(() => expect(useWorkspaceStore.getState().projects).toEqual(['/projects/browser-picked']));
    expect(useWorkspaceStore.getState().cwd).toBe('/projects/browser-picked');
  });

  it('keeps the native folder dialog for desktop Tauri', async () => {
    isDesktopTauri.mockReturnValue(true);
    openDialog.mockResolvedValue('/projects/desktop-picked');

    render(<SideBarAddProjectButton />);
    fireEvent.click(screen.getByTitle('添加项目'));

    await waitFor(() => expect(openDialog).toHaveBeenCalledWith({ directory: true, multiple: false }));
    expect(useWorkspaceStore.getState().projects).toEqual(['/projects/desktop-picked']);
    expect(useWorkspaceStore.getState().cwd).toBe('/projects/desktop-picked');
  });
});