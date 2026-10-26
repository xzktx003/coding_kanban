import { expect, test } from "@playwright/test";
import { setup } from "./session-composer-v2-fixture";
import type { ThreadSettingsUpdatedNotification } from "../../apps/web/src/session-mode/bindings/v2";

test("approval-for-me reaches the queued native turn without expanding permissions", async ({
  page,
}) => {
  const f = await setup(page);
  try {
    await page.locator(".session-access-trigger").first().click();
    await expect(
      page.getByRole("menuitemradio", { name: /^帮我批准/ }),
    ).toBeDisabled();
    await page.keyboard.press("Escape");

    const settings: ThreadSettingsUpdatedNotification = {
      threadId: "ux-0",
      threadSettings: {
        cwd: f.fixture.threads[0].cwd,
        model: "fixture-model",
        modelProvider: "openai",
        approvalsReviewer: "auto_review",
        approvalPolicy: "on-request",
        sandboxPolicy: {
          type: "workspaceWrite",
          writableRoots: [],
          networkAccess: false,
          excludeTmpdirEnvVar: false,
          excludeSlashTmp: false,
        },
        activePermissionProfile: null,
        serviceTier: null,
        effort: "medium",
        summary: null,
        collaborationMode: {
          mode: "default",
          settings: {
            model: "fixture-model",
            reasoning_effort: "medium",
            developer_instructions: null,
          },
        },
        multiAgentMode: "explicitRequestOnly",
        personality: null,
      },
    };
    // The default fixture closes each SSE response. Its next ordinary reconnect
    // receives the native notification through the mounted EventSource handler.
    // Replay uses the same sequence, so reconnects cannot overwrite user choices.
    await page.route(/\/api\/session\/api\/events(?:\?.*)?$/, async (route) => {
      await route.fulfill({
        contentType: "text/event-stream",
        body: `data: ${JSON.stringify({
          seq: 1,
          event: "codex:notification",
          payload: { method: "thread/settings/updated", params: settings },
        })}\n\n`,
      });
    });
    // This becomes available only after authoritative native capability hydration.
    await page
      .getByRole("button", { name: "执行权限：帮我批准", exact: true })
      .click();
    await page.getByRole("menuitemradio", { name: /^请求批准/ }).click();
    await expect(page.getByRole("menu")).toHaveCount(0);
    await page
      .getByRole("button", { name: "执行权限：请求批准", exact: true })
      .click();
    const autoReview = page.getByRole("menuitemradio", { name: /^帮我批准/ });
    await expect(autoReview).toBeEnabled();
    await autoReview.click();
    const editor = page
      .locator(".session-composer-editor [contenteditable=true]")
      .first();
    await editor.fill("自动审查参数回归");
    const composer = page.locator(
      '.session-agent-view .session-codex-composer[data-owner-thread="ux-0"]',
    );
    await expect(composer).toHaveCount(1);
    await expect(
      page.getByRole("status", { name: "本轮结束后发送", exact: true }),
    ).toBeVisible();
    await composer.getByRole("button", { name: "发送消息", exact: true }).click();
    await expect
      .poll(async () => (await f.queue.get("ux-0")).items.length)
      .toBe(1);
    const parameters = (await f.queue.get("ux-0")).items[0].parameters;
    expect(parameters).toMatchObject({
      approvalsReviewer: "auto_review",
      approvalPolicy: "on-request",
      sandboxPolicy: { type: "workspaceWrite", networkAccess: false },
    });
    await f.event("turn/completed", "initial-turn", "completed");
    await f.queue.tick();
    expect(
      f.calls.find((c) => c.method === "turn/start")?.params,
    ).toMatchObject(parameters);
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
  }
});
