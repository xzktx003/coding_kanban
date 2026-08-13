import { expect, test } from '@playwright/test';

test.use({ ignoreHTTPSErrors: true });

test('terminal session keeps running state and never shows awaiting-input UI', async ({
  page,
}) => {
  const displayName = `E2E Awaiting ${Date.now()}`;

  try {
    await page.setViewportSize({ width: 1600, height: 5000 });
    await page.goto('/');
    await expect(
      page
        .getByTestId('session-restore-banner')
        .filter({ hasText: '正在恢复历史会话' }),
    ).toBeHidden({ timeout: 30_000 });

    for (const testId of [
      'dismiss-app-update',
      'dismiss-remote-update',
      'dismiss-app-update-conflict',
      'dismiss-session-restore',
    ]) {
      const dismissButton = page.getByTestId(testId);
      if (await dismissButton.isVisible().catch(() => false)) {
        await dismissButton.click();
      }
    }

    await page.getByRole('combobox', { name: '服务器' }).selectOption({
      label: '全部',
    });
    await page.getByRole('combobox', { name: '类型' }).selectOption({
      label: '全部',
    });
    await page.getByRole('combobox', { name: '类别' }).selectOption({
      label: '全部',
    });
    await page.getByRole('textbox', { name: '目录' }).fill('');

    await page.getByTestId('new-session-toggle').click();
    await expect(page.getByTestId('new-session-dialog')).toHaveCount(0);
    await expect(page.getByTestId('host-dropdown-menu')).toBeVisible();
    await page.locator('.host-dropdown-item', { hasText: '本机' }).click();
    await expect(page.getByTestId('new-session-dialog')).toBeVisible();
    await page.getByTestId('new-session-name').fill(displayName);
    await page.getByTestId('new-session-kind-shell').click();
    await page.getByTestId('new-session-mode-direct').click();
    await page.getByTestId('new-session-dir').fill(process.cwd());
    await page.getByTestId('create-session').click();
    await expect(page.getByTestId('new-session-dialog')).toHaveCount(0);

    await expect
      .poll(
        () =>
          page.evaluate(async (nextDisplayName) => {
            const response = await fetch('/api/agent-sessions');
            const payload = await response.json();
            return payload.items.find(
              (item: { displayName: string }) =>
                item.displayName === nextDisplayName,
            )?.interactionState;
          }, displayName),
        { timeout: 15_000 },
      )
      .toBe('running');

    const card = page.locator('.grid-card', {
      has: page.locator('.grid-card-name', { hasText: displayName }),
    });

    await expect(card).toBeVisible({ timeout: 15000 });
    await expect(card.locator('.grid-card-badge')).toHaveText('执行中');

    await page.waitForTimeout(11_000);

    await expect(card.locator('.grid-card-badge')).toHaveText('执行中');
    await expect(card).not.toHaveClass(/card-awaiting/);
    await expect(page.locator('.stat-awaiting')).toHaveCount(0);
  } finally {
    await page
      .evaluate(async (nextDisplayName) => {
        const listResponse = await fetch('/api/agent-sessions');
        const list = await listResponse.json();
        const session = list.items.find(
          (item: { id: string; displayName: string }) =>
            item.displayName === nextDisplayName,
        );

        if (!session) {
          return;
        }

        await fetch(`/api/agent-sessions/${session.id}`, {
          method: 'DELETE',
        });
      }, displayName)
      .catch(() => {});
  }
});
