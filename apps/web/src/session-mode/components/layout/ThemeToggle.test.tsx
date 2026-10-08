import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, expect, it } from 'vitest';
import { SessionThemeToggle as ThemeToggle } from '../common/SessionThemeToggle';
import { useThemeStore } from '@session/stores/settings/useThemeStore';
beforeEach(() => { localStorage.clear(); useThemeStore.setState({ theme: 'dark' }); });
it('switches light/dark in one click and persists the choice', () => {
  render(<ThemeToggle />);
  fireEvent.click(screen.getByRole('button', {name:'切换为浅色模式'}));
  expect(useThemeStore.getState().theme).toBe('light');
  expect(JSON.parse(localStorage.getItem('kanban.session.theme-storage')!).state.theme).toBe('light');
  fireEvent.click(screen.getByRole('button', {name:'切换为深色模式'}));
  expect(useThemeStore.getState().theme).toBe('dark');
});
