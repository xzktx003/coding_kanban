import { expect, test } from '@playwright/test';

test('long Codex, Claude and ACP chats keep navigation, latest message and composer inside the workspace', async ({ page }) => {
  test.setTimeout(60000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  // Keep synthetic conversations and draft changes confined to this browser.
  await page.route('**/api/session/api/settings', route => route.request().method() === 'POST'
    ? route.fulfill({ status: 200, body: '' }) : route.continue());
  await page.route('**/api/session/api/acp/**', route => route.request().method() === 'POST'
    ? route.fulfill({ json: route.request().url().endsWith('/sessions') ? [] : {} }) : route.continue());
  await page.goto('/?mode=session', { waitUntil: 'domcontentloaded' });
  await page.locator('.session-mode [contenteditable=true]').first().waitFor({ timeout: 30000 });
  for (const kind of ['codex', 'cc', 'acp']) {
    await page.evaluate(async kind => {
      const { useAgentSettingsStore } = await import('/src/session-mode/stores/useAgentSettingsStore.ts');
      const { useAgentCenterStore } = await import('/src/session-mode/stores/useAgentCenterStore.ts');
      const { useCodexStore } = await import('/src/session-mode/components/codex/stores/index.ts');
      const { useCCStore } = await import('/src/session-mode/stores/cc/index.ts');
      const { useAcpStore } = await import('/src/session-mode/stores/useAcpStore.ts');
      const lines = Array.from({ length: 40 }, (_, i) => `布局回归消息 ${i}`);
      useAgentCenterStore.setState({ cards: [], currentAgentCardId: null, cardsViewMode: 'solo' });
      useAgentSettingsStore.setState({ selectedAgent: kind === 'cc' ? 'cc' : 'codex' });
      useCodexStore.setState({ currentThreadId: 'layout-codex', events: { 'layout-codex': lines.map((text, i) => ({ method: 'item/completed', params: { threadId: 'layout-codex', turnId: 'layout-turn', item: { id: `layout-${i}`, type: 'agentMessage', text } } })) } });
      const messages = lines.map((text, i) => ({ type: 'assistant', message: { id: `layout-${i}`, role: 'assistant', content: [{ type: 'text', text }] } }));
      useCCStore.setState({ activeSessionId: 'layout-cc', messages, sessionMessagesMap: { 'layout-cc': messages }, isLoading: false });
      useAcpStore.setState({ active: kind === 'acp', connectionId: 'layout-acp', sessionId: 'layout-acp-session', entries: lines.map((text, i) => ({ id: `layout-${i}`, role: 'agent', text })), running: false, connecting: false });
    }, kind);
    for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }, { width: 375, height: 667 }, { width: 812, height: 375 }]) {
      await page.setViewportSize(viewport);
      const editor = page.locator(kind === 'codex' ? '.session-mode [contenteditable=true]' : '.session-mode textarea').first();
      await expect(editor).toBeVisible();
      expect(errors).toEqual([]);
      await editor.fill('保留草稿，不发送');
      await page.waitForTimeout(200);
      const bounds = await page.evaluate(() => {
        const root = document.querySelector('.session-content')!.getBoundingClientRect();
        const nav = document.querySelector('.session-section-nav')!.getBoundingClientRect();
        const editor = document.querySelector('.session-mode [contenteditable=true], .session-mode textarea')!.getBoundingClientRect();
        return { root: root.toJSON(), nav: nav.toJSON(), editor: editor.toJSON() };
      });
      await page.screenshot({ path: `.dev-runtime/dialog-fix/${kind}-${viewport.width}x${viewport.height}.png` });
      expect(bounds.nav.top, `${kind}: navigation is clipped after focusing the composer`).toBeGreaterThanOrEqual(48);
      expect(bounds.editor.bottom, `${kind}: composer bottom must fit the session workspace`).toBeLessThanOrEqual(bounds.root.bottom + 1);
      expect(bounds.editor.bottom).toBeLessThanOrEqual(viewport.height);
      const latest = page.getByText('布局回归消息 39', { exact: true });
      await latest.scrollIntoViewIfNeeded();
      const messageBounds = await latest.boundingBox();
      expect(messageBounds).not.toBeNull();
      expect(messageBounds!.y).toBeGreaterThanOrEqual(bounds.root.top);
      expect(messageBounds!.y + messageBounds!.height).toBeLessThanOrEqual(bounds.editor.top);
    }
  }
  expect(errors).toEqual([]);
});
