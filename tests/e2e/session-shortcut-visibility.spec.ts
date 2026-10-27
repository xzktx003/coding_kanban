import { expect, test, type Locator, type Page } from "@playwright/test";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";

const activate = (page: Page, target: Locator) =>
  page.viewportSize()?.width === 390 ? target.tap() : target.click();

async function settings(page: Page, theme: string) {
  // Includes Terminal APIs and WebSockets: switching modes cannot attach a
  // formal PTY or submit anything to the running Session service.
  const fixture = await installSessionUxFixture(page, 1);
  await page.goto("/?mode=session&view=agent");
  await page
    .locator(".session-codex-composer [contenteditable=true]")
    .first()
    .waitFor();
  await seedSessionUx(page, 1);
  await page.evaluate(async (theme) => {
    const load = (path: string) =>
      import(
        performance
          .getEntriesByType("resource")
          .findLast((entry) => new URL(entry.name).pathname === path)?.name ??
          path
      );
    const [
      { useAgentCenterStore },
      { useThemeStore },
      { useSessionDraftStore, sessionDraftKey },
    ] = await Promise.all([
      load("/src/session-mode/stores/useAgentCenterStore.ts"),
      load("/src/session-mode/stores/settings/useThemeStore.ts"),
      load("/src/session-mode/stores/useSessionDraftStore.ts"),
    ]);
    useAgentCenterStore.getState().addAgentCard(
      {
        kind: "codex",
        id: "ux-0",
        cwd: "/fixture/项目/very-long-project-path-for-ui-regression",
      },
      { activate: true },
    );
    useThemeStore.getState().setTheme(theme);
    useSessionDraftStore
      .getState()
      .setText(sessionDraftKey("codex", "ux-0"), "Keep shortcut owner draft");
  }, theme);
  const navigation = page.locator(".session-top-nav");
  const settingsButton = navigation.getByRole("button", {
    name: "设置",
    exact: true,
  });
  if (await settingsButton.isVisible()) await activate(page, settingsButton);
  else {
    await activate(
      page,
      navigation.getByRole("button", { name: "更多功能", exact: true }),
    );
    await activate(
      page,
      page.getByRole("menuitem", { name: "设置", exact: true }),
    );
  }
  await expect(
    page.locator(".session-secondary-header [data-session-page-heading]"),
  ).toHaveText("设置");
  return fixture;
}

for (const width of [1440, 390])
  for (const theme of ["light", "dark"]) {
    test.describe(`${width}px ${theme} shortcuts`, () => {
      test.use({
        viewport: { width, height: 844 },
        hasTouch: width === 390,
        isMobile: width === 390,
      });
      test("hidden Settings ignores new shortcuts and visible Settings still accepts them", async ({
        page,
      }, info) => {
        const fixture = await settings(page, theme);
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        const mode = () => page.getByRole("group", { name: "工作模式" });
        await activate(
          page,
          mode().getByRole("button", { name: "终端", exact: true }),
        );
        await expect(
          page.locator(".workbench-terminal .app-shell-v2"),
        ).toBeVisible();
        const prevented = await page.evaluate(() => {
          const event = new KeyboardEvent("keydown", {
            key: "/",
            ctrlKey: true,
            bubbles: true,
            cancelable: true,
          });
          document
            .querySelector(".session-secondary-header button")!
            .dispatchEvent(event);
          window.dispatchEvent(new Event("codex-open-keyboard-shortcuts"));
          return event.defaultPrevented;
        });
        await activate(
          page,
          mode().getByRole("button", { name: "会话", exact: true }),
        );
        await expect(
          page.locator(".session-secondary-header [data-session-page-heading]"),
        ).toHaveText("设置");
        const sheet = page.getByRole("dialog", {
          name: "键盘快捷方式",
          exact: true,
        });
        try {
          await expect(sheet).toHaveCount(0);
          expect(prevented).toBe(false);
          await page
            .getByRole("button", { name: "返回会话", exact: true })
            .focus();
          await page.keyboard.press("Control+/");
          await expect(sheet).toBeVisible();
          await page.screenshot({
            path: info.outputPath("visible-settings-shortcuts.png"),
            fullPage: true,
          });
          await page.keyboard.press("Escape");
          await expect(sheet).toHaveCount(0);
          await activate(
            page,
            page.getByRole("button", { name: "返回会话", exact: true }),
          );
          await expect(
            page
              .locator(".session-codex-composer [contenteditable=true]")
              .first(),
          ).toContainText("Keep shortcut owner draft");
          expect(errors).toEqual([]);
          expect(
            fixture.calls.filter(({ path }) =>
              /\/(turn\/(start|steer|interrupt)|thread\/(resume|acquire|start)|followups\/(submit|change|stop))$/.test(
                path,
              ),
            ),
          ).toEqual([]);
        } finally {
          await page.screenshot({
            path: info.outputPath("settings-result.png"),
            fullPage: true,
          });
        }
      });
    });
  }
