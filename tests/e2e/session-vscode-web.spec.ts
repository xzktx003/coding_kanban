import { expect, test } from "@playwright/test";

test("session project actions offer VS Code Web and open the selected project in a browser tab", async ({
  page,
  context,
}) => {
  await context.route("**/vscode/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<title>Editor fixture</title><p>VS Code Web fixture</p>",
    }),
  );
  let openedPath = "";
  await page.route("**/api/workbench/vscode-web", (route) => {
    openedPath = route.request().postDataJSON().path;
    return route.fulfill({
      json: {
        url: `${new URL(page.url()).origin}/vscode/?folder=${encodeURIComponent(openedPath)}`,
        provider: "code-server",
        workingDirectory: openedPath,
        reused: true,
      },
    });
  });
  await page.goto("/?mode=session");
  const button = page.getByRole("button", {
    name: "在 VS Code Web 中打开当前项目",
    exact: true,
  });
  await expect(button).toBeVisible({ timeout: 30000 });
  await page.evaluate(async () => {
    const { useWorkspaceStore } =
      await import("/src/session-mode/stores/useWorkspaceStore.ts");
    // Change only browser state; no server settings or Agent calls.
    useWorkspaceStore.setState({ cwd: "/fixture/project with spaces" });
  });
  const actions = page.locator(".session-agent-header-actions");
  for (const label of ["Run", "Publish", "Open in"]) {
    await expect(
      actions.getByRole("button", { name: label, exact: true }),
    ).toHaveCount(0);
  }
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(button).toBeInViewport();
  }
  const popupPromise = page.waitForEvent("popup");
  await button.click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL(/\/vscode\/\?folder=/);
  expect(openedPath).toBe("/fixture/project with spaces");
  await expect(popup.locator("p")).toHaveText("VS Code Web fixture");
  expect(await popup.evaluate(() => window.opener === null)).toBe(true);
  await popup.close();
});

test("session editor startup failures are visible and allow retry", async ({
  page,
}) => {
  await page.route("**/api/workbench/vscode-web", (route) =>
    route.fulfill({ status: 503, json: { error: "VS Code Web 测试启动失败" } }),
  );
  await page.goto("/?mode=session");
  const button = page.getByRole("button", {
    name: "在 VS Code Web 中打开当前项目",
    exact: true,
  });
  await expect(button).toBeVisible({ timeout: 30000 });
  const popupPromise = page.waitForEvent("popup");
  await button.click();
  const popup = await popupPromise;
  await expect(page.getByRole("alert")).toContainText(
    "VS Code Web 测试启动失败",
  );
  await expect(button).toBeEnabled();
  await expect.poll(() => popup.isClosed()).toBe(true);
});
