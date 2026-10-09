import { expect, test } from "@playwright/test";
import { setup } from "./session-composer-v2-fixture";

test("approval-for-me reaches the queued native turn without expanding permissions", async ({
  page,
}) => {
  const f = await setup(page);
  try {
    await page.locator(".session-access-trigger").first().click();
    await page.getByRole("menuitem", { name: "请示批准", exact: true }).click();
    await expect(page.getByRole("menu")).toHaveCount(0);
    await page
      .getByRole("button", { name: "执行权限：请示批准", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "替我批准", exact: true }).click();
    const editor = page
      .locator(".session-composer-editor [contenteditable=true]")
      .first();
    await editor.fill("自动审查参数回归");
    await page.getByRole("button", { name: "排队消息", exact: true }).click();
    await expect
      .poll(async () => (await f.queue.get("ux-0")).items.length)
      .toBe(1);
    const parameters = (await f.queue.get("ux-0")).items[0].parameters;
    expect(parameters).toMatchObject({
      approvalsReviewer: "auto_review",
      approvalPolicy: "on-request",
      sandboxPolicy: { type: "workspaceWrite" },
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
