import { expect, test } from "@playwright/test";
import { installSessionUxFixture } from "./session-ux-fixture";

test("browser input does not wait for the native phone shell", async ({
  page,
}) => {
  await installSessionUxFixture(page, 0);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const requests: string[] = [];
  await page.route(
    "**/src/session-mode/components/mobile/MobileShell.tsx",
    async (route) => {
      requests.push(route.request().url());
      await held;
      await route.continue();
    },
  );
  try {
    await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
    const editor = page
      .locator(".session-codex-composer [contenteditable=true]")
      .first();
    await expect(editor).toBeVisible({ timeout: 5000 });
    await editor.fill("Ready independently of the native mobile shell");
    expect(requests).toEqual([]);
  } finally {
    release();
  }
});

test("Codex input does not wait for unopened Claude or ACP composer modules", async ({
  page,
}) => {
  await installSessionUxFixture(page, 0);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const requested: string[] = [];
  await page.route(
    /\/src\/session-mode\/components\/(?:cc\/composer\/|acp\/AcpComposer)/,
    async (route) => {
      requested.push(new URL(route.request().url()).pathname);
      await held;
      await route.continue();
    },
  );
  try {
    await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
    const editor = page
      .locator(".session-codex-composer [contenteditable=true]")
      .first();
    await expect(editor).toBeVisible({ timeout: 5000 });
    await editor.fill("input before unused provider UI");
    await expect(editor).toHaveText("input before unused provider UI");
    expect(requested).toEqual([]);
  } finally {
    release();
  }
});

test("closed import dialog and unseen diff panel do not load before the first input", async ({
  page,
}) => {
  await installSessionUxFixture(page, 0);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const requested: string[] = [];
  await page.route(
    /\/src\/session-mode\/(?:DataImportDialog|features\/git\/GitDiffPanel)\.tsx/,
    async (route) => {
      requested.push(new URL(route.request().url()).pathname);
      await held;
      await route.continue();
    },
  );
  try {
    await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
    const editor = page
      .locator(".session-codex-composer [contenteditable=true]")
      .first();
    await expect(editor).toBeVisible();
    await editor.fill("Keep optional work away from initial input");
    expect(requested).toEqual([]);
  } finally {
    release();
  }
});

test("new chat input does not load the unopened side-chat transcript", async ({
  page,
}) => {
  await installSessionUxFixture(page, 0);
  const requested: string[] = [];
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    "**/src/session-mode/components/codex/composer/SideChatPanel.tsx",
    async (route) => {
      requested.push(route.request().url());
      await held;
      await route.continue();
    },
  );
  try {
    await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
    const editor = page
      .locator(".session-codex-composer [contenteditable=true]")
      .first();
    await expect(editor).toBeVisible({ timeout: 5000 });
    await editor.fill("First input before opening a side chat");
    expect(requested).toEqual([]);
  } finally {
    release();
  }
});

for (const width of [1440, 393])
  test(`an optional import module failure preserves the mounted conversation at ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 852 });
    await installSessionUxFixture(page, 0);
    await page.route("**/src/session-mode/DataImportDialog.tsx", (route) =>
      route.fulfill({
        status: 503,
        contentType: "text/javascript",
        body: "isolated optional module unavailable",
      }),
    );
    await page.goto("/?mode=session");
    const editor = page
      .locator(".session-codex-composer [contenteditable=true]")
      .first();
    await editor.fill("Keep my exact draft");
    await page.getByRole("button", { name: "更多功能", exact: true }).click();
    await page.getByRole("menuitem", { name: "导入会话", exact: true }).click();
    const alert = page
      .getByRole("alert")
      .filter({ hasText: "数据导入暂时无法加载" });
    await expect(alert).toBeVisible();
    await expect(editor).toHaveText("Keep my exact draft");
    await page.screenshot({ path: info.outputPath("optional-error.png") });
    await alert.getByRole("button", { name: "关闭此面板" }).click();
    await expect(alert).toBeHidden();
    await editor.press("End");
    await editor.press("x");
    await expect(editor).toHaveText("Keep my exact draftx");
    await expect(
      page.getByRole("heading", { name: "会话界面加载失败" }),
    ).toHaveCount(0);
  });
