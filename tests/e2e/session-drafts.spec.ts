import { expect, test, type Page } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applySessionTabAction,
  type FollowedSession,
} from "../../packages/shared/src/session-tabs";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";

function sharedTabs() {
  let cards: FollowedSession[] = [];
  return async (page: Page) => {
    await page.route("**/api/session/tabs", async (route) => {
      const body =
        route.request().method() === "POST"
          ? route.request().postDataJSON()
          : null;
      if (!cards.length && body?.seed) cards = body.seed;
      for (const op of body?.operations ?? [])
        cards = applySessionTabAction(cards, op.action);
      await route.fulfill({
        json: {
          initialized: true,
          revision: 1,
          cards,
          ...(body ? { sequence: body.operations.at(-1)?.seq ?? 0 } : {}),
        },
      });
    });
  };
}
const editor = (page: Page) =>
  page.locator(".session-agent-view [contenteditable=true]");
const tab = (page: Page, i: number) =>
  page.locator(`[role=tab][data-tab-key="codex:ux-${i}"]`);
async function open(page: Page, i: number) {
  await page
    .locator(".session-nav-row[role=button]")
    .filter({ hasText: `中文会话 ${i} ` })
    .first()
    .click();
  await expect(tab(page, i)).toHaveAttribute("aria-selected", "true");
}
async function ready(page: Page) {
  await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
  await editor(page).waitFor();
}
async function pasteImage(
  page: Page,
  name = "draft.png",
  target = editor(page),
) {
  await target.evaluate((element, name) => {
    const bytes = Uint8Array.from(
      atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      ),
      (c) => c.charCodeAt(0),
    );
    const data = new DataTransfer();
    data.items.add(new File([bytes], name, { type: "image/png" }));
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, name);
}

