import { expect, test, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

// Controlled native boundaries test our shell; live official-plugin tests are separate.
const instance = '019aabcd-1234-7890-abcd-000000000001';
const startup = '019aabcd-1234-7890-abcd-000000000002';
const thread = '019aabcd-1234-7890-abcd-000000000003';
const nativePath = '/native-codex/static/out/vs/workbench/contrib/webview/browser/pre/index.html';
async function fixture(page: Page, certificateFailure = false) {
  // This is a controlled native boundary. Chromium's ignoreHTTPSErrors does
  // not permit service-worker registration against the LAN's test certificate.
  // Model the probe explicitly; the separate failure case still exercises TLS UI.
  // Terminal mode must not subscribe to the live server when this synthetic
  // fixture switches modes; it only needs its local navigation shell.
  await page.addInitScript(() => {
    class InertSocket {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;
      readyState = InertSocket.CONNECTING;
      addEventListener() {}
      removeEventListener() {}
      send() {}
      close() { this.readyState = InertSocket.CLOSED; }
    }
    Object.defineProperty(window, 'WebSocket', { configurable: true, value: InertSocket });
  });
  await page.addInitScript(failed => {
    Object.defineProperty(navigator.serviceWorker, 'register', { configurable: true, value: async () => {
      if (failed) throw new DOMException('An SSL certificate error occurred when fetching the script.', 'SecurityError');
      return { unregister: async () => true };
    } });
  }, certificateFailure);
  const requests: string[] = [];
  let tabs: Array<{ id: string; cwd: string; title: string }> = [];
  let revision = 0;
  await page.route('**/api/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    requests.push(pathname);
    const body = route.request().postDataJSON();
    let value: unknown = {};
    if (pathname === '/api/native-codex/status') value = { available: true, resumeAvailable: true, iframeUrl: '/native-codex/?folder=%2Ftmp%2Falpha', newChatWindowIds: [startup], extensionVersion: 'fixture' };
    else if (pathname === '/api/agent-sessions') value = { items: [], activeAgentSessionId: null, updatedAt: new Date(0).toISOString() };
    else if (pathname === '/api/session/projects') value = { projects: ['/tmp/alpha', '/tmp/beta'] };
    else if (pathname.endsWith('/codex/thread/list')) value = { data: [{ id: thread, cwd: body.cwd, name: body.cwd === '/tmp/beta' ? 'Beta 搜索目标' : 'Alpha 历史', preview: '隔离示例', updatedAt: Date.now() / 1000, ephemeral: false, parentThreadId: null }], nextCursor: null };
    else if (pathname === '/api/native-codex/tabs') {
      const action = body?.operations?.[0]?.action;
      if (action?.type === 'add') { tabs = [...tabs.filter(t => t.id !== action.thread.id), action.thread]; revision++; }
      if (action?.type === 'remove') { tabs = tabs.filter(t => t.id !== action.id); revision++; }
      value = { initialized: true, revision, threads: tabs, sequence: action ? 1 : 0 };
    } else if (pathname === '/api/native-codex/resume-beside') {
      const outer = page.frames().find(f => f.url().includes('/native-codex/?'))!;
      await outer.evaluate(({ nativePath, thread }) => {
        const frame = document.createElement('iframe'); frame.className = 'webview ready'; frame.src = `${nativePath}?extensionId=openai.chatgpt&thread=${thread}`; document.body.append(frame);
      }, { nativePath, thread });
      value = { opened: true, column: 2 };
    } else if (pathname === '/api/native-codex/focus') value = { focused: true, column: body.kind === 'thread' ? 2 : 1 };
    else if (pathname === '/api/native-codex/theme') value = { applied: true };
    else if (pathname === '/api/native-codex/instance-status') value = { active: false };
    await route.fulfill({ json: value });
  });
  await page.route('**/native-codex/**', async route => {
    const url = new URL(route.request().url());
    if (!url.pathname.startsWith('/native-codex/')) { await route.fallback(); return; }
    let html: string;
    if (url.pathname === '/native-codex/') html = `<!doctype html><script>performance.mark('code/didStartWorkbench')</script><div class="statusbar-item">Kanban host ${instance}</div><iframe class="webview ready" src="${nativePath}?extensionId=openai.chatgpt"></iframe>`;
    else if (url.pathname === nativePath) html = `<!doctype html><iframe id="active-frame" src="/native-codex/app?thread=${url.searchParams.get('thread') ?? ''}"></iframe>`;
    else html = `<!doctype html><style>body{font:14px system-ui;margin:0;background:#1f1f1f;color:#ddd}#root{padding:16px}textarea{width:95%;height:80px}button{padding:8px}</style><div id="root"><p>${url.searchParams.get('thread') ? '历史已打开' : '新聊天已打开'}</p><div data-above-composer-portal data-above-composer-conversation-id="${url.searchParams.get('thread') ?? ''}"></div><textarea aria-label="原生草稿"></textarea><button>原生操作</button></div>`;
    await route.fulfill({ contentType: 'text/html', body: html });
  });
  return requests;
}

