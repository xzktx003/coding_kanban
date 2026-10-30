import { expect, test } from "@playwright/test";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";
for (const width of [1440, 393])
  test(`unopened navigation workflows do not delay their triggers or composer at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 852 });
    await installSessionUxFixture(page, 1);
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const requests: string[] = [];
    await page.route(
      /\/(?:GitCommitDialog|FollowedSessionsMenuBody)\.tsx/,
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
      await expect(editor).toBeVisible();
      await seedSessionUx(page, 1, { sidebarOpen: false });
      await page.evaluate(async () => {
        const path = "/src/session-mode/stores/useAgentCenterStore.ts";
        const { useAgentCenterStore } = await import(
          performance
            .getEntriesByType("resource")
            .findLast((row) => new URL(row.name).pathname === path)?.name ??
            path
        );
        useAgentCenterStore.getState().addAgentCard(
          {
            kind: "codex",
            id: "ux-0",
            cwd: "/fixture/项目/very-long-project-path-for-ui-regression",
            preview: "Navigation exact target",
          },
          { activate: true },
        );
      });
      await editor.fill("Keep the draft while navigation workflows download");
      const openGitMenu = async () => {
        const git = page.getByRole("button", { name: "Git 操作", exact: true });
        if (width < 768 && !(await git.isVisible()))
          await page
            .getByRole("button", { name: "更多功能", exact: true })
            .click();
        await expect(git).toBeVisible();
        await git.click();
      };
      await expect(
        page.getByRole("button", { name: "全部关注会话与窗口组", exact: true }),
      ).toBeVisible();
      expect(requests).toEqual([]);
      await openGitMenu();
      await page
        .getByRole("menuitem", { name: "提交更改…", exact: true })
        .click();
      await expect(
        page.getByRole("status").filter({ hasText: "正在加载提交表单" }),
      ).toBeVisible();
      await expect(editor).toHaveText(
        "Keep the draft while navigation workflows download",
      );
      await page
        .getByRole("button", { name: "取消加载提交表单", exact: true })
        .click();
      if (width < 768) await page.keyboard.press("Escape");
      await page
        .getByRole("button", { name: "全部关注会话与窗口组", exact: true })
        .click();
      await expect(
        page.getByRole("status").filter({ hasText: "正在加载关注会话" }),
      ).toBeVisible();
      await page.keyboard.press("Escape");
      release();
      await page
        .getByRole("button", { name: "全部关注会话与窗口组", exact: true })
        .click();
      await expect(
        page.getByRole("group", { name: "关注会话列表", exact: true }),
      ).toBeVisible();
      await page
        .getByRole("menuitem")
        .filter({ hasText: "中文会话 0" })
        .first()
        .click();
      const trigger = page.getByRole("button", {
        name: "全部关注会话与窗口组",
        exact: true,
      });
      await trigger.focus();
      await trigger.press("Enter");
      await expect(page.getByRole("menuitem").first()).toBeFocused();
      await page.keyboard.press("Escape");
      await openGitMenu();
      await page
        .getByRole("menuitem", { name: "提交更改…", exact: true })
        .click();
      const commit = page.getByRole("dialog", {
        name: "提交 Git 更改",
        exact: true,
      });
      await commit
        .getByRole("textbox", { name: "Git 提交说明", exact: true })
        .fill("Keep this commit form draft");
      await commit.getByRole("button", { name: "取消", exact: true }).click();
      await expect(commit).toHaveCount(0);
      await openGitMenu();
      await page
        .getByRole("menuitem", { name: "提交更改…", exact: true })
        .click();
      await expect(
        commit.getByRole("textbox", { name: "Git 提交说明", exact: true }),
      ).toHaveValue("Keep this commit form draft");
      await commit.getByRole("button", { name: "取消", exact: true }).click();
      await expect(editor).toHaveText(
        "Keep the draft while navigation workflows download",
      );
    } finally {
      release();
    }
  });

test("failed navigation workflow modules preserve typing and can be dismissed locally", async ({
  page,
}) => {
  await installSessionUxFixture(page, 1);
  await page.route(
    /\/(?:GitCommitDialog|FollowedSessionsMenuBody)\.tsx/,
    (route) =>
      route.fulfill({
        status: 503,
        contentType: "text/plain",
        body: "isolated optional workflow unavailable",
      }),
  );
  await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
  const editor = page
    .locator(".session-codex-composer [contenteditable=true]")
    .first();
  await expect(editor).toBeVisible();
  await seedSessionUx(page, 1, { sidebarOpen: false });
  await editor.fill("Keep original workflow draft");
  await page.getByRole("button", { name: "Git 操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "提交更改…", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("提交表单暂时无法加载");
  await page.getByRole("button", { name: "关闭此面板", exact: true }).click();
  await editor.fill("Still editable after commit workflow failure");
  await page
    .getByRole("button", { name: "全部关注会话与窗口组", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "关注会话菜单暂时无法加载",
  );
  await page.getByRole("button", { name: "关闭此面板", exact: true }).click();
  await editor.fill("Still editable after both workflow failures");
  await expect(editor).toHaveText(
    "Still editable after both workflow failures",
  );
});
