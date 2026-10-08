import { expect, test } from "@playwright/test";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";

test("isolated create/send/stream/tools, mode isolation and preserved drafts/attachments", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const fixture = await installSessionUxFixture(page, 0);
  await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
  const editor = page.locator(".session-mode [contenteditable=true]").first();
  await editor.waitFor();
  await seedSessionUx(page, 0);
  await expect(
    page.getByRole("button", { name: "发送消息", exact: true }),
  ).toBeDisabled();
  await editor.pressSequentially("实现一个测试任务");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect
    .poll(
      () =>
        fixture.calls.filter((c) => c.path.endsWith("/followups/submit"))
          .length,
    )
    .toBe(1);
  // The durable outbox owns native turn dispatch; this fixture verifies the
  // submitted intent while followup tests exercise the runtime adapter itself.
  expect(
    fixture.calls.find((c) => c.path.endsWith("/followups/submit"))?.body,
  ).toMatchObject({ threadId: "ux-created", text: "实现一个测试任务" });
  // Background reads are authoritative. Persist the same synthetic reply/tools
  // in the API fixture so read reconciliation cannot erase the streamed rows.
  Object.assign(fixture.threads.find((thread) => thread.id === "ux-created")!, {
    turns: [
      {
        id: "ux-turn-ux-created",
        status: "completed",
        startedAt: 1,
        durationMs: 2,
        error: null,
        items: [
          {
            id: "reply",
            type: "agentMessage",
            text: "回复验证成功\n\n```ts\nconst value = 42;\n```",
          },
          ...["isolated_tool_result", "second_tool_result"].map(
            (output, i) => ({
              id: i ? "second-command" : "command",
              type: "commandExecution",
              command: `echo ${output}`,
              cwd: "/fixture",
              processId: null,
              status: "completed",
              exitCode: 0,
              durationMs: i ? 3 : 2,
              aggregatedOutput: output,
              commandActions: [],
            }),
          ),
        ],
      },
    ],
  });
  await page.evaluate(async () => {
    const { useCodexStore } = await import(
      performance
        .getEntriesByType("resource")
        .findLast(
          (e) =>
            new URL(e.name).pathname ===
            "/src/session-mode/components/codex/stores/index.ts",
        )?.name ?? "/src/session-mode/components/codex/stores/index.ts"
    );
    const store = useCodexStore.getState();
    store.addEvent("ux-created", {
      method: "item/completed",
      params: {
        threadId: "ux-created",
        turnId: "ux-turn-ux-created",
        item: {
          id: "reply",
          type: "agentMessage",
          text: "回复验证成功\n\n```ts\nconst value = 42;\n```",
        },
      },
    });
    store.addEvent("ux-created", {
      method: "item/started",
      params: {
        threadId: "ux-created",
        turnId: "ux-turn-ux-created",
        item: {
          id: "command",
          type: "commandExecution",
          command: "echo isolated_tool_result",
          cwd: "/fixture",
          processId: null,
          status: "inProgress",
          commandActions: [],
        },
      },
    });
    store.addEvent("ux-created", {
      method: "item/completed",
      params: {
        threadId: "ux-created",
        turnId: "ux-turn-ux-created",
        item: {
          id: "command",
          type: "commandExecution",
          command: "echo isolated_tool_result",
          cwd: "/fixture",
          processId: null,
          status: "completed",
          exitCode: 0,
          durationMs: 2,
          aggregatedOutput: "isolated_tool_result",
          commandActions: [],
        },
      },
    });
    store.addEvent("ux-created", {
      method: "item/started",
      params: {
        threadId: "ux-created",
        turnId: "ux-turn-ux-created",
        item: {
          id: "second-command",
          type: "commandExecution",
          command: "echo second_tool_result",
          cwd: "/fixture",
          processId: null,
          status: "inProgress",
          commandActions: [],
        },
      },
    });
    store.addEvent("ux-created", {
      method: "item/completed",
      params: {
        threadId: "ux-created",
        turnId: "ux-turn-ux-created",
        item: {
          id: "second-command",
          type: "commandExecution",
          command: "echo second_tool_result",
          cwd: "/fixture",
          processId: null,
          status: "completed",
          exitCode: 0,
          durationMs: 3,
          aggregatedOutput: "second_tool_result",
          commandActions: [],
        },
      },
    });
    store.addEvent("ux-created", {
      method: "turn/completed",
      params: {
        threadId: "ux-created",
        turn: {
          id: "ux-turn-ux-created",
          status: "completed",
          durationMs: 2,
          startedAt: 1,
          items: [],
        },
      },
    });
  });
  await expect(
    page.getByText("回复验证成功", { exact: false }).first(),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /执行了.*命令/ })
    .first()
    .click();
  await page
    .getByRole("button", { name: /执行.*echo isolated_tool_result/ })
    .click();
  await expect(
    page.getByText("isolated_tool_result", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /执行.*echo second_tool_result/ })
    .click();
  await expect(
    page.getByText("second_tool_result", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("isolated_tool_result", { exact: true }),
  ).toBeVisible();
  await editor.pressSequentially("保留输入草稿");
  await editor.evaluate((node) => {
    const transfer = new DataTransfer();
    transfer.items.add(
      new File(
        [
          Uint8Array.from(
            atob(
              "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZyUAAAAASUVORK5CYII=",
            ),
            (c) => c.charCodeAt(0),
          ),
        ],
        "fixture.png",
        { type: "image/png" },
      ),
    );
    node.dispatchEvent(
      new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: transfer,
      }),
    );
  });
  await expect(
    page.getByRole("button", { name: "预览 fixture.png", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("group", { name: "工作模式", exact: true })
    .getByRole("button", { name: "终端", exact: true })
    .click();
  await page.evaluate(() =>
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "n",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  const active = await page.evaluate(
    async () =>
      (
        await import(
          performance
            .getEntriesByType("resource")
            .findLast(
              (e) =>
                new URL(e.name).pathname ===
                "/src/session-mode/components/codex/stores/index.ts",
            )?.name ?? "/src/session-mode/components/codex/stores/index.ts"
        )
      ).useCodexStore.getState().currentThreadId,
  );
  expect(active).toBe("ux-created");
  await page
    .getByRole("group", { name: "工作模式", exact: true })
    .getByRole("button", { name: "会话", exact: true })
    .click();
  await expect(editor).toContainText("保留输入草稿");
  await expect(
    page.getByRole("button", { name: "预览 fixture.png", exact: true }),
  ).toBeVisible();
  expect(
    fixture.calls.filter((c) => c.path.endsWith("/followups/submit")),
  ).toHaveLength(1);
  expect(errors).toEqual([]);
});

test("many sessions, search, model menu, responsive controls and error recovery", async ({
  page,
}) => {
  test.setTimeout(60000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const fixture = await installSessionUxFixture(page, 40);
  await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
  await page.locator(".session-mode [contenteditable=true]").first().waitFor();
  await seedSessionUx(page, 40);
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 900, height: 720 },
    { width: 375, height: 812 },
  ]) {
    await page.setViewportSize(viewport);
    await page
      .getByRole("button", { name: /Agent 与模型：/ })
      .first()
      .click();
    const model = page.locator(".session-agent-model-panel");
    await expect(model).toBeVisible();
    const bounds = await model.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width + 1);
    await expect(
      model.getByRole("option", { name: "Codex", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await page.screenshot({
      path: `.dev-runtime/session-ux/session-${viewport.width}.png`,
    });
    const clipped = await page
      .locator(".session-workspace-switcher")
      .evaluate((root) =>
        Array.from(root.querySelectorAll("button"))
          .filter((button) => {
            const rect = button.getBoundingClientRect();
            return (
              rect.width > 0 &&
              (rect.left < 0 ||
                rect.right > innerWidth + 1 ||
                rect.bottom > innerHeight + 1)
            );
          })
          .map((button) => button.getAttribute("aria-label")),
      );
    expect(clipped).toEqual([]);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(viewport.width);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  const projects = page.getByRole("button", {
    name: "展开项目列表",
    exact: true,
  });
  if (await projects.isVisible()) await projects.click();
  await page.getByRole("button", { name: "搜索和管理会话" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Codex 会话", exact: true }).click();
  await dialog.getByRole("textbox", { name: "搜索会话" }).fill("中文会话 39");
  await expect(dialog.getByText(/中文会话 39/).first()).toBeVisible();
  await dialog.getByRole("button", { name: "清空搜索" }).click();
  await expect(dialog.getByRole("textbox", { name: "搜索会话" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "搜索和管理会话" }),
  ).toBeFocused();
  fixture.setListError(true);
  await page.evaluate(async () => {
    const { useWorkspaceStore } = await import(
      performance
        .getEntriesByType("resource")
        .findLast(
          (e) =>
            new URL(e.name).pathname ===
            "/src/session-mode/stores/useWorkspaceStore.ts",
        )?.name ?? "/src/session-mode/stores/useWorkspaceStore.ts"
    );
    useWorkspaceStore.setState({
      projects: ["/fixture/new-project"],
      cwd: "/fixture/new-project",
    });
  });
  await expect(
    page.getByText(/会话加载失败|会话列表加载失败|无法加载会话/).first(),
  ).toBeVisible();
  fixture.setListError(false);
  await page.getByRole("button", { name: "重试", exact: true }).first().click();
  await expect(
    page.getByText(/会话加载失败|会话列表加载失败|无法加载会话/),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("model search remains inside the command context and restores the composer", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await installSessionUxFixture(page, 0);
  await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
  await page.locator(".session-mode [contenteditable=true]").first().waitFor();
  await seedSessionUx(page, 0);
  await page
    .getByRole("button", { name: /Agent 与模型：/ })
    .first()
    .click();
  const panel = page.locator(".session-agent-model-panel");
  await panel.getByRole("button", { name: "搜索模型", exact: true }).click();
  const search = panel.getByPlaceholder("搜索或输入模型 ID…");
  await expect(search).toBeVisible();
  await search.fill("测试");
  await expect(panel.getByText("测试模型", { exact: true })).toBeVisible();
  await search.fill("不存在的模型");
  await expect(
    panel.getByRole("option", {
      name: "使用模型 ID：不存在的模型",
      exact: true,
    }),
  ).toBeVisible();
  await search.fill("fixture-model");
  await expect(panel.getByText("测试模型", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: /Agent 与模型：/ }).first(),
  ).toBeFocused();
  await page
    .getByRole("button", { name: /Agent 与模型：/ })
    .first()
    .click();
  await panel.getByRole("button", { name: "搜索模型", exact: true }).click();
  await panel.getByPlaceholder("搜索或输入模型 ID…").fill("unlisted-model");
  await panel
    .getByRole("option", { name: "使用模型 ID：unlisted-model", exact: true })
    .click();
  await expect(
    page
      .getByRole("button", { name: /Agent 与模型：.*unlisted-model/ })
      .first(),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
