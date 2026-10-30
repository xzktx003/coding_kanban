import { expect, test, type Locator } from "@playwright/test";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";
import { liveStream } from "./session-sse-fixture";
test("narrow navigation retains full touch targets, theme and sync actions without overflow", async ({
  page,
  baseURL,
}, info) => {
  test.setTimeout(90_000);
  const fixture = await installSessionUxFixture(page, 2),
    stream = await liveStream(page, baseURL!);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const nav = page.getByRole("navigation", { name: "会话工作台导航" });
  const bounds = async (control: Locator, width: number) => {
    await expect
      .poll(async () => {
        const rect = await control.boundingBox();
        return (
          !!rect &&
          rect.x >= 0 &&
          rect.x + rect.width <= width &&
          rect.width >= (width <= 1000 ? 44 : 32) &&
          rect.height >= (width <= 1000 ? 44 : 32)
        );
      })
      .toBe(true);
  };
  const samples: unknown[] = [];
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/?mode=session");
    await seedSessionUx(page, 2);
    await page.locator('.session-nav-row[role="button"]').first().click();
    const editor = page.locator(
      ".session-codex-composer [contenteditable=true]",
    );
    await editor.fill("keep navigation draft");
    await expect.poll(() => stream.connections()).toBeGreaterThan(0);
    stream.named("session-projection-error", {
      error: "bounded fixture projection paused",
    });
    for (const [width, height] of [
      [320, 852],
      [393, 852],
      [768, 393],
      [932, 430],
      [1440, 1000],
    ]) {
      await page.setViewportSize({ width, height });
      const more = nav.getByRole("button", { name: "更多功能", exact: true }),
        project = nav.locator(".session-global-projects");
      await bounds(more, width);
      await bounds(project, width);
      if (width <= 1000)
        for (const label of ["会话", "终端", "Codex"])
          await bounds(
            nav
              .getByRole("group", { name: "工作模式" })
              .getByRole("button", { name: label, exact: true }),
            width,
          );
      if (width < 768) {
        await expect(nav.locator(".session-theme-toggle")).toHaveCount(0);
        await expect(nav.locator(".session-sync-indicator")).toHaveCount(0);
        await expect(more).toHaveAttribute("data-attention", "true");
        await more.click();
        const menu = page.getByRole("menu").last();
        const theme = menu.getByRole("menuitem", { name: /切换为.*色模式/ });
        await expect(theme).toBeInViewport();
        const wasDark = await page
          .locator(".session-mode")
          .evaluate((el) => el.classList.contains("dark"));
        await theme.click();
        await expect
          .poll(() =>
            page
              .locator(".session-mode")
              .evaluate((el) => el.classList.contains("dark")),
          )
          .toBe(!wasDark);
        await more.click();
        await page.getByRole("menuitem", { name: /实时接收已暂停/ }).click();
        await expect(
          page.getByRole("button", { name: "重试接收消息", exact: true }),
        ).toBeInViewport();
        await page.keyboard.press("Escape");
        await expect(
          page.getByLabel("会话同步详情", { exact: true }),
        ).toHaveCount(0);
        await page.keyboard.press("Escape");
        await expect(page.getByRole("menu")).toHaveCount(0);
      }
      await expect(editor).toHaveText("keep navigation draft");
      samples.push({
        width,
        height,
        nav: await nav.boundingBox(),
        more: await more.boundingBox(),
        project: await project.boundingBox(),
      });
    }
    expect(errors).toEqual([]);
    expect(
      fixture.calls.filter((call) =>
        /\/turn\/(start|interrupt)$|\/thread\/(resume|start)$|\/followups\/submit$/.test(
          call.path,
        ),
      ),
    ).toEqual([]);
    await info.attach("narrow-navigation.json", {
      contentType: "application/json",
      body: JSON.stringify({ samples, errors }),
    });
  } finally {
    await stream.close();
  }
});
