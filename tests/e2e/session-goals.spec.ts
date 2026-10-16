import { expect, test } from "@playwright/test";
import { fixtureGoal } from "./session-goal-fixture";

test("Goal replacement is explicit, preserves the captured draft, and never starts a normal turn", async ({
  page,
}) => {
  const f = await fixtureGoal(page);
  const editor = page
    .locator(".session-codex-composer [contenteditable=true]")
    .first();
  await editor.fill("/goal 另一个目标");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "替换当前目标吗？" });
  await expect(dialog).toContainText("另一个目标");
  expect(f.writes).toEqual([]);
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(editor).toHaveText("/goal 另一个目标");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await dialog.getByRole("button", { name: "替换目标", exact: true }).click();
  await expect(page.locator(".session-thread-goal")).toContainText(
    "另一个目标",
  );
  await expect(page.locator("[data-goal-announcement]")).toHaveText(
    "/goal 另一个目标",
  );
  await expect(
    page
      .locator("[data-goal-announcement]")
      .getByRole("button", { name: /编辑|回滚/ }),
  ).toHaveCount(0);
  await expect(editor).toHaveText("");
  expect(f.writes).toEqual([
    {
      action: "set",
      body: { threadId: "ux-0", objective: "另一个目标", status: "active" },
    },
  ]);
  expect(
    f.fixture.calls.filter((call) =>
      /\/(?:turn\/start|turn\/steer|turn\/interrupt|followups\/submit)$/.test(
        call.path,
      ),
    ),
  ).toEqual([]);
});

test("An accepted first /goal turn keeps its objective files when the later GoalSet is rejected", async ({
  page,
}) => {
  const f = await fixtureGoal(page, { count: 0, goal: null });
  const errors: string[] = [];
  const notices: string[] = [];
  page.on("console", (event) => {
    if (event.type() === "error") errors.push(event.text().slice(0, 300));
  });
  await page.evaluate(() => {
    (window as any).__goalTestNotices = [];
    new MutationObserver(() => {
      for (const notice of document.querySelectorAll(
        "[data-sonner-toast], [role=alert]",
      )) {
        const text = notice.textContent ?? "";
        if (text && !(window as any).__goalTestNotices.includes(text))
          (window as any).__goalTestNotices.push(text);
      }
    }).observe(document.body, { childList: true, subtree: true });
  });
  const files: string[] = [];
  const objective =
    "Read the Codex goal objective file at /fixture/attachments/11111111-1111-4111-8111-111111111111/goal-objective.md before continuing.";
  await page.route("**/api/session/goal-attachments/*", async (route) => {
    const action = new URL(route.request().url()).pathname.split("/").at(-1)!;
    files.push(action);
    await route.fulfill({
      json:
        action === "materialize"
          ? {
              objective,
              cleanup: {
                id: "11111111-1111-4111-8111-111111111111",
                token: "a".repeat(64),
              },
            }
          : { ok: true },
    });
  });
  f.failNext("set");
  const editor = page
    .locator(".session-codex-composer [contenteditable=true]")
    .first();
  await editor.fill(`/goal ${"待验收目标".repeat(900)}`);
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect
    .poll(() => f.writes.length)
    .toBe(1)
    .catch(async (error) => {
      notices.push(
        ...(await page.evaluate(() => (window as any).__goalTestNotices ?? [])),
      );
      throw new Error(
        `${error}\n${JSON.stringify({ files, errors, notices, calls: f.fixture.calls.filter((call) => /thread\/(?:start|access)|turn\/start/.test(call.path)).map((call) => ({ path: call.path, threadId: call.body?.threadId })) }, null, 2)}`,
      );
    });
  await expect(
    page.getByText("isolated goal rejection", { exact: true }).first(),
  ).toBeVisible();
  const turns = f.fixture.calls.filter((call) =>
    call.path.endsWith("/turn/start"),
  );
  expect(turns).toHaveLength(1);
  expect(turns[0].body.threadId).toBe("ux-created");
  expect(turns[0].body.input[0].text).toBe(`/goal ${objective}`);
  await expect(editor).toHaveText("");
  expect(files).toEqual(["materialize"]);
  expect(
    f.fixture.calls.filter((call) => call.path.endsWith("/thread/start")),
  ).toHaveLength(1);
});