test('single startup window, real mouse tabs, keyboard navigation and retry preserve native drafts', async ({ page }) => {
  const requests = await fixture(page);
  await page.goto('/?mode=codex');
  const first = page.getByRole('tab', { name: '新聊天', exact: true });
  await expect(first).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.codex-mode-state')).toHaveCount(0);
  const frame = await page.locator('.codex-mode-frame').elementHandle();
  const native = page.frames().find(f => f.url().endsWith('/native-codex/app?thread='))!;
  await native.getByRole('textbox', { name: '原生草稿' }).fill('保留这份隔离草稿');
  await page.getByRole('button', { name: 'Resume Alpha 历史' }).click();
  const second = page.getByRole('tab', { name: 'Alpha 历史', exact: true });
  await expect(second).toHaveAttribute('aria-selected', 'true');
  await first.getByText('新聊天', { exact: true }).click();
  await expect(first).toHaveAttribute('aria-selected', 'true');
  await expect(native.getByRole('textbox', { name: '原生草稿' })).toHaveValue('保留这份隔离草稿');
  await first.press('ArrowRight');
  await expect(second).toHaveAttribute('aria-selected', 'true');
  await first.click();
  await page.getByLabel('Codex 连接状态').click();
  await page.getByRole('button', { name: '重试连接', exact: true }).click();
  expect(await frame!.evaluate(el => el.isConnected && el === document.querySelector('.codex-mode-frame'))).toBe(true);
  await expect(native.getByRole('textbox', { name: '原生草稿' })).toHaveValue('保留这份隔离草稿');
  const count = requests.filter(p => p === '/api/native-codex/tabs').length;
  await page.waitForTimeout(1200);
  expect(requests.filter(p => p === '/api/native-codex/tabs').length - count).toBeLessThanOrEqual(1);
  await page.screenshot({ path: test.info().outputPath('desktop.png') });
});

