import { expect, test, type Page } from '@playwright/test';
import { installSessionUxFixture, seedSessionUx } from './session-ux-fixture';

const groups = (page: Page) => page.locator('[data-session-group]');
async function setup(page: Page, count = 4) {
  const fixture = await installSessionUxFixture(page, count);
  await page.setViewportSize({ width: 1800, height: 1000 });
  await page.goto('/?mode=session');
  await page.locator('.session-mode [contenteditable=true]').first().waitFor();
  await seedSessionUx(page, count);
  for (let i = 0; i < count; i++) {
    // Literal hasText trims spaces; a digit boundary keeps 1 distinct from 10.
    await page.locator('.session-nav-row[role=button]').filter({ hasText: new RegExp(`中文会话 ${i}(?![0-9])`) }).first().click();
    await expect(page.locator(`[data-tab-key="codex:ux-${i}"]`)).toHaveCount(1);
  }
  await expect(groups(page)).toHaveCount(1);
  return fixture;
}
async function startDrag(page: Page, key: string, x: number, y: number) {
  const source = page.locator(`[data-tab-key="${key}"] .session-identity-title`);
  await source.scrollIntoViewIfNeeded();
  await source.hover();
  await page.mouse.down();
  await page.mouse.move(x, y, { steps: 12 });
}
async function splitLast(page: Page, count: number) {
  const body = (await groups(page).first().locator('[data-session-group-body]').boundingBox())!;
  await startDrag(page, `codex:ux-${count - 1}`, body.x + body.width - 8, body.y + body.height / 2);
  await page.mouse.up();
  await expect(groups(page)).toHaveCount(2);
}
async function membership(page: Page) {
  return groups(page).evaluateAll(nodes => nodes.map(group => Array.from(group.querySelectorAll<HTMLElement>('[data-tab-key]')).map(tab => tab.dataset.tabKey)));
}

for (const position of ['before', 'after', 'blank'] as const) {
  test(`cross-group ${position} insertion preserves drafts, ordering and reload`, async ({ page }, testInfo) => {
    const fixture = await setup(page);
    await splitLast(page, 4);
    await page.locator('[data-tab-key="codex:ux-0"]').click();
    await page.locator('.session-mode [contenteditable=true]').fill('原会话的未发送草稿');
    await page.locator('[data-tab-key="codex:ux-3"]').click();
    await page.locator('.session-mode [contenteditable=true]').fill('目标组会话的草稿');
    const right = groups(page).nth(1);
    const tab = (await right.locator('[data-tab-key="codex:ux-3"]').locator('..').boundingBox())!;
    const strip = (await right.locator('.session-tab-strip').boundingBox())!;
    const x = position === 'blank' ? strip.x + strip.width - 12 : tab.x + tab.width * (position === 'before' ? 0.2 : 0.8);
    await startDrag(page, 'codex:ux-0', x, tab.y + 12);
    await expect(page.locator('.session-tab-insertion-marker')).toBeVisible();
    await expect(page.locator('.session-split-drop')).toHaveCount(0);
    await expect(page.locator('.session-input-target')).toContainText('中文会话 3');
    await page.screenshot({ path: testInfo.outputPath(`insert-${position}.png`), animations: 'disabled' });
    await page.mouse.up();
    const expected = [['codex:ux-1', 'codex:ux-2'], position === 'before' ? ['codex:ux-0', 'codex:ux-3'] : ['codex:ux-3', 'codex:ux-0']];
    await expect.poll(() => membership(page)).toEqual(expected);
    await expect(page.locator('.session-input-target')).toContainText('中文会话 0');
    await expect(page.locator('.session-mode [contenteditable=true]')).toHaveText('原会话的未发送草稿');
    await expect(page.locator('.session-tab-insertion-marker, .session-tab-drag-preview')).toHaveCount(0);
    await page.locator('[data-tab-key="codex:ux-3"]').click();
    await expect(page.locator('.session-mode [contenteditable=true]')).toHaveText('目标组会话的草稿');
    await page.reload();
    await expect.poll(() => membership(page)).toEqual(expected);
    await expect(page.locator('.session-mode [contenteditable=true]')).toHaveText('目标组会话的草稿');
    expect(fixture.calls.some(call => /\/(turn\/start|thread\/start|stop|interrupt)$/.test(call.path))).toBe(false);
  });
}

