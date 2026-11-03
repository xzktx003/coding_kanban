import { expect, test } from "@playwright/test";
import { setup } from "./session-composer-v2-fixture";

test.describe.configure({ timeout: 90_000 });

for (const width of [1440, 390]) {
  test(`inserting a skill does not add an artificial line height (${width})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const fixture = await setup(page, false, async (mock) => {
      await page.route("**/codex/skills/list", (route) =>
        route.fulfill({
          json: {
            data: [
              {
                cwd: mock.threads[0].cwd,
                errors: [],
                skills: [
                  {
                    name: "fixture-skill",
                    path: "/fixture/skill/SKILL.md",
                    description: "Fixture skill",
                    enabled: true,
                    scope: "user",
                    interface: {
                      displayName: "fixture-skill",
                      iconSmallUrl:
                        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
                      brandColor: "#4e82c4",
                    },
                  },
                ],
              },
            ],
          },
        }),
      );
    });
    try {
      const frame = page
        .locator(".session-codex-composer .session-compact-frame")
        .first();
      const editor = frame.locator("[contenteditable=true]").first();
      await editor.fill("第一行内容\n第二行内容\n第三行内容 ");
      await editor.press("End");
      await editor.pressSequentially("$fixture");
      const option = page
        .locator('[data-composer-suggestions="mentions"]')
        .getByRole("option", { name: /fixture-skill/ });
      await expect(option).toBeVisible();
      const before = {
        frame: (await frame.boundingBox())!,
        scrollHeight: await editor.evaluate((element) => element.scrollHeight),
      };
      await option.click();
      const chip = editor.locator("[data-lexical-decorator]");
      await expect(chip).toContainText("fixture-skill");
      const after = {
        frame: (await frame.boundingBox())!,
        scrollHeight: await editor.evaluate((element) => element.scrollHeight),
      };
      expect(
        Math.abs(after.frame.height - before.frame.height),
      ).toBeLessThanOrEqual(1);
      expect(
        Math.abs(after.scrollHeight - before.scrollHeight),
      ).toBeLessThanOrEqual(1);
      await page.screenshot({
        path: test.info().outputPath("skill-draft.png"),
      });
      await editor.pressSequentially("$fixture");
      await option.click();
      await expect(chip).toHaveCount(2);
      expect(
        Math.abs((await frame.boundingBox())!.height - before.frame.height),
      ).toBeLessThanOrEqual(1);
      expect(
        Math.abs(
          (await editor.evaluate((element) => element.scrollHeight)) -
            before.scrollHeight,
        ),
      ).toBeLessThanOrEqual(1);
      expect(fixture.errors).toEqual([]);
    } finally {
      await fixture.close();
    }
  });
}

test("skill insertion, atomic deletion, draft restore and submit keep the exact token", async ({
  page,
}) => {
  const fixture = await setup(page, false, async (mock) => {
    await page.route("**/codex/skills/list", (route) =>
      route.fulfill({
        json: {
          data: [
            {
              cwd: mock.threads[0].cwd,
              errors: [],
              skills: [
                {
                  name: "fixture-skill",
                  path: "/fixture/skill/SKILL.md",
                  description: "Fixture",
                  enabled: true,
                  scope: "user",
                  interface: null,
                },
              ],
            },
          ],
        },
      }),
    );
  });
  const submissions: Array<{ threadId?: string; text?: string }> = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.endsWith("/followups/submit"))
      submissions.push(request.postDataJSON());
  });
  try {
    const editor = page
      .locator(".session-codex-composer [contenteditable=true]")
      .first();
    const draft = () =>
      page.evaluate(async () => {
        const path = "/src/session-mode/stores/useSessionDraftStore.ts";
        const url =
          performance
            .getEntriesByType("resource")
            .findLast((entry) => new URL(entry.name).pathname === path)?.name ??
          path;
        const { readDraft, sessionDraftKey } = await import(url);
        return readDraft(sessionDraftKey("codex", "ux-0")).text;
      });
    const insert = async () => {
      await editor.pressSequentially("$fixture");
      await page
        .locator('[data-composer-suggestions="mentions"]')
        .getByRole("option", { name: /fixture-skill/ })
        .click();
      await expect(editor.locator("[data-lexical-decorator]")).toHaveCount(1);
    };
    await editor.fill("保留文字 ");
    await editor.press("End");
    await insert();
    await expect.poll(draft).toBe("保留文字 $fixture-skill ");
    await editor.press("Backspace");
    await editor.press("Backspace");
    await expect(editor.locator("[data-lexical-decorator]")).toHaveCount(0);
    await expect.poll(draft).toBe("保留文字 ");
    await insert();
    await expect.poll(draft).toBe("保留文字 $fixture-skill ");
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(editor).toContainText("fixture-skill");
    await expect.poll(draft).toBe("保留文字 $fixture-skill ");
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    await expect.poll(() => submissions.length).toBe(1);
    expect(submissions[0]).toMatchObject({
      threadId: "ux-0",
      text: "保留文字 $fixture-skill",
    });
    expect(fixture.errors).toEqual([]);
  } finally {
    await fixture.close();
  }
});