for (const device of [
  { name: 'desktop', width: 1440, height: 900, touch: false, dpr: 1 },
  { name: 'iPhone 16 size', width: 393, height: 852, touch: true, dpr: 3 },
]) {
  test.describe(`warm Codex switching on ${device.name}`, () => {
    test.use({
      viewport: { width: device.width, height: device.height },
      deviceScaleFactor: device.dpr,
      isMobile: device.touch,
      hasTouch: device.touch,
    });
    test('keeps the exact native input and iframe through repeated tabs and modes', async ({ page }) => {
      test.setTimeout(120_000);
      await fixture(page);
      await page.goto('/?mode=codex');
      const first = page.getByRole('tab', { name: '新聊天', exact: true });
      await expect(first).toHaveAttribute('aria-selected', 'true');
      const frame = await page.locator('.codex-mode-frame').elementHandle();
      const outer = page.frames().find(f => f.url().includes('/native-codex/?'))!;
      const firstNative = outer.locator('iframe.webview:not([src*="thread="])');
      await expect(firstNative).toHaveAttribute('data-kanban-native-interactive', 'true');
      const draft = page.frames().find(f => f.url().endsWith('/native-codex/app?thread='))!;
      await draft.getByRole('textbox', { name: '原生草稿' }).fill('保留原生草稿');
      if (device.touch)
        await page.getByRole('button', { name: '项目会话', exact: true }).click();
      await page.getByRole('button', { name: 'Resume Alpha 历史' }).click();
      const second = page.getByRole('tab', { name: 'Alpha 历史', exact: true });
      const secondNative = outer.locator('iframe.webview[src*="thread="]');
      await expect(secondNative).toHaveAttribute('data-kanban-native-interactive', 'true');
      const history = page.frames().find(f => f.url().endsWith(`/native-codex/app?thread=${thread}`))!;
      await expect(history.getByText('历史已打开')).toBeVisible();
      const windowSamples: number[] = [];
      for (let index = 0; index < 30; index++) {
        const target = index % 2 === 0 ? first : second;
        const native = index % 2 === 0 ? firstNative : secondNative;
        const started = await page.evaluate(() => performance.now());
        await target.click();
        await expect(target).toHaveAttribute('aria-selected', 'true');
        await expect(native).toHaveAttribute('data-kanban-native-interactive', 'true');
        windowSamples.push((await page.evaluate(() => performance.now())) - started);
      }
      await expect(draft.getByRole('textbox', { name: '原生草稿' })).toHaveValue('保留原生草稿');
      const modeSamples: number[] = [];
      for (let index = 0; index < 6; index++) {
        await page.locator('.codex-mode:not([hidden]) .mode-switch-terminal').click();
        await expect(page.locator('.workbench-shell')).toHaveAttribute('data-mode', 'terminal');
        const started = await page.evaluate(() => performance.now());
        await page.locator('.workbench-terminal:not([hidden]) .mode-switch-codex').click();
        await expect(page.locator('.workbench-shell')).toHaveAttribute('data-mode', 'codex');
        await expect(secondNative).toHaveAttribute('data-kanban-native-interactive', 'true');
        modeSamples.push((await page.evaluate(() => performance.now())) - started);
      }
      expect(await frame!.evaluate(el => el.isConnected && el === document.querySelector('.codex-mode-frame'))).toBe(true);
      const summary = (samples: number[]) => {
        const sorted = [...samples].sort((a, b) => a - b);
        return {
          count: sorted.length,
          p50Ms: sorted[Math.ceil(sorted.length * 0.5) - 1],
          p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
          maxMs: sorted.at(-1),
        };
      };
      await writeFile(test.info().outputPath('controlled-warm-switch-timing.json'), JSON.stringify({
        device: device.name,
        simulatedOfficialHost: true,
        acceptanceReceiptMeasured: false,
        windows: summary(windowSamples),
        modes: summary(modeSamples),
      }, null, 2));
    });
  });
}

