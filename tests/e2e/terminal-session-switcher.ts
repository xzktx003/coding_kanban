import { expect, type Locator, type Page } from "@playwright/test";

export async function selectTerminalPaneSession(
  page: Page,
  pane: Locator,
  sessionId: string,
): Promise<void> {
  await pane.getByRole("combobox").click();
  const option = page.locator(
    `[data-terminal-switch-session-id="${sessionId}"]`,
  );
  await expect(option).toBeVisible();
  await option.click();
}
