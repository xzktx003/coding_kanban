import { expect, test } from "@playwright/test";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";

for (const width of [375, 1440]) {
  test(`Codex native questions navigate, retry, restore on refresh and resolve on another device (${width}px)`, async ({
    browser,
  }) => {
    test.setTimeout(90_000);
    const first = await browser.newContext({
      viewport: { width, height: 900 },
      ignoreHTTPSErrors: true,
    });
    const second = await browser.newContext({
      viewport: { width: 390, height: 844 },
      ignoreHTTPSErrors: true,
    });
    let pending = true,
      fail = true;
    const responses: unknown[] = [];
    const question = {
      requestId: "question-rpc",
      threadId: "ux-0",
      turnId: "question-turn",
      itemId: "question-item",
      questions: [
        {
          id: "weekend",
          header: "周末",
          question: "周末有一整天空闲，你更想怎么过？",
          isOther: true,
          isSecret: false,
          options: [
            { label: "出门逛逛", description: "看看附近的新地方" },
            { label: "在家休息", description: "留一些安静的时间" },
            { label: "约朋友见面", description: "一起吃饭聊天" },
          ],
        },
        {
          id: "detail",
          header: "补充",
          question: "还有什么偏好？",
          isOther: true,
          isSecret: false,
          options: null,
        },
      ],
    };
    try {
      const pages = [await first.newPage(), await second.newPage()];
      for (const page of pages) {
        await installSessionUxFixture(page, 1);
        await page.route("**/api/events**", (route) =>
          route.fulfill({
            contentType: "text/event-stream",
            body: `data: ${JSON.stringify({ seq: 1, event: "codex/user-input-snapshot", payload: { requests: pending ? [question] : [] } })}\n\n`,
          }),
        );
        await page.route("**/api/codex/approval/user-input", async (route) => {
          if (fail) {
            fail = false;
            await route.fulfill({
              status: 503,
              json: { error: "temporary offline" },
            });
            return;
          }
          responses.push(route.request().postDataJSON());
          pending = false;
          await route.fulfill({ status: 200, body: "" });
        });
        await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
        await page
          .locator(".session-mode [contenteditable=true]")
          .first()
          .waitFor();
        await seedSessionUx(page, 1);
        await page.evaluate(async () => {
          const { useAgentCenterStore } = await import(
            performance
              .getEntriesByType("resource")
              .findLast((e) =>
                e.name.includes(
                  "/src/session-mode/stores/useAgentCenterStore.ts",
                ),
              )?.name ?? "/src/session-mode/stores/useAgentCenterStore.ts"
          );
          useAgentCenterStore.getState().addAgentCard({
            kind: "codex",
            id: "ux-0",
            preview: "中文会话 0",
            cwd: "/fixture/项目/very-long-project-path-for-ui-regression",
          });
        });
      }
      const page = pages[0],
        other = pages[1];
      const form = page.locator("[data-session-user-question]");
      await expect(form.getByRole("radio", { name: /出门逛逛/ })).toBeVisible();
      await expect(other.locator("[data-session-user-question]")).toBeVisible();
      await page.reload({ waitUntil: "domcontentloaded" });
      await page
        .locator(".session-mode [contenteditable=true]")
        .first()
        .waitFor();
      await seedSessionUx(page, 1);
      await page.evaluate(async () => {
        const { useAgentCenterStore } = await import(
          performance
            .getEntriesByType("resource")
            .findLast((e) =>
              e.name.includes(
                "/src/session-mode/stores/useAgentCenterStore.ts",
              ),
            )?.name ?? "/src/session-mode/stores/useAgentCenterStore.ts"
        );
        useAgentCenterStore.getState().addAgentCard({
          kind: "codex",
          id: "ux-0",
          preview: "中文会话 0",
          cwd: "/fixture/项目/very-long-project-path-for-ui-regression",
        });
      });
      await expect(form.getByRole("radio", { name: /出门逛逛/ })).toBeVisible();
      await form.getByRole("radio", { name: /出门逛逛/ }).click();
      expect(responses).toHaveLength(0);
      await form.getByRole("button", { name: "下一步" }).click();
      await form.getByPlaceholder("请输入你的回答").fill("喜欢安静，也想走走");
      await form.getByRole("button", { name: "上一题" }).click();
      await expect(
        form.getByRole("radio", { name: /出门逛逛/ }),
      ).toHaveAttribute("aria-checked", "true");
      await page.screenshot({
        path: `.dev-runtime/user-input-${width}.png`,
        fullPage: true,
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      await form.getByRole("button", { name: "下一步" }).click();
      await form.getByRole("button", { name: "提交回答" }).click();
      await expect(form.getByRole("alert")).toContainText("提交失败");
      await expect(form.getByPlaceholder("请输入你的回答")).toHaveValue(
        "喜欢安静，也想走走",
      );
      await form.getByRole("button", { name: "提交回答" }).click();
      await expect(form).toHaveCount(0);
      await expect(other.locator("[data-session-user-question]")).toHaveCount(
        0,
      );
      expect(responses).toEqual([
        {
          request_id: "question-rpc",
          response: {
            answers: {
              weekend: { answers: ["出门逛逛"] },
              detail: { answers: ["喜欢安静，也想走走"] },
            },
          },
        },
      ]);
    } finally {
      await Promise.allSettled([first.close(), second.close()]);
    }
  });
}
