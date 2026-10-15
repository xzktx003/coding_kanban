import { expect, test } from "@playwright/test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

// These UI/persistence checks must not depend on a developer's native CLI login.
test.beforeEach(async ({ page }) => {
  await page.route("**/api/session/api/codex/account/get", (route) =>
    route.fulfill({
      json: {
        account: {
          type: "chatgpt",
          email: "fixture@example.invalid",
          chatgptPlanType: "plus",
        },
        requiresOpenaiAuth: false,
      },
    }),
  );
});

test("session navigation, drafts, theme isolation and responsive layout", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/?mode=terminal", { waitUntil: "domcontentloaded" });
  const before = await page
    .locator(".workbench-mode-switch button")
    .first()
    .evaluate((el) => ({
      font: getComputedStyle(el).fontSize,
      background: getComputedStyle(el).backgroundColor,
    }));
  await page.getByRole("button", { name: "会话", exact: true }).click();
  await expect(
    page.getByRole("navigation", { name: "会话工作台导航" }),
  ).toBeVisible({
    timeout: 30000,
  });
  const after = await page
    .locator(".workbench-mode-switch button")
    .first()
    .evaluate((el) => ({
      font: getComputedStyle(el).fontSize,
      background: getComputedStyle(el).backgroundColor,
    }));
  expect(after.font).toBe(before.font);
  for (const name of ["定时任务", "工具与技能", "用量", "设置", "聊天"]) {
    await page.getByRole("button", { name, exact: true }).click();
    await expect(page.locator(".session-content")).toBeVisible();
  }
  const editor = page.locator(".session-mode [contenteditable=true]").first();
  await expect(editor).toBeVisible();
  await editor.fill("保留这段草稿");
  await page
    .getByRole("group", { name: "工作模式" })
    .getByRole("button", { name: "终端", exact: true })
    .click();
  await expect(page.locator(".workbench-terminal")).toBeVisible();
  await page.getByRole("button", { name: "会话", exact: true }).click();
  await expect(editor).toContainText("保留这段草稿");
  for (const width of [375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await expect(
      page
        .getByRole("group", { name: "工作模式" })
        .getByRole("button", { name: "终端", exact: true }),
    ).toBeInViewport();
    const send = await page
      .getByRole("button", { name: "发送消息", exact: true })
      .boundingBox();
    expect(send).not.toBeNull();
    expect(send!.x).toBeGreaterThanOrEqual(0);
    expect(send!.x + send!.width).toBeLessThanOrEqual(width);
    const actions = await page
      .getByRole("navigation", { name: "会话工作台导航" })
      .boundingBox();
    expect(actions).not.toBeNull();
    expect(actions!.x + actions!.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `.dev-runtime/session-${width}.png` });
  }
  expect(errors).toEqual([]);
});

test("new project selection persists its directory in the shared catalog", async ({
  page,
}) => {
  const project = mkdtempSync(join(tmpdir(), "kanban-session-ui-"));
  writeFileSync(join(project, "README.md"), "Session regression fixture\n");
  execFileSync("git", ["init", "--quiet", project]);
  await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
  await expect(page.getByTitle("添加项目", { exact: true })).toBeVisible({
    timeout: 30000,
  });
  try {
    await page.getByTitle("添加项目", { exact: true }).click();
    const input = page.getByLabel("服务器目录路径");
    await input.fill(project);
    const loaded = page.waitForResponse(
      async (response) =>
        response.url().includes("/filesystem/read-directory") &&
        response.request().postDataJSON()?.path === project &&
        response.ok(),
    );
    // The initial directory request can still be loading; wait for the form
    // action to be enabled instead of pressing Enter on a disabled submit.
    await page.getByRole("button", { name: "前往", exact: true }).click();
    await loaded;
    await page.getByText("选择当前目录", { exact: true }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(page.locator(".session-mode")).toContainText(
      project.split("/").at(-1)!,
    );
    const selectedProject = () =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("kanban.session.workspace") || "{}")
            .state?.cwd,
      );
    await expect.poll(selectedProject).toBe(project);
    await expect
      .poll(async () => {
        const catalog = await page.request.get("/api/workbench/projects");
        return (await catalog.json()).projects;
      })
      .toContain(project);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect.poll(selectedProject).toBe(project);
    await expect(page.locator(".session-mode")).toContainText(
      project.split("/").at(-1)!,
    );
  } finally {
    await page.close();
    // Remove only this test's shared project; selected cwd belongs to the device,
    // not the global settings resource.
    const response = await page.request.post("/api/session/projects", {
      data: {
        clientId: `cleanup-${project.split("/").at(-1)}`,
        operations: [{ seq: 1, action: { type: "remove", path: project } }],
      },
      timeout: 5000,
    });
    expect(response.ok()).toBe(true);
    rmSync(project, { recursive: true, force: true });
  }
});
