import { expect, test } from '@playwright/test';

test('native Codex has two original panels and survives workbench switches', async ({ page }) => {
  test.skip(process.env.NATIVE_CODEX_LIVE_TEST !== '1', 'Requires an explicitly configured isolated native fixture host.');
  test.setTimeout(180_000);
  let observeStability = false;
  const nativeDisconnects: string[] = [];
  page.on('websocket', socket => {
    if (!new URL(socket.url()).pathname.startsWith('/native-codex/')) return;
    socket.on('close', () => {
      if (observeStability) nativeDisconnects.push(new URL(socket.url()).pathname);
    });
  });
  await page.goto('/?mode=codex');
  const workbench = page.getByRole('region', { name: 'Codex 工作台' });
  await expect(workbench).toBeVisible();
  await expect(workbench.getByText('2 个窗口', { exact: true })).toBeVisible({ timeout: 60_000 });
  const frame = workbench.getByTitle('原生 Codex 会话窗口');
  const original = await frame.elementHandle();
  expect(original).not.toBeNull();
  const layout = await frame.evaluate((element: HTMLIFrameElement) => {
    const document = element.contentDocument!;
    return Array.from(document.querySelectorAll<HTMLIFrameElement>('iframe[data-kanban-native-surface]')).map(panel => {
      const bounds = panel.getBoundingClientRect();
      return { extension: new URL(panel.src).searchParams.get('extensionId'), x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, viewport: document.defaultView!.innerWidth,
        hit: document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2) === panel };
    });
  });
  expect(layout).toHaveLength(2);
  for (const [index, panel] of layout.entries()) {
    expect(panel.extension).toBe('openai.chatgpt');
    expect(panel.y).toBe(0);
    expect(panel.width).toBeCloseTo(panel.viewport / 2, 0);
    expect(panel.x).toBeCloseTo(index * panel.viewport / 2, 0);
    expect(panel.height).toBeGreaterThan(300);
    expect(panel.hit).toBe(true);
  }
  await expect.poll(async () => {
    let count = 0;
    for (const child of page.frames()) {
      if (await child.getByRole('heading', { name: 'Codex', exact: true }).count()
          && await child.getByRole('button', { name: 'Sign in with ChatGPT', exact: true }).isVisible().catch(() => false)) count++;
    }
    return count;
  }, { timeout: 30_000 }).toBe(2);
  observeStability = true;
  await page.waitForTimeout(30_000);
  expect(nativeDisconnects).toEqual([]);
  await page.screenshot({ path: test.info().outputPath('codex-desktop.png') });
  await workbench.getByRole('button', { name: '会话', exact: true }).click();
  await expect(workbench).toBeHidden();
  await page.locator('.session-mode').getByRole('button', { name: 'Codex', exact: true }).click();
  await expect(workbench).toBeVisible();
  expect(await original!.evaluate(element => element === document.querySelector('.codex-mode-frame'))).toBe(true);
  expect(nativeDisconnects).toEqual([]);
  await expect(workbench.getByText('2 个窗口', { exact: true })).toBeVisible();
  await workbench.getByRole('button', { name: '终端', exact: true }).click();
  await expect(workbench).toBeHidden();
  await page.locator('.workbench-terminal').getByRole('button', { name: 'Codex', exact: true }).click();
  await expect(workbench).toBeVisible();
  expect(await original!.evaluate(element => element === document.querySelector('.codex-mode-frame'))).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(workbench.getByRole('button', { name: '会话', exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('codex-mobile.png') });
  observeStability = false; // Reload deliberately closes the old browser connections.
  await page.reload();
  await expect(page.getByRole('region', { name: 'Codex 工作台' })).toBeVisible();
  await expect(page.getByText('2 个窗口', { exact: true })).toBeVisible({ timeout: 60_000 });
});
