import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { SessionAgentBadge } from './SessionAgentBadge';

it.each([['codex', 'Codex'], ['cc', 'Claude Code'], ['acp', 'ACP · 测试 Agent']] as const)('keeps %s identity accessible with a quiet icon', (kind, name) => {
  const { container } = render(<SessionAgentBadge kind={kind} agentName="测试 Agent" />);
  const badge = screen.getByLabelText(`Agent: ${name}`);
  expect(badge.getAttribute('data-session-agent')).toBe(kind);
  expect(badge.querySelector('svg, img')).not.toBeNull();
  expect(container.textContent).toBe('');
  expect(badge.getAttribute('title')).toContain(name);
});
