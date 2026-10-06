import { expect, test } from "@playwright/test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

test("session navigation, drafts, theme isolation and responsive layout", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/?mode=terminal", { waitUntil: "domcontentloaded" });
  const before = await page
    .locator(".workbench-modes button")
    .first()
    .evaluate((el) => ({
      font: getComputedStyle(el).fontSize,
      background: getComputedStyle(el).backgroundColor,
    }));
  await page.getByRole("button", { name: "会话模式", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "会话功能" })).toBeVisible({
    timeout: 30000,
  });
  const after = await page
    .locator(".workbench-modes button")
    .first()
    .evaluate((el) => ({
      font: getComputedStyle(el).fontSize,
      background: getComputedStyle(el).backgroundColor,
    }));
  expect(after.font).toBe(before.font);
  for (const name of ["定时任务", "工具与技能", "用量", "设置", "会话"]) {
    await page.getByRole("button", { name, exact: true }).click();
    await expect(page.locator(".session-content")).toBeVisible();
  }
  const editor = page.locator(".session-mode [contenteditable=true]").first();
  await expect(editor).toBeVisible();
  await editor.fill("保留这段草稿");
  await page.getByRole("button", { name: "终端模式", exact: true }).click();
  await expect(page.locator(".workbench-terminal")).toBeVisible();
  await page.getByRole("button", { name: "会话模式", exact: true }).click();
  await expect(editor).toContainText("保留这段草稿");
  for (const width of [375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await expect(
      page.getByRole("button", { name: "终端模式", exact: true }),
    ).toBeInViewport();
    const send = await page.getByRole("button", { name: "发送消息", exact: true }).boundingBox();
    expect(send).not.toBeNull();
    expect(send!.x).toBeGreaterThanOrEqual(0);
    expect(send!.x + send!.width).toBeLessThanOrEqual(width);
    const actions = await page.locator(".session-agent-header-actions").boundingBox();
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
  const previousSettings = await (await page.request.get("/api/session/api/settings")).json();
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
  await input.press("Enter");
  await loaded;
  await page.getByText("选择当前目录", { exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.locator(".session-mode")).toContainText(
    project.split("/").at(-1)!,
  );
  await page.waitForTimeout(1500);
  const settings = await page.request.get("/api/session/api/settings");
  expect((await settings.json()).workspace.cwd).toBe(project);
  const catalog = await page.request.get("/api/workbench/projects");
  expect((await catalog.json()).projects).toContain(project);
  } finally {
    await page.close();
    const current = await (await page.request.get("/api/session/api/settings")).json();
    const workspace = current.workspace ?? {};
    for (const key of ["projects", "historyProjects"]) {
      if (Array.isArray(workspace[key])) workspace[key] = workspace[key].filter((path: string) => path !== project);
    }
    if (workspace.cwd === project) workspace.cwd = previousSettings.workspace?.cwd ?? workspace.projects?.[0] ?? null;
    await page.request.post("/api/session/api/settings", { data: current });
  }
});
