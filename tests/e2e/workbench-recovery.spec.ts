import { expect, test } from "@playwright/test";
import { installSessionUxFixture } from "./session-ux-fixture";

for (const width of [375, 1440]) {
  test(`explicit reload recovers a rejected Session module without dispatching tasks (${width}px)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await installSessionUxFixture(page, 1);
    await page.addInitScript(() => {
      if (!localStorage.getItem("workbench-recovery-draft"))
        localStorage.setItem("workbench-recovery-draft", "preserved draft");
    });
    let failed = false;
    let documents = 0;
    const writes: string[] = [];
    page.on("request", (request) => {
      if (request.isNavigationRequest() && request.frame() === page.mainFrame())
        documents++;
      const path = new URL(request.url()).pathname;
      if (
        /\/codex\/(?:turn\/(?:start|steer|interrupt)|thread\/(?:resume|start))$/.test(
          path,
        )
      )
        writes.push(path);
    });
    await page.route(
      (url) => url.pathname.endsWith("/SessionWorkbench.tsx"),
      async (route) => {
        if (!failed) {
          failed = true;
          await route.fulfill({
            status: 503,
            contentType: "text/javascript",
            body: "",
          });
        } else await route.continue();
      },
    );
    await page.goto("/?mode=session");
    await expect(
      page.getByRole("heading", { name: "会话界面加载失败" }),
    ).toBeVisible();
    await page.getByText("错误详情", { exact: true }).click();
    await expect(page.locator(".workbench-error-details pre")).toContainText(
      /module|import/i,
    );
    expect(documents).toBe(1);
    await page
      .getByRole("button", { name: "重新加载界面", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "会话", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "会话界面加载失败" }),
    ).toHaveCount(0);
    expect(documents).toBe(2);
    expect(
      await page.evaluate(() =>
        localStorage.getItem("workbench-recovery-draft"),
      ),
    ).toBe("preserved draft");
    expect(writes).toEqual([]);
  });
}
