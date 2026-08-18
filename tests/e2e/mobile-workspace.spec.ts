import { expect, test } from "@playwright/test";

test.use({ ignoreHTTPSErrors: true });

test.describe("Mobile workspace", () => {
  test("keeps one session picker layer and aligns transcript actions", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route("**/api/agent-sessions", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          activeAgentSessionId: "mobile-alpha",
          items: [
            {
              id: "mobile-alpha",
              workspaceId: "default",
              sourceType: "local",
              agentKind: "codex",
              displayName: "Mobile Alpha",
              connectionState: "online",
              interactionState: "running",
            },
            {
              id: "mobile-beta",
              workspaceId: "default",
              sourceType: "local",
              agentKind: "shell",
              displayName: "Mobile Beta",
              connectionState: "online",
              interactionState: "idle",
            },
          ],
          updatedAt: new Date().toISOString(),
        }),
      });
    });
    await page.route("**/api/fs/list", async (route) => {
      const body = route.request().postDataJSON() as { path: string };
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ path: body.path, entries: [] }),
      });
    });

    await page.goto("/?view=mobile");
    await page.getByRole("button", { name: "当前会话" }).click();

    const picker = page.locator(".mobile-session-picker-trigger");
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await picker.click();
      await expect(
        page.getByRole("listbox", { name: "选择终端会话" }),
      ).toHaveCount(1);
      await expect(page.getByRole("option")).toHaveCount(2);
      await page.keyboard.press("Escape");
      await expect(
        page.getByRole("listbox", { name: "选择终端会话" }),
      ).toHaveCount(0);
    }

    const transcriptBox = await page
      .getByRole("button", { name: "完整记录" })
      .boundingBox();
    const changesBox = await page
      .getByRole("button", { name: "变更" })
      .boundingBox();
    expect(transcriptBox).not.toBeNull();
    expect(changesBox).not.toBeNull();
    expect(
      Math.abs((transcriptBox?.y ?? 0) - (changesBox?.y ?? 0)),
    ).toBeLessThan(1);

    await page.getByRole("button", { name: "文件", exact: true }).click();
    await expect(
      page.getByRole("region", { name: "手机文件系统" }),
    ).toBeVisible();
    await expect(page.locator(".terminal-view")).toHaveCount(0);
    await page.getByRole("button", { name: "返回终端" }).click();
    await expect(page.locator(".terminal-view")).toHaveCount(1);
  });

  test("opens the lightweight board and mounts a terminal only after session navigation", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/?view=mobile");

    await expect(
      page.getByRole("heading", { name: "手机工作区" }),
    ).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "手机端主导航" }),
    ).toBeVisible();
    await expect(page.locator(".mobile-terminal-surface")).toHaveCount(0);
    await expect(page.locator(".terminal-view")).toHaveCount(0);

    await page.getByRole("button", { name: "当前会话" }).click();
    await expect(page.locator(".mobile-terminal-surface")).toBeVisible();
    await expect(page.locator(".terminal-view")).toHaveCount(1);
  });

  test("provides board, activity, current session, and project/file destinations", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/?view=mobile");

    const navigation = page.getByRole("navigation", { name: "手机端主导航" });
    await expect(
      navigation.getByRole("button", { name: "看板" }),
    ).toBeVisible();
    await expect(
      navigation.getByRole("button", { name: "活动" }),
    ).toBeVisible();
    await expect(
      navigation.getByRole("button", { name: "当前会话" }),
    ).toBeVisible();
    await expect(
      navigation.getByRole("button", { name: "项目/文件" }),
    ).toBeVisible();

    await navigation.getByRole("button", { name: "活动" }).click();
    await expect(page.getByRole("heading", { name: "最近活动" })).toBeVisible();

    await navigation.getByRole("button", { name: "项目/文件" }).click();
    await expect(
      page.getByRole("heading", { name: "项目与文件" }),
    ).toBeVisible();
    await expect(page.locator(".terminal-view")).toHaveCount(0);
  });

  test("browses project files and reads a scrollable Markdown document without mounting a terminal", async ({
    page,
  }) => {
    const modifiedAt = "2026-08-16T08:00:00.000Z";
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route("**/api/agent-sessions", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          activeAgentSessionId: "mobile-files",
          items: [
            {
              id: "mobile-files",
              workspaceId: "default",
              sourceType: "local",
              agentKind: "codex",
              displayName: "Mobile Files",
              projectName: "Kanban",
              repositoryRoot: "/workspace/kanban",
              workingDirectory: "/workspace/kanban",
              connectionState: "online",
              interactionState: "idle",
            },
          ],
          updatedAt: modifiedAt,
        }),
      });
    });
    await page.route("**/api/fs/list", async (route) => {
      const body = route.request().postDataJSON() as { path: string };
      const nested = body.path === "/workspace/kanban/docs";
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          path: body.path,
          entries: nested
            ? [
                {
                  name: "guide.md",
                  path: "/workspace/kanban/docs/guide.md",
                  type: "file",
                  size: 18,
                  modifiedAt,
                  owner: "codex",
                  permissions: "-rw-r--r--",
                  isHidden: false,
                },
              ]
            : [
                {
                  name: "docs",
                  path: "/workspace/kanban/docs",
                  type: "directory",
                  size: 0,
                  modifiedAt,
                  owner: "codex",
                  permissions: "drwxr-xr-x",
                  isHidden: false,
                },
              ],
        }),
      });
    });
    await page.route("**/api/fs/preview", async (route) => {
      const body = route.request().postDataJSON() as { offset?: number };
      const offset = body.offset ?? 0;
      const paragraphs = Array.from(
        { length: 40 },
        (_, index) => `第 ${index + 1} 段：手机端 Markdown 阅读内容。`,
      ).join("\n\n");
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          path: "/workspace/kanban/docs/guide.md",
          content:
            offset === 0
              ? `# Mobile file view\n\n${paragraphs}`
              : "# Second window\n\n这是按需读取的下一段。",
          encoding: "utf8",
          truncated: offset === 0,
          size: 131_072,
          mimeType: "text/markdown",
          offset,
          bytesRead: 65_536,
          previousOffset: offset === 0 ? null : 0,
          nextOffset: offset === 0 ? 65_536 : null,
        }),
      });
    });

    await page.goto("/?view=mobile");
    await page
      .getByRole("navigation", { name: "手机端主导航" })
      .getByRole("button", { name: "项目/文件" })
      .click();
    await page.getByRole("button", { name: "浏览文件" }).click();

    await expect(
      page.getByRole("region", { name: "手机文件系统" }),
    ).toBeVisible();
    await page.locator(".mobile-file-entry", { hasText: "docs" }).click();
    await expect(page.locator(".mobile-file-browser-pathbar")).toContainText(
      "/workspace/kanban/docs",
    );
    await page.locator(".mobile-file-entry", { hasText: "guide.md" }).click();

    await expect(
      page.getByRole("region", { name: "手机文件预览" }),
    ).toBeVisible();
    await expect(
      page
        .getByTestId("mobile-markdown-preview")
        .getByRole("heading", { name: "Mobile file view" }),
    ).toBeVisible();
    const previewSurface = page.locator(".mobile-file-preview-content");
    const previewOptionsButton = page.getByRole("button", {
      name: "展开文件选项",
    });
    await expect(previewOptionsButton).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await expect(
      page.getByRole("group", { name: "Markdown 查看方式" }),
    ).toHaveCount(0);
    await expect(page.getByRole("button", { name: "下一段" })).toHaveCount(0);
    await previewOptionsButton.click();
    await expect(
      page.getByRole("button", { name: "收起文件选项" }),
    ).toHaveAttribute("aria-expanded", "true");
    const markdownViewMode = page.getByRole("group", {
      name: "Markdown 查看方式",
    });
    const renderedModeButton = markdownViewMode.getByRole("button", {
      name: "渲染",
    });
    const sourceModeButton = markdownViewMode.getByRole("button", {
      name: "源码",
    });
    await expect(renderedModeButton).toHaveAttribute("aria-pressed", "true");
    await sourceModeButton.click();
    await expect(sourceModeButton).toHaveAttribute("aria-pressed", "true");
    await expect(previewSurface.locator("pre")).toContainText(
      "# Mobile file view",
    );
    await expect(page.getByTestId("mobile-markdown-preview")).toHaveCount(0);
    await renderedModeButton.click();
    await expect(
      page
        .getByTestId("mobile-markdown-preview")
        .getByRole("heading", { name: "Mobile file view" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "收起文件选项" }).click();
    await expect(
      page.getByRole("button", { name: "展开文件选项" }),
    ).toHaveAttribute("aria-expanded", "false");
    await expect(markdownViewMode).toHaveCount(0);
    await page.getByRole("button", { name: "展开文件选项" }).click();
    await expect
      .poll(() =>
        previewSurface.evaluate(
          (element) => element.scrollHeight > element.clientHeight,
        ),
      )
      .toBe(true);
    await previewSurface.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect
      .poll(() => previewSurface.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0);
    const nextWindowButton = page.getByRole("button", { name: "下一段" });
    await expect(nextWindowButton).toBeInViewport();
    await sourceModeButton.click();
    await nextWindowButton.click();
    await expect(sourceModeButton).toHaveAttribute("aria-pressed", "true");
    await expect(previewSurface.locator("pre")).toContainText(
      "# Second window",
    );
    await renderedModeButton.click();
    await expect(
      page
        .getByTestId("mobile-markdown-preview")
        .getByRole("heading", { name: "Second window" }),
    ).toBeVisible();
    await expect(page.getByText("64.0 KB–128.0 KB / 128.0 KB")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Mobile file view" }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "上一段" }).click();
    await expect(
      page
        .getByTestId("mobile-markdown-preview")
        .getByRole("heading", { name: "Mobile file view" }),
    ).toBeVisible();
    await expect(page.locator(".terminal-view")).toHaveCount(0);
  });
});
