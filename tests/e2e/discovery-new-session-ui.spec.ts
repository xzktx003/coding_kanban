import { expect, test } from '@playwright/test';

const mockSshHost = {
  name: 'hm15',
  host: '10.30.0.15',
  port: 22,
  username: 'houmo',
  defaultPath: '/data01/home/houmo',
};

async function mockShell(page: import('@playwright/test').Page) {
  await page.route('**/api/agent-sessions', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }

    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        items: [],
        activeAgentSessionId: null,
        updatedAt: new Date().toISOString(),
      }),
    });
  });

  await page.route('**/api/ssh-hosts', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        hosts: [mockSshHost],
      }),
    });
  });
}

async function openNewSessionForHost(
  page: import('@playwright/test').Page,
  hostLabel: string,
) {
  await page.getByTestId('new-session-toggle').click();
  await expect(page.getByTestId('new-session-dialog')).toHaveCount(0);
  await expect(page.getByTestId('host-dropdown-menu')).toBeVisible();
  await page.locator('.host-dropdown-item', { hasText: hostLabel }).click();
  await expect(page.getByTestId('new-session-dialog')).toBeVisible();
}

test('app discovery: 选择 SSH 主机后扫描请求会带上 sshTarget', async ({
  page,
}) => {
  let scanBody: Record<string, unknown> | null = null;

  await mockShell(page);
  await page.route('**/api/agent-discovery/scan', async (route) => {
    scanBody = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        results: [],
        scannedPath: '/data01/home/houmo/project',
        hostId: mockSshHost.host,
      }),
    });
  });

  await page.goto('/');
  await page.getByTestId('scan-menu-toggle').click();
  await page.getByTestId('btn-扫描会话').click();
  await page.getByRole('button', { name: /hm15/i }).click();

  await page.locator('.discovery-path-input').fill('/data01/home/houmo/project');
  await page.locator('.discovery-scan-btn').click();

  await expect
    .poll(() => scanBody)
    .toMatchObject({
      path: '/data01/home/houmo/project',
      hostId: mockSshHost.host,
      sshTarget: {
        host: mockSshHost.host,
        port: mockSshHost.port,
        username: mockSshHost.username,
      },
    });
});

test('new session: 点击后先打开 host 下拉，选中后直接进入会话详情', async ({ page }) => {
  await mockShell(page);

  await page.goto('/');
  await page.getByTestId('new-session-toggle').click();

  await expect(page.getByTestId('host-dropdown-menu')).toBeVisible();
  await expect(page.getByTestId('new-session-dialog')).toHaveCount(0);
  await expect(page.getByTestId('new-session-details-step')).toHaveCount(0);

  await page.locator('.host-dropdown-item', { hasText: '本机' }).click();

  await expect(page.getByTestId('new-session-host-step')).toHaveCount(0);
  await expect(page.getByTestId('new-session-details-step')).toBeVisible();
  await expect(page.getByTestId('new-session-name')).toBeVisible();
  await expect(page.getByTestId('new-session-kind')).toBeVisible();
  await expect(page.getByTestId('new-session-kind-copilot')).toHaveClass(
    /is-active/,
  );
  await page.getByTestId('new-session-kind-shell').click();
  await expect(page.getByTestId('new-session-kind-shell')).toHaveClass(
    /is-active/,
  );
});

test('new session: 启动方式使用二选一按钮而不是下拉框', async ({ page }) => {
  await mockShell(page);

  await page.goto('/');
  await openNewSessionForHost(page, '本机');

  await expect(page.getByTestId('new-session-mode')).toHaveCount(0);
  await expect(page.getByTestId('new-session-mode-direct')).toBeVisible();
  await expect(page.getByTestId('new-session-mode-tmux')).toBeVisible();

  await page.getByTestId('new-session-mode-tmux').click();
  await expect(page.getByTestId('new-session-tmux-note')).toContainText(
    'tmux session 名将使用当前显示名称',
  );
});