test('moving the last source tab into another header collapses the empty split once', async ({ page }) => {
  await setup(page, 2);
  await splitLast(page, 2);
  const target = (await groups(page).nth(1).locator('[data-tab-key="codex:ux-1"]').locator('..').boundingBox())!;
  await startDrag(page, 'codex:ux-0', target.x + target.width * 0.8, target.y + 12);
  await page.mouse.up();
  await expect.poll(() => membership(page)).toEqual([['codex:ux-1', 'codex:ux-0']]);
  await expect(page.locator('.session-input-target')).toContainText('中文会话 0');
});

test('the empty-group header accepts a label and clears its empty-group status', async ({ page }) => {
  await setup(page, 1);
  await splitLast(page, 1);
  const target = (await groups(page).first().locator('.session-tab-strip').boundingBox())!;
  await startDrag(page, 'codex:ux-0', target.x + target.width / 2, target.y + 12);
  await expect(page.locator('.session-tab-insertion-marker')).toBeVisible();
  await page.mouse.up();
  await expect.poll(() => membership(page)).toEqual([['codex:ux-0']]);
  await expect(page.getByRole('button', { name: '关闭空窗口组', exact: true })).toHaveCount(0);
});

test('a gap in a target header inserts between its existing labels', async ({ page }) => {
  await setup(page);
  await splitLast(page, 4);
  const body = (await groups(page).nth(1).locator('[data-session-group-body]').boundingBox())!;
  await startDrag(page, 'codex:ux-2', body.x + body.width / 2, body.y + body.height / 2);
  await page.mouse.up();
  const strip = groups(page).nth(1).locator('.session-tab-strip');
  await strip.evaluate(element => (element as HTMLElement).style.gap = '12px');
  const tab = (await page.locator('[data-tab-key="codex:ux-3"]').locator('..').boundingBox())!;
  await startDrag(page, 'codex:ux-0', tab.x + tab.width + 6, tab.y + 12);
  await page.mouse.up();
  await expect.poll(() => membership(page)).toEqual([['codex:ux-1'], ['codex:ux-3', 'codex:ux-0', 'codex:ux-2']]);
});

async function overflowSetup(page: Page) {
  const fixture = await setup(page, 14);
  await expect(page.locator('[data-tab-key]')).toHaveCount(14);
  await page.evaluate(async () => {
    const load = async (path: string) => import(performance.getEntriesByType('resource').findLast(entry => new URL(entry.name).pathname === path)?.name ?? path);
    const { useSessionSplitStore } = await load('/src/session-mode/stores/useSessionSplitStore.ts');
    const { useAgentCenterStore } = await load('/src/session-mode/stores/useAgentCenterStore.ts');
    useSessionSplitStore.setState({ activeGroupId: 'source', tree: { type: 'split', id: 'test-split', direction: 'horizontal', ratio: 50, first: { type: 'group', id: 'source', keys: ['codex:ux-0'], selected: 'codex:ux-0' }, second: { type: 'group', id: 'target', keys: Array.from({ length: 13 }, (_, i) => `codex:ux-${i + 1}`), selected: 'codex:ux-1' } } });
    useAgentCenterStore.getState().setCurrentAgentCardId('ux-0', 'codex');
  });
  await page.locator('[data-tab-key="codex:ux-0"]').click();
  return fixture;
}