test("Switching away dismisses an unconfirmed replacement instead of reviving it on return", async ({
  page,
}) => {
  await fixtureGoal(page);
  const editor = page
    .locator(".session-codex-composer [contenteditable=true]")
    .first();
  await editor.fill("/goal 尚未确认的替换");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "替换当前目标吗？" }),
  ).toBeVisible();
  const select = async (threadId: string) =>
    page.evaluate(async (threadId) => {
      const path = "/src/session-mode/components/codex/stores/index.ts";
      const { useCodexStore } = await import(
        performance
          .getEntriesByType("resource")
          .findLast((entry) => new URL(entry.name).pathname === path)?.name ??
          path
      );
      useCodexStore.setState({ currentThreadId: threadId });
    }, threadId);
  await select("ux-1");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await select("ux-0");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(editor).toHaveText("/goal 尚未确认的替换");
});

test("Goal restores read-only, resumes a stalled goal, edits and clears with canonical receipts", async ({
  page,
}, info) => {
  test.setTimeout(60000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const f = await fixtureGoal(page);
  const card = page.locator(".session-thread-goal");
  await expect(card).toContainText("目标已停滞");
  expect(f.writes).toEqual([]);
  await card.getByRole("button", { name: "恢复目标", exact: true }).click();
  await expect(card).toContainText("进行中的目标");
  expect(f.writes).toEqual([
    { action: "set", body: { threadId: "ux-0", status: "active" } },
  ]);
  await card.getByRole("button", { name: "编辑目标", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "编辑目标", exact: true });
  await expect(
    dialog.getByRole("textbox", { name: "目标", exact: true }),
  ).toHaveValue("修复目标状态恢复，所有验收通过");
  await dialog
    .getByRole("textbox", { name: "目标", exact: true })
    .fill("新的可验收成果");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(card).toContainText("新的可验收成果");
  await page.screenshot({ path: info.outputPath("goal-active.png") });
  await card.getByRole("button", { name: "清除目标", exact: true }).click();
  await expect(card).toHaveCount(0);
  expect(f.writes.at(-1)).toEqual({
    action: "clear",
    body: { threadId: "ux-0" },
  });
  expect(errors).toEqual([]);
  expect(
    f.fixture.calls.filter((call) =>
      /\/(?:resume|turn\/start|turn\/steer|turn\/interrupt)$/.test(call.path),
    ),
  ).toEqual([]);
});

test("Saving a goal keeps the composer's unsent message and blocks dismissal until its receipt", async ({
  page,
}) => {
  const f = await fixtureGoal(page);
  const editor = page
    .locator(".session-codex-composer [contenteditable=true]")
    .first();
  await editor.fill("这条普通消息尚未发送");
  await page
    .locator(".session-thread-goal")
    .getByRole("button", { name: "编辑目标", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "编辑目标" });
  await dialog
    .getByRole("textbox", { name: "目标", exact: true })
    .fill("只保存目标，不发送普通消息");
  const release = f.holdNext("set");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect.poll(() => f.writes.length).toBe(1);
  await expect(dialog.getByRole("textbox")).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "取消", exact: true }),
  ).toBeDisabled();
  release();
  await expect(dialog).toHaveCount(0);
  await expect(editor).toHaveText("这条普通消息尚未发送");
  expect(
    f.fixture.calls.filter((call) =>
      /\/(?:turn\/start|followups\/submit)$/.test(call.path),
    ),
  ).toEqual([]);
});

for (const width of [320, 390])
  test.describe(`Goal touch ${width}`, () => {
    test.use({ hasTouch: true, isMobile: true });
    test("keeps its actions reachable and the viewport free of horizontal overflow", async ({
      page,
    }, info) => {
      await page.setViewportSize({ width, height: 844 });
      const f = await fixtureGoal(page);
      const card = page.locator(".session-thread-goal");
      for (const button of await card.locator(".session-goal-action").all()) {
        const rect = (await button.boundingBox())!;
        expect(rect.width).toBeGreaterThanOrEqual(44);
        expect(rect.height).toBeGreaterThanOrEqual(44);
        expect(rect.x).toBeGreaterThanOrEqual(0);
        expect(rect.x + rect.width).toBeLessThanOrEqual(width);
      }
      await card.getByRole("button", { name: "编辑目标", exact: true }).tap();
      const dialog = page.getByRole("dialog", { name: "编辑目标" });
      await expect(dialog).toBeVisible();
      for (const button of await dialog.locator("footer button").all())
        await expect
          .poll(async () => (await button.boundingBox())?.height ?? 0)
          .toBeGreaterThanOrEqual(44);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - innerWidth,
        ),
      ).toBeLessThanOrEqual(1);
      await page.screenshot({ path: info.outputPath("goal-touch-editor.png") });
      await dialog.getByRole("button", { name: "取消", exact: true }).tap();
      expect(f.writes).toEqual([]);
    });
  });