test('new session: 鼠标滚轮只滚动会话弹窗而不穿透到看板', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 520 });
  await mockShell(page);

  await page.goto('/');
  await openNewSessionForHost(page, '本机');

  const dialog = page.getByTestId('new-session-dialog');
  const mainContent = page.locator('.main-content');
  await expect
    .poll(() =>
      dialog.evaluate((element) => element.scrollHeight > element.clientHeight),
    )
    .toBe(true);

  const backgroundScrollTop = await mainContent.evaluate((element) => {
    element.style.overflowY = 'auto';
    const spacer = document.createElement('div');
    spacer.dataset.testid = 'background-scroll-spacer';
    spacer.style.height = '2000px';
    spacer.style.flex = '0 0 2000px';
    element.appendChild(spacer);
    element.scrollTop = 120;
    return element.scrollTop;
  });

  await dialog.hover();
  await page.mouse.wheel(0, 480);

  await expect
    .poll(() => dialog.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  await expect
    .poll(() => mainContent.evaluate((element) => element.scrollTop))
    .toBe(backgroundScrollTop);

  await dialog.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await page.mouse.wheel(0, 480);
  await expect
    .poll(() => mainContent.evaluate((element) => element.scrollTop))
    .toBe(backgroundScrollTop);
});

test('new session: 目录建议仅在后端声明可用时显示候选框', async ({ page }) => {
  await mockShell(page);

  let enabledRequests = 0;
  await page.route('**/api/directory-suggestions', async (route) => {
    enabledRequests += 1;
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        enabled: true,
        suggestions: [
          '/data01/home/houmo',
          '/data01/home/houmo/project-a',
        ],
      }),
    });
  });

  await page.goto('/');
  await openNewSessionForHost(page, 'hm15');
  await page.getByTestId('new-session-dir').fill('/data01/home/hou');

  await expect.poll(() => enabledRequests).toBeGreaterThan(0);
  await expect(page.getByTestId('directory-suggestions')).toBeVisible();
  await expect(page.getByTestId('directory-suggestion-item-0')).toContainText(
    '/data01/home/houmo',
  );
});

test('new session: 远端目录建议不可用时不显示候选框', async ({ page }) => {
  await mockShell(page);

  let disabledRequests = 0;
  await page.route('**/api/directory-suggestions', async (route) => {
    disabledRequests += 1;
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        enabled: false,
        suggestions: [],
      }),
    });
  });

  await page.goto('/');
  await openNewSessionForHost(page, 'hm15');
  await page.getByTestId('new-session-dir').fill('/data01/home/hou');

  await expect.poll(() => disabledRequests).toBeGreaterThan(0);
  await expect(page.getByTestId('directory-suggestions')).toHaveCount(0);
});

test('new session: 可在目录选择器当前目录下新建文件夹并选中', async ({
  page,
}) => {
  await mockShell(page);

  const parentPath = '/data01/home/houmo';
  const createdPath = `${parentPath}/kanban-new-work`;
  const fsOperations: Array<Record<string, unknown>> = [];
  let listRequests = 0;

  await page.route('**/api/fs/list', async (route) => {
    listRequests += 1;
    const body = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        path: body.path || parentPath,
        entries: [
          {
            name: 'existing-work',
            path: `${parentPath}/existing-work`,
            type: 'directory',
            size: 0,
            modifiedAt: new Date().toISOString(),
            owner: 'houmo',
            permissions: 'drwxr-xr-x',
            isHidden: false,
          },
        ],
      }),
    });
  });

  await page.route('**/api/fs/operation', async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    fsOperations.push(body);
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, path: body.path }),
    });
  });

  await page.goto('/');
  await openNewSessionForHost(page, 'hm15');
  await page.getByTestId('new-session-dir').fill(parentPath);
  await page.getByTestId('new-session-browse-dir').click();

  await expect.poll(() => listRequests).toBeGreaterThan(0);
  await expect(page.getByTestId('new-session-directory-picker')).toBeVisible();
  await expect(page.getByTestId('new-session-directory-current')).toContainText(
    parentPath,
  );

  await page.getByTestId('new-session-new-folder-name').fill('kanban-new-work');
  await page.getByTestId('new-session-create-folder').click();

  await expect
    .poll(() => fsOperations)
    .toContainEqual({
      operation: 'mkdir',
      path: createdPath,
      sshTarget: {
        host: mockSshHost.host,
        port: mockSshHost.port,
        username: mockSshHost.username,
      },
    });
  await expect(page.getByTestId('new-session-dir')).toHaveValue(createdPath);
  await expect(page.getByTestId('new-session-directory-picker')).toHaveCount(0);
});
