// Explicit, local acceptance against an already-running Harness. Never sends Agent input.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const harness = new URL(process.env.HARNESS_ORIGIN);
const kanban = new URL(process.env.KANBAN_ORIGIN);
const output = resolve(process.env.HARNESS_KANBAN_OUTPUT);
assert.equal(harness.protocol, 'https:', 'Acceptance requires HTTPS Harness');
assert.equal(kanban.protocol, 'https:', 'Acceptance requires HTTPS Kanban');
assert.ok(process.env.HARNESS_LAUNCH_LOG, 'Pass an explicit private launch log');
const lines = (await readFile(process.env.HARNESS_LAUNCH_LOG, 'utf8')).split('\n');
const launch = new URL(lines.filter(line => line.startsWith('dsh web: http')).at(-1).slice('dsh web: '.length));
assert.equal(launch.hostname, harness.hostname, 'Launch credential must belong to this host');
assert.ok(launch.searchParams.has('token'));
launch.protocol = harness.protocol;
launch.port = harness.port;
await mkdir(output, { recursive:true, mode:0o700 });
const browser = await chromium.launch({ headless:true });
const report = { fixture:{}, live:{}, pageErrors:0 };
let activePage;
const policyErrors = [];
try {
  const context = await browser.newContext({ viewport:{ width:1440, height:1000 }, ignoreHTTPSErrors:true });
  const page = await context.newPage();
  const sockets = new Set();
  page.on('websocket', socket => sockets.add(new URL(socket.url()).pathname));
  activePage = page;
  page.on('pageerror', () => report.pageErrors++);
  page.on('console', message => {
    if (/Content Security Policy|Permissions policy|Mixed Content|Refused to frame/.test(message.text())) {
      policyErrors.push(message.text().replace(/([?&]token=)[^\s&#]+/g, '$1<redacted>').slice(0, 400));
    }
  });
  await page.goto(launch.href, { waitUntil:'domcontentloaded' });
  const entry = () => page.getByRole('button', { name:'打开 Kanban', exact:true });
  await entry().waitFor({ state:'visible', timeout:60000 });
  await entry().click();
  console.log('Kanban launcher opened');
  await page.getByRole('heading', { name:'连接现有 Kanban' }).waitFor();
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), '返回 Harness');
  await page.screenshot({ path:resolve(output, 'connection.png') });
  assert.equal(await page.locator('iframe[title="Coding Kanban"]').count(), 0);
  let loads = 0;
  const fixtureOrigin = 'https://kanban-fixture.test';
  await context.route(`${fixtureOrigin}/**`, route => {
    loads++;
    return route.fulfill({ contentType:'text/html; charset=utf-8', body:'<!doctype html><html><head><meta charset="utf-8"></head><body><label>验收草稿<input id="draft"></label><script>window.fixtureIdentity=crypto.randomUUID()</script></body></html>' });
  });
  await page.getByLabel('Kanban 服务地址').fill(fixtureOrigin);
  await page.getByRole('button', { name:'保存并连接' }).click();
  const iframe = () => page.frameLocator('iframe[title="Coding Kanban"]');
  await iframe().getByLabel('验收草稿').fill('draft remains across navigation', { timeout:15000 });
  const firstFrame = page.frames().find(frame => frame.url().startsWith(fixtureOrigin));
  const identity = await firstFrame.evaluate(() => window.fixtureIdentity);
  const frameNode = await page.locator('iframe[title="Coding Kanban"]').elementHandle();
  await page.getByRole('button', { name:'返回 Harness', exact:true }).click();
  await page.locator('.hkb-workspace').waitFor({ state:'hidden' });
  assert.notEqual(await page.evaluate(() => document.activeElement?.tagName), 'IFRAME');
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), '打开 Kanban');
  await entry().click();
  await page.locator('.hkb-workspace').waitFor({ state:'visible' });
  assert.equal(await firstFrame.evaluate(() => window.fixtureIdentity), identity);
  assert.equal(await iframe().getByLabel('验收草稿').inputValue(), 'draft remains across navigation');
  assert.equal(await frameNode.evaluate(node => node === document.querySelector('iframe[title="Coding Kanban"]')), true);
  assert.equal(loads, 1);
  for (let index = 0; index < 4; index++) {
    await page.getByRole('button', { name:'返回 Harness', exact:true }).click();
    await entry().click();
  }
  assert.equal(loads, 1, 'Repeated navigation cannot reload the frame');
  console.log('Persistent iframe and draft verified');
  await page.getByRole('button', { name:'连接设置', exact:true }).click();
  await page.getByRole('button', { name:'取消', exact:true }).click();
  assert.equal(await firstFrame.evaluate(() => window.fixtureIdentity), identity);
  report.fixture = { loads, sameFrame:true, draftPreserved:true, hiddenBlurred:true, settingsPreserved:true };

  await page.getByRole('button', { name:'连接设置', exact:true }).click();
  await page.getByLabel('Kanban 服务地址').fill(kanban.origin);
  await page.getByRole('button', { name:'保存并连接' }).click();
  await iframe().locator('body').waitFor({ state:'visible', timeout:30000 });
  await iframe().getByRole('button', { name:'会话', exact:true }).first().waitFor({ timeout:30000 });
  const liveFrame = page.frames().find(frame => frame.url().startsWith(kanban.origin));
  const capabilities = await liveFrame.evaluate(() => ({
    secure:isSecureContext,
    clipboard:typeof navigator.clipboard?.writeText === 'function',
    microphone:typeof navigator.mediaDevices?.getUserMedia === 'function',
    serviceWorker:'serviceWorker' in navigator,
  }));
  assert.equal(capabilities.secure, true);
  assert.equal(capabilities.clipboard, true);
  assert.equal(capabilities.microphone, true);
  assert.equal(capabilities.serviceWorker, true);
  const box = await page.locator('.hkb-workspace').boundingBox();
  const anchorNode = page.locator('[data-harness-kanban-anchor]');
  const anchor = await anchorNode.count() ? await anchorNode.boundingBox() : null;
  if (anchor && anchor.width > 0 && anchor.height > 0) assert.deepEqual(box, anchor);
  else assert.deepEqual(box, { x:12, y:12, width:1416, height:976 });
  await page.screenshot({ path:resolve(output, 'desktop.png') });
  await page.setViewportSize({ width:1000, height:900 });
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path:resolve(output, 'narrow-desktop.png') });
  const mux = await page.evaluate(() => performance.getEntriesByType('resource').filter(row => row.name.includes('/api/')).length);
  report.live = { capabilities, aligned:true, apiResources:mux };
  assert.ok(sockets.has('/api/remote.mux'), 'Harness native WebSocket must remain connected');
  report.live.nativeMux = true;

  // DS Bot mode is changed only in this disposable browser's local storage.
  await page.getByRole('button', { name:'返回 Harness', exact:true }).click();
  await page.getByRole('button', { name:'Account', exact:true }).click();
  await page.getByRole('menuitem', { name:'Switch to classic Agent mode', exact:true }).click();
  await page.getByRole('button', { name:'Kanban', exact:true }).click();
  await page.locator('[data-harness-kanban-anchor]').waitFor();
  await page.waitForTimeout(300);
  assert.deepEqual(await page.locator('.hkb-workspace').boundingBox(), await page.locator('[data-harness-kanban-anchor]').boundingBox());
  assert.equal(await page.locator('iframe[title="Coding Kanban"]').count(), 1);
  await page.getByRole('button', { name:'Plugins', exact:true }).click();
  await page.locator('.hkb-workspace').waitFor({ state:'hidden' });
  await page.getByRole('button', { name:'Kanban', exact:true }).click();
  await page.locator('.hkb-workspace').waitFor({ state:'visible' });
  report.live.classicNavigation = true;

  const originalLaunch = new URL(lines.filter(line => line.startsWith('dsh web: http')).at(-1).slice('dsh web: '.length));
  if (originalLaunch.protocol === 'http:') {
    const insecureContext = await browser.newContext({ viewport:{ width:1440, height:1000 } });
    const insecurePage = await insecureContext.newPage();
    await insecurePage.goto(originalLaunch.href, { waitUntil:'domcontentloaded' });
    await insecurePage.getByRole('button', { name:'打开 Kanban', exact:true }).click();
    await insecurePage.getByLabel('Kanban 服务地址').fill(kanban.origin);
    await insecurePage.getByRole('button', { name:'保存并连接' }).click();
    await insecurePage.locator('.hkb-notice').filter({ hasText:'HTTPS' }).waitFor();
    assert.equal(await insecurePage.locator('iframe[title="Coding Kanban"]').count(), 0);
    report.live.insecureAncestorBlocked = true;
    await insecureContext.close();
  } else report.live.insecureAncestorBlocked = 'not-run: current Harness is HTTPS-only';
  assert.equal(report.pageErrors, 0);
  await context.close();
  await writeFile(resolve(output, 'result.json'), JSON.stringify(report, null, 2)+'\n', { mode:0o600 });
  console.log(JSON.stringify(report));
} catch (error) {
  if (activePage && !activePage.isClosed()) {
    await activePage.screenshot({ path:resolve(output, 'failure.png') }).catch(() => {});
    console.error(JSON.stringify({ policyErrors, frameCount:activePage.frames().length,
      frameSources:await activePage.locator('iframe').evaluateAll(nodes => nodes.map(node => ({ title:node.title, source:node.getAttribute('src'), visible:!!node.getClientRects().length }))),
      notices:await activePage.locator('.hkb-notice,.hkb-error').allTextContents() }));
  }
  throw new Error(String(error.message).replace(/([?&]token=)[^\s&#]+/g, '$1<redacted>'));
} finally { await browser.close(); }
