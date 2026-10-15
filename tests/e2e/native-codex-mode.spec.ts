import { expect, test } from '@playwright/test';

// Uses an explicitly selected private host. Never starts or releases an Agent.
test('native Codex single startup surface is interactive and survives workbench switches', async ({ page }) => {
  test.skip(process.env.NATIVE_CODEX_LIVE_TEST !== '1', 'Requires an explicitly configured isolated native host.');
  test.setTimeout(180_000);
  const disconnects: string[] = [], errors: string[] = [];
  let observing = false;
  page.on('pageerror', error => errors.push(error.message));
  page.on('websocket', socket => {
    if (new URL(socket.url()).pathname.startsWith('/native-codex/')) socket.on('close', () => { if (observing) disconnects.push(new URL(socket.url()).pathname); });
  });
  await page.goto('/?mode=codex');
  const status = await (await page.request.get('/api/native-codex/status')).json();
  expect(status.available).toBe(true);
  expect(status.newChatWindowIds).toHaveLength(1);
  const workbench = page.getByRole('region', { name: 'Codex 工作台' });
  await expect(workbench.getByRole('tab')).toHaveCount(1);
  await expect(workbench.locator('.codex-mode-state')).toHaveCount(0, { timeout: 60_000 });
  const frame = workbench.getByTitle('原生 Codex 会话窗口');
  const original = await frame.elementHandle();
  expect(original).not.toBeNull();
  const layout = await frame.evaluate((element: HTMLIFrameElement) => {
    const document = element.contentDocument!;
    return Array.from(document.querySelectorAll<HTMLIFrameElement>('iframe[data-kanban-native-surface]')).filter(panel => panel.dataset.kanbanNativeHidden !== 'true').map(panel => {
      const bounds = panel.getBoundingClientRect();
      return { extension: new URL(panel.src).searchParams.get('extensionId'), y: bounds.y, width: bounds.width, height: bounds.height,
        hit: document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2) === panel };
    });
  });
  expect(layout).toHaveLength(1);
  expect(layout[0].extension).toBe('openai.chatgpt');
  expect(layout[0].y).toBe(44);
  expect(layout[0].height).toBeGreaterThan(300);
  expect(layout[0].hit).toBe(true);
  observing = true;
  const initial = await page.request.get('/api/native-codex/tabs'); expect(initial.ok()).toBe(true);
  await workbench.getByRole('button', { name: '会话', exact: true }).click();
  await expect(workbench).toBeHidden();
  await page.locator('.session-mode').getByRole('button', { name: 'Codex', exact: true }).click();
  await expect(workbench).toBeVisible();
  expect(await original!.evaluate(element => element === document.querySelector('.codex-mode-frame'))).toBe(true);
  await workbench.getByRole('button', { name: '终端', exact: true }).click();
  await expect(workbench).toBeHidden();
  await page.locator('.workbench-terminal').getByRole('button', { name: 'Codex', exact: true }).click();
  await expect(workbench).toBeVisible();
  expect(await original!.evaluate(element => element === document.querySelector('.codex-mode-frame'))).toBe(true);
  for (const width of [390, 393, 430, 720, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(workbench.getByRole('tab')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    if (width < 768) await expect(workbench.locator('.codex-project-navigation')).toBeHidden();
    await expect.poll(() => frame.evaluate((element: HTMLIFrameElement) => {
      const doc = element.contentDocument!;
      const panels = [...doc.querySelectorAll<HTMLIFrameElement>('iframe[data-kanban-native-hidden="false"]')];
      return panels.length === 1 && Math.abs(panels[0].getBoundingClientRect().width - element.clientWidth) <= 1;
    })).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`native-${width}.png`) });
  }
  await page.waitForTimeout(30_000);
  expect(disconnects).toEqual([]); expect(errors).toEqual([]);
  observing = false;
  await page.reload();
  await expect(workbench.locator('.codex-mode-state')).toHaveCount(0, { timeout: 60_000 });
  await expect(workbench.getByRole('tab')).toHaveCount(1);
});
