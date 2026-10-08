import { expect, type Page } from "@playwright/test";

export async function composerAction(
  page: Page,
  name: string | RegExp,
  timeout = 5000,
) {
  const action = page.getByRole("button", {
    name,
    exact: typeof name === "string",
  });
  if (!(await action.isVisible()))
    await page
      .getByRole("button", { name: "添加附件与上下文", exact: true })
      .click();
  await expect(action).toBeVisible();
  await action.click({ timeout });
}
export async function openComposerStatus(page: Page) {
  await composerAction(page, "输入状态与消息队列");
}
export async function openQuestions(page: Page) {
  const panel = page.locator("[data-session-async-panel]");
  if (await panel.isVisible()) return;
  try {
    await composerAction(page, /^回答问题 · /, 1000);
  } catch (error) {
    if (!(await panel.isVisible())) throw error;
  }
}