test("draft text and files survive switching, close/reopen, reload, layouts and native editor undo", async ({
  page,
}) => {
  test.setTimeout(90000);
  const fixture = await installSessionUxFixture(page, 3);
  await sharedTabs()(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await ready(page);
  await seedSessionUx(page, 3);
  await open(page, 0);
  await editor(page).fill("A 写到一半");
  await pasteImage(page);
  await expect(
    page.locator(
      ".session-context-chip.is-image[data-state=ready], .session-attachment[data-state=ready]",
    ),
  ).toHaveCount(1);
  await open(page, 1);
  await expect(editor(page)).toHaveText("");
  await expect(
    page.locator(".session-context-chip.is-image, .session-attachment"),
  ).toHaveCount(0);
  await editor(page).fill("B 的独立草稿");
  for (const mode of ["多会话网格", "会话列表", "自由分屏"]) {
    await page.getByRole("button", { name: mode, exact: true }).click();
    if (mode === "自由分屏") await tab(page, 0).click();
    else
      await page
        .locator('[data-session-card="ux-0"] .session-identity-title')
        .click();
    await expect(editor(page)).toHaveText("A 写到一半");
    await expect(
      page.locator(
        ".session-context-chip.is-image[data-state=ready], .session-attachment[data-state=ready]",
      ),
    ).toHaveCount(1);
    if (mode === "自由分屏") await tab(page, 1).click();
    else
      await page
        .locator('[data-session-card="ux-1"] .session-identity-title')
        .click();
    await expect(editor(page)).toHaveText("B 的独立草稿");
  }
  await editor(page).press("Control+z");
  await expect(editor(page)).not.toContainText("A 写到一半");
  await editor(page).fill("B 的独立草稿");
  await tab(page, 0).click();
  await page.getByRole("button", { name: /^关闭标签：中文会话 0/ }).click();
  await expect(editor(page)).toHaveText("B 的独立草稿");
  await open(page, 0);
  await expect(editor(page)).toHaveText("A 写到一半");
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(editor(page)).toHaveText("A 写到一半");
  await expect(
    page.locator(
      ".session-context-chip.is-image[data-state=ready], .session-attachment[data-state=ready]",
    ),
  ).toHaveCount(1);
  await expect(
    page.locator(".session-context-chip.is-image img, .session-attachment img"),
  ).toHaveJSProperty("naturalWidth", 1);
  await tab(page, 1).click();
  await expect(editor(page)).toHaveText("B 的独立草稿");
  expect(
    fixture.calls.filter((c) =>
      /interrupt|delete|disconnect|\/stop/.test(c.path),
    ),
  ).toEqual([]);
  expect(errors).toEqual([]);
});

test("Claude sessions keep separate text and images across switches and reload; a late failure stays with its owner", async ({
  page,
}) => {
  test.setTimeout(90000);
  await installSessionUxFixture(page, 2);
  await sharedTabs()(page);
  await page.route("**/api/**/cc/session-messages", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route("**/api/**/cc/sessions?*", (route) =>
    route.fulfill({ json: { sessions: [], total: 0 } }),
  );
  let finish: (() => Promise<void>) | undefined;
  await page.route("**/api/**/cc/send-message", async (route) => {
    await new Promise<void>((resolve) => {
      finish = async () => {
        await route.fulfill({
          status: 500,
          json: { error: "Claude fixture rejection" },
        });
        resolve();
      };
    });
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await ready(page);
  await seedSessionUx(page, 2);
  await page.evaluate(async () => {
    const live = (path: string) =>
      import(
        performance
          .getEntriesByType("resource")
          .findLast((e) => new URL(e.name).pathname === path)?.name ?? path
      );
    const { useCCStore } = await live("/src/session-mode/stores/cc/ccStore.ts");
    const { useAgentSettingsStore } = await live(
      "/src/session-mode/stores/useAgentSettingsStore.ts",
    );
    const { useAgentCenterStore } = await live(
      "/src/session-mode/stores/useAgentCenterStore.ts",
    );
    const cwd = "/fixture/项目/very-long-project-path-for-ui-regression";
    useCCStore.setState({
      activeSessionId: "ux-0",
      activeSessionIds: ["ux-0", "ux-1"],
      messages: [],
      sessionMessagesMap: { "ux-0": [], "ux-1": [] },
      sessionLoadingMap: {},
      isLoading: false,
      isConnected: true,
    });
    useAgentSettingsStore.getState().setSelectedAgent("cc");
    for (const id of ["ux-0", "ux-1"])
      useAgentCenterStore
        .getState()
        .addAgentCard({ kind: "cc", id, cwd, preview: `Claude ${id}` });
    useAgentCenterStore.getState().setCurrentAgentCardId("ux-0", "cc");
  });
  const input = page.locator(".session-agent-view textarea:visible");
  const a = page.locator('[role=tab][data-tab-key="cc:ux-0"]');
  const b = page.locator('[role=tab][data-tab-key="cc:ux-1"]');
  await input.fill("Claude A unfinished");
  await pasteImage(page, "claude.png", input);
  await expect(
    page.locator(
      ".session-context-chip.is-image[data-state=ready], .session-attachment[data-state=ready]",
    ),
  ).toHaveCount(1);
  await b.click();
  await expect(input).toHaveValue("");
  await expect(
    page.locator(".session-context-chip.is-image, .session-attachment"),
  ).toHaveCount(0);
  await input.fill("Claude B unfinished");
  await a.click();
  await expect(input).toHaveValue("Claude A unfinished");
  await input.press("Enter");
  await expect.poll(() => !!finish).toBe(true);
  await b.click();
  await finish!();
  await expect(input).toHaveValue("Claude B unfinished");
  await a.click();
  await expect(input).toHaveValue("Claude A unfinished");
  await expect(
    page.locator(
      ".session-context-chip.is-image[data-state=ready], .session-attachment[data-state=ready]",
    ),
  ).toHaveCount(1);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(input).toHaveValue("Claude A unfinished");
  await expect(
    page.locator(
      ".session-context-chip.is-image[data-state=ready], .session-attachment[data-state=ready]",
    ),
  ).toHaveCount(1);
  await b.click();
  await expect(input).toHaveValue("Claude B unfinished");
  await a.click();
  await input.fill("");
  finish = undefined;
  await input.press("Enter");
  await expect.poll(() => !!finish).toBe(true);
  await finish!();
  await expect(
    page.locator(
      ".session-context-chip.is-image[data-state=ready], .session-attachment[data-state=ready]",
    ),
  ).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("only the first message names a new session; a manual rename survives sends and reload", async ({
  page,
}) => {
  test.setTimeout(90000);
  await installSessionUxFixture(page, 2);
  await sharedTabs()(page);
  await ready(page);
  await seedSessionUx(page, 0);
  await editor(page).fill("新会话首条任务名称");
  await editor(page).press("Enter");
  const created = page.locator('[role=tab][data-tab-key="codex:ux-created"]');
  await expect(created.locator(".session-identity-title")).toHaveText(
    "新会话首条任务名称",
  );
  await expect(editor(page)).toHaveText("");
  await editor(page).fill("第二条不应改名");
  await editor(page).press("Enter");
  await expect(editor(page)).toHaveText("");
  await expect(created.locator(".session-identity-title")).toHaveText(
    "新会话首条任务名称",
  );
  await created.locator("..").hover();
  await created
    .locator("..")
    .getByRole("button", { name: "重命名会话" })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox").fill("手动固定名称");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(created.locator(".session-identity-title")).toHaveText(
    "手动固定名称",
  );
  await editor(page).fill("改名之后的聊天内容");
  await editor(page).press("Enter");
  await expect(editor(page)).toHaveText("");
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(created.locator(".session-identity-title")).toHaveText(
    "手动固定名称",
  );
});

test("creating a new session in the background transfers later draft edits and attachments without stealing selection", async ({
  page,
}) => {
  test.setTimeout(90000);
  await installSessionUxFixture(page, 2);
  await sharedTabs()(page);
  let release: (() => Promise<void>) | undefined;
  await page.route("**/api/**/thread/start", async (route) => {
    await new Promise<void>((resolve) => {
      release = async () => {
        await route.fulfill({
          json: {
            thread: {
              id: "created-in-background",
              name: null,
              preview: "",
              cwd: "/fixture/项目/very-long-project-path-for-ui-regression",
              status: { type: "idle" },
              turns: [],
              createdAt: 1,
              updatedAt: 2,
              modelProvider: "openai",
            },
            model: "fixture-model",
            modelProvider: "openai",
          },
        });
        resolve();
      };
    });
  });
  await ready(page);
  await seedSessionUx(page, 2);
  await open(page, 0);
  await page
    .locator(".session-new-tab")
    .getByRole("button", { name: "新聊天" })
    .click();
  await editor(page).fill("首次提交的名称");
  await pasteImage(page, "submitted.png");
  await expect(
    page.locator(
      ".session-context-chip.is-image[data-state=ready], .session-attachment[data-state=ready]",
    ),
  ).toHaveCount(1);
  await editor(page).press("Enter");
  await expect.poll(() => !!release).toBe(true);
  await editor(page).fill("创建期间写的未发送内容");
  await pasteImage(page, "later.png");
  await expect(
    page.locator(
      ".session-context-chip.is-image[data-state=ready], .session-attachment[data-state=ready]",
    ),
  ).toHaveCount(2);
  await tab(page, 0).click();
  await editor(page).fill("原会话仍在编辑");
  await release!();
  const created = page.locator(
    '[role=tab][data-tab-key="codex:created-in-background"]',
  );
  await expect(created.locator(".session-identity-title")).toHaveText(
    "首次提交的名称",
  );
  await expect(tab(page, 0)).toHaveAttribute("aria-selected", "true");
  await expect(editor(page)).toHaveText("原会话仍在编辑");
  await created.click();
  await expect(editor(page)).toHaveText("创建期间写的未发送内容");
  await expect(
    page.locator(
      ".session-context-chip.is-image[data-state=ready], .session-attachment[data-state=ready]",
    ),
  ).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "预览 later.png", exact: true }),
  ).toBeVisible();
});

test("late success and failure belong to the submitted session and never erase newer text or change its title", async ({
  page,
}) => {
  test.setTimeout(90000);
  await installSessionUxFixture(page, 2);
  await sharedTabs()(page);
  let finish: ((fail: boolean) => Promise<void>) | undefined;
  await page.route("**/api/session/followups/submit", async (route) => {
    const message = route.request().postDataJSON();
    await new Promise<void>((resolve) => {
      finish = async (fail) => {
        await route.fulfill(
          fail
            ? { status: 500, json: { error: "fixture rejected" } }
            : {
                json: {
                  revision: 1,
                  paused: null,
                  items: [
                    {
                      ...message,
                      status: "sent",
                      createdAt: Date.now(),
                      turnId: "completed",
                    },
                  ],
                },
              },
        );
        resolve();
      };
    });
  });
  await ready(page);
  await seedSessionUx(page, 2);
  await open(page, 0);
  await open(page, 1);
  await tab(page, 0).click();
  const title = await tab(page, 0)
    .locator(".session-identity-title")
    .innerText();
  await editor(page).fill("A 提交消息");
  await editor(page).press("Enter");
  await expect.poll(() => !!finish).toBe(true);
  await tab(page, 1).click();
  await editor(page).fill("B 未发送草稿");
  await finish!(false);
  await expect(editor(page)).toHaveText("B 未发送草稿");
  await tab(page, 0).click();
  await expect(editor(page)).toHaveText("");
  await expect(tab(page, 0).locator(".session-identity-title")).toHaveText(
    title,
  );
  finish = undefined;
  await editor(page).fill("A 第二次提交");
  await editor(page).press("Enter");
  await expect.poll(() => !!finish).toBe(true);
  await editor(page).fill("A 发送中写的新内容");
  await finish!(false);
  await expect(editor(page)).toHaveText("A 发送中写的新内容");
  finish = undefined;
  await editor(page).fill("A 发送失败应保留");
  await editor(page).press("Enter");
  await expect.poll(() => !!finish).toBe(true);
  await tab(page, 1).click();
  await finish!(true);
  await expect(editor(page)).toHaveText("B 未发送草稿");
  await tab(page, 0).click();
  await expect(editor(page)).toHaveText("A 发送失败应保留");
  await expect(tab(page, 0).locator(".session-identity-title")).toHaveText(
    title,
  );
});

test("an interrupted image upload survives reload with file bytes and can retry", async ({
  page,
}) => {
  test.setTimeout(90000);
  await installSessionUxFixture(page, 2);
  await sharedTabs()(page);
  let release: (() => void) | undefined;
  let pending = true;
  let recoveredName: string | undefined;
  await page.route("**/api/session/files/upload", async (route) => {
    if (pending)
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    else recoveredName = route.request().postDataJSON().name;
    await route
      .fulfill({ json: { path: "/fixture/recovered.png" } })
      .catch(() => {});
  });
  await ready(page);
  await seedSessionUx(page, 2);
  await open(page, 0);
  await editor(page).fill("带未上传完附件的草稿");
  await pasteImage(page, "interrupted.png");
  await expect.poll(() => !!release).toBe(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  pending = false;
  release!();
  await expect(editor(page)).toHaveText("带未上传完附件的草稿");
  await expect(
    page.locator(
      ".session-context-chip.is-image[data-state=error], .session-attachment[data-state=error]",
    ),
  ).toHaveCount(1);
  await page.getByRole("button", { name: /预览 .*上传失败/ }).click();
  await page.getByRole("button", { name: "重试上传", exact: true }).click();
  await page.getByRole("button", { name: "关闭面板", exact: true }).click();
  await expect(
    page.locator(
      ".session-context-chip.is-image[data-state=ready], .session-attachment[data-state=ready]",
    ),
  ).toHaveCount(1);
  expect(recoveredName).toBe("interrupted.png");
});

test("closing and restarting the browser restores text and attachment bytes from the same profile", async ({
  browser,
  baseURL,
}, testInfo) => {
  test.setTimeout(90000);
  const profile = await mkdtemp(join(tmpdir(), "kanban-draft-browser-"));
  const tabs = sharedTabs();
  const launchOptions = {
    ...testInfo.project.use.launchOptions,
    headless: true,
    ignoreHTTPSErrors: true,
    baseURL,
  };
  let context = await browser.browserType().launchPersistentContext(profile, launchOptions);
  try {
    let page = context.pages()[0];
    await installSessionUxFixture(page, 2);
    await tabs(page);
    await ready(page);
    await seedSessionUx(page, 2);
    await open(page, 0);
    await editor(page).fill("浏览器重开仍保留");
    await pasteImage(page, "persistent.png");
    await expect(
      page.locator(
        ".session-context-chip.is-image[data-state=ready], .session-attachment[data-state=ready]",
      ),
    ).toHaveCount(1);
    await page.evaluate(async () => {
      const url = performance
        .getEntriesByType("resource")
        .findLast((e) =>
          e.name.includes("/components/common/useImageAttachments.ts"),
        )?.name;
      const { flushAttachmentDraft } = await import(
        url ?? "/src/session-mode/components/common/useImageAttachments.ts"
      );
      const key = JSON.stringify(["codex", "", "session", "ux-0"]);
      await flushAttachmentDraft(key);
    });
    await context.close();
    context = await browser.browserType().launchPersistentContext(profile, launchOptions);
    page = context.pages()[0];
    await installSessionUxFixture(page, 2);
    await tabs(page);
    await ready(page);
    await expect(editor(page)).toHaveText("浏览器重开仍保留");
    await expect(
      page.locator(
        ".session-context-chip.is-image[data-state=ready], .session-attachment[data-state=ready]",
      ),
    ).toHaveCount(1);
    await expect(
      page.locator(
        ".session-context-chip.is-image img, .session-attachment img",
      ),
    ).toHaveJSProperty("naturalWidth", 1);
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});