for (const edge of ['left', 'right'] as const) {
test(`stationary ${edge} edge hover scrolls the target header and cancellation stops it`, async ({ page }) => {
  test.setTimeout(60000);
  await overflowSetup(page);
  const strip = groups(page).nth(1).locator('.session-tab-strip');
  const rect = (await strip.boundingBox())!;
  await strip.evaluate((element, edge) => element.scrollLeft = edge === 'right' ? 0 : element.scrollWidth - element.clientWidth, edge);
  await startDrag(page, 'codex:ux-0', edge === 'right' ? rect.x + rect.width - 5 : rect.x + 5, rect.y + 12);
  const initial = await strip.evaluate(element => element.scrollLeft);
  if (edge === 'right') await expect.poll(() => strip.evaluate(element => element.scrollLeft)).toBeGreaterThan(initial + 100);
  else await expect.poll(() => strip.evaluate(element => element.scrollLeft)).toBeLessThan(initial - 100);
  await expect(page.locator('.session-tab-insertion-marker')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.mouse.up();
  const stopped = await strip.evaluate(element => element.scrollLeft);
  await page.waitForTimeout(120);
  expect(await strip.evaluate(element => element.scrollLeft)).toBe(stopped);
  await expect(page.locator('.session-tab-insertion-marker, .session-tab-drag-preview')).toHaveCount(0);
  await expect(groups(page)).toHaveCount(2);
  await expect(page.locator('.session-input-target')).toContainText('中文会话 0');
});
}

test('scrolling to the hidden final label then releasing appends at its actual position', async ({ page }, testInfo) => {
  test.setTimeout(60000);
  await overflowSetup(page);
  const strip = groups(page).nth(1).locator('.session-tab-strip');
  const rect = (await strip.boundingBox())!;
  await strip.evaluate(element => element.scrollLeft = 0);
  await startDrag(page, 'codex:ux-0', rect.x + rect.width - 5, rect.y + 12);
  await expect.poll(() => strip.evaluate(element => element.scrollWidth - element.clientWidth - element.scrollLeft), { timeout: 12000 }).toBeLessThanOrEqual(1);
  await expect(page.locator('.session-tab-insertion-marker')).toHaveAttribute('data-position', 'after');
  await page.screenshot({ path: testInfo.outputPath('insert-after-scroll.png'), animations: 'disabled' });
  await page.mouse.up();
  await expect.poll(() => membership(page)).toEqual([[...Array.from({ length: 13 }, (_, i) => `codex:ux-${i + 1}`), 'codex:ux-0']]);
  await expect(page.locator('.session-input-target')).toContainText('中文会话 0');
  await expect(page.locator('.session-tab-insertion-marker, .session-tab-drag-preview')).toHaveCount(0);
});

for (const control of ['menu', 'new'] as const) {
  test(`the ${control} button is excluded from header drop targets`, async ({ page }) => {
    const fixture = await setup(page);
    await splitLast(page, 4);
    const before = await membership(page);
    const target = groups(page).nth(1).locator(control === 'menu' ? '.session-followed-trigger' : '.session-new-tab button');
    const bounds = (await target.boundingBox())!;
    await startDrag(page, 'codex:ux-0', bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await expect(page.locator('.session-tab-insertion-marker, .session-split-drop')).toHaveCount(0);
    await page.mouse.up();
    await expect.poll(() => membership(page)).toEqual(before);
    await expect(page.getByRole('menu')).toHaveCount(0);
    expect(fixture.calls.some(call => /\/(thread\/start|turn\/start|stop|interrupt)$/.test(call.path))).toBe(false);
  });
}

test('same-group forward and backward insertion keep shared ordering aligned', async ({ page }) => {
  await setup(page, 3);
  const target = (await page.locator('[data-tab-key="codex:ux-1"]').locator('..').boundingBox())!;
  await startDrag(page, 'codex:ux-0', target.x + target.width * 0.75, target.y + 12);
  await page.mouse.up();
  await expect.poll(() => membership(page)).toEqual([['codex:ux-1', 'codex:ux-0', 'codex:ux-2']]);
  const first = (await page.locator('[data-tab-key="codex:ux-1"]').locator('..').boundingBox())!;
  await startDrag(page, 'codex:ux-2', first.x + first.width * 0.25, first.y + 12);
  await page.mouse.up();
  await expect.poll(() => membership(page)).toEqual([['codex:ux-2', 'codex:ux-1', 'codex:ux-0']]);
  const keys = await page.evaluate(async () => {
    const path = '/src/session-mode/stores/useAgentCenterStore.ts';
    const { useAgentCenterStore } = await import(performance.getEntriesByType('resource').findLast(entry => new URL(entry.name).pathname === path)?.name ?? path);
    return useAgentCenterStore.getState().cards.map((card: any) => card.id);
  });
  expect(keys).toEqual(['ux-2', 'ux-1', 'ux-0']);
});
