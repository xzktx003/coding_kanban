import { expect, test } from "@playwright/test";
import { setup } from "./session-composer-v2-fixture";

test("a focused user message exposes its controls when the message is hovered", async ({
  page,
}) => {
  test.setTimeout(60000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const fixture = await setup(page, false, async (data) => {
    data.threads[0].turns = [
      {
        id: "hover-turn",
        status: "completed",
        items: [
          {
            id: "hover-user",
            type: "userMessage",
            content: [
              {
                type: "text",
                text: "Hover this user message",
                text_elements: [],
              },
            ],
          },
          { id: "hover-answer", type: "agentMessage", text: "Done" },
        ],
      },
    ] as never;
  });
  try {
    const message = page.locator(".codex-native-user").first();
    await expect(message).toBeVisible();
    await page.bringToFront();
    await expect
      .poll(() => page.evaluate(() => document.hasFocus()))
      .toBe(true);
    await page.locator(".session-mode nav").first().hover();
    const controls = message.locator(".codex-message-native-actions");
    await expect(controls).toHaveClass(/group-hover:visible/);
    await expect
      .poll(() =>
        controls.evaluate((element) => getComputedStyle(element).visibility),
      )
      .toBe("hidden");
    await message.hover();
    await expect(
      controls.getByRole("button", { name: "复制消息", exact: true }),
    ).toBeVisible();
    await page.locator(".session-mode nav").first().hover();
    await expect
      .poll(() =>
        controls.evaluate((element) => getComputedStyle(element).visibility),
      )
      .toBe("hidden");
    expect(fixture.errors).toEqual([]);
    expect(fixture.calls).toEqual([]);
  } finally {
    await fixture.close();
  }
});
