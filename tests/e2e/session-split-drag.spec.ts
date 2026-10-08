import { expect, test, type Page } from '@playwright/test';
import { installSessionUxFixture, seedSessionUx } from './session-ux-fixture';

async function setup(page: Page, count = 3) {
  const fixture = await installSessionUxFixture(page, count);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/?mode=session');
  await page.locator('.session-mode [contenteditable=true]').first().waitFor();
  await seedSessionUx(page, count);
  for (let i = 0; i < count; i++)
    await page.locator('.session-nav-row[role=button]').filter({ hasText: `中文会话 ${i} ` }).first().click();
  await expect(page.locator('[data-session-group]')).toHaveCount(1);
  return fixture;
}

async function drag(page: Page, key: string, source: 'title' | 'project' = 'title', outside = 0) {
  const tab = page.locator(`[data-tab-key="${key}"]`).locator('..');
  const origin = tab.locator(source === 'title' ? '.session-identity-title' : '.session-identity-project');
  const body = (await page.locator('[data-session-group-body]').first().boundingBox())!;
  await origin.hover();
  await page.mouse.down();
  await page.mouse.move(body.x + body.width / 2, body.y + body.height / 2, { steps: 10 });
  await page.mouse.move(body.x + body.width + outside - (outside ? 0 : 8), body.y + body.height / 2, { steps: 10 });
  await page.mouse.up();
}

test('the project subtitle starts a split drag while a click still opens project details', async ({ page }) => {
  const fixture = await setup(page);
  await drag(page, 'codex:ux-2', 'project');
  await expect(page.locator('[data-session-group]')).toHaveCount(2);
  await expect(page.getByRole('menu')).toHaveCount(0);
  await page.locator('[data-tab-key="codex:ux-2"]').locator('..').locator('.session-identity-project').click();
  await expect(page.getByRole('menuitem', { name: '复制项目路径' })).toBeVisible();
  expect(fixture.calls.some(call => /\/(turn\/start|stop|interrupt)$/.test(call.path))).toBe(false);
});

test('dragging the only tab creates a usable empty group and preserves it on reload', async ({ page }) => {
  const fixture = await setup(page, 1);
  await drag(page, 'codex:ux-0');
  await expect(page.locator('[data-session-group]')).toHaveCount(2);
  await expect(page.locator('[data-tab-key="codex:ux-0"]')).toHaveCount(1);
  await expect(page.locator('.session-input-target')).toContainText('中文会话 0');
  await page.reload();
  await expect(page.locator('[data-session-group]')).toHaveCount(2);
  await page.locator('[data-session-group]').first().getByRole('button', { name: '新聊天', exact: true }).click();
  await expect(page.locator('.session-mode [contenteditable=true]')).toHaveCount(1);
  await page.getByRole('button', { name: '关闭空窗口组', exact: true }).click();
  await expect(page.locator('[data-session-group]')).toHaveCount(1);
  await expect(page.locator('.session-input-target')).toContainText('中文会话 0');
  expect(fixture.calls.some(call => /\/(turn\/start|stop|interrupt)$/.test(call.path))).toBe(false);
});

test('a temporarily retained unfollowed tab can split without silently refollowing it', async ({ page }) => {
  await setup(page);
  await page.evaluate(async () => {
    const path = '/src/session-mode/stores/useAgentCenterStore.ts';
    const { useAgentCenterStore } = await import(performance.getEntriesByType('resource').findLast(entry => new URL(entry.name).pathname === path)?.name ?? path);
    const state = useAgentCenterStore.getState();
    useAgentCenterStore.setState({ cards: state.cards.filter((card: any) => card.id !== 'ux-2'), detachedCard: state.cards.find((card: any) => card.id === 'ux-2') });
  });
  await drag(page, 'codex:ux-2');
  await expect(page.locator('[data-session-group]')).toHaveCount(2);
  await expect(page.locator('[data-tab-key="codex:ux-2"]')).toHaveAttribute('aria-selected', 'true');
  const keys = await page.evaluate(async () => {
    const path = '/src/session-mode/stores/useAgentCenterStore.ts';
    const { useAgentCenterStore } = await import(performance.getEntriesByType('resource').findLast(entry => new URL(entry.name).pathname === path)?.name ?? path);
    return useAgentCenterStore.getState().cards.map((card: any) => card.id);
  });
  expect(keys).not.toContain('ux-2');
});

test('releasing just beyond the transcript border still splits', async ({ page }) => {
  await setup(page);
  await drag(page, 'codex:ux-2', 'title', 5);
  await expect(page.locator('[data-session-group]')).toHaveCount(2);
});