for (const width of [390, 720, 1024, 1440, 1920]) {
  test(`complete independent themes and responsive navigation at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await fixture(page); await page.goto('/?mode=codex');
    await expect(page.locator('.codex-mode-state')).toHaveCount(0);
    for (const theme of ['light', 'dark']) {
      const toggle = page.getByRole('button', { name: theme === 'light' ? '切换为浅色模式' : '切换为深色模式', exact: true });
      await expect(page.getByRole('button', { name: /切换为.*色模式/ })).toBeVisible();
      if (await toggle.count()) await toggle.click();
      await expect(page.locator('.codex-mode')).toHaveClass(new RegExp(theme));
      const colors = await page.locator('.codex-mode').evaluate(el => ({ bg: getComputedStyle(el).getPropertyValue('--background'), side: getComputedStyle(document.querySelector('.codex-project-navigation')!).backgroundColor }));
      expect(colors.bg.trim()).not.toBe(''); expect(colors.side).not.toBe('rgba(0, 0, 0, 0)');
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      const bounds = await page.getByRole('tab', { name: '新聊天', exact: true }).boundingBox();
      expect(bounds!.height).toBeGreaterThanOrEqual(40);
      await page.screenshot({ path: test.info().outputPath(`${theme}-${width}.png`) });
    }
    if (width < 768) {
      await page.getByRole('button', { name: '项目会话', exact: true }).click();
      await expect(page.getByRole('textbox', { name: '搜索会话' })).toBeVisible();
      const list = await page.locator('.codex-project-list').boundingBox();
      expect(list!.height).toBeGreaterThan(500);
      await page.getByRole('textbox', { name: '搜索会话' }).press('Escape');
      await expect(page.getByRole('button', { name: '项目会话', exact: true })).toBeFocused();
      await page.getByRole('button', { name: '项目会话', exact: true }).click();
      await page.getByRole('button', { name: '关闭项目会话面板' }).click();
      await expect(page.getByRole('textbox', { name: '搜索会话' })).toBeHidden();
    } else {
      const resize = page.getByRole('separator', { name: '调整项目侧栏宽度' });
      await resize.press('End'); await expect(resize).toHaveAttribute('aria-valuenow', '400');
      await page.getByRole('button', { name: '收起项目侧栏' }).click();
      await expect(page.getByRole('textbox', { name: '搜索会话' })).toBeHidden();
      await page.getByRole('button', { name: '展开项目侧栏' }).click();
    }
  });
}

test('global search reads collapsed projects and errors do not silently become empty history', async ({ page }) => {
  await fixture(page); await page.goto('/?mode=codex');
  await page.getByRole('textbox', { name: '搜索会话' }).fill('搜索目标');
  await expect(page.getByRole('button', { name: 'Resume Beta 搜索目标' })).toBeVisible();
  await expect(page.getByText('正在检索全部项目…')).toHaveCount(0);
});

test('certificate failure is classified before mounting the native host', async ({ page }) => {
  await fixture(page, true);
  await page.goto('/?mode=codex');
  await expect(page.getByRole('heading', { name: '浏览器尚未信任 HTTPS 证书' })).toBeVisible();
  await expect(page.locator('.codex-mode-frame')).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('certificate-error.png') });
});

test('native host file picker stays visible and clickable above preserved chat frames', async ({ page }) => {
  await fixture(page); await page.goto('/?mode=codex');
  await expect(page.getByRole('tab', { name: '新聊天', exact: true })).toBeVisible();
  await expect(page.locator('.codex-mode-state')).toHaveCount(0);
  const original = await page.locator('.codex-mode-frame').elementHandle();
  const outer = page.frames().find(frame => frame.url().includes('/native-codex/?'))!;
  await outer.evaluate(() => {
    const picker = document.createElement('div'); picker.className = 'quick-input-widget';
    picker.style.cssText = 'position:fixed;top:80px;left:20px;width:300px;height:100px;background:white;color:black';
    picker.innerHTML = '<label>文件路径<input aria-label="选择测试文件"></label><button>确认选择</button>';
    picker.querySelector('button')!.onclick = () => { document.body.dataset.selectedFile = picker.querySelector('input')!.value; picker.remove(); };
    document.body.append(picker);
  });
  const input = outer.getByRole('textbox', { name: '选择测试文件' });
  await expect(input).toBeVisible();
  await input.fill('/tmp/isolated.png'); await outer.getByRole('button', { name: '确认选择' }).click();
  expect(await outer.evaluate(() => document.body.dataset.selectedFile)).toBe('/tmp/isolated.png');
  await outer.evaluate(() => {
    const notifications = document.createElement('div'); notifications.className = 'notifications-toasts';
    notifications.style.cssText = 'position:fixed;top:80px;left:20px;width:300px;height:100px';
    notifications.innerHTML = '<button>查看测试保存结果</button>';
    notifications.querySelector('button')!.onclick = () => { document.body.dataset.noticeConfirmed = 'true'; notifications.remove(); };
    document.body.append(notifications);
  });
  await expect(outer.getByRole('button', { name: '查看测试保存结果' })).toBeVisible();
  await outer.getByRole('button', { name: '查看测试保存结果' }).click();
  expect(await outer.evaluate(() => document.body.dataset.noticeConfirmed)).toBe('true');
  expect(await original!.evaluate(element => element === document.querySelector('.codex-mode-frame'))).toBe(true);
});
