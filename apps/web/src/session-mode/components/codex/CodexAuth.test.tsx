import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ loginAccount: vi.fn(async () => ({ type: 'chatgptDeviceCode', verificationUrl: 'https://auth.openai.com/device', userCode: 'ABCD-EFGH' })), getAccountWithParams: vi.fn(async () => ({ account: null })), saveAccountSnapshot: vi.fn() }));
vi.mock('@session/services', () => api);
vi.mock('@session/browser-opener', () => ({ open: vi.fn() }));
vi.mock('@session/hooks/runtime', () => ({ isTauri: () => false }));
vi.mock('@session/lib/eventStream', () => ({ openEventStream: () => () => {} }));
import { CodexAuth } from './CodexAuth';
it('uses device-code login from a LAN browser and shows the code and verification link', async () => {
 render(<CodexAuth />); fireEvent.click(screen.getByRole('button', { name: '登录 ChatGPT' }));
 await waitFor(() => expect(api.loginAccount).toHaveBeenCalledWith({ type: 'chatgptDeviceCode' }));
 expect(await screen.findByText('ABCD-EFGH')).toBeTruthy();
 expect(screen.getByRole('link', { name: '打开登录页面' }).getAttribute('href')).toBe('https://auth.openai.com/device');
});