test('Escape cancels a drag and removes its preview before the next drag', async ({ page }) => {
  await setup(page);
  const body = (await page.locator('[data-session-group-body]').boundingBox())!;
  await page.locator('[data-tab-key="codex:ux-2"] .session-identity-title').hover();
  await page.mouse.down();
  await page.mouse.move(body.x + body.width - 8, body.y + body.height / 2, { steps: 10 });
  await expect(page.locator('.session-split-drop[data-edge=right]')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(page.locator('[data-session-group]')).toHaveCount(1);
  await expect(page.locator('.session-split-drop')).toHaveCount(0);
  await expect(page.locator('.session-tab-drag-preview')).toHaveCount(0);
  await drag(page, 'codex:ux-2');
  await expect(page.locator('[data-session-group]')).toHaveCount(2);
});

test('the dragged tab follows the mouse without intercepting split targets', async ({ page }, testInfo) => {
  await setup(page);
  const source = page.locator('[data-tab-key="codex:ux-1"]').locator('..');
  const bounds = (await source.boundingBox())!;
  const title = (await source.locator('.session-identity-title').boundingBox())!;
  const origin = { x: title.x + title.width / 2, y: title.y + title.height / 2 };
  const body = (await page.locator('[data-session-group-body]').boundingBox())!;
  await page.mouse.move(origin.x, origin.y);
  await page.mouse.down();
  await expect(page.locator('.session-tab-drag-preview')).toHaveCount(0);
  const point = { x: body.x + body.width * 0.6, y: body.y + body.height / 2 };
  await page.mouse.move(point.x, point.y, { steps: 10 });
  const floating = page.locator('.session-tab-drag-preview');
  await expect(floating).toBeVisible();
  let rect = (await floating.boundingBox())!;
  expect(rect.x).toBeCloseTo(point.x - (origin.x - bounds.x), 0);
  expect(rect.y).toBeCloseTo(point.y - (origin.y - bounds.y), 0);
  expect(rect.width).toBeCloseTo(bounds.width, 0);
  await expect(floating).toContainText('中文会话 1');
  await expect(source).toHaveAttribute('data-pointer-source', 'true');
  await expect(page.locator('[data-tab-key="codex:ux-1"]')).toHaveCount(1);
  expect(await page.evaluate(({x, y}) => Boolean(document.elementFromPoint(x, y)?.closest('.session-tab-drag-preview')), point)).toBe(false);
  await page.screenshot({ path: testInfo.outputPath('tab-following-center.png'), animations: 'disabled' });
  const release = { x: body.x + body.width - 8, y: point.y + 25 };
  await page.mouse.move(release.x, release.y, { steps: 10 });
  rect = (await floating.boundingBox())!;
  expect(rect.x).toBeCloseTo(release.x - (origin.x - bounds.x), 0);
  expect(rect.y).toBeCloseTo(release.y - (origin.y - bounds.y), 0);
  await expect(page.locator('.session-split-drop[data-edge=right]')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('tab-following-mouse.png'), animations: 'disabled' });
  await page.mouse.up();
  await expect(page.locator('[data-session-group]')).toHaveCount(2);
  await expect(floating).toHaveCount(0);
  await expect(page.locator('[data-pointer-source]')).toHaveCount(0);
  await expect(page.locator('.session-input-target')).toContainText('中文会话 1');
});

for (const cancel of ['Escape', 'blur'] as const) {
test(`${cancel}: canceling a drag over another group keeps the original input destination`, async ({ page }) => {
  await setup(page);
  await drag(page, 'codex:ux-2');
  await expect(page.locator('[data-session-group]')).toHaveCount(2);
  const destination = await page.locator('.session-input-target').textContent();
  const body = (await page.locator('[data-session-group-body]').first().boundingBox())!;
  await page.locator('[data-tab-key="codex:ux-1"] .session-identity-title').hover();
  await page.mouse.down();
  await page.mouse.move(body.x + body.width / 2, body.y + body.height - 8, { steps: 10 });
  await expect(page.locator('.session-split-drop[data-edge=bottom]')).toBeVisible();
  if (cancel === 'Escape') await page.keyboard.press('Escape');
  else await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.mouse.up();
  await expect(page.locator('[data-session-group]')).toHaveCount(2);
  await expect(page.locator('.session-input-target')).toHaveText(destination!);
  await expect(page.locator('.session-tab-drag-preview')).toHaveCount(0);
});
}

for (const edge of ['left', 'right', 'top', 'bottom'] as const) {
  test(`pointer drag splits toward ${edge} and immediately targets the dragged conversation`, async ({ page }, testInfo) => {
    await setup(page);
    const body = (await page.locator('[data-session-group-body]').boundingBox())!;
    await page.locator('[data-tab-key="codex:ux-1"] .session-identity-title').hover();
    await page.mouse.down();
    await page.mouse.move(body.x + body.width / 2, body.y + body.height / 2, { steps: 10 });
    const x = edge === 'left' ? body.x + 4 : edge === 'right' ? body.x + body.width - 4 : body.x + body.width / 2;
    const y = edge === 'top' ? body.y + 4 : edge === 'bottom' ? body.y + body.height - 4 : body.y + body.height / 2;
    await page.mouse.move(x, y, { steps: 1 });
    await page.mouse.up();
    await expect(page.locator('[data-session-group]')).toHaveCount(2);
    await expect(page.locator('.session-input-target')).toContainText('中文会话 1');
    await page.screenshot({ path: testInfo.outputPath(`split-${edge}.png`), animations: 'disabled' });
  });
}
